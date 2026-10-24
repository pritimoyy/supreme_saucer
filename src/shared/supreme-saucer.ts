export const SAUCER_FOLDER = "Supreme Saucer";

export type HostResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type QualityMode = "best" | "manual";

export type YtdlpFormat = {
  id: string;
  ext: string;
  resolution: string;
  fps: string;
  vcodec: string;
  acodec: string;
  label: string;
};

export type DownloadRequest = {
  url: string;
  outputDir: string;
  quality: QualityMode;
  formatId?: string;
  audioOnly: boolean;
  trimStart?: string;
  trimEnd?: string;
};

export type DownloadProgress = {
  percent: number | null;
  line: string;
};

export type DownloadResult = {
  filePath: string;
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
