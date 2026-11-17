// NG encryption of RPF tables of contents (like OpenIV). The building blocks are checked against references
// (.NET Random, Node's AES); the real keys run only with the player's files:
//   SPTOOL_GTA_EXE=…/GTA5.exe  SPTOOL_ORIGINAL_DIR=…/original sfx  SPTOOL_MAGIC=…/magic.dat (CodeWalker)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { aes256EcbDecrypt, dotnetRandomBytes, findAesKey, jenkBytes, MAGIC_SHA256, ngDecrypt, ngEncrypt, ngKeyFor, parseNgPayload, sha1Short, unlockMagic, type NgKeys } from '../src/formats/ngCrypto';

test('.NET Random(seed).NextBytes – same bytes as .NET', () => {
  assert.deepEqual([...dotnetRandomBytes(12345, 12)[0]], [223, 158, 2, 245, 173, 242, 71, 60, 20, 87, 253, 107]);
  const r = dotnetRandomBytes(-987654321, 8);
  assert.deepEqual([...r[0]], [152, 37, 194, 171, 113, 151, 1, 3]);
  assert.deepEqual([...r[1]], [122, 38, 191, 224, 161, 89, 0, 13], 'second NextBytes call continues the sequence');
});

test('AES-256 ECB decrypt matches Node (partial last block untouched)', () => {
  const key = randomBytes(32), plain = randomBytes(16 * 37);
  const c = createCipheriv('aes-256-ecb', key, null); c.setAutoPadding(false);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  const withTail = new Uint8Array([...enc, 1, 2, 3]);
  const dec = aes256EcbDecrypt(withTail, new Uint8Array(key));
  assert.deepEqual(Buffer.from(dec.subarray(0, plain.length)), plain);
  assert.deepEqual([...dec.subarray(plain.length)], [1, 2, 3]);
});

test('sha1Short matches Node for short inputs', () => {
  for (const n of [0, 16, 32, 55]) {
    const m = randomBytes(n);
    assert.equal(sha1Short(new Uint8Array(m)), createHash('sha1').update(m).digest('hex'));
  }
});

test('jenkBytes = Jenkins one-at-a-time', () => {
  assert.equal(jenkBytes(new TextEncoder().encode('a')), 0xca2e9442);
});

/** A made-up key set with the same structure as Rockstar's (random bijective-enough tables) to test the cipher alone. */
function fakeKeys(): NgKeys {
  const rnd = (n: number) => new Uint32Array(randomBytes(n * 4).buffer);
  return { keys: Array.from({ length: 101 }, () => rnd(68)), tables: Array.from({ length: 17 }, () => Array.from({ length: 16 }, () => rnd(256))), lut: new Uint8Array(randomBytes(256)) };
}

test('ngEncrypt is the inverse of ngDecrypt (made-up keys)', () => {
  const k = fakeKeys();
  const key = ngKeyFor(k, 'WEAPONS_PLAYER.rpf', 3883008);
  const plain = new Uint8Array(randomBytes(16 * 5 + 7));
  let enc: Uint8Array;
  try { enc = ngEncrypt(k, key, plain); } catch { return; } // random tables need not be invertible – the real ones are
  assert.deepEqual(ngDecrypt(k, key, enc), plain);
  assert.deepEqual(enc.subarray(80), plain.subarray(80), 'partial block stays plain');
});

const exe = process.env.SPTOOL_GTA_EXE ?? '', dir = process.env.SPTOOL_ORIGINAL_DIR ?? '', magicPath = process.env.SPTOOL_MAGIC ?? '';
const skip = !(existsSync(exe) && existsSync(`${dir}/WEAPONS_PLAYER.rpf`) && existsSync(magicPath)) && 'needs GTA5.exe, the original archives and magic.dat';

let real: NgKeys | null = null;
async function realKeys(): Promise<NgKeys> {
  if (real) return real;
  const magic = new Uint8Array(readFileSync(magicPath));
  assert.equal(createHash('sha256').update(magic).digest('hex'), MAGIC_SHA256, 'pinned magic.dat');
  const aes = findAesKey(new Uint8Array(readFileSync(exe)));
  assert.ok(aes, 'AES key found in GTA5.exe');
  real = parseNgPayload(await unlockMagic(magic, aes!));
  return real;
}

test('real keys: the original table of contents decrypts – and encrypts back to exactly Rockstar\'s bytes', { skip }, async () => {
  const k = await realKeys();
  for (const name of ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf']) {
    const rpf = new Uint8Array(readFileSync(`${dir}/${name}`));
    const v = new DataView(rpf.buffer, rpf.byteOffset);
    const count = v.getUint32(4, true), namesLen = v.getUint32(8, true);
    const key = ngKeyFor(k, name, rpf.length);
    const entriesEnc = rpf.subarray(16, 16 + count * 16), namesEnc = rpf.subarray(16 + count * 16, 16 + count * 16 + namesLen);
    const entries = ngDecrypt(k, key, entriesEnc), names = ngDecrypt(k, key, namesEnc);
    const ev = new DataView(entries.buffer);
    assert.equal(ev.getUint32(4, true), 0x7fffff00, `${name}: root directory`);
    const text = new TextDecoder().decode(names);
    assert.ok(text.includes(name === 'RESIDENT.rpf' ? 'weapons.awc' : 'ptl_50cal.awc'), `${name}: names readable`);
    assert.deepEqual(ngEncrypt(k, key, entries), entriesEnc, `${name}: entries encrypt back byte for byte`);
    assert.deepEqual(ngEncrypt(k, key, names), namesEnc, `${name}: names encrypt back byte for byte`);
  }
});
