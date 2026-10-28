// Loudness and level analysis. LUFS follows ITU-R BS.1770-4 (K-weighting, gating).
import { biquadProcess, type BiquadCoeffs } from './biquad';
import { type AudioData, gainToDb, lengthOf } from './types';

export interface AudioAnalysis {
  duration: number;
  sampleRate: number;
  channels: number;
  peakDb: number;
  rmsDb: number;
  lufs: number;
  /** Peak-to-RMS (crest factor) in dB – a practical dynamic range figure for one-shots. */
  dynamicRangeDb: number;
  clippedSamples: number;
  clipping: boolean;
}

/** K-weighting stage coefficients for any sample rate (pyloudnorm formulation). */
function kWeighting(sr: number): [BiquadCoeffs, BiquadCoeffs] {
  // Stage 1: high shelf (+4 dB @ 1681.97 Hz)
  const G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.974450955533;
  const A = Math.pow(10, G / 40), w0 = (2 * Math.PI * fc) / sr, alpha = Math.sin(w0) / (2 * Q), c = Math.cos(w0);
  const sq = 2 * Math.sqrt(A) * alpha;
  const a0 = (A + 1) - (A - 1) * c + sq;
  const shelf: BiquadCoeffs = {
    b0: (A * ((A + 1) + (A - 1) * c + sq)) / a0,
    b1: (-2 * A * ((A - 1) + (A + 1) * c)) / a0,
    b2: (A * ((A + 1) + (A - 1) * c - sq)) / a0,
    a1: (2 * ((A - 1) - (A + 1) * c)) / a0,
    a2: ((A + 1) - (A - 1) * c - sq) / a0,
  };
  // Stage 2: high pass (RLB, 38.13 Hz)
  const Q2 = 0.5003270373253953, fc2 = 38.13547087613982;
  const w2 = (2 * Math.PI * fc2) / sr, al2 = Math.sin(w2) / (2 * Q2), c2 = Math.cos(w2);
  const a02 = 1 + al2;
  const hp: BiquadCoeffs = { b0: 1 / a02, b1: -2 / a02, b2: 1 / a02, a1: (-2 * c2) / a02, a2: (1 - al2) / a02 };
  return [shelf, hp];
}

/** Loudest 400 ms window (K-weighted, LUFS) – how loud a one-shot like a gunshot is perceived,
 *  independent of how long its tail is. */
export function momentaryMaxLufs(a: AudioData): number {
  const n = lengthOf(a);
  if (n === 0) return -Infinity;
  const [s1, s2] = kWeighting(a.sampleRate);
  const sq = new Float64Array(n);
  for (const ch of a.channels.slice(0, 2)) {
    const x = new Float32Array(ch);
    biquadProcess(x, s1);
    biquadProcess(x, s2);
    for (let i = 0; i < n; i++) sq[i] += x[i] * x[i];
  }
  const win = Math.min(n, Math.round(0.4 * a.sampleRate));
  let s = 0;
  for (let i = 0; i < win; i++) s += sq[i];
  let best = s;
  for (let i = win; i < n; i++) { s += sq[i] - sq[i - win]; if (s > best) best = s; }
  return -0.691 + 10 * Math.log10(Math.max(best / Math.round(0.4 * a.sampleRate), 1e-20));
}

export function integratedLufs(a: AudioData): number {
  const n = lengthOf(a);
  if (n === 0) return -Infinity;
  const [s1, s2] = kWeighting(a.sampleRate);
  const weighted = a.channels.slice(0, 2).map((ch) => {
    const x = new Float32Array(ch);
    biquadProcess(x, s1);
    biquadProcess(x, s2);
    return x;
  });
  const block = Math.round(0.4 * a.sampleRate);
  const hop = Math.round(0.1 * a.sampleRate);
  const blocks: number[] = [];
  if (n < block) {
    // One-shot shorter than a gating block: measure the whole signal.
    let z = 0;
    for (const x of weighted) { let s = 0; for (let i = 0; i < n; i++) s += x[i] * x[i]; z += s / n; }
    blocks.push(z);
  } else {
    for (let start = 0; start + block <= n; start += hop) {
      let z = 0;
      for (const x of weighted) { let s = 0; for (let i = start; i < start + block; i++) s += x[i] * x[i]; z += s / block; }
      blocks.push(z);
    }
  }
  const loud = (z: number) => -0.691 + 10 * Math.log10(Math.max(z, 1e-20));
  const abs = blocks.filter((z) => loud(z) > -70);
  if (!abs.length) return -Infinity;
  const relThresh = loud(abs.reduce((p, c) => p + c, 0) / abs.length) - 10;
  const rel = abs.filter((z) => loud(z) > relThresh);
  if (!rel.length) return -Infinity;
  return loud(rel.reduce((p, c) => p + c, 0) / rel.length);
}

export function analyze(a: AudioData): AudioAnalysis {
  const n = lengthOf(a);
  let peak = 0, sum = 0, clipped = 0;
  for (const ch of a.channels) for (let i = 0; i < n; i++) {
    const v = Math.abs(ch[i]);
    if (v > peak) peak = v;
    if (v >= 0.999) clipped++;
    sum += ch[i] * ch[i];
  }
  const rms = n ? Math.sqrt(sum / (n * a.channels.length)) : 0;
  const peakDb = gainToDb(peak);
  const rmsDb = gainToDb(rms);
  return {
    duration: n / a.sampleRate,
    sampleRate: a.sampleRate,
    channels: a.channels.length,
    peakDb,
    rmsDb,
    lufs: integratedLufs(a),
    dynamicRangeDb: peakDb - rmsDb,
    clippedSamples: clipped,
    // a few isolated full-scale samples are common after normalisation; 3+ consecutive-ish is real clipping
    clipping: clipped >= 3,
  };
}

/** Min/max peaks per bucket for waveform drawing, mixed to mono. */
export function computePeaks(a: AudioData, buckets: number, start = 0, end = lengthOf(a)): Float32Array {
  const out = new Float32Array(buckets * 2);
  const span = Math.max(1, end - start);
  for (let b = 0; b < buckets; b++) {
    const s = start + Math.floor((b * span) / buckets);
    const e = Math.max(s + 1, start + Math.floor(((b + 1) * span) / buckets));
    let mn = 0, mx = 0;
    for (let i = s; i < e && i < end; i++) {
      let v = 0;
      for (const ch of a.channels) v += ch[i];
      v /= a.channels.length;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[b * 2] = mn;
    out[b * 2 + 1] = mx;
  }
  return out;
}
