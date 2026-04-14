import { HLSDownloader } from './downloader.js';
import { CONFIG } from './config.js';
import { storeMuxData, getMuxResult, deleteMuxData, cleanupOldEntries, clearAllMuxData } from './mux-storage.js';


// Store detected videos: { tabId: { url: { type, parsedData?, referer?, headers? } } }
let detectedVideos = {};

// Store active downloads
let activeDownloads = {};

// Logger System
const Logger = {
    logs: [],
    log: (msg, data = null) => {
        const entry = `[INFO] ${new Date().toISOString()} - ${msg} ${data ? JSON.stringify(data) : ''}`;
        console.log(entry);
        Logger.logs.push(entry);
        if (Logger.logs.length > 500) Logger.logs.shift();
    },
    error: (msg, error = null) => {
        const entry = `[ERROR] ${new Date().toISOString()} - ${msg} ${error ? (error.message || JSON.stringify(error)) : ''}`;
        console.error(entry);
        Logger.logs.push(entry);
        if (Logger.logs.length > 500) Logger.logs.shift();
    },
    getLogs: () => Logger.logs.join('\n')
};

// Make Logger accessible to other scripts (like downloader.js)
if (typeof window !== 'undefined') window.Logger = Logger;
else if (typeof globalThis !== 'undefined') globalThis.Logger = Logger;

// Clear storage for a tab when it connects or refreshes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    detectedVideos[tabId] = {};
    updateBadge(tabId);
    Logger.log(`Tab ${tabId} updated/reloaded`);
    
    // Auto-cleanup if no downloads are active
    const activeCount = Object.keys(activeDownloads).filter(k => 
        activeDownloads[k].status === 'downloading' || activeDownloads[k].status === 'muxing'
    ).length;
    
    if (activeCount === 0) {
        Logger.log("No active downloads, clearing MuxDB...");
        clearAllMuxData().catch(e => Logger.error("Failed to clear MuxDB", e));
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete detectedVideos[tabId];
});


