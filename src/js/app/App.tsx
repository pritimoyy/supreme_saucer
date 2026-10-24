import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudioFormat,
  CookieBrowser,
  DownloadProgress,
  EngineStatus,
  MediaInfo,
} from "../../shared/supreme-saucer";
import {
  AUDIO_FORMATS,
  CANCELLED_MESSAGE,
  formatTimecode,
  isSpotifyUrl,
  isSupportedUrl,
  parseTimecode,
  validateTrim,
} from "../../shared/supreme-saucer";
import type { Backend, EngineAction } from "./backend";
import { Settings } from "./Settings";
import { Icon, ProgressBar, Segmented, Spinner, Switch } from "./ui";
import "./app.scss";

/* ─── Helpers ────────────────────────────────────────────────── */

const SITE_NAMES: Record<string, string> = {
  youtube: "YouTube",
  youtubetab: "YouTube",
  twitter: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  vimeo: "Vimeo",
  reddit: "Reddit",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  twitch: "Twitch",
  dailymotion: "Dailymotion",
};
const siteName = (site: string) => SITE_NAMES[site.toLowerCase().replace(/[^a-z]/g, "")] ?? site;

/** A preference that survives panel reloads. */
function usePref<T>(key: string, initial: T): [T, (value: T) => void] {
  const storageKey = `saucer.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch (_) {}
    },
    [storageKey]
  );
  return [value, update];
}

type Job =
  | { state: "running"; percent: number | null; line: string }
  | { state: "done"; filePath: string; imported: boolean }
  | { state: "error"; message: string }
  | { state: "cancelled" };

type Recent = { id: number; title: string; filePath: string; audio: boolean; imported: boolean };

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/* ─── App ────────────────────────────────────────────────────── */

export const App: React.FC<{ backend: Backend }> = ({ backend }) => {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");

  const [mode, setMode] = usePref<"video" | "audio">("mode", "video");
  const [audioFormat, setAudioFormat] = usePref<AudioFormat>("audioFormat", "mp3");
  const [cookiesFrom, setCookiesFrom] = usePref<CookieBrowser>("cookiesFrom", "none");
  const [importToProject, setImportToProject] = usePref("importToProject", true);
  const [quality, setQuality] = useState("");

  const [trimOn, setTrimOn] = useState(false);
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");

  const [job, setJob] = useState<Job | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);

  const [connected, setConnected] = useState<boolean | null>(backend.checkConnection ? null : true);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineTask, setEngineTask] = useState<DownloadProgress | null>(null);
  const [engineError, setEngineError] = useState("");
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const probeGeneration = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedUrl = url.trim();
  const validUrl = isSupportedUrl(trimmedUrl);
  const spotify = isSpotifyUrl(trimmedUrl);
  const audioLocked = spotify || Boolean(info && info.videoFormats.length === 0);
  const audioOnly = audioLocked || mode === "audio";
  const running = job?.state === "running";

  /* ─── Engine ─────────────────────────────────────────── */

  const refreshEngine = useCallback(
    async (checkRemote: boolean) => {
      const status = await backend.engineStatus(checkRemote);
      setEngine(status);
      return status;
    },
    [backend]
  );

  const runEngineAction = useCallback(
    async (action: EngineAction) => {
      setEngineError("");
      setEngineTask({ percent: null, line: action === "update" ? "Updating yt-dlp…" : "Preparing…" });
      try {
        setEngine(await backend.engineAction(action, setEngineTask));
        return true;
      } catch (error) {
        setEngineError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setEngineTask(null);
      }
    },
    [backend]
  );

  // Connect (UXP helper), read engine status, then check GitHub for updates.
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const boot = async () => {
      if (backend.checkConnection) {
        const ok = await backend.checkConnection();
        if (!alive) return;
        setConnected(ok);
        if (!ok) {
          retry = setTimeout(boot, 3000); // pick it up as soon as the helper starts
          return;
        }
      }
      try {
        const local = await refreshEngine(false);
        if (!alive || !local.ready) return;
        const remote = await refreshEngine(true);
        if (alive && remote.updateAvailable && remote.autoUpdate) void runEngineAction("update");
      } catch (error) {
        if (alive) setEngineError(error instanceof Error ? error.message : String(error));
      }
    };
    void boot();
    return () => {
      alive = false;
      clearTimeout(retry);
    };
  }, [backend, refreshEngine, runEngineAction]);

  const checkForUpdates = async () => {
    setCheckingUpdates(true);
    try {
      await refreshEngine(true);
      setUpdateDismissed(false);
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const toggleAutoUpdate = async (enabled: boolean) => {
    await backend.setAutoUpdate(enabled);
    setEngine((e) => (e ? { ...e, autoUpdate: enabled } : e));
  };

  /* ─── Link preview ───────────────────────────────────── */

  useEffect(() => {
    setInfo(null);
    setProbeError("");
    if (!validUrl || !connected) return;
    // Spotify previews come straight from Spotify; everything else needs yt-dlp.
    if (!spotify && !engine?.ready) return;

    const generation = ++probeGeneration.current;
    const timer = setTimeout(async () => {
      setProbing(true);
      try {
        const result = await backend.probe({ url: trimmedUrl, cookiesFrom });
        if (generation !== probeGeneration.current) return;
        setInfo(result);
        setQuality("");
        setTrimStart("");
        setTrimEnd("");
      } catch (error) {
        if (generation === probeGeneration.current) {
          setProbeError(error instanceof Error ? error.message : "Couldn't read this link.");
        }
      } finally {
        if (generation === probeGeneration.current) setProbing(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      probeGeneration.current++;
      setProbing(false);
    };
  }, [backend, trimmedUrl, validUrl, spotify, engine?.ready, connected, cookiesFrom]);

  /* ─── Actions ────────────────────────────────────────── */

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        return;
      }
    } catch (_) {}
    // CEP/UXP may block the async clipboard API; fall back to a native paste.
    inputRef.current?.focus();
    inputRef.current?.select();
    document.execCommand?.("paste");
  };

  const toggleTrim = (on: boolean) => {
    setTrimOn(on);
    if (on && !trimStart && !trimEnd) {
      setTrimStart("0:00");
      setTrimEnd(info?.duration ? formatTimecode(info.duration) : "");
    }
  };

  const trimError = (() => {
    if (!trimOn) return null;
    const error = validateTrim(trimStart, trimEnd);
    if (error) return error;
    const end = parseTimecode(trimEnd);
    if (info?.duration && end !== null && end > info.duration + 1) {
      return `End is past the end of the media (${formatTimecode(info.duration)}).`;
    }
    return null;
  })();

  const startDownload = async () => {
    if (!validUrl) {
      setJob({ state: "error", message: "Paste a full link that starts with https://" });
      return;
    }
    if (trimError) {
      setJob({ state: "error", message: trimError });
      return;
    }

    const progress = (p: DownloadProgress) =>
      setJob((j) => ({
        state: "running",
        percent: p.percent ?? (j?.state === "running" ? j.percent : null),
        line: p.line,
      }));

    setJob({ state: "running", percent: null, line: "Preparing…" });
    try {
      if (!engine?.ready) {
        setEngine(await backend.engineAction("install", progress));
      }
      const outputDir = await backend.prepareFolder();
      const result = await backend.download(
        {
          url: trimmedUrl,
          outputDir,
          audioOnly,
          audioFormat,
          formatId: !audioOnly && quality ? quality : undefined,
          trimStart: trimOn ? trimStart.trim() : undefined,
          trimEnd: trimOn ? trimEnd.trim() : undefined,
          cookiesFrom,
        },
        progress
      );
      if (importToProject) {
        setJob({ state: "running", percent: 100, line: `Importing into ${backend.hostName}…` });
        await backend.importFile(result.filePath);
      }
      setJob({ state: "done", filePath: result.filePath, imported: importToProject });
      setRecent((list) =>
        [
          {
            id: Date.now(),
            title: info?.title ?? baseName(result.filePath),
            filePath: result.filePath,
            audio: audioOnly,
            imported: importToProject,
          },
          ...list,
        ].slice(0, 5)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setJob(message === CANCELLED_MESSAGE ? { state: "cancelled" } : { state: "error", message });
    }
  };

  /* ─── Derived UI bits ────────────────────────────────── */

  const engineChip = (() => {
    if (connected === false) return { tone: "bad", text: "Helper offline" };
    if (engineTask) return { tone: "busy", text: engine?.ready ? "Updating…" : "Installing…" };
    if (!engine) return { tone: "busy", text: "Checking…" };
    if (!engine.ready) return { tone: "bad", text: "Setup needed" };
    if (engine.updateAvailable) return { tone: "warn", text: "Update" };
    return { tone: "ok", text: "Ready" };
  })();

  const bestLabel = info?.videoFormats[0] ? `Best · ${info.videoFormats[0].label.split(" · ")[0]}` : "Best available";
  const selectedFormat = info?.videoFormats.find((f) => f.id === quality);
  const willConvert = !audioOnly && (selectedFormat ? !selectedFormat.native : info?.videoFormats[0] && !info.videoFormats[0].native);

  const startSecs = parseTimecode(trimStart);
  const endSecs = parseTimecode(trimEnd);
  const showRange = trimOn && info?.duration && startSecs !== null && endSecs !== null && endSecs > startSecs;

  const buttonLabel = !engine?.ready && !spotify
    ? "Install engine & download"
    : importToProject
      ? `Download to ${backend.hostName}`
      : "Download";

  /* ─── Render ─────────────────────────────────────────── */

  return (
    <div className="app">
      <div className="app__bg" aria-hidden="true" />

      <header className="top">
        <div className="brand">
          <span className="brand__mark">
            <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
              <ellipse cx="16" cy="19" rx="13" ry="5" fill="currentColor" opacity="0.9" />
              <path d="M9 17.5c0-4.4 3.1-8 7-8s7 3.6 7 8" fill="currentColor" opacity="0.55" />
            </svg>
          </span>
          <span className="brand__name">Supreme Saucer</span>
        </div>
        <button className={`status-chip status-chip--${engineChip.tone}`} onClick={() => setSettingsOpen(true)}>
          {engineChip.tone === "busy" ? <Spinner size={9} /> : <span className="dot" />}
          {engineChip.text}
        </button>
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <Icon.Settings />
        </button>
      </header>

      {/* ── Banners ─────────────────────────────────── */}
      {connected === false && (
        <div className="banner banner--bad glass">
          <Icon.Alert />
          <div>
            <strong>Helper isn't running</strong>
            <span>Open “Supreme Saucer Helper”. This panel connects automatically.</span>
          </div>
          <Spinner size={12} />
        </div>
      )}

      {connected && engine && !engine.ready && !running && (
        <div className="setup glass">
          <div className="setup__icon">
            <Icon.Sparkle />
          </div>
          <div className="setup__body">
            <strong>One-time setup</strong>
            <span>
              Installs the download engine — yt-dlp, FFmpeg and Deno (about 200 MB). Runs locally, updates itself.
            </span>
            {engineTask ? (
              <div className="task">
                <ProgressBar percent={engineTask.percent} />
                <small>{engineTask.line}</small>
              </div>
            ) : (
              <button className="btn btn--primary" onClick={() => runEngineAction("install")}>
                <Icon.Download /> Install engine
              </button>
            )}
          </div>
        </div>
      )}

      {engine?.ready && engine.updateAvailable && !engine.autoUpdate && !updateDismissed && !engineTask && (
        <div className="banner banner--warn glass">
          <Icon.Refresh />
          <div>
            <strong>yt-dlp {engine.latestYtDlp} is available</strong>
            <span>Updating keeps YouTube & co. working.</span>
          </div>
          <button className="btn btn--small btn--primary" onClick={() => runEngineAction("update")}>
            Update
          </button>
          <button className="icon-btn icon-btn--small" onClick={() => setUpdateDismissed(true)} aria-label="Dismiss">
            <Icon.Close />
          </button>
        </div>
      )}

      {engine?.ready && engineTask && !settingsOpen && (
        <div className="banner glass">
          <Spinner size={12} />
          <div>
            <strong>{engineTask.line}</strong>
          </div>
        </div>
      )}

      {engineError && (
        <div className="banner banner--bad glass">
          <Icon.Alert />
          <div>
            <strong>Engine problem</strong>
            <span>{engineError}</span>
          </div>
          <button className="icon-btn icon-btn--small" onClick={() => setEngineError("")} aria-label="Dismiss">
            <Icon.Close />
          </button>
        </div>
      )}

      {/* ── Link ────────────────────────────────────── */}
      <div className={`url glass${validUrl ? " is-valid" : ""}`}>
        <input
          ref={inputRef}
          className="url__input"
          type="url"
          placeholder="Paste a link — YouTube, Spotify, Instagram, X…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !running && validUrl && startDownload()}
          disabled={running}
          autoComplete="off"
          spellCheck={false}
        />
        {url ? (
          <button className="icon-btn icon-btn--small" onClick={() => setUrl("")} disabled={running} aria-label="Clear">
            <Icon.Close />
          </button>
        ) : (
          <button className="url__paste" onClick={paste} disabled={running}>
            <Icon.Paste /> Paste
          </button>
        )}
      </div>

      {/* ── Preview ─────────────────────────────────── */}
      {probing && (
        <div className="preview glass is-loading">
          <div className="preview__thumb shimmer" />
          <div className="preview__meta">
            <span className="shimmer shimmer--line" />
            <span className="shimmer shimmer--line shimmer--short" />
          </div>
        </div>
      )}

      {info && !probing && (
        <div className="preview glass">
          <div className={`preview__thumb${info.isSpotify ? " preview__thumb--square" : ""}`}>
            {info.thumbnail && (
              <img src={info.thumbnail} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            )}
            {info.duration ? <span className="preview__dur">{formatTimecode(info.duration)}</span> : null}
          </div>
          <div className="preview__meta">
            <strong title={info.title}>{info.title}</strong>
            <span>
              <em className={`site site--${siteName(info.site).toLowerCase()}`}>{siteName(info.site)}</em>
              {info.uploader}
            </span>
          </div>
        </div>
      )}

      {probeError && !probing && (
        <div className="note note--bad">
          <Icon.Alert /> {probeError}
        </div>
      )}

      {/* ── Options ─────────────────────────────────── */}
      <div className="options glass">
        <Segmented
          value={audioOnly ? "audio" : "video"}
          onChange={setMode}
          disabled={running}
          options={[
            { id: "video", label: <><Icon.Video /> Video</>, disabled: audioLocked },
            { id: "audio", label: <><Icon.Music /> Audio only</> },
          ]}
        />

        {audioOnly ? (
          <div className="field">
            <span className="field__label">Format</span>
            <div className="chips chips--fill">
              {AUDIO_FORMATS.map((f) => (
                <button
                  key={f.id}
                  className={`chip${audioFormat === f.id ? " is-active" : ""}`}
                  onClick={() => setAudioFormat(f.id)}
                  disabled={running}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="field__hint">
              {AUDIO_FORMATS.find((f) => f.id === audioFormat)?.hint}
              {spotify && " · matched from YouTube Music"}
            </span>
          </div>
        ) : (
          <div className="field">
            <span className="field__label">Quality</span>
            <div className="select">
              <select value={quality} onChange={(e) => setQuality(e.target.value)} disabled={running || !info}>
                <option value="">{info ? bestLabel : "Best available"}</option>
                {info?.videoFormats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <Icon.Chevron />
            </div>
            <span className="field__hint">
              {!info
                ? "Paste a link to see every resolution."
                : willConvert
                  ? "Converted to H.264 after download so Premiere can edit it."
                  : "H.264 MP4 — imports as-is, no conversion."}
            </span>
          </div>
        )}

        <div className="trim">
          <label className="trim__head">
            <span className="field__label field__label--inline">
              <Icon.Scissors /> Trim clip
            </span>
            <Switch checked={trimOn} onChange={toggleTrim} disabled={running} label="Trim clip" />
          </label>
          {trimOn && (
            <>
              <div className="trim__inputs">
                <label>
                  <small>Start</small>
                  <input
                    className="time"
                    value={trimStart}
                    onChange={(e) => setTrimStart(e.target.value)}
                    placeholder="0:00"
                    disabled={running}
                  />
                </label>
                <span className="trim__arrow">→</span>
                <label>
                  <small>End</small>
                  <input
                    className="time"
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(e.target.value)}
                    placeholder={info?.duration ? formatTimecode(info.duration) : "1:30"}
                    disabled={running}
                  />
                </label>
                <span className="trim__len">
                  {startSecs !== null && endSecs !== null && endSecs > startSecs
                    ? formatTimecode(endSecs - startSecs)
                    : "—"}
                </span>
              </div>
              {showRange && (
                <div className="range">
                  <div
                    className="range__sel"
                    style={{
                      left: `${(startSecs! / info!.duration!) * 100}%`,
                      width: `${(Math.min(endSecs!, info!.duration!) - startSecs!) / info!.duration! * 100}%`,
                    }}
                  />
                </div>
              )}
              {trimError && <span className="field__hint field__hint--bad">{trimError}</span>}
            </>
          )}
        </div>
      </div>

      {/* ── Download ────────────────────────────────── */}
      {running ? (
        <div className="progress glass">
          <div className="progress__top">
            <span className="progress__line">{job.line}</span>
            <span className="progress__pct">{job.percent !== null ? `${Math.floor(job.percent)}%` : ""}</span>
          </div>
          <ProgressBar percent={job.percent} />
          <button className="btn btn--ghost btn--small progress__cancel" onClick={backend.cancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="cta" onClick={startDownload} disabled={!validUrl || connected === false || Boolean(engineTask)}>
          <Icon.Download /> {buttonLabel}
        </button>
      )}

      {job?.state === "done" && (
        <div className="note note--ok">
          <Icon.Check />
          <span>
            {job.imported ? `Imported into ${backend.hostName}` : "Saved"} · {baseName(job.filePath)}
          </span>
          {backend.reveal && (
            <button className="link" onClick={() => backend.reveal!(job.filePath)}>
              Show
            </button>
          )}
        </div>
      )}
      {job?.state === "error" && (
        <div className="note note--bad">
          <Icon.Alert />
          <span>{job.message}</span>
          {/sign-in|logged in|login/i.test(job.message) && (
            <button className="link" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          )}
        </div>
      )}
      {job?.state === "cancelled" && <div className="note">Cancelled.</div>}

      {/* ── Recent ──────────────────────────────────── */}
      {recent.length > 0 && (
        <div className="recent">
          <span className="field__label">Recent</span>
          {recent.map((r) => (
            <div key={r.id} className="recent__row">
              {r.audio ? <Icon.Music /> : <Icon.Video />}
              <span className="recent__title" title={r.filePath}>
                {r.title}
              </span>
              {backend.reveal && (
                <button className="link" onClick={() => backend.reveal!(r.filePath)}>
                  Show
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {settingsOpen && (
        <Settings
          hostName={backend.hostName}
          engine={engine}
          engineTask={engineTask}
          checking={checkingUpdates}
          onEngineAction={runEngineAction}
          onCheckUpdates={checkForUpdates}
          onAutoUpdate={toggleAutoUpdate}
          cookiesFrom={cookiesFrom}
          onCookiesFrom={setCookiesFrom}
          importToProject={importToProject}
          onImportToProject={setImportToProject}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};
