import type { ApplicationError } from "./application-error";

export interface Connection {
  readonly status: "checking" | "connected" | "unavailable";
  readonly endpoint: "http://localhost:11434";
  readonly version?: string;
  readonly checkedAt?: number;
  readonly error?: ApplicationError;
}

export interface AudioCompatibilityDecision {
  readonly status: "compatible" | "unknown" | "incompatible";
  readonly evidence:
    | "service-capability"
    | "audio-encoder"
    | "family-rule"
    | "none";
  readonly reason: string;
}

export interface ModelOption {
  readonly name: string;
  readonly modifiedAt?: string;
  readonly sizeBytes?: number;
  readonly digest?: string;
  readonly family?: string;
  readonly families?: readonly string[];
  readonly parameterSize?: string;
  readonly quantization?: string;
  readonly detailsStatus: "not-requested" | "loading" | "loaded" | "failed";
  readonly compatibility: AudioCompatibilityDecision;
  readonly detailsError?: ApplicationError;
}

export interface SelectedAudio {
  readonly file: File;
  readonly name: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly decodedFormat?: string;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly frameLength: number;
  readonly previewUrl: string;
  readonly validation: "valid" | "invalid";
}

export interface AudioSegment {
  readonly index: number;
  readonly displayNumber: number;
  readonly startFrame: number;
  readonly endFrameExclusive: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly silence: "verified-silent" | "not-verified-silent";
  readonly wavByteLength?: number;
  readonly status:
    | "pending"
    | "processing"
    | "ready"
    | "submitted"
    | "completed"
    | "failed";
}

export interface TranscriptSegment {
  readonly segmentIndex: number;
  readonly startSeconds: number;
  readonly timestamp: string;
  readonly text: string;
  readonly source: "model" | "local-silence-marker";
}

export interface TranscriptDocument {
  readonly sourceFileName: string;
  readonly modelName: string;
  readonly status: "complete" | "partial-cancelled" | "partial-failed";
  readonly failedSegmentNumber?: number;
  readonly segments: readonly TranscriptSegment[];
  readonly markdown: string;
}
