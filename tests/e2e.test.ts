// End to end with a synthetic creator-style pack (tests/synthPack.ts): open → plan → build → re-open the output,
// in-game test pack, mapping from the answers, and a pack that SP Tool built used again as the base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { synthPack } = await import('./synthPack');
const { openPack } = await import('../src/formats/pack');
const { streamToAudio } = await import('../src/formats/awc');
const { parseMapping } = await import('../src/formats/mapping');
const { planBuild, runBuild, indexPack, sameAsBase, SILENCE } = await import('../src/projects/build');
const { buildGameTest, applyGameTest } = await import('../src/projects/gameTest');
const { openBase, soundRoom } = await import('../src/projects/basePack');
const { newProject, assign } = await import('../src/projects/project');
const { WEAPON_PROFILES } = await import('../src/weapons/profiles');
const shipped = parseMapping(JSON.parse(readFileSync(new URL('../weapon_profiles/mapping.json', import.meta.url), 'utf8')));

const files = synthPack({ f01Max: 120 });
const tone = (sec: number, f = 220, sr = 44100) => { const n = Math.round(sec * sr), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / sr) * 0.5; return { sampleRate: sr, channels: [x, x] }; };
const streamOf = (pack: ReturnType<typeof openPack>, file: string, id: number) => indexPack(pack).get(file)!.map((gi) => pack.groups[gi].awc.streams.find((s) => s.id === id)!);

test('synthetic pack is accepted as a base and every container is recognised', () => {
  const pack = openBase(files);
  const idx = indexPack(pack);
  for (const k of ['F01', 'F02', 'F03', 'F04']) assert.ok(idx.has(k), k);
  assert.equal(idx.get('F01')!.length, 1, 'F01 in both archives is one group');
  assert.equal(pack.groups[idx.get('F01')![0]].refs.length, 2);
});

test('pistol shot: built into both archives, sizes unchanged, nothing else touched, output usable as base again', async () => {
  const pack = openPack(files);
  const p = assign(newProject('t', 'x'), 'pistol', 'fire', { entryId: 'a' });
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  assert.equal(plan.ready, 1);
  const r = await runBuild(plan, pack, async () => tone(0.25), undefined, { allArchives: true });
  assert.deepEqual(r.outputs.map((o) => o.name).sort(), ['RESIDENT.rpf', 'WEAPONS_PLAYER.rpf']);
  for (const o of r.outputs) assert.equal(o.bytes.length, files.find((f) => f.name === o.name)!.bytes.length);
  assert.ok(!sameAsBase(pack, r.outputs));
  const out = openPack(r.outputs);
  const before = streamToAudio(streamOf(pack, 'F03', 277856074)[0]).channels[0];
  const after = streamToAudio(streamOf(out, 'F03', 277856074)[0]).channels[0];
  assert.notDeepEqual(after, before, 'shot replaced');
  // F02/F04 (MK2 / .50 candidates) untouched
  for (const [f, id] of [['F02', 182780901], ['F04', 369994369]] as const) assert.deepEqual(streamOf(out, f, id)[0].data, streamOf(pack, f, id)[0].data);
  // both copies of F01 identical after the build
  const g = indexPack(out).get('F01')!;
  assert.equal(g.length, 1);
  // the result works as a base for the next build
  const plan2 = planBuild(p, WEAPON_PROFILES, shipped, out);
  assert.equal(plan2.ready, 1);
  const r2 = await runBuild(plan2, out, async () => tone(0.2, 440));
  assert.ok(r2.outputs.length > 0);
});

test('a longer sound than the stream is cut and reported, never grows the archive', async () => {
  const pack = openPack(files);
  const p = assign(newProject('t', 'x'), 'pistol', 'fire', { entryId: 'a' });
  const r = await runBuild(planBuild(p, WEAPON_PROFILES, shipped, pack), pack, async () => tone(3));
  for (const o of r.outputs) assert.equal(o.bytes.length, files.find((f) => f.name === o.name)!.bytes.length);
  assert.ok(r.truncated.length > 0);
});

test('shipped mapping: Pistol, MK2 and .50 shots are written (each into its file and its F01 copy)', async () => {
  const pack = openPack(files);
  let p = newProject('t', 'x');
  for (const w of ['pistol', 'pistol_mk2', 'pistol50'] as const) p = assign(p, w, 'fire', { entryId: w });
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  assert.deepEqual(plan.items.map((i) => `${i.weapon}:${i.status}`), ['pistol:ready', 'pistol_mk2:ready', 'pistol50:ready']);
  const r = await runBuild(plan, pack, async (a) => tone(0.2, a.entryId === 'pistol50' ? 110 : 330));
  const out = openPack(r.outputs);
  for (const [f, id] of [['F02', 182780901], ['F04', 369994369]] as const) assert.notDeepEqual(streamOf(out, f, id)[0].data, streamOf(pack, f, id)[0].data, `${f} written`);
  const t = buildGameTest(pack);
  assert.ok(t.groups.filter((g) => !g.freq).every((g) => g.found > 0), 'all shot candidates found in the pack');
  const m = applyGameTest(shipped, { 'pistol:fire': 3, 'pistol_mk2:fire': 1, 'pistol50:fire': 2 }).mapping;
  assert.equal(planBuild(p, WEAPON_PROFILES, m, pack).ready, 3);
});

