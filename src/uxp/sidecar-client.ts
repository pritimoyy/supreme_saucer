/**
 * Supreme Saucer — Sidecar Client
 *
 * Thin wrapper around fetch() for communicating with the local sidecar
 * HTTP server. Used by the UXP panel since UXP has no child_process.
 */

import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  YtdlpFormat,
} from "../shared/supreme-saucer";

const SIDECAR_BASE = "http://127.0.0.1:9150";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

/* ─── Health check ─────────────────────────────────────────── */

export const checkHealth = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${SIDECAR_BASE}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    return data?.ok === true;
  } catch {
    return false;
  }
};

/* ─── List formats ─────────────────────────────────────────── */

export const listFormats = async (
  url: string,
  audioOnly: boolean
): Promise<YtdlpFormat[]> => {
  await ensureSidecarRunning();

  const res = await fetchWithRetry(`${SIDECAR_BASE}/formats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, audioOnly }),
  });

  const data = await res.json();

  if (!data.ok) {
    throw new Error(data.error || "Failed to list formats.");
  }

  return data.formats;
};

/* ─── Download with SSE progress ───────────────────────────── */

export const downloadMedia = async (
  request: DownloadRequest,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> => {
  await ensureSidecarRunning();

  const res = await fetch(`${SIDECAR_BASE}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || `Sidecar returned HTTP ${res.status}`);
  }

  // Parse the SSE stream
  return await readSSEStream(res, onProgress);
};

/* ─── SSE Stream Reader ────────────────────────────────────── */

async function readSSEStream(
  response: Response,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
  return new Promise(async (resolve, reject) => {
    const reader = response.body?.getReader();
    if (!reader) {
      return reject(new Error("No response body from sidecar."));
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE messages: "event: <type>\ndata: <json>\n\n"
        const messages = buffer.split("\n\n");
        buffer = messages.pop() || ""; // keep incomplete message in buffer

        for (const msg of messages) {
          const lines = msg.split("\n");
          let eventType = "";
          let data = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            else if (line.startsWith("data: ")) data = line.slice(6);
          }

          if (!data) continue;

          try {
            const parsed = JSON.parse(data);

            switch (eventType) {
              case "progress":
                onProgress?.(parsed);
                break;
              case "done":
                if (parsed.ok && parsed.filePath) {
                  resolve({ filePath: parsed.filePath });
                } else {
                  reject(new Error(parsed.error || "Download failed."));
                }
                return;
              case "error":
                reject(new Error(parsed.error || "Download failed."));
                return;
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }

      // Stream ended without a "done" or "error" event
      reject(new Error("Sidecar stream ended unexpectedly."));
    } catch (err) {
      reject(err);
    }
  });
}

/* ─── Helpers ──────────────────────────────────────────────── */

async function ensureSidecarRunning(): Promise<void> {
  const alive = await checkHealth();
  if (!alive) {
    throw new Error(
      "Supreme Saucer Helper is not running.\n\n" +
        "Please start the helper app before downloading.\n" +
        "You can find it in the Supreme Saucer installation folder."
    );
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return res;

      // Non-retryable HTTP errors
      if (res.status >= 400 && res.status < 500) return res;
    } catch (err) {
      if (attempt === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }

  throw new Error("Failed to connect to the Supreme Saucer Helper.");
}
