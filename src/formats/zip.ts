// Minimal ZIP reader (stored + deflate) – to take WEAPONS_PLAYER.rpf / RESIDENT.rpf straight out of a downloaded
// soundpack ZIP. Uses the browser's DecompressionStream('deflate-raw'); no dependencies.
export class ZipError extends Error {}

export interface ZipEntry { name: string; size: number; method: number; compSize: number; offset: number }

export function listZip(b: Uint8Array): ZipEntry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.byteLength - 22; i >= Math.max(0, b.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError('Keine gültige ZIP-Datei.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.byteLength || v.getUint32(p, true) !== 0x02014b50) throw new ZipError('ZIP-Inhaltsverzeichnis beschädigt.');
    const method = v.getUint16(p + 10, true), compSize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), offset = v.getUint32(p + 42, true);
    out.push({ name: dec.decode(b.subarray(p + 46, p + 46 + nl)), size, method, compSize, offset });
    p += 46 + nl + xl + cl;
  }
  return out;
}

export async function readZipEntry(b: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(e.offset, true) !== 0x04034b50) throw new ZipError(`${e.name}: beschädigt.`);
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const data = b.subarray(start, start + e.compSize);
  if (e.method === 0) return data.slice();
  if (e.method !== 8) throw new ZipError(`${e.name}: Kompressionsart ${e.method} wird nicht unterstützt (bitte als normales ZIP packen).`);
  const out = await new Response(new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  return new Uint8Array(out);
}
