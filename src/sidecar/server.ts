/**
 * Supreme Saucer — Sidecar Server
 *
 * A lightweight local HTTP server that wraps the download engine
 * (yt-dlp + ffmpeg + deno). The UXP panel talks to it via fetch() since
 * UXP has no child_process. Only listens on 127.0.0.1.
 *
 * Endpoints:
 *   GET  /health            — liveness check
 *   POST /probe             — title, thumbnail, duration and qualities for a URL
 *   POST /download          — download media, streams progress via SSE
 *   POST /cancel            — stop the running download
 *   GET  /engine            — installed tool versions (?remote=1 also checks GitHub)
 *   POST /engine/install    — install missing tools (SSE)
 *   POST /engine/update     — update yt-dlp now (SSE)
 *   POST /engine/repair     — reinstall every tool (SSE)
 *   POST /engine/settings   — { autoUpdate: boolean }
 */

import express from "express";
import cors from "cors";
import downloader from "./downloader";
import type { DownloadProgress, DownloadRequest, ProbeRequest } from "../shared/supreme-saucer";

const PORT = parseInt(process.env.SAUCER_PORT || "9150", 10);

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** Run a long task and stream its progress + result as Server-Sent Events. */
const streamTask = (
  res: express.Response,
  task: (onProgress: (p: DownloadProgress) => void) => Promise<unknown>,
  onClientGone?: () => void
) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let finished = false;
  res.on("close", () => {
    if (!finished) onClientGone?.();
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  task((progress) => send("progress", progress))
    .then((result) => send("done", { ok: true, result }))
    .catch((error) => send("error", { ok: false, error: message(error, "Something went wrong.") }))
    .finally(() => {
      finished = true;
      res.end();
    });
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "1.1.1" });
});

app.post("/probe", async (req, res) => {
  const request = req.body as ProbeRequest;
  if (!request?.url || typeof request.url !== "string") {
    res.status(400).json({ ok: false, error: "Missing 'url' field." });
    return;
  }
  try {
    res.json({ ok: true, info: await downloader.probeUrl(request) });
  } catch (error) {
    res.status(500).json({ ok: false, error: message(error, "Could not read this link.") });
  }
});

app.post("/download", (req, res) => {
  const request = req.body as DownloadRequest;
  if (!request?.url || !request?.outputDir) {
    res.status(400).json({ ok: false, error: "Missing required fields." });
    return;
  }
  // If the panel goes away mid-download, stop yt-dlp too.
  streamTask(res, (onProgress) => downloader.downloadMedia(request, onProgress), downloader.cancel);
});

app.post("/cancel", (_req, res) => {
  downloader.cancel();
  res.json({ ok: true });
});

app.get("/engine", async (req, res) => {
  try {
    res.json({ ok: true, status: await downloader.getEngineStatus(req.query.remote === "1") });
  } catch (error) {
    res.status(500).json({ ok: false, error: message(error, "Could not read engine status.") });
  }
});

app.post("/engine/install", (_req, res) => streamTask(res, downloader.installEngine));
app.post("/engine/update", (_req, res) => streamTask(res, downloader.updateEngine));
app.post("/engine/repair", (_req, res) => streamTask(res, downloader.repairEngine));

app.post("/engine/settings", (req, res) => {
  try {
    if (typeof req.body?.autoUpdate === "boolean") downloader.setAutoUpdate(req.body.autoUpdate);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: message(error, "Could not save settings.") });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`🛸 Supreme Saucer helper running on http://127.0.0.1:${PORT}`);
  // Install/update yt-dlp, ffmpeg and deno up front so the first download is fast.
  downloader
    .ensureTools(({ line }) => console.log(`[setup] ${line}`))
    .then(() => console.log("[setup] Download engine ready."))
    .catch((error) => console.error("[setup] Failed to prepare the download engine:", error));
});
