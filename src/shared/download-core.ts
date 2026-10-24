/**
 * Supreme Saucer — Download engine (shared by the CEP panel and the sidecar)
 *
 * Node built-ins are injected so the same code runs inside CEP (where they
 * come from `window.cep_node.require`) and in the standalone sidecar.
 *
 * Everything runs locally on the user's machine: yt-dlp fetches media
 * straight from the site, ffmpeg merges/trims/converts it, deno solves
 * YouTube's JavaScript challenges. No server of ours is involved.
 */

import type {
  AudioFormat,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  EngineStatus,
  EngineTool,
  MediaInfo,
  ProbeRequest,
  YtdlpFormat,
} from "./supreme-saucer";
import { CANCELLED_MESSAGE, isSpotifyUrl, parseTimecode } from "./supreme-saucer";

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

type Tool = EngineTool["id"];
type ProgressFn = (progress: DownloadProgress) => void;
type RunResult = { stdout: string; stderr: string; code: number | null };
type RunOptions = {
  onLine?: (line: string) => void;
  /** Kill the process if it produces no output for this long. */
  idleTimeoutMs?: number;
  /** Hard cap regardless of output. */
  timeoutMs?: number;
};
type Settings = { autoUpdate: boolean };

const TOOLS: Tool[] = ["yt-dlp", "ffmpeg", "ffprobe", "deno"];

const TOOL_INFO: Record<Tool, { label: string; role: string }> = {
  "yt-dlp": { label: "yt-dlp", role: "Downloads from YouTube, Instagram, X and 1,000+ sites" },
  ffmpeg: { label: "FFmpeg", role: "Merges, trims and converts for Premiere" },
  ffprobe: { label: "FFprobe", role: "Reads media info for trimming and audio" },
  deno: { label: "Deno", role: "Unlocks full YouTube quality (4K, 60fps)" },
};

const YTDLP_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LATEST_CHECK_TTL_MS = 60 * 60 * 1000;

// yt-dlp errors that usually mean "your yt-dlp is too old for this site".
const STALE_YTDLP_PATTERN =
  /http error 403|requested format is not available|nsig|signature|unable to extract|player response|precondition failed/i;

const SIGN_IN_HINT = " Turn on “Use browser login” in Settings and make sure you're logged in there.";

const ERROR_HINTS: [RegExp, string][] = [
  [
    /sign in to confirm (your age|you.re not a bot)|age.restricted/i,
    `YouTube wants you to sign in for this video (age-restricted or bot check).${SIGN_IN_HINT}`,
  ],
  [
    /private video|this video is private|login required|logged-in|requires? (login|authentication)|use --cookies|rate-limit reached|empty media response/i,
    `This post is private or needs you to be logged in.${SIGN_IN_HINT}`,
  ],
  [/could not (find|copy) .*cookies|cookies database|keyring/i, "Couldn't read your browser's login. Close the browser and try again, or pick another browser in Settings."],
  [/unsupported url/i, "This site or link isn't supported."],
  [/unable to obtain file audio codec|does not contain any stream|no audio/i, "This video has no audio track."],
  [
    /no video formats found|no formats found|there is no video in this/i,
    "No downloadable video was found at this link (image posts aren't supported).",
  ],
  [
    /geo.?restrict|not available in your country|not made this video available in your country/i,
    "This content is not available in your region.",
  ],
  [/video unavailable|has been removed|account (has been )?terminated/i, "This video is unavailable or has been removed."],
  [/live event will begin|is not currently live|premieres in/i, "This livestream or premiere hasn't started yet."],
  [
    /getaddrinfo|name or service not known|network is unreachable|connection (reset|refused)|timed out/i,
    "Network error — check your connection and try again.",
  ],
  [/http error 403/i, "The site blocked the download (HTTP 403). Try again in a minute."],
];

const VIDEO_OK = new Set(["h264", "hevc", "prores", "mpeg4", "dnxhd"]);
const AUDIO_OK = new Set(["aac", "mp3", "alac", "ac3", "eac3"]);

