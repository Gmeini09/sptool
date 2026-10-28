// Tells a gunshot from a reload / mechanical sound by its shape – no AI service, just the signal:
// a shot is one big bang with a long, bass-heavy tail; reload sounds are short metallic clicks (often several).
//
// v2 (1.9.3): besides the loudness envelope the model now looks at the spectrum (energy per frequency band over the
// whole sound and in its first 50 ms, brightness, noisiness, onsets). It was fitted on real game and creator-pack
// sounds (pistol shots, reload/handling/dry-fire sounds of 18 packs) together with the built-in library – the old
// model knew only the built-in sounds and called half of the real reload sounds a shot.
import type { AudioData } from './types';
import { MODEL } from './classifyModel';

export type SoundKind = 'shot' | 'reload';
export interface SoundFeatures { events: number; decayMs: number; lowRatio: number; hiRatio: number; density: number; mainMs: number; durMs: number }

function mono(a: AudioData): Float32Array {
  if (a.channels.length === 1) return a.channels[0];
  const n = a.channels[0].length, out = new Float32Array(n);
  for (const c of a.channels) for (let i = 0; i < n; i++) out[i] += c[i] / a.channels.length;
  return out;
}

/** A hit counts as the main one from this share of the loudest peak on. */
const MAIN_HIT = 0.85;

export function soundFeatures(a: AudioData): SoundFeatures {
  const x = mono(a), sr = a.sampleRate, n = x.length;
  const win = Math.max(1, Math.round(sr * 0.005));
  const env: number[] = [];
  for (let i = 0; i < n; i += win) { let p = 0; for (let j = i; j < Math.min(n, i + win); j++) { const v = Math.abs(x[j]); if (v > p) p = v; } env.push(p); }
  let peak = 1e-9;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i];
  // the main hit is the FIRST one that reaches (almost) the peak – an echo or second hit that happens to be a
  // fraction louder must not move it (that made the result flip with the sample rate)
  let pi = 0; while (pi < env.length - 1 && env[pi] < peak * MAIN_HIT) pi++;
  // decay of the loudest event down to -30 dB
  let d = pi; while (d < env.length && env[d] > peak * 0.0316) d++;
  const decayMs = (d - pi) * 5;
  // separate events above 15 % of the peak, split by ≥ 40 ms of quiet
  let events = 0, quiet = 99, inEv = false, mainLen = 0, curLen = 0;
  for (const v of env) {
    if (v > peak * 0.15) { if (!inEv && quiet >= 8) events++; inEv = true; quiet = 0; curLen++; mainLen = Math.max(mainLen, curLen); }
    else { quiet++; if (quiet >= 8) { inEv = false; curLen = 0; } }
  }
  // share of energy below ~250 Hz (one-pole low-pass)
  const k = Math.exp(-2 * Math.PI * 250 / sr);
  let lp = 0, eLow = 0, eAll = 0;
  for (let i = 0; i < n; i++) { lp = (1 - k) * x[i] + k * lp; eLow += lp * lp; eAll += x[i] * x[i]; }
  // share above ~3 kHz (one-pole high-pass) – clicks are bright
  const kh = Math.exp(-2 * Math.PI * 3000 / sr);
  let lph = 0, eHi = 0;
  for (let i = 0; i < n; i++) { lph = (1 - kh) * x[i] + kh * lph; const h = x[i] - lph; eHi += h * h; }
  // density: RMS / peak in the 120 ms after the peak – a shot is a dense burst, a click a sparse spike
  const p0 = pi * win, p1 = Math.min(n, p0 + Math.round(sr * 0.12));
  let e = 0; for (let i = p0; i < p1; i++) e += x[i] * x[i];
  const density = p1 > p0 ? Math.sqrt(e / (p1 - p0)) / peak : 0;
  return { events, decayMs, lowRatio: eAll > 0 ? eLow / eAll : 0, hiRatio: eAll > 0 ? eHi / eAll : 0, density, mainMs: mainLen * 5, durMs: n / sr * 1000 };
}

// ── v2 features ─────────────────────────────────────────────────────────────
const N = 1024, HOP = 256;
const EDGES = [0, 150, 400, 1000, 2000, 4000, 8000, 1e9];
const HANN = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

/** In-place radix-2 FFT (re, im of length N). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j + len / 2] = re[i + j] - ar; im[i + j + len / 2] = im[i + j] - ai;
        re[i + j] += ar; im[i + j] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Power spectra of 1024-sample Hann frames, hop 256 (at most ~6 s are looked at). */
function frames(x: Float32Array): Float64Array[] {
  const src = x.length < N ? (() => { const p = new Float32Array(N); p.set(x); return p; })() : x;
  const out: Float64Array[] = [];
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= src.length && out.length < 1200; s += HOP) {
    for (let i = 0; i < N; i++) { re[i] = src[s + i] * HANN[i]; im[i] = 0; }
    fft(re, im);
    const p = new Float64Array(N / 2 + 1);
    for (let i = 0; i <= N / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
    out.push(p);
  }
  return out;
}