// Listener to capture video requests and HEADERS
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const { tabId, url, requestHeaders } = details;
        if (tabId === -1) return;

        // Determine if video (Expanded for Vimeo JSON manifests)
        const isVideo = url.includes('.m3u8') || url.includes('.mp4') || url.includes('.ts') || 
                        (url.includes('vimeocdn.com') && (url.includes('playlist.json') || url.includes('master.json'))); 
        
        if (isVideo) {
            if (url.includes('vimeocdn.com')) Logger.log(`[VIMEO] Capturando link na rede: ${url.substring(0, 80)}...`);
            const capturedHeaders = {};
            requestHeaders.forEach(h => {
                if (['authorization', 'referer', 'origin', 'cookie', 'user-agent'].includes(h.name.toLowerCase())) {
                    capturedHeaders[h.name] = h.value;
                }
            });
            // Fallback for Referer if missing
            if (!capturedHeaders['Referer'] && !capturedHeaders['referer']) {
                if (details.initiator && !details.initiator.startsWith('chrome-extension')) {
                    capturedHeaders['Referer'] = details.initiator;
                } else if (details.documentUrl) {
                    capturedHeaders['Referer'] = details.documentUrl;
                }
            }

            Logger.log(`Captured headers for ${url.substring(0, 50)}...`, Object.keys(capturedHeaders));

            // Store by strict URL for now
            const urlKey = url;
            
            if (!detectedVideos[tabId]) detectedVideos[tabId] = {};
            
            if (!detectedVideos[tabId][urlKey]) {
                detectedVideos[tabId][urlKey] = {
                    headers: capturedHeaders,
                    timestamp: Date.now()
                };
            } else {
                 detectedVideos[tabId][urlKey].headers = capturedHeaders;
            }
        }
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const { tabId, url, responseHeaders, initiator, documentUrl } = details;
    if (tabId === -1) return;

    // Try to determine the likely referer to use if we missed it
    const referer = initiator || documentUrl;

    const contentTypeHeader = responseHeaders.find(h => h.name.toLowerCase() === 'content-type');
    const contentType = contentTypeHeader ? contentTypeHeader.value.toLowerCase() : '';

    let type = null;
    if (contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('application/x-mpegurl') || url.includes('.m3u8')) {
      type = 'm3u8';
    } else if (contentType.includes('video/mp4') || url.includes('.mp4')) {
      type = 'mp4';
    } else if (url.includes('vimeocdn.com') && (url.includes('playlist.json') || url.includes('master.json'))) {
      type = 'm3u8'; // Treat vimeo JSON manifests as HLS streams
      Logger.log(`[VIMEO] Identificado manifesto JSON como Stream: ${url.substring(0, 60)}`);
    }

    if (type) {
      // Robust Deduplication Strategy
      try {
          const urlObj = new URL(url);
          let videoKey;

          // Advanced Path Normalization for Deduplication
          let cleanPath = urlObj.pathname;
          
          // Vimeo range segments: .../range/prot/BASE64/.../avf/UUID.mp4
          if (cleanPath.includes('/avf/') && cleanPath.endsWith('.mp4')) {
              // Extract the UUID part: last segment
              const uuid = cleanPath.split('/').pop(); 
              cleanPath = '/vimeo-stream/' + uuid; 
          }
          else if (cleanPath.includes('/range/')) {
              cleanPath = cleanPath.replace(/\/range\/[^\/]+\//, '/range/VAR/');
              cleanPath = cleanPath.replace(/\/range\/VAR\/[^\/]+\//, '/range/VAR/RANGE/');
          }
          
          // Generic segments
          cleanPath = cleanPath.replace(/segment-\d+/, 'segment-VAR');
          cleanPath = cleanPath.replace(/frag\d+/, 'frag-VAR');

          if (cleanPath.startsWith('/vimeo-stream/') || cleanPath.endsWith('.mp4') || cleanPath.endsWith('.m3u8') || cleanPath.endsWith('.ts')) {
              videoKey = urlObj.origin + cleanPath;
          } else {
             const paramsToRemove = ['range', 'segment', 'fragment', 'part', 'start', 'end', 'byterange', 'acl', 'hmac', 'exp'];
             paramsToRemove.forEach(p => urlObj.searchParams.delete(p));
             videoKey = urlObj.origin + cleanPath + urlObj.search;
          }

          if (!detectedVideos[tabId]) detectedVideos[tabId] = {};
          
          // Retrieve headers captured in onBeforeSendHeaders
          let headers = {};
          if (detectedVideos[tabId][url] && detectedVideos[tabId][url].headers) {
              headers = detectedVideos[tabId][url].headers;
          }
          
          if (detectedVideos[tabId][videoKey] && detectedVideos[tabId][videoKey].type) {
             const existing = detectedVideos[tabId][videoKey];
             
             existing.originalUrl = url;
             existing.timestamp = Date.now();
             
             if (Object.keys(headers).length > 0) existing.headers = headers;
             
             // Enhanced fragment detection (Case Insensitive)
             const lowerUrl = url.toLowerCase();
             const isFrag = lowerUrl.includes('/range/') || 
                            lowerUrl.includes('segment') || 
                            lowerUrl.includes('frag') || 
                            lowerUrl.includes('chunk') || 
                            lowerUrl.includes('init') || 
                            lowerUrl.includes('mime') ||
                            lowerUrl.match(/\.ts($|\?)/);
             
             if (isFrag) existing.isFragment = true;
             
             // Try to get tab title if possible (async)
             let pageTitle = 'video';
             chrome.tabs.get(tabId, (tab) => {
                 if (chrome.runtime.lastError) return;
                 if (tab && tab.title) {
                     pageTitle = tab.title;
                     if (detectedVideos[tabId][videoKey]) {
                         detectedVideos[tabId][videoKey].pageTitle = pageTitle;
                     }
                 }
             });

             detectedVideos[tabId][videoKey] = {
               url: videoKey, 
               originalUrl: url, 
               type: type,
               referer: referer, 
               headers: headers,
               timestamp: Date.now(),
               isFragment: existing.isFragment || isFrag,
               pageTitle: pageTitle
             };
          } else {
             // New Entry
             const lowerUrl = url.toLowerCase();
             let isFrag = lowerUrl.includes('/range/') || 
                            lowerUrl.includes('segment') || 
                            lowerUrl.includes('frag') || 
                            lowerUrl.includes('chunk') || 
                            lowerUrl.includes('init') || 
                            lowerUrl.includes('mime') ||
                            lowerUrl.match(/\.ts($|\?)/);
             
             // [VIMEO FIX] Manifests are never fragments
             if (lowerUrl.includes('playlist.json') || lowerUrl.includes('master.json') || lowerUrl.includes('master.m3u8')) {
                 isFrag = false;
             }
                            
             let pageTitle = 'video';
             chrome.tabs.get(tabId, (tab) => {
                 if (chrome.runtime.lastError) return;
                 if (tab && tab.title) {
                     pageTitle = tab.title;
                     if (detectedVideos[tabId][videoKey]) {
                         detectedVideos[tabId][videoKey].pageTitle = pageTitle;
                     }
                 }
             });
             
             detectedVideos[tabId][videoKey] = {
                 url: videoKey,
                 originalUrl: url,
                 type: type,
                 referer: referer,
                 headers: headers,
                 timestamp: Date.now(),
                 isFragment: isFrag,
                 pageTitle: pageTitle
             };
             
             if (!isFrag) {
                 const prefix = url.includes('vimeocdn.com') ? '[VIMEO] ' : '';
                 Logger.log(`${prefix}Detectado novo vídeo`, { key: videoKey, type });
                 // Probe the video to check if it's a master playlist
                 if (type === 'm3u8') {
                     probeVideo(videoKey, url, tabId);
                 }
             }
             updateBadge(tabId);
          }
      } catch (e) {
          Logger.error("Error identifying video", e);
          if (!detectedVideos[tabId]) detectedVideos[tabId] = {};
          detectedVideos[tabId][url] = { url, type, originalUrl: url, referer, timestamp: Date.now() };
          updateBadge(tabId);
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

async function probeVideo(videoKey, fullUrl, tabId) {
    try {
        const video = detectedVideos[tabId] && detectedVideos[tabId][videoKey];
        if (!video) return;

        // Fetch just the first few bytes to check header
        // We use the headers we captured
        const headers = {};
        if (video.headers) {
             for (const [k,v] of Object.entries(video.headers)) {
                 if (!['host', 'connection', 'referer', 'origin', 'content-length', 'cookie'].includes(k.toLowerCase())) {
                     headers[k] = v;
                 }
             }
        }
        
        // Simple GET but maybe we can abort early?
        // Using a controller to abort if too large, but standard fetch waits for headers.
        // We just need the text.
        const response = await fetch(fullUrl, { headers });
        if (!response.ok) return;
        
        // Read first 2KB
        const reader = response.body.getReader();
        const { value } = await reader.read();
        reader.cancel(); // Stop fetching
        
        const text = new TextDecoder().decode(value || new Uint8Array());
        
        const isMaster = text.includes('#EXT-X-STREAM-INF') || 
                        (text.trim().startsWith('{') && (text.includes('"streams"') || text.includes('"files"')));

        if (isMaster) {
            // It's a Master Playlist or Vimeo Config!
            if (detectedVideos[tabId] && detectedVideos[tabId][videoKey]) {
                detectedVideos[tabId][videoKey].isMaster = true;
                Logger.log("[VIMEO] Confirmado manifesto principal (Master):", videoKey);
                broadcastUpdate(); // Refresh UI to hide media playlists now that a master is found
            }
        } else if (text.includes('#EXTINF')) {
             if (detectedVideos[tabId] && detectedVideos[tabId][videoKey]) {
                detectedVideos[tabId][videoKey].isMedia = true;
            }
        }
        
    } catch (e) {
        Logger.log("Probe failed for", fullUrl, e.message);
    }
}

function updateBadge(tabId) {

  const count = detectedVideos[tabId] ? Object.keys(detectedVideos[tabId]).filter(k => detectedVideos[tabId][k].type).length : 0;
  chrome.action.setBadgeText({ text: count > 0 ? count.toString() : "", tabId: tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#e91e63", tabId: tabId });
}


// Handle all incoming messages from popup, content scripts, and offscreen doc
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Video detection messages
  if (request.action === "getVideos") {
    const tabId = request.tabId;
    sendResponse({ videos: detectedVideos[tabId] || {}, downloads: activeDownloads });
  }

  if (request.action === "foundVideos") {
      const tabId = sender.tab ? sender.tab.id : null;
      if (tabId) {
          if (!detectedVideos[tabId]) detectedVideos[tabId] = {};
          request.videos.forEach(video => {
              const type = video.url.includes('.m3u8') ? 'm3u8' : 'mp4';
              if (!detectedVideos[tabId][video.url]) {
                   detectedVideos[tabId][video.url] = {
                       url: video.url,
                       originalUrl: video.url,
                       type: type,
                       source: 'dom',
                       timestamp: Date.now()
                   };
              }
          });
          updateBadge(tabId);
      }
  }

  // 2. Download flow messages
  if (request.action === "startDownload") {
      startDownload(request.video);
      sendResponse({ status: "started" });
  }
  
  if (request.action === "getDownloads") {
      sendResponse({ downloads: activeDownloads });
  }

  if (request.action === "getLogs") {
      sendResponse({ logs: Logger.getLogs() });
  }

  // 3. Environment & Config (For content script badge)
  if (request.action === 'getConfig') {
      Logger.log(`[VD] Script solicitado config. Ambiente atual: ${CONFIG.ENV}`);
      sendResponse({ config: CONFIG });
  }

  // 4. Muxing messages (From offscreen document)
  if (request.action === 'muxComplete' && request.requestId) {
    const pending = pendingMuxOperations[request.requestId];
    if (pending) {
        if (request.success) {
            pending.resolve(request.data);
        } else {
            pending.reject(new Error(request.error));
        }
        delete pendingMuxOperations[request.requestId];
    }
  }

  if (request.action === 'muxLog') {
    Logger.log(`[FFmpeg] ${request.message}`);
  }

  if (request.action === 'muxProgress' && request.requestId) {
    const pending = pendingMuxOperations[request.requestId];
    if (pending && pending.downloadId) {
         const downloadId = pending.downloadId;
         if (activeDownloads[downloadId]) {
             activeDownloads[downloadId].muxProgress = request.progress;
             broadcastUpdate();
         }
    }
  }

  // No global 'return true' needed as all responses are sent synchronously.
});


async function startDownload(video) {
    if (!video || !video.url) {
        Logger.error("StartDownload called with invalid video object", video);
        return;
    }

    Logger.log("Starting download for", video.url);
    const downloadId = video.url; 

    let pageTitle = 'video';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.title) {
            pageTitle = sanitizeFilename(tab.title);
        }
    } catch (e) {
        Logger.log("Could not get page title", e.message);
    }

    // 1. Setup DNR Rules
    let finalReferer = video.headers ? (video.headers['Referer'] || video.headers['referer']) : null;
    const origin = video.headers ? (video.headers['Origin'] || video.headers['origin']) : null;
    
    // [VIMEO FIX] Always enforce the Vimeo player referer to prevent 403
    if (video.url.includes('vimeocdn.com')) {
        finalReferer = 'https://player.vimeo.com/';
        Logger.log("[VIMEO] Forçando Referer: " + finalReferer);
    }
    
    try {
        new URL(video.url); // Check validity
        if (finalReferer) {
            Logger.log("Setting up DNR rule for Referer:", finalReferer);
            await setupDNRRule(video.url, finalReferer, origin);
        } else {
            Logger.log("No Referer found to inject. Using default.");
        }
    } catch(e) {
        Logger.error("Invalid video URL for DNR setup", video.url);
    }

    if (activeDownloads[downloadId] && activeDownloads[downloadId].status === 'downloading') {
        Logger.log("Download already in progress", downloadId);
        return;
    }

    activeDownloads[downloadId] = {
        video: video,
        progress: 0,
        status: 'downloading',
        pageTitle: pageTitle
    };
    broadcastUpdate();

    // Small delay to ensure rules are active
    await new Promise(r => setTimeout(r, 200));

    if (video.type === 'mp4') {
         downloadBlobStrategy(video, downloadId, pageTitle);
    } else if (video.type === 'm3u8') {
        downloadHLS(video, downloadId, pageTitle);
    }
}

// Sanitize filename - remove invalid characters
function sanitizeFilename(name) {
    return name
        .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
        .replace(/\s+/g, '_')           // Replace spaces with underscore
        .substring(0, 100)              // Limit length
        .trim() || 'video';
}

// Helper to setup Declarative Net Request rules
async function setupDNRRule(targetUrl, referer, origin) {
    try {
        const urlObj = new URL(targetUrl);
        const domain = urlObj.hostname;
        
        const ruleId = 1;

        const ruleResponseHeaders = [
            { "header": "Referer", "operation": "set", "value": referer }
        ];
        if (origin) {
            ruleResponseHeaders.push({ "header": "Origin", "operation": "set", "value": origin });
        }

        const addRules = [{
            "id": ruleId,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": ruleResponseHeaders
            },
            "condition": {
                "requestDomains": [domain],
                "initiatorDomains": [chrome.runtime.id], 
                "resourceTypes": ["xmlhttprequest", "other"]
            }
        }];

        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [ruleId],
            addRules: addRules
        });
        Logger.log("DNR Rule Active for domain", domain);

    } catch (e) {
        Logger.error("Failed to set DNR rule", e);
    }
}

