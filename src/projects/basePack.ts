// The base pack (WEAPONS_PLAYER.rpf + RESIDENT.rpf of any working weapon soundpack) is set up once and kept:
// stored locally and loaded again on every start, also after updates. Sources: the PC search (FiveM / OpenIV
// mods folders, Downloads, Desktop – also inside ZIPs), drag & drop, or picking the files by hand.
import { canonicalArchiveName, findBaseCandidates, readBaseCandidate, type BaseCandidate } from '../services/install';
import { nativeInfo } from '../services/native';
import { loadJSON, saveJSON, getBlob, putBlob, deleteBlob, removeKey } from '../services/storage';
import { logger } from '../services/logger';
import { ensureNgKeys, restoreNgKeys } from '../services/ngKeys';
import { openPack, type Pack } from '../formats/pack';
import { readRpfHeader } from '../formats/rpf';
import { findGtaKey, hasGtaKey, isExactOriginal, NeedGtaKeyError, ORIGINAL_SIZES, originalArchive, setGtaKey } from '../formats/gtaOriginal';
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
    await restoreNgKeys(); // kept from last time – lets SP Tool read and save NG archives like OpenIV
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

// ── The original GTA V soundpack as template ─────────────────────────────────────────────────────────────────────
export const ORIGINAL_LABEL = 'Original GTA V';
/** true when these files are Rockstar's original archives (also once SP Tool patched them). */
export const isOriginalPack = (files: BaseFile[]) => files.some((f) => !!originalArchive(f.bytes));

const hexBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
/**
 * The AWC key for the original archives: kept from last time, from a GTA5.exe the user dropped, or – in the Windows
 * app – read from the GTA5.exe in the GTA V folder.
 */
export async function ensureGtaKey(dropped: File[] = []): Promise<void> {
  // the NG keys come from the same GTA5.exe (plus CodeWalker's magic.dat) – without them long sounds cannot be saved
  await ensureNgKeys(dropped).catch((e) => logger.warn(`NG-Schlüssel nicht geladen: ${e instanceof Error ? e.message : String(e)}`));
  if (hasGtaKey()) return;
  const exe = dropped.find((f) => /^gta5\.exe$/i.test(f.name));
  if (exe) {
    const k = findGtaKey(new Uint8Array(await exe.arrayBuffer()));
    if (!k) throw new BaseError('In dieser GTA5.exe wurde der Schlüssel nicht gefunden – nimm die GTA5.exe von GTA V Legacy (nicht GTA5_Enhanced.exe).');
    setGtaKey(k);
    return;
  }
  if (await nativeInfo().catch(() => null)) {
    const r = await fetch('/native/gta/awckey', { headers: { 'X-SPTool-Native': '1' } });
    if (r.ok) { setGtaKey(hexBytes(((await r.json()) as { key: string }).key)); return; }
  }
  throw new NeedGtaKeyError();
}

/** Windows app: the original WEAPONS_PLAYER.rpf + RESIDENT.rpf straight from the GTA V folder (x64/audio/sfx). */
export async function originalFromGta(): Promise<BaseFile[]> {
  if (!(await nativeInfo().catch(() => null))) throw new BaseError('Das geht nur in der Windows-App – zieh das Original-Soundpack hier rein.');
  const files: BaseFile[] = [];
  for (const name of ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf']) {
    const r = await fetch(`/native/gta/sfx?name=${name}`, { headers: { 'X-SPTool-Native': '1' } });
    if (!r.ok) throw new BaseError('GTA V wurde auf diesem PC nicht gefunden. Zieh das Original-Soundpack (WEAPONS_PLAYER.rpf + RESIDENT.rpf) hier rein.');
    files.push({ name, bytes: new Uint8Array(await r.arrayBuffer()) });
  }
  if (!(await exactOriginal(files))) throw new BaseError('Im GTA-V-Ordner liegt nicht mehr das Original (dort ist schon ein Soundpack eingebaut). Zieh das Original-Soundpack hier rein.');
  return files;
}

/** Both archives present and byte for byte Rockstar's originals (nothing of a custom soundpack mixed in). */
export async function exactOriginal(files: BaseFile[]): Promise<boolean> {
  for (const n of ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf']) {
    const f = files.find((x) => baseArchiveName(x.name) === n);
    if (!f || !(await isExactOriginal(n, f.bytes))) return false;
  }
  return true;
}

/** A found soundpack that is Rockstar's original (both archives, original sizes). */
export const isOriginalCandidate = (c: BaseCandidate) => ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf'].every((n) => c.files.some((f) => f.name.toLowerCase() === n.toLowerCase() && f.size === ORIGINAL_SIZES[n]));

