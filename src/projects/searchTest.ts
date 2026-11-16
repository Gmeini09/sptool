// Suchtest im Spiel: finds which sounds of the pack the game really plays for each pistol shot – without any
// guess. Round 0 replaces EVERY sound in the pack by beeps: if a pistol still sounds normal, the game does not read
// the files at all (wrong folder, another pack in FiveM's mods folder, server). From round 1 the remaining
// candidates are split into 6 beep patterns (1–3 beeps, high or low); the tester reports what he heard, and each
// round keeps only the matching part – 1000 sounds are down to a handful after 4 rounds.
import { fitStreamAudio, type AwcStream } from '../formats/awc';
import { exportPack, type Pack } from '../formats/pack';
import { setStreamMapping, type Mapping } from '../formats/mapping';
import type { WeaponId } from '../models/types';
import { RELOAD_ORDER } from './gameTest';
import { canonicalArchiveName } from '../services/install';
import { indexPack } from './build';
import { beepAudio } from './gameTest';

/** "F03:277856074" – catalog file + stream id (what the mapping stores). */
export type Key = string;
export interface Pattern { beeps: number; freq: number; label: string }
export const PATTERNS: Pattern[] = [
  { beeps: 1, freq: 1200, label: '1× hoch' }, { beeps: 2, freq: 1200, label: '2× hoch' }, { beeps: 3, freq: 1200, label: '3× hoch' },
  { beeps: 1, freq: 350, label: '1× tief' }, { beeps: 2, freq: 350, label: '2× tief' }, { beeps: 3, freq: 350, label: '3× tief' },
];
/** Round 0: everything beeps the same way. */
export const ALL_PATTERN: Pattern = { beeps: 2, freq: 1200, label: 'Piep-Piep' };
/** At most this many candidates get one pattern each (a final, exact round); GTA keeps several variations of a shot. */
export const FOUND_AT = PATTERNS.length;

/**
 * What the tester does in the game: shoot, shoot with suppressor, reload, kill. A target is "weapon:event".
 * global: one sound for every weapon (the kill sound) – searched once, stored under the Pistol.
 */
export type SearchEvent = 'fire' | 'suppressed_fire' | 'reload' | 'kill';
export const EVENTS: Array<{ id: SearchEvent; label: string; action: string; global?: boolean }> = [
  { id: 'fire', label: 'Schuss', action: '3–4 Mal schießen' },
  { id: 'suppressed_fire', label: 'Schuss mit Schalldämpfer', action: 'Schalldämpfer drauf, 3–4 Mal schießen' },
  { id: 'reload', label: 'Nachladen', action: '1–2 Mal nachladen (R)' },
  { id: 'kill', label: 'Kill-Sound', action: '2–3 NPCs töten und nur auf den Piep im Moment des Kills achten (nicht auf den Schuss)', global: true },
];
export const GLOBAL_WEAPON: WeaponId = 'pistol';
export const target = (w: WeaponId, e: SearchEvent) => `${w}:${e}`;
/** Targets for the chosen events: weapon events once per weapon, global events (kill) once. */
export const targetsFor = (weapons: WeaponId[], events: SearchEvent[]) => [
  ...weapons.flatMap((w) => events.filter((e) => !EVENTS.find((x) => x.id === e)?.global).map((e) => target(w, e))),
  ...events.filter((e) => EVENTS.find((x) => x.id === e)?.global).map((e) => target(GLOBAL_WEAPON, e)),
];
export const splitTarget = (t: string) => { const [weapon, event] = t.split(':'); return { weapon: weapon as WeaponId, event: event as SearchEvent }; };

export interface SearchState {
  round: number;
  /** targets "weapon:event" (the field keeps its old name so saved tests still load) */
  weapons: string[];
  /** candidates per weapon; null = not narrowed yet (all sounds) */
  sets: Record<string, Key[] | null>;
  /** weapons that sounded normal in round 0 → the game does not use the pack's files for them */
  notLoaded: string[];
  /** pattern index per key in the current round (round ≥ 1) */
  patterns: Record<Key, number>;
  /** weapons whose candidates all have a pattern of their own in the current round → this round decides exactly */
  exact?: string[];
  /** targets found exactly (sets[t] = exactly the sounds the game plays) */
  found?: string[];
  /** reload targets: the found sounds in the order the game played them (mag out, mag in, slide, finish) */
  order?: Record<string, Key[]>;
}

const key = (file: string, stream: number): Key => `${file}:${stream}`;
/** FNV-1a – a stable "random" number per key and round. */
const mix = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h ^ (h >>> 15)) >>> 0; };
const parse = (k: Key) => { const [file, s] = k.split(':'); return { file, stream: Number(s) }; };

/** Every stream of every recognised container in the pack. */
export function allKeys(pack: Pack): Key[] {
  const out = new Set<Key>();
  for (const [file, gis] of indexPack(pack)) for (const gi of gis) for (const s of pack.groups[gi].awc.streams) out.add(key(file, s.id));
  return [...out].sort();
}

export function startSearch(weapons: string[]): SearchState {
  return { round: 0, weapons, sets: Object.fromEntries(weapons.map((w) => [w, null])), notLoaded: [], patterns: {} };
}

export const isFound = (st: SearchState, w: string) => !!st.found?.includes(w) && !!st.sets[w]?.length;
/** Weapons still searched in this round. */
export const active = (st: SearchState) => st.weapons.filter((w) => !st.notLoaded.includes(w) && !isFound(st, w) && (st.sets[w] === null || st.sets[w]!.length > 0));

