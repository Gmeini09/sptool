// Non-destructive edit model. The original asset is never touched: an EditState
// is pure data (JSON), rendered on demand (preview) or at export/build time.
import { analyze, momentaryMaxLufs } from './analysis';
import { applyBiquad } from './biquad';
import { compress, hardClip, limit, noiseGate, softClip, transientShape } from './dynamics';
import { delay, reverb, stereoWidth, toMono } from './effects';
import { addThump, excite, slapEcho } from './layers';
import { matchTone } from './spectrum';
import { changeSpeed, pitchShift } from './stretch';
import { TONE_PROFILES, type ToneName } from '../synth/synth';
import { type AudioData, dbToGain, lengthOf, toStereo } from './types';

export interface Region { start: number; end: number }
export interface PeqBand { enabled: boolean; type: 'peaking' | 'lowshelf' | 'highshelf'; freq: number; gain: number; q: number }

export interface EditState {
  /** seconds, in original timeline */
  trimStart: number;
  trimEnd: number | null;
  /** regions removed from the original timeline */
  cuts: Region[];
  fadeIn: number;
  fadeOut: number;
  gainDb: number;
  normalize: { enabled: boolean; targetDb: number };
  pitch: number;
  speed: number;
  eq: { bass: number; mid: number; treble: number };
  peq: PeqBand[];
  highpass: { enabled: boolean; freq: number };
  lowpass: { enabled: boolean; freq: number };
  noise: { enabled: boolean; threshold: number };
  transient: { enabled: boolean; attack: number; sustain: number };
  compressor: { enabled: boolean; threshold: number; ratio: number; attack: number; release: number; makeup: number };
  delay: { enabled: boolean; time: number; feedback: number; mix: number };
  reverb: { enabled: boolean; room: number; damping: number; mix: number };
  width: number;
  mono: boolean;
  /** Loudness stage before clip/limit. match: keep the source's loudness (+ target as offset in dB);
   *  target: absolute loudness (target in LUFS, loudest 400 ms). Optional for edits saved before it existed. */
  loudness?: { enabled: boolean; mode: 'match' | 'target'; target: number };
  /** Optional stages (added in 1.7.4 – older saved edits do not have them). */
  /** Pulls the spectral balance toward a measured soundpack balance (see TONE_PROFILES). amount 0..1 */
  tone?: { enabled: boolean; profile: ToneName; amount: number };
  /** Harmonic exciter above `freq` – more crack and bite. amount 0..1 */
  exciter?: { enabled: boolean; freq: number; amount: number };
  /** Short pitched punch layer on the hit. freq in Hz, amount 0..1 */
  thump?: { enabled: boolean; freq: number; amount: number };
  /** City slap-back echo off buildings (mono-safe). time in ms, mix 0..1 */
  slap?: { enabled: boolean; time: number; mix: number };
  softClip: { enabled: boolean; drive: number };
  limiter: { enabled: boolean; ceiling: number };
  hardLimit: { enabled: boolean; ceiling: number };
}

export const DEFAULT_EDIT: EditState = {
  trimStart: 0,
  trimEnd: null,
  cuts: [],
  fadeIn: 0,
  fadeOut: 0,
  gainDb: 0,
  normalize: { enabled: false, targetDb: -1 },
  pitch: 0,
  speed: 1,
  eq: { bass: 0, mid: 0, treble: 0 },
  peq: [
    { enabled: false, type: 'peaking', freq: 120, gain: 0, q: 1 },
    { enabled: false, type: 'peaking', freq: 900, gain: 0, q: 1 },
    { enabled: false, type: 'peaking', freq: 4000, gain: 0, q: 1 },
  ],
  highpass: { enabled: false, freq: 40 },
  lowpass: { enabled: false, freq: 16000 },
  noise: { enabled: false, threshold: -55 },
  transient: { enabled: false, attack: 0, sustain: 0 },
  compressor: { enabled: false, threshold: -18, ratio: 4, attack: 3, release: 80, makeup: 0 },
  delay: { enabled: false, time: 120, feedback: 0.25, mix: 0.2 },
  reverb: { enabled: false, room: 0.4, damping: 0.5, mix: 0.15 },
  width: 1,
  mono: false,
  loudness: { enabled: false, mode: 'match', target: 0 },
  tone: { enabled: false, profile: 'balanced', amount: 0.6 },
  exciter: { enabled: false, freq: 3000, amount: 0.3 },
  thump: { enabled: false, freq: 85, amount: 0.35 },
  slap: { enabled: false, time: 150, mix: 0.3 },
  softClip: { enabled: false, drive: 0.3 },
  limiter: { enabled: false, ceiling: -1 },
  hardLimit: { enabled: false, ceiling: -0.3 },
};

