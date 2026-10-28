// The Turbo sounds that come with SP Tool: real recordings (not synthesised), played from src/assets/turbo.
// Shots fit every pistol's shot slot; reload recordings are offered as a whole reload.
import type { LibraryEntry, Style } from '../models/types';
import { TURBO_DATA } from './turboData';

export const TURBO_CREATOR = 'Turbo Design';
export const WHOLE_RELOAD = 'Whole Reload';
const pad = (n: number) => String(n).padStart(3, '0');

/** Recommended Turbo sounds first, then the rest in their order. */
export const featuredFirst = <T extends { featured?: boolean }>(list: T[]): T[] => [...list.filter((e) => e.featured), ...list.filter((e) => !e.featured)];

let cached: LibraryEntry[] | null = null;
export function turboCatalog(): LibraryEntry[] {
  if (cached) return cached;
  const created = Date.UTC(2026, 9, 13);
  cached = TURBO_DATA.map(([n, kind, num, folder, dur, style, rec]) => ({
    id: `tb-${pad(n)}`, name: `Turbo ${num}`, ...(rec ? { featured: true } : {}), creator: TURBO_CREATOR, license: 'Turbo Design – nur zur Nutzung in SP Tool',
    sourceInfo: `Turbo-Sound ${n}`, source: 'builtin', weapon: 'universal',
    type: kind === 'f' ? 'fire' : 'reload', ...(kind === 'r' ? { component: WHOLE_RELOAD } : {}),
    style: style as Style, tags: ['turbo', folder, kind === 'f' ? 'fire' : 'reload', ...(rec ? ['empfohlen'] : [])], version: '1.0.0', createdAt: created,
    asset: `assets/turbo/turbo-${pad(n)}.ogg`, estDuration: dur,
  }));
  return cached;
}
