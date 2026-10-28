// Spectral balance in six bands and an automatic tone match toward a target balance.
// Targets are plain numbers (percent of energy per band), e.g. measured from reference packs –
// no audio of a reference is ever used or stored.
import { biquadCoeffs, biquadProcess } from './biquad';
import type { AudioData } from './types';

export const BANDS = [['sub', 20, 80], ['low', 80, 250], ['lowmid', 250, 800], ['mid', 800, 2500], ['presence', 2500, 6000], ['air', 6000, 16000]] as const;
export type BandName = (typeof BANDS)[number][0];
export type BandProfile = Record<BandName, number>;

function powerSpectrum(x: Float32Array): Float64Array {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, x.length - 1)));
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const out = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  return out;
}

/** Percent of energy per band, measured over the first `seconds` (the part that defines a shot). */
export function bandProfile(a: AudioData, seconds = 0.4): BandProfile {
  const n = Math.min(a.channels[0].length, Math.round(seconds * a.sampleRate));
  const mono = new Float32Array(n);
  for (const ch of a.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / a.channels.length;
  const p = powerSpectrum(mono);
  const bin = a.sampleRate / (p.length * 2);
  const e = BANDS.map(([, f0, f1]) => { let s = 0; for (let k = Math.floor(f0 / bin); k < Math.min(p.length, f1 / bin); k++) s += p[k]; return s; });
  const tot = e.reduce((x, y) => x + y, 0) || 1;
  return Object.fromEntries(BANDS.map(([name], i) => [name, (e[i] / tot) * 100])) as BandProfile;
}

// one filter per band: shelves at the ends, peaks in between
const FILTERS: Record<BandName, { type: 'lowshelf' | 'peaking' | 'highshelf'; f: number; q: number }> = {
  sub: { type: 'lowshelf', f: 70, q: 0.7 },
  low: { type: 'peaking', f: 150, q: 0.9 },
  lowmid: { type: 'peaking', f: 450, q: 0.8 },
  mid: { type: 'peaking', f: 1400, q: 0.8 },
  presence: { type: 'peaking', f: 3900, q: 0.8 },
  air: { type: 'highshelf', f: 7500, q: 0.7 },
};

/** Moves the sound's spectral balance toward `target` (in place). `amount` 0..1, gains limited to ±9 dB per band. */
export function matchTone(a: AudioData, target: BandProfile, amount = 1, passes = 3, seconds = 0.4): void {
  for (let pass = 0; pass < passes; pass++) {
    const cur = bandProfile(a, seconds);
    for (const [name] of BANDS) {
      const t = Math.max(0.3, target[name]), c = Math.max(0.3, cur[name]);
      const db = Math.max(-9, Math.min(9, 10 * Math.log10(t / c))) * 0.7 * amount;
      if (Math.abs(db) < 0.3) continue;
      const f = FILTERS[name];
      for (const ch of a.channels) biquadProcess(ch, biquadCoeffs(f.type, a.sampleRate, f.f, f.q, db));
    }
  }
}
