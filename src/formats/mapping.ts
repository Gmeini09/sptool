// Which original GTA V audio file a container is (catalog), and which of its streams belongs to which
// weapon slot (mapping). Both are content-based, so they work with any creator's pack.
//
// The mapping is made by ear in the Pack Analyzer (Developer/Admin) – Rockstar stores only hashed stream
// names, so it cannot be derived automatically. SP Tool never guesses: unmapped slots are reported, not built.
import type { AwcFile } from './awc';
import { CATALOG_DATA } from './catalogData';
import type { WeaponId } from '../models/types';
import shipped from '../../weapon_profiles/mapping.json';

export interface CatalogEntry { key: string; archive: 'WEAPONS_PLAYER' | 'RESIDENT' | 'both'; seenIn: number; ids: ReadonlySet<number>; count: number }
export const CATALOG: CatalogEntry[] = CATALOG_DATA.map((c) => ({ key: c.key, archive: c.archive, seenIn: c.seenIn, ids: new Set(c.ids), count: c.ids.length }));

/** The catalog entry a container belongs to (≥ 50 % of its streams known for that file), or null. */
export function matchCatalog(awc: Pick<AwcFile, 'streams'>): CatalogEntry | null {
  let best: CatalogEntry | null = null, bestScore = 0;
  for (const c of CATALOG) {
    let hit = 0;
    for (const s of awc.streams) if (c.ids.has(s.id)) hit++;
    const score = hit / Math.min(awc.streams.length || 1, c.count);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.5 ? best : null;
}

export interface MapEntry { file: string; stream: number; weapon: WeaponId; slot: string }
export interface Mapping { version: 1; updatedAt: number; entries: MapEntry[] }

const STORE = 'sptool:mapping';
const valid = (e: unknown): e is MapEntry => {
  const x = e as MapEntry;
  return !!x && typeof x.file === 'string' && /^F\d{2}$/.test(x.file) && Number.isInteger(x.stream) && x.stream >= 0 && x.stream < 2 ** 29
    && typeof x.weapon === 'string' && typeof x.slot === 'string' && /^[a-z0-9_]{1,40}$/.test(x.slot);
};

export function parseMapping(json: unknown): Mapping {
  const m = json as Partial<Mapping>;
  if (!m || m.version !== 1 || !Array.isArray(m.entries)) throw new Error('Keine SP-Tool-Zuordnungsdatei.');
  const entries = m.entries.filter(valid);
  if (entries.length !== m.entries.length) throw new Error('Die Zuordnungsdatei enthält ungültige Einträge.');
  return { version: 1, updatedAt: Number(m.updatedAt) || Date.now(), entries: dedupe(entries) };
}

const ek = (e: Pick<MapEntry, 'file' | 'stream'>) => `${e.file}:${e.stream}`;
function dedupe(list: MapEntry[]): MapEntry[] {
  const m = new Map<string, MapEntry>();
  for (const e of list) m.set(ek(e), e); // later entries win
  return [...m.values()];
}

/** Mapping an admin published on the license server (cached by services/mappingSync.ts). */
export const SERVER_MAPPING_KEY = 'sptool:mapping-server';
function serverEntries(): MapEntry[] {
  try { const raw = localStorage.getItem(SERVER_MAPPING_KEY); return raw ? parseMapping(JSON.parse(raw)).entries : []; } catch { return []; }
}
/** Shipped + published mapping – what every user gets. */
function baseMapping(): Mapping {
  return { version: 1, updatedAt: 0, entries: dedupe([...parseMapping(shipped).entries, ...serverEntries()]) };
}

/** Shipped + published mapping + this PC's own edits (local edits win). */
export function loadMapping(): Mapping {
  const base = baseMapping();
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const json = JSON.parse(raw);
      const local = parseMapping(json);
      // shipped entries the user removed locally stay removed
      const removed = new Set<string>(Array.isArray(json.removed) ? json.removed.map(String) : []);
      return { version: 1, updatedAt: local.updatedAt, entries: dedupe([...base.entries.filter((e) => !removed.has(ek(e))), ...local.entries]) };
    }
  } catch { /* corrupt local copy → shipped only */ }
  return base;
}

/** Fired on window whenever the mapping changes (own test, published mapping) – open screens plan anew. */
export const MAPPING_EVENT = 'sptool:mapping-changed';
export function notifyMapping() { try { window.dispatchEvent(new Event(MAPPING_EVENT)); } catch { /* no window (tests) */ } }

export function saveMapping(m: Mapping) {
  const keep = new Set(m.entries.map(ek));
  const removed = baseMapping().entries.map(ek).filter((k) => !keep.has(k));
  localStorage.setItem(STORE, JSON.stringify({ ...m, removed, updatedAt: Date.now() }));
  notifyMapping();
}

export function setStreamMapping(m: Mapping, file: string, stream: number, target: { weapon: WeaponId; slot: string } | null): Mapping {
  const rest = m.entries.filter((e) => !(e.file === file && e.stream === stream));
  return { version: 1, updatedAt: Date.now(), entries: target ? [...rest, { file, stream, ...target }] : rest };
}

export const mappingOf = (m: Mapping, file: string, stream: number) => m.entries.find((e) => e.file === file && e.stream === stream) ?? null;
export const streamsFor = (m: Mapping, weapon: WeaponId, slot: string) => m.entries.filter((e) => e.weapon === weapon && e.slot === slot);
