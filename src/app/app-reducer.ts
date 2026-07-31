import { appConfig } from "../config/app-config";
import { buildTranscript } from "../services/markdown/transcript-builder";

import {
  createGenerationToken,
  createInitialWorkflowState,
  type WorkflowEvent,
  type TranscriptView,
  type WorkflowState,
} from "./app-state";

type ReadyLikeState = Extract<
  WorkflowState,
  { kind: "ready" | "completed" | "cancelled" | "failed" }
>;

type ReadyLikeOverrides = Partial<
  Pick<
    Extract<WorkflowState, { kind: "ready" }>,
    | "models"
    | "selectedModel"
    | "selectedAudio"
    | "audioError"
    | "transcriptView"
    | "transcript"
    | "removedSelectedModelName"
  >
>;

function createPartialTranscript(
  state: Extract<WorkflowState, { kind: "preprocessing" } | { kind: "transcribing" }>,
  status: "partial-failed" | "partial-cancelled",
) {
  const completedSegmentCount = "completedSegmentCount" in state ? state.completedSegmentCount : state.completedSegments.length;
  const failedSegmentNumber = completedSegmentCount + 1;

  return {
    sourceFileName: state.selectedAudio.name,
    modelName: state.selectedModel.name,
    status,
    ...(status === "partial-failed" ? { failedSegmentNumber } : {}),
    segments: state.completedSegments,
    markdown: buildTranscript({
      sourceFileName: state.selectedAudio.name,
      modelName: state.selectedModel.name,
      status,
      ...(status === "partial-failed" ? { failedSegmentNumber } : {}),
      segments: state.completedSegments,
    }),
  };
}

function updateTranscriptView(state: WorkflowState, view: TranscriptView): WorkflowState {
  switch (state.kind) {
    case "ready":
    case "preprocessing":
    case "transcribing":
    case "completed":
    case "cancelled":
    case "failed":
      return { ...state, transcriptView: view };
    default:
      return state;
  }
}

function assertUnreachable(event: never): never {
  throw new Error(`Unhandled workflow event: ${String(event)}`);
}

function retainedTranscriptAfterConnectionFailure(
  state: WorkflowState,
) {
  if (state.kind === "transcribing") {
    return state.completedSegments.length === 0
      ? undefined
      : createPartialTranscript(state, "partial-failed");
  }

  return "transcript" in state ? state.transcript : undefined;
}

function readySelectionState(
  state: ReadyLikeState,
  overrides: ReadyLikeOverrides = {},
): WorkflowState {
  const hasOverride = (key: keyof ReadyLikeOverrides): boolean =>
    Object.prototype.hasOwnProperty.call(overrides, key);

  return {
    kind: "ready",
    connection: state.connection,
    connectionGeneration: state.connectionGeneration,
    models: overrides.models ?? state.models,
    selectedModel: hasOverride("selectedModel") ? overrides.selectedModel : state.selectedModel,
    selectedAudio: hasOverride("selectedAudio") ? overrides.selectedAudio : state.selectedAudio,
    audioError: hasOverride("audioError")
      ? overrides.audioError
      : "audioError" in state
        ? state.audioError
        : undefined,
    transcriptView: overrides.transcriptView ?? state.transcriptView,
    transcript: hasOverride("transcript") ? overrides.transcript : state.transcript,
    removedSelectedModelName: hasOverride("removedSelectedModelName")
      ? overrides.removedSelectedModelName
      : "removedSelectedModelName" in state
        ? state.removedSelectedModelName
        : undefined,
  };
}

export function createInitialState(): WorkflowState {
  return createInitialWorkflowState();
}

