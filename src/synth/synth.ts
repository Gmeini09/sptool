// Procedural, rights-clean sound synthesis. Every built-in SP Tool sound is
// generated from (params, seed) at runtime – no third-party recordings.
import { biquadCoeffs, biquadProcess } from '../dsp/biquad';
import { trimSilenceEnd } from '../dsp/effects';
import { limit } from '../dsp/dynamics';
import { momentaryMaxLufs } from '../dsp/analysis';
import { matchTone, type BandProfile } from '../dsp/spectrum';
import { type AudioData, makeAudio } from '../dsp/types';

/** Bumped whenever built-in sounds change (render cache key). Engine 1 stays reproducible for old user sounds. */
export const SYNTH_VERSION = 3;
export const SAMPLE_RATE = 44100;

export type FireKind = 'fire' | 'suppressed';
export type MechKind =
  | 'mag_out' | 'mag_in' | 'mag_drop' | 'mag_tap' | 'slide_pull' | 'slide_release' | 'chamber' | 'mech_click'
  | 'reload_finish' | 'reload_fast' | 'reload_heavy' | 'reload_clean' | 'reload_metallic' | 'reload_tactical';
export type HandlingKind =
  | 'draw' | 'holster' | 'equip' | 'inspect' | 'trigger' | 'dry_fire' | 'safety' | 'mechanical'
  | 'metal_move' | 'polymer_move' | 'grip' | 'mag_handling';
export type SynthKind = FireKind | MechKind | HandlingKind;

export interface SynthParams {
  kind: SynthKind;
  seed: number;
  /** 0..1 macro controls (spec §54) */
  punch: number;
  bass: number;
  transient: number;
  metal: number;
  tail: number;
  room: number;
  noise: number;
  dynamics: number;
  /** semitones -12..12 */
  pitch: number;
  /** length multiplier 0.4..2 */
  length: number;
  /** 0 = small calibre (.22 feel) … 1 = .50 */
  caliber: number;
  /** Synthesis engine. Missing = 1 (sounds saved before engine 2 keep sounding exactly the same). */
  engine?: number;
  /** Engine 2: spectral balance to aim for (see TONE_PROFILES). Missing = a light nudge toward 'balanced'. */
  tone?: ToneName;
  /** Engine 2, optional (1.7.4 styles): city echo with three slaps off buildings, 0..1 */
  slaps?: number;
  /** Engine 2, optional: bright ring of the supersonic crack, 0..1 */
  ring?: number;
  /** Engine 2, optional: tail and echoes identical in both channels (FiveM plays weapon sounds in mono) */
  monoSafe?: boolean;
}

/**
 * Spectral balance targets (percent of energy per band, first 400 ms), measured from 6 community FiveM
 * soundpacks (1 893 replaced streams, medians). Only these numbers are used – none of their audio.
 *   balanced  most packs: body-heavy core (250–800 Hz), little sub, clear presence and air
 *   dense     very compressed packs: even more body, crest ~9 dB
 *   bright    "cracky" packs: presence and air dominate
 *   reload    replaced reload / mechanical sounds: strongly mid-focused, very short clicks
 */
export const TONE_PROFILES = {
  balanced: { sub: 5, low: 20, lowmid: 28, mid: 19, presence: 15, air: 12 },
  dense: { sub: 2, low: 17, lowmid: 36, mid: 21, presence: 15, air: 9 },
  bright: { sub: 4, low: 7, lowmid: 18, mid: 21, presence: 27, air: 23 },
  reload: { sub: 4, low: 8, lowmid: 19, mid: 44, presence: 15, air: 10 },
  // 05.10.2026: German gangwar / "Gambo" packs (5 more archives, medians of the replaced shot cores – numbers only):
  // almost no sub, strong low-mid body, clear presence, very little air – loud and "fat", not hissy
  gambo: { sub: 2, low: 20, lowmid: 36, mid: 20, presence: 16, air: 6 },
} satisfies Record<string, BandProfile>;
export type ToneName = keyof typeof TONE_PROFILES;

export const DEFAULT_SYNTH: SynthParams = {
  kind: 'fire', seed: 1, punch: 0.6, bass: 0.5, transient: 0.6, metal: 0.35, tail: 0.45, room: 0.3,
  noise: 0.5, dynamics: 0.4, pitch: 0, length: 1, caliber: 0.5, engine: 2,
};

// ── RNG ───────────────────────────────────────────────────────────────────────
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Primitives (write into a mono buffer) ──────────────────────────────────
type Rng = () => number;

