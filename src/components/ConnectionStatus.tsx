export interface ConnectionStatusProps {
  readonly status: "checking" | "connected" | "unavailable";
  readonly onRetry: () => void;
  readonly onRefresh?: () => void;
}

const unavailableGuidance =
  "Ollama could not be reached at localhost:11434. Make sure Ollama is installed and running. If it is already running, allow this page's origin in Ollama, then retry.";

export function ConnectionStatus({
  status,
  onRetry,
  onRefresh,
}: ConnectionStatusProps) {
  if (status === "unavailable") {
    return (
      <section aria-label="Ollama connection status" className="connection-status">
        <p role="alert">{unavailableGuidance}</p>
        <button type="button" onClick={onRetry}>
          Retry connection
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Ollama connection status" className="connection-status">
      <p role="status">
        {status === "checking" ? "Checking Ollama" : "Ollama connected"}
      </p>
      {status === "connected" && onRefresh !== undefined ? (
        <button type="button" onClick={onRefresh}>
          Refresh models
        </button>
      ) : null}
    </section>
  );
}
