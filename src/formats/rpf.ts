// RPF7 archive support (GTA V). Verified against the reference soundpack
// (docs/REFERENCE_ANALYSIS.md).
//
// What works without game keys:
//  • header inspection (entry count, encryption type)
//  • locating AWC containers whose file data is stored unencrypted
//  • same-size in-place replacement of such a container in a COPY of the archive:
//    because the replacement has exactly the same byte length, the (encrypted)
//    table of contents stays valid and is never touched.
//
// The original game archives (encrypted table of contents and encrypted AWC files) are
// read through gtaOriginal.ts: known file positions + the AWC key from the user's GTA5.exe.
//
// Containers that grow are written the way OpenIV does it when a creator replaces a file by hand (appendRpfNg):
// the new file is appended at the end of the archive, the table of contents points to it, and the table of contents
// is encrypted again with Rockstar's NG cipher (ngCrypto.ts). Every other byte of the archive stays as it was.
// Archives with a plain table of contents (OPEN) are rebuilt with writeRpfOpen.
import { AwcError, parseAwc, type AwcFile } from './awc';
import { containersFromToc, originalArchive, originalContainers } from './gtaOriginal';
import { activeNgKeys, ngDecrypt, ngEncrypt, ngKeyFor } from './ngCrypto';

export const RPF7_MAGIC = 0x52504637; // "7FPR" on disk
/** Encryption id of a plain table of contents ("OPEN", OpenIV style). */
export const RPF_OPEN = 0x4e45504f;
const BLOCK = 512;
export type RpfEncryption = 'none' | 'open' | 'aes' | 'ng' | 'unknown';

export interface RpfHeader {
  entryCount: number;
  namesLength: number;
  encryptionRaw: number;
  encryption: RpfEncryption;
  /** first byte after the table of contents (file data never starts before this) */
  tocEnd: number;
}

export interface FoundAwc {
  /** byte offset of the container inside the archive (512-byte aligned) */
  offset: number;
  /** exact container length as derived from its own chunk table */
  length: number;
  awc: AwcFile;
  /** still encrypted in the archive (original GTA file) – replaced by the plain file when patched */
  encrypted?: boolean;
  /** file name inside the archive, when the table of contents is known */
  name?: string;
}

/** One file of an archive whose table of contents is known. */
export interface TocFile { name: string; offset: number; length: number }

export class RpfError extends Error {}

export function readRpfHeader(bytes: Uint8Array): RpfHeader {
  if (bytes.byteLength < 16) throw new RpfError('Die Datei ist zu klein für ein RPF-Archiv.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== RPF7_MAGIC) throw new RpfError('Kein RPF7-Archiv (GTA V).');
  const entryCount = v.getUint32(4, true);
  const namesLength = v.getUint32(8, true);
  const enc = v.getUint32(12, true);
  const encryption: RpfEncryption =
    enc === 0 ? 'none' : enc === 0x4e45504f ? 'open' : enc === 0x0ffffff9 ? 'aes' : enc === 0x0fefffff ? 'ng' : 'unknown';
  return { entryCount, namesLength, encryptionRaw: enc, encryption, tocEnd: 16 + entryCount * 16 + namesLength };
}

/** Exact length of an AWC from its chunk table (end of the last chunk). */
export function awcLength(bytes: Uint8Array, offset: number): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
  const count = v.getInt32(8, true);
  const flags = v.getUint16(6, true);
  let p = 16 + (flags & 1 ? 2 * count : 0);
  const chunkCounts: number[] = [];
  for (let i = 0; i < count; i++, p += 4) chunkCounts.push(v.getUint32(p, true) >>> 29);
  let end = 0;
  for (const cc of chunkCounts) for (let c = 0; c < cc; c++, p += 8) {
    const lo = v.getUint32(p, true), hi = v.getUint32(p + 4, true);
    const size = ((hi & 0x00ffffff) << 4) | (lo >>> 28);
    const off = lo & 0x0fffffff;
    end = Math.max(end, off + size);
  }
  return end;
}

/**
 * Finds AWC containers stored unencrypted. RPF file data is 512-byte aligned, so only block
 * starts are checked – this avoids false hits inside audio data.
 */
