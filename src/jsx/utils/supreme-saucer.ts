import { SAUCER_FOLDER } from "../../shared/supreme-saucer";

export type HostResponse<T = string> =
  | { ok: true; data: T; logs?: string[] }
  | { ok: false; error: string; logs?: string[] };

export const success = <T>(data: T, logs?: string[]): HostResponse<T> => ({
  ok: true,
  data,
  logs,
});

export const failure = (error: string, logs?: string[]): HostResponse<never> => ({
  ok: false,
  error,
  logs,
});

export const ensureFolderOnDisk = (
  folderPath: string,
  logs: string[] = []
): HostResponse<string> => {
  logs.push("Checking folder existence on disk: " + folderPath);
  const folder = new Folder(folderPath);
  if (!folder.exists) {
    logs.push("Folder does not exist. Creating folder on disk...");
    if (!folder.create()) {
      logs.push("ERROR: Failed to create folder on disk: " + folderPath);
      return failure(`Could not create folder: ${folderPath}`, logs);
    }
    logs.push("Folder created successfully on disk.");
  } else {
    logs.push("Folder already exists on disk.");
  }
  return success(folder.fsName, logs);
};

export { SAUCER_FOLDER };

