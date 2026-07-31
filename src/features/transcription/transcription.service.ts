import type { AudioProcessor } from "../../services/audio/audio-processor";
import type { OllamaClient } from "../../services/ollama/ollama.types";
import { calculateSegments } from "../../services/audio/segment-calculator";
import { getErrorDefinition, type ApplicationError } from "../../types/application-error";
import type { TranscriptDocument, TranscriptSegment } from "../../types/domain";
import { buildTranscript } from "../../services/markdown/transcript-builder";
import type { ProcessedSegment } from "./transcription.types";

const FIDELITY_PROMPT = "Transcribe this audio exactly. Preserve the spoken language. Return only the spoken words. Use [inaudible] for unclear speech.";

export type ProgressCallback = (
  phase: "preprocessing" | "transcribing",
  current: number,
  total: number,
) => void;

export type OnSegmentCallback = (
  segment: TranscriptSegment,
  totalSegmentCount: number,
) => void;

export interface TranscriptionService {
  run(input: {
    file: File;
    model: string;
    signal: AbortSignal;
    progressCallback: ProgressCallback;
    onSegment?: OnSegmentCallback;
  }): Promise<TranscriptDocument>;
  retry(input: {
    file: File;
    model: string;
    signal: AbortSignal;
    progressCallback: ProgressCallback;
    onSegment?: OnSegmentCallback;
    failedSegmentIndex: number;
    previousSegments: readonly TranscriptSegment[];
  }): Promise<TranscriptDocument>;
}

function applicationError(code: ApplicationError["code"]): ApplicationError & Error {
  const def = getErrorDefinition(code);
  return Object.assign(new Error(def.message), def);
}

