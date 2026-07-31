import type { AudioCompatibilityDecision } from "../../types/domain";

export interface CompatibilityEvidence {
  readonly version?: string;
  readonly capabilities?: readonly string[];
  readonly modelInfo?: Readonly<Record<string, unknown>>;
  readonly families?: readonly string[];
}

const audioEncoders = new Set(["whisper"]);
const audioFamilies = new Set(["whisper"]);

function compatible(
  evidence: AudioCompatibilityDecision["evidence"],
  reason: string,
): AudioCompatibilityDecision {
  return { status: "compatible", evidence, reason };
}

/** Applies the documented decisive-evidence order without guessing support. */
export function classifyAudioCompatibility(
  input: CompatibilityEvidence,
): AudioCompatibilityDecision {
  if (input.capabilities !== undefined) {
    return input.capabilities.includes("audio")
      ? compatible("service-capability", "Ollama reports audio input support.")
      : {
          status: "incompatible",
          evidence: "service-capability",
          reason: "Ollama reports no audio input capability for this model.",
        };
  }

  const encoder = input.modelInfo?.["audio.encoder"];
  if (typeof encoder === "string" && audioEncoders.has(encoder.toLowerCase())) {
    return compatible("audio-encoder", "Recognized audio encoder metadata indicates support.");
  }

  if (input.families?.some((family) => audioFamilies.has(family.toLowerCase()))) {
    return compatible("family-rule", "Known audio-capable model family indicates support.");
  }

  return {
    status: "unknown",
    evidence: "none",
    reason: "Audio support could not be confirmed for this model.",
  };
}