export function freshEdit(): EditState {
  return JSON.parse(JSON.stringify(DEFAULT_EDIT));
}

export type EditPatch = { [K in keyof EditState]?: EditState[K] extends object ? Partial<EditState[K]> | EditState[K] : EditState[K] };

export function mergeEdit(base: EditState, patch: EditPatch): EditState {
  const out: any = JSON.parse(JSON.stringify(base));
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null) out[k] = { ...out[k], ...v };
    else out[k] = v;
  }
  return out;
}

export function isDefaultEdit(e: EditState): boolean {
  return JSON.stringify(e) === JSON.stringify(DEFAULT_EDIT);
}

/** Applies trim + cuts on the original timeline. */
export function applyRegions(a: AudioData, e: EditState): AudioData {
  const sr = a.sampleRate;
  const n = lengthOf(a);
  const s0 = Math.max(0, Math.min(n, Math.round(e.trimStart * sr)));
  const s1 = e.trimEnd == null ? n : Math.max(s0, Math.min(n, Math.round(e.trimEnd * sr)));
  const cuts = e.cuts
    .map((c) => ({ s: Math.round(Math.min(c.start, c.end) * sr), e: Math.round(Math.max(c.start, c.end) * sr) }))
    .filter((c) => c.e > c.s)
    .sort((x, y) => x.s - y.s);
  const keep: Array<[number, number]> = [];
  let pos = s0;
  for (const c of cuts) {
    if (c.e <= pos || c.s >= s1) continue;
    if (c.s > pos) keep.push([pos, Math.min(c.s, s1)]);
    pos = Math.max(pos, c.e);
  }
  if (pos < s1) keep.push([pos, s1]);
  const total = keep.reduce((p, [x, y]) => p + (y - x), 0);
  const channels = a.channels.map((ch) => {
    const out = new Float32Array(total);
    let o = 0;
    for (const [x, y] of keep) { out.set(ch.subarray(x, y), o); o += y - x; }
    return out;
  });
  // 2 ms de-click fades at every splice
  const fade = Math.round(0.002 * sr);
  let off = 0;
  for (let k = 0; k < keep.length; k++) {
    const len = keep[k][1] - keep[k][0];
    for (const ch of channels) {
      if (k > 0) for (let i = 0; i < fade && i < len; i++) ch[off + i] *= i / fade;
      if (k < keep.length - 1) for (let i = 0; i < fade && i < len; i++) ch[off + len - 1 - i] *= i / fade;
    }
    off += len;
  }
  return { sampleRate: sr, channels };
}

function applyFades(a: AudioData, fadeIn: number, fadeOut: number) {
  const n = lengthOf(a);
  const fi = Math.min(n, Math.round(fadeIn * a.sampleRate));
  const fo = Math.min(n, Math.round(fadeOut * a.sampleRate));
  for (const ch of a.channels) {
    for (let i = 0; i < fi; i++) ch[i] *= Math.sin(((i / fi) * Math.PI) / 2) ** 2;
    for (let i = 0; i < fo; i++) ch[n - 1 - i] *= Math.sin(((i / fo) * Math.PI) / 2) ** 2;
  }
}

