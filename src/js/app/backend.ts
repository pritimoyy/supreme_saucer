import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  EngineStatus,
  MediaInfo,
  ProbeRequest,
} from "../../shared/supreme-saucer";

export type ProgressFn = (progress: DownloadProgress) => void;
export type EngineAction = "install" | "update" | "repair";

/**
 * Everything the panel needs from its host. CEP runs the engine in-process;
 * UXP forwards to the local helper app; the mock is for browser previews.
 */
export interface Backend {
  /** Shown in the UI, e.g. "Premiere Pro". */
  hostName: string;
  /** UXP only: is the helper app reachable? */
  checkConnection?: () => Promise<boolean>;
  probe(request: ProbeRequest): Promise<MediaInfo>;
  /** Folder the file should be saved to (next to the project). */
  prepareFolder(): Promise<string>;
  download(request: DownloadRequest, onProgress: ProgressFn): Promise<DownloadResult>;
  importFile(filePath: string): Promise<void>;
  cancel(): void;
  engineStatus(checkRemote: boolean): Promise<EngineStatus>;
  engineAction(action: EngineAction, onProgress: ProgressFn): Promise<EngineStatus>;
  setAutoUpdate(enabled: boolean): Promise<void>;
  /** Show the file in Finder/Explorer, where supported. */
  reveal?(filePath: string): void;
}
