import { appConfig } from "../../config/app-config";

export interface DecodedAudio {
  readonly buffer: AudioBuffer;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly frameLength: number;
  readonly decodedFormat?: string;
}

export interface AudioDecoder {
  decode(file: File, signal: AbortSignal): Promise<DecodedAudio>;
}

type AudioDecodeErrorCode =
  | "UNSUPPORTED_AUDIO_FILE"
  | "AUDIO_DECODE_FAILED"
  | "AUDIO_DURATION_UNAVAILABLE"
  | "AUDIO_PROCESSING_FAILED";

interface AudioDecodeError extends Error {
  readonly code: AudioDecodeErrorCode;
}

function abortError(): DOMException {
  return new DOMException("The audio decode was cancelled.", "AbortError");
}

function decodeError(code: AudioDecodeErrorCode): AudioDecodeError {
  const error = new Error(code) as AudioDecodeError;
  Object.defineProperty(error, "code", { value: code });
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

function decodeFailureCode(error: unknown): AudioDecodeErrorCode {
  if (typeof error === "object" && error !== null && "name" in error) {
    if (error.name === "NotSupportedError") {
      return "UNSUPPORTED_AUDIO_FILE";
    }
    if (error.name === "QuotaExceededError") {
      return "AUDIO_PROCESSING_FAILED";
    }
  }
  return "AUDIO_DECODE_FAILED";
}

function awaitAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        if (error instanceof Error) {
          reject(error);
          return;
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          typeof error.name === "string"
        ) {
          // Preserve the failure's name (e.g. NotSupportedError,
          // QuotaExceededError) so the cause can be classified precisely;
          // some environments do not make DOMException an instanceof Error.
          reject(
            Object.assign(new Error("Audio decoding rejected unexpectedly."), {
              name: error.name,
            }),
          );
          return;
        }
        reject(new Error("Audio decoding rejected unexpectedly."));
      },
    );
  });
}

function readFile(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    if (typeof FileReader === "undefined") {
      reject(decodeError("UNSUPPORTED_AUDIO_FILE"));
      return;
    }

    const reader = new FileReader();
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    const rejectDecodeFailure = () => {
      cleanup();
      reject(decodeError("AUDIO_DECODE_FAILED"));
    };
    const onAbort = () => {
      cleanup();
      try {
        reader.abort();
      } catch {
        // The operation has already settled; cancellation remains safe.
      }
      reject(abortError());
    };

    reader.onload = () => {
      cleanup();
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      rejectDecodeFailure();
    };
    reader.onerror = rejectDecodeFailure;
    reader.onabort = () => {
      cleanup();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.readAsArrayBuffer(file);
  });
}

async function closeContext(context: AudioContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // Closing is best effort and must not replace an audio-validation result.
  }
}

export function createAudioDecoder(): AudioDecoder {
  return {
    async decode(file, signal) {
      const bytes = await readFile(file, signal);
      throwIfAborted(signal);

      if (typeof AudioContext === "undefined") {
        throw decodeError("UNSUPPORTED_AUDIO_FILE");
      }

      let context: AudioContext;
      try {
        context = new AudioContext({ sampleRate: appConfig.targetSampleRateHz });
      } catch {
        throw decodeError("UNSUPPORTED_AUDIO_FILE");
      }

      let decoding: Promise<AudioBuffer>;
      try {
        decoding = context.decodeAudioData(bytes.slice(0));
      } catch (error: unknown) {
        await closeContext(context);
        throw decodeError(decodeFailureCode(error));
      }
      const closeWhenSettled = decoding.then(
        () => closeContext(context),
        () => closeContext(context),
      );

      try {
        const buffer = await awaitAbortable(decoding, signal);
        throwIfAborted(signal);

        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
          throw decodeError("AUDIO_DURATION_UNAVAILABLE");
        }

        if (
          !Number.isFinite(buffer.sampleRate) ||
          buffer.sampleRate <= 0 ||
          !Number.isInteger(buffer.numberOfChannels) ||
          buffer.numberOfChannels <= 0 ||
          !Number.isInteger(buffer.length) ||
          buffer.length <= 0
        ) {
          throw decodeError("AUDIO_DECODE_FAILED");
        }

        return {
          buffer,
          durationSeconds: buffer.duration,
          sampleRate: buffer.sampleRate,
          channelCount: buffer.numberOfChannels,
          frameLength: buffer.length,
          decodedFormat: file.type || undefined,
        };
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error.code === "AUDIO_DURATION_UNAVAILABLE" ||
            error.code === "AUDIO_DECODE_FAILED" ||
            error.code === "UNSUPPORTED_AUDIO_FILE" ||
            error.code === "AUDIO_PROCESSING_FAILED")
        ) {
          throw error;
        }
        throw decodeError(decodeFailureCode(error));
      } finally {
        if (signal.aborted) {
          void closeWhenSettled;
        } else {
          await closeWhenSettled;
        }
      }
    },
  };
}
