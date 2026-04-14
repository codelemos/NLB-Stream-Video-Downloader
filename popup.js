import { CONFIG } from './config.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Internationalize UI
    localizeUI();

    // Hide logs if not in dev
    const logsSection = document.getElementById('logs-section');
    if (CONFIG && CONFIG.ENV !== 'dev' && logsSection) {
        logsSection.style.display = 'none';
    }

    const tab = await getCurrentTab();
    if (!tab) return;

    // Refresh UI on load
    refreshUI(tab.id);

    // List for updates from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "downloadsUpdate") {
            updateDownloadStatus(msg.downloads);
        }
    });

    setupLogs();
});

async function getCurrentTab() {
    let queryOptions = { active: true, currentWindow: true };
    let [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}

function refreshUI(tabId) {
    chrome.runtime.sendMessage({ action: "getVideos", tabId: tabId }, (response) => {
        if (!response) return;
        renderVideoList(response.videos || {}, response.downloads || {}, tabId);
    });
}

function renderVideoList(videos, downloads, tabId) {
    const videoList = document.getElementById('video-list');
    videoList.innerHTML = '';

    // Sort: Master > Timestamp. Filter out incomplete objects.
    const validKeys = Object.keys(videos).filter(k => videos[k].url && videos[k].type);
    const sortedKeys = validKeys.sort((a, b) => {
        if (videos[b].isMaster && !videos[a].isMaster) return 1;
        if (!videos[b].isMaster && videos[a].isMaster) return -1;
        return (videos[b].timestamp || 0) - (videos[a].timestamp || 0);
    });

    if (sortedKeys.length === 0) {
        videoList.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 24px; margin-bottom: 8px;">📹</div>
                <div data-i18n="no_videos_found">${chrome.i18n.getMessage('empty_state_title')}</div>
                <div style="font-size: 11px; margin-top: 4px;" data-i18n="play_video_to_detect">${chrome.i18n.getMessage('empty_state_detail')}</div>
            </div>
        `;
        return;
    }

    // Smart Grouping & Filtering
    // 1. Separate HLS and MP4
    const hlsVideos = sortedKeys.filter(k => videos[k].type === 'm3u8');
    const mp4Videos = sortedKeys.filter(k => videos[k].type === 'mp4');

    // 2. Determine display list
    let displayKeys = [];

    // If we have HLS, we usually prefer it over generic MP4s
    if (hlsVideos.length > 0) {
        // If master exists, filter out non-master HLS to avoid confusion
        const masterPlaylists = hlsVideos.filter(k => videos[k].isMaster);
        if (masterPlaylists.length > 0) {
            displayKeys = [...masterPlaylists];
        } else {
            displayKeys = [...hlsVideos];
        }

        // Only show MP4s if they look "high quality" or distinct? 
        // For now, let's show them BUT maybe we can hide "detected video" MP4s if HLS exists?
        // Let's just append them for now but allow user to distinguish.
        // Actually, user complained about too many options.
        // Rule: If HLS exists, verify MP4s. If MP4 name is generic/unknown, hide it.

        mp4Videos.forEach(k => {
            const v = videos[k];
            // Check if URL contains indicative names
            if (v.pageTitle && v.url.includes(v.pageTitle)) {
                // Keep if looks like main video
                displayKeys.push(k);
            } else if (!v.url.includes('blob:')) {
                // Keep non-blobs?
                // Let's just add them but sort HLS first.
                displayKeys.push(k);
            }
        });
    } else {
        displayKeys = sortedKeys;
    }

    displayKeys.forEach(key => {
        const video = videos[key];
        try {
            // Filter fragments (Stricter)
            if (video.isFragment ||
                video.url?.includes('/range/') ||
                video.url?.includes('segment') ||
                video.url?.includes('frag') ||
                video.url?.includes('chunk') ||
                video.url?.includes('init') ||
                video.url?.match(/\.ts($|\?)/)) {
                return;
            }

            const card = createVideoCard(video, downloads[video.url]);
            videoList.appendChild(card);
        } catch (e) {
            console.error("Error rendering item", e);
        }
    });
}

function createVideoCard(video, downloadState) {
    // Determine Type Text
    const type = video.type === 'm3u8' ? 'HLS' : 'MP4';
    const badgeClass = video.type === 'm3u8' ? 'hls' : 'mp4';

    // Create Title
    let title = chrome.i18n.getMessage('video_detected');

    // Priority 1: Use Page Title if available (and sanitize it)
    if (video.pageTitle && video.pageTitle !== 'video') {
        title = video.pageTitle;
    }
    // Priority 2: URL Filename
    else {
        try {
            const urlObj = new URL(video.url);
            const path = urlObj.pathname.split('/').pop();
            if (path && path.length > 3 && !path.startsWith('seg') && !path.startsWith('frag')) {
                title = decodeURIComponent(path).split('.')[0];
            }
        } catch (e) { }
    }

    // Cleanup title
    title = title.replace(/[-_]/g, ' ').replace(/\.mp4|\.m3u8/g, '');

    // Priority 3: Type fallback
    if (title === chrome.i18n.getMessage('video_detected') || title === 'playlist' || title === 'master' || title === 'index') {
        if (video.pageTitle) title = video.pageTitle; // Fallback again
    }

    // Formatting title
    if (title.length > 40) title = title.substring(0, 40) + '...';

    const li = document.createElement('li');
    li.className = 'video-card';
    li.dataset.url = video.url;

    // Determine Status
    const isDownloading = downloadState && (downloadState.status === 'downloading' || downloadState.status === 'muxing');
    const isComplete = downloadState && downloadState.status === 'complete';
    let isError = downloadState && downloadState.status === 'error';

    // Initial Progress
    let progress = 0;
    let isMuxing = false;
    let statusText = '';

    if (downloadState) {
        if (downloadState.status === 'downloading') {
            progress = Math.round(downloadState.progress || 0);
            statusText = chrome.i18n.getMessage('status_downloading', [progress]);
        } else if (downloadState.status === 'muxing') {
            isMuxing = true;
            const muxP = downloadState.muxProgress || 0;
            // Visual logic: Download (0-100) -> Muxing (Start)
            // Ideally we show Muxing as a distinct phase
            progress = muxP;
            statusText = chrome.i18n.getMessage('status_converting', [muxP]);
        } else if (isComplete) {
            progress = 100;
            statusText = chrome.i18n.getMessage('saved_successfully');
        } else if (downloadState.status === 'complete_with_error') {
            progress = 100;
            statusText = chrome.i18n.getMessage('saved_fallback');
            isError = true; // reusing error flag for visibility
        } else if (isError) {
            statusText = chrome.i18n.getMessage('error_status', [downloadState.error]);
        }
    }

    li.innerHTML = `
        <div class="card-content">
            <div class="thumbnail-area">
                <span class="thumbnail-icon">🎬</span>
            </div>
            <div class="info-area">
                <div>
                    <div class="video-title" title="${video.url}">${title}</div>
                    <div class="meta-row">
                        <span class="badge ${badgeClass}">${type}</span>
                        ${video.isMaster ? '<span class="badge" style="background:#dff6dd;color:#107c10;border:1px solid #bcebd5">COMPLETO</span>' : ''}
                        <!-- <span class="badge" style="background:#f3f2f1;color:#605e5c">HD</span> -->
                    </div>
                </div>
            </div>
            <div class="action-row">
                <button class="btn-download" ${isDownloading || isComplete ? 'disabled' : ''} title="${video.isMaster ? chrome.i18n.getMessage('best_quality_hint') : chrome.i18n.getMessage('fragment_warning')}">
                    ${isComplete ? '<span>✓</span> ' + chrome.i18n.getMessage('saved_btn') : (isDownloading ? '<span>⏳</span> ' + chrome.i18n.getMessage('busy_btn') : '<span>⬇</span> ' + chrome.i18n.getMessage('download_btn'))}
                </button>
            </div>
        </div>
        
        <div class="progress-area">
            <div class="progress-fill ${isMuxing ? 'muxing' : ''}" style="width: ${isDownloading || isComplete ? progress : 0}%"></div>
        </div>
        
        <div class="status-text ${isDownloading || isComplete || isError || downloadState?.status === 'complete_with_error' ? 'visible' : ''} ${downloadState?.status === 'complete_with_error' ? 'warning' : ''}" style="color: ${isError && downloadState?.status !== 'complete_with_error' ? '#d83b01' : 'inherit'}">
            ${statusText} ${downloadState?.status === 'complete_with_error' ? '<br><small>' + (downloadState.error || '') + '</small>' : ''}
        </div>
    `;

    // Attach Event
    const btn = li.querySelector('.btn-download');
    btn.onclick = () => {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> ' + chrome.i18n.getMessage('starting');
        chrome.runtime.sendMessage({ action: "startDownload", video: video });
    };

    return li;
}

function updateDownloadStatus(downloads) {
    Object.keys(downloads).forEach(url => {
        const card = document.querySelector(`li[data-url="${url}"]`);
        if (card) {
            const data = downloads[url];
            const btn = card.querySelector('.btn-download');
            const fill = card.querySelector('.progress-fill');
            const statusDiv = card.querySelector('.status-text');

            statusDiv.classList.add('visible');

            if (data.status === 'downloading') {
                const p = Math.round(data.progress || 0);
                btn.disabled = true;
                btn.innerHTML = `<span>⬇</span> ${p}%`;
                fill.style.width = `${p}%`;
                fill.classList.remove('muxing');
                statusDiv.innerText = chrome.i18n.getMessage('status_downloading_stream', [p]);

            } else if (data.status === 'muxing') {
                const mx = Math.round(data.muxProgress || 0);
                btn.disabled = true;
                btn.innerHTML = `<span>⚙</span> ${mx}%`;

                // Switch/Keep generic color or specific?
                fill.classList.add('muxing');
                fill.style.width = `${mx}%`;
                statusDiv.innerText = chrome.i18n.getMessage('status_muxing', [mx]);

            } else if (data.status === 'complete') {
                btn.disabled = true;
                btn.innerHTML = '<span>✓</span> ' + chrome.i18n.getMessage('saved_btn');
                fill.style.width = '100%';
                fill.classList.remove('muxing');
                statusDiv.innerText = chrome.i18n.getMessage('download_complete');
                statusDiv.style.color = 'inherit';

            } else if (data.status === 'error') {
                btn.disabled = false;
                btn.innerHTML = '<span>↻</span> ' + chrome.i18n.getMessage('retry');
                fill.style.width = '0%';
                statusDiv.innerText = chrome.i18n.getMessage('error_status', [data.error]);
                statusDiv.style.color = '#d83b01';
            }
        }
    });
}

function setupLogs() {
    const logsHeader = document.getElementById('toggle-logs');
    const logsArea = document.getElementById('logs-area');
    const copyBtn = document.getElementById('copy-logs');
    const logsContainer = document.querySelector('.logs-container');

    logsHeader.addEventListener('click', () => {
        logsContainer.classList.toggle('show-logs');
        if (logsContainer.classList.contains('show-logs')) {
            fetchLogs(logsArea);
        }
    });

    copyBtn.addEventListener('click', async () => {
        await fetchLogs(logsArea);
        const textToCopy = logsArea.value;

        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(textToCopy);
                copyBtn.textContent = chrome.i18n.getMessage('copied');
            } else {
                throw new Error('Clipboard API unavailable');
            }
        } catch (err) {
            // Fallback: Using select and execCommand
            logsArea.select();
            document.execCommand('copy');
            copyBtn.textContent = chrome.i18n.getMessage('copied');
        }

        setTimeout(() => copyBtn.textContent = chrome.i18n.getMessage('copy_to_clipboard'), 1500);
    });
}

function localizeUI() {
    // Localize simple text elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(key);
        if (message) el.innerText = message;
    });

    // Localize placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const message = chrome.i18n.getMessage(key);
        if (message) el.placeholder = message;
    });
}

function fetchLogs(area) {
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ action: "getLogs" }, (response) => {
            if (response && response.logs) {
                area.value = response.logs;
            }
            resolve();
        });
    });
}
