import type { StrategyContext } from "../../services/ollama/ollama.types";

export type { StrategyContext };

export interface ProcessedSegment {
  readonly index: number;
  readonly displayNumber: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly silence: "verified-silent" | "not-verified-silent";
  readonly wavBlob?: Blob;
}

export interface DecodedAudioHandle {
  readonly buffer: AudioBuffer;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly frameLength: number;
  readonly decodedFormat?: string;
}

export interface TranscriptionRunInput {
  readonly file: File;
  readonly selectedModelName: string;
  readonly signal: AbortSignal;
}

export interface TranscriptionRetryInput {
  readonly file: File;
  readonly selectedModelName: string;
  readonly signal: AbortSignal;
  readonly failedSegmentIndex: number;
}

export type ProgressCallback = (
  phase: "preprocessing" | "transcribing",
  current: number,
  total: number,
) => void;

export type TranscriptionResultStatus =
  | "complete"
  | "partial-cancelled"
  | "partial-failed";

export interface TranscriptionRunResult {
  readonly status: TranscriptionResultStatus;
  readonly segments: readonly ProcessedSegment[];
  readonly failedSegmentIndex?: number;
}