function noiseBurst(out: Float32Array, sr: number, rnd: Rng, t0: number, tau: number, amp: number, filt?: { type: 'lowpass' | 'highpass' | 'bandpass'; f: number; q?: number }, attack = 0.0004) {
  const start = Math.round(t0 * sr);
  const len = Math.min(out.length - start, Math.round(tau * 7 * sr));
  if (len <= 0) return;
  const buf = new Float32Array(len);
  const atk = Math.max(1, Math.round(attack * sr));
  for (let i = 0; i < len; i++) {
    const env = Math.exp(-i / (tau * sr)) * Math.min(1, i / atk);
    buf[i] = (rnd() * 2 - 1) * env;
  }
  if (filt) biquadProcess(buf, biquadCoeffs(filt.type, sr, filt.f, filt.q ?? 0.8));
  for (let i = 0; i < len; i++) out[start + i] += buf[i] * amp;
}

/** Exponentially decaying sine with pitch glide (body / bass / thud). */
function sweptSine(out: Float32Array, sr: number, t0: number, f0: number, f1: number, glideTau: number, tau: number, amp: number, attack = 0.0015) {
  const start = Math.round(t0 * sr);
  const len = Math.min(out.length - start, Math.round(tau * 7 * sr));
  if (len <= 0) return;
  let phase = 0;
  const atk = Math.max(1, Math.round(attack * sr));
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / glideTau);
    phase += (2 * Math.PI * f) / sr;
    out[start + i] += Math.sin(phase) * Math.exp(-t / tau) * Math.min(1, i / atk) * amp;
  }
}

/** Metallic click: a few inharmonic damped partials + a tiny noise tick. */
function metalClick(out: Float32Array, sr: number, rnd: Rng, t0: number, base: number, tau: number, amp: number, partials = 4) {
  const start = Math.round(t0 * sr);
  const len = Math.min(out.length - start, Math.round(tau * 7 * sr));
  if (len <= 0) return;
  const ratios = [1, 1.47 + rnd() * 0.2, 2.09 + rnd() * 0.3, 2.76 + rnd() * 0.4, 3.6 + rnd() * 0.5].slice(0, partials);
  ratios.forEach((r, k) => {
    const f = base * r;
    if (f > sr * 0.45) return;
    const ph = rnd() * Math.PI * 2;
    const pt = tau * (1 - k * 0.15);
    const a = amp / (1 + k * 0.6);
    for (let i = 0; i < len; i++) out[start + i] += Math.sin(ph + (2 * Math.PI * f * i) / sr) * Math.exp(-i / (pt * sr)) * a;
  });
  noiseBurst(out, sr, rnd, t0, 0.0012, amp * 0.9, { type: 'highpass', f: 3000 });
}

/** Friction / slide noise with swept band-pass and smooth envelope. */
function friction(out: Float32Array, sr: number, rnd: Rng, t0: number, dur: number, f0: number, f1: number, amp: number, q = 1.4) {
  const start = Math.round(t0 * sr);
  const len = Math.min(out.length - start, Math.round(dur * sr));
  if (len <= 0) return;
  const block = 64;
  const buf = new Float32Array(len);
  let z1 = 0, z2 = 0, y1 = 0, y2 = 0;
  for (let b = 0; b < len; b += block) {
    const p = b / len;
    const c = biquadCoeffs('bandpass', sr, f0 + (f1 - f0) * p, q);
    for (let i = b; i < Math.min(len, b + block); i++) {
      const x = rnd() * 2 - 1;
      const y = c.b0 * x + c.b1 * z1 + c.b2 * z2 - c.a1 * y1 - c.a2 * y2;
      z2 = z1; z1 = x; y2 = y1; y1 = y;
      const env = Math.sin(Math.PI * (i / len)) ** 0.7 * (0.75 + 0.25 * Math.sin(i * 0.004 + rnd() * 0.02));
      buf[i] = y * env;
    }
  }
  for (let i = 0; i < len; i++) out[start + i] += buf[i] * amp * 2.2;
}

function stereoize(mono: Float32Array, sr: number, rnd: Rng, room: number, width: number): AudioData {
  const n = mono.length;
  const out = makeAudio(sr, n, 2);
  const [l, r] = out.channels;
  l.set(mono); r.set(mono);
  if (room > 0.01) {
    // Early reflections with per-channel taps → room + stereo image
    const taps = [11, 17, 23, 31, 41, 53, 67].map((ms) => ms * (0.8 + rnd() * 0.4));
    taps.forEach((ms, k) => {
      const d = Math.round((ms / 1000) * sr * (0.6 + room));
      const g = room * 0.55 * Math.pow(0.78, k);
      const target = k % 2 === 0 ? l : r;
      for (let i = n - 1; i >= d; i--) target[i] += mono[i - d] * g;
    });
  }
  if (width !== 1) {
    for (let i = 0; i < n; i++) { const m = (l[i] + r[i]) / 2, s = ((l[i] - r[i]) / 2) * width; l[i] = m + s; r[i] = m - s; }
  }
  return out;
}

