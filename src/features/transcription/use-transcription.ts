import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioProcessor } from "../../services/audio/audio-processor";
import type { OllamaClient } from "../../services/ollama/ollama.types";
import { createRunToken, type RunToken, type WorkflowEvent } from "../../app/app-state";
import type { TranscriptDocument, TranscriptSegment } from "../../types/domain";
import { getErrorDefinition, type ApplicationError } from "../../types/application-error";
import { createTranscriptionService, type TranscriptionService } from "./transcription.service";

export type RunState = "idle" | "preprocessing" | "transcribing" | "completed" | "cancelled" | "failed";

export interface RunProgress {
  readonly phase: "preprocessing" | "transcribing";
  readonly current: number;
  readonly total: number;
}

export interface UseTranscriptionResult {
  readonly state: RunState;
  readonly progress: RunProgress | undefined;
  readonly start: (file: File, model: string) => void;
  readonly cancel: () => void;
  readonly retry: (file: File, model: string, failedSegmentIndex: number, previousSegments: readonly TranscriptSegment[]) => void;
  readonly document: TranscriptDocument | undefined;
}

function applicationError(code: ApplicationError["code"]): ApplicationError {
  return getErrorDefinition(code);
}

export function useTranscription(
  client: Pick<OllamaClient, "transcribe">,
  processor: AudioProcessor,
  dispatch: (event: WorkflowEvent) => void,
): UseTranscriptionResult {
  const [state, setState] = useState<RunState>("idle");
  const [progress, setProgress] = useState<RunProgress | undefined>(undefined);
  const [document, setDocument] = useState<TranscriptDocument | undefined>(undefined);

  const controllerRef = useRef<AbortController | undefined>(undefined);
  const runTokenRef = useRef<RunToken | undefined>(undefined);
  const serviceRef = useRef<TranscriptionService | undefined>(undefined);

  if (serviceRef.current === undefined) {
    serviceRef.current = createTranscriptionService(client, processor);
  }

  const abortActiveRun = useCallback(() => {
    if (controllerRef.current !== undefined) {
      controllerRef.current.abort();
      controllerRef.current = undefined;
    }
    runTokenRef.current = undefined;
  }, []);

  const finalizeRun = useCallback((controller: AbortController, runToken: RunToken) => {
    controller.abort();
    if (controllerRef.current === controller) {
      controllerRef.current = undefined;
    }
    if (runTokenRef.current === runToken) {
      runTokenRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    return () => {
      abortActiveRun();
    };
  }, [abortActiveRun]);

  const cancel = useCallback(() => {
    if (controllerRef.current !== undefined) {
      controllerRef.current.abort();
    }

    const runToken = runTokenRef.current;
    controllerRef.current = undefined;
    runTokenRef.current = undefined;
    setProgress(undefined);
    setDocument(undefined);

    if (runToken !== undefined) {
      dispatch({
        type: "transcription-cancel-requested",
        runToken,
      });
    }

    setState("cancelled");
  }, [dispatch]);

  const start = useCallback(
    (file: File, model: string) => {
      abortActiveRun();

      const controller = new AbortController();
      const runToken = createRunToken(Date.now());
      controllerRef.current = controller;
      runTokenRef.current = runToken;

      setDocument(undefined);
      setProgress(undefined);
      setState("preprocessing");

      dispatch({ type: "transcription-requested", runToken });

      const service = serviceRef.current;
      if (service === undefined) return;

      void service
        .run({
          file,
          model,
          signal: controller.signal,
          progressCallback: (phase, current, total) => {
            if (controller.signal.aborted) return;
            setProgress({ phase, current, total });

            if (phase === "preprocessing") {
              dispatch({
                type: "preprocess-progress",
                runToken,
                progressPercent: current,
              });
            } else {
              setState("transcribing");
            }
          },
          onSegment: (segment, totalSegmentCount) => {
            if (controller.signal.aborted) return;
            dispatch({
              type: "segment-completed",
              runToken,
              segment,
              totalSegmentCount,
            });
          },
        })
        .then(
          (transcript) => {
            if (controller.signal.aborted) return;
            finalizeRun(controller, runToken);
            setDocument(transcript);
            setState("completed");

            dispatch({
              type: "transcription-completed",
              runToken,
              transcript,
            });
          },
          (error: unknown) => {
            if (controller.signal.aborted) {
              return;
            }
            finalizeRun(controller, runToken);

            const appError =
              typeof error === "object" && error !== null && "code" in error
                ? (error as ApplicationError)
                : applicationError("TRANSCRIPTION_FAILED");

            setDocument(undefined);
            setState("failed");

            dispatch({
              type: "transcription-failed",
              runToken,
              error: appError,
            });
          },
        );
    },
    [dispatch, abortActiveRun, finalizeRun],
  );

  const retry = useCallback(
    (file: File, model: string, failedSegmentIndex: number, previousSegments: readonly TranscriptSegment[]) => {
      abortActiveRun();

      const controller = new AbortController();
      const runToken = createRunToken(Date.now());
      controllerRef.current = controller;
      runTokenRef.current = runToken;

      setProgress(undefined);
      setDocument(undefined);
      setState("preprocessing");

      dispatch({ type: "transcription-retry-requested", runToken });

      const service = serviceRef.current;
      if (service === undefined) return;

      void service
        .retry({
          file,
          model,
          signal: controller.signal,
          progressCallback: (phase, current, total) => {
            if (controller.signal.aborted) return;
            setProgress({ phase, current, total });

            if (phase === "preprocessing") {
              dispatch({
                type: "preprocess-progress",
                runToken,
                progressPercent: current,
              });
            } else {
              setState("transcribing");
            }
          },
          onSegment: (segment, totalSegmentCount) => {
            if (controller.signal.aborted) return;
            dispatch({
              type: "segment-completed",
              runToken,
              segment,
              totalSegmentCount,
            });
          },
          failedSegmentIndex,
          previousSegments,
        })
        .then(
          (transcript) => {
            if (controller.signal.aborted) return;
            finalizeRun(controller, runToken);
            setDocument(transcript);
            setState("completed");

            dispatch({
              type: "transcription-completed",
              runToken,
              transcript,
            });
          },
          (error: unknown) => {
            if (controller.signal.aborted) return;
            finalizeRun(controller, runToken);

            const appError =
              typeof error === "object" && error !== null && "code" in error
                ? (error as ApplicationError)
                : applicationError("TRANSCRIPTION_FAILED");

            setDocument(undefined);
            setState("failed");

            dispatch({
              type: "transcription-failed",
              runToken,
              error: appError,
            });
          },
        );
    },
    [dispatch, abortActiveRun, finalizeRun],
  );

  return { state, progress, start, cancel, retry, document };
}
