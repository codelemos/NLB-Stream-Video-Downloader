# Privacy Policy - Stream Video Downloader

**Last updated:** March 24, 2026

Your privacy is fundamental to us. This Privacy Policy describes how the "Stream Video Downloader" extension (hereinafter "We", "The Extension", or "The Service") collects, uses, and protects your data when it is installed and used in your browser.

By using our extension, you agree to the collection and use of information in accordance with this policy.

## 1. Data Collection and Use

"Stream Video Downloader" is designed to operate entirely locally on your device. **We do not collect, send to our servers, remotely store, or sell any personal or browsing data of the user.**

To perform its core function of detecting and downloading videos (such as HLS, m3u8, and MP4), the extension requires access to certain browsing information and permissions, used strictly and exclusively as follows:

*   **Network Inspection (`webRequest`, `declarativeNetRequest` permissions):** The extension locally monitors the network requests made by your browser to identify video streams in the background. It may read HTTP headers temporarily (such as `Referer`, `Origin`, `Cookies`, and `Authorization`) only to replicate the necessary legitimate access and perform the download directly from the original video server (avoiding hotlinking blocks). None of this traffic information, URLs, cookies, or tokens is sent to us or third parties.
*   **Current Tab and Interaction Data (`activeTab`, `scripting` permissions):** The extension accesses basic information from the current tab (such as the page title) only at the exact moment when video detection and file download occur. This information is used purely to suggest a smart filename to be saved on your computer.
*   **Temporary Storage (`storage` permission):** We use your browser's native secure internal database (`IndexedDB`) only ephemerally (temporarily). It is used as a scratch area to save separate pieces of large video and audio files before they are integrated into a final unified file (.mp4 or .ts). As soon as the video is completed or a failure occurs, the pieces are entirely deleted from this memory.
*   **Secure Processing (`offscreen` permission):** We use a hidden environment provided by the browser to run heavy media conversions using FFmpeg directly via WebAssembly on your processor. No video is processed in the cloud.
*   **Local Folder Access (`downloads` permission):** Once ready, the video is passed to your browser to be downloaded directly into your local native Downloads folder securely and immediately.

## 2. Third-Party Data Sharing

The "Stream Video Downloader" extension is free of systemic tracking. We do not integrate analytics services, third-party advertising trackers, or cloud-based telemetry software. The only active network connections the extension promotes occur between your computer and the servers of the sites where you, as a user, originated the execution/viewing of the video.

## 3. Data Security

We ensure the security of your data through the simple principle of non-collection (privacy by design). The entire lifecycle of your data, the interception of sensitive headers to bypass protections, and the final assembly of the file (Muxing) occurs strictly within the secure Chrome/Chromium Sandbox installed on the end user's machine.

## 4. Changes to This Privacy Policy

We may update our Privacy Policy in the future. We will inform you of any changes in advance in the respective release notes or by publishing the new policy on the extension store listing page for transparent review.

## 5. Contact

If you have any questions, suggestions, or genuine privacy concerns related to the use, permissions, or behavior of the product during use, we kindly ask you to contact us on the corresponding and public support tab in the Chrome Web Store.