function finish(a: AudioData, dynamics: number, peakDb = -1): AudioData {
  const drive = 1 + dynamics * 3;
  const norm = Math.tanh(drive);
  let peak = 0;
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
  const pre = peak > 0 ? 1 / peak : 1;
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(ch[i] * pre * drive) / norm;
  // DC block + final peak normalisation
  for (const ch of a.channels) biquadProcess(ch, biquadCoeffs('highpass', a.sampleRate, 22, 0.6));
  peak = 0;
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
  const g = peak > 0 ? Math.pow(10, peakDb / 20) / peak : 1;
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  const trimmed = trimSilenceEnd(a, Math.round(a.sampleRate * 0.05), -66);
  // 8 ms fade-out to avoid end clicks
  const n = trimmed.channels[0].length, f = Math.min(n, Math.round(0.008 * a.sampleRate));
  for (const ch of trimmed.channels) for (let i = 0; i < f; i++) ch[n - 1 - i] *= i / f;
  return trimmed;
}

// ── Gunshots ─────────────────────────────────────────────────────────────────
function synthFire(p: SynthParams, rnd: Rng): AudioData {
  const sr = SAMPLE_RATE;
  const pr = Math.pow(2, p.pitch / 12);
  const cal = p.caliber;
  const dur = (0.35 + p.tail * 1.5 + cal * 0.45 + p.room * 0.3) * p.length;
  const m = new Float32Array(Math.round(dur * sr));

  // transient crack
  noiseBurst(m, sr, rnd, 0, 0.0012 + 0.0025 * (1 - p.transient), 0.6 + p.transient * 0.9, { type: 'highpass', f: 2200 * pr + rnd() * 600 }, 0.00005);
  // main blast: band-limited noise body
  const bodyF = (700 + (1 - cal) * 1400 + rnd() * 300) * pr;
  noiseBurst(m, sr, rnd, 0.0004, (0.012 + p.punch * 0.03 + cal * 0.02) * p.length, 0.9 + p.punch * 0.5, { type: 'bandpass', f: bodyF, q: 0.55 }, 0.0002);
  noiseBurst(m, sr, rnd, 0.0006, (0.02 + p.punch * 0.025) * p.length, 0.35 * p.noise + 0.15, { type: 'lowpass', f: 5200 * pr }, 0.0003);
  // tonal body thump
  sweptSine(m, sr, 0.0005, (380 + rnd() * 120) * pr, (140 + cal * -40) * pr, 0.006, 0.018 + p.punch * 0.02, 0.45 + p.punch * 0.35);
  // bass layer
  sweptSine(m, sr, 0.001, (150 + rnd() * 30) * pr, (42 + rnd() * 10) * pr, 0.03, (0.035 + p.bass * 0.09 + cal * 0.04) * p.length, p.bass * (0.55 + cal * 0.6), 0.003);
  // mechanical layer (slide cycling)
  if (p.metal > 0.02) {
    const t = 0.004 + rnd() * 0.006;
    metalClick(m, sr, rnd, t, (2400 + rnd() * 2600) * pr, 0.01 + p.metal * 0.025, p.metal * 0.32, 5);
    metalClick(m, sr, rnd, t + 0.028 + rnd() * 0.02, (3200 + rnd() * 2200) * pr, 0.008 + p.metal * 0.015, p.metal * 0.18, 4);
  }
  // tail: low-passed rumbling decay
  if (p.tail > 0.02) {
    const start = 0.012;
    const s = Math.round(start * sr);
    const tau = (0.08 + p.tail * 0.55 + cal * 0.1) * p.length;
    const len = m.length - s;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const fc = 2600 * Math.exp(-t / (tau * 0.6)) + 260;
      const k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += k * ((rnd() * 2 - 1) - lp);
      const env = Math.exp(-t / tau) * Math.min(1, t / 0.01) * (0.8 + 0.2 * Math.sin(t * 37 + rnd() * 0.3));
      m[s + i] += lp * env * p.tail * 0.9;
    }
  }
  return finish(stereoize(m, sr, rnd, p.room, 1 + p.room * 0.3), p.dynamics);
}

function synthSuppressed(p: SynthParams, rnd: Rng): AudioData {
  const sr = SAMPLE_RATE;
  const pr = Math.pow(2, p.pitch / 12);
  const cal = p.caliber;
  const dur = (0.22 + p.tail * 0.5 + cal * 0.15) * p.length;
  const m = new Float32Array(Math.round(dur * sr));
  // "pfft": filtered gas burst
  noiseBurst(m, sr, rnd, 0, (0.012 + p.punch * 0.02) * p.length, 1.0, { type: 'bandpass', f: (650 + rnd() * 500 + (1 - cal) * 500) * pr, q: 0.7 }, 0.0015);
  noiseBurst(m, sr, rnd, 0, 0.0016, 0.25 + p.transient * 0.4, { type: 'highpass', f: 3500 * pr }, 0.0001);
  sweptSine(m, sr, 0.0008, (210 + rnd() * 60) * pr, (70 + rnd() * 20) * pr, 0.012, (0.03 + p.bass * 0.06 + cal * 0.03) * p.length, 0.35 + p.bass * 0.45);
  // slide action is the dominant character of a suppressed pistol
  const tm = 0.012 + rnd() * 0.01;
  metalClick(m, sr, rnd, tm, (2200 + rnd() * 1800) * pr, 0.012 + p.metal * 0.02, 0.35 + p.metal * 0.45, 5);
  metalClick(m, sr, rnd, tm + 0.035 + rnd() * 0.02, (2800 + rnd() * 1800) * pr, 0.01 + p.metal * 0.015, 0.25 + p.metal * 0.3, 4);
  friction(m, sr, rnd, tm + 0.002, 0.03, 4000 * pr, 2200 * pr, 0.12 * p.noise);
  if (p.tail > 0.02) noiseBurst(m, sr, rnd, 0.01, (0.04 + p.tail * 0.12) * p.length, p.tail * 0.3, { type: 'lowpass', f: 900 * pr });
  return finish(stereoize(m, sr, rnd, p.room * 0.6, 1), p.dynamics * 0.7);
}