function mapSegmentFailure(
  error: unknown,
  failedSegmentNumber: number,
): ApplicationError & Error {
  if (typeof error === "object" && error !== null && "code" in error) {
    const errorCode = error.code;
    if (errorCode === "OLLAMA_UNREACHABLE" || errorCode === "MODEL_NOT_FOUND") {
      return error as ApplicationError & Error;
    }
    if (
      errorCode === "INVALID_MODEL_RESPONSE" ||
      errorCode === "MODEL_OUTPUT_TOO_LARGE"
    ) {
      return error as ApplicationError & Error;
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "TRANSCRIPTION_FAILED"
  ) {
    const def = getErrorDefinition("TRANSCRIPTION_FAILED");
    return Object.assign(new Error(def.message), {
      ...def,
      segmentIndex: failedSegmentNumber,
    });
  }

  return Object.assign(applicationError("TRANSCRIPTION_FAILED"), {
    segmentIndex: failedSegmentNumber,
  });
}

function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function transcribeAndValidateSegment(
  client: Pick<OllamaClient, "transcribe">,
  model: string,
  segment: ProcessedSegment,
  wav: Blob,
  completedSegments: readonly TranscriptSegment[],
  signal: AbortSignal,
): Promise<TranscriptSegment> {
  const result = await client.transcribe({
    model,
    wav,
    prompt: FIDELITY_PROMPT,
    signal,
  });

  const trimmed = result.text.trim();
  if (trimmed.length === 0) {
    throw applicationError("INVALID_MODEL_RESPONSE");
  }

  if (Array.from(trimmed).length > 250_000) {
    throw applicationError("MODEL_OUTPUT_TOO_LARGE");
  }

  const totalChars = completedSegments.reduce(
    (sum, s) => sum + Array.from(s.text).length,
    0,
  );
  if (totalChars + Array.from(trimmed).length > 1_000_000) {
    throw applicationError("MODEL_OUTPUT_TOO_LARGE");
  }

  return {
    segmentIndex: segment.index,
    startSeconds: segment.startSeconds,
    timestamp: formatTimestamp(segment.startSeconds),
    text: result.text,
    source: "model",
  };
}

function completeDocument(
  file: File,
  model: string,
  segments: readonly TranscriptSegment[],
): TranscriptDocument {
  return {
    sourceFileName: file.name,
    modelName: model,
    status: "complete",
    segments,
    markdown: buildTranscript({
      sourceFileName: file.name,
      modelName: model,
      status: "complete",
      segments,
    }),
  };
}

export function createTranscriptionService(
  client: Pick<OllamaClient, "transcribe">,
  processor: AudioProcessor,
): TranscriptionService {
  return {
    async run(input) {
      const decoded = await processor.validateAndDecode(input.file, input.signal);
      try {
        const completedSegments: TranscriptSegment[] = [];
        const totalFrames = decoded.frameLength;
        const totalSegmentCount = calculateSegments(
          decoded.frameLength,
          decoded.sampleRate,
        ).length;

        input.progressCallback("preprocessing", 0, totalFrames);

        for await (const segment of processor.segments(decoded, input.signal)) {
          const progressPercent = Math.floor(
            (segment.endSeconds / decoded.durationSeconds) * 100,
          );
          input.progressCallback("preprocessing", Math.min(progressPercent, 100), totalFrames);

          if (segment.silence === "verified-silent") {
            const transcriptSegment: TranscriptSegment = {
              segmentIndex: segment.index,
              startSeconds: segment.startSeconds,
              timestamp: formatTimestamp(segment.startSeconds),
              text: "[inaudible]",
              source: "local-silence-marker",
            };
            completedSegments.push(transcriptSegment);
            input.progressCallback("transcribing", completedSegments.length, totalSegmentCount);
            input.onSegment?.(transcriptSegment, totalSegmentCount);
          } else if (segment.wavBlob !== undefined) {
            input.progressCallback("transcribing", segment.displayNumber, totalSegmentCount);

            try {
              const transcriptSegment = await transcribeAndValidateSegment(
                client,
                input.model,
                segment,
                segment.wavBlob,
                completedSegments,
                input.signal,
              );
              completedSegments.push(transcriptSegment);
              input.progressCallback("transcribing", completedSegments.length, totalSegmentCount);
              input.onSegment?.(transcriptSegment, totalSegmentCount);
            } catch (error: unknown) {
              throw mapSegmentFailure(error, completedSegments.length + 1);
            }
          }
        }

        return completeDocument(input.file, input.model, completedSegments);
      } finally {
        processor.release(decoded);
      }
    },

    async retry(input) {
      const decoded = await processor.validateAndDecode(input.file, input.signal);
      try {
        const completedSegments: TranscriptSegment[] = [...input.previousSegments];
        const totalFrames = decoded.frameLength;
        const totalSegmentCount = calculateSegments(
          decoded.frameLength,
          decoded.sampleRate,
        ).length;
        let segmentIndex = 0;

        input.progressCallback("preprocessing", 0, totalFrames);

        for await (const segment of processor.segments(decoded, input.signal)) {
          if (segmentIndex < input.failedSegmentIndex) {
            segmentIndex++;
            continue;
          }

          const progressPercent = Math.floor(
            (segment.endSeconds / decoded.durationSeconds) * 100,
          );
          input.progressCallback("preprocessing", Math.min(progressPercent, 100), totalFrames);

          if (segment.silence === "verified-silent") {
            const transcriptSegment: TranscriptSegment = {
              segmentIndex: segment.index,
              startSeconds: segment.startSeconds,
              timestamp: formatTimestamp(segment.startSeconds),
              text: "[inaudible]",
              source: "local-silence-marker",
            };
            completedSegments.push(transcriptSegment);
            input.progressCallback("transcribing", completedSegments.length, totalSegmentCount);
            input.onSegment?.(transcriptSegment, totalSegmentCount);
          } else if (segment.wavBlob !== undefined) {
            input.progressCallback("transcribing", segment.displayNumber, totalSegmentCount);

            try {
              const transcriptSegment = await transcribeAndValidateSegment(
                client,
                input.model,
                segment,
                segment.wavBlob,
                completedSegments,
                input.signal,
              );
              completedSegments.push(transcriptSegment);
              input.progressCallback("transcribing", completedSegments.length, totalSegmentCount);
              input.onSegment?.(transcriptSegment, totalSegmentCount);
            } catch (error: unknown) {
              throw mapSegmentFailure(error, completedSegments.length + 1);
            }
          }

          segmentIndex++;
        }

        return completeDocument(input.file, input.model, completedSegments);
      } finally {
        processor.release(decoded);
      }
    },
  };
}