/** All model inputs (named, so tests and training read the same values). */
export function classifierInputs(a: AudioData): Record<string, number> {
  const f = soundFeatures(a);
  const x = mono(a), sr = a.sampleRate, n = x.length;
  let pk = 0, e = 0;
  for (let i = 0; i < n; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; e += x[i] * x[i]; }
  let pi = 0; while (pi < n - 1 && Math.abs(x[pi]) < pk * MAIN_HIT) pi++; // first hit, see soundFeatures
  const rms = Math.sqrt(e / Math.max(1, n));
  let a10 = 0; while (a10 < pi && Math.abs(x[a10]) < pk * 0.1) a10++;
  let z = 0; for (let i = 1; i < n; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) z++;
  const seg = (t0: number, t1: number) => { let s = 0; const i0 = a10 + Math.round(t0 * sr), i1 = Math.min(n, a10 + Math.round(t1 * sr)); for (let i = i0; i < i1; i++) s += x[i] * x[i]; return s; };
  const e0 = seg(0, 0.03), e1 = seg(0.03, 0.15), e2 = seg(0.15, 0.6), tot = e0 + e1 + e2 + 1e-12;
  const kl = Math.exp(-2 * Math.PI * 200 / sr); let lp = 0, el = 0, ea = 0;
  for (let i = a10; i < Math.min(n, a10 + Math.round(sr * 0.06)); i++) { lp = (1 - kl) * x[i] + kl * lp; el += lp * lp; ea += x[i] * x[i]; }
  const w = Math.max(1, Math.round(sr * 0.005)); let loud = 0, fr = 0;
  for (let i = 0; i < n; i += w) { let p = 0; for (let j = i; j < Math.min(n, i + w); j++) p = Math.max(p, Math.abs(x[j])); fr++; if (p > pk * 0.1) loud++; }

  // spectrum
  const F = frames(x);
  const hz = (k: number) => (k * sr) / N;
  const energy = F.map((p) => p.reduce((s, v) => s + v, 0));
  const emax = Math.max(1e-30, ...energy);
  const on = Math.max(0, energy.findIndex((v) => v > emax * 0.1));
  const sum = (from: number, to: number) => { const s = new Float64Array(N / 2 + 1); for (let t = from; t < Math.min(F.length, to); t++) for (let k = 0; k <= N / 2; k++) s[k] += F[t][k]; return s; };
  const whole = sum(0, F.length), att = sum(on, on + Math.max(1, Math.floor((0.05 * sr) / HOP)));
  const bands = (S: Float64Array) => { const tot2 = S.reduce((s, v) => s + v, 0) + 1e-20; const b = new Array(EDGES.length - 1).fill(0); for (let k = 0; k <= N / 2; k++) { const h = hz(k); for (let j = 0; j < b.length; j++) if (h >= EDGES[j] && h < EDGES[j + 1]) { b[j] += S[k]; break; } } return b.map((v) => v / tot2); };
  const cent = (S: Float64Array) => { let a2 = 0, b2 = 0; for (let k = 0; k <= N / 2; k++) { a2 += S[k] * hz(k); b2 += S[k]; } return a2 / (b2 + 1e-20); };
  const flat = (S: Float64Array) => { let lg = 0, m = 0, c = 0; for (let k = 0; k <= N / 2; k++) { const h = hz(k); if (h > 100 && h < 10000) { lg += Math.log(S[k] + 1e-20); m += S[k] + 1e-20; c++; } } return c ? Math.exp(lg / c) / (m / c) : 0; };
  // spectral-flux onsets (separate hits, ≥ 60 ms apart)
  const flux: number[] = [];
  for (let t = 1; t < F.length; t++) { let s = 0; for (let k = 0; k <= N / 2; k++) { const d2 = Math.log(F[t][k] + 1e-12) - Math.log(F[t - 1][k] + 1e-12); if (d2 > 0) s += d2; } flux.push(s); }
  const fm = flux.reduce((s, v) => s + v, 0) / Math.max(1, flux.length);
  const fsd = Math.sqrt(flux.reduce((s, v) => s + (v - fm) ** 2, 0) / Math.max(1, flux.length));
  let ons = 0, last = -99; const gap = Math.floor((0.06 * sr) / HOP);
  flux.forEach((v, i) => { if (v > fm + 2 * fsd && i - last > gap) { ons++; last = i; } });

  const bw = bands(whole), ba = bands(att);
  const out: Record<string, number> = {
    decayMs: Math.log(f.decayMs + 5), lowRatio: f.lowRatio, hiRatio: f.hiRatio, density: f.density, events: Math.min(f.events, 5),
    mainMs: Math.log(f.mainMs + 5), durMs: Math.log(f.durMs + 5), attackMs: Math.log(((pi - a10) / sr) * 1000 + 5),
    zcr: Math.log((z / Math.max(1, n)) * sr / 1000 + 5), crest: Math.log(pk / (rms + 1e-12) + 5),
    early: e0 / tot, mid: e1 / tot, late: e2 / tot, lowEarly: ea > 0 ? el / ea : 0, loudFrac: loud / Math.max(1, fr),
    centWhole: Math.log(cent(whole) + 1), centAtt: Math.log(cent(att) + 1), flatWhole: flat(whole), flatAtt: flat(att), onsets: ons,
  };
  bw.forEach((v, i) => { out[`bw${i}`] = v; });
  ba.forEach((v, i) => { out[`ba${i}`] = v; });
  return out;
}

/** Logistic model over classifierInputs (see classifyModel.ts). > 0 = shot. */
export function shotScoreV2(inp: Record<string, number>): number {
  let s = MODEL.bias;
  for (const [k, w, mu, sd] of MODEL.terms) s += ((inp[k] - mu) / sd) * w;
  return s;
}

/** 'shot' (gunshot) or 'reload' (magazine, slide, clicks …), plus whether it was a close call. */
export function classifySound(a: AudioData): { kind: SoundKind; sure: boolean; score: number } {
  const n = a.channels[0]?.length ?? 0;
  if (!n) return { kind: 'reload', sure: false, score: -1 };
  const raw = shotScoreV2(classifierInputs(a));
  const score = Number.isFinite(raw) ? raw : -1; // silent / empty → not a shot
  return { kind: score > 0 ? 'shot' : 'reload', sure: Math.abs(score) >= MODEL.unsure, score };
}
