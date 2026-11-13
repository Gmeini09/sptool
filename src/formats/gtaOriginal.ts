// The original GTA V soundpack (x64/audio/sfx: WEAPONS_PLAYER.rpf + RESIDENT.rpf) as a template.
//
// Rockstar ships these archives with an encrypted table of contents (NG) and every AWC file encrypted on its own
// (Rockstar's XXTEA variant). SP Tool does not decrypt the table of contents: the positions of the files in the
// original archives are listed below (recognised by size and a checksum of the table of contents). The AWC key is
// read once from the player's own GTA5.exe – found by its SHA-1 like CodeWalker finds the keys – and kept on this
// PC only. No Rockstar key is part of SP Tool.
//
// A replaced container is written unencrypted at the same place with the same size (the game reads plain AWC files,
// creator packs are made the same way); every other file stays exactly as Rockstar shipped it.
import { parseAwc, AwcError } from './awc';
import type { FoundAwc } from './rpf';

interface OriginalArchive { name: string; size: number; toc: number; files: Array<[string, number, number]> }

/** The original archives (GTA V Legacy, x64/audio/sfx) – name, offset and length of every file. */
const ORIGINAL: OriginalArchive[] = [
  { name: 'WEAPONS_PLAYER.rpf', size: 3883008, toc: 0x481245f5, files: [
    ['lmg_combat.awc', 1024, 55496],
    ['lmg_mg_player.awc', 56832, 140960],
    ['mgn_sml_am83_vera.awc', 198144, 359092],
    ['mgn_sml_am83_verb.awc', 557568, 243812],
    ['mgn_sml_sc__l.awc', 801792, 54256],
    ['ptl_50cal.awc', 856064, 46320],
    ['ptl_combat.awc', 902656, 56744],
    ['ptl_pistol.awc', 959488, 64352],
    ['ptl_px4.awc', 1024000, 112636],
    ['ptl_rubber.awc', 1136640, 64504],
    ['sht_bullpup.awc', 1201152, 219816],
    ['sht_pump.awc', 1421312, 230244],
    ['smg_micro.awc', 1651712, 193048],
    ['smg_smg.awc', 1845248, 277764],
    ['snp_heavy.awc', 2123264, 43280],
    ['snp_rifle.awc', 2166784, 172960],
    ['spl_grenade_player.awc', 2339840, 125328],
    ['spl_minigun_player.awc', 2465280, 383588],
    ['spl_prog_ar_player.awc', 2849280, 314896],
    ['spl_railgun.awc', 3164672, 220160],
    ['spl_rpg_player.awc', 3384832, 144012],
    ['spl_tank_player.awc', 3529216, 353196],
  ] },
  { name: 'RESIDENT.rpf', size: 112785408, toc: 0xaa8ad94b, files: [
    ['ambience.awc', 1024, 4503900],
    ['animals_footsteps.awc', 4505088, 1365200],
    ['collision.awc', 5870592, 17635320],
    ['collisions.awc', 23505920, 9001844],
    ['doors.awc', 32507904, 1143248],
    ['explosions.awc', 33651200, 19805816],
    ['feet_materials.awc', 53457408, 7251360],
    ['feet_resident.awc', 60708864, 1159136],
    ['frontend.awc', 61868032, 6060128],
    ['low_latency.awc', 67928576, 15496],
    ['melee.awc', 67944448, 1784684],
    ['movement.awc', 69729280, 2616864],
    ['player_switch.awc', 72346624, 371636],
    ['vehicles.awc', 72718336, 16519400],
    ['weapons.awc', 89238016, 19466072],
    ['weather.awc', 108704256, 4079904],
  ] },
];

const AWC_KEY_SHA1 = 'c31e0da1c7e5d85502e517290ed07b180a94e911';
const KEY_STORE = 'sptool:gta-awc-key';

/** Opening the original pack needs the AWC key from GTA5.exe first. */
export class NeedGtaKeyError extends Error {
  constructor() { super('Das ist das Original-GTA-Soundpack. Zum Öffnen braucht SP Tool einmal deine GTA5.exe (aus dem GTA-V-Ordner) – in der Windows-App geht das automatisch, sonst zieh die GTA5.exe zusätzlich mit rein.'); this.name = 'NeedGtaKeyError'; }
}

let awcKey: Uint32Array | null = null;
function loadKey(): Uint32Array | null {
  if (awcKey) return awcKey;
  try {
    const s = globalThis.localStorage?.getItem(KEY_STORE);
    if (s && s.length === 32) awcKey = new Uint32Array(Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16))).buffer);
  } catch { /* no storage */ }
  return awcKey;
}
export const hasGtaKey = () => !!loadKey();

/** Uses the 16-byte AWC key (checked against its SHA-1) and keeps it on this PC. */
export function setGtaKey(key: Uint8Array): void {
  if (key.length !== 16 || sha1Hex16(key) !== AWC_KEY_SHA1) throw new Error('Das ist nicht der Schlüssel aus der GTA5.exe.');
  awcKey = new Uint32Array(new Uint8Array(key).buffer);
  try { globalThis.localStorage?.setItem(KEY_STORE, [...key].map((b) => b.toString(16).padStart(2, '0')).join('')); } catch { /* memory only */ }
}

