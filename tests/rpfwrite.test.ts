// Rebuilding archives with a plain table of contents (OPEN): containers may grow, so long shots and a whole reload go
// into the game 1 : 1 when SP Tool knows the archive's file list (Rockstar's original or an OPEN archive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPlainToc, readRpfHeader, writeRpfOpen, findAwcs, RPF_OPEN } from '../src/formats/rpf';
import { openPack, exportPack } from '../src/formats/pack';
import { streamToAudio } from '../src/formats/awc';
import { parseMapping } from '../src/formats/mapping';
import { indexPack, planBuild, runBuild, SILENCE, TooLongError } from '../src/projects/build';
import { newProject, assign } from '../src/projects/project';
import { WEAPON_PROFILES } from '../src/weapons/profiles';
import { catalogAwc, synthRpf } from './synthPack';

const shipped = parseMapping(JSON.parse(readFileSync(new URL('../weapon_profiles/mapping.json', import.meta.url), 'utf8')));
const bytesOf = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

test('writeRpfOpen: plain table of contents, sorted names, 512-byte blocks – read back exactly', () => {
  const files = [
    { name: 'weapons.awc', data: bytesOf(1300, 1) },
    { name: 'ambience.awc', data: bytesOf(512, 2) },
    { name: 'b.awc', data: bytesOf(1, 3) },
  ];
  const rpf = writeRpfOpen(files);
  const h = readRpfHeader(rpf);
  assert.equal(h.encryption, 'open');
  assert.equal(h.encryptionRaw, RPF_OPEN);
  assert.equal(h.entryCount, 4);
  assert.equal(h.namesLength % 16, 0);
  const toc = readPlainToc(rpf)!;
  assert.deepEqual(toc.map((f) => f.name), ['ambience.awc', 'b.awc', 'weapons.awc'], 'ordinal order (binary search in the game)');
  for (const f of toc) {
    assert.equal(f.offset % 512, 0);
    assert.ok(f.offset >= h.tocEnd);
    assert.deepEqual(rpf.subarray(f.offset, f.offset + f.length), files.find((x) => x.name === f.name)!.data);
  }
  assert.equal(rpf.length % 512, 0);
});

test('writeRpfOpen refuses bad names', () => {
  assert.throws(() => writeRpfOpen([{ name: 'a/b.awc', data: new Uint8Array(4) }]));
  assert.throws(() => writeRpfOpen([{ name: 'a.awc', data: new Uint8Array(4) }, { name: 'A.awc', data: new Uint8Array(4) }]));
});

test('an NG archive (creator pack) has no readable table of contents', () => {
  assert.equal(readPlainToc(synthRpf([catalogAwc('F03')])), null);
});

/** WEAPONS_PLAYER.rpf + RESIDENT.rpf with a plain table of contents (like SP Tool's own output). */
function openArchives(seconds = 0.3) {
  const f01 = catalogAwc('F01', { seconds: 0.05 });
  return [
    { name: 'WEAPONS_PLAYER.rpf', bytes: writeRpfOpen([
      { name: 'ptl_50cal.awc', data: catalogAwc('F04', { seconds }) },
      { name: 'ptl_pistol.awc', data: catalogAwc('F03', { seconds }) },
      { name: 'zz_other.dat', data: bytesOf(3000, 9) }, // not a sound file – must be copied as is
    ]) },
    { name: 'RESIDENT.rpf', bytes: writeRpfOpen([{ name: 'weapons.awc', data: f01 }]) },
  ];
}

const tone = (sec: number, sr = 44100, f = 0.05) => ({ sampleRate: sr, channels: [Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => Math.sin(i * f) * 0.5)] });

function longProject() {
  let p = newProject('Lang', '');
  p = assign(p, 'pistol', 'fire', { entryId: 'shot' });
  p = assign(p, 'pistol', 'mag_out', { entryId: 'reload' });
  for (const s of ['mag_in', 'slide', 'reload_finish']) p = assign(p, 'pistol', s, { entryId: SILENCE });
  return p;
}

