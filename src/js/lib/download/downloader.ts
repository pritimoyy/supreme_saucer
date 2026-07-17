import { child_process, fs, os, path } from "../cep/node";
import { csi } from "../utils/bolt";
import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  YtdlpFormat,
} from "../../../shared/supreme-saucer";
import { isSpotifyUrl } from "../../../shared/supreme-saucer";

const { spawn } = child_process;

const getBinName = (name: string) =>
  os.platform() === "win32" ? `${name}.exe` : name;

export const getExtensionRoot = () => csi.getSystemPath("extension");

export const getBinaryPath = (name: "yt-dlp" | "ffmpeg") =>
  path.join(getExtensionRoot(), "bin", getBinName(name));

/**
 * Resolve the path to a binary.
 * Priority: bundled extension binary → system PATH candidates.
 * Throws a clear error only if nothing is found anywhere.
 */
const SYSTEM_CANDIDATES: Record<string, string[]> = {
  "yt-dlp": [
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ],
  "ffmpeg": [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ],
};

const resolveBinary = (name: "yt-dlp" | "ffmpeg"): string => {
  // 1. Prefer the bundled binary inside the extension's bin/ folder.
  const bundled = path.join(getExtensionRoot(), "bin", getBinName(name));
  if (fs.existsSync(bundled)) {
    console.log(`[Downloader] Using bundled ${name}: ${bundled}`);
    return bundled;
  }
  console.log(`[Downloader] Bundled ${name} not found, checking system PATH...`);

  // 2. Fall back to well-known system locations.
  const candidates = SYSTEM_CANDIDATES[name] ?? [];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`[Downloader] Found system ${name}: ${candidate}`);
      return candidate;
    }
  }

  const hint = `Install with: brew install ${name}`;
  throw new Error(`${name} not found. ${hint}`);
};

