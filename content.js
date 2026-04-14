// content.js
console.log('Video Downloader Content Script Active');

// Function to scan not just video tags but also internal player configs often found in page scripts
function scanForVideos() {
    const videos = [];

    // 1. Check direct video tags
    document.querySelectorAll('video').forEach(v => {
        if (v.src && v.src.startsWith('http')) {
            videos.push({ url: v.src, type: 'video_tag' });
        }
        // Check sources inside video
        v.querySelectorAll('source').forEach(s => {
            if (s.src && s.src.startsWith('http')) {
                videos.push({ url: s.src, type: 'source_tag' });
            }
        });
    });

    // 2. Check Performance API for m3u8/mp4 requests that might have been missed
    // (This helps find resources loaded before the extension was active)
    const entries = performance.getEntriesByType('resource');
    entries.forEach(entry => {
        const url = entry.name;
        if (url.includes('.m3u8') || (url.includes('.mp4') && !url.includes('segment') && !url.includes('range'))) {
            videos.push({ url: url, type: 'network_history' });
        }
    });

    return videos;
}

// Send found videos to background
function reportVideos() {
    const found = scanForVideos();
    if (found.length > 0) {
        chrome.runtime.sendMessage({ action: "foundVideos", videos: found });
    }
}

// Scan on load and periodically
setTimeout(reportVideos, 2000);
setTimeout(reportVideos, 5000);
setInterval(reportVideos, 10000);

// GitHub Badge (Always show)
function checkAndInjectBadge(retries = 3) {
    chrome.runtime.sendMessage({ action: 'getConfig' }, (response) => {
        if (chrome.runtime.lastError) {
            if (retries > 0) {
                setTimeout(() => checkAndInjectBadge(retries - 1), 1000);
            }
            return;
        }
        
        // Inject always as requested
        injectGithubBadge();
    });
}

// Try to inject as soon as content script runs
checkAndInjectBadge();

function injectGithubBadge() {
    // Check if we are in an iframe (optional: only show in top frame)
    if (window.self !== window.top) return;

    // Avoid double injection
    if (document.getElementById('nlb-github-badge')) return;

    const badge = document.createElement('a');
    badge.href = "https://github.com/codelemos/NLB-Stream-Video-Downloader";
    badge.target = "_blank";
    badge.id = "nlb-github-badge";
    badge.title = chrome.i18n.getMessage("star_on_github") || "Star on GitHub";

    const iconUrl = chrome.runtime.getURL('icons/github.png');
    badge.innerHTML = `<img src="${iconUrl}" id="github-logo" style="width: 24px !important; height: 24px !important; display: block !important; border: none !important; background: transparent !important; opacity: 1 !important; visibility: visible !important; margin: 0 !important; padding: 0 !important;">`;

    Object.assign(badge.style, {
        position: 'fixed',
        bottom: '20px',
        right: '25px',
        width: '42px',
        height: '42px',
        backgroundColor: 'white',
        borderRadius: '50%',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '2147483647',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        textDecoration: 'none',
        border: '1px solid rgba(0,0,0,0.05)',
        visibility: 'visible',
        opacity: '1'
    });

    badge.onmouseover = () => {
        badge.style.setProperty('transform', 'scale(1.15) translateY(-2px)', 'important');
        badge.style.setProperty('boxShadow', '0 6px 16px rgba(0,0,0,0.2)', 'important');
    };
    badge.onmouseout = () => {
        badge.style.setProperty('transform', 'scale(1) translateY(0)', 'important');
        badge.style.setProperty('boxShadow', '0 4px 12px rgba(0,0,0,0.15)', 'important');
    };

    // Use document.body if available, otherwise documentElement
    const container = document.body || document.documentElement;
    if (container) {
        container.appendChild(badge);
    } else {
        // Fallback for very early scripts
        window.addEventListener('DOMContentLoaded', () => {
            (document.body || document.documentElement).appendChild(badge);
        });
    }
}

// Also listen for manual trigger
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "scanPage") {
        reportVideos();
        sendResponse({ count: 1 });
    }
});
