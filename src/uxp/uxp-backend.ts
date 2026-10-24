import * as sidecar from "./sidecar-client";
import { ensureDownloadFolder, importDownloadedFile } from "./ppro-host";
import type { Backend } from "../js/app/backend";

export const createUxpBackend = (): Backend => ({
  hostName: "Premiere Pro",
  checkConnection: sidecar.checkHealth,
  probe: sidecar.probeUrl,
  prepareFolder: async () => {
    const result = await ensureDownloadFolder();
    result?.logs?.forEach((line: string) => console.log("[UXP]", line));
    if (!result?.ok) throw new Error(result?.error || "Could not prepare the download folder.");
    return result.data;
  },
  download: sidecar.downloadMedia,
  importFile: async (filePath) => {
    const result = await importDownloadedFile(filePath);
    result?.logs?.forEach((line: string) => console.log("[UXP]", line));
    if (!result?.ok) throw new Error(result?.error || "Downloaded, but importing into the project failed.");
  },
  cancel: () => void sidecar.cancelDownload(),
  engineStatus: sidecar.getEngineStatus,
  engineAction: sidecar.engineAction,
  setAutoUpdate: sidecar.setAutoUpdate,
});
