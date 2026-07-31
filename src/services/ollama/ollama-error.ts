import {
  getErrorDefinition,
  type ApplicationError,
} from "../../types/application-error";

export type OllamaFailureReason =
  | "timeout"
  | "aborted"
  | "refused"
  | "origin-blocked"
  | "malformed-response"
  | "http-failure"
  | "unknown";

const failureCode = {
  timeout: "OLLAMA_UNREACHABLE",
  aborted: "TRANSCRIPTION_CANCELLED",
  refused: "OLLAMA_UNREACHABLE",
  "origin-blocked": "OLLAMA_REQUEST_BLOCKED",
  "malformed-response": "INVALID_MODEL_RESPONSE",
  "http-failure": "UNKNOWN_ERROR",
  unknown: "UNKNOWN_ERROR",
} as const;

/**
 * Converts transport observations into fixed safe user-facing data. Callers
 * retain the original cause only for local diagnostics and never render it.
 */
export function mapOllamaFailure(
  reason: OllamaFailureReason,
): ApplicationError {
  return getErrorDefinition(failureCode[reason]);
}
