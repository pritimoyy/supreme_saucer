# Supreme Saucer

Supreme Saucer is a lightning-fast, ultra-convenient Adobe extension for **Premiere Pro** and **After Effects** that lets you download media directly into your project bins.

With Supreme Saucer, you can paste URLs from YouTube, Instagram, Facebook, X/Twitter, TikTok, Pinterest, Spotify and [1,000+ other sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) directly into the extension panel, choose your desired quality, and instantly import the media right onto your timeline.

## Features

- **Direct NLE Import:** Downloads are automatically imported into your active Premiere Pro or After Effects project.
- **Universal Downloader:** Anything yt-dlp supports — YouTube (up to 4K/60fps), Instagram, Facebook, X/Twitter, TikTok, Pinterest video pins, and more. Spotify tracks are matched to YouTube audio.
- **One-click engine setup:** a first-run card installs yt-dlp, FFmpeg and Deno; Settings shows versions, checks GitHub for yt-dlp updates (notification + one-click update, or fully automatic), and can repair everything.
- **Link preview:** title, thumbnail, duration and every available resolution before you download.
- **Audio only:** MP3 (320 kbps), WAV (for editing) or M4A (original AAC, no re-encode), with tags and cover art.
- **Browser login:** optional — reads cookies from Chrome/Safari/Firefox/Edge/Brave locally for Instagram, Facebook, X and age-restricted YouTube.
- **Spotify:** matched against YouTube Music's official audio (the same approach as spotDL; Spotify audio itself is DRM-protected).
- **Auto-Transcoding:** Automatically converts unsupported codecs (VP9/AV1 video, Opus audio) into Premiere-friendly H.264/AAC behind the scenes.
- **Smart Formatting:** Choose specific resolutions, frame rates, or grab the audio-only track.
- **In-Panel Trimming:** Specify start and end times (`1:30` or `00:01:30`) to grab a frame-accurate clip without downloading the whole source.

## Platform Support

| Adobe App | Version | Extension Type |
|-----------|---------|---------------|
| Premiere Pro 2026+ (v26+) | UXP Plugin (`.ccx`) | ✅ New |
| Premiere Pro 2025 and earlier | CEP Extension (`.zxp`) | ✅ Legacy |
| After Effects (all versions) | CEP Extension (`.zxp`) | ✅ Legacy |

## Installation — Premiere Pro 2026+ (UXP)

Premiere Pro 2026 uses Adobe's new **UXP** platform. Supreme Saucer ships as a UXP plugin with a companion **Helper app** (sidecar) that handles downloads.

1. Go to the [Releases](https://github.com/yourusername/supreme-saucer/releases) page.
2. Download **`SupremeSaucer-UXP.zip`** — this contains:
   - The `.ccx` plugin file
   - The `supreme-saucer-helper` companion app
3. Install the `.ccx` plugin using the [UXP Developer Tool](https://developer.adobe.com/premiere-pro/uxp) or by placing it in your UXP plugins folder.
4. Launch the **Supreme Saucer Helper** app (it runs in the background on `localhost:9150`).
5. Open Premiere Pro → `Plugins > Supreme Saucer` to open the panel.

> **Note:** The Helper app must be running for downloads to work. It handles `yt-dlp` and `ffmpeg` execution since UXP plugins are sandboxed. On first start it downloads its tools automatically (about 30 seconds).

## Installation — After Effects / Premiere Pro 2025 (CEP)

1. Download the latest `com.pritimoy.supremesaucer.zxp` from [Releases](https://github.com/yourusername/supreme-saucer/releases).
2. Install the `.zxp` file using [aescripts ZXP Installer](https://aescripts.com/learn/zxp-installer/) or [Anastasiy's Extension Manager](https://install.anastasiy.com/).
3. Restart Premiere Pro or After Effects.
4. Navigate to `Window > Extensions > Supreme Saucer` to open the panel.

## Architecture

```
┌─────────────────────────────────────────┐
│  Premiere Pro 2026 (UXP)                │
│  ┌───────────────────────────────────┐  │
│  │  Supreme Saucer UXP Panel         │  │
│  │  (React UI — same components)     │  │
│  │  fetch() ←→ localhost:9150        │  │
│  │  UXP DOM API → project import     │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
         ↕ HTTP (localhost only)
┌─────────────────────────────────────────┐
│  Supreme Saucer Helper (Sidecar)        │
│  Express server on 127.0.0.1:9150       │
│  ├─ POST /formats  → yt-dlp -J         │
│  ├─ POST /download → yt-dlp + ffmpeg   │
│  └─ GET  /health   → { ok: true }      │
└─────────────────────────────────────────┘
```

## Development Setup

### Prerequisites
- [Node.js 18+](https://nodejs.org/en/)
- Git

### 1. Clone & Install
```bash
git clone https://github.com/yourusername/supreme-saucer.git
cd supreme-saucer
npm install
```

### 2. Binaries (automatic)
You don't need to install anything. On first launch the panel (or the Helper) downloads
these into a per-user folder and reuses them afterwards:

| Tool | Why | Source |
|------|-----|--------|
| `yt-dlp` | The downloader. Self-updates once a day, and immediately when a site starts failing. | GitHub releases |
| `ffmpeg` / `ffprobe` | Merging, trimming, converting to H.264/AAC | martin-riedl.de (macOS), yt-dlp/FFmpeg-Builds (Windows) |
| `deno` | YouTube requires a JavaScript runtime; without it most formats above 360p are hidden | GitHub releases |

Install location:
- macOS: `~/Library/Application Support/Supreme Saucer/bin`
- Windows: `%APPDATA%\Supreme Saucer\bin`

Delete that folder to force a clean reinstall. To ship binaries inside the package instead (offline
installs), drop them in `src/bin/`; they're picked up first and yt-dlp is copied into the folder
above so it can still update itself.

### 3. Build & Run

#### CEP (After Effects / Premiere Pro 2025)
```bash
npm run dev          # Hot-reload dev mode
npm run zxp          # Package as .zxp
```

#### UXP (Premiere Pro 2026+)
```bash
# Terminal 1: Start the sidecar server
npm run sidecar

# Terminal 2: Build the UXP plugin
npm run build:uxp    # Build plugin
npm run ccx          # Package as .ccx (same as build:uxp)
```

Then load the plugin in Premiere Pro using the [UXP Developer Tool](https://developer.adobe.com/premiere-pro/uxp).

#### Sidecar Helper (standalone binary)
```bash
npm run build:sidecar
```
Outputs to `dist/sidecar/supreme-saucer-helper`.

---
*CEP build powered by [Bolt CEP](https://github.com/hyperbrew/bolt-cep) · UXP build powered by [Bolt UXP](https://github.com/hyperbrew/bolt-uxp)*

## Troubleshooting

- **"requires sign-in" on Instagram / Facebook / X / Vimeo:** open Settings → *Use browser login*, pick the browser you're logged in with and try again. Safari needs Full Disk Access for Premiere/After Effects; Chrome may ask once for keychain access.
- **Pinterest image pins:** only video pins can be downloaded.
- **A site suddenly stops working:** Settings → *Update now* (or turn on *Update automatically*). Still broken? Settings → *Repair* reinstalls every tool.
- **Previewing the UI without Premiere:** `npm run dev` and open `http://localhost:3000/main/index.html` — a simulated backend is used outside Adobe apps (`?engine=missing` / `?engine=old` show the setup and update states).

