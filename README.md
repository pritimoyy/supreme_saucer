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

## Installation

Download the files from the [latest release](https://github.com/pritimoyy/supreme_saucer/releases/latest)
and follow **[INSTALL.md](INSTALL.md)**. It has step-by-step instructions for macOS and Windows:

| Your app | What to install |
|---|---|
| After Effects (any) / Premiere Pro 2025 and older | `SupremeSaucer-<version>.zxp` via ZXP Installer |
| Premiere Pro 2026+ | `SupremeSaucer-<version>-Premiere2026.ccx` + the Helper app for your OS |

No yt-dlp/FFmpeg install needed — the panel sets them up on first launch.

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
git clone https://github.com/pritimoyy/supreme_saucer.git
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

Delete that folder to force a clean reinstall. Nothing is bundled in the `.zxp`/`.ccx`; any yt-dlp,
FFmpeg or Deno already on the machine (e.g. Homebrew) is only used if it actually runs.

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
Outputs macOS (Apple Silicon + Intel) and Windows binaries to `dist/sidecar/bin/`.

#### Release files
```bash
npm run release
```
Builds everything and puts the `.zxp`, `.ccx`, Helper zips and `INSTALL.md` in `dist/release/`.

#### Tests
```bash
npx tsx scripts/smoke-engine.ts
```
Installs the engine and runs real downloads (trim, conversion, audio, cancel). CI runs this on macOS and Windows.

---
*CEP build powered by [Bolt CEP](https://github.com/hyperbrew/bolt-cep) · UXP build powered by [Bolt UXP](https://github.com/hyperbrew/bolt-uxp)*

## Troubleshooting

- **"requires sign-in" on Instagram / Facebook / X / Vimeo:** open Settings → *Use browser login*, pick the browser you're logged in with and try again. Safari needs Full Disk Access for Premiere/After Effects; Chrome may ask once for keychain access.
- **Pinterest image pins:** only video pins can be downloaded.
- **A site suddenly stops working:** Settings → *Update now* (or turn on *Update automatically*). Still broken? Settings → *Repair* reinstalls every tool.
- **Previewing the UI without Premiere:** `npm run dev` and open `http://localhost:3000/main/index.html` — a simulated backend is used outside Adobe apps (`?engine=missing` / `?engine=old` show the setup and update states).