/** Renders original + edit → new audio. Pure; never mutates `src`. */
export function renderEdit(src: AudioData, e: EditState): AudioData {
  let a = toStereo(applyRegions(src, e));
  if (lengthOf(a) === 0) return a;
  const srcLoudness = e.loudness?.enabled && e.loudness.mode === 'match' ? momentaryMaxLufs(a) : 0;
  if (Math.abs(e.speed - 1) > 1e-3) a = changeSpeed(a, e.speed);
  if (Math.abs(e.pitch) > 0.01) a = pitchShift(a, e.pitch);
  if (e.highpass.enabled) { applyBiquad(a, 'highpass', e.highpass.freq, 0.707); applyBiquad(a, 'highpass', e.highpass.freq, 0.707); }
  if (e.lowpass.enabled) { applyBiquad(a, 'lowpass', e.lowpass.freq, 0.707); applyBiquad(a, 'lowpass', e.lowpass.freq, 0.707); }
  if (e.eq.bass) applyBiquad(a, 'lowshelf', 120, 0.707, e.eq.bass);
  if (e.eq.mid) applyBiquad(a, 'peaking', 1000, 0.8, e.eq.mid);
  if (e.eq.treble) applyBiquad(a, 'highshelf', 6000, 0.707, e.eq.treble);
  for (const b of e.peq) if (b.enabled && b.gain) applyBiquad(a, b.type, b.freq, b.q, b.gain);
  const opt = <K extends 'tone' | 'exciter' | 'thump' | 'slap'>(k: K) => (e[k]?.enabled ? { ...DEFAULT_EDIT[k]!, ...e[k] } as NonNullable<EditState[K]> : null);
  const tone = opt('tone'), exc = opt('exciter'), thump = opt('thump'), slap = opt('slap');
  if (e.noise.enabled) noiseGate(a, e.noise.threshold);
  if (e.transient.enabled) transientShape(a, e.transient.attack, e.transient.sustain);
  if (thump) addThump(a, Math.max(40, Math.min(250, thump.freq)), Math.max(0, Math.min(1, thump.amount)));
  if (e.compressor.enabled) compress(a, { ...e.compressor, knee: 6 });
  // tone match after the dynamics (they change the balance), then the exciter adds harmonics on top
  if (tone && TONE_PROFILES[tone.profile]) matchTone(a, TONE_PROFILES[tone.profile], Math.max(0, Math.min(1, tone.amount)), 4, 0.3);
  if (exc) excite(a, Math.max(800, Math.min(12000, exc.freq)), Math.max(0, Math.min(1, exc.amount)));
  if (slap) a = slapEcho(a, Math.max(40, Math.min(600, slap.time)), Math.max(0, Math.min(1, slap.mix)));
  if (e.delay.enabled) a = delay(a, e.delay.time, e.delay.feedback, e.delay.mix);
  if (e.reverb.enabled) a = reverb(a, e.reverb.room, e.reverb.damping, e.reverb.mix);
  if (e.mono) toMono(a); else if (Math.abs(e.width - 1) > 1e-3) stereoWidth(a, e.width);
  if (e.gainDb) { const g = dbToGain(e.gainDb); for (const ch of a.channels) for (let i = 0; i < ch.length; i++) ch[i] *= g; }
  if (e.normalize.enabled) normalizePeak(a, e.normalize.targetDb);
  const want = e.loudness?.enabled ? (e.loudness.mode === 'match' ? srcLoudness + e.loudness.target : e.loudness.target) : NaN;
  const toLoudness = () => {
    const now = momentaryMaxLufs(a);
    if (!Number.isFinite(want) || !Number.isFinite(now)) return;
    const g = dbToGain(Math.max(-24, Math.min(24, want - now)));
    for (const ch of a.channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  };
  if (Number.isFinite(want)) toLoudness();
  if (e.softClip.enabled) softClip(a, e.softClip.drive);
  if (e.limiter.enabled) limit(a, e.limiter.ceiling);
  // the limiter takes some loudness back from peaky sounds – correct once more, then limit again
  // (very peaky sounds: a gentle clip before the limiter instead of ending up quieter)
  if (Number.isFinite(want) && e.limiter.enabled) for (let i = 0; i < 4; i++) {
    const d = want - momentaryMaxLufs(a);
    if (!(Math.abs(d) > 0.4)) break;
    if (d > 0 && i > 0) softClip(a, 0.12);
    toLoudness(); limit(a, e.limiter.ceiling);
  }
  if (e.hardLimit.enabled) hardClip(a, e.hardLimit.ceiling);
  if (e.fadeIn > 0 || e.fadeOut > 0) applyFades(a, e.fadeIn, e.fadeOut);
  return a;
}

export function normalizePeak(a: AudioData, targetDb: number): void {
  let peak = 0;
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
  if (peak < 1e-9) return;
  const g = dbToGain(targetDb) / peak;
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

/** "Auto Fix" for clipping: enables a -1 dBTP-ish limiter and pulls gain down slightly. */
export function clippingFix(e: EditState, src: AudioData): EditState {
  const r = analyze(renderEdit(src, e));
  if (!r.clipping && r.peakDb <= -0.1) return e;
  return mergeEdit(e, { limiter: { enabled: true, ceiling: -1 }, gainDb: e.gainDb - Math.max(0, r.peakDb + 1) * 0.5 });
}

// ── Suppressor derivation (internal, not shown to users) ─────────────────────
// Makes a suppressed variant from a normal shot for the suppressor slot, so the attachment never falls back to
// the original game sound. Ends with a loudness stage like every processing step that changes the character.
const LOUD = (offsetDb = 0) => ({ loudness: { enabled: true, mode: 'match' as const, target: offsetDb }, limiter: { enabled: true, ceiling: -1 } });
export const SUPPRESSOR_DERIVE: EditPatch = { lowpass: { enabled: true, freq: 2400 }, highpass: { enabled: true, freq: 70 }, transient: { enabled: true, attack: -6, sustain: -10 }, eq: { bass: 2, mid: -2, treble: -6 }, fadeOut: 0.12, ...LOUD(-4) };
