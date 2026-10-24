export const SAUCER_FOLDER = "Supreme Saucer";

export type HostResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type YtdlpFormat = {
  /** A yt-dlp format selector (may merge in the best audio). */
  id: string;
  ext: string;
  resolution: string;
  fps: string;
  vcodec: string;
  acodec: string;
  label: string;
  /** True when Premiere/AE can use the file without conversion. */
  native: boolean;
};

export type AudioFormat = "mp3" | "wav" | "m4a";

export const AUDIO_FORMATS: { id: AudioFormat; label: string; hint: string }[] = [
  { id: "mp3", label: "MP3", hint: "320 kbps · smallest, plays anywhere" },
  { id: "wav", label: "WAV", hint: "Uncompressed · best for editing" },
  { id: "m4a", label: "M4A", hint: "Original AAC stream · no re-encode" },
];

export type CookieBrowser = "none" | "chrome" | "safari" | "firefox" | "edge" | "brave" | "opera" | "vivaldi";

export const COOKIE_BROWSERS: { id: CookieBrowser; label: string }[] = [
  { id: "none", label: "Off" },
  { id: "chrome", label: "Chrome" },
  { id: "safari", label: "Safari" },
  { id: "firefox", label: "Firefox" },
  { id: "edge", label: "Edge" },
  { id: "brave", label: "Brave" },
  { id: "opera", label: "Opera" },
  { id: "vivaldi", label: "Vivaldi" },
];

export type ProbeRequest = {
  url: string;
  cookiesFrom?: CookieBrowser;
};

/** What we know about a link before downloading it. */
export type MediaInfo = {
  url: string;
  site: string;
  title: string;
  uploader: string | null;
  /** Seconds */
  duration: number | null;
  thumbnail: string | null;
  isSpotify: boolean;
  /** Empty for audio-only sources (Spotify, SoundCloud…). */
  videoFormats: YtdlpFormat[];
};

export type DownloadRequest = {
  url: string;
  outputDir: string;
  audioOnly: boolean;
  /** Video quality selector from MediaInfo.videoFormats; omit for best. */
  formatId?: string;
  audioFormat?: AudioFormat;
  trimStart?: string;
  trimEnd?: string;
  /** Media length in seconds (from the preview), used to pick the fastest trim strategy. */
  duration?: number | null;
  cookiesFrom?: CookieBrowser;
};

export type DownloadProgress = {
  percent: number | null;
  line: string;
};

export type DownloadResult = {
  filePath: string;
};

export const CANCELLED_MESSAGE = "Download cancelled.";

export type EngineTool = {
  id: "yt-dlp" | "ffmpeg" | "ffprobe" | "deno";
  label: string;
  role: string;
  installed: boolean;
  version: string | null;
  /** Installed by Supreme Saucer (and therefore updatable by it). */
  managed: boolean;
};

export type EngineStatus = {
  ready: boolean;
  tools: EngineTool[];
  /** Newest yt-dlp release on GitHub, when it could be checked. */
  latestYtDlp: string | null;
  updateAvailable: boolean;
  autoUpdate: boolean;
  folder: string;
};

export const isSpotifyUrl = (url: string): boolean =>
  /^https?:\/\/(www\.)?open\.spotify\.com\/(intl-[a-z-]+\/)?(track|album|playlist|artist|show|episode)\//i.test(
    url.trim()
  );

/**
 * yt-dlp supports well over a thousand sites (YouTube, Instagram, Facebook,
 * X/Twitter, TikTok, Pinterest, Vimeo, Reddit…), so accept any web link and
 * let it decide.
 */
export const isSupportedUrl = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url.trim());
    return (protocol === "http:" || protocol === "https:") && hostname.includes(".");
  } catch {
    return false;
  }
};

/** Parses "HH:MM:SS", "MM:SS" or plain seconds (decimals allowed) into seconds. */
export const parseTimecode = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^(\d+:){0,2}\d+(\.\d+)?$/.test(trimmed)) return null;
  const parts = trimmed.split(":").map(Number);
  if (parts.slice(1).some((n) => n >= 60)) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
};

export const isValidTimecode = (value: string): boolean => parseTimecode(value) !== null;

/** Returns an error message for the trim fields, or null if they're fine. */
export const validateTrim = (start: string, end: string): string | null => {
  const s = start.trim();
  const e = end.trim();
  if (!s && !e) return null;
  if (!s || !e) return "Fill both Start and End, or leave both empty.";
  const startSecs = parseTimecode(s);
  const endSecs = parseTimecode(e);
  if (startSecs === null) return "Start time must look like 1:30 or 00:01:30.";
  if (endSecs === null) return "End time must look like 1:30 or 00:01:30.";
  if (endSecs <= startSecs) return "End time must be after the start time.";
  return null;
};

/** 75 → "1:15", 3725 → "1:02:05"; with `tenths`, 7.4 → "0:07.4". */
export const formatTimecode = (seconds: number, tenths = false): string => {
  const total = Math.max(0, tenths ? Math.round(seconds * 10) / 10 : Math.round(seconds));
  const whole = Math.floor(total);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const fraction = tenths && total !== whole ? `.${Math.round((total - whole) * 10)}` : "";
  return (h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`) + fraction;
};
