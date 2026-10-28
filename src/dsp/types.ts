/** Core audio container used by every DSP function. Channels are planar. */
export interface AudioData {
  sampleRate: number;
  channels: Float32Array[];
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => (g <= 1e-10 ? -200 : 20 * Math.log10(g));

export function lengthOf(a: AudioData): number {
  return a.channels[0]?.length ?? 0;
}

export function durationOf(a: AudioData): number {
  return lengthOf(a) / a.sampleRate;
}

export function cloneAudio(a: AudioData): AudioData {
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => new Float32Array(c)) };
}

export function makeAudio(sampleRate: number, length: number, numChannels = 2): AudioData {
  return { sampleRate, channels: Array.from({ length: numChannels }, () => new Float32Array(Math.max(0, length))) };
}

/** Ensures exactly 2 channels (duplicates mono, drops extra channels). */
export function toStereo(a: AudioData): AudioData {
  if (a.channels.length === 2) return a;
  if (a.channels.length === 1) return { sampleRate: a.sampleRate, channels: [a.channels[0], new Float32Array(a.channels[0])] };
  return { sampleRate: a.sampleRate, channels: [a.channels[0], a.channels[1]] };
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
