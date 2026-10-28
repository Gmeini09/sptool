// Shot vs reload detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySound } from '../src/dsp/classify';
import { builtinCatalog } from '../src/library/catalog';
import { synthesize } from '../src/synth/synth';

const sr = 44100;
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
function shot(): Float32Array {
  const c = new Float32Array(sr); let lp = 0;
  for (let i = 0; i < c.length; i++) { const t = i / sr; lp = 0.7 * lp + 0.3 * rnd(); c[i] = (lp * 0.9 + 0.6 * Math.sin(2 * Math.PI * 70 * t)) * Math.exp(-t / 0.12); }
  return c;
}
function clicks(at: number[]): Float32Array {
  const c = new Float32Array(Math.round(1.2 * sr)); let prev = 0;
  for (const t of at) { const s = Math.round(t * sr); for (let i = 0; i < 0.012 * sr; i++) { const w = rnd(); c[s + i] = (w - prev) * 0.8 * Math.exp(-i / (0.002 * sr)); prev = w; } }
  return c;
}

test('a gunshot is a shot, a series of clicks is a reload', () => {
  assert.equal(classifySound({ sampleRate: sr, channels: [shot()] }).kind, 'shot');
  assert.equal(classifySound({ sampleRate: sr, channels: [clicks([0.1, 0.45, 0.8])] }).kind, 'reload');
  assert.equal(classifySound({ sampleRate: sr, channels: [clicks([0.05])] }).kind, 'reload');
});

test('built-in library: at least 90 % sorted right', () => {
  const all = builtinCatalog().filter((e) => e.synth);
  let ok = 0;
  for (const e of all) {
    const truth = e.type === 'fire' || e.type === 'suppressor' ? 'shot' : 'reload';
    if (classifySound(synthesize(e.synth!)).kind === truth) ok++;
  }
  assert.ok(ok / all.length >= 0.9, `${ok}/${all.length}`);
});

// Real game / creator-pack sounds (not shipped): pistol shots vs reload, handling and dry-fire sounds.
// SPTOOL_REF_DIR = folder with creator WEAPONS_PLAYER*.rpf / RESIDENT*.rpf files.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { openPack } from '../src/formats/pack';
import { indexPack } from '../src/projects/build';
import { streamToAudio } from '../src/formats/awc';
import { hasReference, isOwnSound } from '../src/formats/reference';
import { isWholeReload } from '../src/projects/extractPack';

const refDir = process.env.SPTOOL_REF_DIR;
test('real pack sounds: shots and reload/handling sounds told apart (≥ 85 %)', { skip: refDir && existsSync(refDir) ? false : 'set SPTOOL_REF_DIR to run' }, () => {
  const SHOT: Array<[string, number]> = [['F03', 277856074], ['F01', 256769237], ['F02', 182780901], ['F01', 522480718], ['F04', 369994369], ['F01', 188887209], ['F01', 486577190], ['F01', 505493445], ['F01', 200823666]];
  const MECH: Array<[string, number]> = [175160094, 300446193, 351424790, 467110165, 525789822, 532075454, 72533553, 95500280, 102461967, 127674808, 322595178, 496212660, 382230007, 25502487, 219983006, 195766736].map((id) => ['F01', id] as [string, number])
    .concat([['F22', 122463724], ['F22', 500667139], ['F22', 440235450], ['F22', 354347886], ['F22', 116231963], ['F25', 425851033]]);
  const seen = new Set<string>(); let ok = 0, all = 0;
  for (const f of readdirSync(refDir!).filter((x) => /\.rpf$/i.test(x))) {
    const pack = openPack([{ name: f, bytes: new Uint8Array(readFileSync(`${refDir}/${f}`)) }]);
    const idx = indexPack(pack);
    for (const [label, list] of [['shot', SHOT], ['reload', MECH]] as const) for (const [file, id] of list) {
      for (const gi of idx.get(file) ?? []) {
        const s = pack.groups[gi].awc.streams.find((x) => x.id === id); if (!s) continue;
        // a creator's replacement in a reload slot can be anything – only the game's own reload sounds count
        if (label === 'reload' && hasReference(file, id) && isOwnSound(file, id, s.data)) break;
        const a = streamToAudio(s); const c = a.channels[0];
        let pk = 0; for (const v of c) pk = Math.max(pk, Math.abs(v));
        const key = `${c.length}:${Array.from(c.subarray(0, 64)).join(',')}`;
        if (pk < 0.003 || c.length < a.sampleRate * 0.03 || seen.has(key)) break;
        seen.add(key); all++;
        if (classifySound(a).kind === label) ok++;
        break;
      }
    }
  }
  assert.ok(all > 40 && ok / all >= 0.85, `${ok}/${all}`);
});

test('whole reload in one sound is recognised, a single click or shot is not', () => {
  assert.equal(isWholeReload({ sampleRate: sr, channels: [clicks([0.1, 0.45, 0.8])] }), true);
  assert.equal(isWholeReload({ sampleRate: sr, channels: [clicks([0.05])] }), false);
  assert.equal(isWholeReload({ sampleRate: sr, channels: [shot()] }), false);
});

test('a shot with an echo almost as loud as the bang stays a shot at any sample rate', () => {
  for (const rate of [44100, 48000, 32000]) {
    const n = Math.round(1.2 * rate), c = new Float32Array(n); let s = 11, lp = 0;
    const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
    const hit = (at: number, gain: number) => { const o = Math.round(at * rate); for (let i = 0; o + i < n && i < 0.5 * rate; i++) { const t = i / rate; lp = 0.7 * lp + 0.3 * r(); c[o + i] += (lp * 0.9 + 0.6 * Math.sin(2 * Math.PI * 70 * t)) * Math.exp(-t / 0.09) * gain; } };
    hit(0, 1); hit(0.35, 1.02); // the echo peaks a fraction higher than the shot
    assert.equal(classifySound({ sampleRate: rate, channels: [c] }).kind, 'shot', `${rate} Hz`);
  }
});
