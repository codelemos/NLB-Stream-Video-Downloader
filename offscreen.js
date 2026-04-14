// offscreen.js - Runs FFmpeg.wasm for muxing (using LOCAL bundled files)
// Uses IndexedDB to handle large files that exceed Chrome's message size limit

import { getMuxData, storeMuxResult, deleteMuxData } from './mux-storage.js';

let ffmpeg = null;
let ffmpegLoaded = false;
let currentRequestId = null;

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'mux') {
        handleMux(message.requestId);
        sendResponse({ status: 'started' });
    }
    // No 'return true' here as we respond synchronously with {status: 'started'}
});

async function handleMux(requestId) {
    try {
        console.log('[Offscreen] Starting mux operation for request:', requestId);
        currentRequestId = requestId;
        
        // Load FFmpeg if needed
        if (!ffmpegLoaded) {
            await loadFFmpeg();
        }
        
        // Retrieve data from IndexedDB (avoids message size limits)
        console.log('[Offscreen] Retrieving data from IndexedDB...');
        const muxData = await getMuxData(requestId);
        
        if (!muxData || !muxData.videoData) {
            throw new Error('Mux data not found in IndexedDB (video data missing)');
        }
        
        console.log('[Offscreen] Video size:', muxData.videoData.size, 'Audio size:', muxData.audioData ? muxData.audioData.size : 0);
        
        console.log('[Offscreen] Reading blobs into memory...');
        const videoData = new Uint8Array(await muxData.videoData.arrayBuffer());

        console.log('[Offscreen] Writing video file to virtual FS...');
        await ffmpeg.writeFile('input_video.ts', videoData);
        
        let execArgs = ['-i', 'input_video.ts'];

        if (muxData.audioData) {
            const audioData = new Uint8Array(await muxData.audioData.arrayBuffer());
            console.log('[Offscreen] Writing audio file to virtual FS...');
            await ffmpeg.writeFile('input_audio.ts', audioData);
            
            execArgs.push('-i', 'input_audio.ts');
            execArgs.push('-c', 'copy');
            execArgs.push('-map', '0:v:0');
            execArgs.push('-map', '1:a:0');
        } else {
            execArgs.push('-c', 'copy');
            // If the input is already a fully muxed TS or concatenated fMP4, just copy and let FFmpeg rebuild MP4 headers.
        }
        
        execArgs.push('output.mp4');
        
        console.log('[Offscreen] Running FFmpeg...');
        
        // Run FFmpeg
        await ffmpeg.exec(execArgs);
        
        console.log('[Offscreen] Reading output...');
        // Read output
        const outputData = await ffmpeg.readFile('output.mp4');
        
        console.log('[Offscreen] Mux complete, output size:', outputData.length);
        
        // Store result in IndexedDB (avoids message size limits)
        await storeMuxResult(requestId, outputData);
        
        // Send completion notification (small message, no data)
        chrome.runtime.sendMessage({
            action: 'muxComplete',
            requestId: requestId,
            success: true
        });
        
    } catch (e) {
        console.error('[Offscreen] Mux failed:', e);
        chrome.runtime.sendMessage({
            action: 'muxComplete',
            requestId: requestId,
            success: false,
            error: e.message || e.toString()
        }).catch(() => {});
    } finally {
        currentRequestId = null;
        // Cleanup FFmpeg resources
        try {
            if (ffmpeg) {
                await ffmpeg.deleteFile('input_video.ts').catch(() => {});
                // Use a local check or safer retrieval since muxData might be out of scope 
                // but we only need to delete if they were written
                await ffmpeg.deleteFile('input_audio.ts').catch(() => {});
                await ffmpeg.deleteFile('output.mp4').catch(() => {});
            }
        } catch (cleanupErr) {
            console.warn('[Offscreen] Cleanup warning:', cleanupErr);
        }
    }
}

async function loadFFmpeg() {
    console.log('[Offscreen] Loading FFmpeg.wasm from local files...');
    
    try {
        // Import FFmpeg class from local bundled files
        const { FFmpeg } = await import(chrome.runtime.getURL('ffmpeg-core/index.js'));
        
        ffmpeg = new FFmpeg();
        
        ffmpeg.on('log', ({ message }) => {
            console.log('[FFmpeg]', message);
            if (currentRequestId) {
                chrome.runtime.sendMessage({
                    action: 'muxLog',
                    requestId: currentRequestId,
                    message: message
                }).catch(() => {}); // Ignore errors if popup closed
            }
        });
        
        ffmpeg.on('progress', ({ progress }) => {
            const pct = Math.round(progress * 100);
            
            if (currentRequestId) {
                chrome.runtime.sendMessage({
                    action: 'muxProgress',
                    requestId: currentRequestId,
                    progress: pct
                }).catch(() => {});
            }
        });
        
        // Load with absolute URLs to the bundled files
        const coreURL = chrome.runtime.getURL('ffmpeg-core/ffmpeg-core.js');
        const wasmURL = chrome.runtime.getURL('ffmpeg-core/ffmpeg-core.wasm');
        
        console.log('[Offscreen] Core URL:', coreURL);
        console.log('[Offscreen] WASM URL:', wasmURL);
        
        await ffmpeg.load({
            coreURL: coreURL,
            wasmURL: wasmURL,
        });
        
        ffmpegLoaded = true;
        console.log('[Offscreen] FFmpeg loaded successfully!');
        
    } catch (e) {
        console.error('[Offscreen] Failed to load FFmpeg:', e);
        throw new Error('FFmpeg load failed: ' + (e.message || e.toString()));
    }
}

console.log('[Offscreen] Ready');
