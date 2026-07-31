import { appConfig } from "../../config/app-config";
import { getErrorDefinition } from "../../types/application-error";
import type { ProcessedSegment, DecodedAudioHandle } from "../../features/transcription/transcription.types";
import type { AudioWorkerResponse } from "./audio-worker.types";
import { createAudioDecoder } from "./audio-decoder";
import { calculateSegments } from "./segment-calculator";
import { createWorkerClient } from "./audio-worker.client";

function generateRequestId(): string {
  return crypto.randomUUID();
}

function toProcessedSegment(
  index: number,
  audioBuffer: AudioBuffer,
  response: AudioWorkerResponse,
): ProcessedSegment {
  if (response.type !== "segment-complete") {
    throw new Error("Unexpected response type");
  }

  const segmentFrames = appConfig.segmentDurationSeconds * audioBuffer.sampleRate;
  const overlapFrames = appConfig.segmentOverlapSeconds * audioBuffer.sampleRate;
  const strideFrames = segmentFrames - overlapFrames;
  const startFrame = index * strideFrames;
  const endFrameExclusive = Math.min(
    startFrame + segmentFrames,
    audioBuffer.length,
  );

  return {
    index,
    displayNumber: index + 1,
    startSeconds: startFrame / audioBuffer.sampleRate,
    endSeconds: endFrameExclusive / audioBuffer.sampleRate,
    silence: response.silence ?? "not-verified-silent",
    wavBlob:
      response.silence === "verified-silent" || !response.wav
        ? undefined
        : new Blob([response.wav], { type: "audio/wav" }),
  };
}

function isSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function handleError(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "AUDIO_PROCESSING_FAILED"
  ) {
    throw error as unknown as Error;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    throw error;
  }
  const def = getErrorDefinition("AUDIO_PROCESSING_FAILED");
  throw Object.assign(new Error(def.message), def);
}

export interface AudioProcessor {
  validateAndDecode(
    file: File,
    signal: AbortSignal,
  ): Promise<DecodedAudioHandle>;
  segments(
    decoded: DecodedAudioHandle,
    signal: AbortSignal,
  ): AsyncGenerator<ProcessedSegment>;
  release(decoded: DecodedAudioHandle): void;
}

export function createAudioProcessor(
): AudioProcessor {
  const decoder = createAudioDecoder();

  return {
    async validateAndDecode(file, signal) {
      if (signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      if (file.size > appConfig.maxAudioBytes) {
        const def = getErrorDefinition("AUDIO_TOO_LARGE");
        throw Object.assign(new Error(def.message), def);
      }

      try {
        const decoded = await decoder.decode(file, signal);

        if (!Number.isFinite(decoded.durationSeconds) || decoded.durationSeconds <= 0) {
          const def = getErrorDefinition("AUDIO_DURATION_UNAVAILABLE");
          throw Object.assign(new Error(def.message), def);
        }

        if (decoded.durationSeconds > appConfig.maxAudioDurationSeconds) {
          const def = getErrorDefinition("AUDIO_TOO_LONG");
          throw Object.assign(new Error(def.message), def);
        }

        return {
          buffer: decoded.buffer,
          durationSeconds: decoded.durationSeconds,
          sampleRate: decoded.sampleRate,
          channelCount: decoded.channelCount,
          frameLength: decoded.frameLength,
          decodedFormat: decoded.decodedFormat,
        };
      } catch (error: unknown) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          throw error;
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error
        ) {
          const code = error.code;
          if (
            code === "UNSUPPORTED_AUDIO_FILE" ||
            code === "AUDIO_DECODE_FAILED" ||
            code === "AUDIO_DURATION_UNAVAILABLE" ||
            code === "AUDIO_TOO_LONG"
          ) {
            throw error;
          }
        }
        handleError(error);
      }
    },

    async *segments(decoded, signal) {
      const segments = calculateSegments(
        decoded.frameLength,
        decoded.sampleRate,
      );

      if (segments.length === 0) {
        return;
      }

      const workerClient = createWorkerClient();

      try {
        for (const segment of segments) {
          if (signal.aborted) {
            return;
          }

          const channelBuffers: ArrayBuffer[] = [];
          for (let ch = 0; ch < decoded.channelCount; ch++) {
            const channelData = decoded.buffer.getChannelData(ch);
            const segmentSamples = channelData.subarray(
              segment.startFrame,
              segment.endFrameExclusive,
            );
            const copy = new Float32Array(segmentSamples);
            channelBuffers.push(copy.buffer);
          }

          const requestId = generateRequestId();

          let response: AudioWorkerResponse;
          try {
            response = await workerClient.process(
              {
                type: "process-segment",
                requestId,
                index: segment.index,
                sampleRate: decoded.sampleRate,
                channels: channelBuffers,
              },
              signal,
            );
          } catch (error: unknown) {
            if (isSignalAborted(signal)) {
              throw new DOMException("The operation was aborted.", "AbortError");
            }
            handleError(error);
          }

          if (response.type === "segment-failed") {
            const def = getErrorDefinition("AUDIO_PROCESSING_FAILED");
            throw Object.assign(new Error(def.message), def);
          }

          yield toProcessedSegment(
            segment.index,
            decoded.buffer,
            response,
          );
        }
      } finally {
        workerClient.terminate();
      }
    },

    release(_decoded: DecodedAudioHandle): void {
      void _decoded;
    },
  };
}
