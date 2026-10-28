// Measures the character of reference soundpacks WITHOUT keeping any of their audio:
// only numbers (spectral balance, attack, decay, echo, mechanic timing) are written out.
//   npx tsx scripts/analyze-refs.ts out.json pack1.rpf pack2.rpf …
// Streams that differ between packs are the ones the creators replaced (their weapon sounds).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findAwcs } from '../src/formats/rpf';
import { streamToAudio } from '../src/formats/awc';
import { matchCatalog } from '../src/formats/mapping';
import { measure } from './sound-report';
import type { AudioData } from '../src/dsp/types';

const [, , out, ...packs] = process.argv;

interface Feat { pack: string; file: string; stream: number; dur: number; attackMs: number; t20: number; t40: number; onsets: number; echoDb: number; kind: string; m: ReturnType<typeof measure> }

function envelope(x: Float32Array, sr: number, ms = 2) {
  const h = Math.max(1, Math.round((ms / 1000) * sr)), e: number[] = [];
  for (let i = 0; i + h <= x.length; i += h) { let s = 0; for (let j = i; j < i + h; j++) s += x[j] * x[j]; e.push(10 * Math.log10(s / h + 1e-12)); }
  return e;
}

function features(a: AudioData) {
  const sr = a.sampleRate, x = a.channels[0];
  const e = envelope(x, sr, 2);
  let pk = 0; for (let i = 1; i < e.length; i++) if (e[i] > e[pk]) pk = i;
  const peak = e[pk];
  const after = (db: number) => { for (let i = pk; i < e.length; i++) if (e[i] < peak - db) return (i - pk) * 2; return (e.length - pk) * 2; };
  // onsets: jumps of > 9 dB within 6 ms after a quieter stretch
  let onsets = 0;
  for (let i = 3; i < e.length; i++) if (e[i] - Math.min(e[i - 3], e[i - 2]) > 9 && e[i] > peak - 30) { onsets++; i += 15; }
  // echo: strongest local bump 80–400 ms after the peak relative to the smoothed decay
  let echo = -99;
  for (let i = pk + 40; i < Math.min(e.length - 3, pk + 200); i++) { const bump = e[i] - (e[i - 10] + e[i - 9]) / 2; if (bump > echo) echo = bump; }
  return { dur: x.length / sr, attackMs: pk * 2, t20: after(20), t40: after(40), onsets, echoDb: +echo.toFixed(1) };
}

const byKey = new Map<string, Map<string, string>>(); // file:stream → pack → hash
const feats: Feat[] = [];
for (const p of packs) {
  const bytes = new Uint8Array(readFileSync(p));
  const name = p.split('/').pop()!;
  for (const f of findAwcs(bytes)) {
    const file = matchCatalog(f.awc)?.key ?? `x${f.offset}`;
    for (const s of f.awc.streams) {
      if (s.format.codec !== 0 || s.data.length < 2000) continue;
      const key = `${file}:${s.id}`;
      const h = createHash('sha1').update(s.data).digest('hex');
      if (!byKey.has(key)) byKey.set(key, new Map());
      byKey.get(key)!.set(name, h);
      const a = streamToAudio(s);
      const fe = features(a);
      feats.push({ pack: name, file, stream: s.id, ...fe, kind: '', m: measure(a) });
    }
  }
}
// modified = the stream has more than one distinct version across the packs
const modified = new Set([...byKey].filter(([, m]) => new Set(m.values()).size > 1).map(([k]) => k));
const mod = feats.filter((f) => modified.has(`${f.file}:${f.stream}`));
for (const f of mod) {
  f.kind = f.attackMs <= 6 && f.onsets <= 2 && f.t20 >= 20 && f.dur >= 0.15 && f.m.bands.presence + f.m.bands.mid >= 15 ? 'shot'
    : f.onsets >= 2 || f.dur < 0.6 ? 'mech' : 'other';
}
writeFileSync(out, JSON.stringify({ streams: feats.length, modified: mod.length, items: mod.map(({ m, ...r }) => ({ ...r, ...m })) }, null, 1));
const sum = (k: string) => mod.filter((f) => f.kind === k).length;
console.log({ streams: feats.length, modified: mod.length, shots: sum('shot'), mech: sum('mech'), other: sum('other') });
