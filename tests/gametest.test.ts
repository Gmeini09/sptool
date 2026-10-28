// In-game mapping test: beep patterns, test pack build, answers → mapping; shipped pistol shot mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { beepAudio, buildGameTest, applyGameTest, TEST_GROUPS } = await import('../src/projects/gameTest');
const { parseMapping, streamsFor } = await import('../src/formats/mapping');
const { openPack } = await import('../src/formats/pack');
const { planBuild } = await import('../src/projects/build');
const { newProject, assign } = await import('../src/projects/project');
const { WEAPON_PROFILES } = await import('../src/weapons/profiles');
const shipped = JSON.parse(readFileSync(new URL('../weapon_profiles/mapping.json', import.meta.url), 'utf8'));

const U = '/mnt/user-data/uploads/';
const WP = U + 'WEAPONS_PLAYER.rpf', RES = U + 'RESIDENT__8_.rpf';
const have = existsSync(WP) && existsSync(RES);

function countBeeps(x: Float32Array): number {
  const w = 64; // ~1.5 ms windows (a 1 kHz beep never has a silent window)
  let n = 0, on = false;
  for (let i = 0; i < x.length; i += w) {
    let pk = 0;
    for (let j = i; j < Math.min(x.length, i + w); j++) pk = Math.max(pk, Math.abs(x[j]));
    const a = pk > 0.05;
    if (a && !on) n++;
    on = a;
  }
  return n;
}

test('beep patterns: n separate beeps, also in short sounds', () => {
  for (const sec of [0.12, 0.4, 1]) for (const n of [1, 2, 3]) {
    const a = beepAudio(n, sec, 44100);
    assert.equal(a.channels[0].length, Math.round(sec * 44100));
    assert.equal(countBeeps(a.channels[0]), n, `${n} beeps in ${sec}s`);
  }
});

test('answers become mapping entries; same beeps for two weapons → first keeps it', () => {
  const m = parseMapping(shipped);
  const r = applyGameTest(m, { 'pistol:fire': 3, 'pistol_mk2:fire': 1, 'pistol50:fire': 1 });
  assert.equal(r.added, TEST_GROUPS[0].streams.length + TEST_GROUPS[2].streams.length);
  assert.equal(streamsFor(r.mapping, 'pistol_mk2', 'fire').length, 2);
  assert.equal(streamsFor(r.mapping, 'pistol50', 'fire').length, 2, 'the shipped .50 shot stays');
  assert.deepEqual(r.shared, [{ key: 'pistol50:fire', with: 'pistol_mk2:fire' }]);
  assert.equal(streamsFor(r.mapping, 'pistol', 'fire').length, 2);
});

test('shipped mapping builds the pistol shot from a real pack (both archives)', { skip: !have }, () => {
  const pack = openPack([{ name: 'WEAPONS_PLAYER.rpf', bytes: new Uint8Array(readFileSync(WP)) }, { name: 'RESIDENT.rpf', bytes: new Uint8Array(readFileSync(RES)) }]);
  const p = assign(newProject('t', 'x'), 'pistol', 'fire', { entryId: 'x' } as never);
  const plan = planBuild(p, WEAPON_PROFILES, parseMapping(shipped), pack);
  assert.equal(plan.ready, 1);
  const files = new Set(plan.items[0].targets.map((t) => pack.archives[pack.groups[t.group].refs[0].archive].name));
  assert.deepEqual([...files].sort(), ['RESIDENT.rpf', 'WEAPONS_PLAYER.rpf']);
});

test('test pack: every candidate found in the base is replaced, archive sizes unchanged', { skip: !have }, () => {
  const wp = new Uint8Array(readFileSync(WP)), res = new Uint8Array(readFileSync(RES));
  const pack = openPack([{ name: 'WEAPONS_PLAYER.rpf', bytes: wp }, { name: 'RESIDENT.rpf', bytes: res }]);
  const t = buildGameTest(pack);
  assert.ok(t.groups[0].found >= 2 && t.groups[2].found >= 2);
  assert.deepEqual(t.outputs.map((o) => o.name).sort(), ['RESIDENT.rpf', 'WEAPONS_PLAYER.rpf']);
  for (const o of t.outputs) assert.equal(o.bytes.length, o.name === 'RESIDENT.rpf' ? res.length : wp.length);
  const back = openPack(t.outputs);
  const s = back.groups.flatMap((g) => g.awc.streams).find((x) => x.id === 277856074)!;
  const pcm = new Int16Array(s.data.buffer, s.data.byteOffset, s.data.byteLength >> 1);
  assert.equal(countBeeps(Float32Array.from(pcm, (v) => v / 32768)), 3);
});
