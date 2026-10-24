import { child_process, fs, https, os, path } from "../cep/node";
import { csi } from "../utils/bolt";
import { createDownloader } from "../../../shared/download-core";

export const getExtensionRoot = () => csi.getSystemPath("extension");

const downloader = createDownloader({
  child_process,
  fs,
  os,
  path,
  https,
  // Optional: binaries copied into the extension's bin/ folder at build time.
  bundledBinDirs: () => [path.join(getExtensionRoot(), "bin")],
});

export default downloader;