const runProcess = (
  binary: string,
  args: string[],
  onLine?: (line: string) => void,
  timeoutMs?: number
): Promise<{ stdout: string; stderr: string; code: number | null }> =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const handleChunk = (chunk: Buffer, target: "stdout" | "stderr") => {
      const text = chunk.toString();
      if (target === "stdout") stdout += text;
      else stderr += text;

      if (onLine) {
        text.split(/\r?\n/).forEach((line) => {
          if (line.trim()) onLine(line);
        });
      }
    };

    child.stdout.on("data", (chunk) => handleChunk(chunk, "stdout"));
    child.stderr.on("data", (chunk) => handleChunk(chunk, "stderr"));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });

    const timer = timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          try { child.kill("SIGTERM"); } catch (_) {}
          reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s — try again.`));
        }, timeoutMs)
      : null;
  });

const parseProgress = (line: string): number | null => {
  const match = line.match(/\[download\]\s+([\d.]+)%/);
  return match ? parseFloat(match[1]) : null;
};

const friendlyError = (stderr: string, stdout: string): string => {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  if (text.includes("private") || text.includes("login required")) {
    return "This content is private or requires sign-in.";
  }
  if (text.includes("unsupported url") || text.includes("no video formats")) {
    return "Unsupported URL or no downloadable media found.";
  }
  if (text.includes("network") || text.includes("connection")) {
    return "Network error — check your connection and try again.";
  }
  if (text.includes("geo restricted") || text.includes("not available")) {
    return "This content is not available in your region.";
  }

  const line =
    stderr
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("ERROR:")) ||
    stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("ERROR:"));

  if (line) return line.replace(/^ERROR:\s*/i, "");
  return "Download failed. Check the URL and try again.";
};

export const listFormats = async (url: string, audioOnly = false): Promise<YtdlpFormat[]> => {
  if (isSpotifyUrl(url)) {
    audioOnly = true;
    if (url.includes("playlist") || url.includes("album") || url.includes("artist")) {
      throw new Error("Spotify playlists and albums are currently not supported. Please paste a track URL.");
    }
    const query = await getSpotifySearchQuery(url);
    url = `ytsearch1:${query}`;
  }
  
  const ytDlp = resolveBinary("yt-dlp");

  // Use -J (dump full JSON info) for structured data.
  // --no-playlist + timeout ensure we only look at a single video.
  const result = await runProcess(
    ytDlp,
    ["-J", "--no-warnings", "--no-playlist", url],
    undefined,
    30_000
  );

  if (result.code !== 0) {
    throw new Error(friendlyError(result.stderr, result.stdout));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let info: Record<string, any>;
  try {
    info = JSON.parse(result.stdout);
  } catch {
    throw new Error("Could not parse format list from yt-dlp.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: Record<string, any>[] = info.formats ?? (info.entries && info.entries[0]?.formats) ?? [];

  // ─── Audio-only mode: show bitrate options ──────────────────────────────
  if (audioOnly) {
    // Helper: yt-dlp sometimes populates only `tbr` (total bitrate) for
    // audio-only streams, not `abr`. Both represent the same value when
    // vcodec === "none", so we use whichever is present.
    const effectiveAbr = (f: Record<string, unknown>): number =>
      (f.abr as number) || (f.tbr as number) || 0;

    const audioStreams = raw.filter((f) => {
      const vcodec: string | undefined = f.vcodec as string;
      const acodec: string | undefined = f.acodec as string;
      return (
        (vcodec === "none" || !vcodec) &&
        acodec !== undefined &&
        acodec !== "none" &&
        effectiveAbr(f) > 0
      );
    });

    // Deduplicate: group into 10 kbps buckets, keep best stream per bucket.
    // This collapses near-identical streams (e.g., 128 vs 129 kbps) while
    // keeping genuinely different tiers (e.g., 48 vs 128 vs 160 kbps).
    const byBucket = new Map<number, Record<string, unknown>>();
    for (const f of audioStreams) {
      const bucket = Math.round(effectiveAbr(f) / 10) * 10;
      const existing = byBucket.get(bucket);
      if (!existing || effectiveAbr(f) > effectiveAbr(existing)) {
        byBucket.set(bucket, f);
      }
    }

    // Sort highest bitrate first — index 0 will be auto-selected in the UI.
    const sorted = [...byBucket.values()].sort(
      (a, b) => effectiveAbr(b) - effectiveAbr(a)
    );

    if (sorted.length === 0) {
      throw new Error("No audio streams found for this URL.");
    }

    return sorted.map((f, idx) => {
      const kbps = Math.round(effectiveAbr(f));
      const ext = (f.ext as string).toUpperCase();
      const acodec = f.acodec as string;
      const codecName = acodec.startsWith("mp4a") ? "AAC"
        : acodec === "opus"                        ? "Opus"
        : acodec === "mp3"                         ? "MP3"
        : acodec.toUpperCase();
      // First entry is always the highest — mark it clearly.
      const highTag = idx === 0 ? " ★ Highest" : "";
      const label = `${kbps} kbps · ${ext} (${codecName})${highTag}`;
      return {
        id: f.format_id as string,
        ext: f.ext as string,
        resolution: "audio only",
        fps: "",
        vcodec: "none",
        acodec,
        label,
      };
    });
  }

  // ─── Video mode: Compatible or Transcodable formats ────────────────────
  // Premiere Pro & After Effects natively support mp4/mov with H.264/H.265.
  // We now automatically transcode VP9/AV1 and WebM/MKV to H.264 MP4.
  const VALID_EXTS = new Set(["mp4", "mov", "m4v", "webm", "mkv"]);

  const videoFormats = raw.filter((f) => {
    const height: number | undefined = f.height;
    const ext: string | undefined = f.ext;
    const vcodec: string | undefined = f.vcodec;
    return (
      height !== undefined &&
      height >= 144 &&
      ext !== undefined &&
      VALID_EXTS.has(ext) &&
      vcodec !== undefined &&
      vcodec !== "none"
    );
  });

  // Deduplicate: one entry per height, keeping the highest-bitrate stream.
  const byHeight = new Map<number, Record<string, unknown>>();
  for (const f of videoFormats) {
    const h = f.height as number;
    const existing = byHeight.get(h);
    const vbr = (f.vbr as number) ?? 0;
    if (!existing || vbr > ((existing.vbr as number) ?? 0)) {
      byHeight.set(h, f);
    }
  }

  // Sort highest resolution first.
  const sorted = [...byHeight.values()].sort(
    (a, b) => (b.height as number) - (a.height as number)
  );

  if (sorted.length === 0) {
    throw new Error(
      "No valid video formats found for this URL."
    );
  }

  return sorted.map((f) => {
    const height = f.height as number;
    const ext = (f.ext as string).toUpperCase();
    const vcodec = f.vcodec as string;
    let codec = "";
    if (/^(avc1|avc3|h264)/i.test(vcodec)) codec = "H.264";
    else if (/^(hvc1|hev1|h265)/i.test(vcodec)) codec = "H.265";
    else if (/vp9|vp09/i.test(vcodec)) codec = "VP9";
    else if (/av01|av1/i.test(vcodec)) codec = "AV1";
    else if (/vp8/i.test(vcodec)) codec = "VP8";
    else codec = vcodec === "unknown" ? "" : vcodec;

    const fps = f.fps ? ` \u00b7 ${Math.round(f.fps as number)}fps` : "";
    const requiresTranscode = !/^(avc|hvc|hev|h264|h265)/i.test(vcodec) || !["MP4", "MOV", "M4V"].includes(ext);
    const transcodeTag = requiresTranscode ? " (Auto-Convert)" : "";
    
    const label = `${height}p${fps} \u00b7 ${ext}${codec ? ` (${codec})` : ""}${transcodeTag}`;
    return {
      id: f.format_id as string,
      ext: f.ext as string,
      resolution: (f.resolution as string) ?? `${f.width}x${height}`,
      fps: f.fps ? String(Math.round(f.fps as number)) : "",
      vcodec,
      acodec: (f.acodec as string) ?? "",
      label,
    };
  });
};

const resolveUniqueOutputPath = (
  outputDir: string,
  title: string,
  ext: string
): string => {
  const sanitized = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "download";
  let candidate = path.join(outputDir, `${sanitized}.${ext}`);
  if (!fs.existsSync(candidate)) return candidate;

  let index = 1;
  while (index < 1000) {
    candidate = path.join(outputDir, `${sanitized}-${index}.${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    index++;
  }

  return candidate;
};