// ── Reload / mechanical / handling ─────────────────────────────────────────
function synthMech(p: SynthParams, rnd: Rng): AudioData {
  const sr = SAMPLE_RATE;
  const pr = Math.pow(2, p.pitch / 12);
  const L = p.length;
  const metalBase = (1800 + p.metal * 2600 + rnd() * 800) * pr;
  const dark = (900 + rnd() * 500) * pr;
  const clickTau = 0.006 + p.metal * 0.02;
  const lenFor: Record<string, number> = {
    mag_out: 0.32, mag_in: 0.3, mag_drop: 0.55, mag_tap: 0.18, slide_pull: 0.3, slide_release: 0.25, chamber: 0.3,
    mech_click: 0.12, reload_finish: 0.35, reload_fast: 0.75, reload_heavy: 1.35, reload_clean: 1.1, reload_metallic: 1.15,
    reload_tactical: 1.05, draw: 0.45, holster: 0.45, equip: 0.3, inspect: 0.9, trigger: 0.1, dry_fire: 0.18, safety: 0.15,
    mechanical: 0.3, metal_move: 0.4, polymer_move: 0.4, grip: 0.35, mag_handling: 0.45,
  };
  const dur = (lenFor[p.kind] ?? 0.4) * L + 0.08 + p.room * 0.15;
  const m = new Float32Array(Math.round(dur * sr));
  const click = (t: number, amp: number, base = metalBase, tau = clickTau, parts = 4) => metalClick(m, sr, rnd, t * L, base * (0.9 + rnd() * 0.2), tau, amp, parts);
  const fr = (t: number, d: number, f0: number, f1: number, amp: number, q?: number) => friction(m, sr, rnd, t * L, d * L, f0 * pr, f1 * pr, amp * (0.4 + p.noise * 0.8), q);
  const thud = (t: number, f: number, amp: number) => {
    sweptSine(m, sr, t * L, f * 1.6 * pr, f * pr, 0.006, 0.02 + p.bass * 0.04, amp * (0.5 + p.bass));
    noiseBurst(m, sr, rnd, t * L, 0.006, amp * 0.5, { type: 'lowpass', f: dark });
  };
  const magOut = (t: number) => { click(t, 0.5, metalBase * 1.2, clickTau * 0.6); fr(t + 0.015, 0.16, 3200, 1500, 0.35); click(t + 0.19, 0.3, dark * 2); };
  const magIn = (t: number) => { fr(t, 0.11, 1600, 3000, 0.3); thud(t + 0.12, 140, 0.6); click(t + 0.122, 0.75, metalBase); };
  const slidePull = (t: number) => { fr(t, 0.07, 2600, 4200, 0.35, 2); click(t + 0.075, 0.6, metalBase * 1.1); };
  const slideRel = (t: number) => { click(t, 0.95, metalBase * 0.95, clickTau * 1.4, 5); thud(t, 180, 0.35); fr(t + 0.002, 0.03, 4200, 2600, 0.2); };

  switch (p.kind) {
    case 'mag_out': magOut(0.01); break;
    case 'mag_in': magIn(0.01); break;
    case 'mag_drop': { fr(0.01, 0.05, 2000, 1200, 0.2); thud(0.28, 110, 0.9); click(0.282, 0.35, dark * 2.4); thud(0.38, 130, 0.35); click(0.39, 0.18, dark * 2.8); break; }
    case 'mag_tap': { thud(0.01, 150, 0.7); click(0.012, 0.55, metalBase * 0.9); break; }
    case 'slide_pull': slidePull(0.01); break;
    case 'slide_release': slideRel(0.01); break;
    case 'chamber': { slidePull(0.01); slideRel(0.15); break; }
    case 'mech_click': click(0.005, 0.8, metalBase * 1.3, clickTau * 0.5, 3); break;
    case 'reload_finish': { slideRel(0.01); click(0.16, 0.25, metalBase * 1.4, clickTau * 0.5, 3); break; }
    case 'reload_fast': { magOut(0.01); magIn(0.24); slideRel(0.5); break; }
    case 'reload_heavy': { magOut(0.02); thud(0.3, 100, 0.5); magIn(0.55); slidePull(0.95); slideRel(1.06); break; }
    case 'reload_clean': { magOut(0.02); magIn(0.42); slidePull(0.78); slideRel(0.88); break; }
    case 'reload_metallic': { magOut(0.02); click(0.25, 0.3, metalBase * 1.6, clickTau * 2, 5); magIn(0.45); slidePull(0.8); slideRel(0.9); break; }
    case 'reload_tactical': { fr(0.01, 0.1, 1400, 2200, 0.2); magOut(0.08); magIn(0.38); slideRel(0.78); break; }
    case 'draw': { fr(0.01, 0.28, 900, 2600, 0.45, 0.9); click(0.3, 0.45, metalBase); break; }
    case 'holster': { click(0.01, 0.3, metalBase); fr(0.04, 0.26, 2400, 900, 0.4, 0.9); thud(0.31, 120, 0.4); break; }
    case 'equip': { fr(0.01, 0.12, 1500, 2600, 0.3); click(0.14, 0.55, metalBase); break; }
    case 'inspect': { fr(0.01, 0.18, 1200, 2000, 0.25); click(0.22, 0.3, metalBase * 1.2, clickTau * 0.6, 3); fr(0.3, 0.2, 2200, 1300, 0.2); click(0.55, 0.35, metalBase); fr(0.6, 0.18, 1500, 2500, 0.18); break; }
    case 'trigger': click(0.004, 0.55, metalBase * 1.5, clickTau * 0.35, 3); break;
    case 'dry_fire': { click(0.004, 0.9, metalBase * 0.8, clickTau * 1.2, 5); thud(0.004, 220, 0.3); break; }
    case 'safety': { click(0.004, 0.45, metalBase * 1.6, clickTau * 0.3, 3); click(0.045, 0.35, metalBase * 1.8, clickTau * 0.3, 3); break; }
    case 'mechanical': { click(0.005, 0.5, metalBase); fr(0.02, 0.1, 3000, 2000, 0.2); click(0.14, 0.4, metalBase * 1.15); break; }
    case 'metal_move': { fr(0.01, 0.32, 3000, 4500, 0.35, 2.5); click(0.1, 0.15, metalBase * 1.7, clickTau * 2.5, 5); click(0.26, 0.12, metalBase * 1.9, clickTau * 2.5, 5); break; }
    case 'polymer_move': { fr(0.01, 0.32, 700, 1300, 0.45, 0.8); thud(0.3, 200, 0.25); break; }
    case 'grip': { fr(0.01, 0.28, 600, 1600, 0.5, 0.7); fr(0.12, 0.15, 1400, 900, 0.25, 0.7); break; }
    case 'mag_handling': { fr(0.01, 0.2, 1800, 2800, 0.3); click(0.22, 0.4, metalBase); fr(0.26, 0.12, 2800, 1800, 0.2); break; }
    default: click(0.01, 0.5);
  }
  return finish(stereoize(m, sr, rnd, p.room * 0.5, 1), p.dynamics * 0.5, -1.5);
}

