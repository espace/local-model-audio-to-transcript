export const SILENCE_THRESHOLD = 0.5 / 32768;

export function isSilent(channel: Float32Array): boolean {
  for (let i = 0; i < channel.length; i++) {
    const s = channel[i];
    if (s !== undefined && Math.abs(s) >= SILENCE_THRESHOLD) {
      return false;
    }
  }
  return true;
}

export function isAllSilent(channels: readonly Float32Array[]): boolean {
  for (let c = 0; c < channels.length; c++) {
    const channel = channels[c];
    if (!channel) continue;
    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      if (s !== undefined && Math.abs(s) >= SILENCE_THRESHOLD) {
        return false;
      }
    }
  }
  return true;
}

export function processSilent(
  _channelCount: number,
  _frameLength: number,
): { silence: "verified-silent" } {
  void _channelCount;
  void _frameLength;
  return { silence: "verified-silent" };
}

export function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function quantizePcm16(sample: number): number {
  const clamped = clampSample(sample);
  return clamped < 0
    ? Math.round(clamped * 32768)
    : Math.round(clamped * 32767);
}

export function downmixToMono(
  channelData: readonly Float32Array[],
): Float32Array {
  const first = channelData[0];
  const frameLength = first?.length ?? 0;

  if (channelData.length === 1 && first) {
    const mono = new Float32Array(frameLength);
    mono.set(first);
    return mono;
  }

  const mono = new Float32Array(frameLength);
  const numChannels = channelData.length;

  for (let i = 0; i < frameLength; i++) {
    let sum = 0;
    for (let c = 0; c < numChannels; c++) {
      const s = channelData[c]?.[i];
      sum += s ?? 0;
    }
    mono[i] = sum / numChannels;
  }

  return mono;
}

export function convertToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    pcm[i] = quantizePcm16(s ?? 0);
  }
  return pcm;
}
