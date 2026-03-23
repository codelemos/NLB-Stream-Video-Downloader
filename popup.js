
document.addEventListener('DOMContentLoaded', async () => {
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
    const sortedKeys = validKeys.sort((a,b) => {
        if (videos[b].isMaster && !videos[a].isMaster) return 1;
        if (!videos[b].isMaster && videos[a].isMaster) return -1;
        return (videos[b].timestamp || 0) - (videos[a].timestamp || 0);
    });

    if (sortedKeys.length === 0) {
        videoList.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 24px; margin-bottom: 8px;">📹</div>
                <div>Nenhum vídeo detectado ainda.</div>
                <div style="font-size: 11px; margin-top: 4px;">Reproduza um vídeo para iniciar a detecção.</div>
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
        } catch(e) {
            console.error("Error rendering item", e);
        }
    });
}

function createVideoCard(video, downloadState) {
    // Determine Type Text
    const type = video.type === 'm3u8' ? 'HLS' : 'MP4';
    const badgeClass = video.type === 'm3u8' ? 'hls' : 'mp4';
    
    // Create Title
    let title = 'Vídeo detectado';
    
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
        } catch(e) {}
    }
    
    // Cleanup title
    title = title.replace(/[-_]/g, ' ').replace(/\.mp4|\.m3u8/g, '');
    
    // Priority 3: Type fallback
    if (title === 'Vídeo detectado' || title === 'playlist' || title === 'master' || title === 'index') {
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
            statusText = `Baixando... ${progress}%`;
        } else if (downloadState.status === 'muxing') {
            isMuxing = true;
            const muxP = downloadState.muxProgress || 0;
            // Visual logic: Download (0-100) -> Muxing (Start)
            // Ideally we show Muxing as a distinct phase
            progress = muxP; 
            statusText = `Convertendo... ${muxP}%`;
        } else if (isComplete) {
            progress = 100;
            statusText = 'Salvo com sucesso.';
        } else if (downloadState.status === 'complete_with_error') {
            progress = 100;
            statusText = '⚠ Salvo como arquivos separados (Falha na conversão).';
            isError = true; // reusing error flag for visibility
        } else if (isError) {
            statusText = `Erro: ${downloadState.error}`;
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
                <button class="btn-download" ${isDownloading || isComplete ? 'disabled' : ''} title="${video.isMaster ? 'Melhor opção: contém áudio e vídeo' : 'Pode ser apenas um fragmento'}">
                    ${isComplete ? '<span>✓</span> Salvo' : (isDownloading ? '<span>⏳</span> Ocupado' : '<span>⬇</span> Baixar')}
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
        btn.innerHTML = '<span>⏳</span> Starting...';
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
                statusDiv.innerText = `Baixando stream... ${p}%`;
            
            } else if (data.status === 'muxing') {
                const mx = Math.round(data.muxProgress || 0);
                btn.disabled = true;
                btn.innerHTML = `<span>⚙</span> ${mx}%`;
                
                // Switch/Keep generic color or specific?
                fill.classList.add('muxing');
                fill.style.width = `${mx}%`;
                statusDiv.innerText = `Convertendo (Muxing)... ${mx}%`;

            } else if (data.status === 'complete') {
                btn.disabled = true;
                btn.innerHTML = '<span>✓</span> Saved';
                fill.style.width = '100%';
                fill.classList.remove('muxing');
                statusDiv.innerText = 'Download completo.';
                statusDiv.style.color = 'inherit';

            } else if (data.status === 'error') {
                btn.disabled = false;
                btn.innerHTML = '<span>↻</span> Retry';
                fill.style.width = '0%';
                statusDiv.innerText = `Erro: ${data.error}`;
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
        logsArea.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy to Clipboard', 1500);
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