// ── Engine 2 ─────────────────────────────────────────────────────────────────
// Layered like a designed game gunshot (crack · mid body · short punch · mechanics · tail · echo),
// mid-focused so shots stay clear on headsets and laptop speakers, a short and tight low end, and
// loudness-matched so every style plays equally loud (clip before limit keeps the transient sharp).

/** Copy of a buffer through a filter (used for echoes). */
function filtered(src: Float32Array, sr: number, type: 'lowpass' | 'highpass' | 'bandpass', f: number, q = 0.707): Float32Array {
  const b = new Float32Array(src);
  biquadProcess(b, biquadCoeffs(type, sr, f, q));
  return b;
}
function saturate(buf: Float32Array, drive: number, asym = 0) {
  const n = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) { const x = buf[i] * drive; buf[i] = (Math.tanh(x + asym * x * x) - Math.tanh(asym * 0)) / n; }
}
function addInto(dst: Float32Array, src: Float32Array, gain: number, offset = 0) {
  for (let i = 0; i < src.length && i + offset < dst.length; i++) dst[i + offset] += src[i] * gain;
}

/** Final stage: remove inaudible rumble, clip before limit, match loudness, limit to -1 dBFS. */
function finish2(a: AudioData, dynamics: number, targetLufs: number, tone?: { profile: BandProfile; amount: number }): AudioData {
  const sr = a.sampleRate;
  for (const ch of a.channels) { biquadProcess(ch, biquadCoeffs('highpass', sr, 24, 0.6)); biquadProcess(ch, biquadCoeffs('highpass', sr, 34, 0.7)); }
  let peak = 0;
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const pre = peak > 0 ? 1 / peak : 1;
  const drive = 1.2 + dynamics * 2.4;
  const norm = Math.tanh(drive);
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(ch[i] * pre * drive) / norm;
  // tone match after the clipper (which adds harmonics), measured on the core of the sound
  if (tone) matchTone(a, tone.profile, tone.amount, 4, 0.2);
  // loudness match: short, peaky shots cannot reach the target by gain alone: each extra pass clips the peaks a little
  // more (density instead of a quieter shot)
  for (let pass = 0; pass < 5; pass++) {
    const l = momentaryMaxLufs(a);
    if (!Number.isFinite(l) || (pass > 0 && targetLufs - l < 0.4)) break;
    const g = Math.pow(10, (targetLufs - l) / 20);
    const clip = pass >= 2 ? 1.25 : 1;
    const nc = Math.tanh(clip);
    for (const ch of a.channels) for (let i = 0; i < ch.length; i++) ch[i] = clip > 1 ? Math.tanh(ch[i] * g * clip) / nc : ch[i] * g;
    limit(a, -1, 45, 1.5);
  }
  const trimmed = trimSilenceEnd(a, Math.round(sr * 0.05), -64);
  const n = trimmed.channels[0].length, f = Math.min(n, Math.round(0.035 * sr));
  for (const ch of trimmed.channels) for (let i = 0; i < f; i++) ch[n - 1 - i] *= i / f;
  return trimmed;
}

