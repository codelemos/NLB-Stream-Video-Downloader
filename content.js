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

// Also listen for manual trigger
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "scanPage") {
        reportVideos();
        sendResponse({ count: 1 });
    }
});
