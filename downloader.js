
// downloader.js

function hexToBuffer(hex) {
    if (typeof hex !== 'string') return new Uint8Array(0).buffer;
    // Remove 0x prefix if present
    if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2);
    
    // Pad if odd length
    if (hex.length % 2 !== 0) hex = '0' + hex;
    
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes.buffer;
}

function strToBuffer(str) {
    return new TextEncoder().encode(str);
}


export class HLSDownloader {
  constructor(url, options = {}, onProgress) {
    this.url = url;
    this.headers = options.headers || {};
    this.onProgress = onProgress;
    this.baseUrl = url; 
  }

  async start() {
    try {
      const manifest = await this.fetchText(this.url);
      
      if (manifest.includes('#EXT-X-STREAM-INF')) {
        // Master playlist - select highest quality and detect audio
        const { videoUrl, audioUrl } = this.parseMasterPlaylist(manifest);
        console.log("Master playlist detected. Video:", videoUrl, "Audio:", audioUrl);
        
        // Download video segments
        const videoDownloader = new HLSDownloader(videoUrl, { headers: this.headers }, (p) => {
            if (this.onProgress) this.onProgress(audioUrl ? p * 0.5 : p); // Video is 50% if audio exists
        });
        const videoBlob = await videoDownloader.downloadSegments();
        
        // Download audio segments if available
        let audioBlob = null;
        if (audioUrl) {
            console.log("Downloading audio track...");
            const audioDownloader = new HLSDownloader(audioUrl, { headers: this.headers }, (p) => {
                if (this.onProgress) this.onProgress(50 + p * 0.5); // Audio is other 50%
            });
            try {
                audioBlob = await audioDownloader.downloadSegments();
            } catch (e) {
                console.warn("Audio download failed, continuing with video only:", e.message);
            }
        }
        
        // Return both blobs for separate saving
        if (audioBlob) {
            return { 
                videoBlob: videoBlob, 
                audioBlob: audioBlob,
                hasSeparateAudio: true 
            };
        } else {
            return videoBlob;
        }
      }

      // Not a master playlist, just download segments directly
      return this.downloadSegments();

    } catch (e) {
      console.error("Download failed", e);
      throw e;
    }
  }
  
