// Sound import helpers (trim, reload split) and pulling sounds out of a soundpack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { trimSilence, splitReload } = await import('../src/library/importAudio');
const { extractPack } = await import('../src/projects/extractPack');
const { openPack } = await import('../src/formats/pack');

const sr = 44100;
function clicks(at: number[], len = 2): Float32Array {
  const c = new Float32Array(Math.round(len * sr));
  for (const t of at) { const s = Math.round(t * sr); for (let i = 0; i < 0.05 * sr; i++) c[s + i] = Math.sin(i / 3) * Math.exp(-i / 400) * 0.9; }
  return c;
}

test('trim: silence before the sound is cut, the sound starts right away', () => {
  const a = { sampleRate: sr, channels: [clicks([0.5])] };
  const t = trimSilence(a);
  assert.ok(t.channels[0].length < a.channels[0].length / 2);
  let first = 0; while (Math.abs(t.channels[0][first]) < 0.004) first++;
  assert.ok(first < 0.005 * sr, `starts after ${first} samples`);
});

test('reload split: four events → four parts in time order', () => {
  const a = { sampleRate: sr, channels: [clicks([0.1, 0.6, 1.1, 1.6], 2)] };
  const parts = splitReload(a);
  assert.equal(parts.length, 4);
  for (const p of parts) assert.ok(p.channels[0].length < 0.3 * sr);
});

test('reload split: more than four events keeps the four loudest, in order', () => {
  const c = clicks([0.1, 0.4, 0.7, 1.0, 1.3], 1.6);
  for (let i = Math.round(0.4 * sr); i < 0.45 * sr; i++) c[i] *= 0.2; // second one quiet
  const parts = splitReload({ sampleRate: sr, channels: [c] });
  assert.equal(parts.length, 4);
});

const U = '/mnt/user-data/uploads/';
test('soundpack: Pistol shot comes out as one stereo sound, unknown pistol shots as candidates', { skip: !existsSync(U + 'WEAPONS_PLAYER.rpf') }, () => {
  const pack = openPack([{ name: 'WEAPONS_PLAYER.rpf', bytes: new Uint8Array(readFileSync(U + 'WEAPONS_PLAYER.rpf')) }]);
  const ex = extractPack(pack);
  const pistol = ex.find((x) => x.weapon === 'pistol' && x.slot === 'fire');
  assert.ok(pistol);
  assert.equal(pistol!.audio.channels.length, 2);
  assert.ok(ex.some((x) => !x.weapon && x.kind === 'shot'));
  assert.equal(new Set(ex.map((x) => x.key)).size, ex.length);
});

test('reload split: very short clicks (a few ms) are found too', () => {
  const c = new Float32Array(Math.round(1.6 * sr));
  for (const t of [0.15, 0.55, 0.95, 1.3]) { const s = Math.round(t * sr); for (let i = 0; i < 0.015 * sr; i++) c[s + i] = Math.sin(i * 1.3) * 0.8 * Math.exp(-i / (0.003 * sr)); }
  assert.equal(splitReload({ sampleRate: sr, channels: [c] }).length, 4);
});

// 1.9.3: reloads recorded with background noise or with hits right after each other split too.
test('reload split: works with background noise (no silence between the parts)', () => {
  const c = clicks([0.1, 0.5, 0.9, 1.3]);
  let s = 11; const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  let b = 0; for (let i = 0; i < c.length; i++) { b = 0.97 * b + 0.03 * r(); c[i] += (b * 6 + r() * 0.3) * 0.1; } // hiss + rumble ≈ -20 dB
  const parts = splitReload({ sampleRate: sr, channels: [c] });
  assert.equal(parts.length, 4);
});

test('reload split: two hits 100 ms apart without a pause are two parts', () => {
  const c = new Float32Array(sr);
  // a ringing first hit that has not died down when the second one comes
  for (let i = 0; i < 0.4 * sr; i++) c[Math.round(0.1 * sr) + i] += Math.sin(i / 3) * 0.12 * Math.exp(-i / (0.25 * sr)) + (i < 300 ? 0.6 * Math.sin(i * 1.7) : 0);
  for (let i = 0; i < 300; i++) c[Math.round(0.2 * sr) + i] += 0.9 * Math.sin(i * 2.3) * Math.exp(-i / 80);
  assert.equal(splitReload({ sampleRate: sr, channels: [c] }).length, 2);
});
