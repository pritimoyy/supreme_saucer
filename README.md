# Supreme Saucer

Supreme Saucer is a lightning-fast, ultra-convenient Adobe CEP Extension for **Premiere Pro** and **After Effects** that lets you download media directly into your project bins.

With Supreme Saucer, you can paste URLs from YouTube, Instagram, Pinterest, and Spotify directly into the extension panel, choose your desired quality, and instantly import the media right onto your timeline.

## Features

- **Direct NLE Import:** Downloads are automatically imported into your active Premiere Pro or After Effects project.
- **Universal Downloader:** Supports YouTube, Instagram, Pinterest, and Spotify URLs natively.
- **Auto-Transcoding:** Automatically converts unsupported codecs (like VP9 and AV1) into Premiere-friendly H.264 behind the scenes.
- **Smart Formatting:** Choose specific resolutions, frame rates, or grab the audio-only track.
- **In-Panel Trimming:** Specify start and end timestamps before you download to grab exactly what you need without downloading a massive source file.

## Installation (For Users / Editors)

1. Go to the [Releases](https://github.com/yourusername/supreme-saucer/releases) page and download the latest `com.pritimoy.supremesaucer.zxp` file.
2. Install the `.zxp` file using a ZXP installer of your choice, such as [aescripts ZXP Installer](https://aescripts.com/learn/zxp-installer/) or [Anastasiy's Extension Manager](https://install.anastasiy.com/).
3. Restart Premiere Pro or After Effects.
4. Navigate to `Window > Extensions > Supreme Saucer` to open the panel.

## Development Setup

If you want to modify or compile Supreme Saucer from source, follow these steps:

### Prerequisites
- [Node.js 18+](https://nodejs.org/en/)
- Git

### 1. Clone & Install
```bash
git clone https://github.com/yourusername/supreme-saucer.git
cd supreme-saucer
npm install
```

### 2. Download Binaries
Because Supreme Saucer relies on `yt-dlp` and `ffmpeg` to handle the heavy lifting, you must download these binaries manually and place them in the `src/bin` folder before building.

Create a folder named `src/bin/` if it doesn't exist, then download and place the following executables inside it:
- [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) (Mac: `yt-dlp_macos`, rename to `yt-dlp` | Win: `yt-dlp.exe`)
- [ffmpeg & ffprobe](https://ffmpeg.org/download.html) (Mac: `ffmpeg` & `ffprobe` | Win: `ffmpeg.exe` & `ffprobe.exe`)

Your directory should look like this:
```
src/
 └─ bin/
    ├─ yt-dlp
    ├─ ffmpeg
    └─ ffprobe
```

*(Note: These files are ignored by git to keep the repository size small).*

### 3. Build & Run
To run the extension in hot-reload mode for rapid development:
```bash
npm run dev
```

To build a packaged `.zxp` file for distribution:
```bash
npm run zxp
```
The packaged file will be placed in `dist/zxp/`.

---
*Built with [Bolt CEP](https://github.com/hyperbrew/bolt-cep)*
