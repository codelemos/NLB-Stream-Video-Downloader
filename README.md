# NLB Stream Video Downloader

A Chrome extension that allows you to download videos from streaming sites (HLS/m3u8), including Vimeo with audio and video automatically combined.

## ✨ Features

- **Automated Detection** of videos on pages (HLS/m3u8)
- **HLS Stream Download** with all segments combined
- **Automatic Muxing** of audio and video using FFmpeg.wasm
- **Vimeo Support** - automatically combines separate audio/video streams
- **Smart Naming** - saves files with the page title
- **Visual Progress** - progress bar during download

## 📦 Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the project folder

## 🎯 How to Use

1. Go to a site with video (e.g., Vimeo)
2. Click on the extension icon
3. Detected videos will appear in the list
4. Click **Download** to process and save

## 🛠️ Project Structure

```
ext-video-downloader/
├── _locales/           # i18n support (EN, PT, etc.)
├── manifest.json       # Extension configuration
├── background.js       # Main Service Worker
├── downloader.js       # HLS download logic
├── content.js          # Injected content script
├── popup.html/js       # User interface
├── offscreen.html/js   # FFmpeg.wasm processing
└── ffmpeg-core/        # Bundled FFmpeg.wasm files
```

## 🔧 Technologies

- **Manifest V3** - Modern Chrome extensions API
- **FFmpeg.wasm** - In-browser audio/video muxing
- **HLS Parser** - m3u8 stream downloader
- **Offscreen Documents** - WebAssembly processing

## 📝 Notes

- The extension size is ~32MB due to the bundled FFmpeg.wasm
- The first run might take longer (WASM loading)
- If muxing fails, separate files are saved with instructions

## 📄 License

MIT
