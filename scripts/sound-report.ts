// Measures the built-in fire / suppressor sounds.
//   npx tsx scripts/sound-report.ts [out.json]
// Per sound: peak, integrated LUFS, short-term "punch" loudness (first 60 ms), crest factor,
// duration until -50 dB, spectral balance in bands, stereo correlation.
import { writeFileSync } from 'node:fs';
import { builtinCatalog } from '../src/library/catalog';
import { synthesize } from '../src/synth/synth';
import { integratedLufs } from '../src/dsp/analysis';
import type { AudioData } from '../src/dsp/types';

const BANDS: Array<[string, number, number]> = [['sub', 20, 80], ['low', 80, 250], ['lowmid', 250, 800], ['mid', 800, 2500], ['presence', 2500, 6000], ['air', 6000, 16000]];

function fftMag(x: Float32Array): Float32Array {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)));
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const out = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  return out;
}

export function measure(a: AudioData) {
  const sr = a.sampleRate, [l, r] = a.channels.length > 1 ? a.channels : [a.channels[0], a.channels[0]];
  const n = l.length;
  const mono = new Float32Array(n);
  let peak = 0, ss = 0, lr = 0, ll = 0, rr = 0;
  for (let i = 0; i < n; i++) { mono[i] = (l[i] + r[i]) / 2; peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i])); ss += mono[i] ** 2; lr += l[i] * r[i]; ll += l[i] ** 2; rr += r[i] ** 2; }
  const db = (v: number) => (v <= 1e-12 ? -120 : 20 * Math.log10(v));
  const head = Math.min(n, Math.round(0.06 * sr));
  let hs = 0; for (let i = 0; i < head; i++) hs += mono[i] ** 2;
  // length until the envelope stays below -50 dBFS
  let last = 0; const thr = 10 ** (-50 / 20);
  for (let i = 0; i < n; i++) if (Math.abs(mono[i]) > thr) last = i;
  const spec = fftMag(mono.subarray(0, Math.min(n, Math.round(0.4 * sr))));
  const binHz = sr / (spec.length * 2);
  const bandE = BANDS.map(([, f0, f1]) => { let e = 0; for (let k = Math.floor(f0 / binHz); k < Math.min(spec.length, f1 / binHz); k++) e += spec[k]; return e; });
  const tot = bandE.reduce((p, v) => p + v, 0) || 1;
  return {
    peakDb: +db(peak).toFixed(1),
    lufs: +integratedLufs(a).toFixed(1),
    punchDb: +db(Math.sqrt(hs / head)).toFixed(1), // RMS of the first 60 ms
    crestDb: +(db(peak) - db(Math.sqrt(ss / n))).toFixed(1),
    lengthMs: Math.round((last / sr) * 1000),
    corr: +(lr / Math.sqrt(ll * rr || 1)).toFixed(2),
    bands: Object.fromEntries(BANDS.map(([name], i) => [name, Math.round((bandE[i] / tot) * 100)])),
  };
}

if (process.argv[1]?.endsWith('sound-report.ts')) {
  const cat = builtinCatalog();
  const rows: Record<string, unknown>[] = [];
  for (const e of cat) {
    if (e.type !== 'fire' && e.type !== 'suppressor') continue;
    if (!e.id.endsWith('-1')) continue; // variant 1 of every style/weapon
    rows.push({ id: e.id, style: e.style, weapon: e.weapon, type: e.type, ...measure(synthesize(e.synth!)) });
  }
  const out = process.argv[2] || 'sound-report.json';
  writeFileSync(out, JSON.stringify(rows, null, 1));
  const avg = (k: string, f: (r: any) => boolean) => { const v = rows.filter(f).map((r: any) => r[k]); return +(v.reduce((a: number, b: number) => a + b, 0) / v.length).toFixed(1); };
  console.log('fire: lufs', avg('lufs', (r: any) => r.type === 'fire'), 'punch', avg('punchDb', (r: any) => r.type === 'fire'), 'crest', avg('crestDb', (r: any) => r.type === 'fire'), 'len', avg('lengthMs', (r: any) => r.type === 'fire'));
  console.table(rows.filter((r: any) => r.type !== 'suppressor' && r.weapon === 'pistol_mk2').map((r: any) => ({ id: r.id.replace('bi-fire-pistol_mk2-', ''), lufs: r.lufs, punch: r.punchDb, crest: r.crestDb, ms: r.lengthMs, corr: r.corr, ...r.bands })));
}
