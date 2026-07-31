import { appConfig } from "../../config/app-config";
import {
  getErrorDefinition,
  type ApplicationError,
  type ApplicationErrorCode,
} from "../../types/application-error";
import type { SelectedAudio } from "../../types/domain";
import { createAudioDecoder, type AudioDecoder } from "./audio-decoder";

export type AudioValidationResult =
  | { readonly ok: true; readonly audio: SelectedAudio }
  | { readonly ok: false; readonly error: ApplicationError };

export interface AudioValidator {
  validate(file: File, signal: AbortSignal): Promise<AudioValidationResult>;
}

interface AudioValidatorOptions {
  readonly decoder?: AudioDecoder;
  readonly createPreviewUrl?: (file: File) => string;
}

const decoderErrorCodes = new Set<ApplicationErrorCode>([
  "UNSUPPORTED_AUDIO_FILE",
  "AUDIO_DECODE_FAILED",
  "AUDIO_DURATION_UNAVAILABLE",
  "AUDIO_PROCESSING_FAILED",
]);

function applicationError(code: ApplicationErrorCode): ApplicationError {
  return getErrorDefinition(code);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function decoderErrorCode(error: unknown): ApplicationErrorCode | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    decoderErrorCodes.has(error.code as ApplicationErrorCode)
  ) {
    return error.code as ApplicationErrorCode;
  }
  return undefined;
}

export function createAudioValidator(
  options: AudioValidatorOptions = {},
): AudioValidator {
  const decoder = options.decoder ?? createAudioDecoder();
  const createPreviewUrl = options.createPreviewUrl ?? URL.createObjectURL.bind(URL);

  return {
    async validate(file, signal) {
      if (file.size > appConfig.maxAudioBytes) {
        return { ok: false, error: applicationError("AUDIO_TOO_LARGE") };
      }

      try {
        const decoded = await decoder.decode(file, signal);

        if (
          !Number.isFinite(decoded.durationSeconds) ||
          decoded.durationSeconds <= 0
        ) {
          return {
            ok: false,
            error: applicationError("AUDIO_DURATION_UNAVAILABLE"),
          };
        }
        if (decoded.durationSeconds > appConfig.maxAudioDurationSeconds) {
          return { ok: false, error: applicationError("AUDIO_TOO_LONG") };
        }

        return {
          ok: true,
          audio: {
            file,
            name: file.name,
            sizeBytes: file.size,
            mimeType: file.type,
            decodedFormat: decoded.decodedFormat,
            durationSeconds: decoded.durationSeconds,
            sampleRate: decoded.sampleRate,
            channelCount: decoded.channelCount,
            frameLength: decoded.frameLength,
            previewUrl: createPreviewUrl(file),
            validation: "valid",
          },
        };
      } catch (error: unknown) {
        if (isAbortError(error)) {
          throw error;
        }
        return {
          ok: false,
          error: applicationError(decoderErrorCode(error) ?? "AUDIO_DECODE_FAILED"),
        };
      }
    },
  };
}
