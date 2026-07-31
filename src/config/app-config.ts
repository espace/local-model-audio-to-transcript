export const appConfig = Object.freeze({
  ollamaEndpoint: "http://localhost:11434",
  connectionDeadlineMs: 3_000,
  maxAudioBytes: 25_000_000,
  maxAudioDurationSeconds: 900,
  targetSampleRateHz: 16_000,
  segmentDurationSeconds: 30,
  segmentOverlapSeconds: 1,
} as const);
