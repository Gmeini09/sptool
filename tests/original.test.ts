// The original GTA V soundpack as a template. Needs the player's files, so it only runs with
//   SPTOOL_GTA_EXE=…/GTA5.exe  SPTOOL_ORIGINAL_DIR=…/folder with the original WEAPONS_PLAYER.rpf + RESIDENT.rpf
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { findGtaKey, setGtaKey, originalArchive, NeedGtaKeyError, isExactOriginal } = await import('../src/formats/gtaOriginal');
const { openPack } = await import('../src/formats/pack');
const { streamToAudio } = await import('../src/formats/awc');
const { parseMapping } = await import('../src/formats/mapping');
const { planBuild, runBuild, indexPack } = await import('../src/projects/build');
const { newProject, assign } = await import('../src/projects/project');
const { WEAPON_PROFILES } = await import('../src/weapons/profiles');

const exe = process.env.SPTOOL_GTA_EXE ?? '', dir = process.env.SPTOOL_ORIGINAL_DIR ?? '';
const skip = !(existsSync(exe) && existsSync(`${dir}/WEAPONS_PLAYER.rpf`)) && 'original GTA files not available';
const files = () => ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf'].map((name) => ({ name, bytes: new Uint8Array(readFileSync(`${dir}/${name}`)) }));
const shipped = parseMapping(JSON.parse(readFileSync(new URL('../weapon_profiles/mapping.json', import.meta.url), 'utf8')));

test('original pack: recognised, needs the key, the key is found in GTA5.exe', { skip }, () => {
  const f = files();
  assert.equal(originalArchive(f[0].bytes)?.name, 'WEAPONS_PLAYER.rpf');
  assert.equal(originalArchive(f[1].bytes)?.name, 'RESIDENT.rpf');
  assert.throws(() => openPack(f), NeedGtaKeyError);
  const key = findGtaKey(new Uint8Array(readFileSync(exe)));
  assert.ok(key, 'key found');
  setGtaKey(key!);
});

test('original pack as template: every sound file opens, the pistol shot is written 1 : 1, nothing else changes', { skip }, async () => {
  const f = files();
  const pack = openPack(f);
  const idx = indexPack(pack);
  for (const k of ['F01', 'F02', 'F03', 'F04']) assert.ok(idx.has(k), k);
  const p = assign(newProject('Original', ''), 'pistol', 'fire', { entryId: 'a' });
  const plan = planBuild(p, WEAPON_PROFILES, shipped, pack);
  const n = Math.round(0.5 * 44100), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.05) * 0.4 * Math.exp(-i / 8000);
  const r = await runBuild(plan, pack, async () => ({ sampleRate: 44100, channels: [x] }), undefined, { allArchives: true });
  for (const o of r.outputs) {
    const src = f.find((s) => s.name === o.name)!;
    assert.equal(o.bytes.length, src.bytes.length, `${o.name} size`);
    assert.deepEqual(o.bytes.subarray(0, 4096), src.bytes.subarray(0, 4096), `${o.name}: table of contents untouched`);
  }
  // the result opens again (plain replaced files + still encrypted originals) and holds the shot 1 : 1
  const out = openPack(r.outputs);
  const shot = out.groups[indexPack(out).get('F03')![0]].awc.streams.find((s) => s.id === 277856074)!;
  assert.equal(shot.format.sampleRate, 44100);
  const a = streamToAudio(shot).channels[0];
  assert.equal(a.length, n);
  for (let i = 0; i < n; i += 101) assert.ok(Math.abs(a[i] - x[i]) < 1 / 16000);
  // every file the build did not touch is byte for byte Rockstar's
  const wp = r.outputs.find((o) => o.name === 'WEAPONS_PLAYER.rpf')!.bytes, wp0 = f[0].bytes;
  const changed: number[] = [];
  for (let o = 0; o < wp.length; o += 512) if (wp[o] !== wp0[o] || wp[o + 7] !== wp0[o + 7]) changed.push(o);
  assert.ok(changed.length > 0 && changed.every((o) => o >= 959488 && o < 959488 + 64512), `only ptl_pistol.awc changed (${changed.length} blocks)`);
});

test('only the untouched original is accepted – a custom pack patched in place (same size, same TOC) is not', { skip }, async () => {
  const f = files();
  assert.ok(await isExactOriginal('WEAPONS_PLAYER.rpf', f[0].bytes));
  assert.ok(await isExactOriginal('RESIDENT.rpf', f[1].bytes));
  const patched = new Uint8Array(f[0].bytes); patched[959488 + 200] ^= 0xff; // one byte of ptl_pistol.awc
  assert.ok(originalArchive(patched), 'looks like the original by size and table of contents');
  assert.equal(await isExactOriginal('WEAPONS_PLAYER.rpf', patched), false, 'but is not taken as template');
});