/**
 * The original GTA V soundpack is the template whenever it is on this PC (Windows app): from the GTA V folder, else
 * from wherever the PC search finds it (e.g. Downloads). Runs on start; quiet when there is none (checked once a day).
 * Returns true when it switched to the original.
 */
let originalTried = false;
export async function preferOriginal(force = false): Promise<boolean> {
  if (baseInfo()?.label === ORIGINAL_LABEL && getBasePack()) return false;
  if (!(await nativeInfo().catch(() => null))) return false;
  if (originalTried && !force) return false; // once per start (the PC search takes a few seconds)
  originalTried = true;
  const files = await findOriginalFiles().catch(() => null);
  if (!files) return false;
  try { await adoptOriginal(files); } catch (e) { logger.warn(`Original-GTA-Soundpack gefunden, aber nicht nutzbar: ${e instanceof Error ? e.message : String(e)}`); return false; }
  return true;
}

/** The original archives on this PC: from the GTA V folder, else wherever the PC search finds them (e.g. Downloads). */
export async function findOriginalFiles(): Promise<BaseFile[]> {
  try { return await originalFromGta(); } catch (e) { if (!(await nativeInfo().catch(() => null))) throw e; }
  // every found copy with the original sizes is checked byte for byte – the first untouched one is taken
  for (const c of (await searchCandidates(0).catch(() => [] as BaseCandidate[])).filter(isOriginalCandidate)) {
    const files = await readBaseCandidate(c).catch(() => null);
    if (files && (await exactOriginal(files))) return files;
  }
  throw new BaseError('Das unveränderte Original-GTA-Soundpack wurde auf diesem PC nicht gefunden – weder im GTA-V-Ordner noch in Downloads, Desktop oder Dokumente. Zieh WEAPONS_PLAYER.rpf + RESIDENT.rpf (Original) hier rein.');
}

/** Uses Rockstar's original soundpack as template ("Original behalten" then sounds like GTA V). */
export async function adoptOriginal(files: BaseFile[], dropped: File[] = []): Promise<Pack> {
  if (!(await exactOriginal(files))) throw new BaseError('Das ist nicht das unveränderte Original-GTA-Soundpack (es fehlt eine Datei oder es wurde verändert, z. B. durch ein Custom-SP). SP Tool nimmt nur die echten Original-Dateien, damit sich nichts vermischt.');
  await ensureGtaKey(dropped);
  return adoptBase(files.filter((f) => originalArchive(f.bytes)), 'Rockstar', ORIGINAL_LABEL);
}

/** Files the user picked or dropped: .rpf files and/or soundpack ZIPs. */
export async function baseFromUserFiles(list: File[]): Promise<{ files: BaseFile[]; label: string }> {
  const files: BaseFile[] = [];
  let label = list[0]?.name ?? 'Eigene Dateien';
  for (const f of list) {
    if (/^gta5\.exe$/i.test(f.name)) continue; // the key for the original pack (ensureGtaKey)
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
  // Rockstar's original first: "Original behalten" then really is GTA V
  const score = (c: BaseCandidate) => (isOriginalCandidate(c) ? 8 : 0) + (isComplete(c) ? 4 : 0) + (c.source.startsWith('FiveM') ? 2 : 0);
  // never the in-game test pack (beeps) as a template
  return list.filter((c) => !/zuordnungstest/i.test(c.path)).sort((a, b) => score(b) - score(a) || b.modified - a.modified);
}

/**
 * The base for "Soundpack erstellen" without asking: the stored one, otherwise the best soundpack found on this PC
 * (adopted and kept). Returns null when there is none – then the user has to drop one in once.
 */
export async function ensureBase(onStage?: (s: string) => void): Promise<Pack | null> {
  if (!getBasePack()) await restoreBase();
  // the original GTA V soundpack is THE template: taken whenever it is on this PC, never replaced by another pack
  if (baseInfo()?.label !== ORIGINAL_LABEL && (await nativeInfo().catch(() => null))) {
    onStage?.('Original-GTA-Soundpack wird gesucht…');
    if (await preferOriginal(true).catch(() => false)) return getBasePack()?.pack ?? null;
  }
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
 * Room for own sounds in a pack: how much of a long shot (1.2 s) for every pistol and a whole reload (1.6 s) fits
 * 1 : 1 – 1 per sound that fits whole. Container sizes cannot grow (encrypted archive), so a pack whose creator used
 * long sounds there has more room.
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
    if (g) room += n * Math.max(0, 1 - g.overSeconds / (n * g.sourceSeconds));
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
  if (baseInfo()?.label === ORIGINAL_LABEL) return null; // the original stays the template
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
