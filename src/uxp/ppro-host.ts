/**
 * Supreme Saucer — Premiere Pro Host (UXP DOM API)
 *
 * Replaces the ExtendScript ppro.ts / aeft.ts for UXP.
 * All calls are async and use the UXP Premiere Pro DOM API.
 */

const SAUCER_FOLDER = "Supreme Saucer";

/* ─── Type shims for UXP Premiere Pro DOM ─────────────────── */
// These types match the UXP Premiere Pro API surface. In a full
// Bolt UXP setup these would come from @anthropic/premiere-pro-types
// or the official Adobe UXP types package.

declare const app: {
  Project: {
    getActiveProject(): Promise<any>;
  };
};

export type HostResponse<T = string> =
  | { ok: true; data: T; logs?: string[] }
  | { ok: false; error: string; logs?: string[] };

const success = <T>(data: T, logs?: string[]): HostResponse<T> => ({
  ok: true,
  data,
  logs,
});

const failure = (error: string, logs?: string[]): HostResponse<never> => ({
  ok: false,
  error,
  logs,
});

/* ─── Get project folder path ──────────────────────────────── */

export const getProjectFolder = async (): Promise<HostResponse<string>> => {
  const logs: string[] = ["--- UXP: getProjectFolder ---"];

  try {
    const project = await app.Project.getActiveProject();

    if (!project) {
      logs.push("ERROR: No active project.");
      return failure("No project is open.", logs);
    }

    const projectPath = await project.getProjectFilePath();
    logs.push("Project file path: " + projectPath);

    if (!projectPath) {
      logs.push("ERROR: Project has not been saved.");
      return failure(
        "Save the project first — downloads go beside the project file.",
        logs
      );
    }

    // Extract parent directory from the project file path
    const lastSep = Math.max(
      projectPath.lastIndexOf("/"),
      projectPath.lastIndexOf("\\")
    );
    if (lastSep === -1) {
      return failure("Could not locate the project folder.", logs);
    }

    const parentDir = projectPath.substring(0, lastSep);
    logs.push("Resolved project folder: " + parentDir);
    return success(parentDir, logs);
  } catch (error: any) {
    logs.push("ERROR: " + (error?.message || "Unknown error"));
    return failure(error?.message || "Could not access the project.", logs);
  }
};

/* ─── Ensure download folder exists ────────────────────────── */

export const ensureDownloadFolder = async (): Promise<
  HostResponse<string>
> => {
  const logs: string[] = ["--- UXP: ensureDownloadFolder ---"];

  const projectFolder = await getProjectFolder();
  if (!projectFolder.ok) return projectFolder;
  if (projectFolder.logs) logs.push(...projectFolder.logs);

  const isWindows = navigator.platform?.toLowerCase().includes("win");
  const sep = isWindows ? "\\" : "/";
  const saucerPath = projectFolder.data + sep + SAUCER_FOLDER;

  logs.push("Target folder: " + saucerPath);

  try {
    // Use UXP filesystem API to create the directory
    const { localFileSystem } = require("uxp").storage;
    const fs = localFileSystem;

    try {
      await fs.getEntryForUrl("file://" + saucerPath);
      logs.push("Folder already exists.");
    } catch {
      // Folder doesn't exist, create it
      logs.push("Creating folder...");
      const parentEntry = await fs.getEntryForUrl(
        "file://" + projectFolder.data
      );
      await parentEntry.createFolder(SAUCER_FOLDER);
      logs.push("Folder created.");
    }

    return success(saucerPath, logs);
  } catch (error: any) {
    logs.push("ERROR: " + (error?.message || "Unknown error"));
    return failure(
      error?.message || `Could not create folder: ${saucerPath}`,
      logs
    );
  }
};

/* ─── Import downloaded file into project ──────────────────── */

export const importDownloadedFile = async (
  filePath: string
): Promise<HostResponse<string>> => {
  const logs: string[] = ["--- UXP: importDownloadedFile ---"];
  logs.push("File to import: " + filePath);

  try {
    const project = await app.Project.getActiveProject();

    if (!project) {
      logs.push("ERROR: No active project.");
      return failure("No project is open.", logs);
    }

    await project.executeTransaction(async () => {
      logs.push("Inside transaction...");

      // Get the root item
      const rootItem = await project.getRootItem();
      logs.push("Got root item.");

      // Find or create the "Supreme Saucer" bin
      let targetBin: any = null;
      const children = await rootItem.getItems();

      for (const child of children) {
        if (child.name === SAUCER_FOLDER && child.type === "Bin") {
          targetBin = child;
          logs.push("Found existing Supreme Saucer bin.");
          break;
        }
      }

      if (!targetBin) {
        logs.push("Creating Supreme Saucer bin...");
        targetBin = await rootItem.createBinAction(SAUCER_FOLDER);
        logs.push("Bin created.");
      }

      // Import the file into the bin
      logs.push("Importing file...");
      await project.importFiles([filePath], targetBin);
      logs.push("File imported successfully.");
    }, "Supreme Saucer Import");

    return success(filePath, logs);
  } catch (error: any) {
    logs.push("ERROR: " + (error?.message || "Unknown error"));
    return failure(
      error?.message || "Import failed in Premiere Pro.",
      logs
    );
  }
};
