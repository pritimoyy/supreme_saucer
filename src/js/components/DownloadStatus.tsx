import React from "react";

type StatusKind = "idle" | "info" | "error" | "success";

interface DownloadStatusProps {
  downloading: boolean;
  handleDownload: () => void;
  isWorking: boolean;
  showProgress: boolean;
  progress: number | null;
  status: string;
  statusKind: StatusKind;
}

export const DownloadStatus: React.FC<DownloadStatusProps> = ({
  downloading,
  handleDownload,
  isWorking,
  showProgress,
  progress,
  status,
  statusKind,
}) => {
  return (
    <>
      <button
        className={`saucer__download${downloading ? " is-loading" : ""}`}
        onClick={handleDownload}
        disabled={isWorking}
        id="download-btn"
      >
        {downloading && <span className="saucer__btn-spinner" />}
        {downloading ? "Downloading…" : "Download"}
      </button>

      {showProgress && (
        <div className="saucer__progress-wrap">
          {progress !== null ? (
            <>
              <div className="saucer__progress">
                <div className="saucer__progress-bar" style={{ width: `${progress}%` }} />
              </div>
              <div className="saucer__progress-label">{Math.round(progress)}%</div>
            </>
          ) : (
            <div className="saucer__progress-indeterminate" />
          )}
        </div>
      )}

      {status && statusKind !== "idle" && (
        <div className={`saucer__status saucer__status--${statusKind}`}>
          {status}
        </div>
      )}
    </>
  );
};