export function appReducer(
  state: WorkflowState,
  event: WorkflowEvent,
): WorkflowState {
  switch (event.type) {
    case "connection-retry-requested":
      if (state.kind !== "service-unavailable") {
        return state;
      }

      return {
        kind: "checking-connection",
        connectionGeneration: createGenerationToken(
          Number(state.connectionGeneration) + 1,
        ),
        ...(state.transcript === undefined ? {} : { transcript: state.transcript }),
      };

    case "connection-resolved":
      if (
        state.kind !== "checking-connection" ||
        state.connectionGeneration !== event.generation
      ) {
        return state;
      }

      return {
        kind: "loading-models",
        connection: {
          status: "connected",
          endpoint: appConfig.ollamaEndpoint,
          ...(event.version === undefined ? {} : { version: event.version }),
        },
        connectionGeneration: state.connectionGeneration,
        ...(state.transcript === undefined ? {} : { transcript: state.transcript }),
      };

    case "connection-failed":
      if (state.connectionGeneration !== event.generation) {
        return state;
      }

      return {
        kind: "service-unavailable",
        connectionGeneration: state.connectionGeneration,
        error: event.error,
        ...(retainedTranscriptAfterConnectionFailure(state) === undefined
          ? {}
          : { transcript: retainedTranscriptAfterConnectionFailure(state) }),
      };

    case "models-resolved": {
      if (
        state.kind !== "loading-models" ||
        state.connectionGeneration !== event.generation
      ) {
        return state;
      }

      if (event.models.length === 0) {
        return {
          kind: "no-models",
          connection: state.connection,
          connectionGeneration: state.connectionGeneration,
          ...(state.transcript === undefined
            ? {}
            : { transcript: state.transcript }),
        };
      }

      const selectedModel =
        state.selectedModelName === undefined
          ? undefined
          : event.models.find(
              (model) =>
                model.name === state.selectedModelName &&
                model.compatibility.status !== "incompatible",
            );

      return {
        kind: "ready",
        connection: state.connection,
        connectionGeneration: state.connectionGeneration,
        models: event.models,
        transcriptView: "rendered",
        ...(selectedModel === undefined ? {} : { selectedModel }),
        ...(event.removedSelectedModelName === undefined
          ? {}
          : { removedSelectedModelName: event.removedSelectedModelName }),
        ...(state.transcript === undefined
          ? {}
          : { transcript: state.transcript }),
      };
    }

    case "models-refresh-requested":
      if (
        state.kind !== "ready" &&
        state.kind !== "no-models" &&
        state.kind !== "model-list-failed"
      ) {
        return state;
      }

      return {
        kind: "loading-models",
        connection: state.connection,
        connectionGeneration: state.connectionGeneration,
        isModelRefresh: true,
        ...(state.kind === "ready" && state.selectedModel !== undefined
          ? { selectedModelName: state.selectedModel.name }
          : {}),
        ...(state.kind === "ready" ? { models: state.models } : {}),
        ...(state.kind === "model-list-failed"
          ? {
              selectedModelName: state.selectedModelName,
              models: state.models,
            }
          : {}),
        ...(state.transcript === undefined ? {} : { transcript: state.transcript }),
      };

    case "model-list-failed":
      if (
        state.kind !== "loading-models" ||
        state.connectionGeneration !== event.generation
      ) {
        return state;
      }

      return {
        kind: "model-list-failed",
        connection: state.connection,
        connectionGeneration: state.connectionGeneration,
        models: state.models ?? [],
        error: event.error,
        ...(state.selectedModelName === undefined
          ? {}
          : { selectedModelName: state.selectedModelName }),
        ...(state.transcript === undefined
          ? {}
          : { transcript: state.transcript }),
      };

    case "model-selected": {
      if (
        state.kind !== "ready" &&
        state.kind !== "completed" &&
        state.kind !== "cancelled" &&
        state.kind !== "failed"
      ) {
        return state;
      }

      if (event.modelName === undefined) {
        return readySelectionState(state, {
          selectedModel: undefined,
          removedSelectedModelName: undefined,
        });
      }

      const model = state.models.find((candidate) => candidate.name === event.modelName);
      if (model === undefined || model.compatibility.status === "incompatible") {
        return state;
      }

      return readySelectionState(state, {
        selectedModel: model,
        removedSelectedModelName: undefined,
      });
    }

    case "model-details-resolved":
      if (state.kind !== "ready" || state.connectionGeneration !== event.generation) {
        return state;
      }
      return {
        ...state,
        models: state.models.map((model) =>
          model.name === event.model.name ? event.model : model,
        ),
        ...(state.selectedModel?.name === event.model.name
          ? { selectedModel: event.model }
          : {}),
      };

    case "model-details-failed":
      return state;

    case "file-selected":
      if (
        state.kind !== "ready" &&
        state.kind !== "completed" &&
        state.kind !== "cancelled" &&
        state.kind !== "failed"
      ) {
        return state;
      }
      return readySelectionState(state, {
        selectedAudio: undefined,
        transcript: undefined,
        audioError: undefined,
      });

    case "file-validated":
      if (
        state.kind !== "ready" &&
        state.kind !== "completed" &&
        state.kind !== "cancelled" &&
        state.kind !== "failed"
      ) {
        return state;
      }
      return readySelectionState(state, {
        selectedAudio: event.audio,
        audioError: undefined,
        transcript: undefined,
      });

    case "file-rejected":
      if (
        state.kind !== "ready" &&
        state.kind !== "completed" &&
        state.kind !== "cancelled" &&
        state.kind !== "failed"
      ) {
        return state;
      }
      return readySelectionState(state, {
        selectedAudio: undefined,
        transcript: undefined,
        audioError: event.error,
      });

    case "file-removed":
      if (
        state.kind !== "ready" &&
        state.kind !== "completed" &&
        state.kind !== "cancelled" &&
        state.kind !== "failed"
      ) {
        return state;
      }
      return readySelectionState(state, {
        selectedAudio: undefined,
        transcript: undefined,
        audioError: undefined,
      });

    case "transcription-failed":
      if (
        (state.kind !== "preprocessing" && state.kind !== "transcribing") ||
        state.runToken !== event.runToken
      ) {
        return state;
      }

      if (event.error.code === "OLLAMA_UNREACHABLE") {
        return {
          kind: "service-unavailable",
          connectionGeneration: state.connectionGeneration,
          error: event.error,
          ...(state.completedSegments.length === 0
            ? {}
            : { transcript: createPartialTranscript(state, "partial-failed") }),
        };
      }

      if (event.error.code === "MODEL_NOT_FOUND") {
        return {
          kind: "ready",
          connection: state.connection,
          connectionGeneration: state.connectionGeneration,
          models: state.models,
          selectedModel: undefined,
          selectedAudio: state.selectedAudio,
          audioError: undefined,
          transcriptView: state.transcriptView,
          removedSelectedModelName: state.selectedModel.name,
          ...(state.completedSegments.length === 0
            ? {}
            : { transcript: createPartialTranscript(state, "partial-failed") }),
        };
      }

      return {
        kind: "failed",
        connection: state.connection,
        connectionGeneration: state.connectionGeneration,
        models: state.models,
        selectedModel: state.selectedModel,
        selectedAudio: state.selectedAudio,
        transcriptView: state.transcriptView,
        error: event.error,
        transcript: event.transcript ?? createPartialTranscript(state, "partial-failed"),
      };

    case "transcription-cancelled":
      if (state.kind !== "transcribing" || state.runToken !== event.runToken) {
        return state;
      }

      return {
        kind: "cancelled",
        connection: state.connection,
        connectionGeneration: state.connectionGeneration,
        models: state.models,
        selectedModel: state.selectedModel,
        selectedAudio: state.selectedAudio,
        transcriptView: state.transcriptView,
        ...(event.transcript !== undefined
          ? { transcript: event.transcript }
          : state.completedSegments.length === 0
            ? {}
            : { transcript: createPartialTranscript(state, "partial-cancelled") }),
      };

    case "page-opened":
      return state;

    case "transcription-requested": {
      if (
        state.kind !== "ready" &&
        state.kind !== "completed" &&
        state.kind !== "cancelled" &&
        state.kind !== "failed"
      ) {
        return state;
      }

      if (state.selectedModel === undefined || state.selectedAudio === undefined) {
        return state;
      }

      return {
        kind: "preprocessing",
        runToken: event.runToken,
        progressPercent: 0,
        completedSegments: [],
        connection: state.connection,
        connectionGeneration: state.connectionGeneration,
        models: state.models,
        selectedModel: state.selectedModel,
        selectedAudio: state.selectedAudio,
        transcriptView: state.transcriptView,
      };
    }

    case "preprocess-progress":
      if (state.kind !== "preprocessing" || state.runToken !== event.runToken) {
        return state;
      }

      return {
        ...state,
        progressPercent: event.progressPercent,
      };

    case "segment-completed": {
      if (
        state.kind !== "preprocessing" &&
        state.kind !== "transcribing"
      ) {
        return state;
      }

      if (state.runToken !== event.runToken) {
        return state;
      }

      const newSegments = [...state.completedSegments, event.segment];

      if (state.kind === "preprocessing") {
        return {
          kind: "transcribing",
          runToken: state.runToken,
          completedSegments: newSegments,
          completedSegmentCount: newSegments.length,
          totalSegmentCount: event.totalSegmentCount,
          connection: state.connection,
          connectionGeneration: state.connectionGeneration,
          models: state.models,
          selectedModel: state.selectedModel,
          selectedAudio: state.selectedAudio,
          transcriptView: state.transcriptView,
        };
      }

      return {
        ...state,
        completedSegments: newSegments,
        completedSegmentCount: newSegments.length,
        totalSegmentCount: event.totalSegmentCount,
      };
    }

    case "transcription-completed": {
      if (
        (state.kind !== "preprocessing" && state.kind !== "transcribing") ||
        state.runToken !== event.runToken
      ) {
        return state;
      }

      return {
        kind: "completed",
        connection: state.connection,
        connectionGeneration: state.connectionGeneration,
        models: state.models,
        selectedModel: state.selectedModel,
        selectedAudio: state.selectedAudio,
        transcriptView: state.transcriptView,
        transcript: event.transcript,
      };
    }

    case "transcription-cancel-requested": {
      if (
        state.kind !== "preprocessing" &&
        state.kind !== "transcribing"
      ) {
        return state;
      }

      if (state.runToken !== event.runToken) {
        return state;
      }

      const partialTranscript =
        state.kind === "transcribing" && state.completedSegments.length > 0
          ? createPartialTranscript(state, "partial-cancelled")
          : undefined;

      return {
        kind: "cancelled",
        connection: state.connection,
        connectionGeneration: state.connectionGeneration,
        models: state.models,
        selectedModel: state.selectedModel,
        selectedAudio: state.selectedAudio,
        transcriptView: state.transcriptView,
        ...(partialTranscript !== undefined
          ? { transcript: partialTranscript }
          : {}),
      };
    }

    case "transcription-retry-requested": {
      if (
        state.kind !== "failed" ||
        state.selectedModel === undefined ||
        state.selectedAudio === undefined
      ) {
        return state;
      }

      return {
        kind: "preprocessing",
        runToken: event.runToken,
        progressPercent: 0,
        completedSegments: state.transcript?.segments ?? [],
        connection: state.connection,
        connectionGeneration: state.connectionGeneration,
        models: state.models,
        selectedModel: state.selectedModel,
        selectedAudio: state.selectedAudio,
        transcriptView: state.transcriptView,
      };
    }

    case "view-changed":
      return updateTranscriptView(state, event.view);

    case "copy-requested":
    case "copy-succeeded":
    case "copy-failed":
    case "download-requested":
      return state;

    default:
      return assertUnreachable(event);
  }
}
