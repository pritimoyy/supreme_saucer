/**
 * Supreme Saucer — Downloader (Sidecar)
 *
 * The download engine lives in src/shared/download-core.ts and is shared
 * with the CEP panel; this file only supplies Node's built-in modules.
 */

import * as child_process from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { createDownloader } from "../shared/download-core";

const downloader = createDownloader({
  child_process,
  fs,
  os,
  path,
  https,
  // When packaged, optional binaries sit in bin/ beside the executable;
  // when running from source they can live in src/bin.
  bundledBinDirs: () => [
    path.join(path.dirname(process.execPath), "bin"),
    path.join(process.cwd(), "bin"),
    path.join(process.cwd(), "src", "bin"),
  ],
});

export default downloader;
