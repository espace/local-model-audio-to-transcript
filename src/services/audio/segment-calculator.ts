import { appConfig } from "../../config/app-config";
import type { AudioSegment } from "../../types/domain";

export function calculateSegments(
  totalFrames: number,
  sampleRate: number,
): AudioSegment[] {
  const segmentFrames = appConfig.segmentDurationSeconds * sampleRate;
  const overlapFrames = appConfig.segmentOverlapSeconds * sampleRate;
  const strideFrames = segmentFrames - overlapFrames;

  if (totalFrames <= segmentFrames) {
    return [
      {
        index: 0,
        displayNumber: 1,
        startFrame: 0,
        endFrameExclusive: totalFrames,
        startSeconds: 0,
        endSeconds: totalFrames / sampleRate,
        silence: "not-verified-silent",
        status: "pending",
        wavByteLength: totalFrames * 2 + 44,
      },
    ];
  }

  const count = 1 + Math.ceil((totalFrames - segmentFrames) / strideFrames);
  const segments: AudioSegment[] = [];

  for (let i = 0; i < count; i++) {
    const startFrame = i * strideFrames;
    const endFrameExclusive = Math.min(
      startFrame + segmentFrames,
      totalFrames,
    );
    const segmentFrameCount = endFrameExclusive - startFrame;

    segments.push({
      index: i,
      displayNumber: i + 1,
      startFrame,
      endFrameExclusive,
      startSeconds: startFrame / sampleRate,
      endSeconds: endFrameExclusive / sampleRate,
      silence: "not-verified-silent",
      status: "pending",
      wavByteLength: segmentFrameCount * 2 + 44,
    });
  }

  return segments;
}