test('whole reload: muted parts free their bytes, archive size unchanged', async () => {
  const pack = openPack(files);
  // map reload parts onto F01 streams that are in the synthetic pack
  const ids = pack.groups[indexPack(pack).get('F01')![0]].awc.streams.map((s) => s.id);
  const m = { ...shipped, entries: [...shipped.entries, ...['mag_out', 'mag_in', 'slide', 'reload_finish'].map((slot, i) => ({ file: 'F01', stream: ids[i + 5], weapon: 'pistol' as const, slot }))] };
  let p = newProject('t', 'x');
  p = assign(p, 'pistol', 'mag_out', { entryId: 'whole' });
  for (const s of ['mag_in', 'slide', 'reload_finish']) p = assign(p, 'pistol', s, { entryId: SILENCE });
  const plan = planBuild(p, WEAPON_PROFILES, m, pack);
  assert.equal(plan.ready, 4);
  const r = await runBuild(plan, pack, async () => tone(0.9));
  for (const o of r.outputs) assert.equal(o.bytes.length, files.find((f) => f.name === o.name)!.bytes.length);
  const out = openPack(r.outputs);
  const s = out.groups[indexPack(out).get('F01')![0]].awc.streams.find((x) => x.id === ids[5])!;
  assert.ok(s.format.samples / s.format.sampleRate > 0.85, `whole reload keeps its length (${(s.format.samples / s.format.sampleRate).toFixed(2)} s)`);
  assert.equal(r.truncated.length, 0);
});

test('a shot longer than its slot keeps its full sample rate and is faded out instead of muffled', async () => {
  const pack = openPack(files);
  const orig = streamOf(pack, 'F03', 277856074)[0].format;
  const p = assign(newProject('t', 'x'), 'pistol', 'fire', { entryId: 'a' });
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  const r = await runBuild(plan, pack, async () => tone(1.6, 300, 48000), undefined, { allArchives: true });
  const out = streamOf(openPack(r.outputs), 'F03', 277856074)[0];
  assert.ok(out.format.sampleRate >= Math.min(orig.sampleRate, 32000), `rate ${out.format.sampleRate}`);
  assert.deepEqual(r.truncated, ['Pistol · Schuss']);
  const a = streamToAudio(out).channels[0];
  assert.ok(Math.abs(a[a.length - 1]) < 0.01, 'the end is faded out');
});

test('"So klingt es im Spiel" plays exactly what the build writes – also when the sound is cut and lowered', async () => {
  const { inGameAudio } = await import('../src/projects/build');
  const pack = openPack(files);
  let p = assign(newProject('t', 'x'), 'pistol', 'fire', { entryId: 'short' });
  p = assign(p, 'pistol', 'mag_out', { entryId: 'long' });
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  const sounds: Record<string, ReturnType<typeof tone>> = { short: tone(0.25), long: tone(6, 330) };
  const render = async (a: { entryId: string }) => sounds[a.entryId];
  const r = await runBuild(plan, pack, render, undefined, { allArchives: true });
  const out = openPack(r.outputs);
  for (const it of plan.items.filter((i) => i.status === 'ready')) {
    const g = await inGameAudio(plan, pack, it, render);
    assert.ok(g, it.slot);
    const t = it.targets[0], written = out.groups.find((x) => x.refs.some((ref) => pack.groups[t.group].refs.some((o) => o.archive === ref.archive && o.offset === ref.offset)))!;
    assert.deepEqual(g.audio.channels[0], streamToAudio(written.awc.streams.find((s) => s.id === t.stream)!).channels[0], it.slot);
    if (it.slot === 'mag_out') { assert.ok(g.truncated && g.gameSeconds < g.sourceSeconds, 'long reload is reported as cut'); }
    else assert.ok(!g.truncated);
  }
  // stereo that cancels in mono: one channel is written instead of silence
  const anti = { sampleRate: 44100, channels: [tone(0.25).channels[0], tone(0.25).channels[0].map((x) => -x)] };
  const g = await inGameAudio(plan, pack, plan.items.find((i) => i.slot === 'fire')!, async (a) => (a.entryId === 'short' ? anti : sounds.long));
  let peak = 0; for (const v of g!.audio.channels[0]) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > 0.4, `audible in the game, peak ${peak}`);
  assert.ok(g!.monoLossDb > -1);
});

