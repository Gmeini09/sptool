// The base pack (WEAPONS_PLAYER.rpf + RESIDENT.rpf of any working weapon soundpack) is set up once and kept:
// stored locally and loaded again on every start, also after updates. Sources: the PC search (FiveM / OpenIV
// mods folders, Downloads, Desktop – also inside ZIPs), drag & drop, or picking the files by hand.
import { canonicalArchiveName, findBaseCandidates, readBaseCandidate, type BaseCandidate } from '../services/install';
import { nativeInfo } from '../services/native';
import { loadJSON, saveJSON, getBlob, putBlob, deleteBlob, removeKey } from '../services/storage';
import { logger } from '../services/logger';
import { openPack, type Pack } from '../formats/pack';
import { readRpfHeader } from '../formats/rpf';
import { listZip, readZipEntry } from '../formats/zip';
import { loadMapping } from '../formats/mapping';
import { WEAPON_PROFILES } from '../weapons/profiles';
import { getBasePack, inGameAudio, planBuild, SILENCE, setBasePack } from './build';
import { assign, newProject } from './project';

export interface BaseInfo { names: string[]; sizes: number[]; source: string; label: string; savedAt: number; containers: number }
const INFO = 'basePack';
const blobKey = (name: string) => `basepack:${name}`;

export class BaseError extends Error {}

