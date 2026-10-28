// Catalog, mapping and build against real creator packs (not shipped).
// Set SPTOOL_REF_RPF / SPTOOL_REF_RPF2 (one pack: WEAPONS_PLAYER + RESIDENT) and optionally
// SPTOOL_REF_OTHER (a WEAPONS_PLAYER.rpf from another creator) to run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { findAwcs } from '../src/formats/rpf';
import { openPack } from '../src/formats/pack';
import { CATALOG, matchCatalog, parseMapping, setStreamMapping, mappingOf, type Mapping } from '../src/formats/mapping';
import { planBuild, runBuild } from '../src/projects/build';
import { newProject, assign } from '../src/projects/project';
import { WEAPON_PROFILES } from '../src/weapons/profiles';

const a = process.env.SPTOOL_REF_RPF, b = process.env.SPTOOL_REF_RPF2, other = process.env.SPTOOL_REF_OTHER;
const skip = a && b && existsSync(a) && existsSync(b) ? false : 'set SPTOOL_REF_RPF and SPTOOL_REF_RPF2 to run';
const realName = (p: string) => basename(realpathSync(p)).replace(/^[0-9a-f]{8}-/, '');
const load = () => openPack([a!, b!].map((p) => ({ name: realName(p), bytes: new Uint8Array(readFileSync(p)) })));

test('catalog: 29 original files, keys unique, no stream id in two files', () => {
  assert.equal(CATALOG.length, 29);
  assert.equal(new Set(CATALOG.map((c) => c.key)).size, 29);
  const seen = new Map<number, string>();
  for (const c of CATALOG) for (const id of c.ids) { assert.ok(!seen.has(id), `id ${id} in ${seen.get(id)} and ${c.key}`); seen.set(id, c.key); }
});

test('mapping: parse, set, clear, reject bad files', () => {
  let m: Mapping = parseMapping({ version: 1, updatedAt: 0, entries: [] });
  m = setStreamMapping(m, 'F08', 123, { weapon: 'pistol', slot: 'fire' });
  m = setStreamMapping(m, 'F08', 123, { weapon: 'pistol', slot: 'dry_fire' });
  assert.equal(m.entries.length, 1);
  assert.equal(mappingOf(m, 'F08', 123)?.slot, 'dry_fire');
  m = setStreamMapping(m, 'F08', 123, null);
  assert.equal(m.entries.length, 0);
  assert.throws(() => parseMapping({ version: 2, entries: [] }));
  assert.throws(() => parseMapping({ version: 1, entries: [{ file: '../x', stream: 1, weapon: 'pistol', slot: 'fire' }] }));
});

test('every container of every pack is recognised', { skip }, () => {
  for (const p of [a!, b!, other].filter((x): x is string => !!x && existsSync(x))) {
    const cs = findAwcs(new Uint8Array(readFileSync(p)));
    const unknown = cs.filter((c) => !matchCatalog(c.awc));
    assert.equal(unknown.length, 0, `${basename(p)}: ${unknown.length} unknown containers`);
  }
});

