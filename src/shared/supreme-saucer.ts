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

export const SUPPORTED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "pinterest.com",
  "facebook.com",
  "fb.watch",
  "open.spotify.com",
] as const;

export const isSpotifyUrl = (url: string): boolean => {
  return /^https?:\/\/(www\.)?open\.spotify\.com\/(track|album|playlist|artist)\//i.test(url.trim());
};

export const isSupportedUrl = (url: string): boolean => {
  try {
    const host = new URL(url.trim()).hostname.replace(/^www\./, "");
    return SUPPORTED_HOSTS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
};

export const isValidTimecode = (value: string): boolean =>
  /^\d{1,2}:\d{2}:\d{2}$/.test(value.trim());
