import { appConfig } from "../../config/app-config";
import {
  getErrorDefinition,
  type ApplicationError,
  type ApplicationErrorCode,
} from "../../types/application-error";
import type { Connection } from "../../types/domain";

import { mapOllamaFailure, type OllamaFailureReason } from "./ollama-error";
import {
  modelSummarySchema,
  showResponseSchema,
  tagsResponseSchema,
  versionResponseSchema,
} from "./ollama.schemas";
import type {
  AudioTranscriptionInput,
  AudioTranscriptionResult,
  LocalModelDetails,
  LocalModelSummary,
  OllamaModelDetailsDto,
  StrategyContext,
} from "./ollama.types";
import { chatImagesWavStrategy } from "./audio-request-strategies/chat-images-wav.strategy";
import { transcriptionFormStrategy } from "./audio-request-strategies/transcription-form.strategy";
import { classifyAudioCompatibility } from "./model-compatibility.service";

class DeadlineExceededError extends Error {
  constructor() {
    super("Ollama connection deadline exceeded");
    this.name = "DeadlineExceededError";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function isExactEndpointResponse(response: Response): boolean {
  return !response.redirected && new URL(response.url).origin === appConfig.ollamaEndpoint;
}

async function beforeDeadline<T>(
  operation: Promise<T>,
  deadlineSignal: AbortSignal,
): Promise<T> {
  if (deadlineSignal.aborted) {
    throw new DeadlineExceededError();
  }

  return new Promise<T>((resolve, reject) => {
    const rejectOnDeadline = () => {
      reject(new DeadlineExceededError());
    };

    deadlineSignal.addEventListener("abort", rejectOnDeadline, { once: true });
    void operation.then(
      (value) => {
        deadlineSignal.removeEventListener("abort", rejectOnDeadline);
        resolve(value);
      },
      (error: unknown) => {
        deadlineSignal.removeEventListener("abort", rejectOnDeadline);
        if (isAbortError(error)) {
          const abortError = new Error("Ollama request aborted");
          abortError.name = "AbortError";
          reject(abortError);
          return;
        }
        reject(
          error instanceof Error
            ? error
            : new Error("Ollama request failed without an Error cause"),
        );
      },
    );
  });
}

function unavailable(reason: OllamaFailureReason): Connection {
  return {
    status: "unavailable",
    endpoint: appConfig.ollamaEndpoint,
    error: mapOllamaFailure(reason),
  };
}

function failureReason(error: unknown): OllamaFailureReason {
  if (error instanceof DeadlineExceededError) {
    return "timeout";
  }

  if (isAbortError(error)) {
    return "aborted";
  }

  return "refused";
}

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function applicationError(code: ApplicationErrorCode): ApplicationError & Error {
  const definition = getErrorDefinition(code);
  return Object.assign(new Error(definition.message), definition);
}

function mapModelDetails(
  details: OllamaModelDetailsDto | undefined,
): LocalModelDetails["details"] {
  return details === undefined
    ? undefined
    : {
        family: details.family,
        families: details.families,
        parameterSize: details.parameter_size,
        quantization: details.quantization_level,
      };
}

function mapModelSummary(
  summary: ReturnType<typeof modelSummarySchema.parse>,
): LocalModelSummary {
  return {
    name: summary.name,
    model: summary.model,
    modifiedAt: summary.modified_at,
    sizeBytes: summary.size,
    digest: summary.digest,
    details: mapModelDetails(summary.details),
  };
}

function mapModelDetailsResponse(
  details: ReturnType<typeof showResponseSchema.parse>,
): LocalModelDetails {
  return {
    capabilities: details.capabilities,
    details: mapModelDetails(details.details),
    modelInfo: details.model_info,
  };
}

/** A single unusable entry from a `/api/tags` response, reported without discarding its valid siblings. */
export type ModelListMalformedEntry = {
  readonly index: number;
  readonly reason: string;
};

/** The result of listing models: every valid summary plus a per-entry report of malformed entries (FR-016). */
export type ModelListResult = {
  readonly models: readonly LocalModelSummary[];
  readonly malformedEntries: readonly ModelListMalformedEntry[];
};

/** A wholly malformed or failed model list is a model-owned failure, not a connection failure. */
export const modelListErrorCode: ApplicationErrorCode = "UNKNOWN_ERROR";

/**
 * The client contract with its consumers. `listModels` reports malformed
 * entries alongside valid siblings; the transport-level `OllamaClient` type
 * keeps the array shape for callers that do not need the report.
 */
export interface OllamaClientFacade {
  checkConnection(signal: AbortSignal): Promise<Connection>;
  listModels(signal: AbortSignal): Promise<ModelListResult>;
  showModel(name: string, signal: AbortSignal): Promise<LocalModelDetails>;
  transcribe(
    input: AudioTranscriptionInput,
  ): Promise<AudioTranscriptionResult>;
}

/** Best-effort version probe for the current run's strategy selection. */
async function probeVersion(signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(`${appConfig.ollamaEndpoint}/api/version`, {
      method: "GET",
      redirect: "error",
      signal,
    });
    if (!isExactEndpointResponse(response) || !response.ok) {
      return undefined;
    }
    const parsed = versionResponseSchema.safeParse(await readJson(response));
    return parsed.success ? parsed.data.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort model-capability probe for the current run's strategy selection.
 * A definitively absent model (404) propagates as MODEL_NOT_FOUND.
 */
async function probeModelCapabilities(
  model: string,
  signal: AbortSignal,
): Promise<{
  readonly capabilities?: readonly string[];
  readonly modelInfo?: Readonly<Record<string, unknown>>;
  readonly families?: readonly string[];
} | undefined> {
  try {
    const response = await fetch(`${appConfig.ollamaEndpoint}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      redirect: "error",
      signal,
    });
    if (!isExactEndpointResponse(response)) {
      return undefined;
    }
    if (response.status === 404) {
      throw applicationError("MODEL_NOT_FOUND");
    }
    if (!response.ok) {
      return undefined;
    }
    const parsed = showResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      return undefined;
    }
    return {
      capabilities: parsed.data.capabilities,
      modelInfo: parsed.data.model_info,
      families: mapModelDetails(parsed.data.details)?.families,
    };
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }
    return undefined;
  }
}

/** Builds the per-run StrategyContext from the observed version, capabilities, and evidence. */
async function resolveStrategyContext(
  input: AudioTranscriptionInput,
): Promise<StrategyContext> {
  const version = await probeVersion(input.signal);
  const capabilities = await probeModelCapabilities(input.model, input.signal);

  return {
    endpoint: appConfig.ollamaEndpoint,
    model: input.model,
    version,
    capabilities: capabilities?.capabilities,
    compatibility: classifyAudioCompatibility({
      version,
      capabilities: capabilities?.capabilities,
      modelInfo: capabilities?.modelInfo,
      families: capabilities?.families,
    }),
  };
}

/** Creates the fixed-origin Ollama boundary; no user supplied endpoints exist. */
export function createOllamaClient(): OllamaClientFacade {
  return {
    async checkConnection(callerSignal: AbortSignal): Promise<Connection> {
      if (callerSignal.aborted) {
        return unavailable("aborted");
      }

      const deadline = new AbortController();
      const fallbackRequest = new AbortController();
      const onCallerAbort = () => {
        fallbackRequest.abort();
      };
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      const timeoutId = setTimeout(
        () => {
          deadline.abort();
          fallbackRequest.abort();
        },
        appConfig.connectionDeadlineMs,
      );

      try {
        let response: Response;
        try {
          response = await beforeDeadline(
            fetch(`${appConfig.ollamaEndpoint}/api/version`, {
              method: "GET",
              redirect: "error",
              signal: callerSignal,
            }),
            deadline.signal,
          );
        } catch (error: unknown) {
          return unavailable(failureReason(error));
        }

        if (isExactEndpointResponse(response) && response.ok) {
          try {
            const version = versionResponseSchema.safeParse(
              await beforeDeadline(readJson(response), deadline.signal),
            );
            if (version.success) {
              return {
                status: "connected",
                endpoint: appConfig.ollamaEndpoint,
                version: version.data.version,
              };
            }
          } catch (error: unknown) {
            if (error instanceof DeadlineExceededError || isAbortError(error)) {
              return unavailable(failureReason(error));
            }
          }
        } else if (!isExactEndpointResponse(response)) {
          return unavailable("refused");
        }

        let tagsResponse: Response;
        try {
          tagsResponse = await beforeDeadline(
            fetch(`${appConfig.ollamaEndpoint}/api/tags`, {
              method: "GET",
              redirect: "error",
              signal: fallbackRequest.signal,
            }),
            deadline.signal,
          );
        } catch (error: unknown) {
          return unavailable(failureReason(error));
        }

        if (!isExactEndpointResponse(tagsResponse) || !tagsResponse.ok) {
          return unavailable("http-failure");
        }

        try {
          const tags = tagsResponseSchema.safeParse(
            await beforeDeadline(readJson(tagsResponse), deadline.signal),
          );
          return tags.success
            ? { status: "connected", endpoint: appConfig.ollamaEndpoint }
            : unavailable("malformed-response");
        } catch (error: unknown) {
          return unavailable(
            error instanceof DeadlineExceededError || isAbortError(error)
              ? failureReason(error)
              : "malformed-response",
          );
        }
      } finally {
        clearTimeout(timeoutId);
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    },
    async listModels(
      signal: AbortSignal,
    ): Promise<ModelListResult> {
      let response: Response;

      try {
        response = await fetch(`${appConfig.ollamaEndpoint}/api/tags`, {
          method: "GET",
          redirect: "error",
          signal,
        });
      } catch (error: unknown) {
        throw applicationError(
          isAbortError(error) ? "TRANSCRIPTION_CANCELLED" : "OLLAMA_UNREACHABLE",
        );
      }

      if (!isExactEndpointResponse(response)) {
        throw applicationError("OLLAMA_UNREACHABLE");
      }

      if (!response.ok) {
        throw applicationError(modelListErrorCode);
      }

      try {
        const tags = tagsResponseSchema.safeParse(await readJson(response));
        if (!tags.success) {
          throw applicationError(modelListErrorCode);
        }

        const models: LocalModelSummary[] = [];
        const malformedEntries: ModelListMalformedEntry[] = [];

        tags.data.models.forEach((entry, index) => {
          const parsed = modelSummarySchema.safeParse(entry);
          if (parsed.success) {
            models.push(mapModelSummary(parsed.data));
            return;
          }
          malformedEntries.push({
            index,
            reason: parsed.error.issues
              .map((issue) =>
                issue.path.length > 0
                  ? `${issue.path.join(".")}: ${issue.message}`
                  : issue.message,
              )
              .join("; "),
          });
        });

        if (tags.data.models.length > 0 && models.length === 0) {
          throw applicationError(modelListErrorCode);
        }
        if (tags.data.models.length === 0) {
          throw applicationError("NO_MODELS_INSTALLED");
        }

        return { models, malformedEntries };
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error
        ) {
          throw error;
        }
        throw applicationError(modelListErrorCode);
      }
    },
    async showModel(name: string, signal: AbortSignal): Promise<LocalModelDetails> {
      let response: Response;

      try {
        response = await fetch(`${appConfig.ollamaEndpoint}/api/show`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: name }),
          redirect: "error",
          signal,
        });
      } catch (error: unknown) {
        throw applicationError(
          isAbortError(error) ? "TRANSCRIPTION_CANCELLED" : "OLLAMA_UNREACHABLE",
        );
      }

      if (!isExactEndpointResponse(response)) {
        throw applicationError("OLLAMA_UNREACHABLE");
      }

      if (response.status === 404) {
        throw applicationError("MODEL_NOT_FOUND");
      }

      if (!response.ok) {
        throw applicationError("MODEL_LOAD_FAILED");
      }

      try {
        const details = showResponseSchema.safeParse(await readJson(response));
        if (!details.success) {
          throw applicationError("MODEL_LOAD_FAILED");
        }
        return mapModelDetailsResponse(details.data);
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error
        ) {
          throw error;
        }
        throw applicationError(
          isAbortError(error) ? "TRANSCRIPTION_CANCELLED" : "MODEL_LOAD_FAILED",
        );
      }
    },
    async transcribe(
      input: AudioTranscriptionInput,
    ): Promise<AudioTranscriptionResult> {
      const context = await resolveStrategyContext(input);

      const primary = chatImagesWavStrategy;
      const fallback = transcriptionFormStrategy;

      if (primary.supports(context)) {
        try {
          return await primary.execute(input, context);
        } catch (primaryError: unknown) {
          if (
            typeof primaryError === "object" &&
            primaryError !== null &&
            "code" in primaryError
          ) {
            throw primaryError;
          }
          throw applicationError("TRANSCRIPTION_FAILED");
        }
      }

      if (fallback.supports(context)) {
        try {
          return await fallback.execute(input, context);
        } catch (fallbackError: unknown) {
          if (
            typeof fallbackError === "object" &&
            fallbackError !== null &&
            "code" in fallbackError
          ) {
            throw fallbackError;
          }
          throw applicationError("TRANSCRIPTION_FAILED");
        }
      }

      throw applicationError(
        context.compatibility.status === "incompatible"
          ? "MODEL_NOT_AUDIO_COMPATIBLE"
          : "TRANSCRIPTION_FAILED",
      );
    },
  };
}
