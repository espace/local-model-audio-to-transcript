import { appConfig } from "../../../config/app-config";
import { getErrorDefinition, type ApplicationError } from "../../../types/application-error";
import { chatResponseSchema, topLevelErrorResponseSchema } from "../ollama.schemas";
import type { AudioRequestStrategy, AudioTranscriptionInput, AudioTranscriptionResult, StrategyContext } from "../ollama.types";

/**
 * The documented `/api/chat` request contract with `think: false` and
 * `options.temperature: 0` applies to the v0.32+ service generation (the same
 * generation that introduced the audio capability API). Older or unknown
 * versions expose no verified controls, so the controls are omitted.
 */
const DOCUMENTED_CONTROLS_MIN_MAJOR = 0;
const DOCUMENTED_CONTROLS_MIN_MINOR = 32;

function exposesDocumentedControls(version: string | undefined): boolean {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version ?? "");
  if (match === null) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (
    major > DOCUMENTED_CONTROLS_MIN_MAJOR ||
    (major === DOCUMENTED_CONTROLS_MIN_MAJOR && minor >= DOCUMENTED_CONTROLS_MIN_MINOR)
  );
}

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

export const chatImagesWavStrategy: AudioRequestStrategy = {
  id: "chat-images-wav",

  supports(context: StrategyContext): boolean {
    if (context.compatibility.status === "incompatible") {
      return false;
    }
    return context.smokeTestedStrategy === undefined || context.smokeTestedStrategy === this.id;
  },

  async execute(
    input: AudioTranscriptionInput,
    context?: StrategyContext,
  ): Promise<AudioTranscriptionResult> {
    const arrayBuffer = await input.wav.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const len = bytes.length;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i] ?? 0);
    }
    const base64Data = btoa(binary);

    const body: Record<string, unknown> = {
      model: input.model,
      messages: [
        {
          role: "user",
          content: input.prompt,
          images: [base64Data],
        },
      ],
      stream: false,
    };

    if (exposesDocumentedControls(context?.version)) {
      body.think = false;
      body.options = { temperature: 0 };
    }

    let response: Response;
    try {
      response = await fetch(`${appConfig.ollamaEndpoint}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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

    const parsed = chatResponseSchema.safeParse(responseJson);
    if (!parsed.success) {
      throw applicationError("INVALID_MODEL_RESPONSE");
    }

    return { text: parsed.data.message.content, strategy: "chat-images-wav" };
  },
};
