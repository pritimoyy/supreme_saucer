/**
 * Supreme Saucer — Sidecar Server
 *
 * A lightweight local HTTP server that wraps the download engine
 * (yt-dlp + ffmpeg). The UXP panel communicates with this server
 * via fetch() since UXP has no child_process / Node.js access.
 *
 * Endpoints:
 *   GET  /health     — liveness check
 *   POST /formats    — list available formats for a URL
 *   POST /download   — download media, streams progress via SSE
 */

import express from "express";
import cors from "cors";
import { listFormats, downloadMedia, ensureTools } from "./downloader";
import type { DownloadRequest } from "../shared/supreme-saucer";

const PORT = parseInt(process.env.SAUCER_PORT || "9150", 10);

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

/* ─── Health check ─────────────────────────────────────────── */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "1.0.0" });
});

/* ─── List formats ─────────────────────────────────────────── */
app.post("/formats", async (req, res) => {
  try {
    const { url, audioOnly } = req.body as {
      url: string;
      audioOnly?: boolean;
    };

    if (!url || typeof url !== "string") {
      res.status(400).json({ ok: false, error: "Missing 'url' field." });
      return;
    }

    const formats = await listFormats(url.trim(), audioOnly ?? false);
    res.json({ ok: true, formats });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || "Failed to list formats.",
    });
  }
});

/* ─── Download with SSE progress ───────────────────────────── */
app.post("/download", async (req, res) => {
  const request = req.body as DownloadRequest;

  if (!request?.url || !request?.outputDir) {
    res.status(400).json({ ok: false, error: "Missing required fields." });
    return;
  }

  // Set up Server-Sent Events
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await downloadMedia(request, (progress) => {
      sendEvent("progress", progress);
    });

    sendEvent("done", { ok: true, filePath: result.filePath });
  } catch (error: any) {
    sendEvent("error", {
      ok: false,
      error: error?.message || "Download failed.",
    });
  } finally {
    res.end();
  }
});

/* ─── Start server ─────────────────────────────────────────── */
app.listen(PORT, "127.0.0.1", () => {
  console.log(`🛸 Supreme Saucer helper running on http://127.0.0.1:${PORT}`);
  // Install/update yt-dlp, ffmpeg and deno up front so the first download is fast.
  ensureTools(({ line }) => console.log(`[setup] ${line}`))
    .then(() => console.log("[setup] Download tools ready."))
    .catch((error) => console.error("[setup] Failed to prepare tools:", error));
});
