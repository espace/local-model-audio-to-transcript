import type { AudioCompatibilityDecision, Connection } from "../../types/domain";

export type OllamaEndpoint = "http://localhost:11434";

export type AudioRequestStrategyId =
  | "chat-images-wav"
  | "multipart-transcription";

export interface OllamaVersionDto {
  readonly version: string;
}

export interface OllamaModelDetailsDto {
  readonly family?: string;
  readonly families?: readonly string[];
  readonly parameter_size?: string;
  readonly quantization_level?: string;
}

export interface OllamaModelSummaryDto {
  readonly name: string;
  readonly model: string;
  readonly modified_at?: string;
  readonly size?: number;
  readonly digest?: string;
  readonly details?: OllamaModelDetailsDto;
}

export interface OllamaTagsResponseDto {
  readonly models: readonly OllamaModelSummaryDto[];
}

export interface OllamaShowResponseDto {
  readonly capabilities?: readonly string[];
  readonly details?: OllamaModelDetailsDto;
  readonly model_info?: Readonly<Record<string, unknown>>;
}

export interface OllamaChatResponseDto {
  readonly message?: {
    readonly role?: string;
    readonly content?: string;
  };
  readonly done?: boolean;
  readonly error?: string;
}

export interface OllamaTranscriptionResponseDto {
  readonly text?: string;
  readonly error?: string;
}

export interface LocalModelSummary {
  readonly name: string;
  readonly model: string;
  readonly modifiedAt?: string;
  readonly sizeBytes?: number;
  readonly digest?: string;
  readonly details?: {
    readonly family?: string;
    readonly families?: readonly string[];
    readonly parameterSize?: string;
    readonly quantization?: string;
  };
}

export interface LocalModelDetails {
  readonly capabilities?: readonly string[];
  readonly details?: {
    readonly family?: string;
    readonly families?: readonly string[];
    readonly parameterSize?: string;
    readonly quantization?: string;
  };
  readonly modelInfo?: Readonly<Record<string, unknown>>;
}

export interface AudioTranscriptionInput {
  readonly model: string;
  /** A transient, complete RIFF/WAVE PCM16, 16 kHz mono audio payload. */
  readonly wav: Blob;
  readonly prompt: string;
  /** Present only when the user explicitly selected a spoken-language hint. */
  readonly spokenLanguage?: string;
  readonly signal: AbortSignal;
}

export interface AudioTranscriptionResult {
  readonly text: string;
  readonly strategy: AudioRequestStrategyId;
}

/**
 * Per-run evidence handed to strategy selection, per the strategy-selection
 * rules in contracts/ollama-api.md: only the current run's validated version,
 * capabilities, and model evidence are used; nothing about a settled run is
 * kept.
 */
export interface StrategyContext {
  readonly endpoint: OllamaEndpoint;
  readonly model: string;
  /** Validated `GET /api/version` value for this run, when available. */
  readonly version?: string;
  /** Declared capabilities from `POST /api/show` for this run, when available. */
  readonly capabilities?: readonly string[];
  /** Compatibility classification from the documented evidence order. */
  readonly compatibility: AudioCompatibilityDecision;
  /**
   * A smoke-tested model/server pair that prefers a specific strategy. Absent
   * when no smoke test has run; a strategy rejects the context when this names
   * a different strategy.
   */
  readonly smokeTestedStrategy?: AudioRequestStrategyId;
}

export interface AudioRequestStrategy {
  readonly id: AudioRequestStrategyId;
  supports(context: StrategyContext): boolean;
  /**
   * The per-run StrategyContext is consumed by strategies whose payload
   * depends on endpoint controls (for example, emitting or omitting
   * documented think/temperature controls by version).
   */
  execute(
    input: AudioTranscriptionInput,
    context?: StrategyContext,
  ): Promise<AudioTranscriptionResult>;
}

export interface OllamaClient {
  checkConnection(signal: AbortSignal): Promise<Connection>;
  listModels(signal: AbortSignal): Promise<readonly LocalModelSummary[]>;
  showModel(name: string, signal: AbortSignal): Promise<LocalModelDetails>;
  transcribe(
    input: AudioTranscriptionInput,
  ): Promise<AudioTranscriptionResult>;
}
