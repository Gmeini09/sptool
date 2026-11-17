// Soundpack = several RPF archives edited together (e.g. WEAPONS_PLAYER.rpf + RESIDENT.rpf).
// Reference packs store some AWC containers byte-identically in more than one archive.
// If only one copy were replaced, the game could load the old copy from the other archive
// (sounds "bug", e.g. with attachments). Containers are therefore grouped by content and
// every copy is patched identically.
//
// Two ways to write a container back:
//  • in place (same position, never larger): the table of contents stays exactly as it was – the only way for creator
//    packs whose table of contents is encrypted.
//  • rebuild: when the archive's file list is known (Rockstar's original or a plain table of contents) and a container
//    grows, the whole archive is written anew with a plain table of contents (rpf.ts → writeRpfOpen). Every other file
//    is copied byte for byte. Used only when something does not fit – otherwise nothing changes against before.
import { writeAwc, type AwcFile, type AwcStream } from './awc';
import { findAwcs, knownToc, patchAwcInPlace, readRpfHeader, RpfError, writeRpfOpen, type FoundAwc, type RpfHeader, type TocFile } from './rpf';

export interface PackArchive {
  name: string; bytes: Uint8Array; header: RpfHeader; containers: FoundAwc[];
  /** complete file list when known – then the archive can be rebuilt and its containers may grow */
  toc: TocFile[] | null;
}
export interface ContainerRef { archive: number; index: number; offset: number; length: number; encrypted?: boolean }
export interface ContainerGroup {
  id: number; awc: AwcFile; length: number; refs: ContainerRef[];
  /** every copy lies in an archive SP Tool can rebuild: the container may get larger than `length` */
  canGrow: boolean;
}
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
  const archives: PackArchive[] = files.map((f) => ({
    name: f.name, bytes: f.bytes, header: readRpfHeader(f.bytes), containers: findAwcs(f.bytes), toc: knownToc(f.bytes),
  }));
  const groups: ContainerGroup[] = [];
  const byHash = new Map<string, ContainerGroup[]>();
  archives.forEach((a, ai) => a.containers.forEach((c, ci) => {
    const view = a.bytes.subarray(c.offset, c.offset + c.length);
    const k = `${c.length}:${fnv1a(view)}`;
    const candidates = byHash.get(k) ?? [];
    const ref: ContainerRef = { archive: ai, index: ci, offset: c.offset, length: c.length, encrypted: c.encrypted };
    const match = candidates.find((g) => {
      const r = g.refs[0];
      return sameBytes(archives[r.archive].bytes.subarray(r.offset, r.offset + r.length), view);
    });
    if (match) { match.refs.push(ref); match.canGrow &&= !!a.toc; }
    else {
      const g: ContainerGroup = { id: groups.length, awc: c.awc, length: c.length, refs: [ref], canGrow: !!a.toc };
      groups.push(g);
      byHash.set(k, [...candidates, g]);
    }
  }));
  return { archives, groups };
}

/**
 * In place, the archive's table of contents fixes every container's size. A container that got smaller (streams
 * muted, space handed to a longer sound) is padded with zeros behind the AWC data – the game reads streams by offset,
 * so the padding is never played. Larger needs a rebuild (see exportPack).
 */
export function fitContainer(awc: Uint8Array, length: number): Uint8Array {
  if (awc.length === length) return awc;
  if (awc.length > length) throw new Error(`Container zu groß (${awc.length} statt höchstens ${length} Bytes).`);
  const out = new Uint8Array(length);
  out.set(awc);
  return out;
}

export interface ExportedArchive { name: string; bytes: Uint8Array; patchedContainers: number; rebuilt: boolean }

/** replacements: group id → (stream id → new stream). Returns patched copies of every touched archive. */
export function exportPack(pack: Pack, replacements: Map<number, Map<number, AwcStream>>, opts: { includeUnchanged?: boolean } = {}): ExportedArchive[] {
  // new container bytes per archive, keyed by the container's position in the source archive
  const perArchive = pack.archives.map(() => new Map<number, { ref: ContainerRef; awc: Uint8Array }>());
  for (const [gid, streams] of replacements) {
    if (!streams.size) continue;
    const g = pack.groups[gid];
    const awc = writeAwc({ ...g.awc, streams: g.awc.streams.map((s) => streams.get(s.id) ?? s) }, { share: true });
    if (awc.length > g.length && !g.canGrow) {
      throw new RpfError(`Container zu groß (${awc.length} statt höchstens ${g.length} Bytes) – die Vorlage ist ein Soundpack mit verschlüsseltem Inhaltsverzeichnis, dort können Sounds nicht länger werden. Nimm das Original-GTA-Soundpack als Vorlage.`);
    }
    for (const r of g.refs) perArchive[r.archive].set(r.offset, { ref: r, awc });
  }
  const out = pack.archives.map((a, ai): ExportedArchive => {
    const repl = perArchive[ai];
    if (!repl.size) return { name: a.name, bytes: a.bytes, patchedContainers: 0, rebuilt: false };
    const grows = [...repl.values()].some((x) => x.awc.length > x.ref.length);
    if (!grows) {
      let bytes = a.bytes;
      for (const { ref, awc } of repl.values()) bytes = patchAwcInPlace(bytes, ref, fitContainer(awc, ref.length)); // copy-on-write
      return { name: a.name, bytes, patchedContainers: repl.size, rebuilt: false };
    }
    if (!a.toc) throw new RpfError(`${a.name}: Inhaltsverzeichnis unbekannt – das Archiv kann nicht neu aufgebaut werden.`);
    const files = a.toc.map((f) => ({ name: f.name, data: repl.get(f.offset)?.awc ?? a.bytes.subarray(f.offset, f.offset + f.length) }));
    const placed = new Set(a.toc.map((f) => f.offset));
    for (const off of repl.keys()) if (!placed.has(off)) throw new RpfError(`${a.name}: Container bei ${off} steht nicht im Inhaltsverzeichnis.`);
    return { name: a.name, bytes: writeRpfOpen(files), patchedContainers: repl.size, rebuilt: true };
  });
  // includeUnchanged: untouched archives come along as they are (a soundpack is always WEAPONS_PLAYER + RESIDENT)
  return opts.includeUnchanged ? out : out.filter((o) => o.patchedContainers > 0);
}
