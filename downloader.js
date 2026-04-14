
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
        const logger = (typeof globalThis !== 'undefined' && globalThis.Logger) ? globalThis.Logger : { log: console.log, error: console.error };

        try {
            logger.log(`[HLS] Iniciando processo para: ${this.url.substring(0, 60)}...`);
            const content = await this.fetchText(this.url);

            // [VIMEO FIX] JSON Manifest Detection
            if (content.trim().startsWith('{')) {
                try {
                    const data = JSON.parse(content);
                    logger.log("[VIMEO] Detectado manifesto JSON. Extraindo URL HLS...");

                    let nextUrl = null;

                    // Case 1: streams array (standard DASH/JSON hybrid)
                    if (data.streams && Array.isArray(data.streams)) {
                        const best = data.streams.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
                        if (best && best.url) nextUrl = best.url;
                    }
                    // Case 2: Vimeo VOD config format
                    else if (data.request && data.request.files && data.request.files.hls) {
                        const hls = data.request.files.hls;
                        const cdn = hls.default_cdn || Object.keys(hls.cdns)[0];
                        if (hls.cdns[cdn] && hls.cdns[cdn].url) nextUrl = hls.cdns[cdn].url;
                    }
                    
                    // Case 3: Vimeo Direct Segment List (clip_id, video, audio)
                    if (!nextUrl && data.video && Array.isArray(data.video)) {
                        logger.log("[VIMEO] Detectado manifesto de segmentos diretos. Analisando fluxos...");
                        const result = await this.downloadVimeoDirectSegments(data);
                        return result;
                    }

                    // Case 4: Recursive search for any .m3u8 link in the JSON (Last resort)
                    if (!nextUrl) {
                        logger.log("[VIMEO] Formato padrão não encontrado. Fazendo varredura profunda no JSON...");
                        const findM3U8 = (obj) => {
                            if (!obj || typeof obj !== 'object') return null;
                            for (const k in obj) {
                                if (typeof obj[k] === 'string' && obj[k].includes('.m3u8')) return obj[k];
                                const found = findM3U8(obj[k]);
                                if (found) return found;
                            }
                            return null;
                        };
                        nextUrl = findM3U8(data);
                    }

                    if (nextUrl) {
                        const resolved = this.resolveUrl(nextUrl);
                        logger.log("[VIMEO] URL HLS redirecionada: " + resolved.substring(0, 60));
                        this.url = resolved;
                        return this.start();
                    } else {
                        logger.error("[VIMEO] Não foi possível encontrar uma URL de vídeo no JSON.");
                        logger.log("[VIMEO] Chaves disponíveis no JSON: " + Object.keys(data).join(', '));
                        throw new Error("Formato JSON do Vimeo não suportado ou link expirado.");
                    }
                } catch (e) {
                    logger.error("[VIMEO] Erro no JSON:", e.message);
                    throw e; // Abort instead of falling through to '1 parts' error
                }
            }

            const manifest = content;

            if (manifest.includes('#EXT-X-STREAM-INF')) {
                const { videoUrl, audioUrl } = this.parseMasterPlaylist(manifest);
                logger.log(`[HLS] Master Playlist detectada. Vídeo: ${videoUrl.substring(0, 40)}`);

                // Download video segments
                const videoDownloader = new HLSDownloader(videoUrl, { headers: this.headers }, (p) => {
                    if (this.onProgress) this.onProgress(audioUrl ? p * 0.5 : p);
                });
                const videoBlob = await videoDownloader.downloadSegments();

                // Download audio segments if available
                let audioBlob = null;
                if (audioUrl) {
                    logger.log("[HLS] Baixando trilha de áudio separada...");
                    const audioDownloader = new HLSDownloader(audioUrl, { headers: this.headers }, (p) => {
                        if (this.onProgress) this.onProgress(50 + p * 0.5);
                    });
                    try {
                        audioBlob = await audioDownloader.downloadSegments();
                    } catch (e) {
                        logger.error("[HLS] Falha no áudio:", e.message);
                    }
                }

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

            return this.downloadSegments();

        } catch (e) {
            logger.error("[HLS] Download abortado:", e.message);
            throw e;
        }
    }

    async downloadSegments() {
        const logger = (typeof globalThis !== 'undefined' && globalThis.Logger) ? globalThis.Logger : { log: console.log, error: console.error };

        logger.log(`[HLS] Baixando segmentos de: ${this.url.substring(0, 50)}...`);
        const manifest = await this.fetchText(this.url);

        // Encryption support logic remains same...
        let keyData = null;
        let keyIV = null;
        const keyMatch = manifest.match(/#EXT-X-KEY:METHOD=([^,]+),URI="([^"]+)"(?:,IV=([^,\s]+))?/);
        if (keyMatch) {
            const method = keyMatch[1];
            const keyUri = keyMatch[2];
            if (method === 'AES-128') {
                logger.log("[HLS] Chave AES-128 detectada. Desencriptando...");
                const resolvedKeyUrl = this.resolveUrl(keyUri);
                try { keyData = await this.fetchWithRetry(resolvedKeyUrl, 'arrayBuffer'); } catch (e) { throw new Error("Erro na chave: " + e.message); }
                if (keyMatch[3]) keyIV = hexToBuffer(keyMatch[3]);
            }
        }

        const segments = this.parseMediaPlaylist(manifest);
        if (segments.length === 0) throw new Error("Nenhum segmento encontrado.");

        logger.log(`[HLS] Iniciando download de ${segments.length} partes.`);

        const blobs = [];
        let downloaded = 0;
        const total = segments.length;

        for (let i = 0; i < segments.length; i++) {
            try {
                const segmentUrl = segments[i];
                let buffer = await this.fetchWithRetry(segmentUrl, 'arrayBuffer');

                if (keyData) {
                    const iv = keyIV || (() => { const b = new ArrayBuffer(16); new DataView(b).setUint32(12, i, false); return b; })();
                    const algorithm = { name: 'AES-CBC', iv: iv };
                    const key = await crypto.subtle.importKey('raw', keyData, algorithm, false, ['decrypt']);
                    buffer = await crypto.subtle.decrypt(algorithm, key, buffer);
                }

                blobs.push(new Blob([buffer]));
                downloaded++;

                if (this.onProgress) this.onProgress((downloaded / total) * 100);

                if (downloaded % 10 === 0 || downloaded === total) {
                    logger.log(`[HLS] Progresso: ${downloaded}/${total} partes.`);
                }
            } catch (e) {
                logger.error(`[HLS] Falha no segmento ${i}: ${e.message}`);
                // Decide if continue or abort. Most streams can handle one missing fragment, but let's be strict for now.
                throw e;
            }
        }

        return new Blob(blobs, { type: 'video/mp2t' });
    }

    async fetchText(url) { return this.fetchWithRetry(url, 'text'); }
    async fetchBlob(url) { return this.fetchWithRetry(url, 'blob'); }

    async fetchWithRetry(url, type, retries = 3) {
        const logger = (typeof globalThis !== 'undefined' && globalThis.Logger) ? globalThis.Logger : { log: console.log, error: console.error };
        for (let i = 0; i < retries; i++) {
            try {
                const options = { headers: {} };
                if (this.headers) {
                    for (const [k, v] of Object.entries(this.headers)) {
                        if (!['host', 'connection', 'referer', 'content-length'].includes(k.toLowerCase())) {
                            options.headers[k] = v;
                        }
                    }
                }

                const response = await fetch(url, options);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response[type]();
            } catch (e) {
                if (i === retries - 1) {
                    logger.error(`[HLS] Falha definitiva na URL: ${url.substring(0, 50)}...`);
                    throw e;
                }
                await new Promise(r => setTimeout(r, 1000));
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

    // Specialized method for Vimeo segment lists
    async downloadVimeoDirectSegments(data) {
        const logger = (typeof globalThis !== 'undefined' && globalThis.Logger) ? globalThis.Logger : { log: console.log, error: console.error };

        // 1. Process Video
        const videoStream = data.video.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        if (!videoStream) throw new Error("Nenhum fluxo de vídeo encontrado no JSON.");

        const globalBaseUrl = data.base_url || "";
        const videoBaseUrl = this.resolveRelativePath(this.url, globalBaseUrl + (videoStream.base_url || ""));
        const videoSegments = this.reconstructVimeoSegmentUrls(videoBaseUrl, videoStream);

        logger.log(`[VIMEO] Reconstruído fluxo de vídeo: ${videoSegments.length} segmentos.`);

        // 2. Process Audio (optional)
        let audioBlob = null;
        if (data.audio && Array.isArray(data.audio) && data.audio.length > 0) {
            const audioStream = data.audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            const audioBaseUrl = this.resolveRelativePath(this.url, globalBaseUrl + (audioStream.base_url || ""));
            const audioSegments = this.reconstructVimeoSegmentUrls(audioBaseUrl, audioStream);

            logger.log(`[VIMEO] Reconstruído fluxo de áudio: ${audioSegments.length} segmentos.`);

            // Manual Progress tracking for split download
            const onVideoProgress = (p) => { if (this.onProgress) this.onProgress(p * 0.5); };
            const onAudioProgress = (p) => { if (this.onProgress) this.onProgress(50 + p * 0.5); };

            const vDownloader = new HLSDownloader(this.url, { headers: this.headers }, onVideoProgress);
            const aDownloader = new HLSDownloader(this.url, { headers: this.headers }, onAudioProgress);

            const vBlob = await vDownloader.downloadSegmentList(videoSegments, videoStream.init_segment);
            try {
                audioBlob = await aDownloader.downloadSegmentList(audioSegments, audioStream.init_segment);
            } catch (e) {
                logger.error("[VIMEO] Falha ao baixar áudio:", e.message);
            }

            return {
                videoBlob: vBlob,
                audioBlob: audioBlob,
                hasSeparateAudio: !!audioBlob
            };
        } else {
            const vDownloader = new HLSDownloader(this.url, { headers: this.headers }, this.onProgress);
            return await vDownloader.downloadSegmentList(videoSegments, videoStream.init_segment);
        }
    }

    reconstructVimeoSegmentUrls(baseUrl, stream) {
        if (!stream.segments) return [];
        return stream.segments.map(seg => {
            const url = seg.url || "";
            if (url.startsWith('http')) return url;
            // Clean base URL and join with segment
            let cleanBase = baseUrl;
            if (!cleanBase.endsWith('/')) cleanBase += '/';
            return cleanBase + url;
        });
    }

    // Utility to resolve path relative to a root URL
    resolveRelativePath(rootUrl, relativePath) {
        if (relativePath.startsWith('http')) return relativePath;
        try {
            // If the relative path starts with ../ or is just a subfolder
            return new URL(relativePath, rootUrl).href;
        } catch (e) {
            return relativePath;
        }
    }

    async downloadSegmentList(urls, initSegmentBase64) {
        const logger = (typeof globalThis !== 'undefined' && globalThis.Logger) ? globalThis.Logger : { log: console.log, error: console.error };
        const blobs = [];

        // 1. Add Init Segment if available (standard in fragmented MP4)
        if (initSegmentBase64) {
            try {
                const initBuffer = Uint8Array.from(atob(initSegmentBase64), c => c.charCodeAt(0));
                blobs.push(new Blob([initBuffer]));
                logger.log("[VIMEO] Adicionado segmento de inicialização.");
            } catch (e) {
                logger.error("[VIMEO] Falha ao decodificar init_segment:", e.message);
            }
        }

        // 2. Download all segments
        for (let i = 0; i < urls.length; i++) {
            try {
                const buffer = await this.fetchWithRetry(urls[i], 'arrayBuffer');
                blobs.push(new Blob([buffer]));

                if (this.onProgress) this.onProgress(((i + 1) / urls.length) * 100);
                if ((i + 1) % 20 === 0 || (i + 1) === urls.length) {
                    logger.log(`[VIMEO] Progresso: ${i + 1}/${urls.length} segmentos.`);
                }
            } catch (e) {
                logger.error(`[VIMEO] Erro no segmento ${i}: ${e.message}`);
                throw e;
            }
        }

        return new Blob(blobs, { type: 'video/mp4' }); // Reconstructed fragmented MP4
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

                let nextLine = lines[i + 1]?.trim();
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

