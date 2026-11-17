// Sound import helpers (trim) and pulling sounds out of a soundpack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { trimSilence } = await import('../src/library/importAudio');
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
