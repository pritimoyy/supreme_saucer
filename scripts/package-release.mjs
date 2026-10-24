// Assembles everything users download into dist/release:
//   SupremeSaucer-<v>.zxp                    CEP panel — After Effects + Premiere Pro ≤ 2025 (Mac & Windows)
//   SupremeSaucer-<v>-Premiere2026.ccx       UXP panel — Premiere Pro 2026+
//   SupremeSaucer-Helper-<v>-<platform>.zip  Helper app the UXP panel talks to
//   INSTALL.md
//
// Run `npm run release` (it builds everything first). Uses bsdtar's zip
// support, which ships with both macOS and Windows 10+.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const out = path.join(root, "dist", "release");
const stage = path.join(root, "dist", "release-stage");

fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Force zip format: bsdtar would otherwise pick tar for unknown extensions like .ccx.
const zip = (cwd, zipPath, entries) =>
  execFileSync("tar", ["--format", "zip", "-cf", zipPath, ...entries], { cwd, stdio: "inherit" });
const need = (p) => {
  if (!fs.existsSync(p)) throw new Error(`Missing ${path.relative(root, p)} — run the build first.`);
  return p;
};

// CEP .zxp (already signed by `npm run zxp`)
fs.copyFileSync(
  need(path.join(root, "dist", "zxp", "com.pritimoy.supremesaucer.zxp")),
  path.join(out, `SupremeSaucer-${version}.zxp`)
);

// UXP .ccx is a zip of the plugin folder
const uxpDir = need(path.join(root, "dist", "uxp"));
zip(uxpDir, path.join(out, `SupremeSaucer-${version}-Premiere2026.ccx`), fs.readdirSync(uxpDir));

// Helper apps
const helpers = [
  { from: "server-macos-arm64", name: "Supreme Saucer Helper", platform: "mac-apple-silicon" },
  { from: "server-macos-x64", name: "Supreme Saucer Helper", platform: "mac-intel" },
  { from: "server-win-x64.exe", name: "Supreme Saucer Helper.exe", platform: "windows" },
];
for (const h of helpers) {
  const dir = path.join(stage, h.platform);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, h.name);
  fs.copyFileSync(need(path.join(root, "dist", "sidecar", "bin", h.from)), target);
  fs.chmodSync(target, 0o755);
  zip(dir, path.join(out, `SupremeSaucer-Helper-${version}-${h.platform}.zip`), [h.name]);
}

fs.copyFileSync(path.join(root, "INSTALL.md"), path.join(out, "INSTALL.md"));
fs.rmSync(stage, { recursive: true, force: true });

for (const f of fs.readdirSync(out)) {
  const mb = (fs.statSync(path.join(out, f)).size / 1024 / 1024).toFixed(1);
  console.log(`  ${f.padEnd(52)} ${mb} MB`);
}