test('OPEN template: a 3 s shot and a 4 s reload go in whole – the archives are rebuilt, nothing else changes', async () => {
  const files = openArchives();
  const pack = openPack(files);
  assert.ok(pack.groups.every((g) => g.canGrow), 'every container may grow');
  const plan = planBuild(longProject(), WEAPON_PROFILES, shipped, pack);
  const shot = tone(3), reload = tone(4, 48000, 0.02);
  const r = await runBuild(plan, pack, async (a) => (a.entryId === 'shot' ? shot : reload) as never, undefined, { allArchives: true });
  for (const o of r.outputs) {
    const src = files.find((f) => f.name === o.name)!;
    assert.ok(o.bytes.length > src.bytes.length, `${o.name} grew`);
    assert.equal(readRpfHeader(o.bytes).encryption, 'open');
    // every file the build did not touch is byte for byte the same
    const before = readPlainToc(src.bytes)!, after = readPlainToc(o.bytes)!;
    assert.deepEqual(after.map((f) => f.name), before.map((f) => f.name));
    for (const f of before) {
      const g = after.find((x) => x.name === f.name)!;
      if (f.name === 'zz_other.dat' || f.name === 'ptl_50cal.awc') assert.deepEqual(o.bytes.subarray(g.offset, g.offset + g.length), src.bytes.subarray(f.offset, f.offset + f.length), f.name);
    }
  }
  // the result opens again and holds both sounds in full length
  const out = openPack(r.outputs);
  const idx = indexPack(out);
  const pistolShot = out.groups[idx.get('F03')![0]].awc.streams.find((s) => s.id === 277856074)!;
  assert.equal(streamToAudio(pistolShot).channels[0].length, shot.channels[0].length, 'shot 1 : 1');
  const reloadId = shipped.entries.find((e) => e.weapon === 'pistol' && e.slot === 'mag_out')!.stream;
  const f01 = out.groups[idx.get('F01')![0]].awc.streams.find((s) => s.id === reloadId)!;
  assert.equal(f01.format.sampleRate, 48000);
  assert.equal(f01.format.samples, reload.channels[0].length, 'reload 1 : 1');
});

test('OPEN template: a sound that fits is patched in place – size and table of contents stay', async () => {
  const files = openArchives(0.5);
  const pack = openPack(files);
  const p = assign(newProject('Kurz', ''), 'pistol', 'fire', { entryId: 'shot' });
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  const r = await runBuild(plan, pack, async () => tone(0.1) as never);
  const wp = r.outputs.find((o) => o.name === 'WEAPONS_PLAYER.rpf')!;
  const src = files[0].bytes;
  assert.equal(wp.bytes.length, src.length);
  const tocEnd = readRpfHeader(src).tocEnd;
  assert.deepEqual(wp.bytes.subarray(0, tocEnd), src.subarray(0, tocEnd));
});

test('a container that is also in a creator archive (encrypted TOC) cannot grow – "zu lang" as before', async () => {
  const f01 = catalogAwc('F01', { seconds: 0.05 });
  const pack = openPack([
    { name: 'WEAPONS_PLAYER.rpf', bytes: writeRpfOpen([{ name: 'weapons.awc', data: f01 }]) },
    { name: 'RESIDENT.rpf', bytes: synthRpf([f01]) },
  ]);
  const g = pack.groups[indexPack(pack).get('F01')![0]];
  assert.equal(g.refs.length, 2);
  assert.equal(g.canGrow, false);
  const plan = planBuild(longProject(), WEAPON_PROFILES, shipped, pack);
  await assert.rejects(runBuild(plan, pack, async () => tone(4) as never), TooLongError);
});

test('exportPack refuses to grow a container in an archive without a known table of contents', () => {
  const awc = catalogAwc('F03', { seconds: 0.2 });
  const pack = openPack([{ name: 'WEAPONS_PLAYER.rpf', bytes: synthRpf([awc]) }]);
  const g = pack.groups[0];
  const s0 = g.awc.streams[0];
  const big = { ...s0, data: new Uint8Array(s0.data.length * 20), format: { ...s0.format, samples: s0.format.samples * 20 } };
  assert.throws(() => exportPack(pack, new Map([[g.id, new Map([[s0.id, big]])]])), /verschlüsseltem Inhaltsverzeichnis/);
});

test('findAwcs reads the containers of an OPEN archive through its table of contents, with names', () => {
  const found = findAwcs(openArchives()[0].bytes);
  assert.deepEqual(found.map((f) => f.name), ['ptl_50cal.awc', 'ptl_pistol.awc']);
});