export function findAwcs(bytes: Uint8Array, name?: string): FoundAwc[] {
  const h = readRpfHeader(bytes);
  const original = originalContainers(bytes);
  if (original) return original;
  // a table of contents SP Tool can read (plain, or NG with the keys loaded): every file is listed there
  const toc = readPlainToc(bytes) ?? (name ? readNgToc(bytes, name)?.files ?? null : null);
  if (toc) return containersFromToc(bytes, toc);
  const out: FoundAwc[] = [];
  const start = Math.ceil(h.tocEnd / 512) * 512;
  for (let o = start; o + 16 <= bytes.byteLength; o += 512) {
    if (bytes[o] !== 0x41 || bytes[o + 1] !== 0x44 || bytes[o + 2] !== 0x41 || bytes[o + 3] !== 0x54) continue;
    try {
      const length = awcLength(bytes, o);
      if (length <= 16 || o + length > bytes.byteLength) continue;
      const awc = parseAwc(bytes.subarray(o, o + length));
      out.push({ offset: o, length, awc });
      o += Math.floor((length - 1) / 512) * 512; // skip the container body
    } catch (e) {
      if (!(e instanceof AwcError)) throw e;
    }
  }
  return out;
}

/**
 * Returns a patched COPY of the archive with one container replaced. Refuses anything that
 * would change the container size, because the table of contents would then be wrong.
 */
export function patchAwcInPlace(archive: Uint8Array, target: { offset: number; length: number; encrypted?: boolean }, newAwc: Uint8Array): Uint8Array {
  if (newAwc.byteLength !== target.length) {
    throw new RpfError(`Der Ersatz-Container hat ${newAwc.byteLength} Bytes, muss aber genau ${target.length} Bytes haben, damit das Archiv gültig bleibt.`);
  }
  const h = readRpfHeader(archive);
  if (target.offset < h.tocEnd || target.offset % 512 !== 0 || target.offset + target.length > archive.byteLength) {
    throw new RpfError('Die Zielposition des Containers liegt nicht im Datenbereich des Archivs.');
  }
  const v = new DataView(archive.buffer, archive.byteOffset + target.offset, 4);
  if (!target.encrypted && v.getUint32(0, true) !== 0x54414441) throw new RpfError('An der Zielposition liegt kein AWC-Container.');
  const copy = new Uint8Array(archive); // original stays untouched
  copy.set(newAwc, target.offset);
  return copy;
}

// ── Plain table of contents (OPEN) ───────────────────────────────────────────────────────────────────────────────
//
// RPF7 layout: header (16 B) | entries (16 B each) | names (zero-terminated, padded to 16 B) | file data (512-B blocks)
//   directory entry: u32 nameOffset | u32 0x7FFFFF00 | u32 firstEntry | u32 entryCount
//   binary file:     u16 nameOffset | u24 packedSize (0 = stored) | u24 offset in 512-B blocks | u32 size | u32 encrypted
// Entries of a directory are sorted by name (ordinal) – the game looks files up by binary search.

const DIR_MARK = 0x7fffff00;

/**
 * The files of an archive with a readable table of contents (OPEN or none), with their full path ("dir/name.awc").
 * null for an encrypted table of contents or when the archive holds packed/encrypted files or resources.
 */
export function readPlainToc(bytes: Uint8Array): TocFile[] | null {
  let h: RpfHeader;
  try { h = readRpfHeader(bytes); } catch { return null; }
  if (h.encryption !== 'open' && h.encryption !== 'none') return null;
  return parseToc(bytes, h, bytes.byteLength);
}

/**
 * Parses a table of contents that is plain in `bytes` (at least header + table; the header's encryption field is not
 * looked at). total: size of the whole archive, to check that every file lies inside it.
 */
function parseToc(bytes: Uint8Array, h: RpfHeader, total: number): TocFile[] | null {
  if (h.entryCount < 1 || h.tocEnd > bytes.byteLength) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const namesAt = 16 + h.entryCount * 16;
  const nameOf = (off: number) => {
    let s = '';
    for (let p = namesAt + off; p < h.tocEnd && bytes[p] !== 0; p++) s += String.fromCharCode(bytes[p]);
    return s;
  };
  const out: TocFile[] = [];
  const walk = (index: number, prefix: string, depth: number): boolean => {
    const e = 16 + index * 16;
    if (depth > 32 || v.getUint32(e + 4, true) !== DIR_MARK) return false;
    const first = v.getUint32(e + 8, true), count = v.getUint32(e + 12, true);
    if (first + count > h.entryCount) return false;
    for (let i = first; i < first + count; i++) {
      const p = 16 + i * 16, x = v.getUint32(p + 4, true);
      if (x === DIR_MARK) {
        if (!walk(i, `${prefix}${nameOf(v.getUint32(p, true))}/`, depth + 1)) return false;
        continue;
      }
      if (x & 0x80000000) return false; // resource file – not something SP Tool writes
      const packed = v.getUint16(p + 2, true) | (v.getUint8(p + 4) << 16);
      const blocks = v.getUint8(p + 5) | (v.getUint8(p + 6) << 8) | (v.getUint8(p + 7) << 16);
      const size = v.getUint32(p + 8, true), enc = v.getUint32(p + 12, true);
      if (packed !== 0 || enc !== 0) return false;
      const offset = blocks * BLOCK;
      if (offset + size > total) return false;
      out.push({ name: prefix + nameOf(v.getUint16(p, true)), offset, length: size });
    }
    return true;
  };
  try { return walk(0, '', 0) ? out : null; } catch { return null; }
}

