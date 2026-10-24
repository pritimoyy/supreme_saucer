import { child_process, os } from "../lib/cep/node";
import { csi, evalTS } from "../lib/utils/bolt";
import downloader from "../lib/download/downloader";
import type { Backend } from "../app/backend";

const HOST_NAMES: Record<string, string> = {
  PPRO: "Premiere Pro",
  AEFT: "After Effects",
};

const unwrap = <T>(result: { ok: boolean; data?: T; error?: string; logs?: string[] } | undefined, fallback: string): T => {
  result?.logs?.forEach((line) => console.log("[JSX]", line));
  if (!result?.ok) throw new Error(result?.error || fallback);
  return result.data as T;
};

export const createCepBackend = (): Backend => ({
  hostName: HOST_NAMES[csi.hostEnvironment?.appName] ?? "your project",
  probe: (request) => downloader.probeUrl(request),
  prepareFolder: async () => unwrap<string>(await evalTS("ensureDownloadFolder"), "Could not prepare the download folder."),
  download: (request, onProgress) => downloader.downloadMedia(request, onProgress),
  importFile: async (filePath) => {
    unwrap(await evalTS("importDownloadedFile", filePath), "Downloaded, but importing into the project failed.");
  },
  cancel: () => downloader.cancel(),
  engineStatus: (checkRemote) => downloader.getEngineStatus(checkRemote),
  engineAction: (action, onProgress) =>
    action === "install"
      ? downloader.installEngine(onProgress)
      : action === "update"
        ? downloader.updateEngine(onProgress)
        : downloader.repairEngine(onProgress),
  setAutoUpdate: async (enabled) => downloader.setAutoUpdate(enabled),
  reveal: (filePath) => {
    // Explorer needs exactly `/select,"C:\path with spaces\file.mp4"`, so skip Node's own quoting.
    if (os.platform() === "win32") {
      child_process.spawn("explorer.exe", [`/select,"${filePath}"`], { windowsVerbatimArguments: true });
    }
    else child_process.spawn("open", ["-R", filePath]);
  },
});
