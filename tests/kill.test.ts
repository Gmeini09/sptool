// Kill sound (one sound for every weapon, found by the in-game search test) and the in-game preview (gameAudio):
// what the creator plays must be exactly what the build writes into the game file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { synthPack } = await import('./synthPack');
const { openPack } = await import('../src/formats/pack');
const { gameAudio, streamToAudio, parseAwc, writeAwc, replaceStreamAudio } = await import('../src/formats/awc');
const { planBuild, runBuild, indexPack, inGameAudio } = await import('../src/projects/build');
const { allKeys, applySearch, targetsFor } = await import('../src/projects/searchTest');
const { newProject, assign, validateProject } = await import('../src/projects/project');
const { checkAttachmentCoverage } = await import('../src/weapons/coverage');
const { extractPack } = await import('../src/projects/extractPack');
const { WEAPON_PROFILES } = await import('../src/weapons/profiles');

const pack = openPack(synthPack({ f01Max: 120 }));
const empty = { version: 1 as const, updatedAt: 0, entries: [] };
const pistol = WEAPON_PROFILES.find((p) => p.id === 'pistol')!;
/** A stereo sound whose channels differ, at an unusual rate – nothing may be changed but the mono mix-down. */
const stereo = (sec = 0.3, sr = 37000) => {
  const n = Math.round(sec * sr), l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = Math.sin((2 * Math.PI * 300 * i) / sr) * 0.6; r[i] = Math.sin((2 * Math.PI * 520 * i) / sr) * 0.3; }
  return { sampleRate: sr, channels: [l, r] };
};

test('gameAudio: mono mix-down, own rate, own length, own level', () => {
  const a = stereo(), g = gameAudio(a);
  assert.equal(g.channels.length, 1);
  assert.equal(g.sampleRate, a.sampleRate);
  assert.equal(g.channels[0].length, a.channels[0].length);
  for (const i of [0, 17, 999, 5000]) assert.ok(Math.abs(g.channels[0][i] - (a.channels[0][i] + a.channels[1][i]) / 2) < 1e-6);
  const loud = { sampleRate: 48000, channels: [new Float32Array([0.5, 2, -1.5])] };
  assert.ok(Math.max(...gameAudio(loud).channels[0].map(Math.abs)) <= 1, 'above full scale is brought down, never clipped');
});

test('the in-game preview equals what the build writes (sample for sample, 16-bit)', async () => {
  const src = stereo(0.2, 44100);
  const mapping = { ...empty, entries: [{ file: 'F03', stream: 277856074, weapon: 'pistol' as const, slot: 'fire' }] };
  const plan = planBuild(assign(newProject('t', 'x'), 'pistol', 'fire', { entryId: 'a' }), WEAPON_PROFILES, mapping, pack);
  const built = openPack((await runBuild(plan, pack, async () => src, undefined, { allArchives: true })).outputs);
  const st = built.groups[indexPack(built).get('F03')![0]].awc.streams.find((s) => s.id === 277856074)!;
  const inGame = streamToAudio(st), preview = gameAudio(src);
  assert.equal(inGame.sampleRate, preview.sampleRate);
  assert.equal(inGame.channels[0].length, preview.channels[0].length);
  let worst = 0;
  for (let i = 0; i < preview.channels[0].length; i++) worst = Math.max(worst, Math.abs(inGame.channels[0][i] - preview.channels[0][i]));
  assert.ok(worst < 2 / 32768, `max difference ${worst}`);
  const shown = await inGameAudio(plan, pack, plan.items[0], async () => src);
  assert.deepEqual(shown!.audio.channels[0], inGame.channels[0], '"So klingt es im Spiel" plays the same samples');
});

test('kill sound: one search target for all weapons, stored on the Pistol', () => {
  const t = targetsFor(['pistol', 'pistol_mk2', 'pistol50'], ['fire', 'kill']);
  assert.deepEqual(t.filter((x) => x.endsWith(':kill')), ['pistol:kill']);
  assert.equal(t.filter((x) => x.endsWith(':fire')).length, 3);
  assert.ok(pistol.slots.some((s) => s.id === 'kill' && s.type === 'kill'));
});

test('kill sound alone does not ask for a suppressor sound', () => {
  assert.deepEqual(checkAttachmentCoverage(pistol, new Set(['kill'])), []);
  assert.ok(checkAttachmentCoverage(pistol, new Set(['kill', 'fire'])).some((i) => i.slot === 'suppressed_fire'));
  assert.ok(validateProject(assign(newProject('t', 'x'), 'pistol', 'kill', { entryId: 'k' }), WEAPON_PROFILES).ok);
});