/** Stereo: dry core in the centre, tail and echoes decorrelated and wider. */
function stereo2(core: Float32Array, tail: Float32Array, sr: number, rnd: Rng, room: number, width: number, monoSafe = false): AudioData {
  const n = core.length;
  const out = makeAudio(sr, n, 2);
  const [l, r] = out.channels;
  const dR0 = Math.round((0.009 + rnd() * 0.006) * sr);
  const dR = monoSafe ? 0 : dR0; // (rnd() is still drawn, so the other layers stay the same)
  for (let i = 0; i < n; i++) { l[i] = core[i] + tail[i]; r[i] = core[i] + (i >= dR ? tail[i - dR] : 0) * 0.96; }
  if (room > 0.01) {
    const taps = [7, 13, 19, 29, 37, 47].map((ms) => ms * (0.8 + rnd() * 0.4) * (0.7 + room * 0.8));
    taps.forEach((ms, k) => {
      const d = Math.round((ms / 1000) * sr);
      const g = room * 0.32 * Math.pow(0.8, k);
      const tgt = monoSafe ? null : k % 2 ? r : l;
      const src = filtered(core, sr, 'lowpass', 5200 - k * 500);
      if (tgt) for (let i = n - 1; i >= d; i--) tgt[i] += src[i - d] * g;
      else for (let i = n - 1; i >= d; i--) { l[i] += src[i - d] * g * 0.7; r[i] += src[i - d] * g * 0.7; }
    });
  }
  if (width !== 1) for (let i = 0; i < n; i++) { const m = (l[i] + r[i]) / 2, s = ((l[i] - r[i]) / 2) * width; l[i] = m + s; r[i] = m - s; }
  return out;
}

