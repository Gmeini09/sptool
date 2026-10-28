// Resampling, OLA time-stretch and pitch shifting (length-preserving).
import type { AudioData } from './types';

/** Cubic (Catmull-Rom) resample of a single channel by `ratio` (>1 = shorter/higher). */
export function resampleChannel(x: Float32Array, ratio: number): Float32Array {
  const outLen = Math.max(1, Math.floor(x.length / ratio));
  const y = new Float32Array(outLen);
  const at = (i: number) => (i < 0 ? 0 : i >= x.length ? 0 : x[i]);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const k = Math.floor(pos);
    const t = pos - k;
    const p0 = at(k - 1), p1 = at(k), p2 = at(k + 1), p3 = at(k + 2);
    y[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  return y;
}

/**
 * Overlap-add time stretch with Hann windows and a cross-correlation search
 * (WSOLA-lite) to reduce phasiness. `factor` > 1 makes audio longer.
 */
export function timeStretchChannel(x: Float32Array, factor: number, sampleRate: number): Float32Array {
  if (Math.abs(factor - 1) < 1e-3) return new Float32Array(x);
  const win = Math.max(256, Math.round(sampleRate * 0.03));
  const hopOut = Math.round(win / 4);
  const hopIn = hopOut / factor;
  const search = Math.round(win / 8);
  const outLen = Math.ceil(x.length * factor) + win;
  const y = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const w = new Float32Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  let prevIn = 0;
  for (let outPos = 0, k = 0; outPos < outLen - win; outPos += hopOut, k++) {
    const nominal = Math.round(k * hopIn);
    if (nominal >= x.length) break;
    let best = nominal;
    if (k > 0) {
      // find offset whose segment best continues the previous one
      let bestScore = -Infinity;
      const ref = prevIn + hopOut;
      for (let off = -search; off <= search; off += 4) {
        const cand = nominal + off;
        if (cand < 0 || cand + win >= x.length) continue;
        let score = 0;
        for (let i = 0; i < hopOut; i += 8) score += x[cand + i] * (x[ref + i] ?? 0);
        if (score > bestScore) { bestScore = score; best = cand; }
      }
    }
    prevIn = best;
    for (let i = 0; i < win; i++) {
      const v = x[best + i] ?? 0;
      y[outPos + i] += v * w[i];
      norm[outPos + i] += w[i];
    }
  }
  const target = Math.ceil(x.length * factor);
  const out = new Float32Array(target);
  for (let i = 0; i < target; i++) out[i] = norm[i] > 1e-3 ? y[i] / norm[i] : y[i];
  return out;
}

/** Speed change (pitch follows, like tape). speed 0.5..2 */
export function changeSpeed(a: AudioData, speed: number): AudioData {
  if (Math.abs(speed - 1) < 1e-3) return a;
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => resampleChannel(c, speed)) };
}

/** Pitch shift in semitones keeping duration. */
export function pitchShift(a: AudioData, semitones: number): AudioData {
  if (Math.abs(semitones) < 0.01) return a;
  const ratio = Math.pow(2, semitones / 12);
  return {
    sampleRate: a.sampleRate,
    channels: a.channels.map((c) => {
      const stretched = timeStretchChannel(c, ratio, a.sampleRate);
      const r = resampleChannel(stretched, ratio);
      const out = new Float32Array(c.length);
      out.set(r.subarray(0, c.length));
      return out;
    }),
  };
}
