// Soundpack project model (spec §93). Pure logic – no React, no storage – so it is testable.
import type { EditState } from '../dsp/chain';
import type { LibraryEntry, Style, WeaponId, WeaponProfile } from '../models/types';
import { checkAttachmentCoverage, deriveEdit, DERIVE_FROM, type CoverageIssue } from '../weapons/coverage';

export const PROJECT_FORMAT = 'sptool-project';
export const PROJECT_VERSION = 1;

export interface SlotAssignment {
  entryId: string;
  /** slot-specific edit applied on top of the entry (e.g. derived suppressor) */
  edit?: EditState;
  /** set when the sound was derived automatically from another slot */
  derivedFrom?: string;
}

export interface Snapshot { at: number; label: string; weapons: Project['weapons'] }

export interface Project {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  /** weapon → slot → assignment */
  weapons: Partial<Record<WeaponId, Record<string, SlotAssignment>>>;
  snapshots: Snapshot[];
}

export function newProject(name: string, author: string): Project {
  const now = Date.now();
  return { id: `prj-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name, author, version: '1.0.0', description: '', createdAt: now, updatedAt: now, weapons: {}, snapshots: [] };
}

export function assign(p: Project, weapon: WeaponId, slot: string, a: SlotAssignment | null): Project {
  const w = { ...(p.weapons[weapon] ?? {}) };
  if (a) w[slot] = a; else delete w[slot];
  return { ...p, weapons: { ...p.weapons, [weapon]: w }, updatedAt: Date.now() };
}

export function filledCount(p: Project, profile: WeaponProfile): number {
  const w = p.weapons[profile.id] ?? {};
  return profile.slots.filter((s) => w[s.id]).length;
}

export function coverage(p: Project, profile: WeaponProfile): CoverageIssue[] {
  return checkAttachmentCoverage(profile, new Set(Object.keys(p.weapons[profile.id] ?? {})));
}

export interface ValidationResult { ok: boolean; problems: Array<{ weapon: string; slot: string; message: string; fix?: 'derive' }> }

/** Project-level validation used before any build (spec §87 + attachment rule). */
export function validateProject(p: Project, profiles: WeaponProfile[]): ValidationResult {
  const problems: ValidationResult['problems'] = [];
  for (const prof of profiles) {
    const w = p.weapons[prof.id] ?? {};
    if (!Object.keys(w).length) continue; // untouched weapon keeps original sounds
    for (const s of prof.slots) if (s.required && !w[s.id]) problems.push({ weapon: prof.displayName, slot: s.id, message: `${prof.displayName}: Pflicht-Slot „${s.label}“ ist leer.`, fix: DERIVE_FROM[s.id] && w[DERIVE_FROM[s.id]] ? 'derive' : undefined });
    for (const i of checkAttachmentCoverage(prof, new Set(Object.keys(w)))) {
      if (!problems.some((x) => x.weapon === prof.displayName && x.slot === i.slot)) problems.push({ weapon: prof.displayName, slot: i.slot, message: i.message, fix: i.deriveFrom ? 'derive' : undefined });
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Fills a slot by deriving it from its source slot (e.g. suppressed fire from fire). */
export function deriveSlot(p: Project, weapon: WeaponId, slot: string): Project {
  const from = DERIVE_FROM[slot];
  const src = from ? p.weapons[weapon]?.[from] : undefined;
  if (!src) return p;
  const edit = deriveEdit(slot, src.edit);
  if (!edit) return p;
  return assign(p, weapon, slot, { entryId: src.entryId, edit, derivedFrom: from });
}

// ── Library matching for "Create pack for me" / smart recommendations ───────
/** Which library sounds fit a slot. */
export function slotMatches(e: LibraryEntry, weapon: WeaponId, slot: string): boolean {
  const w = e.weapon === weapon || e.weapon === 'universal';
  const c = (e.component ?? '').toLowerCase();
  switch (slot) {
    case 'fire': return e.type === 'fire' && w; // a 'universal' shot (Turbo sounds, library imports) fits every pistol
    case 'suppressed_fire': return e.type === 'suppressor' && e.weapon === weapon;
    case 'mag_out': return w && c === 'magazine out';
    case 'mag_in': return w && c === 'magazine in';
    case 'slide': return w && (c === 'slide pull' || c === 'slide release' || c === 'chamber');
    case 'reload_finish': return w && c === 'reload finish';
    case 'dry_fire': return w && c === 'dry fire';
    case 'draw': return w && c === 'weapon draw';
    case 'holster': return w && c === 'weapon holster';
    default: return false;
  }
}

/** Deterministic pick: prefer the requested style, then neighbours, then anything matching. */
export function autoPack(p: Project, profiles: WeaponProfile[], library: LibraryEntry[], style: Style, weapons: WeaponId[], seed = 1): Project {
  let out = p;
  let r = seed >>> 0 || 1;
  const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 2246822507) ^ Math.imul(r ^ (r >>> 13), 3266489909)) >>> 0) / 4294967296;
  for (const prof of profiles) {
    if (!weapons.includes(prof.id)) continue;
    for (const slot of prof.slots) {
      const all = library.filter((e) => slotMatches(e, prof.id, slot.id));
      if (!all.length) continue;
      const styled = all.filter((e) => e.style === style);
      const pool = styled.length ? styled : all;
      const pick = pool[Math.floor(rnd() * pool.length)];
      out = assign(out, prof.id, slot.id, { entryId: pick.id });
    }
  }
  return out;
}

export function addSnapshot(p: Project, label: string, max = 20): Project {
  const snap: Snapshot = { at: Date.now(), label, weapons: JSON.parse(JSON.stringify(p.weapons)) };
  return { ...p, snapshots: [snap, ...p.snapshots].slice(0, max) };
}

export function restoreSnapshot(p: Project, at: number): Project {
  const s = p.snapshots.find((x) => x.at === at);
  if (!s) return p;
  const withBackup = addSnapshot(p, 'Vor dem Wiederherstellen');
  return { ...withBackup, weapons: JSON.parse(JSON.stringify(s.weapons)), updatedAt: Date.now() };
}

// ── .spproject file (JSON; carries user library entries it depends on) ────────
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  project: Project;
  /** non-built-in entries the project uses (recipes + edits); imported audio inline as base64 */
  entries: LibraryEntry[];
  blobs: Record<string, string>;
}

export function usedEntryIds(p: Project): string[] {
  const ids = new Set<string>();
  for (const w of Object.values(p.weapons)) for (const a of Object.values(w ?? {})) ids.add(a.entryId);
  return [...ids];
}

export class ProjectFileError extends Error {}

export function parseProjectFile(text: string): ProjectFile {
  let d: any;
  try { d = JSON.parse(text); } catch { throw new ProjectFileError('Das ist keine gültige SP Tool-Projektdatei.'); }
  if (d?.format !== PROJECT_FORMAT) throw new ProjectFileError('Diese Datei ist kein SP Tool-Projekt.');
  if (typeof d.version !== 'number' || d.version > PROJECT_VERSION) throw new ProjectFileError('Dieses Projekt wurde mit einer neueren SP Tool-Version erstellt. Aktualisiere SP Tool, um es zu öffnen.');
  const p = d.project;
  if (!p || typeof p.name !== 'string' || typeof p.weapons !== 'object') throw new ProjectFileError('Die Projektdatei ist beschädigt (Projektdaten fehlen).');
  const weapons: Project['weapons'] = {};
  for (const [w, slots] of Object.entries(p.weapons ?? {})) {
    if (!['pistol', 'pistol_mk2', 'pistol50'].includes(w)) continue;
    const clean: Record<string, SlotAssignment> = {};
    for (const [s, a] of Object.entries(slots as Record<string, any>)) if (a && typeof a.entryId === 'string') clean[s] = { entryId: a.entryId, edit: a.edit, derivedFrom: a.derivedFrom };
    weapons[w as WeaponId] = clean;
  }
  return {
    format: PROJECT_FORMAT, version: d.version,
    project: { ...newProject(p.name, p.author ?? ''), ...p, weapons, snapshots: Array.isArray(p.snapshots) ? p.snapshots : [] },
    entries: Array.isArray(d.entries) ? d.entries.filter((e: any) => e && typeof e.id === 'string' && typeof e.name === 'string') : [],
    blobs: d.blobs && typeof d.blobs === 'object' ? d.blobs : {},
  };
}
