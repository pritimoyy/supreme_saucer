/**
 * Supreme Saucer — Sidecar Client
 *
 * Thin wrapper around fetch() for talking to the local helper server.
 * Used by the UXP panel since UXP has no child_process.
 */

import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  EngineStatus,
  MediaInfo,
  ProbeRequest,
} from "../shared/supreme-saucer";

const SIDECAR_BASE = "http://127.0.0.1:9150";

const HELPER_MISSING =
  "The Supreme Saucer Helper isn't running. Open it from the Supreme Saucer folder, then try again.";

export const checkHealth = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${SIDECAR_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return data?.ok === true;
  } catch {
    return false;
  }
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${SIDECAR_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error(HELPER_MISSING);
  }
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(data?.error || `Helper returned HTTP ${res.status}`);
  return data as T;
};

/** POST that streams progress over SSE and resolves with the task's result. */
const streamRequest = async <T>(
  path: string,
  body: unknown,
  onProgress?: (progress: DownloadProgress) => void
): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${SIDECAR_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error(HELPER_MISSING);
  }
  if (!res.ok || !res.body) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || `Helper returned HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE messages: "event: <type>\ndata: <json>\n\n"
    const messages = buffer.split("\n\n");
    buffer = messages.pop() || "";
    for (const msg of messages) {
      const event = msg.match(/^event: (.*)$/m)?.[1];
      const data = msg.match(/^data: (.*)$/m)?.[1];
      if (!data) continue;
      let parsed: { ok?: boolean; result?: T; error?: string } & DownloadProgress;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "progress") onProgress?.(parsed);
      else if (event === "done") return parsed.result as T;
      else if (event === "error") throw new Error(parsed.error || "Something went wrong.");
    }
  }
  throw new Error("The helper stopped responding.");
};

export const probeUrl = async (req: ProbeRequest): Promise<MediaInfo> =>
  (await request<{ info: MediaInfo }>("/probe", { method: "POST", body: JSON.stringify(req) })).info;

export const downloadMedia = (
  req: DownloadRequest,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> => streamRequest<DownloadResult>("/download", req, onProgress);

export const cancelDownload = async () => {
  await request("/cancel", { method: "POST" }).catch(() => null);
};

export const getEngineStatus = async (checkRemote: boolean): Promise<EngineStatus> =>
  (await request<{ status: EngineStatus }>(`/engine${checkRemote ? "?remote=1" : ""}`)).status;

export const engineAction = (
  action: "install" | "update" | "repair",
  onProgress?: (progress: DownloadProgress) => void
) => streamRequest<EngineStatus>(`/engine/${action}`, {}, onProgress);

export const setAutoUpdate = async (autoUpdate: boolean) => {
  await request("/engine/settings", { method: "POST", body: JSON.stringify({ autoUpdate }) });
};
