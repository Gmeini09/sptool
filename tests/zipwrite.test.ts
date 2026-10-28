// Phones/browsers get the finished soundpack as one ZIP: it must open with our own reader and carry a correct CRC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, writeZip } from '../src/formats/zipWrite';
import { listZip, readZipEntry } from '../src/formats/zip';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('writeZip → listZip/readZipEntry round trip, folder kept, names in UTF-8', async () => {
  const a = new Uint8Array(70_000).map((_, i) => (i * 7) & 0xff);
  const b = new TextEncoder().encode('RPF7 test');
  const z = writeZip([{ name: 'Mein Soundpack/WEAPONS_PLAYER.rpf', bytes: a }, { name: 'Mein Soundpack/RESIDENT.rpf', bytes: b }, { name: 'Ü/ä.txt', bytes: new Uint8Array() }]);
  const e = listZip(z);
  assert.deepEqual(e.map((x) => x.name), ['Mein Soundpack/WEAPONS_PLAYER.rpf', 'Mein Soundpack/RESIDENT.rpf', 'Ü/ä.txt']);
  assert.deepEqual(await readZipEntry(z, e[0]), a);
  assert.deepEqual(await readZipEntry(z, e[1]), b);
  const v = new DataView(z.buffer, z.byteOffset);
  assert.equal(v.getUint32(14, true), crc32(a), 'CRC in the local header');
});
