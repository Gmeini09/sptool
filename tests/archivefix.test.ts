// The OpenIV + ArchiveFix way: a growing sound rebuilds the archive with an open table of contents (marked open, so
// ArchiveFix runs on it), and "Prüfen" tells an archive ArchiveFix has encrypted from one it has not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { synthPack } = await import('./synthPack');
const { openPack, setArchiveFixMode, isArchiveFixMode } = await import('../src/formats/pack');
const { writeAwc } = await import('../src/formats/awc');
const { writeRpfOpen, readRpfHeader } = await import('../src/formats/rpf');
const { parseMapping } = await import('../src/formats/mapping');
const { planBuild, runBuild, indexPack } = await import('../src/projects/build');
const { newProject, assign } = await import('../src/projects/project');
const { WEAPON_PROFILES } = await import('../src/weapons/profiles');
const { compareWithMods } = await import('../src/services/modsCheck');
const shipped = parseMapping(JSON.parse(readFileSync(new URL('../weapon_profiles/mapping.json', import.meta.url), 'utf8')));
const tone = (sec: number, f = 220, sr = 44100) => { const n = Math.round(sec * sr), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / sr) * 0.5; return { sampleRate: sr, channels: [x, x] }; };

test('a sound longer than its place: the archive is rebuilt open (like OpenIV) and marked for ArchiveFix', async () => {
  const src = openPack(synthPack());
  const idx = indexPack(src);
  const awc = (k: string) => writeAwc(src.groups[idx.get(k)![0]].awc);
  const files = [
    { name: 'WEAPONS_PLAYER.rpf', bytes: writeRpfOpen([{ name: 'ptl_pistol.awc', data: awc('F03') }, { name: 'ptl_50cal.awc', data: awc('F02') }]) },
    { name: 'RESIDENT.rpf', bytes: writeRpfOpen([{ name: 'weapons.awc', data: awc('F01') }]) },
  ];
  const pack = openPack(files);
  const p = assign(newProject('t', 'x'), 'pistol', 'fire', { entryId: 'shot' });
  const r = await runBuild(planBuild(p, WEAPON_PROFILES, shipped, pack), pack, async () => tone(4), undefined, { allArchives: true });
  assert.ok(r.archiveFix);
  for (const o of r.outputs) {
    assert.equal(o.open, readRpfHeader(o.bytes).encryption === 'open', o.name);
    assert.ok(o.open, `${o.name} is rebuilt open`);
  }
});

test('ArchiveFix mode is a switch (set when ArchiveFix.exe with its keys is found)', () => {
  assert.equal(isArchiveFixMode(), false);
  setArchiveFixMode(true);
  assert.equal(isArchiveFixMode(), true);
  setArchiveFixMode(false);
});

test('Prüfen: the exact open file in sfx still needs ArchiveFix, the same size with another hash is ours after ArchiveFix', () => {
  const scan = (sha256: string, size: number) => ({ modsDir: 'sfx', running: false, files: [{ path: 'RESIDENT.rpf', name: 'RESIDENT.rpf', depth: 0, size, modified: 0, sha256 }] });
  const built = [{ name: 'RESIDENT.rpf', sha256: 'aaa', size: 1000, open: true }];
  assert.equal(compareWithMods(built, scan('aaa', 1000)).files[0].state.kind, 'needsFix');
  assert.equal(compareWithMods(built, scan('bbb', 1000)).files[0].state.kind, 'ok');
  assert.equal(compareWithMods(built, scan('bbb', 999)).files[0].state.kind, 'old');
  assert.equal(compareWithMods([{ name: 'RESIDENT.rpf', sha256: 'aaa' }], scan('aaa', 1000)).files[0].state.kind, 'ok', 'already encrypted: exact file is right');
});
