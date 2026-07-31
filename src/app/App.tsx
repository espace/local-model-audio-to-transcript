import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { ConnectionStatus } from "../components/ConnectionStatus";
import { AudioFilePicker } from "../components/AudioFilePicker";
import { AudioPreview } from "../components/AudioPreview";
import { ModelSelector } from "../components/ModelSelector";
import { TranscriptionProgress } from "../components/TranscriptionProgress";
import { TranscriptViewer } from "../components/TranscriptViewer";
import { createAudioProcessor } from "../services/audio/audio-processor";
import { createAudioValidator } from "../services/audio/audio-validator";
import { classifyAudioCompatibility } from "../services/ollama/model-compatibility.service";
import { createModelDiscoveryService, ModelDiscoveryError } from "../services/ollama/model-discovery.service";
import { createOllamaClient } from "../services/ollama/ollama.client";
import { createClipboardPort } from "../ports/clipboard.port";
import { createDownloadPort } from "../ports/download.port";
import { getErrorDefinition } from "../types/application-error";
import type { ApplicationError } from "../types/application-error";
import type { ModelOption, SelectedAudio, TranscriptDocument } from "../types/domain";
import { appReducer, createInitialState } from "./app-reducer";
import type { TranscriptView, WorkflowState } from "./app-state";
import { useTranscription } from "../features/transcription/use-transcription";

interface ModelListWarning {
  readonly index: number;
  readonly reason: string;
}

function statusText(state: WorkflowState): string {
  switch (state.kind) {
    case "checking-connection":
      return "Checking Ollama";
    case "service-unavailable":
      return "Ollama unavailable";
    case "loading-models":
      return "Ollama connected — loading models";
    case "no-models":
      return "Ollama connected — no local models";
    case "model-list-failed":
      return "Ollama connected — model list failed";
    case "ready":
      return "Ready";
    case "preprocessing":
      return `Preparing audio, ${String(state.progressPercent)} percent`;
    case "transcribing":
      return `Transcribing section ${String(state.completedSegmentCount)} of ${String(state.totalSegmentCount)}`;
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
  }
}

function blockingMessage(state: WorkflowState): string | undefined {
  if (state.kind === "failed") {
    const error = state.error;
    if (
      error.code === "TRANSCRIPTION_FAILED" &&
      error.segmentIndex !== undefined
    ) {
      return error.message.replace(
        "section N",
        `section ${String(error.segmentIndex)}`,
      );
    }
    return error.message;
  }

  return undefined;
}

function connectionStatus(state: WorkflowState): "checking" | "connected" | "unavailable" {
  if (state.kind === "checking-connection") {
    return "checking";
  }

  return state.kind === "service-unavailable" ? "unavailable" : "connected";
}

function getTranscript(state: WorkflowState): TranscriptDocument | undefined {
  switch (state.kind) {
    case "completed":
      return state.transcript;
    case "cancelled":
      return state.transcript;
    case "failed":
      return state.transcript;
    case "ready":
    case "checking-connection":
    case "service-unavailable":
    case "loading-models":
    case "no-models":
    case "model-list-failed":
      return state.transcript;
    default:
      return undefined;
  }
}

function getTranscriptView(state: WorkflowState): TranscriptView {
  switch (state.kind) {
    case "ready":
    case "preprocessing":
    case "transcribing":
    case "completed":
    case "cancelled":
    case "failed":
      return state.transcriptView;
    default:
      return "rendered";
  }
}

function getModelsForDisplay(state: WorkflowState): readonly ModelOption[] {
  switch (state.kind) {
    case "loading-models":
      return state.models ?? [];
    case "model-list-failed":
    case "ready":
    case "preprocessing":
    case "transcribing":
    case "completed":
    case "cancelled":
    case "failed":
      return state.models;
    default:
      return [];
  }
}

function getSelectedModelNameForDisplay(state: WorkflowState): string | undefined {
  switch (state.kind) {
    case "loading-models":
    case "model-list-failed":
      return state.selectedModelName;
    case "ready":
    case "preprocessing":
    case "transcribing":
    case "completed":
    case "cancelled":
    case "failed":
      return state.selectedModel?.name;
    default:
      return undefined;
  }
}

