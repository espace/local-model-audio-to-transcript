import type { TranscriptSegment } from "../../types/domain";
import { deduplicateOverlap } from "./overlap-deduplicator";

export interface BuildTranscriptInput {
  readonly sourceFileName: string;
  readonly modelName: string;
  readonly status: "complete" | "partial-cancelled" | "partial-failed";
  readonly segments: readonly TranscriptSegment[];
  readonly failedSegmentNumber?: number;
}

function escapeMetadata(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([`*_{}[\]()#+\-.!|])/g, "\\$1")
    .replace(/\r?\n/g, "\\n");
}

function escapeSegmentText(value: string): string {
  return value
    .split(/(\r?\n)/)
    .map((line) => {
      if (
        /^( {0,3})(?:# Transcript(?:\s+#+)?\s*|- \*\*(?:Source|Model|Status):\*\*.*|---\s*|## \d{2}:\d{2}(?:\s+#+)?\s*)$/.test(
          line,
        )
      ) {
        return line.replace(/^( {0,3})/, "$1\\");
      }

      return line;
    })
    .join("");
}

function statusLine(
  status: "complete" | "partial-cancelled" | "partial-failed",
  failedSegmentNumber?: number,
): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "partial-cancelled":
      return "Partial — transcription cancelled";
    case "partial-failed":
      return `Partial — transcription failed at section ${String(failedSegmentNumber ?? 1)}`;
  }
}

export function buildTranscript(input: BuildTranscriptInput): string {
  const sorted = [...input.segments]
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.segmentIndex - b.segmentIndex);

  if (sorted.length === 0) {
    return "";
  }

  let lastModelText: string | undefined;
  let previousSegmentIndex: number | undefined;
  const processed = sorted.map((segment) => {
    const adjacent =
      previousSegmentIndex !== undefined &&
      segment.segmentIndex === previousSegmentIndex + 1;

    if (segment.source === "model") {
      if (adjacent && lastModelText !== undefined) {
        const text = deduplicateOverlap(lastModelText, segment.text);
        lastModelText = text;
        previousSegmentIndex = segment.segmentIndex;
        return { ...segment, text };
      }

      lastModelText = segment.text;
      previousSegmentIndex = segment.segmentIndex;
      return segment;
    }

    lastModelText = undefined;
    previousSegmentIndex = segment.segmentIndex;
    return segment;
  });

  const lines: string[] = [
    "# Transcript",
    "",
    `- **Source:** ${escapeMetadata(input.sourceFileName)}`,
    `- **Model:** ${escapeMetadata(input.modelName)}`,
    `- **Status:** ${statusLine(input.status, input.failedSegmentNumber)}`,
    "",
    "---",
  ];

  for (const segment of processed) {
    lines.push("", `## ${segment.timestamp}`, "", escapeSegmentText(segment.text));
  }

  return lines.join("\n");
}
