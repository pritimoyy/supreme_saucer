import React from "react";
import { MusicIcon } from "./Icons";
import { QualityMode, YtdlpFormat } from "../../shared/supreme-saucer";

interface FormatPickerProps {
  isSpotify: boolean;
  quality: QualityMode;
  setQuality: (q: QualityMode) => void;
  audioOnly: boolean;
  setAudioOnly: (v: boolean) => void;
  formats: YtdlpFormat[];
  selectedFormat: string;
  setSelectedFormat: (id: string) => void;
  loadingFormats: boolean;
  isWorking: boolean;
}

export const FormatPicker: React.FC<FormatPickerProps> = ({
  isSpotify,
  quality,
  setQuality,
  audioOnly,
  setAudioOnly,
  formats,
  selectedFormat,
  setSelectedFormat,
  loadingFormats,
  isWorking,
}) => {
  return (
    <>
      {!isSpotify && (
        <div className="saucer__row">
          <div className="saucer__field" style={{ marginBottom: 0 }}>
            <label className="saucer__field-label" htmlFor="quality">Quality</label>
            <div className="saucer__select-wrap">
              <select
                id="quality"
                className="saucer__select"
                value={quality}
                onChange={(e) => setQuality(e.target.value as QualityMode)}
                disabled={isWorking}
              >
                <option value="best">Best available</option>
                <option value="manual">{audioOnly ? "Choose bitrate…" : "Choose resolution…"}</option>
              </select>
            </div>
          </div>

          <label className={`saucer__toggle${audioOnly ? " is-active" : ""}`} style={{ marginBottom: 0, alignSelf: "flex-end" }}>
            <input
              type="checkbox"
              checked={audioOnly}
              onChange={(e) => setAudioOnly(e.target.checked)}
              disabled={isWorking}
            />
            <span className="saucer__toggle-dot" />
            <MusicIcon />
            Audio
          </label>
        </div>
      )}

      {isSpotify && (
        <div className="saucer__row">
          <div className="saucer__field" style={{ marginBottom: 0 }}>
            <label className="saucer__field-label" htmlFor="spotify-quality">Bitrate</label>
            <div className="saucer__select-wrap">
              <select
                id="spotify-quality"
                className="saucer__select"
                value={quality}
                onChange={(e) => setQuality(e.target.value as QualityMode)}
                disabled={isWorking}
              >
                <option value="best">Highest available</option>
                <option value="manual">Choose bitrate…</option>
              </select>
            </div>
          </div>
          <span className="saucer__audio-pill">
            <MusicIcon /> Audio only
          </span>
        </div>
      )}

      {quality === "manual" && (
        <div className="saucer__field">
          <label className="saucer__field-label" htmlFor="format">
            {audioOnly ? "Bitrate" : "Resolution"}
          </label>
          {loadingFormats ? (
            <div className="saucer__format-status">
              <span className="saucer__spinner" />
              Scanning formats…
            </div>
          ) : (
            <div className="saucer__select-wrap">
              <select
                id="format"
                className="saucer__select"
                value={selectedFormat}
                onChange={(e) => setSelectedFormat(e.target.value)}
                disabled={isWorking || formats.length === 0}
              >
                {formats.length === 0 ? (
                  <option value="">Enter a URL above</option>
                ) : (
                  formats.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))
                )}
              </select>
            </div>
          )}
        </div>
      )}
    </>
  );
};
