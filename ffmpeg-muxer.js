// ffmpeg-muxer.js
// Uses FFmpeg.wasm to mux video and audio streams

let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoading = false;

// Load FFmpeg.wasm from CDN
async function loadFFmpeg(onProgress) {
    if (ffmpegLoaded && ffmpeg) {
        return ffmpeg;
    }
    
    if (ffmpegLoading) {
        // Wait for existing load
        while (ffmpegLoading) {
            await new Promise(r => setTimeout(r, 100));
        }
        return ffmpeg;
    }
    
    ffmpegLoading = true;
    
    try {
        // Import FFmpeg from CDN
        // Using the ESM version from unpkg
        const { FFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.7/dist/esm/index.js');
        const { fetchFile, toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
        
        ffmpeg = new FFmpeg();
        
        // Set up progress handler
        ffmpeg.on('progress', ({ progress }) => {
            if (onProgress) {
                onProgress(Math.round(progress * 100));
            }
        });
        
        ffmpeg.on('log', ({ message }) => {
            console.log('[FFmpeg]', message);
        });
        
        // Load FFmpeg core (this downloads ~25MB)
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        
        ffmpegLoaded = true;
        console.log('FFmpeg.wasm loaded successfully');
        
        // Store fetchFile for later use
        ffmpeg.fetchFile = fetchFile;
        
        return ffmpeg;
        
    } catch (e) {
        console.error('Failed to load FFmpeg.wasm:', e);
        throw new Error('Failed to load FFmpeg: ' + e.message);
    } finally {
        ffmpegLoading = false;
    }
}

// Mux video and audio blobs into a single MP4
export async function muxVideoAudio(videoBlob, audioBlob, onProgress) {
    console.log('Starting mux operation...');
    console.log('Video blob size:', videoBlob.size);
    console.log('Audio blob size:', audioBlob.size);
    
    // Load FFmpeg if not already loaded
    const ffmpegInstance = await loadFFmpeg((p) => {
        if (onProgress) onProgress(p);
    });
    
    try {
        // Write input files to FFmpeg's virtual filesystem
        const videoData = new Uint8Array(await videoBlob.arrayBuffer());
        const audioData = new Uint8Array(await audioBlob.arrayBuffer());
        
        await ffmpegInstance.writeFile('input_video.ts', videoData);
        await ffmpegInstance.writeFile('input_audio.ts', audioData);
        
        console.log('Files written to virtual FS, starting mux...');
        
        // Run FFmpeg command to mux
        // -c copy means no re-encoding, just remuxing (fast)
        await ffmpegInstance.exec([
            '-i', 'input_video.ts',
            '-i', 'input_audio.ts',
            '-c', 'copy',
            '-map', '0:v:0',  // Take video from first input
            '-map', '1:a:0',  // Take audio from second input
            'output.mp4'
        ]);
        
        console.log('Mux complete, reading output...');
        
        // Read the output file
        const outputData = await ffmpegInstance.readFile('output.mp4');
        
        // Clean up
        await ffmpegInstance.deleteFile('input_video.ts');
        await ffmpegInstance.deleteFile('input_audio.ts');
        await ffmpegInstance.deleteFile('output.mp4');
        
        // Return as Blob
        return new Blob([outputData], { type: 'video/mp4' });
        
    } catch (e) {
        console.error('Mux operation failed:', e);
        throw new Error('Mux failed: ' + e.message);
    }
}

// Check if FFmpeg is available
export function isFFmpegLoaded() {
    return ffmpegLoaded;
}
