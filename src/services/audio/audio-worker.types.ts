export type AudioWorkerRequest = {
  type: "process-segment";
  requestId: string;
  index: number;
  sampleRate: number;
  channels: ArrayBuffer[];
};

export type AudioWorkerResponseSuccess = {
  type: "segment-complete";
  requestId: string;
  index: number;
  silence?: "verified-silent" | "not-verified-silent";
  wav?: ArrayBuffer;
};

export type AudioWorkerResponseFailure = {
  type: "segment-failed";
  requestId: string;
  index: number;
  message?: string;
};

export type AudioWorkerResponse =
  | AudioWorkerResponseSuccess
  | AudioWorkerResponseFailure;
