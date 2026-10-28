// Dynamics processors: compressor, limiter, transient shaper, gate, clippers.
import { type AudioData, dbToGain, gainToDb, lengthOf } from './types';

const coef = (ms: number, sr: number) => Math.exp(-1 / Math.max(1, (ms / 1000) * sr));

export interface CompressorOpts { threshold: number; ratio: number; attack: number; release: number; knee: number; makeup: number }

/** Feed-forward stereo-linked compressor with soft knee (dB domain). */
export function compress(a: AudioData, o: CompressorOpts): void {
  const n = lengthOf(a);
  const aC = coef(o.attack, a.sampleRate);
  const rC = coef(o.release, a.sampleRate);
  const makeup = dbToGain(o.makeup);
  const knee = Math.max(0, o.knee);
  let env = 0;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of a.channels) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
    const lvl = gainToDb(peak);
    const over = lvl - o.threshold;
    let gr = 0;
    if (2 * over < -knee) gr = 0;
    else if (2 * Math.abs(over) <= knee && knee > 0) gr = ((1 / o.ratio - 1) * (over + knee / 2) ** 2) / (2 * knee);
    else gr = over * (1 / o.ratio - 1);
    // gr is negative (reduction). Smooth: attack when reduction increases.
    const target = -gr;
    env = target > env ? aC * env + (1 - aC) * target : rC * env + (1 - rC) * target;
    const g = dbToGain(-env) * makeup;
    for (const ch of a.channels) ch[i] *= g;
  }
}

/** Look-ahead peak limiter. Guarantees |x| <= ceiling. */
export function limit(a: AudioData, ceilingDb: number, releaseMs = 60, lookaheadMs = 1.5): void {
  const n = lengthOf(a);
  const ceiling = dbToGain(ceilingDb);
  const la = Math.max(1, Math.round((lookaheadMs / 1000) * a.sampleRate));
  const rC = coef(releaseMs, a.sampleRate);
  // required gain per sample
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of a.channels) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
    req[i] = peak > ceiling ? ceiling / peak : 1;
  }
  // min over look-ahead window, then smooth release
  const gain = new Float32Array(n);
  let g = 1;
  for (let i = 0; i < n; i++) {
    let m = 1;
    const end = Math.min(n, i + la);
    for (let j = i; j < end; j++) if (req[j] < m) m = req[j];
    g = m < g ? m : rC * g + (1 - rC) * m;
    if (g > m) g = Math.min(g, 1);
    gain[i] = Math.min(g, req[i]);
  }
  for (const ch of a.channels) for (let i = 0; i < n; i++) {
    let v = ch[i] * gain[i];
    if (v > ceiling) v = ceiling; else if (v < -ceiling) v = -ceiling;
    ch[i] = v;
  }
}

/** Differential-envelope transient shaper. attack/sustain in dB (-24..+24). */
export function transientShape(a: AudioData, attackDb: number, sustainDb: number): void {
  const n = lengthOf(a);
  const fast = coef(1, a.sampleRate), fastR = coef(20, a.sampleRate);
  const slow = coef(25, a.sampleRate), slowR = coef(200, a.sampleRate);
  let ef = 0, es = 0;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of a.channels) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
    ef = peak > ef ? fast * ef + (1 - fast) * peak : fastR * ef + (1 - fastR) * peak;
    es = peak > es ? slow * es + (1 - slow) * peak : slowR * es + (1 - slowR) * peak;
    const diff = ef - es; // >0 during attacks
    const norm = ef > 1e-6 ? Math.max(-1, Math.min(1, diff / ef)) : 0;
    const db = norm > 0 ? attackDb * norm : sustainDb * Math.min(1, -norm * 2 + 0.25);
    const g = dbToGain(db);
    for (const ch of a.channels) ch[i] *= g;
  }
}

/** Downward expander used as gate-based noise reduction. threshold in dBFS, range in dB. */
export function noiseGate(a: AudioData, thresholdDb: number, rangeDb = 30): void {
  const n = lengthOf(a);
  const aC = coef(0.5, a.sampleRate), rC = coef(80, a.sampleRate);
  const thr = dbToGain(thresholdDb);
  const floor = dbToGain(-Math.abs(rangeDb));
  let env = 0, g = 1;
  const gs = coef(5, a.sampleRate);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of a.channels) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
    env = peak > env ? aC * env + (1 - aC) * peak : rC * env + (1 - rC) * peak;
    const target = env >= thr ? 1 : Math.max(floor, (env / thr) ** 2);
    g = gs * g + (1 - gs) * target;
    for (const ch of a.channels) ch[i] *= g;
  }
}

export function softClip(a: AudioData, drive: number): void {
  const d = 1 + Math.max(0, drive) * 4;
  const norm = Math.tanh(d);
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(ch[i] * d) / norm;
}

export function hardClip(a: AudioData, ceilingDb: number): void {
  const c = dbToGain(ceilingDb);
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) {
    const v = ch[i];
    ch[i] = v > c ? c : v < -c ? -c : v;
  }
}