const findLatestFile = (dir: string, ext: string): string | null => {
  if (!fs.existsSync(dir)) return null;

  const files = fs
    .readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith(`.${ext}`))
    .map((file) => ({
      file,
      mtime: fs.statSync(path.join(dir, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files[0] ? path.join(dir, files[0].file) : null;
};

const trimWithFfmpeg = async (
  inputPath: string,
  trimStart: string,
  trimEnd: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> => {
  const ffmpeg = resolveBinary("ffmpeg");

  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const outputPath = resolveUniqueOutputPath(
    path.dirname(inputPath),
    `${base}-trimmed`,
    ext.replace(".", "")
  );

  onProgress?.({ percent: null, line: "Trimming with ffmpeg…" });

  const args = [
    "-y",
    "-ss",
    trimStart,
    "-to",
    trimEnd,
    "-i",
    inputPath,
    "-c",
    "copy",
    outputPath,
  ];

  const result = await runProcess(ffmpeg, args, undefined, 120_000);
  if (result.code !== 0 || !fs.existsSync(outputPath)) {
    throw new Error("Trim failed after download.");
  }

  return outputPath;
};

const ensureCompatibleVideo = async (
  inputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> => {
  const ffmpeg = resolveBinary("ffmpeg");

  // Run ffmpeg -i to dump stream info to stderr
  const checkResult = await runProcess(ffmpeg, ["-i", inputPath], undefined, 5000);
  const info = checkResult.stderr.toLowerCase();

  // If it's not a known unsupported codec, assume it's fine.
  if (!info.includes("video: vp9") && !info.includes("video: vp8") && !info.includes("video: av1") && !info.includes("video: vp09")) {
    return inputPath;
  }

  onProgress?.({ percent: null, line: "Transcoding unsupported codec (VP9/AV1) to H.264…" });

  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const outputPath = resolveUniqueOutputPath(
    path.dirname(inputPath),
    `${base}-h264`,
    "mp4"
  );

  const args = [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "copy",
    outputPath,
  ];

  const result = await runProcess(ffmpeg, args, (line) => {
    // Basic progress string for transcoding
    if (line.includes("time=")) {
      onProgress?.({ percent: null, line: "Transcoding to H.264..." });
    }
  }, 600_000); // 10 minutes max for transcode

  if (result.code !== 0 || !fs.existsSync(outputPath)) {
    throw new Error("Failed to transcode unsupported video codec to H.264.");
  }

  try {
    fs.unlinkSync(inputPath);
  } catch (_) {}

  return outputPath;
};

// ─── Spotify Metadata Scraper ───────────────────────────────────────────────
async function getSpotifySearchQuery(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const https = require("https");
    https
      .get(url, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          const match = data.match(/<title>(.*?)<\/title>/);
          if (!match) return reject(new Error("Could not parse Spotify metadata."));
          let title = match[1];
          title = title.replace(" - song and lyrics by", "");
          title = title.replace(" - song by", "");
          title = title.replace(" | Spotify", "");
          resolve(title.trim());
        });
      })
      .on("error", reject);
  });
};

export const downloadMedia = async (
  request: DownloadRequest,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> => {
  const ytDlp = resolveBinary("yt-dlp");

  let targetUrl = request.url;

  if (isSpotifyUrl(request.url)) {
    if (request.url.includes("playlist") || request.url.includes("album") || request.url.includes("artist")) {
      throw new Error("Spotify playlists and albums are currently not supported. Please paste a track URL.");
    }
    onProgress?.({ percent: null, line: "Fetching Spotify metadata…" });
    const query = await getSpotifySearchQuery(request.url);
    targetUrl = `ytsearch1:${query}`;
  }

  const ext = request.audioOnly ? "mp3" : "mp4";

  const titleResult = await runProcess(
    ytDlp,
    [
      "--print",
      "title",
      "--skip-download",
      "--no-warnings",
      "--no-playlist",
      targetUrl,
    ],
    undefined,
    30_000
  );

  if (titleResult.code !== 0) {
    throw new Error(friendlyError(titleResult.stderr, titleResult.stdout));
  }

  const title = titleResult.stdout.trim() || "download";
  const uniqueBase = path.basename(
    resolveUniqueOutputPath(request.outputDir, title, ext),
    `.${ext}`
  );
  const outputTemplate = path.join(request.outputDir, `${uniqueBase}.%(ext)s`);

  const args = [
    "--newline",
    "--no-playlist",
    "--ffmpeg-location",
    path.dirname(resolveBinary("ffmpeg")),
    "-o",
    outputTemplate,
  ];

  if (targetUrl.includes("youtube.com") || targetUrl.includes("youtu.be")) {
    args.push("--concurrent-fragments", "4", "--http-chunk-size", "10M");
  }

  if (request.audioOnly) {
    if (request.quality === "manual" && request.formatId) {
      // User picked a specific audio stream — download it and convert to MP3.
      args.push("-f", request.formatId, "-x", "--audio-format", "mp3");
    } else {
      // Best available audio.
      args.push("-x", "--audio-format", "mp3");
    }
  } else if (request.quality === "manual" && request.formatId) {
    // Prefer m4a audio (AAC) so the merge is a remux, not a transcode.
    args.push(
      "-f",
      `${request.formatId}+bestaudio[ext=m4a]/${request.formatId}+bestaudio/${request.formatId}`,
      "--merge-output-format",
      "mp4"
    );
  } else {
    // Prefer H.264 + AAC: remux to mp4 with no transcoding.
    // Falls back to any merged stream, then to best available.
    args.push(
      "-S", "vcodec:h264,res,acodec:aac",
      "-f",
      "bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc]/bestvideo[ext=mp4]+bestaudio/bestvideo+bestaudio/best[ext=mp4]/best",
      "--merge-output-format",
      "mp4"
    );
  }

  const hasTrim = Boolean(request.trimStart && request.trimEnd);
  let usedDownloadSections = false;
  let sectionArgIndex = -1;

  if (hasTrim) {
    sectionArgIndex = args.length;
    args.push(
      "--download-sections",
      `*${request.trimStart}-${request.trimEnd}`
    );
    usedDownloadSections = true;
  }

  args.push(targetUrl);

  let result = await runProcess(
    ytDlp,
    args,
    (line) => { onProgress?.({ percent: parseProgress(line), line }); },
    600_000 // 10-minute hard cap
  );

  const sectionsUnsupported =
    hasTrim &&
    usedDownloadSections &&
    (result.code !== 0 ||
      `${result.stderr}\n${result.stdout}`
        .toLowerCase()
        .includes("download-sections"));

  if (sectionsUnsupported) {
    onProgress?.({
      percent: null,
      line: "Trim via download-sections unavailable — downloading full file…",
    });

    const fallbackArgs = args.slice(0, sectionArgIndex);
    fallbackArgs.push(targetUrl);
    result = await runProcess(
      ytDlp,
      fallbackArgs,
      (line) => { onProgress?.({ percent: parseProgress(line), line }); },
      600_000
    );
    usedDownloadSections = false;
  }

  if (result.code !== 0) {
    throw new Error(friendlyError(result.stderr, result.stdout));
  }

  let filePath = path.join(request.outputDir, `${uniqueBase}.${ext}`);

  if (!fs.existsSync(filePath)) {
    filePath =
      findLatestFile(request.outputDir, ext) ||
      findLatestFile(request.outputDir, request.audioOnly ? "mp3" : "mp4") ||
      "";
  }

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("Download finished but the output file was not found.");
  }

  if (hasTrim && !usedDownloadSections) {
    filePath = await trimWithFfmpeg(
      filePath,
      request.trimStart!,
      request.trimEnd!,
      onProgress
    );
  }

  if (!request.audioOnly) {
    filePath = await ensureCompatibleVideo(filePath, onProgress);
  }

  onProgress?.({ percent: 100, line: "Download complete." });
  return { filePath };
};
