// Synthetic soundpacks for tests: RPF7 archives with an (unreadable) NG table of contents and unencrypted AWC
// containers whose stream ids are the catalog ids of real game files – the layout of a creator pack, without
// any game or creator audio. Lets the whole build / game-test / install chain run without reference packs.
import { CHUNK, replaceStreamAudio, writeAwc, type AwcFile, type AwcStream } from '../src/formats/awc';
import { CATALOG_DATA } from '../src/formats/catalogData';
import { RPF7_MAGIC } from '../src/formats/rpf';

/** A noise burst of `seconds` (deterministic), the "original" sound of a synthetic stream. */
export function noise(seconds: number, sampleRate: number, seed: number): Float32Array {
  const n = Math.max(16, Math.round(seconds * sampleRate));
  const out = new Float32Array(n);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = ((s / 4294967296) * 2 - 1) * Math.exp((-4 * i) / n) * 0.7; }
  return out;
}

export function synthStream(id: number, seconds = 0.4, sampleRate = 32000): AwcStream {
  const base: AwcStream = {
    id, data: new Uint8Array(0), peak: null, markers: null, chunkOrder: [CHUNK.format, CHUNK.data],
    format: { samples: 0, loopPoint: -1, sampleRate, headroom: -200, loopBegin: 0, loopEnd: 0, playEnd: 0, playBegin: 0, codec: 0, peak0: 0, reserved: 0 },
  };
  return replaceStreamAudio(base, { sampleRate, channels: [noise(seconds, sampleRate, id)] });
}

/** Container for a catalog file (all of its stream ids, or the first `max`). */
export function catalogAwc(key: string, opts: { seconds?: number; max?: number } = {}): Uint8Array {
  const c = CATALOG_DATA.find((x) => x.key === key);
  if (!c) throw new Error(`unknown catalog file ${key}`);
  const ids = c.ids.slice(0, opts.max ?? c.ids.length);
  const awc: AwcFile = { version: 1, flags: 0xff01, streams: ids.map((id) => synthStream(id, opts.seconds ?? 0.4)) };
  return writeAwc(awc);
}

/** RPF7 with an NG-flagged random table of contents, every container 512-byte aligned (like a creator pack). */
export function synthRpf(containers: Uint8Array[], entryCount = containers.length + 1): Uint8Array {
  const namesLength = 256;
  const tocEnd = 16 + entryCount * 16 + namesLength;
  const align = (n: number) => Math.ceil(n / 512) * 512;
  let size = align(tocEnd);
  const offsets = containers.map((c) => { const o = size; size = align(o + c.length); return o; });
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, RPF7_MAGIC, true); v.setUint32(4, entryCount, true); v.setUint32(8, namesLength, true); v.setUint32(12, 0x0fefffff, true);
  let s = 12345;
  for (let i = 16; i < tocEnd; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; out[i] = s >>> 24; }
  containers.forEach((c, i) => out.set(c, offsets[i]));
  return out;
}

/** WEAPONS_PLAYER.rpf + RESIDENT.rpf like a pistol pack: single-shot files F02–F04, F01 in both archives. */
export function synthPack(opts: { f01Max?: number; shotSeconds?: number } = {}): Array<{ name: string; bytes: Uint8Array }> {
  const f01 = catalogAwc('F01', { seconds: 0.3, max: opts.f01Max });
  return [
    { name: 'WEAPONS_PLAYER.rpf', bytes: synthRpf([catalogAwc('F02', { seconds: opts.shotSeconds }), catalogAwc('F03', { seconds: opts.shotSeconds }), catalogAwc('F04', { seconds: opts.shotSeconds }), f01]) },
    { name: 'RESIDENT.rpf', bytes: synthRpf([f01]) },
  ];
}