test('kill sound: unmapped until the search test finds it, then built into every copy of its file', async () => {
  const p = assign(newProject('t', 'x'), 'pistol', 'kill', { entryId: 'k' });
  const before = planBuild(p, WEAPON_PROFILES, empty, pack);
  assert.equal(before.items[0].status, 'unmapped');
  assert.equal(before.items[0].weaponLabel, 'Alle Waffen');
  // the search test found one sound in F01 for the kill (the longest one there: room for the new sound)
  const f01 = pack.groups[indexPack(pack).get('F01')![0]].awc.streams.reduce((a, b) => (b.data.length > a.data.length ? b : a));
  const found = `F01:${f01.id}`;
  assert.ok(allKeys(pack).includes(found));
  const sr = f01.format.sampleRate, n = Math.floor(f01.format.samples / 2);
  const st = { round: 5, weapons: ['pistol:kill'], sets: { 'pistol:kill': [found] }, notLoaded: [], patterns: {}, found: ['pistol:kill'] };
  const { mapping, weapons } = applySearch(empty, st);
  assert.deepEqual(weapons, ['pistol:kill']);
  assert.deepEqual(mapping.entries.map((e) => `${e.file}:${e.stream}:${e.weapon}:${e.slot}`), [`${found}:pistol:kill`]);
  const plan = planBuild(p, WEAPON_PROFILES, mapping, pack);
  assert.equal(plan.items[0].status, 'ready');
  const out = openPack((await runBuild(plan, pack, async () => stereo(n / sr, sr), undefined, { allArchives: true })).outputs);
  const gis = indexPack(out).get('F01')!;
  assert.equal(gis.length, 1, 'both archive copies of F01 stay identical');
  assert.equal(out.groups[gis[0]].refs.length, 2);
  const s = out.groups[gis[0]].awc.streams.find((x) => x.id === f01.id)!;
  assert.equal(s.format.sampleRate, sr);
  assert.equal(s.format.samples, n);
});

test('kill sound from a soundpack: a known kill sound comes out labelled, an unknown one is in "Ganzes Pack zeigen"', () => {
  const f01 = pack.groups[indexPack(pack).get('F01')![0]].awc.streams;
  const loud = f01.find((s) => { const a = streamToAudio(s).channels[0]; let p = 0; for (let i = 0; i < a.length; i += 4) p = Math.max(p, Math.abs(a[i])); return p > 0.01; })!;
  const mapping = { ...empty, entries: [{ file: 'F01', stream: loud.id, weapon: 'pistol' as const, slot: 'kill' }] };
  const known = extractPack(pack, mapping).find((x) => x.slot === 'kill');
  assert.ok(known, 'mapped kill sound is extracted');
  assert.equal(known!.label, 'Kill-Sound (alle Waffen)');
  assert.equal(known!.weapon, 'pistol');
  // not mapped yet: the whole pack also shows the creator's own sounds of the big shared file F01
  const plain = extractPack(pack, empty), all = extractPack(pack, empty, { all: true });
  assert.ok(all.length > plain.length);
  assert.ok(all.some((x) => x.key === `all:F01:${loud.id}`), 'the kill candidate in F01 can be picked');
});
test('one sound in many streams is stored once (shared data chunk) and reads back in every stream', () => {
  const g = pack.groups[indexPack(pack).get('F01')![0]];
  const sound = stereo(0.5, 44100);
  const ids = g.awc.streams.slice(0, 10).map((s) => s.id);
  const streams = g.awc.streams.map((s) => (ids.includes(s.id) ? replaceStreamAudio(s, sound, { normalize: false, sampleRate: 44100 }) : s));
  const plain = writeAwc({ ...g.awc, streams }), shared = writeAwc({ ...g.awc, streams }, { share: true });
  const one = streams.find((s) => s.id === ids[0])!.data.length;
  assert.ok(plain.length - shared.length >= 9 * one, `saves 9 copies (${plain.length - shared.length} B)`);
  const back = parseAwc(shared);
  for (const id of ids) assert.deepEqual(back.streams.find((s) => s.id === id)!.data, streams.find((s) => s.id === id)!.data);
  for (const s of back.streams) if (!ids.includes(s.id)) assert.deepEqual(s.data, g.awc.streams.find((x) => x.id === s.id)!.data, 'other streams untouched');
  assert.deepEqual(writeAwc(parseAwc(plain)), plain, 'without share the layout stays byte-identical');
});