/** "WEAPONS_PLAYER_2.rpf", "Gambo-WEAPONS_PLAYER.rpf", "resident (1).rpf" → the game name; null for other files. */
export function baseArchiveName(name: string): 'WEAPONS_PLAYER.rpf' | 'RESIDENT.rpf' | null {
  const n = (name.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (!n.endsWith('.rpf')) return null;
  const c = canonicalArchiveName(name.split(/[\\/]/).pop()!);
  if (c === 'WEAPONS_PLAYER.rpf' || /weapons_?player/.test(n)) return 'WEAPONS_PLAYER.rpf';
  if (c === 'RESIDENT.rpf' || /(^|[^a-z])resident([^a-z]|$)/.test(n)) return 'RESIDENT.rpf';
  return null;
}

export interface BaseFile { name: string; bytes: Uint8Array }

/** Checks the files and opens them as a pack. Names are normalised (WEAPONS_PLAYER_2.rpf → WEAPONS_PLAYER.rpf). */
export function openBase(files: BaseFile[]): Pack {
  const byName = new Map<string, BaseFile>();
  for (const f of files) {
    const n = baseArchiveName(f.name);
    if (!n) continue;
    byName.set(n, { name: n, bytes: f.bytes });
  }
  if (!byName.has('WEAPONS_PLAYER.rpf')) throw new BaseError('Es fehlt WEAPONS_PLAYER.rpf – die Datei ist in jedem Waffen-Soundpack (meist im Ordner „mods“).');
  for (const f of byName.values()) {
    try { readRpfHeader(f.bytes); } catch { throw new BaseError(`${f.name} ist kein GTA-Archiv (RPF7).`); }
  }
  const ordered = ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf'].map((n) => byName.get(n)).filter((x): x is BaseFile => !!x);
  const pack = openPack(ordered);
  if (!pack.groups.length) throw new BaseError('In diesen Archiven sind keine lesbaren Sounds – vermutlich die verschlüsselten Originaldateien des Spiels. Nimm die Dateien aus einem Waffen-Soundpack für FiveM.');
  return pack;
}

/** Uses the files as base and stores them for next time. */
export async function adoptBase(files: BaseFile[], source: string, label: string): Promise<Pack> {
  const pack = openBase(files);
  setBasePack(pack);
  try {
    for (const a of pack.archives) await putBlob(blobKey(a.name), a.bytes);
    const info: BaseInfo = { names: pack.archives.map((a) => a.name), sizes: pack.archives.map((a) => a.bytes.byteLength), source, label, savedAt: Date.now(), containers: pack.groups.length };
    saveJSON(INFO, info);
    for (const n of ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf']) if (!info.names.includes(n)) void deleteBlob(blobKey(n));
    logger.info(`Basis-Pack gespeichert: ${label} (${info.names.join(' + ')}, ${pack.groups.length} Sound-Container)`);
  } catch (e) {
    logger.warn(`Basis-Pack konnte nicht gespeichert werden: ${e instanceof Error ? e.message : String(e)}`);
  }
  return pack;
}

export const baseInfo = (): BaseInfo | null => loadJSON<BaseInfo | null>(INFO, null);

/** On start: loads the stored base pack (if any). */
let restoring: Promise<void> | null = null;
export function restoreBase(): Promise<void> {
  if (getBasePack()) return Promise.resolve();
  restoring ??= (async () => {
    const info = baseInfo();
    if (!info) return;
    const files: BaseFile[] = [];
    for (const n of info.names) { const b = await getBlob(blobKey(n)); if (b) files.push({ name: n, bytes: b }); }
    if (!files.length) return;
    try { setBasePack(openBase(files)); } catch (e) { logger.warn(`Gespeichertes Basis-Pack unbrauchbar: ${e instanceof Error ? e.message : String(e)}`); }
  })().finally(() => { restoring = null; });
  return restoring;
}

export async function forgetBase() {
  setBasePack(null);
  removeKey(INFO);
  for (const n of ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf']) await deleteBlob(blobKey(n));
}

/** Files the user picked or dropped: .rpf files and/or soundpack ZIPs. */
export async function baseFromUserFiles(list: File[]): Promise<{ files: BaseFile[]; label: string }> {
  const files: BaseFile[] = [];
  let label = list[0]?.name ?? 'Eigene Dateien';
  for (const f of list) {
    if (/\.(rar|7z)$/i.test(f.name)) throw new BaseError(`${f.name} ist ein RAR/7z-Archiv – das kann SP Tool nicht öffnen. Bitte erst entpacken (Rechtsklick → „Alle extrahieren“ bzw. WinRAR) und dann die .rpf-Dateien oder den Ordner-Inhalt hier reinziehen.`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      const entries = listZip(bytes).filter((e) => !!baseArchiveName(e.name));
      if (!entries.length) throw new BaseError(`In ${f.name} ist keine WEAPONS_PLAYER.rpf.`);
      for (const e of entries) files.push({ name: e.name.split('/').pop()!, bytes: await readZipEntry(bytes, e) });
      label = f.name.replace(/\.zip$/i, '');
    } else files.push({ name: f.name, bytes });
  }
  return { files, label };
}

/** Best candidates first: the pack that already plays in FiveM, then complete packs (both archives), then newest. */
export function rankCandidates(list: BaseCandidate[]): BaseCandidate[] {
  // a complete pack (WEAPONS_PLAYER + RESIDENT) always beats an incomplete one – otherwise a mods folder with only
  // WEAPONS_PLAYER.rpf became the template and every soundpack came out without RESIDENT.rpf
  const score = (c: BaseCandidate) => (isComplete(c) ? 4 : 0) + (c.source.startsWith('FiveM') ? 2 : 0);
  // never the in-game test pack (beeps) as a template
  return list.filter((c) => !/zuordnungstest/i.test(c.path)).sort((a, b) => score(b) - score(a) || b.modified - a.modified);
}

/**
 * The base for "Soundpack erstellen" without asking: the stored one, otherwise the best soundpack found on this PC
 * (adopted and kept). Returns null when there is none – then the user has to drop one in once.
 */
export async function ensureBase(onStage?: (s: string) => void): Promise<Pack | null> {
  if (!getBasePack()) await restoreBase();
  if (getBasePack()) return completeBase(onStage);
  if (!(await nativeInfo().catch(() => null))) return null;
  onStage?.('Soundpack-Dateien auf deinem PC werden gesucht…');
  let list: BaseCandidate[] = [];
  try { list = rankCandidates(await searchCandidates(30_000)); } catch (e) { logger.warn(`Basis-Suche fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`); return null; }
  // the pack with the most room for own sounds, so long shots and reloads are cut as little as possible
  const best = await roomiest(list, onStage);
  if (best) try { return await adoptBase(best.files, best.c.source, best.c.label); } catch { /* falls back to the list below */ }
  for (const c of list) {
    onStage?.(`WEAPONS_PLAYER und RESIDENT werden aus „${c.label}“ übernommen…`);
    try { return await adoptBase(await readBaseCandidate(c), c.source, c.label); }
    catch (e) { logger.warn(`Basis ${c.label} unbrauchbar: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return null;
}

/**
 * Room for own sounds in a pack: how much of a long shot (1.2 s) for every pistol and a whole reload (1.6 s) the game
 * file keeps – 1 per sound at full length and rate. Container sizes cannot grow (encrypted archive), so a pack whose
 * creator used long sounds there cuts less.
 */
export async function soundRoom(pack: Pack): Promise<number> {
  const tone = (sec: number) => { const n = Math.round(sec * 44100), c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = Math.sin(i * 0.2) * 0.5; return { sampleRate: 44100, channels: [c] }; };
  const shot = tone(1.2), reload = tone(1.6);
  let p = newProject('Platz', '');
  for (const w of WEAPON_PROFILES) {
    p = assign(p, w.id, 'fire', { entryId: 'shot' });
    p = assign(p, w.id, 'mag_out', { entryId: 'reload' });
    for (const k of ['mag_in', 'slide', 'reload_finish']) p = assign(p, w.id, k, { entryId: SILENCE });
  }
  const plan = planBuild(p, WEAPON_PROFILES, loadMapping(), pack);
  let room = 0;
  const seen = new Set<number>(); // one sound per container is enough: the others in it get the same share (counted n times)
  for (const it of plan.items) {
    if (it.status !== 'ready' || it.assignment.entryId === SILENCE || seen.has(it.targets[0].group)) continue;
    seen.add(it.targets[0].group);
    const g = await inGameAudio(plan, pack, it, async (a) => (a.entryId === 'shot' ? shot : reload));
    const n = plan.items.filter((o) => o.status === 'ready' && o.assignment.entryId !== SILENCE && o.targets[0].group === it.targets[0].group).length;
    if (g) room += n * (g.gameSeconds / g.sourceSeconds) * (0.5 + 0.5 * Math.min(1, g.audio.sampleRate / 44100));
  }
  return room;
}

const isComplete = (c: BaseCandidate) => ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf'].every((n) => c.files.some((f) => f.name.toLowerCase() === n.toLowerCase()));

/** Opens the complete candidates (at most 15) and returns the one with the most room. */
async function roomiest(list: BaseCandidate[], onStage?: (s: string) => void): Promise<{ c: BaseCandidate; files: BaseFile[]; room: number } | null> {
  let best: { c: BaseCandidate; files: BaseFile[]; room: number } | null = null;
  for (const c of list.filter(isComplete).slice(0, 15)) {
    onStage?.(`Platz für lange Sounds wird verglichen: „${c.label}“…`);
    try {
      const files = await readBaseCandidate(c);
      const room = await soundRoom(openBase(files));
      if (!best || room > best.room) best = { c, files, room };
    } catch (e) { logger.warn(`Basis ${c.label} unbrauchbar: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return best;
}

/**
 * "Vorlage mit mehr Platz": switches to the soundpack on this PC with clearly more room for own sounds than the current
 * template. Returns its name, or null when there is none (or no PC search, e.g. in the browser).
 */
export async function moreRoomBase(onStage?: (s: string) => void): Promise<string | null> {
  if (!(await nativeInfo().catch(() => null))) return null;
  const cur = getBasePack()?.pack;
  const have = cur ? await soundRoom(cur) : 0;
  onStage?.('Soundpack-Dateien auf deinem PC werden gesucht…');
  const best = await roomiest(rankCandidates(await searchCandidates(0)), onStage);
  if (!best || best.room < have * 1.1 + 0.1) return null;
  await adoptBase(best.files, best.c.source, best.c.label);
  logger.info(`Vorlage mit mehr Platz: ${best.c.label} (${have.toFixed(2)} → ${best.room.toFixed(2)})`);
  return best.c.label;
}

const hasArchive = (p: Pack, n: string) => p.archives.some((a) => a.name.toLowerCase() === n.toLowerCase());
let completionTried = false;

/**
 * A template without RESIDENT.rpf (e.g. a mods folder that only holds WEAPONS_PLAYER.rpf) is completed once per start
 * with the RESIDENT.rpf of another soundpack found on this PC, so a created soundpack always has both files.
 */
export async function completeBase(onStage?: (s: string) => void): Promise<Pack | null> {
  const cur = getBasePack()?.pack ?? null;
  if (!cur || hasArchive(cur, 'RESIDENT.rpf') || completionTried) return cur;
  completionTried = true;
  if (!(await nativeInfo().catch(() => null))) return cur;
  onStage?.('RESIDENT.rpf fehlt in der Vorlage – wird auf deinem PC gesucht…');
  let list: BaseCandidate[] = [];
  try { list = rankCandidates(await searchCandidates(30_000)); } catch { return cur; }
  for (const c of list.filter((x) => x.files.some((f) => f.name.toLowerCase() === 'resident.rpf'))) {
    try {
      const res = (await readBaseCandidate(c)).filter((f) => baseArchiveName(f.name) === 'RESIDENT.rpf');
      if (!res.length) continue;
      const files = [...cur.archives.map((a) => ({ name: a.name, bytes: a.bytes })), ...res];
      const info = baseInfo();
      const pack = await adoptBase(files, info?.source ?? c.source, `${info?.label ?? 'Vorlage'} + RESIDENT aus „${c.label}“`);
      logger.info(`Vorlage ergänzt: RESIDENT.rpf aus ${c.label}`);
      return pack;
    } catch (e) { logger.warn(`RESIDENT aus ${c.label} unbrauchbar: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return cur;
}

// The PC search can take a few seconds – one result is reused for a short while (manual "Erneut suchen" forces a new one).
let lastSearch: { at: number; list: BaseCandidate[] } | null = null;
export async function searchCandidates(maxAgeMs = 0): Promise<BaseCandidate[]> {
  if (lastSearch && Date.now() - lastSearch.at < maxAgeMs) return lastSearch.list;
  const list = await findBaseCandidates();
  lastSearch = { at: Date.now(), list };
  return list;
}
