import { getItemByName } from "./aeft-utils";
import {
  ensureFolderOnDisk,
  failure,
  SAUCER_FOLDER,
  success,
  type HostResponse,
} from "../utils/supreme-saucer";

const getProjectFilePath = (logs: string[]): HostResponse<string> => {
  logs.push("Checking if project file is saved...");
  if (!app.project.file) {
    logs.push("ERROR: Project has not been saved yet.");
    return failure("Save the project first — downloads go beside the project file.", logs);
  }

  logs.push("Active project path resolved: " + app.project.file.fsName);
  return success(app.project.file.fsName, logs);
};

export const getProjectFolder = (logs: string[] = []): HostResponse<string> => {
  logs.push("Resolving active project file path...");
  const projectFile = getProjectFilePath(logs);
  if (!projectFile.ok) return projectFile;

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
  const logs: string[] = ["--- Starting ensureDownloadFolder in After Effects ---"];
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

const getOrCreateFolder = (parent: FolderItem, name: string, logs: string[]): FolderItem => {
  logs.push("Searching children of '" + parent.name + "' for folder named '" + name + "'...");
  const existing = getItemByName(parent, name);
  if (existing) {
    logs.push("Found existing item with name '" + name + "'");
    if (existing instanceof FolderItem) {
      logs.push("Existing item is a Folder. Reusing it.");
      return existing;
    } else {
      logs.push("WARNING: Existing item is not a Folder. Creating a new folder.");
    }
  }

  logs.push("Folder not found or is invalid type. Creating new folder...");
  const created = parent.items.addFolder(name);
  logs.push("New folder created successfully.");
  return created;
};

export const importDownloadedFile = (
  filePath: string
): HostResponse<string> => {
  const logs: string[] = ["--- Starting importDownloadedFile in After Effects ---"];
  logs.push("Checking if project is saved...");
  if (!app.project.file) {
    logs.push("ERROR: Project has not been saved yet.");
    return failure("Save the project first before importing.", logs);
  }

  logs.push("Checking if file to import exists on disk: " + filePath);
  const mediaFile = new File(filePath);
  if (!mediaFile.exists) {
    logs.push("ERROR: Downloaded file was not found on disk at: " + filePath);
    return failure("Downloaded file was not found on disk.", logs);
  }

  try {
    logs.push("Locating or creating Project Panel folder '" + SAUCER_FOLDER + "'...");
    const targetFolder = getOrCreateFolder(
      app.project.rootFolder,
      SAUCER_FOLDER,
      logs
    );

    logs.push("Importing file: " + mediaFile.fsName);
    const imported = app.project.importFile(new ImportOptions(mediaFile));

    if (!imported) {
      logs.push("ERROR: app.project.importFile returned null or undefined.");
      return failure("After Effects could not import the file.", logs);
    }

    logs.push("File imported successfully. Moving to target folder...");
    imported.parentFolder = targetFolder;
    logs.push("File moved to target folder.");
    
    return success(mediaFile.fsName, logs);
  } catch (error: any) {
    const errorMsg = error?.message || "Unknown error";
    logs.push("ERROR: Exception caught during import: " + errorMsg);
    return failure(errorMsg || "Import failed in After Effects.", logs);
  }
};

