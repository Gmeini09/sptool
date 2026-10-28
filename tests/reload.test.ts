// Whole reload: the in-game test finds the reload sounds; a whole reload (one long sound) then plays at the start of
// the reload in full length – the other reload parts are muted and their bytes go to the long sound.
// Needs a creator RESIDENT.rpf: SPTOOL_REF_RESIDENT=/path/RESIDENT.rpf
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { openPack } from '../src/formats/pack';
import { parseMapping } from '../src/formats/mapping';
import { streamToAudio } from '../src/formats/awc';
import { buildGameTest, applyReloadTest, RELOAD_TEST_GROUPS } from '../src/projects/gameTest';
import { indexPack, planBuild, runBuild, SILENCE, blockedLabels } from '../src/projects/build';
import { newProject, assign } from '../src/projects/project';
import { WEAPON_PROFILES } from '../src/weapons/profiles';

const res = process.env.SPTOOL_REF_RESIDENT;
const skip = res && existsSync(res) ? false : 'set SPTOOL_REF_RESIDENT to run';
const load = () => openPack([{ name: 'RESIDENT.rpf', bytes: new Uint8Array(readFileSync(res!)) }]);
const f01 = (pack: ReturnType<typeof load>) => pack.groups[indexPack(pack).get('F01')![0]];
const secs = (s: { format: { samples: number; sampleRate: number } }) => s.format.samples / s.format.sampleRate;

test('reload test answers: low beep patterns in the order heard → mag_out, mag_in, …', () => {
  const m0 = parseMapping({ version: 1, updatedAt: 0, entries: [] });
  const r = applyReloadTest(m0, 'pistol', [2, 1, 2]);
  const slotOf = (id: number) => r.mapping.entries.find((e) => e.stream === id)?.slot;
  assert.equal(slotOf(RELOAD_TEST_GROUPS[1].streams[0].stream), 'mag_out', 'heard first');
  assert.equal(slotOf(RELOAD_TEST_GROUPS[0].streams[1].stream), 'mag_in', 'heard second');
  assert.equal(r.added, RELOAD_TEST_GROUPS[1].streams.length + RELOAD_TEST_GROUPS[0].streams.length, 'a repeated answer counts once');
});

test('test pack: reload candidates beep low, shots high, container sizes unchanged', { skip }, () => {
  const pack = load();
  const t = buildGameTest(pack);
  assert.ok(t.groups.filter((g) => g.freq).every((g) => g.found > 0), 'all reload candidates found');
  const out = openPack(t.outputs.map((o) => ({ name: o.name, bytes: o.bytes })));
  assert.equal(t.outputs[0].bytes.length, pack.archives[0].bytes.length);
  const s = f01(out).awc.streams.find((x) => x.id === RELOAD_TEST_GROUPS[1].streams[0].stream)!;
  const a = streamToAudio(s).channels[0];
  let cross = 0; for (let i = 1; i < Math.min(a.length, Math.round(s.format.sampleRate * 0.015)); i++) if ((a[i - 1] < 0) !== (a[i] < 0)) cross++;
  const hz = cross / 2 / 0.015;
  assert.ok(hz > 300 && hz < 520, `low beep (~400 Hz), got ${hz.toFixed(0)} Hz`);
});

test('whole reload keeps its full length; other parts muted; nothing else in the container changes', { skip }, async () => {
  const pack = load();
  const before = f01(pack);
  const mapping = applyReloadTest(parseMapping({ version: 1, updatedAt: 0, entries: [] }), 'pistol', [2, 1, 3]).mapping;
  let p = newProject('T', '');
  p = assign(p, 'pistol', 'mag_out', { entryId: 'whole' });
  for (const s of ['mag_in', 'slide', 'reload_finish']) p = assign(p, 'pistol', s, { entryId: SILENCE });
  const plan = planBuild(p, WEAPON_PROFILES, mapping, pack);
  assert.deepEqual(blockedLabels(plan), [], 'muted helper slots are never reported as "ohne Wirkung"');
  const len = 1.6, sr = 44100;
  const whole = { sampleRate: sr, channels: [Float32Array.from({ length: Math.round(len * sr) }, (_, i) => (i % 9000 < 400 ? Math.sin(i / 2) * 0.8 : 0))] };
  let rendered = 0;
  const r = await runBuild(plan, pack, async (a) => { rendered++; assert.notEqual(a.entryId, SILENCE); return whole as never; });
  assert.equal(rendered, 1, 'silence is never rendered');
  // templates whose creator already shrank the other reload sounds leave little room: then the rate goes down to
  // 11 kHz and at most the tail is cut – the reload must still be (nearly) whole
  const minLen = r.truncated.length ? 0.9 : len - 0.01;
  assert.equal(r.outputs[0].bytes.length, pack.archives[0].bytes.length, 'archive size unchanged');
  const after = f01(openPack(r.outputs.map((o) => ({ name: o.name, bytes: o.bytes }))));
  const ids = (k: number) => RELOAD_TEST_GROUPS[k].streams.map((s) => s.stream);
  for (const id of ids(1)) { const s = after.awc.streams.find((x) => x.id === id)!; assert.ok(secs(s) >= minLen, `mag_out variation ${id}: ${secs(s).toFixed(2)} s`); assert.ok(s.format.sampleRate >= 11025); }
  for (const id of [...ids(0), ...ids(2)]) assert.ok(secs(after.awc.streams.find((x) => x.id === id)!) <= 0.03, `muted ${id}`);
  const touched = new Set([...ids(0), ...ids(1), ...ids(2)]);
  for (const s of before.awc.streams) if (!touched.has(s.id)) {
    const t = after.awc.streams.find((x) => x.id === s.id)!;
    assert.deepEqual(t.data, s.data, `stream ${s.id} unchanged`);
  }
});

test('a short sound in a long stream is written exactly as before (same size, padded)', { skip }, async () => {
  const pack = load();
  const mapping = applyReloadTest(parseMapping({ version: 1, updatedAt: 0, entries: [] }), 'pistol', [1]).mapping;
  const p = assign(newProject('T', ''), 'pistol', 'mag_out', { entryId: 'click' });
  const plan = planBuild(p, WEAPON_PROFILES, mapping, pack);
  const r = await runBuild(plan, pack, async () => ({ sampleRate: 44100, channels: [new Float32Array(2000).fill(0.3)] }) as never);
  const after = f01(openPack(r.outputs.map((o) => ({ name: o.name, bytes: o.bytes }))));
  const o = f01(pack).awc.streams.find((x) => x.id === RELOAD_TEST_GROUPS[0].streams[0].stream)!;
  const n = after.awc.streams.find((x) => x.id === o.id)!;
  assert.equal(n.format.samples, o.format.samples);
  assert.equal(n.data.length, o.data.length);
});
