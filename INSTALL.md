# Installing Supreme Saucer

Supreme Saucer works on **macOS** (Apple Silicon and Intel) and **Windows 10/11 (64-bit)**.
Pick the section that matches your app and version.

| Your app | Download | Section |
|---|---|---|
| After Effects (any version) | `SupremeSaucer-<version>.zxp` | [A](#a-after-effects--premiere-pro-2025-and-older) |
| Premiere Pro 2025 or older | `SupremeSaucer-<version>.zxp` | [A](#a-after-effects--premiere-pro-2025-and-older) |
| Premiere Pro 2026 or newer | `SupremeSaucer-<version>-Premiere2026.ccx` **and** the Helper zip for your computer | [B](#b-premiere-pro-2026-and-newer) |

You **don't** need to install yt-dlp, FFmpeg or anything else. The first time you open the panel it
shows **Install engine**. One click downloads everything it needs (about 200 MB, under a minute),
and it keeps itself up to date.

---

## A. After Effects / Premiere Pro 2025 and older

The `.zxp` file is the same for Mac and Windows.

### macOS
1. Download and install **[ZXP Installer](https://aescripts.com/learn/zxp-installer/)** (free, by aescripts).
2. Quit Premiere Pro / After Effects.
3. Drag `SupremeSaucer-<version>.zxp` onto the ZXP Installer window.
4. Open your app → **Window → Extensions → Supreme Saucer**.

### Windows
1. Download and install **[ZXP Installer](https://aescripts.com/learn/zxp-installer/)**.
2. Close Premiere Pro / After Effects.
3. Drag `SupremeSaucer-<version>.zxp` onto the ZXP Installer window.
4. Open your app → **Window → Extensions → Supreme Saucer**.

> If ZXP Installer won't run, use [Anastasiy's Extension Manager](https://install.anastasiy.com/) instead;
> it works the same way.

---

## B. Premiere Pro 2026 and newer

Premiere 2026 uses Adobe's new plugin system, which isn't allowed to run programs. So the panel
works together with a small **Helper** app that does the downloading. You need both.

### macOS
1. **Install the plugin:** double-click `SupremeSaucer-<version>-Premiere2026.ccx`. Creative Cloud
   opens and installs it; confirm the prompt.
2. **Install the Helper:** download the zip for your Mac:
   - Apple Silicon (M1/M2/M3/M4…): `SupremeSaucer-Helper-<version>-mac-apple-silicon.zip`
   - Intel: `SupremeSaucer-Helper-<version>-mac-intel.zip`

   (Not sure which? Apple menu → About This Mac → "Chip" means Apple Silicon, "Processor" means Intel.)
3. Unzip it and move **Supreme Saucer Helper** to your Applications folder.
4. **First launch only:** the Helper isn't signed by Apple yet, so macOS will block a normal
   double-click. **Right-click** (or Control-click) it → **Open** → **Open**.
   If you only see "Move to Trash", open **System Settings → Privacy & Security**, scroll down and
   click **Open Anyway**.
5. A Terminal window opens and shows `Supreme Saucer helper running…`. Leave it open while you work
   (you can minimise it).
6. In Premiere Pro: **Window → UXP Plugins → Supreme Saucer**. The panel connects automatically.

### Windows
1. **Install the plugin:** double-click `SupremeSaucer-<version>-Premiere2026.ccx`. Creative Cloud
   opens and installs it; confirm the prompt.
2. **Install the Helper:** download `SupremeSaucer-Helper-<version>-windows.zip`, right-click →
   **Extract All…**, and put **Supreme Saucer Helper.exe** somewhere permanent (for example
   `C:\Program Files\Supreme Saucer\`).
3. Double-click **Supreme Saucer Helper.exe**. If Windows SmartScreen says "Windows protected your
   PC", click **More info → Run anyway** (this happens once because the app isn't code-signed yet).
4. A console window opens and shows `Supreme Saucer helper running…`. Leave it open while you work.
5. In Premiere Pro: **Window → UXP Plugins → Supreme Saucer**.

> **If double-clicking the .ccx doesn't install it:** install Adobe's free
> [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/) from Creative Cloud,
> click **Add Plugin**, and choose the `manifest.json` inside the .ccx. (A .ccx is a zip file: rename it to .zip
> to extract it.)

### Start the Helper automatically (optional)
- **macOS:** System Settings → General → **Login Items** → **+** → choose Supreme Saucer Helper.
- **Windows:** press `Win + R`, type `shell:startup`, and put a shortcut to `Supreme Saucer Helper.exe` in
  that folder.

---

## Where downloads go

Files are saved to a **`Supreme Saucer` folder next to your project file**. For example, a project at
`Documents/Edits/Promo.prproj` saves to `Documents/Edits/Supreme Saucer/`. They are also imported
into a **Supreme Saucer** bin, which you can turn off in Settings. **Save your project once** before your
first download.

## Logging in for Instagram, Facebook and X

Many posts only load when you're logged in. In the panel, open **Settings → Use browser login**
and pick the browser where you're signed in. Cookies are read locally and never leave your computer.
- **Safari (macOS):** give Premiere Pro / After Effects **Full Disk Access** in System Settings →
  Privacy & Security.
- **Chrome (macOS):** allow the one-time "Chrome Safe Storage" keychain prompt.
- **Windows:** close the browser before downloading if it says it can't read the cookies.

## Uninstalling
- **Panel:** ZXP Installer / Creative Cloud → Plugins → Supreme Saucer → Remove.
- **Engine files:** delete `~/Library/Application Support/Supreme Saucer` (Mac) or
  `%APPDATA%\Supreme Saucer` (Windows).
- **Helper:** delete the app.
