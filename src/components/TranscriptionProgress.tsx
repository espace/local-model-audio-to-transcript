import type { RunState, RunProgress } from "../features/transcription/use-transcription";

interface Prerequisites {
  readonly connection: boolean;
  readonly modelSelected: boolean;
  readonly modelCompatible: boolean;
  readonly audioSelected: boolean;
  readonly isRunning: boolean;
}

interface TranscriptionProgressProps {
  readonly state: RunState;
  readonly progress: RunProgress | undefined;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onStartNewRun: () => void;
  readonly prerequisites: Prerequisites;
  readonly generatePrerequisitesId?: string;
}

function prerequisiteReasons(prereqs: Prerequisites): readonly string[] {
  const reasons: string[] = [];
  if (!prereqs.connection) {
    reasons.push("Ollama is not connected.");
  }
  if (!prereqs.modelSelected) {
    reasons.push("No model is selected.");
  }
  if (prereqs.modelSelected && !prereqs.modelCompatible) {
    reasons.push("Selected model is not audio compatible.");
  }
  if (!prereqs.audioSelected) {
    reasons.push("No audio file is selected.");
  }
  if (prereqs.isRunning) {
    reasons.push("A transcription run is already in progress.");
  }
  return reasons;
}

export function TranscriptionProgress({
  state,
  progress,
  onCancel,
  onRetry,
  onStartNewRun,
  prerequisites,
  generatePrerequisitesId,
}: TranscriptionProgressProps) {
  const missingReasons = prerequisiteReasons(prerequisites);

  function renderMissingReasons() {
    if (missingReasons.length === 0) {
      return null;
    }

    return (
      <ul id={generatePrerequisitesId}>
        {missingReasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
    );
  }

  if (state === "idle" || state === "completed") {
    return (
      <div>
        {state === "completed" ? (
          <p>Complete</p>
        ) : null}
        {renderMissingReasons()}
      </div>
    );
  }

  if (state === "preprocessing") {
    const percent = progress?.phase === "preprocessing" ? progress.current : 0;
    return (
      <div>
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <p>Preparing audio, {percent} percent</p>
        </div>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        {renderMissingReasons()}
      </div>
    );
  }

  if (state === "transcribing") {
    const current = progress?.phase === "transcribing" ? progress.current : 0;
    const total = progress?.phase === "transcribing" ? progress.total : 0;
    return (
      <div>
        <div
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <p>Transcribing section {current} of {total}</p>
        </div>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        {renderMissingReasons()}
      </div>
    );
  }

  if (state === "cancelled") {
    return (
      <div>
        <p>Transcription cancelled</p>
        <button type="button" onClick={onStartNewRun}>
          Start new run
        </button>
      </div>
    );
  }

  return (
    <div>
      <p>Transcription failed</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );

}