/**
 * The complete file list of an archive SP Tool can rebuild: Rockstar's original (positions known, also after an
 * in-place patch) or one with a plain table of contents. null: unknown layout (a creator pack with an encrypted table
 * of contents) – such an archive can only be patched in place.
 */
export function knownToc(bytes: Uint8Array, name?: string): TocFile[] | null {
  const a = originalArchive(bytes);
  if (a) return a.files.map(([n, offset, length]) => ({ name: n, offset, length }));
  return readPlainToc(bytes) ?? (name ? readNgToc(bytes, name)?.files ?? null : null);
}

// ── NG table of contents (OpenIV / Rockstar) ─────────────────────────────────────────────────────────────────────

/** Names an NG key may be derived from: the file's own name, then the game name it is installed as. */
function ngNames(name: string): string[] {
  const base = name.split(/[\\/]/).pop() ?? name;
  const n = base.toLowerCase();
  const game = /weapons_?player/.test(n) ? 'WEAPONS_PLAYER.rpf' : /(^|[^a-z])resident([^a-z]|$)/.test(n) ? 'RESIDENT.rpf' : null;
  return [...new Set([base, game].filter((x): x is string => !!x))];
}

export interface NgToc { files: TocFile[]; name: string; entries: Uint8Array; names: Uint8Array }

/**
 * Decrypts the NG table of contents (needs the keys – ngKeys service). The key depends on the archive's file name and
 * size; the name it was saved under is tried first, then the game name. null when it cannot be read.
 */
export function readNgToc(bytes: Uint8Array, name: string): NgToc | null {
  const k = activeNgKeys();
  if (!k) return null;
  let h: RpfHeader;
  try { h = readRpfHeader(bytes); } catch { return null; }
  if (h.encryption !== 'ng' || h.tocEnd > bytes.byteLength) return null;
  const eEnd = 16 + h.entryCount * 16;
  for (const n of ngNames(name)) {
    const key = ngKeyFor(k, n, bytes.byteLength);
    const entries = ngDecrypt(k, key, bytes.subarray(16, eEnd)), names = ngDecrypt(k, key, bytes.subarray(eEnd, h.tocEnd));
    const plain = new Uint8Array(h.tocEnd);
    plain.set(bytes.subarray(0, 16)); plain.set(entries, 16); plain.set(names, eEnd);
    const files = parseToc(plain, h, bytes.byteLength);
    if (files && files.length && files.every((f) => /^[\x20-\x7e]+$/.test(f.name))) return { files, name: n, entries, names };
  }
  return null;
}

/**
 * Replaces files the way OpenIV does when a creator swaps them by hand: every new file is appended at the end of the
 * archive (512-byte aligned), its entry points there, and the table of contents is encrypted again with NG (the key
 * depends on the new archive size). Unchanged files keep their place and bytes. replacements: old file offset → data.
 */
export function appendRpfNg(bytes: Uint8Array, name: string, replacements: Map<number, Uint8Array>): Uint8Array {
  const k = activeNgKeys();
  if (!k) throw new NeedNgKeysError();
  const toc = readNgToc(bytes, name);
  if (!toc) throw new RpfError(`${name}: Das Inhaltsverzeichnis ließ sich nicht entschlüsseln.`);
  const h = readRpfHeader(bytes);
  const entries = new Uint8Array(toc.entries);
  const ev = new DataView(entries.buffer);
  let size = Math.ceil(bytes.byteLength / BLOCK) * BLOCK;
  const placed: Array<{ at: number; data: Uint8Array }> = [];
  const done = new Set<number>();
  for (let i = 0; i < h.entryCount; i++) {
    const e = i * 16, x = ev.getUint32(e + 4, true);
    if (x === DIR_MARK || x & 0x80000000) continue;
    const off = (entries[e + 5] | (entries[e + 6] << 8) | (entries[e + 7] << 16)) * BLOCK;
    const data = replacements.get(off);
    if (!data) continue;
    const blocks = size / BLOCK;
    if (blocks > 0xffffff) throw new RpfError('Das Archiv würde größer als 8 GB.');
    entries[e + 2] = 0; entries[e + 3] = 0; entries[e + 4] = 0; // stored as is
    entries[e + 5] = blocks & 0xff; entries[e + 6] = (blocks >>> 8) & 0xff; entries[e + 7] = (blocks >>> 16) & 0xff;
    ev.setUint32(e + 8, data.length, true);
    ev.setUint32(e + 12, 0, true);
    placed.push({ at: size, data });
    size += Math.ceil(Math.max(1, data.length) / BLOCK) * BLOCK;
    done.add(off);
  }
  for (const off of replacements.keys()) if (!done.has(off)) throw new RpfError(`${name}: Datei bei ${off} steht nicht im Inhaltsverzeichnis.`);
  const out = new Uint8Array(size);
  out.set(bytes);
  for (const p of placed) out.set(p.data, p.at);
  const key = ngKeyFor(k, toc.name, size);
  const eEnd = 16 + h.entryCount * 16;
  out.set(ngEncrypt(k, key, entries), 16);
  out.set(ngEncrypt(k, key, toc.names), eEnd);
  return out;
}

