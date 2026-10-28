// Soundpack = several RPF archives edited together (e.g. WEAPONS_PLAYER.rpf + RESIDENT.rpf).
// Reference packs store some AWC containers byte-identically in more than one archive.
// If only one copy were replaced, the game could load the old copy from the other archive
// (sounds "bug", e.g. with attachments). Containers are therefore grouped by content and
// every copy is patched identically.
import { writeAwc, type AwcFile, type AwcStream } from './awc';
import { findAwcs, patchAwcInPlace, readRpfHeader, type FoundAwc, type RpfHeader } from './rpf';

export interface PackArchive { name: string; bytes: Uint8Array; header: RpfHeader; containers: FoundAwc[] }
export interface ContainerRef { archive: number; index: number; offset: number; length: number }
export interface ContainerGroup { id: number; awc: AwcFile; length: number; refs: ContainerRef[] }
export interface Pack { archives: PackArchive[]; groups: ContainerGroup[] }

function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function openPack(files: Array<{ name: string; bytes: Uint8Array }>): Pack {
  const archives: PackArchive[] = files.map((f) => ({ name: f.name, bytes: f.bytes, header: readRpfHeader(f.bytes), containers: findAwcs(f.bytes) }));
  const groups: ContainerGroup[] = [];
  const byHash = new Map<string, ContainerGroup[]>();
  archives.forEach((a, ai) => a.containers.forEach((c, ci) => {
    const view = a.bytes.subarray(c.offset, c.offset + c.length);
    const k = `${c.length}:${fnv1a(view)}`;
    const candidates = byHash.get(k) ?? [];
    const ref: ContainerRef = { archive: ai, index: ci, offset: c.offset, length: c.length };
    const match = candidates.find((g) => {
      const r = g.refs[0];
      return sameBytes(archives[r.archive].bytes.subarray(r.offset, r.offset + r.length), view);
    });
    if (match) match.refs.push(ref);
    else {
      const g: ContainerGroup = { id: groups.length, awc: c.awc, length: c.length, refs: [ref] };
      groups.push(g);
      byHash.set(k, [...candidates, g]);
    }
  }));
  return { archives, groups };
}

/** replacements: group id → (stream id → new stream). Returns patched copies of every touched archive. */
/**
 * The archive's table of contents fixes every container's size. A container that got smaller (streams muted, space
 * handed to a longer sound) is padded with zeros behind the AWC data – the game reads streams by offset, so the
 * padding is never played. Larger is impossible.
 */
export function fitContainer(awc: Uint8Array, length: number): Uint8Array {
  if (awc.length === length) return awc;
  if (awc.length > length) throw new Error(`Container zu groß (${awc.length} statt höchstens ${length} Bytes).`);
  const out = new Uint8Array(length);
  out.set(awc);
  return out;
}

export function exportPack(pack: Pack, replacements: Map<number, Map<number, AwcStream>>, opts: { includeUnchanged?: boolean } = {}): Array<{ name: string; bytes: Uint8Array; patchedContainers: number }> {
  const out = pack.archives.map((a) => ({ name: a.name, bytes: a.bytes, patchedContainers: 0 }));
  for (const [gid, streams] of replacements) {
    if (!streams.size) continue;
    const g = pack.groups[gid];
    const awc = fitContainer(writeAwc({ ...g.awc, streams: g.awc.streams.map((s) => streams.get(s.id) ?? s) }), g.length);
    for (const r of g.refs) {
      out[r.archive].bytes = patchAwcInPlace(out[r.archive].bytes, r, awc); // copy-on-write: originals untouched
      out[r.archive].patchedContainers++;
    }
  }
  // includeUnchanged: untouched archives come along as they are (a soundpack is always WEAPONS_PLAYER + RESIDENT)
  return opts.includeUnchanged ? out : out.filter((o) => o.patchedContainers > 0);
}