  // New method: download segments from a media playlist
  async downloadSegments() {
    const manifest = await this.fetchText(this.url);
    
    // Check for Encryption
    let keyData = null;
    let keyIV = null;

    const keyMatch = manifest.match(/#EXT-X-KEY:METHOD=([^,]+),URI="([^"]+)"(?:,IV=([^,\s]+))?/);
    if (keyMatch) {
       const method = keyMatch[1];
       const keyUri = keyMatch[2];
       const ivHex = keyMatch[3];

       if (method === 'AES-128') {
           console.log("Detected AES-128 Encryption. Fetching key...", keyUri);
           const resolvedKeyUrl = this.resolveUrl(keyUri);
           
           try {
              const keyResp = await this.fetchWithRetry(resolvedKeyUrl, 'arrayBuffer');
              keyData = keyResp;
              
              if (ivHex) {
                  keyIV = hexToBuffer(ivHex);
              }
           } catch(e) {
               console.error("Failed to fetch key", e);
               throw new Error("Failed to fetch decryption key: " + e.message);
           }
       } else if (method !== 'NONE') {
           console.warn("Unsupported encryption method:", method);
       }
    }

    const segments = this.parseMediaPlaylist(manifest);
    if (segments.length === 0) {
      throw new Error("No segments found");
    }

    const blobs = [];
    let downloaded = 0;
    const total = segments.length;

    for (let i = 0; i < segments.length; i++) {
      const segmentUrl = segments[i];
      let buffer = await this.fetchWithRetry(segmentUrl, 'arrayBuffer');
      
      // Decrypt if needed
      if (keyData) {
          try {
              let iv = keyIV;
              if (!iv) {
                  const seq = i;
                  const ivBuffer = new ArrayBuffer(16);
                  new DataView(ivBuffer).setUint32(12, seq, false);
                  iv = ivBuffer;
              }

              const algorithm = { name: 'AES-CBC', iv: iv };
              const key = await crypto.subtle.importKey('raw', keyData, algorithm, false, ['decrypt']);
              buffer = await crypto.subtle.decrypt(algorithm, key, buffer);
          
          } catch(e) {
              console.error("Decryption error", e);
          }
      }

      blobs.push(new Blob([buffer]));
      downloaded++;
      if (this.onProgress) {
          this.onProgress((downloaded / total) * 100);
      }
    }

    return new Blob(blobs, { type: 'video/mp2t' }); // TS container
  }

  async fetchText(url) {
    return this.fetchWithRetry(url, 'text');
  }

  async fetchBlob(url) {
    return this.fetchWithRetry(url, 'blob');
  }

  async fetchWithRetry(url, type, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const options = {
                // method: 'GET', // default
                // headers: this.headers // Pass captured headers (e.g. Auth)
            };
            
            // Only add headers if they are safe or if we are in environment that supports it.
            // In Extension Background + <all_urls>, we might be able to set some.
            // But Authorization is key.
             if (this.headers && Object.keys(this.headers).length > 0) {
                 options.headers = {};
                 // filtering unsafe?
                 for (const [k,v] of Object.entries(this.headers)) {
                     if (!['host', 'connection', 'referer', 'content-length'].includes(k.toLowerCase())) {
                         options.headers[k] = v;
                     }
                 }
             }

            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`Status ${response.status}`);
            return await response[type]();
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000)); // wait 1s
        }
    }
  }

  resolveUrl(relativeUrl) {
    try {
        return new URL(relativeUrl, this.url).href;
    } catch (e) {
        // Fallback for some malformed inputs
        if (relativeUrl.startsWith('http')) return relativeUrl;
        const base = this.url.substring(0, this.url.lastIndexOf('/') + 1);
        return base + relativeUrl;
    }
  }

  parseMasterPlaylist(manifest) {
    const lines = manifest.split('\n');
    let bestVideoUrl = null;
    let maxBandwidth = 0;
    let audioUrl = null;
    
    // Log full manifest for debugging
    console.log("=== MASTER PLAYLIST CONTENT ===");
    console.log(manifest);
    console.log("=== END MANIFEST ===");
    
    // First pass: find audio tracks (#EXT-X-MEDIA:TYPE=AUDIO)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-MEDIA') && line.includes('TYPE=AUDIO')) {
            const uriMatch = line.match(/URI="([^"]+)"/);
            if (uriMatch) {
                audioUrl = this.resolveUrl(uriMatch[1]);
                console.log("Found audio track (standard):", audioUrl);
            }
        }
    }
    
    // Second pass: find best video stream (#EXT-X-STREAM-INF)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
            const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
            
            let nextLine = lines[i+1]?.trim();
            if (nextLine && !nextLine.startsWith('#')) {
                if (bandwidth >= maxBandwidth) {
                    maxBandwidth = bandwidth;
                    bestVideoUrl = this.resolveUrl(nextLine);
                }
            }
        }
    }
    
    // Vimeo-specific: Try to find audio from manifest structure
    // Vimeo often has separate playlists like:
    // video: /sep/video/.../playlist.m3u8
    // audio: /sep/audio/.../playlist.m3u8
    // Or combined: /av/.../media.m3u8 (already has audio+video muxed)
    if (!audioUrl && bestVideoUrl) {
        // Check if this looks like a Vimeo URL
        if (bestVideoUrl.includes('vimeocdn.com')) {
            console.log("Vimeo detected. Checking for separate audio...");
            
            // If the video URL contains "/sep/video/", there might be a "/sep/audio/"
            if (bestVideoUrl.includes('/sep/video/')) {
                const potentialAudioUrl = bestVideoUrl.replace('/sep/video/', '/sep/audio/');
                console.log("Trying Vimeo audio URL:", potentialAudioUrl);
                audioUrl = potentialAudioUrl;
            }
            // For /av/ paths, the audio might be in the same stream (muxed)
            // Or there might be a parallel audio-only path
            else if (bestVideoUrl.includes('/avf/')) {
                // Try replacing /avf/ with /aaf/ (audio fragment?)
                const potentialAudioUrl = bestVideoUrl.replace('/avf/', '/aaf/');
                if (potentialAudioUrl !== bestVideoUrl) {
                    console.log("Trying Vimeo audio URL (aaf):", potentialAudioUrl);
                    audioUrl = potentialAudioUrl;
                }
            }
        }
    }
    
    // Fallback if no BANDWIDTH found
    if (!bestVideoUrl) {
         for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#') || line === '') continue;
            bestVideoUrl = this.resolveUrl(line);
        }
    }
    
    if (!bestVideoUrl) throw new Error("Could not parse master playlist");
    
    console.log("Final video URL:", bestVideoUrl);
    console.log("Final audio URL:", audioUrl);
    
    return { videoUrl: bestVideoUrl, audioUrl: audioUrl };
  }

  parseMediaPlaylist(manifest) {
    const lines = manifest.split('\n');
    const segments = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-MAP')) {
            const uriMatch = line.match(/URI="([^"]+)"/);
            if (uriMatch) {
                segments.push(this.resolveUrl(uriMatch[1]));
            }
        }
        if (line.startsWith('#') || line === '') continue;
        segments.push(this.resolveUrl(line));
    }
    return segments;
  }
}

