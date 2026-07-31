import type {
  AudioWorkerRequest,
  AudioWorkerResponse,
} from "./audio-worker.types";
import { getErrorDefinition } from "../../types/application-error";

export interface WorkerClient {
  process(
    request: AudioWorkerRequest,
    signal: AbortSignal,
  ): Promise<AudioWorkerResponse>;
  terminate(): void;
}

export interface AudioWorkerClient {
  processSegment(options: {
    channelBuffers: Float32Array[];
    sampleRate: number;
    onProgress?: (percent: number) => void;
  }): Promise<{ wavBytes: Uint8Array }>;
  terminate(): void;
}

export function createAudioWorkerClient(options: {
  worker: Worker;
}): AudioWorkerClient {
  const { worker } = options;
  let pendingRequestId: number | null = null;
  let pendingResolve:
    | ((result: { wavBytes: Uint8Array }) => void)
    | null = null;
  let pendingReject: ((error: unknown) => void) | null = null;
  let onProgressCallback: ((percent: number) => void) | null = null;
  let requestIdCounter = 0;
  let terminated = false;

  function clearPending(): void {
    pendingRequestId = null;
    pendingResolve = null;
    pendingReject = null;
    onProgressCallback = null;
  }

  function handleMessage(event: MessageEvent): void {
    const data = event.data as Record<string, unknown>;

    if (data.type === "progress" && data.requestId === pendingRequestId) {
      if (onProgressCallback && typeof data.percent === "number") {
        onProgressCallback(data.percent);
      }
      return;
    }

    if (data.requestId !== pendingRequestId) return;

    if (data.type === "result") {
      if (pendingResolve) {
        pendingResolve({ wavBytes: new Uint8Array(data.wavBytes as ArrayBufferLike) });
        clearPending();
      }
    } else if (data.type === "error") {
      if (pendingReject) {
        const err = new Error((data.message as string | undefined) ?? "Worker processing failed");
        Object.defineProperty(err, "code", {
          value: "AUDIO_PROCESSING_FAILED",
        });
        pendingReject(err);
        clearPending();
      }
    }
  }

  worker.addEventListener("message", handleMessage);

    return {
      processSegment(options) {
        if (terminated) {
          return Promise.reject(new Error("Worker has been terminated"));
        }

      if (pendingRequestId !== null) {
        throw new Error("A segment is already being processed");
      }

      const requestId = ++requestIdCounter;
      pendingRequestId = requestId;

      onProgressCallback = options.onProgress ?? null;

      return new Promise<{ wavBytes: Uint8Array }>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;

        worker.postMessage(
          {
            type: "process",
            requestId,
            channelBuffers: options.channelBuffers,
            sampleRate: options.sampleRate,
          },
          options.channelBuffers.map((buffer) => buffer.buffer as ArrayBuffer),
        );
      });
    },

    terminate() {
      terminated = true;
      clearPending();
      worker.terminate();
    },
  };
}

export function createWorkerClient(): WorkerClient {
  const worker = new Worker(
    new URL("./audio.worker.ts", import.meta.url),
    { type: "module" },
  );

  let pendingRequestId: string | null = null;
  let pendingResolve: ((response: AudioWorkerResponse) => void) | null = null;
  let pendingReject: ((error: unknown) => void) | null = null;
  let terminated = false;

  worker.onmessage = (event: MessageEvent<AudioWorkerResponse>): void => {
    const response = event.data;

    if (response.requestId !== pendingRequestId) {
      return;
    }

    if (pendingResolve) {
      pendingResolve(response);
      clearPending();
    }
  };

  worker.onerror = (event: ErrorEvent): void => {
    if (pendingReject) {
      pendingReject(
        new Error(event.message),
      );
      clearPending();
    }
  };

  function clearPending(): void {
    pendingRequestId = null;
    pendingResolve = null;
    pendingReject = null;
  }

  function rejectPending(): void {
    if (pendingReject) {
      pendingReject(
        new Error(getErrorDefinition("TRANSCRIPTION_CANCELLED").message),
      );
      clearPending();
    }
  }

  return {
    process(request, signal): Promise<AudioWorkerResponse> {
      if (terminated) {
        return Promise.reject(
          new Error("Worker has been terminated"),
        );
      }

      if (pendingRequestId !== null) {
        return Promise.reject(
          new Error("A segment is already being processed"),
        );
      }

      return new Promise<AudioWorkerResponse>((resolve, reject) => {
        pendingRequestId = request.requestId;
        pendingResolve = resolve;
        pendingReject = reject;

        const onAbort = (): void => {
          signal.removeEventListener("abort", onAbort);
          rejectPending();
          if (!terminated) {
            terminated = true;
            worker.terminate();
          }
        };

        if (signal.aborted) {
          rejectPending();
          return;
        }

        signal.addEventListener("abort", onAbort, { once: true });

        worker.postMessage(
          request,
          { transfer: request.channels },
        );
      });
    },

    terminate(): void {
      terminated = true;
      rejectPending();
      worker.terminate();
    },
  };
}
