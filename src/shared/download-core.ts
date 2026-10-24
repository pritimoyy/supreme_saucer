/**
 * Supreme Saucer — Download engine (shared by the CEP panel and the sidecar)
 *
 * Node built-ins are injected so the same code runs inside CEP (where they
 * come from `window.cep_node.require`) and in the standalone sidecar.
 *
 * Responsibilities:
 *   - Locate yt-dlp / ffmpeg / ffprobe / deno, installing them on first use
 *     into a per-user folder so end users never have to install anything.
 *   - Keep yt-dlp up to date (YouTube breaks old versions within weeks).
 *   - List formats, download, trim and convert to Premiere/AE-friendly media.
 */

import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  YtdlpFormat,
} from "./supreme-saucer";
import { isSpotifyUrl, parseTimecode } from "./supreme-saucer";

type ChildProcess = typeof import("child_process");
type Fs = typeof import("fs");
type Os = typeof import("os");
type Path = typeof import("path");
type Https = typeof import("https");

export type DownloaderDeps = {
  child_process: ChildProcess;
  fs: Fs;
  os: Os;
  path: Path;
  https: Https;
  /** Folders that may contain binaries shipped with the extension/helper. */
  bundledBinDirs: () => string[];
};

type Tool = "yt-dlp" | "ffmpeg" | "ffprobe" | "deno";
type ProgressFn = (progress: DownloadProgress) => void;
type RunResult = { stdout: string; stderr: string; code: number | null };
type RunOptions = {
  onLine?: (line: string) => void;
  /** Kill the process if it produces no output for this long. */
  idleTimeoutMs?: number;
  /** Hard cap regardless of output. */
  timeoutMs?: number;
};

const YTDLP_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// yt-dlp errors that usually mean "your yt-dlp is too old for this site".
const STALE_YTDLP_PATTERN =
  /http error 403|requested format is not available|nsig|signature|unable to extract|player response|precondition failed/i;

const ERROR_HINTS: [RegExp, string][] = [
  [
    /sign in to confirm (your age|you.re not a bot)|age.restricted/i,
    "YouTube requires sign-in for this video (age-restricted or bot check).",
  ],
  [
    /private video|this video is private|login required|requires? (login|authentication)|use --cookies|rate-limit reached/i,
    "This content is private or requires sign-in.",
  ],
  [/unsupported url/i, "This site or link isn't supported."],
  [
    /no video formats found|no formats found|there is no video in this/i,
    "No downloadable video was found at this link (image posts aren't supported).",
  ],
  [
    /geo.?restrict|not available in your country|not made this video available in your country/i,
    "This content is not available in your region.",
  ],
  [
    /video unavailable|has been removed|account (has been )?terminated/i,
    "This video is unavailable or has been removed.",
  ],
  [
    /live event will begin|is not currently live|premieres in/i,
    "This livestream or premiere hasn't started yet.",
  ],
  [
    /getaddrinfo|name or service not known|network is unreachable|connection (reset|refused)|timed out/i,
    "Network error — check your connection and try again.",
  ],
  [
    /http error 403/i,
    "The site blocked the download (HTTP 403). Try again in a minute.",
  ],
];

const VIDEO_OK = new Set(["h264", "hevc", "prores", "mpeg4", "dnxhd"]);
const AUDIO_OK = new Set(["aac", "mp3", "alac", "ac3", "eac3"]);