/** Finds the AWC key in a GTA5.exe (8-byte aligned, by SHA-1) – null when it is not in there. */
export function findGtaKey(exe: Uint8Array): Uint8Array | null {
  for (let p = 0; p + 16 <= exe.length; p += 8) {
    const w = exe.subarray(p, p + 16);
    if (sha1Hex16(w) === AWC_KEY_SHA1) return new Uint8Array(w);
  }
  return null;
}

function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The original archive these bytes are (also after SP Tool patched it – the table of contents never changes). */
export function originalArchive(bytes: Uint8Array): OriginalArchive | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 16 || v.getUint32(0, true) !== 0x52504637) return null;
  const tocEnd = 16 + v.getUint32(4, true) * 16 + v.getUint32(8, true);
  if (tocEnd > bytes.length) return null;
  const a = ORIGINAL.find((o) => o.size === bytes.length);
  return a && fnv1a(bytes.subarray(0, tocEnd)) === a.toc ? a : null;
}

const isAdat = (b: Uint8Array, o: number) => b[o] === 0x41 && b[o + 1] === 0x44 && b[o + 2] === 0x41 && b[o + 3] === 0x54;

/** Rockstar's XXTEA variant (decrypt), as documented by the GTA modding tools. */
function xxteaDecrypt(data: Uint8Array, key: Uint32Array): Uint8Array {
  const v = new Uint32Array(data.buffer.slice(data.byteOffset, data.byteOffset + (data.length & ~3)));
  const n = v.length;
  if (n < 2) return new Uint8Array(v.buffer);
  let y = v[0], z: number, sum = Math.imul(0x9e3779b9, 6 + Math.floor(52 / n)) >>> 0;
  do {
    const e = (sum >>> 2) & 3;
    for (let p = n - 1; p >= 0; p--) {
      z = v[(p > 0 ? p : n) - 1];
      const mx = ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + ((key[(p & 3) ^ e] ^ z ^ 0x7b3a207f) >>> 0))) >>> 0;
      y = v[p] = (v[p] - mx) >>> 0;
    }
    sum = (sum - 0x9e3779b9) >>> 0;
  } while (sum !== 0);
  return new Uint8Array(v.buffer);
}

/**
 * The AWC files of an original archive, decrypted (null: not an original archive). A file SP Tool already replaced
 * is plain and read as it is. Every container keeps its place and size; `encrypted` marks the ones still encrypted.
 */
export function originalContainers(bytes: Uint8Array): FoundAwc[] | null {
  const a = originalArchive(bytes);
  if (!a) return null;
  const out: FoundAwc[] = [];
  let key: Uint32Array | null = null;
  for (const [, offset, length] of a.files) {
    const raw = bytes.subarray(offset, offset + length);
    const plain = isAdat(raw, 0);
    if (!plain) { key ??= loadKey(); if (!key) throw new NeedGtaKeyError(); }
    const d = plain ? new Uint8Array(raw) : xxteaDecrypt(raw, key!);
    if (!isAdat(d, 0)) throw new NeedGtaKeyError(); // wrong key (another GTA version)
    // Rockstar's flag for encrypted multi-channel data has no meaning for these single-channel files once decrypted
    new DataView(d.buffer, d.byteOffset, d.byteLength).setUint16(6, 0xff01, true);
    try { out.push({ offset, length, awc: parseAwc(d), encrypted: !plain }); }
    catch (e) { if (!(e instanceof AwcError)) throw e; /* not a sound file SP Tool can use (e.g. low_latency.awc) */ }
  }
  return out;
}

// ── SHA-1 of a 16-byte block (key search; one padded 64-byte block) ──────────────────────────────────────────────
const W = new Uint32Array(80);
function sha1Hex16(m: Uint8Array): string {
  for (let i = 0; i < 4; i++) W[i] = (m[i * 4] << 24) | (m[i * 4 + 1] << 16) | (m[i * 4 + 2] << 8) | m[i * 4 + 3];
  W[4] = 0x80000000; for (let i = 5; i < 15; i++) W[i] = 0; W[15] = 128;
  for (let i = 16; i < 80; i++) { const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = (x << 1) | (x >>> 31); }
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476, e = 0xc3d2e1f0;
  for (let i = 0; i < 80; i++) {
    const f = i < 20 ? ((b & c) | (~b & d)) + 0x5a827999 : i < 40 ? (b ^ c ^ d) + 0x6ed9eba1 : i < 60 ? ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc : (b ^ c ^ d) + 0xca62c1d6;
    const t = (((a << 5) | (a >>> 27)) + f + e + W[i]) | 0;
    e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
  }
  return [a + 0x67452301, b + 0xefcdab89, c + 0x98badcfe, d + 0x10325476, e + 0xc3d2e1f0].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
