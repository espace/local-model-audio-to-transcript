import { useRef, type KeyboardEvent } from "react";

import type { ApplicationError } from "../types/application-error";
import type { TranscriptDocument } from "../types/domain";
import { SafeMarkdown } from "../services/markdown/safe-markdown";

export interface TranscriptViewerProps {
  readonly transcript?: TranscriptDocument;
  readonly view: "rendered" | "raw";
  readonly onViewChange: (view: "rendered" | "raw") => void;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
  readonly onRetry?: () => void;
  readonly copyError?: ApplicationError;
  readonly downloadError?: ApplicationError;
}

const renderedTabId = "transcript-rendered-tab";
const rawTabId = "transcript-raw-tab";

export function TranscriptViewer({
  transcript,
  view,
  onViewChange,
  onCopy,
  onDownload,
  onRetry,
  copyError,
  downloadError,
}: TranscriptViewerProps) {
  const renderedTabRef = useRef<HTMLButtonElement>(null);
  const rawTabRef = useRef<HTMLButtonElement>(null);
  const hasTranscript = transcript !== undefined;
  const isPartial =
    hasTranscript &&
    (transcript.status === "partial-cancelled" || transcript.status === "partial-failed");
  const isFailedPartial = hasTranscript && transcript.status === "partial-failed";

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentView: "rendered" | "raw") {
    if (
      event.key !== "ArrowRight" &&
      event.key !== "ArrowLeft" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();

    const nextView =
      event.key === "Home"
        ? "rendered"
        : event.key === "End"
          ? "raw"
          : currentView === "rendered"
            ? "raw"
            : "rendered";

    onViewChange(nextView);

    if (nextView === "rendered") {
      renderedTabRef.current?.focus();
    } else {
      rawTabRef.current?.focus();
    }
  }

  return (
    <div className="transcript-viewer">
      <div className="transcript-viewer-actions">
        <div className="transcript-viewer-tabs" role="tablist" aria-label="Transcript view">
          <button
            ref={renderedTabRef}
            id={renderedTabId}
            role="tab"
            aria-selected={view === "rendered"}
            aria-controls="transcript-panel"
            tabIndex={view === "rendered" ? 0 : -1}
            disabled={!hasTranscript}
            onClick={() => { onViewChange("rendered"); }}
            onKeyDown={(event) => { handleTabKeyDown(event, "rendered"); }}
          >
            Rendered
          </button>
          <button
            ref={rawTabRef}
            id={rawTabId}
            role="tab"
            aria-selected={view === "raw"}
            aria-controls="transcript-panel"
            tabIndex={view === "raw" ? 0 : -1}
            disabled={!hasTranscript}
            onClick={() => { onViewChange("raw"); }}
            onKeyDown={(event) => { handleTabKeyDown(event, "raw"); }}
          >
            Raw
          </button>
        </div>
        <div className="transcript-viewer-buttons">
          <button
            aria-label="Copy transcript"
            disabled={!hasTranscript}
            onClick={onCopy}
            type="button"
          >
            Copy
          </button>
          <button
            aria-label="Download transcript"
            disabled={!hasTranscript}
            onClick={onDownload}
            type="button"
          >
            Download .md
          </button>
        </div>
      </div>

      {copyError === undefined ? null : (
        <p className="transcript-viewer-error" role="alert">
          {copyError.message}
        </p>
      )}

      {downloadError === undefined ? null : (
        <p className="transcript-viewer-error" role="alert">
          {downloadError.message}
        </p>
      )}

      {isPartial ? (
        <p className="transcript-viewer-warning" role="status">
          Partial transcript — some sections are missing.
        </p>
      ) : null}

      {isFailedPartial ? (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}

      {!hasTranscript ? (
        <p>Your complete or partial Markdown transcript will appear here.</p>
      ) : (
        <div
          id="transcript-panel"
          aria-labelledby={view === "rendered" ? renderedTabId : rawTabId}
          role="tabpanel"
          tabIndex={-1}
          dir="auto"
        >
          {view === "rendered" ? (
            <SafeMarkdown markdown={transcript.markdown} />
          ) : (
            <pre><code>{transcript.markdown}</code></pre>
          )}
        </div>
      )}
    </div>
  );
}
