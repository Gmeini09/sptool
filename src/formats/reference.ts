// What did a soundpack's creator change? Every stream whose sound is not one of the common versions (see
// referenceData.ts) is the creator's own – shots, reloads, muted sounds … whatever the pack does.
import { COMMON } from './referenceData';

/** FNV-1a over the raw PCM bytes. */
export function streamHash(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** True when this version of the stream is not a known common one (= the creator's own sound). */
export function isOwnSound(file: string, stream: number, data: Uint8Array): boolean {
  const known = COMMON[`${file}:${stream}`];
  if (!known) return true;
  return !known.includes(streamHash(data));
}

export const hasReference = (file: string, stream: number) => !!COMMON[`${file}:${stream}`];