function isMeaningfulRoutineChange(
  previous: WorkflowState | undefined,
  next: WorkflowState,
): boolean {
  if (previous === undefined || previous.kind !== next.kind) {
    return true;
  }

  if (next.kind === "preprocessing" && previous.kind === "preprocessing") {
    return Math.floor(next.progressPercent / 5) !== Math.floor(previous.progressPercent / 5);
  }

  if (next.kind === "transcribing" && previous.kind === "transcribing") {
    return (
      next.completedSegmentCount !== previous.completedSegmentCount ||
      next.totalSegmentCount !== previous.totalSegmentCount
    );
  }

  return false;
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  const ollamaClient = useMemo(() => createOllamaClient(), []);
  const audioValidator = useMemo(() => createAudioValidator(), []);
  const audioProcessor = useMemo(() => createAudioProcessor(), []);
  const modelDiscovery = useMemo(
    () =>
      createModelDiscoveryService({
        client: ollamaClient,
        compatibility: { classify: classifyAudioCompatibility },
      }),
    [ollamaClient],
  );
  const [routineAnnouncement, setRoutineAnnouncement] = useState("");
  const lastAnnouncedState = useRef<WorkflowState | undefined>(undefined);
  const activeAudioValidation = useRef<AbortController | undefined>(undefined);
  const previewUrl = useRef<string | undefined>(undefined);
  const clipboardPort = useMemo(() => createClipboardPort(), []);
  const downloadPort = useMemo(() => createDownloadPort(), []);
  const [isAudioValidating, setIsAudioValidating] = useState(false);
  const [selectedAudio, setSelectedAudio] = useState<SelectedAudio | undefined>(undefined);
  const [audioError, setAudioError] = useState<ApplicationError | undefined>(undefined);
  const [copyError, setCopyError] = useState<ApplicationError | undefined>(undefined);
  const [downloadError, setDownloadError] = useState<ApplicationError | undefined>(undefined);
  const [modelWarnings, setModelWarnings] = useState<readonly ModelListWarning[]>([]);
  const message = blockingMessage(state);

  const transcription = useTranscription(ollamaClient, audioProcessor, dispatch);

  const isConnectionReady = state.kind !== "service-unavailable" && state.kind !== "checking-connection";
  const isModelSelected = "selectedModel" in state && state.selectedModel !== undefined;
  const isModelCompatible = "selectedModel" in state && state.selectedModel !== undefined && state.selectedModel.compatibility.status !== "incompatible";
  const isAudioSelected = "selectedAudio" in state && state.selectedAudio !== undefined;
  const isRunActive = state.kind === "preprocessing" || state.kind === "transcribing";

  const prerequisites = {
    connection: isConnectionReady,
    modelSelected: isModelSelected,
    modelCompatible: isModelCompatible,
    audioSelected: isAudioSelected,
    isRunning: isRunActive,
  };
  const canGenerate = isConnectionReady && isModelSelected && isModelCompatible && isAudioSelected && !isRunActive;
  const generatePrerequisitesId = "generate-prerequisites";

  useEffect(() => {
    if (!isMeaningfulRoutineChange(lastAnnouncedState.current, state)) {
      return;
    }

    lastAnnouncedState.current = state;
    setRoutineAnnouncement(statusText(state));
  }, [state]);

  useEffect(() => {
    if (state.kind !== "checking-connection") {
      return undefined;
    }

    const controller = new AbortController();
    const generation = state.connectionGeneration;

    void ollamaClient.checkConnection(controller.signal).then(
      (connection) => {
        if (controller.signal.aborted) {
          return;
        }

        if (connection.status === "connected") {
          dispatch({
            type: "connection-resolved",
            generation,
            version: connection.version,
          });
          return;
        }

        dispatch({
          type: "connection-failed",
          generation,
          error: connection.error ?? getErrorDefinition("UNKNOWN_ERROR"),
        });
      },
      () => {
        if (controller.signal.aborted) {
          return;
        }

        dispatch({
          type: "connection-failed",
          generation,
          error: getErrorDefinition("OLLAMA_UNREACHABLE"),
        });
      },
    );

    return () => {
      controller.abort();
    };
  }, [ollamaClient, state]);

  useEffect(() => {
    if (state.kind !== "loading-models") {
      return undefined;
    }

    const controller = new AbortController();
    const { connectionGeneration: generation } = state;
    const request = {
      signal: controller.signal,
      version: state.connection.version,
      selectedModelName: state.selectedModelName,
    };
    const operation = state.isModelRefresh
      ? modelDiscovery.refresh(request)
      : modelDiscovery.load(request);

    void operation.then(
      (result) => {
        if (!controller.signal.aborted) {
          setModelWarnings(result.malformedEntries);
          dispatch({
            type: "models-resolved",
            generation,
            models: result.models,
            ...(result.removedSelectedModelName === undefined
              ? {}
              : { removedSelectedModelName: result.removedSelectedModelName }),
          });
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof ModelDiscoveryError) {
          setModelWarnings([]);
          dispatch({
            type: "model-list-failed",
            generation,
            error: error.error,
          });
          return;
        }
        if (typeof error === "object" && error !== null && "code" in error && error.code === "NO_MODELS_INSTALLED") {
          dispatch({ type: "models-resolved", generation, models: [] });
          return;
        }
        setModelWarnings([]);
        dispatch({
          type: "connection-failed",
          generation,
          error: getErrorDefinition("OLLAMA_UNREACHABLE"),
        });
      },
    );

    return () => {
      controller.abort();
    };
  }, [modelDiscovery, state]);

  useEffect(() => {
    if (
      state.kind === "ready" &&
      selectedAudio !== undefined &&
      state.selectedAudio !== selectedAudio
    ) {
      dispatch({ type: "file-validated", audio: selectedAudio });
    }
  }, [selectedAudio, state]);

  useEffect(() => {
    return () => {
      activeAudioValidation.current?.abort();
      if (previewUrl.current !== undefined) {
        URL.revokeObjectURL(previewUrl.current);
      }
    };
  }, []);

  function releasePreviewUrl() {
    if (previewUrl.current !== undefined) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = undefined;
    }
  }

  async function validateSelectedFile(file: File, controller: AbortController) {
    try {
      const result = await audioValidator.validate(file, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      if (result.ok) {
        previewUrl.current = result.audio.previewUrl;
        setSelectedAudio(result.audio);
        setAudioError(undefined);
        dispatch({ type: "file-validated", audio: result.audio });
      } else {
        setSelectedAudio(undefined);
        setAudioError(result.error);
        dispatch({ type: "file-rejected", error: result.error });
      }
    } catch {
      if (!controller.signal.aborted) {
        const error = getErrorDefinition("AUDIO_DECODE_FAILED");
        setSelectedAudio(undefined);
        setAudioError(error);
        dispatch({
          type: "file-rejected",
          error,
        });
      }
    } finally {
      if (activeAudioValidation.current === controller) {
        activeAudioValidation.current = undefined;
        setIsAudioValidating(false);
      }
    }
  }

  function handleFileSelected(file: File) {
    if (isRunActive) {
      transcription.cancel();
    }
    activeAudioValidation.current?.abort();
    releasePreviewUrl();
    setCopyError(undefined);
    setDownloadError(undefined);
    setSelectedAudio(undefined);
    setAudioError(undefined);
    dispatch({ type: "file-selected", file });
    const controller = new AbortController();
    activeAudioValidation.current = controller;
    setIsAudioValidating(true);
    void validateSelectedFile(file, controller);
  }

  async function handleCopy() {
    const transcript = getTranscript(state);
    if (transcript === undefined) return;

    dispatch({ type: "copy-requested" });
    setCopyError(undefined);

    try {
      await clipboardPort.writeText(transcript.markdown);
      dispatch({ type: "copy-succeeded" });
    } catch (error: unknown) {
      const appError = error as ApplicationError;
      setCopyError(appError);
      dispatch({ type: "copy-failed", error: appError });
    }
  }

  function handleDownload() {
    const transcript = getTranscript(state);
    if (transcript === undefined) return;

    dispatch({ type: "download-requested" });
    setDownloadError(undefined);

    try {
      downloadPort.downloadMarkdown({
        markdown: transcript.markdown,
        sourceFileName: transcript.sourceFileName,
      });
    } catch (error: unknown) {
      setDownloadError(error as ApplicationError);
    }
  }

  function handleAudioRemoval() {
    if (isRunActive) {
      transcription.cancel();
    }
    activeAudioValidation.current?.abort();
    activeAudioValidation.current = undefined;
    setIsAudioValidating(false);
    releasePreviewUrl();
    setSelectedAudio(undefined);
    setAudioError(undefined);
    setCopyError(undefined);
    setDownloadError(undefined);
    dispatch({ type: "file-removed" });
  }

  function handleModelSelect(modelName?: string) {
    if (isRunActive) {
      transcription.cancel();
    }

    dispatch({ type: "model-selected", modelName });
  }

  function startCleanRun() {
    const file = "selectedAudio" in state ? state.selectedAudio?.file : undefined;
    const model = "selectedModel" in state ? state.selectedModel?.name : undefined;

    if (file === undefined || model === undefined) {
      return;
    }

    setCopyError(undefined);
    setDownloadError(undefined);
    transcription.start(file, model);
  }

  function handleGenerate() {
    if (!canGenerate) return;
    startCleanRun();
  }

  function handleCancel() {
    transcription.cancel();
  }

  function handleRetry() {
    if (state.kind !== "failed") return;

    const file = state.selectedAudio?.file;
    const model = state.selectedModel?.name;
    if (file === undefined || model === undefined) return;

    const failedSegmentIndex = state.transcript?.failedSegmentNumber !== undefined
      ? state.transcript.failedSegmentNumber - 1
      : 0;
    const previousSegments = state.transcript?.segments ?? [];

    transcription.retry(file, model, failedSegmentIndex, previousSegments);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Local-first transcription</p>
        <h1>Local Audio Transcript Sandbox</h1>
        <p>Transcribe local audio through your locally running Ollama service.</p>
        <ConnectionStatus
          status={connectionStatus(state)}
          onRetry={() => {
            dispatch({ type: "connection-retry-requested" });
          }}
          onRefresh={() => {
            dispatch({ type: "models-refresh-requested" });
          }}
        />
        <p aria-live="polite" className="sr-only">
          {routineAnnouncement}
        </p>
        {message === undefined ? null : (
          <p aria-live="assertive" role="alert" className="error-message">
            {message}
          </p>
        )}
      </header>

      <section aria-labelledby="model-section-title" className="app-section">
        <h2 id="model-section-title">Model</h2>
        {state.kind === "checking-connection" || state.kind === "service-unavailable" ? (
          <p>Select a local audio-capable model once Ollama is connected.</p>
        ) : state.kind === "model-list-failed" ? (
          <>
            {state.models.length === 0 ? null : (
              <ModelSelector
                models={state.models}
                selectedModelName={state.selectedModelName}
                malformedEntries={modelWarnings}
                onRefresh={() => {
                  dispatch({ type: "models-refresh-requested" });
                }}
                onSelect={handleModelSelect}
              />
            )}
            <p data-status="warning" role="status">
              {state.error.message}
            </p>
            {state.models.length === 0 ? (
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "models-refresh-requested" });
                }}
              >
                Refresh models
              </button>
            ) : null}
          </>
        ) : (
          <ModelSelector
            isLoading={state.kind === "loading-models"}
            malformedEntries={modelWarnings}
            models={getModelsForDisplay(state)}
            onRefresh={() => {
              dispatch({ type: "models-refresh-requested" });
            }}
            onSelect={handleModelSelect}
            removedSelectedModelName={state.kind === "ready" ? state.removedSelectedModelName : undefined}
            selectedModelName={getSelectedModelNameForDisplay(state)}
          />
        )}
      </section>

      <section aria-labelledby="audio-section-title" className="app-section">
        <h2 id="audio-section-title">Audio</h2>
        <AudioFilePicker
          error={audioError}
          isAccepting={isAudioValidating}
          onFileSelected={handleFileSelected}
        />
        {selectedAudio !== undefined ? (
          <AudioPreview audio={selectedAudio} onRemove={handleAudioRemoval} />
        ) : null}
      </section>

      <section aria-labelledby="action-section-title" className="app-section">
        <h2 id="action-section-title">Transcription</h2>
        <TranscriptionProgress
          state={transcription.state}
          progress={transcription.progress}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onStartNewRun={startCleanRun}
          prerequisites={prerequisites}
          generatePrerequisitesId={generatePrerequisitesId}
        />
        <button
          type="button"
          aria-describedby={canGenerate ? undefined : generatePrerequisitesId}
          disabled={!canGenerate}
          onClick={handleGenerate}
        >
          Generate transcript
        </button>
      </section>

      <section aria-labelledby="transcript-section-title" className="app-section">
        <h2 id="transcript-section-title" tabIndex={-1}>
          Transcript
        </h2>
        <TranscriptViewer
          transcript={getTranscript(state)}
          view={getTranscriptView(state)}
          onViewChange={(view) => {
            dispatch({ type: "view-changed", view });
          }}
          onCopy={() => { void handleCopy(); }}
          onDownload={handleDownload}
          onRetry={handleRetry}
          copyError={copyError}
          downloadError={downloadError}
        />
      </section>
    </main>
  );
}