test('build writes mapped slots into every copy and nothing else', { skip }, async () => {
  const pack = load();
  // a file present in both archives and a weapon-only file, mapped to two pistol slots
  const shared = pack.groups.find((g) => new Set(g.refs.map((r) => r.archive)).size > 1)!;
  const sharedKey = matchCatalog(shared.awc)!.key;
  const single = pack.groups.find((g) => g.refs.length === 1 && g.awc.streams.length >= 2)!;
  const singleKey = matchCatalog(single.awc)!.key;
  let m = parseMapping({ version: 1, updatedAt: 0, entries: [] });
  m = setStreamMapping(m, singleKey, single.awc.streams[0].id, { weapon: 'pistol', slot: 'fire' });
  m = setStreamMapping(m, singleKey, single.awc.streams[1].id, { weapon: 'pistol', slot: 'fire' }); // variation
  m = setStreamMapping(m, sharedKey, shared.awc.streams[0].id, { weapon: 'pistol', slot: 'dry_fire' });

  let p = newProject('t', 'me');
  p = assign(p, 'pistol', 'fire', { entryId: 'tone' });
  p = assign(p, 'pistol', 'dry_fire', { entryId: 'click' });
  p = assign(p, 'pistol', 'slide', { entryId: 'tone' }); // filled but not mapped
  const plan = planBuild(p, WEAPON_PROFILES, m, pack);
  assert.equal(plan.items.find((i) => i.slot === 'fire')!.targets.length, 2);
  assert.equal(plan.items.find((i) => i.slot === 'slide')!.status, 'unmapped');
  assert.equal(plan.ready, 2);

  const tone = (hz: number) => ({ sampleRate: 48000, channels: [Float32Array.from({ length: 24000 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / 48000) * 0.5)] });
  const res = await runBuild(plan, pack, async (x) => tone(x.entryId === 'tone' ? 440 : 2000));
  assert.equal(res.replacedStreams, 3);
  const names = res.outputs.map((o) => o.name).sort();
  assert.ok(names.includes('WEAPONS_PLAYER.rpf') && names.includes('RESIDENT.rpf'), names.join(','));
  for (const o of res.outputs) {
    const orig = pack.archives.find((x) => x.name === realName(o.name === 'RESIDENT.rpf' ? b! : a!))!;
    assert.equal(o.bytes.length, orig.bytes.length, 'archive size unchanged');
    // only bytes inside replaced containers differ
    const touched = pack.groups.flatMap((g, gi) => (gi === shared.id || gi === single.id ? g.refs.filter((r) => pack.archives[r.archive] === orig) : []));
    for (let i = 0; i < o.bytes.length; i++) {
      if (o.bytes[i] !== orig.bytes[i]) assert.ok(touched.some((r) => i >= r.offset && i < r.offset + r.length), `byte ${i} changed outside a target container`);
    }
  }
  // both copies of the shared file are identical after the build
  const copies = shared.refs.map((r) => res.outputs.find((o) => o.name === (r.archive === 0 ? 'WEAPONS_PLAYER.rpf' : 'RESIDENT.rpf'))!.bytes.subarray(r.offset, r.offset + r.length));
  assert.deepEqual(copies[0], copies[1]);
  const reread = findAwcs(res.outputs.find((o) => o.name === 'WEAPONS_PLAYER.rpf')!.bytes).find((c) => c.offset === single.refs[0].offset)!;
  assert.notDeepEqual(reread.awc.streams[0].data, single.awc.streams[0].data);
});

// Bug 1.9.0: "Reload & Rest" of an SP + own shots only for Pistol .50 / MK2 handed back exactly that SP.
test('reload & rest: shots SP Tool cannot write yet are reported, an unchanged result is detected', { skip }, async () => {
  const { blockedLabels, nothingChangesMessage, sameAsBase } = await import('../src/projects/build');
  const pack = load();
  const mapping = parseMapping({ version: 1, updatedAt: 0, entries: [{ file: 'F03', stream: 277856074, weapon: 'pistol', slot: 'fire' }, { file: 'F01', stream: 256769237, weapon: 'pistol', slot: 'fire' }] });
  let p = newProject('T', '');
  p = assign(p, 'pistol50', 'fire', { entryId: 'x' });
  p = assign(p, 'pistol_mk2', 'fire', { entryId: 'y' });
  const only50 = planBuild(p, WEAPON_PROFILES, mapping, pack);
  assert.equal(only50.ready, 0);
  assert.deepEqual(blockedLabels(only50).sort(), ['Pistol .50 · Schuss', 'Pistol MK2 · Schuss'].sort());
  assert.match(nothingChangesMessage(only50, 'Mein SP') ?? '', /genau „Mein SP“.*Pistol \.50 · Schuss/);
  const tone = { sampleRate: 32000, channels: [new Float32Array(16000).map((_, i) => Math.sin(i / 3) * 0.5)] };
  const same = await runBuild(only50, pack, async () => tone as never, undefined, { allowEmpty: true, allArchives: true });
  assert.equal(sameAsBase(pack, same.outputs), true, 'nothing written → recognised as the template itself');
  const withPistol = planBuild(assign(p, 'pistol', 'fire', { entryId: 'z' }), WEAPON_PROFILES, mapping, pack);
  assert.equal(nothingChangesMessage(withPistol, 'Mein SP'), null);
  const changed = await runBuild(withPistol, pack, async () => tone as never, undefined, { allowEmpty: true, allArchives: true });
  assert.equal(sameAsBase(pack, changed.outputs), false);
});
