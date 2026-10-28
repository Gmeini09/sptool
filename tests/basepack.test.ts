// Base pack: names, encryption check, ZIP extraction (the files a user drops in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { listZip, readZipEntry } from '../src/formats/zip';
import { BaseError, openBase } from '../src/projects/basePack';

const U = '/root/.claude/uploads/b63bda24-5bec-533d-8c83-1ac727a53bce/';
const WP = ['4d29eede-WEAPONS_PLAYER.rpf', '2accd1f2-WEAPONS_PLAYER_1.rpf'].map((f) => U + f).find(existsSync);

function zipOf(files: Array<{ name: string; data: Uint8Array; deflate?: boolean }>): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const comp = f.deflate ? deflateRawSync(f.data) : Buffer.from(f.data);
    const name = Buffer.from(f.name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(f.deflate ? 8 : 0, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(f.deflate ? 8 : 0, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

test('ZIP: stored and deflated entries come out byte-exact', async () => {
  const a = new Uint8Array(5000).map((_, i) => i % 251), b = new TextEncoder().encode('hallo '.repeat(500));
  const z = zipOf([{ name: 'Pack/mods/WEAPONS_PLAYER_2.rpf', data: a, deflate: true }, { name: 'Pack/readme.txt', data: b }]);
  const es = listZip(z);
  assert.deepEqual(es.map((e) => e.name), ['Pack/mods/WEAPONS_PLAYER_2.rpf', 'Pack/readme.txt']);
  assert.deepEqual(await readZipEntry(z, es[0]), a);
  assert.deepEqual(await readZipEntry(z, es[1]), b);
});

test('base pack: real soundpacks (NG table of contents) are accepted, game originals refused', { skip: !WP }, () => {
  const bytes = new Uint8Array(readFileSync(WP!));
  const pack = openBase([{ name: 'weapons_player (3).rpf', bytes }]);
  assert.equal(pack.archives[0].name, 'WEAPONS_PLAYER.rpf');
  assert.ok(pack.groups.length > 10);
  assert.throws(() => openBase([{ name: 'RESIDENT.rpf', bytes }]), BaseError);
  // the game's own archives (sounds encrypted): only the header is readable → refused
  const enc = bytes.slice(0, 4096); enc.fill(0x5a, 512);
  assert.throws(() => openBase([{ name: 'WEAPONS_PLAYER.rpf', bytes: enc }]), /verschlüsselten Originaldateien/);
});
