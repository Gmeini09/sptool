// Effects that shape a gunshot the way designed game shots are built: extra "crack" harmonics, a short punch
// layer under the hit, and a city slap-back echo. All of them are mono-safe (identical in both channels or derived
// per channel without delays between left and right), because FiveM plays weapon sounds as mono streams.
import { biquadCoeffs, biquadProcess } from './biquad';
import { type AudioData, lengthOf } from './types';

/** First sample where the sound gets within 20 dB of its peak (the hit). */
export function onsetIndex(a: AudioData): number {
  let peak = 0;
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const thr = peak * 0.1;
  const n = lengthOf(a);
  for (let i = 0; i < n; i++) for (const ch of a.channels) if (Math.abs(ch[i]) >= thr) return i;
  return 0;
}

/** Harmonic exciter: saturates everything above `freq` and mixes it back in (amount 0..1). Adds bite and crack. */
export function excite(a: AudioData, freq: number, amount: number): void {
  if (amount <= 0) return;
  const drive = 2 + amount * 4;
  const norm = Math.tanh(drive);
  for (const ch of a.channels) {
    const hi = new Float32Array(ch);
    biquadProcess(hi, biquadCoeffs('highpass', a.sampleRate, freq, 0.707));
    biquadProcess(hi, biquadCoeffs('highpass', a.sampleRate, freq, 0.707));
    let pk = 0;
    for (let i = 0; i < hi.length; i++) pk = Math.max(pk, Math.abs(hi[i]));
    if (pk < 1e-6) continue;
    for (let i = 0; i < hi.length; i++) hi[i] = Math.tanh((hi[i] / pk) * drive) / norm * pk;
    // keep only what the saturation added above the band (the new harmonics), not a plain boost
    biquadProcess(hi, biquadCoeffs('highpass', a.sampleRate, freq * 1.4, 0.707));
    const g = amount * 0.35;
    for (let i = 0; i < ch.length; i++) ch[i] += hi[i] * g;
  }
}

/** Punch layer: a short pitched thump (glides from 2× freq down to freq) placed on the hit. amount 0..1. */
export function addThump(a: AudioData, freq: number, amount: number, decayMs = 45): void {
  if (amount <= 0) return;
  const sr = a.sampleRate, n = lengthOf(a);
  const at = onsetIndex(a);
  let peak = 0;
  for (const ch of a.channels) for (let i = at; i < Math.min(n, at + Math.round(0.03 * sr)); i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak < 1e-6) return;
  const len = Math.min(n - at, Math.round((decayMs / 1000) * 6 * sr));
  const t = new Float32Array(len);
  let ph = 0;
  const tau = decayMs / 1000, atk = Math.round(0.0015 * sr);
  for (let i = 0; i < len; i++) {
    const s = i / sr;
    const f = freq + freq * Math.exp(-s / 0.008);
    ph += (2 * Math.PI * f) / sr;
    t[i] = Math.sin(ph) * Math.exp(-s / tau) * Math.min(1, i / atk);
  }
  // asymmetric saturation adds the harmonics that make low punch audible on headsets and laptop speakers
  const d = 2.2, nd = Math.tanh(d);
  for (let i = 0; i < len; i++) { const x = t[i] * d; t[i] = Math.tanh(x + 0.25 * x * x) / nd; }
  biquadProcess(t, biquadCoeffs('highpass', sr, 30, 0.7));
  const g = peak * amount * 0.75;
  for (const ch of a.channels) for (let i = 0; i < len; i++) ch[at + i] += t[i] * g;
}

/** City slap-back: two darker, band-limited copies of the shot (time, then ~1.8× time), equal in both channels.
 *  Extends the sound so the echoes are not cut off. mix 0..1, tone = low-pass of the first echo in Hz. */
export function slapEcho(a: AudioData, timeMs: number, mix: number, tone = 2200): AudioData {
  if (mix <= 0) return a;
  const sr = a.sampleRate, n = lengthOf(a);
  const d1 = Math.round((timeMs / 1000) * sr), d2 = Math.round(d1 * 1.82);
  const out = n + d2 + Math.round(0.25 * sr);
  const mono = new Float32Array(n);
  for (const ch of a.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / a.channels.length;
  const e1 = new Float32Array(mono);
  biquadProcess(e1, biquadCoeffs('lowpass', sr, tone, 0.707));
  biquadProcess(e1, biquadCoeffs('highpass', sr, 140, 0.707));
  const e2 = new Float32Array(e1);
  biquadProcess(e2, biquadCoeffs('lowpass', sr, tone * 0.6, 0.707));
  const channels = a.channels.map((ch) => {
    const o = new Float32Array(out);
    o.set(ch);
    for (let i = 0; i < n; i++) { o[i + d1] += e1[i] * mix * 0.8; o[i + d2] += e2[i] * mix * 0.38; }
    return o;
  });
  // cut trailing silence again
  let end = out;
  const thr = 10 ** (-72 / 20);
  while (end > n) { let loud = false; for (const c of channels) if (Math.abs(c[end - 1]) > thr) { loud = true; break; } if (loud) break; end--; }
  return { sampleRate: sr, channels: channels.map((c) => (end === out ? c : c.slice(0, end))) };
}

/** Level of the mono sum relative to the stereo signal in dB (0 = fully mono-compatible, negative = loses level in-game). */
export function monoLossDb(a: AudioData): number {
  if (a.channels.length < 2) return 0;
  const [l, r] = a.channels;
  let s = 0, m = 0;
  for (let i = 0; i < l.length; i++) { s += (l[i] * l[i] + r[i] * r[i]) / 2; const v = (l[i] + r[i]) / 2; m += v * v; }
  return s > 0 ? 10 * Math.log10(Math.max(1e-12, m) / s) : 0;
}
