import type { SelectedAudio } from "../types/domain";

export interface AudioPreviewProps {
  readonly audio: SelectedAudio;
  readonly onRemove: () => void;
}

function formatDecimalMegabytes(sizeBytes: number): string {
  return `${(sizeBytes / 1_000_000).toFixed(1)} MB`;
}

function formatDuration(durationSeconds: number): string {
  const totalSeconds = Math.floor(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function AudioPreview({ audio, onRemove }: AudioPreviewProps) {
  const format = audio.decodedFormat ?? audio.mimeType;

  return (
    <section aria-labelledby="audio-preview-title" className="audio-preview">
      <h3 id="audio-preview-title">Selected audio</h3>
      <dl>
        <dt>Name</dt>
        <dd>{audio.name}</dd>
        <dt>Size</dt>
        <dd>{formatDecimalMegabytes(audio.sizeBytes)}</dd>
        <dt>Format</dt>
        <dd>{format}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(audio.durationSeconds)}</dd>
      </dl>
      <audio aria-label="Audio preview" controls src={audio.previewUrl}>
        Your browser does not support audio playback.
      </audio>
      <button onClick={onRemove} type="button">
        Remove audio
      </button>
    </section>
  );
}
