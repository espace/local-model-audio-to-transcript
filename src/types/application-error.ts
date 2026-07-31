export type ApplicationErrorCode =
  | "OLLAMA_UNREACHABLE"
  | "OLLAMA_REQUEST_BLOCKED"
  | "NO_MODELS_INSTALLED"
  | "MODEL_NOT_FOUND"
  | "MODEL_NOT_AUDIO_COMPATIBLE"
  | "MODEL_LOAD_FAILED"
  | "UNSUPPORTED_AUDIO_FILE"
  | "AUDIO_DECODE_FAILED"
  | "AUDIO_TOO_LARGE"
  | "AUDIO_TOO_LONG"
  | "AUDIO_DURATION_UNAVAILABLE"
  | "AUDIO_PROCESSING_FAILED"
  | "TRANSCRIPTION_FAILED"
  | "TRANSCRIPTION_CANCELLED"
  | "INVALID_MODEL_RESPONSE"
  | "MODEL_OUTPUT_TOO_LARGE"
  | "CLIPBOARD_WRITE_FAILED"
  | "DOWNLOAD_FAILED"
  | "UNKNOWN_ERROR";

export interface ApplicationErrorDefinition {
  readonly code: ApplicationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly recoveryAction: string;
}

/**
 * Safe user-facing error data. Deliberately excludes a raw cause, response,
 * or stack so internal failure text cannot be rendered by consumers.
 */
export interface ApplicationError extends ApplicationErrorDefinition {
  readonly segmentIndex?: number;
}

const errorDefinitions = {
  OLLAMA_UNREACHABLE: {
    code: "OLLAMA_UNREACHABLE",
    message:
      "Ollama could not be reached at localhost:11434. Make sure Ollama is installed and running. If it is already running, allow this page's origin in Ollama, then retry.",
    retryable: true,
    recoveryAction: "Retry connection",
  },
  OLLAMA_REQUEST_BLOCKED: {
    code: "OLLAMA_REQUEST_BLOCKED",
    message:
      "Ollama could not be reached at localhost:11434. Make sure Ollama is installed and running. If it is already running, allow this page's origin in Ollama, then retry.",
    retryable: true,
    recoveryAction: "Retry connection after origin guidance",
  },
  NO_MODELS_INSTALLED: {
    code: "NO_MODELS_INSTALLED",
    message:
      "Ollama is connected, but no local models were found. Install an audio-capable model and refresh the list.",
    retryable: true,
    recoveryAction: "Refresh models",
  },
  MODEL_NOT_FOUND: {
    code: "MODEL_NOT_FOUND",
    message:
      "The selected model is no longer available. Refresh models or choose another model.",
    retryable: true,
    recoveryAction: "Refresh models or choose another model",
  },
  MODEL_NOT_AUDIO_COMPATIBLE: {
    code: "MODEL_NOT_AUDIO_COMPATIBLE",
    message:
      "This model does not appear to support audio input. Choose an audio-compatible model.",
    retryable: false,
    recoveryAction: "Choose another model",
  },
  MODEL_LOAD_FAILED: {
    code: "MODEL_LOAD_FAILED",
    message:
      "Details for this model could not be loaded. Refresh models or choose another model.",
    retryable: true,
    recoveryAction: "Refresh models or choose another model",
  },
  UNSUPPORTED_AUDIO_FILE: {
    code: "UNSUPPORTED_AUDIO_FILE",
    message:
      "This browser does not support the selected audio format. Choose another file.",
    retryable: false,
    recoveryAction: "Choose another file",
  },
  AUDIO_DECODE_FAILED: {
    code: "AUDIO_DECODE_FAILED",
    message: "The selected file could not be decoded as audio. Choose another file.",
    retryable: false,
    recoveryAction: "Choose another file",
  },
  AUDIO_TOO_LARGE: {
    code: "AUDIO_TOO_LARGE",
    message: "This sandbox supports files up to 25 MB. Choose a smaller file.",
    retryable: false,
    recoveryAction: "Choose another file",
  },
  AUDIO_TOO_LONG: {
    code: "AUDIO_TOO_LONG",
    message: "This sandbox supports audio up to 15 minutes. Choose a shorter file.",
    retryable: false,
    recoveryAction: "Choose another file",
  },
  AUDIO_DURATION_UNAVAILABLE: {
    code: "AUDIO_DURATION_UNAVAILABLE",
    message:
      "The audio duration could not be determined. Choose another file.",
    retryable: false,
    recoveryAction: "Choose another file",
  },
  AUDIO_PROCESSING_FAILED: {
    code: "AUDIO_PROCESSING_FAILED",
    message: "The audio could not be prepared. Retry or choose another file.",
    retryable: true,
    recoveryAction: "Retry after correction or choose another file",
  },
  TRANSCRIPTION_FAILED: {
    code: "TRANSCRIPTION_FAILED",
    message:
      "Transcription stopped at section N. Sections completed so far are kept below.",
    retryable: true,
    recoveryAction: "Retry failed segment or choose another model",
  },
  TRANSCRIPTION_CANCELLED: {
    code: "TRANSCRIPTION_CANCELLED",
    message: "Transcription was cancelled. Start a new run when ready.",
    retryable: false,
    recoveryAction: "Start new run",
  },
  INVALID_MODEL_RESPONSE: {
    code: "INVALID_MODEL_RESPONSE",
    message:
      "The model completed the request but did not return usable transcript text.",
    retryable: true,
    recoveryAction: "Retry failed segment",
  },
  MODEL_OUTPUT_TOO_LARGE: {
    code: "MODEL_OUTPUT_TOO_LARGE",
    message:
      "The model returned too much text to display safely. Earlier sections were kept. Choose another model or start a new run.",
    retryable: false,
    recoveryAction: "Choose another model or start new run",
  },
  CLIPBOARD_WRITE_FAILED: {
    code: "CLIPBOARD_WRITE_FAILED",
    message:
      "The transcript could not be copied to the clipboard. Use Download .md instead.",
    retryable: true,
    recoveryAction: "Download Markdown",
  },
  DOWNLOAD_FAILED: {
    code: "DOWNLOAD_FAILED",
    message:
      "The Markdown file could not be downloaded. Retry the download or copy the transcript.",
    retryable: true,
    recoveryAction: "Retry download or copy Markdown",
  },
  UNKNOWN_ERROR: {
    code: "UNKNOWN_ERROR",
    message:
      "Something unexpected went wrong. Your transcript, if any, has been kept. Retry the last action or choose another file or model.",
    retryable: true,
    recoveryAction:
      "Retry the owning action, retry connection, or refresh models as context requires",
  },
} as const satisfies Record<ApplicationErrorCode, ApplicationErrorDefinition>;

export function getErrorDefinition(
  code: ApplicationErrorCode,
): ApplicationErrorDefinition {
  return errorDefinitions[code];
}
