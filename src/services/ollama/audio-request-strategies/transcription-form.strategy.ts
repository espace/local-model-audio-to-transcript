import { appConfig } from "../../../config/app-config";
import { getErrorDefinition, type ApplicationError } from "../../../types/application-error";
import { multipartTranscriptionResponseSchema, topLevelErrorResponseSchema } from "../ollama.schemas";
import type { AudioRequestStrategy, AudioTranscriptionInput, AudioTranscriptionResult, StrategyContext } from "../ollama.types";
function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function applicationError(code: ApplicationError["code"]): ApplicationError & Error {
  const def = getErrorDefinition(code);
  return Object.assign(new Error(def.message), def);
}

function isExactEndpointResponse(response: Response): boolean {
  return !response.redirected && new URL(response.url).origin === appConfig.ollamaEndpoint;
}

export const transcriptionFormStrategy: AudioRequestStrategy = {
  id: "multipart-transcription",

  supports(context: StrategyContext): boolean {
    if (context.compatibility.status === "incompatible") {
      return false;
    }
    return context.smokeTestedStrategy === undefined || context.smokeTestedStrategy === this.id;
  },

  async execute(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult> {
    const formData = new FormData();
    const wavFile = new File([input.wav], "audio.wav", { type: "audio/wav" });
    formData.append("file", wavFile);
    formData.append("model", input.model);
    formData.append("response_format", "json");
    formData.append("prompt", input.prompt);

    if (input.spokenLanguage !== undefined) {
      formData.append("language", input.spokenLanguage);
    }

    let response: Response;
    try {
      response = await fetch(`${appConfig.ollamaEndpoint}/v1/audio/transcriptions`, {
        method: "POST",
        body: formData,
        redirect: "error",
        signal: input.signal,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw applicationError("TRANSCRIPTION_CANCELLED");
      }
      if (typeof error === "object" && error !== null && "code" in error) {
        throw error;
      }
      throw applicationError("OLLAMA_UNREACHABLE");
    }

    if (!isExactEndpointResponse(response)) {
      throw applicationError("TRANSCRIPTION_FAILED");
    }

    if (!response.ok) {
      throw applicationError("TRANSCRIPTION_FAILED");
    }

    const responseJson: unknown = await response.json();

    const errorCheck = topLevelErrorResponseSchema.safeParse(responseJson);
    if (errorCheck.success) {
      throw applicationError("TRANSCRIPTION_FAILED");
    }

    const parsed = multipartTranscriptionResponseSchema.safeParse(responseJson);
    if (!parsed.success) {
      throw applicationError("INVALID_MODEL_RESPONSE");
    }

    return { text: parsed.data.text, strategy: "multipart-transcription" };
  },
};