export class NeedNgKeysError extends Error {
  constructor() {
    super('Für lange Sounds braucht SP Tool einmal die Schlüssel zum Speichern der GTA-Archive (wie OpenIV): aus deiner GTA5.exe und CodeWalkers magic.dat. Starte SP Tool mit Internet und GTA V auf dem PC (oder zieh die GTA5.exe rein).');
    this.name = 'NeedNgKeysError';
  }
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Writes a new archive with a plain table of contents (OPEN) holding exactly these files, stored unpacked, each on a
 * 512-byte boundary. Only files in the root folder (the layout of the GTA sound archives).
 */
export function writeRpfOpen(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const list = [...files].sort((a, b) => ordinal(a.name, b.name));
  const seen = new Set<string>();
  for (const f of list) {
    if (!f.name || /[\\/]/.test(f.name) || /[^\x20-\x7e]/.test(f.name)) throw new RpfError(`Ungültiger Dateiname im Archiv: „${f.name}“.`);
    if (seen.has(f.name.toLowerCase())) throw new RpfError(`Datei doppelt im Archiv: ${f.name}.`);
    seen.add(f.name.toLowerCase());
  }
  // names: root "" first, then every file in entry order (zero-terminated), padded to 16 bytes
  const nameOffsets: number[] = [];
  let namesLen = 1;
  for (const f of list) { nameOffsets.push(namesLen); namesLen += f.name.length + 1; }
  if (namesLen > 0xffff) throw new RpfError('Zu viele Dateinamen für ein RPF-Archiv.');
  namesLen = (namesLen + 15) & ~15;
  const entryCount = 1 + list.length;
  const tocEnd = 16 + entryCount * 16 + namesLen;
  const offsets: number[] = [];
  let p = Math.ceil(tocEnd / BLOCK) * BLOCK;
  for (const f of list) {
    offsets.push(p);
    p += Math.ceil(Math.max(1, f.data.length) / BLOCK) * BLOCK;
  }
  if (p / BLOCK > 0xffffff) throw new RpfError('Das Archiv würde größer als 8 GB.');
  const out = new Uint8Array(p);
  const v = new DataView(out.buffer);
  v.setUint32(0, RPF7_MAGIC, true);
  v.setUint32(4, entryCount, true);
  v.setUint32(8, namesLen, true);
  v.setUint32(12, RPF_OPEN, true);
  // root directory
  v.setUint32(16, 0, true); v.setUint32(20, DIR_MARK, true); v.setUint32(24, 1, true); v.setUint32(28, list.length, true);
  list.forEach((f, i) => {
    if (f.data.length > 0xffffffff) throw new RpfError(`${f.name} ist zu groß.`);
    const e = 16 + (i + 1) * 16, blocks = offsets[i] / BLOCK;
    v.setUint16(e, nameOffsets[i], true);
    out[e + 2] = 0; out[e + 3] = 0; out[e + 4] = 0; // packed size 0 = stored as is
    out[e + 5] = blocks & 0xff; out[e + 6] = (blocks >>> 8) & 0xff; out[e + 7] = (blocks >>> 16) & 0xff;
    v.setUint32(e + 8, f.data.length, true);
    v.setUint32(e + 12, 0, true);
    for (let c = 0; c < f.name.length; c++) out[16 + entryCount * 16 + nameOffsets[i] + c] = f.name.charCodeAt(c);
    out.set(f.data, offsets[i]);
  });
  return out;
}
