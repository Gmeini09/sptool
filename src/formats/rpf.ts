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
import { AwcError, parseAwc, type AwcFile } from './awc';
import { originalContainers } from './gtaOriginal';

export const RPF7_MAGIC = 0x52504637; // "7FPR" on disk
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
}

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
export function findAwcs(bytes: Uint8Array): FoundAwc[] {
  const h = readRpfHeader(bytes);
  const original = originalContainers(bytes);
  if (original) return original;
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