function synthFire2(p: SynthParams, rnd: Rng): AudioData {
  const sr = SAMPLE_RATE;
  const pr = Math.pow(2, p.pitch / 12);
  const cal = p.caliber;
  const echo = p.tail >= 0.6; // outdoor slap-back only for roomy styles (Realistic, Heavy, Deep, Echo)
  const slaps = Math.max(0, Math.min(1, p.slaps ?? 0));
  const dur = (0.22 + p.tail * 0.55 + cal * 0.2 + p.room * 0.15 + (echo ? 0.35 + p.tail * 0.3 : 0)) * p.length + 0.05 + (slaps > 0 ? 0.45 + slaps * 0.35 : 0);
  const n = Math.round(dur * sr);
  const core = new Float32Array(n);
  const tail = new Float32Array(n);

  // 1 · crack: a sub-millisecond pressure snap + bright noise spit (what makes a shot "cracky")
  const crack = new Float32Array(Math.round(0.012 * sr));
  const nd = Math.max(4, Math.round((0.00022 + cal * 0.00025) * sr));
  for (let i = 0; i < nd; i++) crack[i] = 1 - (2 * i) / nd;
  biquadProcess(crack, biquadCoeffs('highpass', sr, 1200 * pr, 0.7));
  noiseBurst(crack, sr, rnd, 0, 0.0007 + (1 - p.transient) * 0.0016, 0.55 + p.noise * 0.35, { type: 'highpass', f: (2600 + rnd() * 1400) * pr }, 0.00003);
  addInto(core, crack, 0.55 + p.transient * 0.85);
  // optional: the bright, ringing snap of a supersonic bullet (a few damped high partials, very short)
  if ((p.ring ?? 0) > 0.01) {
    const rg = new Float32Array(Math.round(0.03 * sr));
    const rr = mulberry32(p.seed * 7 + 3);
    for (const [f, a, tau] of [[4300, 1, 0.0035], [6100, 0.7, 0.0026], [8200, 0.45, 0.0018]] as const) {
      const ff = f * pr * (0.94 + rr() * 0.12), ph = rr() * Math.PI * 2;
      for (let i = 0; i < rg.length; i++) rg[i] += Math.sin(ph + (2 * Math.PI * ff * i) / sr) * Math.exp(-i / (tau * sr)) * a;
    }
    addInto(core, rg, (p.ring ?? 0) * 0.35);
  }

  // 2 · body: mid-focused blast (carries the shot on small speakers), plus a chest band, then saturated
  const body = new Float32Array(Math.round(0.25 * sr));
  const bodyF = (1050 + (1 - cal) * 900 + rnd() * 300) * pr;
  noiseBurst(body, sr, rnd, 0.0002, (0.009 + p.punch * 0.016 + cal * 0.012) * p.length, 1.0, { type: 'bandpass', f: bodyF, q: 0.65 }, 0.00025);
  noiseBurst(body, sr, rnd, 0.0004, (0.014 + p.punch * 0.02 + cal * 0.016) * p.length, 0.62 + p.punch * 0.35, { type: 'bandpass', f: (320 + rnd() * 110 - cal * 70) * pr, q: 0.8 }, 0.0004);
  noiseBurst(body, sr, rnd, 0.0002, 0.0035 + p.noise * 0.003, 0.18 + p.noise * 0.3, { type: 'highpass', f: 4300 * pr }, 0.0001);
  saturate(body, 1.6 + p.punch * 1.4);
  addInto(core, body, 1.15);

  // 3 · punch: short pitched thump; asymmetric saturation adds harmonics (audible without a subwoofer)
  const thump = new Float32Array(Math.round(0.3 * sr));
  sweptSine(thump, sr, 0.0006, (230 + rnd() * 40) * pr, (112 - cal * 30) * pr, 0.006, (0.014 + p.bass * 0.018 + cal * 0.014) * p.length, 1, 0.0012);
  saturate(thump, 2.2, 0.3);
  addInto(core, thump, 0.2 + p.bass * 0.3 + cal * 0.1);

  // 4 · sub: only for heavy styles / big calibre, short and tight
  const subAmt = Math.max(0, p.bass - 0.6) * 0.7 + Math.max(0, cal - 0.75) * 0.5;
  if (subAmt > 0.02) sweptSine(core, sr, 0.0015, 90 * pr, 55 * pr, 0.015, (0.03 + subAmt * 0.04) * p.length, subAmt * 0.35, 0.003);

  // 5 · mechanics: slide clack + return, and a faint brass ping for metallic styles
  if (p.metal > 0.02) {
    const t = 0.006 + rnd() * 0.006;
    metalClick(core, sr, rnd, t, (2300 + rnd() * 1800) * pr, 0.006 + p.metal * 0.011, p.metal * 0.36, 4);
    metalClick(core, sr, rnd, t + 0.028 + rnd() * 0.016, (3000 + rnd() * 2000) * pr, 0.005 + p.metal * 0.01, p.metal * 0.24, 4);
    if (p.metal > 0.45 && n > 0.32 * sr) metalClick(core, sr, rnd, 0.17 + rnd() * 0.12, (5200 + rnd() * 1400) * pr, 0.025, (p.metal - 0.45) * 0.05, 3);
  }

  // 6 · tail: separated from the body by a short fade-in, bright at first, then dark
  if (p.tail > 0.02) {
    const s = Math.round(0.006 * sr);
    const tau = (0.045 + p.tail * 0.3 + cal * 0.05) * p.length;
    const fadeIn = 0.022;
    let lp = 0;
    for (let i = 0; s + i < n; i++) {
      const t = i / sr;
      const fc = 2900 * Math.exp(-t / (tau * 0.55)) + 320;
      const k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += k * ((rnd() * 2 - 1) - lp);
      const env = Math.exp(-t / tau) * Math.sin(Math.min(1, t / fadeIn) * Math.PI / 2);
      tail[s + i] += lp * env * p.tail * 0.62;
    }
  }

  // 7 · outdoor echo (RP "slap" off buildings): band-limited, delayed copies of the core
  if (echo) {
    const d1 = Math.round((0.11 + rnd() * 0.06 + cal * 0.03) * sr);
    const d2 = Math.round(d1 * (1.75 + rnd() * 0.3));
    const slap = filtered(filtered(core, sr, 'lowpass', 1900 * pr), sr, 'highpass', 160);
    const g1 = (p.tail - 0.45) * 0.75;
    addInto(tail, slap, g1, d1);
    addInto(tail, filtered(slap, sr, 'lowpass', 1200 * pr), g1 * 0.42, d2);
  }

  // 8 · optional city echo: three darker slaps off buildings at different distances (identical in both channels)
  if (slaps > 0) {
    const rr = mulberry32(p.seed * 13 + 5);
    const src = filtered(filtered(core, sr, 'lowpass', 2300 * pr), sr, 'highpass', 150);
    const times = [0.13 + rr() * 0.05, 0.27 + rr() * 0.08, 0.46 + rr() * 0.1];
    times.forEach((t, k) => {
      const tap = k ? filtered(src, sr, 'lowpass', (1700 - k * 450) * pr) : src;
      addInto(tail, tap, slaps * [0.5, 0.3, 0.17][k], Math.round(t * sr * (0.85 + cal * 0.3)));
    });
  }

  // pull the sound toward the measured pack balance (full strength for the pack styles, a nudge otherwise)
  const target = -9.5 + (p.dynamics - 0.5) * 1.6;
  return finish2(stereo2(core, tail, sr, rnd, p.room, p.monoSafe ? 1 : 1 + p.room * 0.35, p.monoSafe), p.dynamics, target, { profile: TONE_PROFILES[p.tone ?? 'balanced'], amount: p.tone ? 1 : 0.5 });
}

