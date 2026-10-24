/**
 * Supreme Saucer — UXP Panel Main Component
 *
 * Adapted from the CEP version (src/js/main/main.tsx).
 * Key differences:
 *   - Uses sidecar-client.ts instead of CEP's child_process
 *   - Uses ppro-host.ts (UXP DOM API) instead of ExtendScript evalTS()
 *   - No CEP-specific APIs (subscribeBackgroundColor, etc.)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listFormats as sidecarListFormats,
  downloadMedia as sidecarDownloadMedia,
  checkHealth,
} from "./sidecar-client";
import { ensureDownloadFolder, importDownloadedFile } from "./ppro-host";
import {
  isSupportedUrl,
  isSpotifyUrl,
  validateTrim,
  type QualityMode,
  type YtdlpFormat,
} from "../shared/supreme-saucer";
import "../js/main/main.scss";

import { UrlInput } from "../js/components/UrlInput";
import { FormatPicker } from "../js/components/FormatPicker";
import { TrimControls } from "../js/components/TrimControls";
import { DownloadStatus } from "../js/components/DownloadStatus";

export type StatusKind = "idle" | "info" | "error" | "success";

export const App = () => {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState<QualityMode>("best");
  const [audioOnly, setAudioOnly] = useState(false);
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");
  const [formats, setFormats] = useState<YtdlpFormat[]>([]);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [loadingFormats, setLoadingFormats] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [progressLine, setProgressLine] = useState("");
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<StatusKind>("idle");
  const [sidecarAlive, setSidecarAlive] = useState<boolean | null>(null);

  const fetchGenerationRef = useRef(0);

  const setMessage = useCallback(
    (message: string, kind: StatusKind = "info") => {
      setStatus(message);
      setStatusKind(kind);
    },
    []
  );

  /* ─── Check sidecar on mount ───────────────────────────── */
  useEffect(() => {
    checkHealth().then((alive) => {
      setSidecarAlive(alive);
      if (!alive) {
        setMessage(
          "Supreme Saucer Helper is not running. Please start it to enable downloads.",
          "error"
        );
      }
    });
  }, [setMessage]);

  /* ─── Paste URL from clipboard ─────────────────────────── */
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      /* clipboard API may not be available */
    }
  };

  /* ─── Fetch manual formats ─────────────────────────────── */
  const fetchFormats = useCallback(async () => {
    if (!url.trim() || !isSupportedUrl(url)) return;

    const generation = ++fetchGenerationRef.current;
    setLoadingFormats(true);
    setMessage(
      audioOnly
        ? "Scanning audio streams…"
        : "Scanning available resolutions…",
      "info"
    );

    try {
      const items = await sidecarListFormats(url.trim(), audioOnly);
      if (generation !== fetchGenerationRef.current) return;
      setFormats(items);
      setSelectedFormat(items[0]?.id ?? "");
      setMessage("", "idle");
    } catch (error) {
      if (generation !== fetchGenerationRef.current) return;
      setFormats([]);
      setSelectedFormat("");
      setMessage(
        error instanceof Error ? error.message : "Could not load formats.",
        "error"
      );
    } finally {
      if (generation === fetchGenerationRef.current) setLoadingFormats(false);
    }
  }, [url, audioOnly, setMessage]);

  useEffect(() => {
    if (quality !== "manual") {
      setFormats([]);
      setSelectedFormat("");
      fetchGenerationRef.current++;
      setLoadingFormats(false);
      setMessage("", "idle");
      return;
    }
    if (!url.trim() || !isSupportedUrl(url)) return;

    const timer = window.setTimeout(fetchFormats, 500);
    return () => window.clearTimeout(timer);
  }, [quality, url, audioOnly, fetchFormats, setMessage]);

  /* ─── Validation ───────────────────────────────────────── */
  const validate = (): string | null => {
    if (!url.trim()) return "Paste a URL to get started.";
    if (!isSupportedUrl(url)) return "That doesn't look like a valid link — paste a full https:// URL.";
    if (quality === "manual" && !audioOnly && !selectedFormat)
      return "Select a resolution first.";
    return validateTrim(trimStart, trimEnd);
  };

  /* ─── Download handler ─────────────────────────────────── */
  const handleDownload = async () => {
    const err = validate();
    if (err) {
      setMessage(err, "error");
      return;
    }

    // Re-check sidecar health
    const alive = await checkHealth();
    setSidecarAlive(alive);
    if (!alive) {
      setMessage(
        "Supreme Saucer Helper is not running. Please start it first.",
        "error"
      );
      return;
    }

    setDownloading(true);
    setProgress(null);
    setProgressLine("");
    setMessage("Preparing folder…", "info");

    try {
      console.log("[UXP] Calling ensureDownloadFolder…");
      const folderResult = await ensureDownloadFolder();
      folderResult?.logs?.forEach((l: string) => console.log("[UXP]", l));

      if (!folderResult?.ok) {
        throw new Error(
          folderResult?.error || "Could not prepare download folder."
        );
      }

      const outputDir = folderResult.data;
      console.log("[UXP] Output dir:", outputDir);
      setMessage("Downloading…", "info");

      const result = await sidecarDownloadMedia(
        {
          url: url.trim(),
          outputDir,
          quality,
          formatId: selectedFormat || undefined,
          audioOnly: isSpotify ? true : audioOnly,
          trimStart: trimStart.trim() || undefined,
          trimEnd: trimEnd.trim() || undefined,
        },
        ({ percent, line }) => {
          if (percent !== null) setProgress(percent);
          if (line) {
            console.log("[DL]", line);
            setProgressLine(line);
          }
        }
      );

      console.log("[UXP] File saved:", result.filePath);
      setMessage("Importing into project…", "info");

      const importResult = await importDownloadedFile(result.filePath);
      importResult?.logs?.forEach((l: string) => console.log("[UXP]", l));

      if (!importResult?.ok) {
        throw new Error(
          importResult?.error ||
            "Download succeeded but import failed — file is on disk beside your project."
        );
      }

      setProgress(100);
      setProgressLine("");
      setMessage("Imported into Supreme Saucer bin ✓", "success");
    } catch (error) {
      console.error("[UXP] Error:", error);
      setProgress(null);
      setProgressLine("");
      setMessage(
        error instanceof Error ? error.message : "Something went wrong.",
        "error"
      );
    } finally {
      setDownloading(false);
    }
  };

  const isWorking = downloading || loadingFormats;
  const showProgress = downloading && (progress !== null || progressLine);
  const isSpotify = isSpotifyUrl(url);

  return (
    <div className="saucer">
      {/* ── Header ─────────────────────────────────────── */}
      <header className="saucer__header">
        <div className="saucer__logo">🛸</div>
        <h1>Supreme Saucer</h1>
        {sidecarAlive === false && (
          <span
            className="saucer__platform-badge"
            style={{
              background: "rgba(248,113,113,0.15)",
              color: "#f87171",
              border: "1px solid rgba(248,113,113,0.3)",
              marginLeft: "auto",
              fontSize: "9px",
            }}
          >
            Helper offline
          </span>
        )}
      </header>

      <UrlInput
        url={url}
        setUrl={setUrl}
        isWorking={isWorking}
        isSpotify={isSpotify}
        handlePaste={handlePaste}
      />

      <FormatPicker
        isSpotify={isSpotify}
        quality={quality}
        setQuality={setQuality}
        audioOnly={audioOnly || isSpotify}
        setAudioOnly={setAudioOnly}
        formats={formats}
        selectedFormat={selectedFormat}
        setSelectedFormat={setSelectedFormat}
        loadingFormats={loadingFormats}
        isWorking={isWorking}
      />

      <div className="saucer__divider" />

      <TrimControls
        trimStart={trimStart}
        setTrimStart={setTrimStart}
        trimEnd={trimEnd}
        setTrimEnd={setTrimEnd}
        isWorking={isWorking}
      />

      <DownloadStatus
        downloading={downloading}
        handleDownload={handleDownload}
        isWorking={isWorking}
        showProgress={!!showProgress}
        progress={progress}
        status={downloading && progressLine ? progressLine : status}
        statusKind={statusKind}
      />
    </div>
  );
};
