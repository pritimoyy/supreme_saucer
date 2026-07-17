import React from "react";
import { ClipboardIcon } from "./Icons";

interface UrlInputProps {
  url: string;
  setUrl: (url: string) => void;
  isWorking: boolean;
  isSpotify: boolean;
  handlePaste: () => void;
}

export const UrlInput: React.FC<UrlInputProps> = ({ url, setUrl, isWorking, isSpotify, handlePaste }) => {
  return (
    <div className="saucer__field">
      <label className="saucer__field-label" htmlFor="url">Source URL</label>
      <div className="saucer__url-wrap">
        <input
          id="url"
          className="saucer__input"
          type="url"
          placeholder="YouTube, Spotify, Instagram, Pinterest…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isWorking}
          autoComplete="off"
          spellCheck={false}
        />
        {isSpotify ? (
          <span className="saucer__platform-badge saucer__platform-badge--spotify">
            ♫ Spotify
          </span>
        ) : (
          <button
            className="saucer__paste-btn"
            onClick={handlePaste}
            disabled={isWorking}
            title="Paste from clipboard"
          >
            <ClipboardIcon />
          </button>
        )}
      </div>
    </div>
  );
};