// Pending mux operations
const pendingMuxOperations = {};

// Note: Message listener moved and unified above for better reliability.

// Ensure offscreen document exists
async function ensureOffscreen() {
    const offscreenUrl = 'offscreen.html';
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(offscreenUrl)]
    });
    
    if (existingContexts.length === 0) {
        await chrome.offscreen.createDocument({
            url: offscreenUrl,
            reasons: ['AUDIO_PLAYBACK'], // Using AUDIO_PLAYBACK as a valid reason
            justification: 'FFmpeg muxing requires DOM APIs'
        });
    }
}

async function downloadHLS(video, id, pageTitle = 'video') {
    try {
        Logger.log("Starting HLS download", { url: video.originalUrl || video.url });
        const headers = video.headers || {};
        const downloader = new HLSDownloader(video.originalUrl || video.url, { headers }, (progress) => {
            if (activeDownloads[id]) {
                activeDownloads[id].progress = progress * 0.7; // Download is 70%
                activeDownloads[id].status = 'downloading';
                broadcastUpdate();
            }
        });

        const result = await downloader.start();
        
        Logger.log("Download complete, starting FFmpeg conversion to MP4 via offscreen...");
        
        if (activeDownloads[id]) {
            activeDownloads[id].status = 'muxing';
            activeDownloads[id].progress = 70;
            broadcastUpdate();
        }
        
        let requestId = null;
        try {
            // Ensure offscreen document is ready
            await ensureOffscreen();
            
            // Store Blobs directly in IndexedDB (avoids expensive conversion to Array)
            const videoData = result.hasSeparateAudio ? result.videoBlob : result;
            const audioData = result.hasSeparateAudio ? result.audioBlob : null;
                
                // Create request ID
                requestId = `mux_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                // Store data in IndexedDB (avoids message size limits)
                Logger.log("Storing mux data in IndexedDB...", { videoSize: videoData.size, audioSize: audioData ? audioData.size : 0 });
                await storeMuxData(requestId, videoData, audioData);
                
                // Create promise for result
                const muxPromise = new Promise((resolve, reject) => {
                    pendingMuxOperations[requestId] = { resolve, reject, downloadId: id };
                    
                    pendingMuxOperations[requestId] = { resolve, reject, downloadId: id };
                    
                    // Timeout extended to 30 minutes for large files
                    setTimeout(() => {
                        if (pendingMuxOperations[requestId]) {
                            // Don't just delete, reject it.
                            const pending = pendingMuxOperations[requestId];
                            delete pendingMuxOperations[requestId];
                            pending.reject(new Error('Mux operation timed out (30m limit). Check memory or file size.'));
                        }
                    }, 1800000); // 30 minutes
                });
                
                // Send small message to trigger mux (no large data)
                chrome.runtime.sendMessage({
                    action: 'mux',
                    requestId: requestId
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        Logger.error("Failed to send mux message", chrome.runtime.lastError);
                    }
                });
                
                // Wait for completion notification
                await muxPromise;
                
                // Retrieve result from IndexedDB
                const outputData = await getMuxResult(requestId);
                if (!outputData) {
                    throw new Error('Mux result not found in IndexedDB');
                }
                
                // Convert to blob
                const outputBlob = new Blob([new Uint8Array(outputData)], { type: 'video/mp4' });
                
                Logger.log("Mux complete, saving file...");
                
                if (activeDownloads[id]) {
                    activeDownloads[id].progress = 100;
                }
                
                saveBlob(outputBlob, `${pageTitle}.mp4`, id);
                
            } catch (muxError) {
                Logger.error("Mux failed, saving fallback files:", muxError.message);
                
                // Fallback: save separate files or single file
                if (result.hasSeparateAudio) {
                    saveBlob(result.videoBlob, `${pageTitle}_VIDEO.ts`, id + '_video');
                    saveBlob(result.audioBlob, `${pageTitle}_AUDIO.ts`, id + '_audio');
                } else {
                    saveBlob(result, `${pageTitle}.ts`, id);
                }
                
                if (activeDownloads[id]) {
                    // Changed status to 'complete_with_error' so UI knows it was a fallback
                    activeDownloads[id].status = 'complete_with_error';
                    activeDownloads[id].progress = 100;
                    activeDownloads[id].ffmpegHint = true;
                    activeDownloads[id].error = 'Mux falhou: ' + muxError.message;
                }
                broadcastUpdate();
            } finally {
                // Always clean up IndexedDB data
                if (requestId) {
                    deleteMuxData(requestId).catch(e => Logger.error("Failed to cleanup IDB", e));
                }
            }

    } catch (e) {
        Logger.error("HLS Download error", e.message);
        if (activeDownloads[id]) {
            activeDownloads[id].status = 'error';
            activeDownloads[id].error = e.message;
            broadcastUpdate();
        }
    }
}

// Cleanup old IndexedDB entries on startup
cleanupOldEntries().catch(e => Logger.error("Failed to cleanup old mux entries", e));


async function downloadBlobStrategy(video, id, pageTitle = 'video') {
     // Fetch as blob
     try {
        // Prepare headers (excluding Referer/Origin since DNR handles them, but Auth is needed)
        const headers = {};
        if (video.headers) {
             for (const [k,v] of Object.entries(video.headers)) {
                 if (!['host', 'connection', 'referer', 'origin', 'content-length', 'cookie'].includes(k.toLowerCase())) {
                     headers[k] = v;
                 }
             }
        }

        const response = await fetch(video.originalUrl || video.url, { headers });
        if (!response.ok) throw new Error(`Fetch status ${response.status}`);
        
        const blob = await response.blob();
        saveBlob(blob, `${pageTitle}.mp4`, id);

     } catch(e) {
         Logger.error("Blob download failed", e);
         if (activeDownloads[id]) {
             activeDownloads[id].status = 'error';
             activeDownloads[id].error = e.message;
         }
         broadcastUpdate();
     }
}

function saveBlob(blob, filename, id) {
    // Service Workers don't have URL.createObjectURL
    // Use FileReader to convert blob to data URL
    try {
        const reader = new FileReader();
        reader.onloadend = function() {
            const dataUrl = reader.result;
            chrome.downloads.download({
                url: dataUrl,
                filename: filename
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error("Save failed", chrome.runtime.lastError);
                    if (activeDownloads[id]) {
                        activeDownloads[id].status = 'error';
                        activeDownloads[id].error = chrome.runtime.lastError.message;
                    }
                } else {
                    if (activeDownloads[id]) {
                         // Check if we are in fallback error mode already?
                         if (activeDownloads[id].status !== 'complete_with_error') {
                             activeDownloads[id].status = 'complete';
                             activeDownloads[id].progress = 100;
                         }
                    }
                }
                broadcastUpdate();
            });
        };
        reader.onerror = function() {
            if (activeDownloads[id]) {
                activeDownloads[id].status = 'error';
                activeDownloads[id].error = 'FileReader error';
            }
            broadcastUpdate();
        };
        reader.readAsDataURL(blob);
    } catch(e) {
         if (activeDownloads[id]) {
             activeDownloads[id].status = 'error';
             activeDownloads[id].error = e.message;
         }
         broadcastUpdate();
    }
}

function broadcastUpdate() {
   chrome.runtime.sendMessage({ action: "downloadsUpdate", downloads: activeDownloads }).catch(() => {});
}
