// Time-based effects: Freeverb-style reverb, feedback delay, stereo width.
import { type AudioData, lengthOf } from './types';

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

function freeverbChannel(input: Float32Array, sr: number, room: number, damp: number, spread: number): Float32Array {
  const scale = sr / 44100;
  const out = new Float32Array(input.length);
  const feedback = 0.7 + room * 0.28;
  const d1 = damp * 0.4, d2 = 1 - d1;
  const combs = COMBS.map((l) => ({ buf: new Float32Array(Math.round((l + spread) * scale)), idx: 0, store: 0 }));
  const aps = ALLPASS.map((l) => ({ buf: new Float32Array(Math.round((l + spread) * scale)), idx: 0 }));
  for (let i = 0; i < input.length; i++) {
    const x = input[i] * 0.015;
    let s = 0;
    for (const c of combs) {
      const y = c.buf[c.idx];
      c.store = y * d2 + c.store * d1;
      c.buf[c.idx] = x + c.store * feedback;
      if (++c.idx >= c.buf.length) c.idx = 0;
      s += y;
    }
    for (const ap of aps) {
      const b = ap.buf[ap.idx];
      const y = -s + b;
      ap.buf[ap.idx] = s + b * 0.5;
      if (++ap.idx >= ap.buf.length) ap.idx = 0;
      s = y;
    }
    out[i] = s;
  }
  return out;
}

/** Adds a reverb tail (extends the buffer by `tailSec`). mix 0..1. */
export function reverb(a: AudioData, room: number, damping: number, mix: number, tailSec = 1.2): AudioData {
  const extra = Math.round(tailSec * (0.4 + room) * a.sampleRate);
  const n = lengthOf(a) + extra;
  const chans = a.channels.length === 1 ? [a.channels[0], a.channels[0]] : a.channels;
  const out: Float32Array[] = chans.map((ch, ci) => {
    const padded = new Float32Array(n);
    padded.set(ch);
    const wet = freeverbChannel(padded, a.sampleRate, room, damping, ci === 0 ? 0 : STEREO_SPREAD);
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = padded[i] * (1 - mix * 0.5) + wet[i] * mix * 3;
    return o;
  });
  return trimSilenceEnd({ sampleRate: a.sampleRate, channels: out }, lengthOf(a));
}

/** Feedback delay; extends the buffer until echoes decay below -60 dB. */
export function delay(a: AudioData, timeMs: number, feedback: number, mix: number): AudioData {
  const d = Math.max(1, Math.round((timeMs / 1000) * a.sampleRate));
  const fb = Math.min(0.95, Math.max(0, feedback));
  const repeats = fb > 0 ? Math.min(40, Math.ceil(Math.log(0.001) / Math.log(fb))) : 1;
  const n = lengthOf(a) + d * repeats;
  const out = a.channels.map((ch) => {
    const o = new Float32Array(n);
    const line = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dry = i < ch.length ? ch[i] : 0;
      const delayed = i >= d ? line[i - d] : 0;
      line[i] = dry + delayed * fb;
      o[i] = dry + delayed * mix;
    }
    return o;
  });
  return trimSilenceEnd({ sampleRate: a.sampleRate, channels: out }, lengthOf(a));
}

/** Mid/side width: 0 = mono, 1 = unchanged, 2 = extra wide. */
export function stereoWidth(a: AudioData, width: number): void {
  if (a.channels.length < 2) return;
  const [l, r] = a.channels;
  for (let i = 0; i < l.length; i++) {
    const m = (l[i] + r[i]) * 0.5;
    const s = (l[i] - r[i]) * 0.5 * width;
    l[i] = m + s;
    r[i] = m - s;
  }
}

export function toMono(a: AudioData): void {
  if (a.channels.length < 2) return;
  const [l, r] = a.channels;
  for (let i = 0; i < l.length; i++) { const m = (l[i] + r[i]) * 0.5; l[i] = m; r[i] = m; }
}

/** Cuts trailing near-silence but never below `minLength` samples. */
export function trimSilenceEnd(a: AudioData, minLength: number, thresholdDb = -72): AudioData {
  const thr = Math.pow(10, thresholdDb / 20);
  let end = lengthOf(a);
  while (end > minLength) {
    let loud = false;
    for (const ch of a.channels) if (Math.abs(ch[end - 1]) > thr) { loud = true; break; }
    if (loud) break;
    end--;
  }
  if (end === lengthOf(a)) return a;
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => c.slice(0, end)) };
}
