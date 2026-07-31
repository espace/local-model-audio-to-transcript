import {
  isAllSilent,
  downmixToMono,
  convertToPcm16,
} from "./pcm-processor";
import { encodeWav } from "./wav-encoder";
import type { AudioWorkerRequest, AudioWorkerResponse } from "./audio-worker.types";

self.onmessage = (event: MessageEvent<AudioWorkerRequest>): void => {
  const request = event.data;

  try {
    const channelData: Float32Array[] = request.channels.map(
      (buffer) => new Float32Array(buffer),
    );

    if (isAllSilent(channelData)) {
      const response: AudioWorkerResponse = {
        type: "segment-complete",
        requestId: request.requestId,
        index: request.index,
        silence: "verified-silent",
      };
      self.postMessage(response);
      return;
    }

    const mono = downmixToMono(channelData);
    const pcm = convertToPcm16(mono);
    const wav = encodeWav(pcm, request.sampleRate, 1);

    const response: AudioWorkerResponse = {
      type: "segment-complete",
      requestId: request.requestId,
      index: request.index,
      silence: "not-verified-silent",
      wav,
    };
    self.postMessage(response, { transfer: [wav] });
  } catch (error: unknown) {
    const message: string =
      error instanceof Error
        ? error.message
        : "Unknown audio processing error";
    const response: AudioWorkerResponse = {
      type: "segment-failed",
      requestId: request.requestId,
      index: request.index,
      message,
    };
    self.postMessage(response);
  }
};