function synthSuppressed2(p: SynthParams, rnd: Rng): AudioData {
  const sr = SAMPLE_RATE;
  const pr = Math.pow(2, p.pitch / 12);
  const cal = p.caliber;
  const dur = (0.2 + p.tail * 0.3 + cal * 0.08) * p.length + 0.04;
  const n = Math.round(dur * sr);
  const core = new Float32Array(n);
  const tail = new Float32Array(n);
  // gas "pfft": mid band, soft attack, plus a little hiss
  noiseBurst(core, sr, rnd, 0, (0.011 + p.punch * 0.016) * p.length, 1.0, { type: 'bandpass', f: (780 + rnd() * 420 + (1 - cal) * 380) * pr, q: 0.75 }, 0.0012);
  noiseBurst(core, sr, rnd, 0.0005, (0.016 + p.punch * 0.012) * p.length, 0.45, { type: 'bandpass', f: (360 + rnd() * 100) * pr, q: 0.9 }, 0.0015);
  noiseBurst(core, sr, rnd, 0, 0.0012, 0.15 + p.transient * 0.3, { type: 'highpass', f: 3600 * pr }, 0.0001);
  // low thud – short
  const th = new Float32Array(Math.round(0.2 * sr));
  sweptSine(th, sr, 0.0008, (190 + rnd() * 40) * pr, (75 - cal * 12) * pr, 0.01, (0.022 + p.bass * 0.03 + cal * 0.015) * p.length, 1, 0.002);
  saturate(th, 1.6, 0.2);
  addInto(core, th, 0.3 + p.bass * 0.35);
  // the slide is what you hear most on a suppressed pistol
  const tm = 0.011 + rnd() * 0.008;
  metalClick(core, sr, rnd, tm, (2300 + rnd() * 1700) * pr, 0.01 + p.metal * 0.016, 0.4 + p.metal * 0.45, 5);
  metalClick(core, sr, rnd, tm + 0.033 + rnd() * 0.016, (2900 + rnd() * 1700) * pr, 0.008 + p.metal * 0.012, 0.28 + p.metal * 0.3, 4);
  friction(core, sr, rnd, tm + 0.002, 0.028, 4200 * pr, 2400 * pr, 0.1 * p.noise);
  if (p.tail > 0.02) noiseBurst(tail, sr, rnd, 0.012, (0.035 + p.tail * 0.09) * p.length, p.tail * 0.32, { type: 'lowpass', f: 1100 * pr }, 0.01);
  return finish2(stereo2(core, tail, sr, rnd, p.room * 0.5, 1, p.monoSafe), p.dynamics * 0.6, -13 + (p.dynamics - 0.5));
}

export function synthesize(p: SynthParams): AudioData {
  const rnd = mulberry32(p.seed * 9301 + 49297);
  if ((p.engine ?? 1) >= 2) {
    if (p.kind === 'fire') return synthFire2(p, rnd);
    if (p.kind === 'suppressed') return synthSuppressed2(p, rnd);
    // reloads / handling: same layers as engine 1, but loudness-matched like the shots
    return finish2(synthMech(p, rnd), 0.2, -15, { profile: TONE_PROFILES.reload, amount: 1 });
  }
  if (p.kind === 'fire') return synthFire(p, rnd);
  if (p.kind === 'suppressed') return synthSuppressed(p, rnd);
  return synthMech(p, rnd);
}

/** Smart Randomize (spec §56): controlled variation around the current params. */
export function smartRandomize(p: SynthParams, amount = 0.25, seed = Date.now()): SynthParams {
  const r = mulberry32(seed);
  const j = (v: number) => Math.min(1, Math.max(0, v + (r() * 2 - 1) * amount));
  return {
    ...p,
    seed: Math.floor(r() * 1e9),
    pitch: Math.max(-12, Math.min(12, p.pitch + (r() * 2 - 1) * amount * 4)),
    transient: j(p.transient), bass: j(p.bass), tail: j(p.tail), punch: j(p.punch), metal: j(p.metal),
  };
}
