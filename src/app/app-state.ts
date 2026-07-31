import type { ApplicationError } from "../types/application-error";
import type {
  Connection,
  ModelOption,
  SelectedAudio,
  TranscriptDocument,
  TranscriptSegment,
} from "../types/domain";

declare const generationTokenBrand: unique symbol;
declare const runTokenBrand: unique symbol;

export type GenerationToken = number & {
  readonly [generationTokenBrand]: "GenerationToken";
};

export type RunToken = number & {
  readonly [runTokenBrand]: "RunToken";
};

export function createGenerationToken(value: number): GenerationToken {
  return value as GenerationToken;
}

export function createRunToken(value: number): RunToken {
  return value as RunToken;
}

export type TranscriptView = "rendered" | "raw";

type ConnectedConnection = Connection & { readonly status: "connected" };

interface ReadyContext {
  readonly connection: ConnectedConnection;
  readonly connectionGeneration: GenerationToken;
  readonly models: readonly ModelOption[];
  readonly selectedModel?: ModelOption;
  readonly selectedAudio?: SelectedAudio;
  readonly audioError?: ApplicationError;
  readonly transcript?: TranscriptDocument;
  readonly transcriptView: TranscriptView;
  readonly removedSelectedModelName?: string;
}

export type WorkflowState =
  | {
      readonly kind: "checking-connection";
      readonly connectionGeneration: GenerationToken;
      readonly transcript?: TranscriptDocument;
    }
  | {
      readonly kind: "service-unavailable";
      readonly connectionGeneration: GenerationToken;
      readonly error: ApplicationError;
      readonly transcript?: TranscriptDocument;
    }
  | {
      readonly kind: "loading-models";
      readonly connection: ConnectedConnection;
      readonly connectionGeneration: GenerationToken;
      readonly selectedModelName?: string;
      readonly isModelRefresh?: boolean;
      readonly models?: readonly ModelOption[];
      readonly transcript?: TranscriptDocument;
    }
  | {
      readonly kind: "no-models";
      readonly connection: ConnectedConnection;
      readonly connectionGeneration: GenerationToken;
      readonly transcript?: TranscriptDocument;
    }
  | {
      readonly kind: "model-list-failed";
      readonly connection: ConnectedConnection;
      readonly connectionGeneration: GenerationToken;
      readonly models: readonly ModelOption[];
      readonly error: ApplicationError;
      readonly selectedModelName?: string;
      readonly transcript?: TranscriptDocument;
    }
  | ({ readonly kind: "ready" } & ReadyContext)
  | ({
      readonly kind: "preprocessing";
      readonly runToken: RunToken;
      readonly progressPercent: number;
      readonly completedSegments: readonly TranscriptSegment[];
    } & Required<
      Pick<ReadyContext, "connection" | "connectionGeneration" | "selectedModel" | "selectedAudio">
    > &
      Pick<ReadyContext, "models" | "transcriptView">)
  | ({
      readonly kind: "transcribing";
      readonly runToken: RunToken;
      readonly completedSegments: readonly TranscriptSegment[];
      readonly completedSegmentCount: number;
      readonly totalSegmentCount: number;
    } & Required<
      Pick<ReadyContext, "connection" | "connectionGeneration" | "selectedModel" | "selectedAudio">
    > &
      Pick<ReadyContext, "models" | "transcriptView">)
  | ({
      readonly kind: "completed";
      readonly transcript: TranscriptDocument;
    } & ReadyContext)
  | ({
      readonly kind: "cancelled";
      readonly transcript?: TranscriptDocument;
    } & ReadyContext)
  | ({
      readonly kind: "failed";
      readonly error: ApplicationError;
      readonly transcript?: TranscriptDocument;
    } & ReadyContext);

export type WorkflowEvent =
  | { readonly type: "page-opened" }
  | { readonly type: "connection-retry-requested" }
  | {
      readonly type: "connection-resolved";
      readonly generation: GenerationToken;
      readonly version?: string;
    }
  | {
      readonly type: "connection-failed";
      readonly generation: GenerationToken;
      readonly error: ApplicationError;
    }
  | { readonly type: "models-refresh-requested" }
  | {
      readonly type: "model-list-failed";
      readonly generation: GenerationToken;
      readonly error: ApplicationError;
    }
  | {
      readonly type: "models-resolved";
      readonly generation: GenerationToken;
      readonly models: readonly ModelOption[];
      readonly removedSelectedModelName?: string;
    }
  | {
      readonly type: "model-details-resolved";
      readonly generation: GenerationToken;
      readonly model: ModelOption;
    }
  | {
      readonly type: "model-details-failed";
      readonly generation: GenerationToken;
      readonly modelName: string;
      readonly error: ApplicationError;
    }
  | {
      readonly type: "model-selected";
      readonly modelName?: string;
    }
  | { readonly type: "file-selected"; readonly file: File }
  | { readonly type: "file-validated"; readonly audio: SelectedAudio }
  | { readonly type: "file-rejected"; readonly error: ApplicationError }
  | { readonly type: "file-removed" }
  | { readonly type: "transcription-requested"; readonly runToken: RunToken }
  | {
      readonly type: "preprocess-progress";
      readonly runToken: RunToken;
      readonly progressPercent: number;
    }
  | {
      readonly type: "segment-completed";
      readonly runToken: RunToken;
      readonly segment: TranscriptSegment;
      readonly totalSegmentCount: number;
    }
  | {
      readonly type: "transcription-completed";
      readonly runToken: RunToken;
      readonly transcript: TranscriptDocument;
    }
  | {
      readonly type: "transcription-failed";
      readonly runToken: RunToken;
      readonly error: ApplicationError;
      readonly transcript?: TranscriptDocument;
    }
  | { readonly type: "transcription-cancel-requested"; readonly runToken: RunToken }
  | {
      readonly type: "transcription-cancelled";
      readonly runToken: RunToken;
      readonly transcript?: TranscriptDocument;
    }
  | { readonly type: "transcription-retry-requested"; readonly runToken: RunToken }
  | { readonly type: "view-changed"; readonly view: TranscriptView }
  | { readonly type: "copy-requested" }
  | { readonly type: "copy-succeeded" }
  | { readonly type: "copy-failed"; readonly error: ApplicationError }
  | { readonly type: "download-requested" };

export function createInitialWorkflowState(): WorkflowState {
  return {
    kind: "checking-connection",
    connectionGeneration: createGenerationToken(0),
  };
}