export const createDownloader = (deps: DownloaderDeps) => {
  const { child_process, fs, os, path, https } = deps;
  const isWin = os.platform() === "win32";
  const isMac = os.platform() === "darwin";
  const env: Record<string, string | undefined> =
    typeof process !== "undefined" ? process.env : {};

  const exe = (tool: Tool) => (isWin ? `${tool}.exe` : tool);

  /* ─── Locations ──────────────────────────────────────────── */

  const dataDir = (): string => {
    if (isWin) {
      const base = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      return path.join(base, "Supreme Saucer");
    }
    if (isMac) {
      return path.join(os.homedir(), "Library", "Application Support", "Supreme Saucer");
    }
    return path.join(os.homedir(), ".supreme-saucer");
  };

  const managedBinDir = () => path.join(dataDir(), "bin");

  const systemBinDirs = (): string[] => {
    const fromPath = (env.PATH || env.Path || "")
      .split(path.delimiter)
      .filter(Boolean);
    const extra = isWin
      ? [
          path.join(env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links"),
          "C:\\ProgramData\\chocolatey\\bin",
          path.join(os.homedir(), "scoop", "shims"),
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          path.join(os.homedir(), ".deno", "bin"),
          path.join(os.homedir(), ".local", "bin"),
        ];
    return [...extra, ...fromPath];
  };

  const isFile = (p: string) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };

  const findIn = (dirs: string[], tool: Tool): string | null => {
    for (const dir of dirs) {
      const candidate = path.join(dir, exe(tool));
      if (isFile(candidate)) return candidate;
    }
    return null;
  };

  /* ─── Process runner ─────────────────────────────────────── */

  const runProcess = (
    binary: string,
    args: string[],
    options: RunOptions = {}
  ): Promise<RunResult> =>
    new Promise((resolve, reject) => {
      const { onLine, idleTimeoutMs, timeoutMs } = options;
      // Adobe apps launched from Finder/Explorer get a minimal PATH; make sure
      // yt-dlp can find ffmpeg/ffprobe/deno that we installed ourselves.
      const childEnv: Record<string, string | undefined> = { PYTHONIOENCODING: "utf-8" };
      let currentPath = "";
      for (const [key, value] of Object.entries(env)) {
        // Windows spells it "Path"; normalise so we don't end up with two.
        if (key.toUpperCase() === "PATH") currentPath = value || "";
        else childEnv[key] = value;
      }
      childEnv.PATH = [managedBinDir(), currentPath].join(path.delimiter);
      // Static ffmpeg builds can't find macOS's root certificates on their own,
      // which breaks every HTTPS stream ffmpeg opens directly (e.g. clip downloads).
      if (isMac && !childEnv.SSL_CERT_FILE && isFile("/etc/ssl/cert.pem")) {
        childEnv.SSL_CERT_FILE = "/etc/ssl/cert.pem";
      }
      const child = child_process.spawn(binary, args, { windowsHide: true, env: childEnv });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        fn();
      };

      const kill = (reason: string) =>
        finish(() => {
          try {
            child.kill();
          } catch (_) {}
          reject(new Error(reason));
        });

      const armIdle = () => {
        if (!idleTimeoutMs) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => kill(`Stalled for ${Math.round(idleTimeoutMs / 1000)}s with no progress — try again.`),
          idleTimeoutMs
        );
      };

      const handleChunk = (chunk: Buffer, target: "stdout" | "stderr") => {
        armIdle();
        const text = chunk.toString();
        if (target === "stdout") stdout += text;
        else stderr += text;
        if (onLine) {
          // ffmpeg separates progress updates with \r, yt-dlp with \n.
          text.split(/[\r\n]+/).forEach((line) => {
            if (line.trim()) onLine(line);
          });
        }
      };

      child.stdout.on("data", (chunk: Buffer) => handleChunk(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => handleChunk(chunk, "stderr"));
      child.on("error", (err) => finish(() => reject(err)));
      child.on("close", (code) => finish(() => resolve({ stdout, stderr, code })));

      armIdle();
      if (timeoutMs) {
        hardTimer = setTimeout(
          () => kill(`Timed out after ${Math.round(timeoutMs / 1000)}s — try again.`),
          timeoutMs
        );
      }
    });

  /* ─── Installing tools ───────────────────────────────────── */

  const httpDownload = (
    url: string,
    dest: string,
    onPercent?: (pct: number) => void,
    redirects = 0
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      if (redirects > 10) return reject(new Error("Too many redirects."));
      const req = https.get(url, { headers: { "User-Agent": "SupremeSaucer" } }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          httpDownload(next, dest, onPercent, redirects + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} while downloading ${url}`));
          return;
        }
        const total = Number(res.headers["content-length"]) || 0;
        let received = 0;
        const tmp = `${dest}.part`;
        const out = fs.createWriteStream(tmp);
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (total) onPercent?.((received / total) * 100);
        });
        res.on("error", reject);
        out.on("error", reject);
        out.on("finish", () => {
          try {
            fs.renameSync(tmp, dest);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
        res.pipe(out);
      });
      req.on("error", reject);
      req.setTimeout(60_000, () => req.destroy(new Error("Connection timed out.")));
    });

  const extractZip = async (zipPath: string, destDir: string) => {
    fs.mkdirSync(destDir, { recursive: true });
    const result = isWin
      ? await runProcess(
          path.join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
          ["-xf", zipPath, "-C", destDir],
          { timeoutMs: 300_000 }
        )
      : isMac
        ? await runProcess("/usr/bin/ditto", ["-x", "-k", zipPath, destDir], { timeoutMs: 300_000 })
        : await runProcess("tar", ["-xf", zipPath, "-C", destDir], { timeoutMs: 300_000 });
    if (result.code !== 0) throw new Error(`Could not extract ${path.basename(zipPath)}.`);
  };

  const findFileRecursive = (dir: string, name: string): string | null => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFileRecursive(full, name);
        if (found) return found;
      } else if (entry.name === name) {
        return full;
      }
    }
    return null;
  };

  const placeBinary = (source: string, tool: Tool): string => {
    const target = path.join(managedBinDir(), exe(tool));
    try {
      fs.unlinkSync(target);
    } catch (_) {}
    fs.copyFileSync(source, target);
    if (!isWin) fs.chmodSync(target, 0o755);
    return target;
  };

  type Source = { url: string; zip: boolean; contains: Tool[] };

  const sourceFor = (tool: Tool): Source => {
    const arm = os.arch() === "arm64";
    const gh = (repo: string, file: string) =>
      `https://github.com/${repo}/releases/latest/download/${file}`;

    if (tool === "yt-dlp") {
      const file = isWin ? "yt-dlp.exe" : isMac ? "yt-dlp_macos" : arm ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
      return { url: gh("yt-dlp/yt-dlp", file), zip: false, contains: ["yt-dlp"] };
    }
    if (tool === "deno") {
      const triple = isWin
        ? "x86_64-pc-windows-msvc"
        : isMac
          ? `${arm ? "aarch64" : "x86_64"}-apple-darwin`
          : `${arm ? "aarch64" : "x86_64"}-unknown-linux-gnu`;
      return { url: gh("denoland/deno", `deno-${triple}.zip`), zip: true, contains: ["deno"] };
    }
    // ffmpeg / ffprobe
    if (isWin) {
      return {
        url: "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
        zip: true,
        contains: ["ffmpeg", "ffprobe"],
      };
    }
    if (isMac) {
      return {
        url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arm ? "arm64" : "amd64"}/release/${tool}.zip`,
        zip: true,
        contains: [tool],
      };
    }
    return {
      url: `https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux${arm ? "arm64" : "64"}-gpl.tar.xz`,
      zip: true,
      contains: ["ffmpeg", "ffprobe"],
    };
  };

  const TOOL_LABEL: Record<Tool, string> = {
    "yt-dlp": "yt-dlp",
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
    deno: "JavaScript runtime (deno)",
  };

  const installTool = async (tool: Tool, onProgress?: ProgressFn): Promise<string> => {
    const binDir = managedBinDir();
    fs.mkdirSync(binDir, { recursive: true });
    const source = sourceFor(tool);
    const label = TOOL_LABEL[tool];
    const report = (pct: number | null) =>
      onProgress?.({
        percent: pct,
        line: `First-time setup: downloading ${label}${pct !== null ? ` ${Math.floor(pct)}%` : "…"}`,
      });
    report(null);

    if (!source.zip) {
      const target = path.join(binDir, exe(tool));
      await httpDownload(source.url, target, report);
      if (!isWin) fs.chmodSync(target, 0o755);
      return target;
    }

    const work = path.join(dataDir(), "tmp", `${tool}-${Date.now()}`);
    fs.mkdirSync(work, { recursive: true });
    try {
      const archive = path.join(work, path.basename(new URL(source.url).pathname) || "archive.zip");
      await httpDownload(source.url, archive, report);
      onProgress?.({ percent: null, line: `First-time setup: unpacking ${label}…` });
      const extracted = path.join(work, "x");
      await extractZip(archive, extracted);
      for (const item of source.contains) {
        const found = findFileRecursive(extracted, exe(item));
        if (found) placeBinary(found, item);
      }
    } finally {
      try {
        fs.rmSync(work, { recursive: true, force: true });
      } catch (_) {}
    }

    const installed = path.join(binDir, exe(tool));
    if (!isFile(installed)) throw new Error(`${label} was not found in the downloaded archive.`);
    return installed;
  };

  const inFlight = new Map<Tool, Promise<string>>();

  const locateOrInstall = (tool: Tool, onProgress?: ProgressFn): Promise<string> => {
    const pending = inFlight.get(tool);
    if (pending) return pending;

    const job = (async () => {
      const managed = findIn([managedBinDir()], tool);
      if (managed) return managed;

      const bundled = findIn(deps.bundledBinDirs(), tool);
      if (tool === "yt-dlp") {
        // yt-dlp must be self-updatable, so it always lives in our data folder.
        if (bundled) {
          fs.mkdirSync(managedBinDir(), { recursive: true });
          return placeBinary(bundled, tool);
        }
        try {
          return await installTool(tool, onProgress);
        } catch (err) {
          const system = findIn(systemBinDirs(), tool);
          if (system) return system;
          throw err;
        }
      }

      if (bundled) return bundled;
      const system = findIn(systemBinDirs(), tool);
      if (system) return system;
      return installTool(tool, onProgress);
    })();

    inFlight.set(tool, job);
    job.then(
      () => inFlight.delete(tool),
      () => inFlight.delete(tool)
    );
    return job;
  };

  const updateStampPath = () => path.join(dataDir(), "yt-dlp-last-update");

  /** Self-update yt-dlp if it's ours and hasn't been checked recently. */
  const updateYtDlp = async (ytDlp: string, force: boolean, onProgress?: ProgressFn) => {
    if (!ytDlp.startsWith(managedBinDir())) return false;
    if (!force) {
      try {
        const last = fs.statSync(updateStampPath()).mtimeMs;
        if (Date.now() - last < YTDLP_UPDATE_INTERVAL_MS) return false;
      } catch (_) {}
    }
    onProgress?.({ percent: null, line: "Checking for yt-dlp updates…" });
    try {
      const result = await runProcess(ytDlp, ["-U"], { idleTimeoutMs: 90_000 });
      fs.writeFileSync(updateStampPath(), new Date().toISOString());
      return /updated yt-dlp to|updating to/i.test(result.stdout + result.stderr);
    } catch {
      return false;
    }
  };

  type Toolset = { ytDlp: string; ffmpeg: string; deno: string | null };

  /**
   * Make sure every tool is available, installing whatever is missing.
   * Safe to call repeatedly; it's cheap once everything is installed.
   */
  const ensureTools = async (onProgress?: ProgressFn): Promise<Toolset> => {
    const ytDlp = await locateOrInstall("yt-dlp", onProgress);
    const ffmpeg = await locateOrInstall("ffmpeg", onProgress);
    // yt-dlp needs ffprobe for audio extraction and accurate trimming.
    await locateOrInstall("ffprobe", onProgress).catch(() => null);
    // Without a JS runtime YouTube hides most formats (often everything above 360p).
    const deno = await locateOrInstall("deno", onProgress).catch((err) => {
      console.warn("[Downloader] deno unavailable:", err);
      return null;
    });
    await updateYtDlp(ytDlp, false, onProgress);
    return { ytDlp, ffmpeg, deno };
  };

  const baseArgs = (tools: Toolset): string[] => {
    const args = [
      "--no-playlist",
      "--playlist-items",
      "1",
      "--ffmpeg-location",
      path.dirname(tools.ffmpeg),
      "--retries",
      "10",
      "--fragment-retries",
      "10",
    ];
    if (tools.deno) args.push("--js-runtimes", `deno:${tools.deno}`);
    return args;
  };

  /* ─── Errors ─────────────────────────────────────────────── */

  const friendlyError = (stderr: string, stdout = ""): string => {
    const text = `${stderr}\n${stdout}`;
    const errorLine = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith("ERROR:"));
    const subject = errorLine || text;
    for (const [pattern, message] of ERROR_HINTS) {
      if (pattern.test(subject)) return message;
    }
    if (errorLine) return errorLine.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/i, "");
    const last = text.trim().split(/\r?\n/).pop();
    return last || "Download failed. Check the URL and try again.";
  };

  /** Run yt-dlp; if it fails in a way that smells like an outdated build, update and retry once. */
  const runYtDlp = async (
    tools: Toolset,
    args: string[],
    options: RunOptions,
    onProgress?: ProgressFn
  ): Promise<RunResult> => {
    const first = await runProcess(tools.ytDlp, args, options);
    if (first.code === 0 || !STALE_YTDLP_PATTERN.test(first.stderr)) return first;
    const updated = await updateYtDlp(tools.ytDlp, true, onProgress);
    if (!updated) return first;
    onProgress?.({ percent: null, line: "yt-dlp updated — retrying…" });
    return runProcess(tools.ytDlp, args, options);
  };

  /* ─── Spotify ────────────────────────────────────────────── */

  const fetchText = (url: string, redirects = 0): Promise<string> =>
    new Promise((resolve, reject) => {
      // No User-Agent on purpose: Spotify serves a JS-only shell to browsers
      // but full metadata (og: tags) to plain HTTP clients.
      const req = https.get(url, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirects < 5) {
          res.resume();
          fetchText(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject);
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(20_000, () => req.destroy(new Error("Spotify request timed out.")));
    });

  const decodeEntities = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

  const spotifyToSearch = async (url: string): Promise<string> => {
    if (/\/(playlist|album|artist|show|episode)\//i.test(url)) {
      throw new Error("Spotify playlists, albums and podcasts aren't supported yet. Paste a track URL.");
    }
    const html = await fetchText(url);
    const meta = (prop: string) =>
      html.match(new RegExp(`property="${prop}" content="([^"]*)"`))?.[1];
    const song = meta("og:title");
    // og:description looks like "Artist · Album · Song · 2020"
    const artist = meta("og:description")?.split(" · ")[0];
    let query = song && artist ? `${artist} - ${song}` : "";
    if (!query) {
      const title = html.match(/<title>(.*?)<\/title>/)?.[1];
      if (!title || /web player/i.test(title)) {
        throw new Error("Could not read track info from Spotify.");
      }
      query = title.replace(/ - song (and lyrics )?by/, " ").replace(/ \| Spotify$/, "");
    }
    return `ytsearch1:${decodeEntities(query).trim()} audio`;
  };

  /* ─── Listing formats ────────────────────────────────────── */

  const codecName = (vcodec: string) => {
    if (/^(avc1|avc3|h264)/i.test(vcodec)) return "H.264";
    if (/^(hvc1|hev1|h265|hevc)/i.test(vcodec)) return "H.265";
    if (/vp0?9/i.test(vcodec)) return "VP9";
    if (/av01|av1/i.test(vcodec)) return "AV1";
    if (/vp0?8/i.test(vcodec)) return "VP8";
    return vcodec === "unknown" ? "" : vcodec;
  };

  const isEditFriendlyVideo = (vcodec: string, ext: string) =>
    /^(avc|hvc|hev|h264|h265)/i.test(vcodec) && ["mp4", "mov", "m4v"].includes(ext);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type RawFormat = Record<string, any>;

  const listFormats = async (
    url: string,
    audioOnly = false,
    onProgress?: ProgressFn
  ): Promise<YtdlpFormat[]> => {
    if (isSpotifyUrl(url)) {
      audioOnly = true;
      url = await spotifyToSearch(url);
    }

    const tools = await ensureTools(onProgress);
    // -J prints nothing until it's finished, so use a hard timeout instead of an idle one.
    const result = await runYtDlp(
      tools,
      [...baseArgs(tools), "-J", "--no-warnings", url],
      { timeoutMs: 120_000 },
      onProgress
    );
    if (result.code !== 0) throw new Error(friendlyError(result.stderr, result.stdout));

    let info: RawFormat;
    try {
      info = JSON.parse(result.stdout);
    } catch {
      throw new Error("Could not parse format list from yt-dlp.");
    }
    const raw: RawFormat[] = info.formats ?? info.entries?.[0]?.formats ?? [];

    if (audioOnly) {
      const abr = (f: RawFormat): number => f.abr || f.tbr || 0;
      const audio = raw.filter(
        (f) => (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none" && abr(f) > 0
      );
      // One entry per ~10 kbps tier; prefer AAC (no lossy re-encode when importing).
      const byBucket = new Map<number, RawFormat>();
      for (const f of audio) {
        const bucket = Math.round(abr(f) / 10) * 10;
        const existing = byBucket.get(bucket);
        if (!existing || abr(f) > abr(existing)) byBucket.set(bucket, f);
      }
      const sorted = [...byBucket.values()].sort((a, b) => abr(b) - abr(a));
      if (sorted.length === 0) throw new Error("No audio streams found for this URL.");

      return sorted.map((f, idx) => {
        const acodec: string = f.acodec;
        const codec = acodec.startsWith("mp4a")
          ? "AAC"
          : acodec === "opus"
            ? "Opus"
            : acodec.toUpperCase();
        return {
          id: String(f.format_id),
          ext: f.ext,
          resolution: "audio only",
          fps: "",
          vcodec: "none",
          acodec,
          label: `${Math.round(abr(f))} kbps · ${String(f.ext).toUpperCase()} (${codec})${idx === 0 ? " ★ Highest" : ""}`,
        };
      });
    }

    const VALID_EXTS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "flv"]);
    const video = raw.filter(
      (f) =>
        typeof f.height === "number" &&
        f.height >= 144 &&
        VALID_EXTS.has(f.ext) &&
        f.vcodec &&
        f.vcodec !== "none" &&
        // Skip storyboards / image tracks
        f.protocol !== "mhtml"
    );

    // One entry per resolution + frame rate. Within a tier prefer formats
    // Premiere can use directly (H.264 MP4), then SDR, then higher bitrate.
    const fpsOf = (f: RawFormat) => (f.fps ? Math.round(f.fps) : 0);
    const score = (f: RawFormat) =>
      (isEditFriendlyVideo(f.vcodec, f.ext) ? 1e9 : 0) +
      (!f.dynamic_range || f.dynamic_range === "SDR" ? 1e8 : 0) +
      (f.tbr || f.vbr || 0);
    const byTier = new Map<string, RawFormat>();
    for (const f of video) {
      const key = `${f.height}@${fpsOf(f)}`;
      const existing = byTier.get(key);
      if (!existing || score(f) > score(existing)) byTier.set(key, f);
    }
    const sorted = [...byTier.values()].sort(
      (a, b) => b.height - a.height || fpsOf(b) - fpsOf(a)
    );
    if (sorted.length === 0) throw new Error("No video formats found for this URL.");

    return sorted.map((f) => {
      const fid = String(f.format_id);
      const hasAudio = f.acodec && f.acodec !== "none";
      const codec = codecName(f.vcodec);
      const fps = f.fps ? ` · ${fpsOf(f)}fps` : "";
      const hdr = f.dynamic_range && f.dynamic_range !== "SDR" ? ` ${f.dynamic_range}` : "";
      const convert = isEditFriendlyVideo(f.vcodec, f.ext) ? "" : " (Auto-Convert)";
      return {
        // The id is a full yt-dlp selector so video-only streams get the best
        // (preferably AAC) audio merged in.
        id: hasAudio ? fid : `${fid}+bestaudio[acodec^=mp4a]/${fid}+bestaudio/${fid}`,
        ext: f.ext,
        resolution: f.resolution ?? `${f.width}x${f.height}`,
        fps: f.fps ? String(fpsOf(f)) : "",
        vcodec: f.vcodec,
        acodec: f.acodec ?? "",
        label: `${f.height}p${fps}${hdr} · ${String(f.ext).toUpperCase()}${codec ? ` (${codec})` : ""}${convert}`,
      };
    });
  };

  /* ─── Post-processing ────────────────────────────────────── */

  type Probe = { vcodec: string | null; acodec: string | null; duration: number | null };

  const probe = async (ffmpeg: string, file: string): Promise<Probe> => {
    const result = await runProcess(ffmpeg, ["-hide_banner", "-i", file], {
      timeoutMs: 30_000,
    }).catch(() => null);
    const text = result?.stderr ?? "";
    const v = text.match(/Stream #[^\n]*?Video: (\w+)(?![^\n]*attached pic)/);
    const a = text.match(/Stream #[^\n]*?Audio: (\w+)/);
    const d = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
    return {
      vcodec: v ? v[1].toLowerCase() : null,
      acodec: a ? a[1].toLowerCase() : null,
      duration: d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : null,
    };
  };

  const h264Args = (): string[] =>
    // VideoToolbox is many times faster than x264 on Macs; quality is set
    // high enough that it's visually lossless for editing.
    isMac
      ? ["-c:v", "h264_videotoolbox", "-q:v", "70", "-allow_sw", "1", "-pix_fmt", "yuv420p"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p"];

  const runFfmpeg = async (
    ffmpeg: string,
    args: string[],
    duration: number | null,
    label: string,
    onProgress?: ProgressFn
  ) =>
    runProcess(ffmpeg, ["-y", "-hide_banner", ...args], {
      idleTimeoutMs: 180_000,
      onLine: (line) => {
        const t = line.match(/time=(\d+):(\d+):([\d.]+)/);
        if (!t) return;
        const secs = +t[1] * 3600 + +t[2] * 60 + parseFloat(t[3]);
        const pct = duration ? Math.min(99, (secs / duration) * 100) : null;
        onProgress?.({ percent: pct, line: `${label}${pct !== null ? ` ${Math.floor(pct)}%` : "…"}` });
      },
    });

  const swapExtension = (file: string, ext: string) =>
    path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.${ext}`);

  /** Re-encode with the given args, falling back to x264 if VideoToolbox isn't usable. */
  const encode = async (
    ffmpeg: string,
    inputArgs: string[],
    videoArgs: string[] | null,
    restArgs: string[],
    output: string,
    duration: number | null,
    label: string,
    onProgress?: ProgressFn
  ) => {
    const tmp = `${output}.converting${path.extname(output)}`;
    const attempt = (v: string[]) =>
      runFfmpeg(ffmpeg, [...inputArgs, ...v, ...restArgs, tmp], duration, label, onProgress);
    let result = await attempt(videoArgs ?? []);
    if (result.code !== 0 && videoArgs && videoArgs.includes("h264_videotoolbox")) {
      result = await attempt(["-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p"]);
    }
    if (result.code !== 0 || !isFile(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {}
      throw new Error(`${label.replace(/…$/, "")} failed: ${friendlyError(result.stderr)}`);
    }
    return tmp;
  };

  /**
   * Premiere/AE can't use VP9/AV1 video or Opus/Vorbis audio. Convert only
   * what's needed (video and audio are handled independently) into MP4.
   */
  const makeEditFriendly = async (
    ffmpeg: string,
    file: string,
    onProgress?: ProgressFn
  ): Promise<string> => {
    const info = await probe(ffmpeg, file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const videoOk = !info.vcodec || VIDEO_OK.has(info.vcodec);
    const audioOk = !info.acodec || AUDIO_OK.has(info.acodec);
    if (videoOk && audioOk && ["mp4", "mov", "m4v"].includes(ext)) return file;

    const label = videoOk ? "Converting audio for Premiere…" : "Converting video to H.264 for Premiere…";
    onProgress?.({ percent: null, line: label });
    const output = swapExtension(file, "mp4");
    const tmp = await encode(
      ffmpeg,
      ["-i", file, "-map", "0:v:0?", "-map", "0:a:0?"],
      videoOk ? ["-c:v", "copy"] : h264Args(),
      [...(audioOk ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "320k"]), "-movflags", "+faststart"],
      output,
      info.duration,
      label,
      onProgress
    );
    try {
      fs.unlinkSync(file);
    } catch (_) {}
    try {
      fs.unlinkSync(output);
    } catch (_) {}
    fs.renameSync(tmp, output);
    return output;
  };

  /** Frame-accurate trim of an already-downloaded file (fallback path). */
  const trimFile = async (
    ffmpeg: string,
    file: string,
    start: number,
    end: number,
    audioOnly: boolean,
    onProgress?: ProgressFn
  ): Promise<string> => {
    const label = "Trimming…";
    onProgress?.({ percent: null, line: label });
    const output = file;
    const tmp = await encode(
      ffmpeg,
      ["-ss", String(start), "-to", String(end), "-i", file],
      audioOnly ? ["-vn"] : h264Args(),
      [
        ...(audioOnly ? ["-c:a", "libmp3lame", "-q:a", "0"] : ["-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart"]),
      ],
      output,
      end - start,
      label,
      onProgress
    );
    try {
      fs.unlinkSync(file);
    } catch (_) {}
    fs.renameSync(tmp, output);
    return output;
  };

  /* ─── Download ───────────────────────────────────────────── */

  const PROGRESS_TAG = "[saucer-progress]";
  const FILE_TAG = "[saucer-file]";

  const downloadMedia = async (
    request: DownloadRequest,
    onProgress?: ProgressFn
  ): Promise<DownloadResult> => {
    let targetUrl = request.url.trim();
    let audioOnly = request.audioOnly;

    if (isSpotifyUrl(targetUrl)) {
      audioOnly = true;
      onProgress?.({ percent: null, line: "Reading Spotify track info…" });
      targetUrl = await spotifyToSearch(targetUrl);
    }

    const tools = await ensureTools(onProgress);
    fs.mkdirSync(request.outputDir, { recursive: true });

    const start = request.trimStart ? parseTimecode(request.trimStart) : null;
    const end = request.trimEnd ? parseTimecode(request.trimEnd) : null;
    const hasTrim = start !== null && end !== null && end > start;
    const trimSuffix = hasTrim
      ? ` (${request.trimStart!.replace(/:/g, "-")} to ${request.trimEnd!.replace(/:/g, "-")})`
      : "";

    const args = [
      ...baseArgs(tools),
      "--newline",
      "--progress",
      "--no-mtime",
      "--concurrent-fragments",
      "4",
      "--progress-template",
      `download:${PROGRESS_TAG} %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s`,
      "--print",
      `after_move:${FILE_TAG}%(filepath)s`,
      "-o",
      path.join(request.outputDir, `%(title).150B [%(id)s]${trimSuffix}.%(ext)s`),
    ];

    if (/youtube\.com|youtu\.be|^ytsearch/i.test(targetUrl)) {
      args.push("--http-chunk-size", "10M");
    }

    const manual = request.quality === "manual" && request.formatId;
    if (audioOnly) {
      args.push(
        "-f",
        manual ? request.formatId! : "bestaudio/best",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0"
      );
    } else {
      args.push(
        "-f",
        manual ? request.formatId! : "bv*+ba/b",
        // Highest resolution & frame rate first; at equal quality prefer
        // H.264 + AAC so no conversion is needed afterwards.
        "-S",
        "res,fps,hdr:SDR,vcodec:h264,acodec:aac,ext:mp4:m4a",
        "--merge-output-format",
        "mp4"
      );
    }

    // Progress: yt-dlp downloads video and audio separately, each 0→100%.
    // Map the first stream to 0–90% and anything after to 90–99%.
    let stream = 0;
    let lastPct = 0;
    const onLine = (line: string) => {
      if (!line.startsWith(PROGRESS_TAG)) {
        if (/^(WARNING|ERROR)/.test(line)) console.log("[yt-dlp]", line);
        return;
      }
      const [, done, total] = line.split(" ");
      const pct = Number(done) / Number(total);
      if (!isFinite(pct)) return;
      if (pct * 100 < lastPct - 50) stream++;
      lastPct = pct * 100;
      const overall = stream === 0 ? pct * 90 : 90 + pct * 9;
      const what = audioOnly ? "audio" : stream === 0 ? "video" : "audio";
      onProgress?.({ percent: overall, line: `Downloading ${what}… ${Math.floor(pct * 100)}%` });
    };
    const runOptions: RunOptions = { onLine, idleTimeoutMs: 180_000 };

    const sectionArgs = hasTrim
      ? ["--download-sections", `*${start}-${end}`, "--force-keyframes-at-cuts"]
      : [];

    onProgress?.({ percent: null, line: "Connecting…" });
    let result = await runYtDlp(tools, [...args, ...sectionArgs, targetUrl], runOptions, onProgress);
    let trimmedByYtDlp = hasTrim;

    const unrecoverable = /sign in|logged-in|login|private|unsupported url|unavailable|not available in your/i;
    if (hasTrim && result.code !== 0 && !unrecoverable.test(result.stderr)) {
      // Section downloads are unsupported on some sites/streams.
      // Fall back to the full file and trim locally.
      onProgress?.({ percent: null, line: "Clip download unavailable — downloading full video to trim…" });
      stream = 0;
      lastPct = 0;
      result = await runYtDlp(tools, [...args, targetUrl], runOptions, onProgress);
      trimmedByYtDlp = false;
    }

    if (result.code !== 0) throw new Error(friendlyError(result.stderr, result.stdout));

    const printed = result.stdout
      .split(/\r?\n/)
      .filter((l) => l.startsWith(FILE_TAG))
      .map((l) => l.slice(FILE_TAG.length).trim());
    let filePath = printed[printed.length - 1] || "";
    if (!filePath || !isFile(filePath)) {
      throw new Error("Download finished but the output file was not found.");
    }

    if (hasTrim && !trimmedByYtDlp) {
      filePath = await trimFile(tools.ffmpeg, filePath, start!, end!, audioOnly, onProgress);
    }
    if (!audioOnly) {
      filePath = await makeEditFriendly(tools.ffmpeg, filePath, onProgress);
    }

    onProgress?.({ percent: 100, line: "Download complete." });
    return { filePath };
  };

  return { ensureTools, listFormats, downloadMedia, dataDir };
};
