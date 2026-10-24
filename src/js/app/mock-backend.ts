/**
 * Fake backend for previewing the panel in a normal browser (`npm run dev`
 * without Premiere). Simulates the engine, previews and downloads.
 */
import type { EngineStatus, MediaInfo } from "../../shared/supreme-saucer";
import { CANCELLED_MESSAGE, isSpotifyUrl } from "../../shared/supreme-saucer";
import type { Backend, ProgressFn } from "./backend";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let installed = new URLSearchParams(location.search).get("engine") !== "missing";
let ytDlpVersion = new URLSearchParams(location.search).get("engine") === "old" ? "2026.07.04" : "2026.10.21";
let autoUpdate = false;
let cancelled = false;

const status = (): EngineStatus => ({
  ready: installed,
  tools: [
    { id: "yt-dlp", label: "yt-dlp", role: "Downloads from YouTube, Instagram, X and 1,000+ sites", installed, version: installed ? ytDlpVersion : null, managed: true },
    { id: "ffmpeg", label: "FFmpeg", role: "Merges, trims and converts for Premiere", installed, version: installed ? "9.0.2" : null, managed: true },
    { id: "ffprobe", label: "FFprobe", role: "Reads media info for trimming and audio", installed, version: installed ? "9.0.2" : null, managed: true },
    { id: "deno", label: "Deno", role: "Unlocks full YouTube quality (4K, 60fps)", installed, version: installed ? "2.9.8" : null, managed: true },
  ],
  latestYtDlp: "2026.10.21",
  updateAvailable: installed && ytDlpVersion !== "2026.10.21",
  autoUpdate,
  folder: "~/Library/Application Support/Supreme Saucer/bin",
});

const simulate = async (steps: string[], onProgress: ProgressFn, ms = 900) => {
  for (const step of steps) {
    for (let p = 0; p <= 100; p += 20) {
      if (cancelled) throw new Error(CANCELLED_MESSAGE);
      onProgress({ percent: p, line: `${step} ${p}%` });
      await wait(ms / 6);
    }
  }
};

export const createMockBackend = (): Backend => ({
  hostName: "Premiere Pro",
  probe: async ({ url }) => {
    await wait(isSpotifyUrl(url) ? 500 : 1400);
    if (/fail/.test(url)) throw new Error("This post is private or needs you to be logged in. Turn on “Use browser login” in Settings.");
    if (isSpotifyUrl(url)) {
      return {
        url,
        site: "Spotify",
        title: "Never Gonna Give You Up",
        uploader: "Rick Astley",
        duration: 214,
        thumbnail: "https://i.scdn.co/image/ab67616d0000b273baf89eb11ec7c657805d2da0",
        isSpotify: true,
        videoFormats: [],
      } satisfies MediaInfo;
    }
    return {
      url,
      site: "Youtube",
      title: "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film",
      uploader: "Blender",
      duration: 635,
      thumbnail: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
      isSpotify: false,
      videoFormats: [
        { id: "a", ext: "mp4", resolution: "3840x2160", fps: "60", vcodec: "vp9", acodec: "", label: "2160p 60 · VP9", native: false },
        { id: "b", ext: "mp4", resolution: "2560x1440", fps: "60", vcodec: "vp9", acodec: "", label: "1440p 60 · VP9", native: false },
        { id: "c", ext: "mp4", resolution: "1920x1080", fps: "60", vcodec: "avc1", acodec: "", label: "1080p 60 · H.264", native: true },
        { id: "d", ext: "mp4", resolution: "1280x720", fps: "60", vcodec: "avc1", acodec: "", label: "720p 60 · H.264", native: true },
      ],
    } satisfies MediaInfo;
  },
  prepareFolder: async () => "/Users/you/Projects/Edit/Supreme Saucer",
  download: async (request, onProgress) => {
    cancelled = false;
    onProgress({ percent: null, line: "Connecting…" });
    await wait(600);
    await simulate(request.audioOnly ? ["Downloading audio…"] : ["Downloading video…", "Downloading audio…"], onProgress, 2400);
    return { filePath: `/Users/you/Projects/Edit/Supreme Saucer/download.${request.audioOnly ? request.audioFormat ?? "mp3" : "mp4"}` };
  },
  importFile: async () => {
    await wait(400);
  },
  cancel: () => {
    cancelled = true;
  },
  engineStatus: async () => {
    await wait(300);
    return status();
  },
  engineAction: async (action, onProgress) => {
    cancelled = false;
    if (action === "update") {
      await simulate(["Updating yt-dlp…"], onProgress);
      ytDlpVersion = "2026.10.21";
    } else {
      await simulate(["Installing yt-dlp…", "Installing FFmpeg…", "Installing FFprobe…", "Installing Deno…"], onProgress, 700);
      installed = true;
    }
    return status();
  },
  setAutoUpdate: async (enabled) => {
    autoUpdate = enabled;
  },
  reveal: (filePath) => console.log("reveal", filePath),
});