/** "2026.10.21" > "2026.9.3" */
const compareVersions = (a: string, b: string) => {
  const pa = a.split(/[^\d]+/).filter(Boolean).map(Number);
  const pb = b.split(/[^\d]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
};

export const createDownloader = (deps: DownloaderDeps) => {
  const { child_process, fs, os, path, https } = deps;
  const isWin = os.platform() === "win32";
  const isMac = os.platform() === "darwin";
  const env: Record<string, string | undefined> =
    typeof process !== "undefined" ? process.env : {};

  const exe = (tool: Tool) => (isWin ? `${tool}.exe` : tool);

  /* ─── Locations & settings ───────────────────────────────── */

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
  const settingsPath = () => path.join(dataDir(), "settings.json");

  const readSettings = (): Settings => {
    try {
      return { autoUpdate: true, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
    } catch {
      return { autoUpdate: true };
    }
  };

  const setAutoUpdate = (autoUpdate: boolean) => {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), autoUpdate }, null, 2));
  };

  const systemBinDirs = (): string[] => {
    const fromPath = (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
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

  /** Where a tool is right now, without installing anything. */
  const findExisting = (tool: Tool): string | null =>
    findIn([managedBinDir()], tool) ||
    findIn(deps.bundledBinDirs(), tool) ||
    findIn(systemBinDirs(), tool);

  /* ─── Process runner (with cancellation) ─────────────────── */

  const active = new Set<import("child_process").ChildProcess>();
  let generation = 0;

  /**
   * Kill a process and everything it started (yt-dlp runs ffmpeg as a child;
   * killing only yt-dlp would leave ffmpeg running and the file locked).
   */
  const killTree = (child: import("child_process").ChildProcess) => {
    try {
      if (isWin && child.pid) {
        child_process.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else if (child.pid) {
        process.kill(-child.pid, "SIGTERM"); // whole process group (spawned detached)
      } else {
        child.kill();
      }
    } catch (_) {
      try {
        child.kill();
      } catch (_) {}
    }
  };

  /** Stops every running download/conversion. */
  const cancel = () => {
    generation++;
    for (const child of active) killTree(child);
  };

  const runProcess = (binary: string, args: string[], options: RunOptions = {}): Promise<RunResult> =>
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
      // On macOS/Linux, `detached` makes the child a process-group leader so
      // killTree can stop its children too.
      const child = child_process.spawn(binary, args, { windowsHide: true, env: childEnv, detached: !isWin });
      active.add(child);
      let stdout = "";
      let stderr = "";
      let settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        active.delete(child);
        if (idleTimer) clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        fn();
      };

      const kill = (reason: string) =>
        finish(() => {
          killTree(child);
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

  /* ─── HTTP ───────────────────────────────────────────────── */

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

  /**
   * Plain GET returning the body. `browserless` omits the User-Agent:
   * Spotify serves a JS-only shell to browsers but full og: tags otherwise.
   */
  const fetchText = (url: string, headers: Record<string, string> = {}, redirects = 0): Promise<string> =>
    new Promise((resolve, reject) => {
      const req = https.get(url, { headers }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirects < 5) {
          res.resume();
          fetchText(new URL(res.headers.location, url).href, headers, redirects + 1).then(resolve, reject);
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => (status >= 400 ? reject(new Error(`HTTP ${status}`)) : resolve(data)));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(20_000, () => req.destroy(new Error("Request timed out.")));
    });

  /* ─── Installing tools ───────────────────────────────────── */

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
    const gh = (repo: string, file: string) => `https://github.com/${repo}/releases/latest/download/${file}`;

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

  const installTool = async (tool: Tool, onProgress?: ProgressFn): Promise<string> => {
    const binDir = managedBinDir();
    fs.mkdirSync(binDir, { recursive: true });
    const source = sourceFor(tool);
    const label = TOOL_INFO[tool].label;
    const report = (pct: number | null) =>
      onProgress?.({
        percent: pct,
        line: `Installing ${label}${pct !== null ? ` ${Math.floor(pct)}%` : "…"}`,
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
      onProgress?.({ percent: null, line: `Unpacking ${label}…` });
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

  /** Self-update yt-dlp if it's ours (and, unless forced, hasn't been checked today). */
  const updateYtDlp = async (ytDlp: string, force: boolean, onProgress?: ProgressFn) => {
    if (!ytDlp.startsWith(managedBinDir())) return false;
    if (!force) {
      if (!readSettings().autoUpdate) return false;
      try {
        const last = fs.statSync(updateStampPath()).mtimeMs;
        if (Date.now() - last < YTDLP_UPDATE_INTERVAL_MS) return false;
      } catch (_) {}
    }
    onProgress?.({ percent: null, line: "Updating yt-dlp…" });
    try {
      const result = await runProcess(ytDlp, ["-U"], { idleTimeoutMs: 90_000 });
      fs.writeFileSync(updateStampPath(), new Date().toISOString());
      latestCache = null;
      return /updated yt-dlp to|updating to/i.test(result.stdout + result.stderr);
    } catch {
      return false;
    }
  };

  type Toolset = { ytDlp: string; ffmpeg: string; deno: string | null };

  /**
   * Make sure every tool is available, installing whatever is missing.
   * Cheap once everything is installed.
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

  /* ─── Engine status / install / update ───────────────────── */

  let latestCache: { version: string | null; at: number } | null = null;

  const fetchLatestYtDlp = async (): Promise<string | null> => {
    if (latestCache && Date.now() - latestCache.at < LATEST_CHECK_TTL_MS) return latestCache.version;
    try {
      const body = await fetchText("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
        "User-Agent": "SupremeSaucer",
        Accept: "application/vnd.github+json",
      });
      const version = (JSON.parse(body).tag_name as string) || null;
      latestCache = { version, at: Date.now() };
      return version;
    } catch {
      return null;
    }
  };

  const toolVersion = async (tool: Tool, file: string): Promise<string | null> => {
    const args = tool === "yt-dlp" ? ["--version"] : tool === "deno" ? ["--version"] : ["-version"];
    try {
      const { stdout } = await runProcess(file, args, { timeoutMs: 30_000 });
      if (tool === "yt-dlp") return stdout.trim() || null;
      if (tool === "deno") return stdout.match(/deno (\S+)/)?.[1] ?? null;
      // "9.0.2-https://www.martin-riedl.de" (macOS) or "N-121357-g1234abcd-20261020" (Windows nightly)
      const raw = stdout.match(/version (\S+)/)?.[1];
      return raw ? raw.replace(/-https?:.*$/, "").replace(/^(N-\d+).*$/, "$1") : null;
    } catch {
      return null;
    }
  };

  const getEngineStatus = async (checkRemote = false): Promise<EngineStatus> => {
    const tools: EngineTool[] = await Promise.all(
      TOOLS.map(async (id) => {
        const file = findExisting(id);
        return {
          id,
          ...TOOL_INFO[id],
          installed: Boolean(file),
          version: file ? await toolVersion(id, file) : null,
          managed: Boolean(file && file.startsWith(managedBinDir())),
        };
      })
    );
    const latestYtDlp = checkRemote ? await fetchLatestYtDlp() : latestCache?.version ?? null;
    const ytDlp = tools[0];
    return {
      ready: tools.every((t) => t.installed),
      tools,
      latestYtDlp,
      updateAvailable: Boolean(
        latestYtDlp && ytDlp.version && compareVersions(latestYtDlp, ytDlp.version) > 0
      ),
      autoUpdate: readSettings().autoUpdate,
      folder: managedBinDir(),
    };
  };

  const installEngine = async (onProgress?: ProgressFn) => {
    await ensureTools(onProgress);
    return getEngineStatus(true);
  };

  const updateEngine = async (onProgress?: ProgressFn) => {
    const ytDlp = await locateOrInstall("yt-dlp", onProgress);
    if (ytDlp.startsWith(managedBinDir())) {
      await updateYtDlp(ytDlp, true, onProgress);
    }
    const status = await getEngineStatus(true);
    if (status.updateAvailable) {
      // -U failed (e.g. GitHub rate limit on the updater) — fetch the binary directly.
      await installTool("yt-dlp", onProgress);
      latestCache = null;
      return getEngineStatus(true);
    }
    return status;
  };

  /** Deletes our copies of every tool and installs fresh ones. */
  const repairEngine = async (onProgress?: ProgressFn) => {
    onProgress?.({ percent: null, line: "Removing old engine files…" });
    try {
      fs.rmSync(managedBinDir(), { recursive: true, force: true });
    } catch (_) {}
    for (const tool of TOOLS) {
      // On Windows one archive provides both ffmpeg and ffprobe.
      if (!findIn([managedBinDir()], tool)) await installTool(tool, onProgress).catch(() => null);
    }
    return installEngine(onProgress);
  };

  /* ─── yt-dlp helpers ─────────────────────────────────────── */

  const baseArgs = (tools: Toolset, cookiesFrom?: string): string[] => {
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
    if (cookiesFrom && cookiesFrom !== "none") args.push("--cookies-from-browser", cookiesFrom);
    return args;
  };

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

  type SpotifyTrack = { song: string; artist: string; duration: number | null; image: string | null };

  const decodeEntities = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

  const spotifyCache = new Map<string, SpotifyTrack>();

  const readSpotifyTrack = async (url: string): Promise<SpotifyTrack> => {
    if (/\/(playlist|album|artist|show|episode)\//i.test(url)) {
      throw new Error("Spotify playlists, albums and podcasts aren't supported yet. Paste a track link.");
    }
    const cached = spotifyCache.get(url);
    if (cached) return cached;
    const html = await fetchText(url);
    const meta = (prop: string) => {
      const value = html.match(new RegExp(`(?:property|name)="${prop}" content="([^"]*)"`))?.[1];
      return value ? decodeEntities(value) : null;
    };
    const song = meta("og:title");
    // og:description looks like "Artist · Album · Song · 2020"
    const artist = meta("og:description")?.split(" · ")[0];
    if (!song || !artist) throw new Error("Could not read track info from Spotify.");
    const duration = Number(meta("music:duration")) || null;
    const track = { song, artist, duration, image: meta("og:image") };
    spotifyCache.set(url, track);
    return track;
  };

  /* ─── Preview / formats ──────────────────────────────────── */

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

  const videoFormatsFrom = (raw: RawFormat[]): YtdlpFormat[] => {
    const VALID_EXTS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "flv"]);
    const video = raw.filter(
      (f) =>
        typeof f.height === "number" &&
        f.height >= 144 &&
        VALID_EXTS.has(f.ext) &&
        f.vcodec &&
        f.vcodec !== "none" &&
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
    return [...byTier.values()]
      .sort((a, b) => b.height - a.height || fpsOf(b) - fpsOf(a))
      .map((f) => {
        const fid = String(f.format_id);
        const hasAudio = f.acodec && f.acodec !== "none";
        const native = isEditFriendlyVideo(f.vcodec, f.ext);
        const fps = fpsOf(f) > 30 ? ` ${fpsOf(f)}` : "";
        const hdr = f.dynamic_range && f.dynamic_range !== "SDR" ? ` ${f.dynamic_range}` : "";
        return {
          // A full selector so video-only streams get the best (preferably AAC) audio merged in.
          id: hasAudio ? fid : `${fid}+bestaudio[acodec^=mp4a]/${fid}+bestaudio/${fid}`,
          ext: f.ext,
          resolution: f.resolution ?? `${f.width}x${f.height}`,
          fps: f.fps ? String(fpsOf(f)) : "",
          vcodec: f.vcodec,
          acodec: f.acodec ?? "",
          label: `${f.height}p${fps}${hdr} · ${codecName(f.vcodec) || String(f.ext).toUpperCase()}`,
          native,
        };
      });
  };

  const probeUrl = async (request: ProbeRequest, onProgress?: ProgressFn): Promise<MediaInfo> => {
    const url = request.url.trim();

    if (isSpotifyUrl(url)) {
      const track = await readSpotifyTrack(url);
      return {
        url,
        site: "Spotify",
        title: track.song,
        uploader: track.artist,
        duration: track.duration,
        thumbnail: track.image,
        isSpotify: true,
        videoFormats: [],
      };
    }

    const tools = await ensureTools(onProgress);
    // -J prints nothing until it's finished, so use a hard timeout instead of an idle one.
    const result = await runYtDlp(
      tools,
      [...baseArgs(tools, request.cookiesFrom), "-J", "--no-warnings", url],
      { timeoutMs: 120_000 },
      onProgress
    );
    if (result.code !== 0) throw new Error(friendlyError(result.stderr, result.stdout));

    let info: RawFormat;
    try {
      info = JSON.parse(result.stdout);
    } catch {
      throw new Error("Could not read media info from yt-dlp.");
    }
    const item: RawFormat = info.entries?.[0] ?? info;
    const thumbs: RawFormat[] = Array.isArray(item.thumbnails) ? item.thumbnails : [];
    // Prefer a mid-sized thumbnail; the largest can be several MB.
    const thumb =
      thumbs.filter((t) => t.url && (!t.width || t.width <= 1280)).pop()?.url ?? item.thumbnail ?? null;

    return {
      url,
      site: item.extractor_key || item.extractor || new URL(url).hostname.replace(/^www\./, ""),
      title: item.title || item.fulltitle || "Untitled",
      uploader: item.uploader || item.channel || item.creator || null,
      duration: typeof item.duration === "number" ? item.duration : null,
      thumbnail: thumb,
      isSpotify: false,
      videoFormats: videoFormatsFrom(item.formats ?? []),
    };
  };

  /* ─── Post-processing ────────────────────────────────────── */

  type Probe = { vcodec: string | null; acodec: string | null; duration: number | null };

  const probeFile = async (ffmpeg: string, file: string): Promise<Probe> => {
    const result = await runProcess(ffmpeg, ["-hide_banner", "-i", file], { timeoutMs: 30_000 }).catch(
      () => null
    );
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

  const X264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p"];

  const h264Args = (): string[] =>
    // VideoToolbox is many times faster than x264 on Macs; quality is set
    // high enough that it's visually lossless for editing.
    isMac ? ["-c:v", "h264_videotoolbox", "-q:v", "70", "-allow_sw", "1", "-pix_fmt", "yuv420p"] : X264;

  const runFfmpeg = (
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
        onProgress?.({ percent: pct, line: `${label}${pct !== null ? ` ${Math.floor(pct)}%` : ""}` });
      },
    });

  const swapExtension = (file: string, ext: string) =>
    path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.${ext}`);

  /** Encode into a temp file next to `output`, falling back to x264 if VideoToolbox isn't usable. */
  const encode = async (
    ffmpeg: string,
    inputArgs: string[],
    videoArgs: string[],
    restArgs: string[],
    output: string,
    duration: number | null,
    label: string,
    onProgress?: ProgressFn
  ) => {
    const tmp = `${output}.converting${path.extname(output)}`;
    const attempt = (v: string[]) =>
      runFfmpeg(ffmpeg, [...inputArgs, ...v, ...restArgs, tmp], duration, label, onProgress);
    let result = await attempt(videoArgs);
    if (result.code !== 0 && videoArgs.includes("h264_videotoolbox")) result = await attempt(X264);
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
   * what's needed (video and audio independently) into MP4.
   */
  const makeEditFriendly = async (ffmpeg: string, file: string, onProgress?: ProgressFn): Promise<string> => {
    const info = await probeFile(ffmpeg, file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const videoOk = !info.vcodec || VIDEO_OK.has(info.vcodec);
    const audioOk = !info.acodec || AUDIO_OK.has(info.acodec);
    if (videoOk && audioOk && ["mp4", "mov", "m4v"].includes(ext)) return file;

    const label = videoOk ? "Converting audio for Premiere…" : "Converting to H.264 for Premiere…";
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
    for (const f of [file, output]) {
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    }
    fs.renameSync(tmp, output);
    return output;
  };

  const audioCodecArgs: Record<AudioFormat, string[]> = {
    mp3: ["-c:a", "libmp3lame", "-b:a", "320k"],
    wav: ["-c:a", "pcm_s16le"],
    m4a: ["-c:a", "aac", "-b:a", "256k"],
  };

  /** Frame-accurate trim of an already-downloaded file (fallback path). */
  const trimFile = async (
    ffmpeg: string,
    file: string,
    start: number,
    end: number,
    audioFormat: AudioFormat | null,
    onProgress?: ProgressFn
  ): Promise<string> => {
    const label = "Trimming…";
    onProgress?.({ percent: null, line: label });
    const tmp = await encode(
      ffmpeg,
      ["-ss", String(start), "-to", String(end), "-i", file],
      audioFormat ? ["-vn"] : h264Args(),
      audioFormat ? audioCodecArgs[audioFormat] : ["-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart"],
      file,
      end - start,
      label,
      onProgress
    );
    try {
      fs.unlinkSync(file);
    } catch (_) {}
    fs.renameSync(tmp, file);
    return file;
  };

  /** "Title.mp4" → "Title (2).mp4" … so earlier downloads are never overwritten. */
  const uniquePath = (dir: string, fileName: string) => {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    let candidate = path.join(dir, fileName);
    for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${base} (${n})${ext}`);
    return candidate;
  };

  const removeDir = (dir: string) => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  };

  /* ─── Download ───────────────────────────────────────────── */

  const PROGRESS_TAG = "[saucer-progress]";
  const FILE_TAG = "[saucer-file]";

  const safeName = (s: string) =>
    s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/%/g, "%%").trim().slice(0, isWin ? 80 : 150);

  const downloadMedia = async (request: DownloadRequest, onProgress?: ProgressFn): Promise<DownloadResult> => {
    const myGeneration = generation;
    const checkCancelled = () => {
      if (generation !== myGeneration) throw new Error(CANCELLED_MESSAGE);
    };

    const url = request.url.trim();
    const spotify = isSpotifyUrl(url);
    const audioOnly = spotify || request.audioOnly;
    const audioFormat: AudioFormat | null = audioOnly ? request.audioFormat ?? "mp3" : null;

    // Spotify audio is DRM-protected, so (like every Spotify downloader) we
    // find the same track on YouTube Music — its "Songs" results are the
    // official audio uploads.
    let targets = [url];
    // Windows paths max out at 260 characters, so keep titles shorter there.
    let nameTemplate = `%(title).${isWin ? 80 : 150}B [%(id)s]`;
    if (spotify) {
      onProgress?.({ percent: null, line: "Reading Spotify track…" });
      const track = await readSpotifyTrack(url);
      const query = `${track.artist} ${track.song}`;
      targets = [
        `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`,
        `ytsearch1:${track.artist} - ${track.song} audio`,
      ];
      nameTemplate = safeName(`${track.artist} - ${track.song}`);
    }

    const tools = await ensureTools(onProgress);
    checkCancelled();
    // Work in a private folder: yt-dlp's audio extraction deletes its source
    // file and conversions replace files, so doing that directly in the
    // download folder could destroy an earlier download with the same name.
    // The finished file is moved out under a unique name.
    const workDir = path.join(request.outputDir, `.saucer-${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });

    const start = request.trimStart ? parseTimecode(request.trimStart) : null;
    const end = request.trimEnd ? parseTimecode(request.trimEnd) : null;
    const hasTrim = start !== null && end !== null && end > start;
    const trimSuffix = hasTrim
      ? ` (${request.trimStart!.replace(/:/g, "-")} to ${request.trimEnd!.replace(/:/g, "-")})`
      : "";

    const args = [
      ...baseArgs(tools, request.cookiesFrom),
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
      path.join(workDir, `${nameTemplate}${trimSuffix}.%(ext)s`),
    ];

    if (audioFormat) {
      args.push(
        "-f",
        audioFormat === "m4a" ? "bestaudio[acodec^=mp4a]/bestaudio/best" : "bestaudio/best",
        "-x",
        "--audio-format",
        audioFormat,
        ...(audioFormat === "mp3" ? ["--audio-quality", "320K"] : [])
      );
      if (audioFormat !== "wav") {
        // Title/artist tags and cover art, handy when browsing in the bin.
        args.push("--embed-metadata", "--embed-thumbnail", "--convert-thumbnails", "jpg");
      }
    } else {
      args.push(
        "-f",
        request.formatId || "bv*+ba/b",
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
    const sectionArgs = hasTrim ? ["--download-sections", `*${start}-${end}`, "--force-keyframes-at-cuts"] : [];
    const unrecoverable = /sign in|logged-in|login|private|unsupported url|unavailable|not available in your/i;

    let result: RunResult | null = null;
    let trimmedByYtDlp = hasTrim;
    try {
      for (const target of targets) {
        onProgress?.({ percent: null, line: spotify ? "Finding the track on YouTube Music…" : "Connecting…" });
        stream = 0;
        lastPct = 0;
        result = await runYtDlp(tools, [...args, ...sectionArgs, target], runOptions, onProgress);
        checkCancelled();
        trimmedByYtDlp = hasTrim;

        if (hasTrim && result.code !== 0 && !unrecoverable.test(result.stderr)) {
          // Section downloads are unsupported on some sites/streams.
          // Fall back to the full file and trim locally.
          onProgress?.({ percent: null, line: "Clip download unavailable — downloading full file to trim…" });
          stream = 0;
          lastPct = 0;
          result = await runYtDlp(tools, [...args, target], runOptions, onProgress);
          checkCancelled();
          trimmedByYtDlp = false;
        }
        if (result.code === 0) break;
      }

      if (!result || result.code !== 0) {
        throw new Error(result ? friendlyError(result.stderr, result.stdout) : "Download failed.");
      }

      const printed = result.stdout
        .split(/\r?\n/)
        .filter((l) => l.startsWith(FILE_TAG))
        .map((l) => l.slice(FILE_TAG.length).trim());
      let filePath = printed[printed.length - 1] || "";
      if (!filePath || !isFile(filePath)) {
        throw new Error("Download finished but the output file was not found.");
      }

      if (hasTrim && !trimmedByYtDlp) {
        filePath = await trimFile(tools.ffmpeg, filePath, start!, end!, audioFormat, onProgress);
        checkCancelled();
      }
      if (!audioFormat) {
        filePath = await makeEditFriendly(tools.ffmpeg, filePath, onProgress);
        checkCancelled();
      }

      const finalPath = uniquePath(request.outputDir, path.basename(filePath));
      fs.renameSync(filePath, finalPath);
      onProgress?.({ percent: 100, line: "Done." });
      return { filePath: finalPath };
    } catch (error) {
      if (generation !== myGeneration) throw new Error(CANCELLED_MESSAGE);
      throw error;
    } finally {
      removeDir(workDir);
    }
  };

  return {
    ensureTools,
    probeUrl,
    downloadMedia,
    cancel,
    getEngineStatus,
    installEngine,
    updateEngine,
    repairEngine,
    setAutoUpdate,
    dataDir,
  };
};

export type Downloader = ReturnType<typeof createDownloader>;