test('a sound that fits is written like a pack made by hand: own rate, own length, own level', async () => {
  const pack = openPack(synthPack({ f01Max: 120, shotSeconds: 1.5 }));
  let p = newProject('Hand', 'me');
  p = assign(p, 'pistol', 'fire', { entryId: 'shot' });
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  const shot = tone(0.5, 330, 48000);
  const x = shot.channels[0]; // both channels are the same array
  for (let i = 0; i < x.length; i++) x[i] *= 1.2; // peak 0.6
  const res = await runBuild(plan, pack, async () => shot);
  const out = openPack(res.outputs.map((o) => ({ name: o.name, bytes: o.bytes })));
  const s = streamOf(out, 'F03', 277856074)[0];
  assert.equal(s.format.sampleRate, 48000);
  assert.equal(s.format.samples, shot.channels[0].length); // no silence padded on
  const a = streamToAudio(s).channels[0];
  let peak = 0; for (const v of a) peak = Math.max(peak, Math.abs(v));
  assert.ok(Math.abs(peak - 0.6) < 0.01, `level kept, got ${peak}`);
  assert.deepEqual(res.truncated, []);
});

test('soundRoom: a template with longer shot slots has more room for own sounds', async () => {
  const tight = await soundRoom(openPack(synthPack({ f01Max: 120, shotSeconds: 0.3 })));
  const roomy = await soundRoom(openPack(synthPack({ f01Max: 120, shotSeconds: 1.5 })));
  assert.ok(roomy > tight, `${roomy} > ${tight}`);
});

test('"Klingt im Spiel anders?" report names the template and marks a cut sound', async () => {
  const { soundReport } = await import('../src/projects/report');
  const pack = openPack(synthPack({ f01Max: 120, shotSeconds: 0.3 }));
  let p = newProject('Bericht', 'me');
  p = assign(p, 'pistol', 'fire', { entryId: 'long' });
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  const text = await soundReport(plan, pack, async () => tone(2), { name: 'Bericht', template: 'Testvorlage', soundName: () => 'Mein Schuss' });
  assert.match(text, /Vorlage: Testvorlage/);
  assert.match(text, /Pistol · .*Mein Schuss/);
  assert.match(text, /GEKÜRZT/);
});

test('"Lautstärke wie das Original": a quiet sound gets the loudness of the template sound, without clipping', async () => {
  const { inGameAudio } = await import('../src/projects/build');
  const pack = openPack(synthPack({ f01Max: 120, shotSeconds: 0.6 }));
  let p = newProject('Pegel', 'me');
  p = assign(p, 'pistol', 'fire', { entryId: 'quiet' });
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  const it = plan.items.find((i) => i.slot === 'fire' && i.status === 'ready')!;
  const quiet = tone(0.4); const x = quiet.channels[0]; for (let i = 0; i < x.length; i++) x[i] *= 0.1; // peak 0.05
  const rms = (c: Float32Array) => Math.sqrt(c.reduce((s, v) => s + v * v, 0) / c.length);
  const peakOf = (c: Float32Array) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const kept = await inGameAudio(plan, pack, it, async () => quiet);
  const matched = await inGameAudio(plan, pack, it, async () => quiet, { matchLevel: true });
  assert.ok(Math.abs(peakOf(kept!.audio.channels[0]) - 0.05) < 0.005, 'off: level of the file');
  const m = matched!.audio.channels[0];
  assert.ok(rms(m) > rms(kept!.audio.channels[0]) * 5, 'on: clearly louder');
  assert.ok(peakOf(m) <= 1.0001, 'never above full scale');
});

test('"Lautstärke wie das Original" never matches to a muted original (creators mute unused reload parts)', async () => {
  const { inGameAudio } = await import('../src/projects/build');
  const base = openPack(synthPack({ f01Max: 120, shotSeconds: 0.6 }));
  let p = newProject('Stumm', 'me');
  p = assign(p, 'pistol', 'fire', { entryId: 'x' });
  // a template whose creator put a near-silent sound there (−40 dB)
  const muted = tone(0.4); const mx = muted.channels[0]; for (let i = 0; i < mx.length; i++) mx[i] *= 0.02;
  const built = await runBuild(planBuild(p, WEAPON_PROFILES, shipped, base), base, async () => muted, undefined, { allArchives: true });
  const pack = openPack(built.outputs.map((o) => ({ name: o.name, bytes: o.bytes })));
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  const it = plan.items.find((i) => i.slot === 'fire' && i.status === 'ready')!;
  const g = await inGameAudio(plan, pack, it, async () => tone(0.4), { matchLevel: true });
  const peak = g!.audio.channels[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak > 0.4, `keeps its own level, got ${peak}`);
});
