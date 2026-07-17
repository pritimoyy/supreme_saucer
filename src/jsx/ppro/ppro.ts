import { getChildByName } from "./ppro-utils";
import {
  ensureFolderOnDisk,
  failure,
  SAUCER_FOLDER,
  success,
  type HostResponse,
} from "../utils/supreme-saucer";

const getProjectFilePath = (logs: string[]): HostResponse<string> => {
  logs.push("Checking if any project is open...");
  if (!app.isDocumentOpen()) {
    logs.push("ERROR: No project is open.");
    return failure("No project is open.", logs);
  }

  logs.push("Retrieving active project's file path from app.project.path...");
  const projectPath = app.project.path;
  logs.push("app.project.path raw value: " + projectPath);
  if (!projectPath || projectPath.length === 0) {
    logs.push("ERROR: Project has not been saved yet.");
    return failure("Save the project first — downloads go beside the project file.", logs);
  }

  return success(projectPath, logs);
};

export const getProjectFolder = (logs: string[] = []): HostResponse<string> => {
  logs.push("Resolving active project file path...");
  const projectFile = getProjectFilePath(logs);
  if (!projectFile.ok) return projectFile;

  logs.push("Active project file path resolved: " + projectFile.data);
  const file = new File(projectFile.data);
  const parent = file.parent;
  if (!parent || !parent.exists) {
    logs.push("ERROR: Parent directory of the project file does not exist or is invalid.");
    return failure("Could not locate the project folder.", logs);
  }

  logs.push("Resolved project folder: " + parent.fsName);
  return success(parent.fsName, logs);
};

export const ensureDownloadFolder = (): HostResponse<string> => {
  const logs: string[] = ["--- Starting ensureDownloadFolder in Premiere Pro ---"];
  const projectFolder = getProjectFolder(logs);
  if (!projectFolder.ok) return projectFolder;

  const isWindows = $.os.indexOf("Windows") > -1;
  logs.push("OS detected: " + (isWindows ? "Windows" : "Mac/Unix") + " ($.os: " + $.os + ")");

  const saucerPath = isWindows
    ? projectFolder.data + "\\" + SAUCER_FOLDER
    : projectFolder.data + "/" + SAUCER_FOLDER;

  logs.push("Constructed folder path: " + saucerPath);
  return ensureFolderOnDisk(saucerPath, logs);
};

const getOrCreateBin = (parent: ProjectItem, name: string, logs: string[]): ProjectItem => {
  logs.push("Searching children of '" + parent.name + "' for bin named '" + name + "'...");
  const existing = getChildByName(parent, name);
  if (existing) {
    logs.push("Found existing item with name '" + name + "', type: " + existing.type + " (2 = Bin)");
    if (existing.type === 2) {
      logs.push("Existing item is a bin. Reusing it.");
      return existing;
    } else {
      logs.push("WARNING: Existing item is not a bin. Creating a new bin.");
    }
  }

  logs.push("Bin not found or is invalid type. Creating new bin...");
  const created = parent.createBin(name);
  if (!created || created === 0) {
    logs.push("ERROR: Failed to create bin via parent.createBin()");
    throw new Error(`Could not create bin "${name}".`);
  }
  logs.push("New bin created successfully.");
  return created;
};

export const importDownloadedFile = (
  filePath: string
): HostResponse<string> => {
  const logs: string[] = ["--- Starting importDownloadedFile in Premiere Pro ---"];
  logs.push("Checking if any project is open...");
  if (!app.isDocumentOpen()) {
    logs.push("ERROR: No project is open.");
    return failure("No project is open.", logs);
  }

  logs.push("Checking if file to import exists on disk: " + filePath);
  const mediaFile = new File(filePath);
  if (!mediaFile.exists) {
    logs.push("ERROR: Downloaded file was not found on disk at: " + filePath);
    return failure("Downloaded file was not found on disk.", logs);
  }

  try {
    logs.push("Locating or creating Project Panel bin '" + SAUCER_FOLDER + "'...");
    const targetBin = getOrCreateBin(app.project.rootItem, SAUCER_FOLDER, logs);

    logs.push("Importing file: " + mediaFile.fsName + " into target bin: " + targetBin.name);
    const imported = app.project.importFiles(
      [mediaFile.fsName],
      true,
      targetBin,
      false
    );

    logs.push("Import function completed. Return value: " + imported);

    // In Premiere Pro, importFiles() returns undefined in many environments, or true/false on newer APIs.
    // We should only fail if it explicitly returns false.
    if (imported === false) {
      logs.push("ERROR: app.project.importFiles returned false.");
      return failure("Premiere Pro could not import the file.", logs);
    }

    logs.push("Import succeeded.");
    return success(mediaFile.fsName, logs);
  } catch (error: any) {
    const errorMsg = error?.message || "Unknown error";
    logs.push("ERROR: Exception caught during import: " + errorMsg);
    return failure(errorMsg || "Import failed in Premiere Pro.", logs);
  }
};

