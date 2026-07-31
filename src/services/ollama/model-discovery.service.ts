import { getErrorDefinition, type ApplicationError } from "../../types/application-error";
import type { AudioCompatibilityDecision, ModelOption } from "../../types/domain";

import {
  modelListErrorCode,
  type ModelListMalformedEntry,
  type ModelListResult,
} from "./ollama.client";
import type {
  LocalModelDetails,
  LocalModelSummary,
  OllamaClient,
} from "./ollama.types";

type CompatibilityInput = {
  readonly version?: string;
  readonly capabilities?: readonly string[];
  readonly modelInfo?: Readonly<Record<string, unknown>>;
  readonly families?: readonly string[];
};

interface ModelDiscoveryDependencies {
  readonly client: Pick<OllamaClient, "showModel"> & {
    readonly listModels: (
      signal: AbortSignal,
    ) => Promise<readonly LocalModelSummary[] | ModelListResult>;
  };
  readonly compatibility: {
    readonly classify: (
      input: CompatibilityInput,
    ) => AudioCompatibilityDecision;
  };
}

export interface ModelDiscoveryRequest {
  readonly signal: AbortSignal;
  readonly version?: string;
  readonly selectedModelName?: string;
}

export interface ModelDiscoveryResult {
  readonly models: readonly ModelOption[];
  readonly malformedEntries: readonly ModelListMalformedEntry[];
  readonly removedSelectedModelName?: string;
}

/**
 * Signals a wholly malformed or otherwise failed model list so callers can
 * surface the model-owned UNKNOWN_ERROR (with refresh-models recovery) instead
 * of relabeling it as a connection failure.
 */
export class ModelDiscoveryError extends Error {
  readonly error: ApplicationError;

  constructor() {
    const error = getErrorDefinition(modelListErrorCode);
    super(error.message);
    this.name = "ModelDiscoveryError";
    this.error = error;
  }
}

export interface ModelDiscoveryService {
  load(input: ModelDiscoveryRequest): Promise<ModelDiscoveryResult>;
  refresh(input: ModelDiscoveryRequest): Promise<ModelDiscoveryResult>;
}

function unknownCompatibility(
  compatibility: ModelDiscoveryDependencies["compatibility"],
): AudioCompatibilityDecision {
  return compatibility.classify({});
}

function modelLoadError(): ApplicationError {
  return getErrorDefinition("MODEL_LOAD_FAILED");
}

function modelMetadata(
  summary: LocalModelSummary,
  details: LocalModelDetails,
) {
  const detailMetadata = details.details;
  const summaryMetadata = summary.details;

  return {
    modifiedAt: summary.modifiedAt,
    sizeBytes: summary.sizeBytes,
    digest: summary.digest,
    family: detailMetadata?.family ?? summaryMetadata?.family,
    families: detailMetadata?.families ?? summaryMetadata?.families,
    parameterSize: detailMetadata?.parameterSize ?? summaryMetadata?.parameterSize,
    quantization: detailMetadata?.quantization ?? summaryMetadata?.quantization,
  };
}

/**
 * Discovers every locally installed model and keeps successful detail lookups
 * only for the lifetime of this page session.
 */
export function createModelDiscoveryService(
  dependencies: ModelDiscoveryDependencies,
): ModelDiscoveryService {
  const detailCache = new Map<string, LocalModelDetails>();

  async function resolveModel(
    summary: LocalModelSummary,
    signal: AbortSignal,
    version: string | undefined,
  ): Promise<ModelOption> {
    try {
      let details = detailCache.get(summary.name);
      if (details === undefined) {
        details = await dependencies.client.showModel(summary.name, signal);
        detailCache.set(summary.name, details);
      }

      const metadata = modelMetadata(summary, details);
      return {
        name: summary.name,
        ...metadata,
        detailsStatus: "loaded",
        compatibility: dependencies.compatibility.classify({
          version,
          capabilities: details.capabilities,
          modelInfo: details.modelInfo,
          families: metadata.families,
        }),
      };
    } catch {
      return {
        name: summary.name,
        ...modelMetadata(summary, {}),
        detailsStatus: "failed",
        compatibility: unknownCompatibility(dependencies.compatibility),
        detailsError: modelLoadError(),
      };
    }
  }

  async function load(input: ModelDiscoveryRequest): Promise<ModelDiscoveryResult> {
    let list: readonly LocalModelSummary[];
    let malformedEntries: readonly ModelListMalformedEntry[];

    try {
      const result = await dependencies.client.listModels(input.signal);
      list = "models" in result ? result.models : result;
      malformedEntries = "models" in result ? result.malformedEntries : [];
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === modelListErrorCode
      ) {
        throw new ModelDiscoveryError();
      }
      throw error;
    }

    const models = await Promise.all(
      list.map((summary) =>
        resolveModel(summary, input.signal, input.version),
      ),
    );
    const removedSelectedModelName =
      input.selectedModelName !== undefined &&
      !models.some((model) => model.name === input.selectedModelName)
        ? input.selectedModelName
        : undefined;

    return { models, malformedEntries, removedSelectedModelName };
  }

  return {
    load,
    async refresh(input: ModelDiscoveryRequest): Promise<ModelDiscoveryResult> {
      detailCache.clear();
      return load(input);
    },
  };
}
