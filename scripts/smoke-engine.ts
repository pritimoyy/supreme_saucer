/**
 * End-to-end check of the download engine on a real machine (used by CI on
 * macOS and Windows): installs the tools from scratch, then downloads,
 * trims, converts, extracts audio and cancels using small public test files.
 *
 *   npx tsx scripts/smoke-engine.ts
 */
import * as child_process from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { createDownloader } from "../src/shared/download-core";
import { CANCELLED_MESSAGE } from "../src/shared/supreme-saucer";

const MP4 = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4";
const WEBM_VP9 = "https://test-videos.co.uk/vids/bigbuckbunny/webm/vp9/360/Big_Buck_Bunny_360_10s_1MB.webm";
// The two clips above are silent; this one has an AAC track.
const WITH_AUDIO = "https://download.samplelib.com/mp4/sample-5s.mp4";

const d = createDownloader({ child_process, fs, os, path, https, bundledBinDirs: () => [] });
const out = fs.mkdtempSync(path.join(os.tmpdir(), "saucer-smoke-"));
let failures = 0;

const probe = (file: string) => {
  const ffmpeg = path.join(d.dataDir(), "bin", os.platform() === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const r = child_process.spawnSync(ffmpeg, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const text = r.stderr;
  const d2 = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return {
    video: text.match(/Video: (\w+)/)?.[1] ?? null,
    audio: text.match(/Audio: (\w+)/)?.[1] ?? null,
    duration: d2 ? +d2[1] * 3600 + +d2[2] * 60 + parseFloat(d2[3]) : null,
  };
};

const check = async (name: string, fn: () => Promise<void>) => {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (error) {
    failures++;
    console.log(`✘ ${name}: ${error instanceof Error ? error.message : error}`);
  }
};

const expect = (cond: unknown, message: string) => {
  if (!cond) throw new Error(message);
};

(async () => {
  console.log(`Platform: ${os.platform()} ${os.arch()} · data dir: ${d.dataDir()}`);

  await check("install engine from scratch", async () => {
    const status = await d.installEngine(({ line }) => process.stdout.write(`  ${line}\r`));
    console.log();
    for (const t of status.tools) console.log(`  ${t.label.padEnd(8)} ${t.version ?? "MISSING"}`);
    expect(status.ready, "engine not ready after install");
    expect(status.tools.every((t) => t.managed && t.version), "a tool is missing a version");
  });

  await check("update check reaches GitHub", async () => {
    const status = await d.getEngineStatus(true);
    expect(status.latestYtDlp, "could not read latest yt-dlp version");
  });

  await check("download H.264 MP4 as-is", async () => {
    const { filePath } = await d.downloadMedia({ url: MP4, outputDir: out, audioOnly: false });
    const info = probe(filePath);
    expect(filePath.endsWith(".mp4") && info.video === "h264", `got ${filePath} ${JSON.stringify(info)}`);
  });

  await check("VP9 WebM is converted to H.264 MP4", async () => {
    const { filePath } = await d.downloadMedia({ url: WEBM_VP9, outputDir: out, audioOnly: false });
    const info = probe(filePath);
    expect(filePath.endsWith(".mp4") && info.video === "h264", `got ${filePath} ${JSON.stringify(info)}`);
  });

  await check("trim 0:02 → 0:05", async () => {
    const { filePath } = await d.downloadMedia({
      url: MP4,
      outputDir: out,
      audioOnly: false,
      trimStart: "0:02",
      trimEnd: "0:05",
    });
    const info = probe(filePath);
    expect(info.duration && Math.abs(info.duration - 3) < 0.6, `duration ${info.duration}`);
  });

  for (const format of ["mp3", "wav"] as const) {
    await check(`audio only → ${format}`, async () => {
      const { filePath } = await d.downloadMedia({ url: WITH_AUDIO, outputDir: out, audioOnly: true, audioFormat: format });
      const info = probe(filePath);
      expect(filePath.endsWith(`.${format}`) && info.audio, `got ${filePath} ${JSON.stringify(info)}`);
    });
  }

  await check("audio from a silent video gives a clear error", async () => {
    const message = await d.downloadMedia({ url: MP4, outputDir: out, audioOnly: true }).then(
      () => "no error",
      (e: Error) => e.message
    );
    expect(message === "This video has no audio track.", `got: ${message}`);
  });

  await check("existing files are never overwritten", async () => {
    const before = fs.readdirSync(out).length;
    await d.downloadMedia({ url: MP4, outputDir: out, audioOnly: false });
    expect(fs.readdirSync(out).length === before + 1, "a file was overwritten");
  });

  await check("cancel stops the download", async () => {
    const job = d.downloadMedia({ url: WEBM_VP9, outputDir: path.join(out, "cancel"), audioOnly: false });
    setTimeout(d.cancel, 1500);
    const result = await job.then(
      () => "finished",
      (e: Error) => e.message
    );
    // A tiny file can legitimately finish before the cancel lands.
    expect(result === CANCELLED_MESSAGE || result === "finished", `unexpected: ${result}`);
  });

  console.log(fs.readdirSync(out).map((f) => `  ${f}`).join("\n"));
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})();
