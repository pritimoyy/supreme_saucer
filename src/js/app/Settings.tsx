import React from "react";
import type { CookieBrowser, DownloadProgress, EngineStatus } from "../../shared/supreme-saucer";
import { COOKIE_BROWSERS } from "../../shared/supreme-saucer";
import type { EngineAction } from "./backend";
import { Icon, ProgressBar, Spinner, Switch } from "./ui";

type Props = {
  hostName: string;
  engine: EngineStatus | null;
  engineTask: DownloadProgress | null;
  checking: boolean;
  onEngineAction: (action: EngineAction) => void;
  onCheckUpdates: () => void;
  onAutoUpdate: (enabled: boolean) => void;
  cookiesFrom: CookieBrowser;
  onCookiesFrom: (browser: CookieBrowser) => void;
  importToProject: boolean;
  onImportToProject: (enabled: boolean) => void;
  onClose: () => void;
};

export const Settings: React.FC<Props> = ({
  hostName,
  engine,
  engineTask,
  checking,
  onEngineAction,
  onCheckUpdates,
  onAutoUpdate,
  cookiesFrom,
  onCookiesFrom,
  importToProject,
  onImportToProject,
  onClose,
}) => {
  const busy = Boolean(engineTask);
  const ytDlp = engine?.tools.find((t) => t.id === "yt-dlp");

  return (
    <div className="sheet" role="dialog" aria-label="Settings">
      <div className="sheet__backdrop" onClick={onClose} />
      <div className="sheet__panel glass">
        <div className="sheet__head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            <Icon.Close />
          </button>
        </div>

        {/* ── Engine ─────────────────────────────── */}
        <section className="sheet__section">
          <div className="sheet__title">
            <span>Download engine</span>
            {engine && (
              <span className={`pill ${engine.ready ? (engine.updateAvailable ? "pill--warn" : "pill--ok") : "pill--bad"}`}>
                {engine.ready ? (engine.updateAvailable ? "Update available" : "Up to date") : "Not installed"}
              </span>
            )}
          </div>

          <ul className="tools">
            {(engine?.tools ?? []).map((tool) => (
              <li key={tool.id} className="tools__row">
                <span className={`dot ${tool.installed ? "dot--ok" : "dot--bad"}`} />
                <div className="tools__text">
                  <strong>{tool.label}</strong>
                  <small>{tool.role}</small>
                </div>
                <code className="tools__ver">{tool.installed ? tool.version ?? "installed" : "missing"}</code>
              </li>
            ))}
            {!engine && (
              <li className="tools__row tools__row--loading">
                <Spinner /> Checking…
              </li>
            )}
          </ul>

          {engine?.updateAvailable && ytDlp && (
            <p className="note note--warn">
              yt-dlp {engine.latestYtDlp} is out (you have {ytDlp.version}). Sites change often — updating fixes most
              download errors.
            </p>
          )}

          {engineTask && (
            <div className="task">
              <ProgressBar percent={engineTask.percent} />
              <small>{engineTask.line}</small>
            </div>
          )}

          <div className="btn-row">
            {!engine?.ready ? (
              <button className="btn btn--primary" disabled={busy} onClick={() => onEngineAction("install")}>
                <Icon.Download /> Install engine
              </button>
            ) : (
              <button
                className={`btn ${engine.updateAvailable ? "btn--primary" : ""}`}
                disabled={busy}
                onClick={() => onEngineAction("update")}
              >
                <Icon.Refresh /> {engine.updateAvailable ? "Update yt-dlp" : "Update now"}
              </button>
            )}
            <button className="btn btn--ghost" disabled={busy || checking} onClick={onCheckUpdates}>
              {checking ? <Spinner size={12} /> : null} Check for updates
            </button>
          </div>

          <label className="row">
            <div className="row__text">
              <strong>Update automatically</strong>
              <small>Keeps yt-dlp current once a day, in the background.</small>
            </div>
            <Switch checked={engine?.autoUpdate ?? true} onChange={onAutoUpdate} disabled={!engine} label="Update automatically" />
          </label>

          <div className="row row--muted">
            <div className="row__text">
              <strong>Something broken?</strong>
              <small>Re-download every tool from scratch.</small>
            </div>
            <button className="btn btn--small btn--ghost" disabled={busy} onClick={() => onEngineAction("repair")}>
              Repair
            </button>
          </div>

          {engine && (
            <p className="fineprint" title={engine.folder}>
              <Icon.Folder /> {engine.folder}
            </p>
          )}
        </section>

        {/* ── Sign-in ────────────────────────────── */}
        <section className="sheet__section">
          <div className="sheet__title">
            <span>Use browser login</span>
          </div>
          <p className="fineprint fineprint--wrap">
            Instagram, Facebook, X and age-restricted YouTube often need you to be logged in. Pick the browser where
            you're signed in — its cookies are read locally and never leave this computer.
          </p>
          <div className="chips">
            {COOKIE_BROWSERS.map((b) => (
              <button
                key={b.id}
                className={`chip${cookiesFrom === b.id ? " is-active" : ""}`}
                onClick={() => onCookiesFrom(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
          {cookiesFrom === "safari" && (
            <p className="fineprint fineprint--wrap">
              Safari needs Full Disk Access for {hostName} (System Settings → Privacy &amp; Security).
            </p>
          )}
          {cookiesFrom === "chrome" && (
            <p className="fineprint fineprint--wrap">macOS may ask once to allow access to “Chrome Safe Storage”.</p>
          )}
        </section>

        {/* ── Import ─────────────────────────────── */}
        <section className="sheet__section">
          <label className="row">
            <div className="row__text">
              <strong>Import into {hostName}</strong>
              <small>Adds each download to the “Supreme Saucer” bin.</small>
            </div>
            <Switch checked={importToProject} onChange={onImportToProject} label="Import into project" />
          </label>
        </section>

        <p className="fineprint fineprint--wrap fineprint--center">
          Everything runs on this computer: yt-dlp fetches media straight from the site, FFmpeg converts it.
        </p>
      </div>
    </div>
  );
};