/** The test pack of the current round and the pattern of every key in it. */
export function buildRound(pack: Pack, st: SearchState): { outputs: Array<{ name: string; bytes: Uint8Array }>; patterns: Record<Key, number>; exact: string[]; count: number } {
  const idx = indexPack(pack);
  const all = allKeys(pack);
  let keys: Key[];
  const patterns: Record<Key, number> = {};
  const exact: string[] = [];
  if (st.round === 0) keys = all;
  else {
    const union = new Set<Key>();
    for (const w of active(st)) for (const k of st.sets[w] ?? all) union.add(k);
    keys = [...union].sort();
    // few candidates left: each gets a pattern of its own, so the answer names exactly the sounds the game plays
    for (const w of active(st)) {
      const s = st.sets[w];
      if (!s || s.length > FOUND_AT) continue;
      for (const k of s) if (patterns[k] === undefined) { const used = new Set(s.map((x) => patterns[x]).filter((x) => x !== undefined)); const free = PATTERNS.findIndex((_, i) => !used.has(i)); if (free >= 0) patterns[k] = free; }
      if (new Set(s.map((k) => patterns[k])).size === s.length && s.every((k) => patterns[k] !== undefined)) exact.push(w);
    }
    // a fresh pseudo-random split every round: whatever survived together last round is spread out again
    for (const k of keys) if (patterns[k] === undefined) patterns[k] = mix(`${k}#${st.round}`) % PATTERNS.length;
  }
  const byGroup = new Map<number, Map<number, AwcStream>>();
  for (const k of keys) {
    const { file, stream } = parse(k);
    const p = st.round === 0 ? ALL_PATTERN : PATTERNS[patterns[k]];
    for (const gi of idx.get(file) ?? []) {
      const orig = pack.groups[gi].awc.streams.find((s) => s.id === stream);
      if (!orig) continue;
      const fit = fitStreamAudio(orig, beepAudio(p.beeps, orig.format.samples / orig.format.sampleRate, orig.format.sampleRate, p.freq));
      if (!byGroup.has(gi)) byGroup.set(gi, new Map());
      byGroup.get(gi)!.set(stream, fit.stream);
    }
  }
  if (!byGroup.size) throw new Error('In deiner Vorlage hat SP Tool keine Sounds gefunden, die es ersetzen kann. Nimm ein anderes Waffen-Soundpack als Vorlage.');
  // always both archives (complete pack), so nothing old can stay in the sfx folder
  const outputs = exportPack(pack, byGroup, { includeUnchanged: true }).map((o) => ({ name: canonicalArchiveName(o.name), bytes: o.bytes }));
  return { outputs, patterns, exact, count: keys.length };
}

/**
 * What the tester heard per weapon: round 0 → [0] beeped / [] normal; later rounds → the pattern indexes he heard
 * (several when the shot changed between shots – GTA picks a random variation), [] = sounded normal / unsure.
 */
export function applyRound(pack: Pack, st: SearchState, patterns: Record<Key, number>, heard: Record<string, number[]>): SearchState {
  const sets = { ...st.sets };
  const notLoaded = [...st.notLoaded];
  const found = [...(st.found ?? [])];
  const order = { ...(st.order ?? {}) };
  const all = allKeys(pack);
  for (const w of active(st)) {
    const h = heard[w] ?? [];
    if (st.round === 0) { if (h.length) sets[w] = all; else notLoaded.push(w); continue; }
    if (!h.length) continue; // unsure: same candidates again next round (with new patterns)
    const cur = st.sets[w] ?? all;
    sets[w] = cur.filter((k) => patterns[k] !== undefined && h.includes(patterns[k]));
    if (st.exact?.includes(w) && sets[w]!.length) {
      found.push(w);
      // the clicks come in the order the sounds played: that order is mag out → mag in → slide → finish
      order[w] = h.map((p) => cur.find((k) => patterns[k] === p)).filter((k): k is Key => !!k);
    }
  }
  return { ...st, round: st.round + 1, sets, notLoaded, found, order, patterns: {}, exact: [] };
}

/**
 * Writes what was found into the mapping (old guesses of that slot removed): a shot → its slot, a reload → the parts
 * in the order they played (the 5th and later sound go to "Nachladen fertig").
 */
export function applySearch(m: Mapping, st: SearchState): { mapping: Mapping; weapons: string[] } {
  let next = m;
  const done: string[] = [];
  for (const t of st.weapons) {
    const s = st.sets[t];
    if (!s || !s.length || !st.found?.includes(t)) continue;
    const { weapon, event } = splitTarget(t);
    const slots: string[] = event === 'reload' ? [...RELOAD_ORDER] : [event];
    next = { ...next, entries: next.entries.filter((e) => !(e.weapon === weapon && slots.includes(e.slot))) };
    if (event === 'reload') {
      const ordered = [...(st.order?.[t] ?? []), ...s.filter((k) => !st.order?.[t]?.includes(k))];
      ordered.forEach((k, i) => { const { file, stream } = parse(k); next = setStreamMapping(next, file, stream, { weapon, slot: RELOAD_ORDER[Math.min(i, RELOAD_ORDER.length - 1)] }); });
    } else for (const k of s) { const { file, stream } = parse(k); next = setStreamMapping(next, file, stream, { weapon, slot: event }); }
    done.push(t);
  }
  return { mapping: next, weapons: done };
}

const STORE = 'sptool:search-test';
export function loadSearch(): SearchState | null {
  try { const r = localStorage.getItem(STORE); const st = r ? JSON.parse(r) as SearchState : null; return st && st.weapons.every((t) => t.includes(':')) ? st : null; } catch { return null; }
}
export function saveSearch(st: SearchState | null) { try { if (st) localStorage.setItem(STORE, JSON.stringify(st)); else localStorage.removeItem(STORE); } catch { /* private mode */ } }
