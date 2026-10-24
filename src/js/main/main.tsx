import { useCallback, useEffect, useRef, useState } from "react";
import { evalTS, subscribeBackgroundColor } from "../lib/utils/bolt";
import { downloadMedia, ensureTools, listFormats } from "../lib/download/downloader";
import {
  isSupportedUrl,
  isSpotifyUrl,
  validateTrim,
  type QualityMode,
  type YtdlpFormat,
} from "../../shared/supreme-saucer";
import "./main.scss";

import { UrlInput } from "../components/UrlInput";
import { FormatPicker } from "../components/FormatPicker";
import { TrimControls } from "../components/TrimControls";
import { DownloadStatus } from "../components/DownloadStatus";

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

  const fetchGenerationRef = useRef(0);

  const setMessage = useCallback((message: string, kind: StatusKind = "info") => {
    setStatus(message);
    setStatusKind(kind);
  }, []);

  useEffect(() => {
    if (window.cep) {
      subscribeBackgroundColor(() => {/* keep panel bg from Adobe */});
    }
  }, []);

  /* ─── Install / update yt-dlp, ffmpeg and deno in the background ─── */
  useEffect(() => {
    if (!window.cep) return;
    let showedSetup = false;
    ensureTools(({ line }) => {
      showedSetup = true;
      setMessage(line, "info");
    })
      .then(() => {
        if (showedSetup) setMessage("Ready — paste a link to download.", "success");
      })
      .catch((error) => {
        setMessage(
          `Setup failed: ${error instanceof Error ? error.message : error}. Check your internet connection and reopen the panel.`,
          "error"
        );
      });
  }, [setMessage]);

  /* ─── Paste URL from clipboard ─────────────────────────── */
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      /* clipboard API not available in all CEP versions */
    }
  };

  /* ─── Fetch manual formats ────────────────────────────── */
  const fetchFormats = useCallback(async () => {
    if (!url.trim() || !isSupportedUrl(url)) return;

    const generation = ++fetchGenerationRef.current;
    setLoadingFormats(true);
    setMessage(
      audioOnly ? "Scanning audio streams…" : "Scanning available resolutions…",
      "info"
    );

    try {
      const items = await listFormats(url.trim(), audioOnly, ({ line }) => {
        if (generation === fetchGenerationRef.current) setMessage(line, "info");
      });
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

    // Re-fetch whenever url, quality=manual, OR audioOnly changes.
    const timer = window.setTimeout(fetchFormats, 500);
    return () => window.clearTimeout(timer);
  }, [quality, url, audioOnly, fetchFormats, setMessage]);

  /* ─── Validation ──────────────────────────────────────── */
  const validate = (): string | null => {
    if (!url.trim()) return "Paste a URL to get started.";
    if (!isSupportedUrl(url)) return "That doesn't look like a valid link — paste a full https:// URL.";
    if (quality === "manual" && !audioOnly && !selectedFormat) return "Select a resolution first.";
    return validateTrim(trimStart, trimEnd);
  };

  /* ─── Download handler ────────────────────────────────── */
  const handleDownload = async () => {
    const err = validate();
    if (err) { setMessage(err, "error"); return; }

    setDownloading(true);
    setProgress(null);
    setProgressLine("");
    setMessage("Preparing folder…", "info");

    try {
      console.log("[CEP] Calling ensureDownloadFolder…");
      const folderResult = await evalTS("ensureDownloadFolder");
      folderResult?.logs?.forEach((l: string) => console.log("[JSX]", l));

      if (!folderResult?.ok) {
        throw new Error(folderResult?.error || "Could not prepare download folder.");
      }

      const outputDir = folderResult.data;
      console.log("[CEP] Output dir:", outputDir);
      setMessage("Downloading…", "info");

      const result = await downloadMedia(
        {
          url: url.trim(),
          outputDir,
          quality,
          formatId: selectedFormat || undefined,
          // Spotify is always audio-only; honour toggle for other platforms.
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

      console.log("[CEP] File saved:", result.filePath);
      setMessage("Importing into project…", "info");

      const importResult = await evalTS("importDownloadedFile", result.filePath);
      importResult?.logs?.forEach((l: string) => console.log("[JSX]", l));

      if (!importResult?.ok) {
        throw new Error(
          importResult?.error || "Download succeeded but import failed — file is on disk beside your project."
        );
      }

      setProgress(100);
      setProgressLine("");
      setMessage("Imported into Supreme Saucer bin ✓", "success");
    } catch (error) {
      console.error("[CEP] Error:", error);
      setProgress(null);
      setProgressLine("");
      setMessage(error instanceof Error ? error.message : "Something went wrong.", "error");
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
