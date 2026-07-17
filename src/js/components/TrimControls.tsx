import React from "react";
import { ScissorsIcon } from "./Icons";

interface TrimControlsProps {
  trimStart: string;
  setTrimStart: (v: string) => void;
  trimEnd: string;
  setTrimEnd: (v: string) => void;
  isWorking: boolean;
}

export const TrimControls: React.FC<TrimControlsProps> = ({
  trimStart,
  setTrimStart,
  trimEnd,
  setTrimEnd,
  isWorking,
}) => {
  return (
    <div className="saucer__trim">
      <div className="saucer__trim-header">
        <ScissorsIcon />
        <span>Trim</span>
        <span className="saucer__trim-badge">optional</span>
      </div>
      <div className="saucer__row saucer__row--equal" style={{ marginBottom: 0 }}>
        <div className="saucer__field" style={{ marginBottom: 0 }}>
          <label className="saucer__field-label" htmlFor="trim-start">Start</label>
          <input
            id="trim-start"
            className="saucer__input"
            type="text"
            inputMode="numeric"
            placeholder="HH:MM:SS"
            value={trimStart}
            onChange={(e) => setTrimStart(e.target.value)}
            disabled={isWorking}
          />
        </div>
        <div className="saucer__field" style={{ marginBottom: 0 }}>
          <label className="saucer__field-label" htmlFor="trim-end">End</label>
          <input
            id="trim-end"
            className="saucer__input"
            type="text"
            inputMode="numeric"
            placeholder="HH:MM:SS"
            value={trimEnd}
            onChange={(e) => setTrimEnd(e.target.value)}
            disabled={isWorking}
          />
        </div>
      </div>
    </div>
  );
};
