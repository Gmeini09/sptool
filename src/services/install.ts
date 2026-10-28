// Install / backups through the Windows app (SPTool.exe → package installer).
// Files are staged one by one (raw upload, hash computed on disk), then committed in one atomic step.
import { getState } from '../app/store';
import { nativeInfo } from './native';
import { logger } from './logger';

export interface ModFile { name: string; size: number; modified: number }
export interface BackupFile { name: string; existed: boolean; size?: number; sha256?: string }
export interface Backup { id: string; kind: 'install' | 'before-restore'; pack: string; version: string; createdAt: number; files: BackupFile[]; installed?: BackupFile[]; size: number }
export interface InstallFile { name: string; bytes: Uint8Array }

export class InstallError extends Error {
  constructor(message: string, public code: 'running' | 'nofivem' | 'native' | 'failed') { super(message); }
}

/** GTA V archive names FiveM overrides from its mods folder. */
export const KNOWN_ARCHIVES = ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf', 'WEAPONS_NPC.rpf', 'EXPLOSIONS.rpf', 'COLLISION.rpf'] as const;

/** "WEAPONS_PLAYER_5_7.rpf", "weapons_player (2).rpf" → "WEAPONS_PLAYER.rpf"; unknown names stay as they are. */
export function canonicalArchiveName(name: string): string {
  // strip browser/duplicate suffixes: " (2)", "_4", "__1_", "_5_7", "_9303d5"
  const base = name.replace(/\.rpf$/i, '').toUpperCase().replace(/[\s_-]+$/, '')
    .replace(/[\s_-]*(\(\d+\)|\d+([\s_-]+\d+)*|[0-9A-F]{6})$/, '').replace(/[\s_-]+$/, '');
  const hit = KNOWN_ARCHIVES.find((k) => k.replace(/\.rpf$/i, '') === base);
  return hit ?? name;
}

const root = () => encodeURIComponent(getState().settings.fivemPath || '');

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!(await nativeInfo())) throw new InstallError('Zum Installieren brauchst du die SP-Tool-Windows-App.', 'native');
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${path}${sep}root=${root()}`, { ...init, headers: { 'X-SPTool-Native': '1', ...(init?.headers ?? {}) } });
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String(body?.error ?? `Anfrage fehlgeschlagen (${r.status})`);
    throw new InstallError(msg, r.status === 409 ? 'running' : r.status === 404 && /fivem/i.test(msg) ? 'nofivem' : 'failed');
  }
  return body as T;
}

export const listMods = () => call<ModFile[]>('/native/mods');
export const listBackups = () => call<Backup[]>('/native/backups');

/** The weapon-sound archives in FiveM's mods folder that can serve as the base pack (newest of each kind). */
export async function findModsBasePack(): Promise<ModFile[]> {
  const mods = await listMods();
  const pick = (kind: string) => mods.filter((m) => canonicalArchiveName(m.name) === kind).sort((a, b) => b.modified - a.modified)[0];
  return [pick('WEAPONS_PLAYER.rpf'), pick('RESIDENT.rpf')].filter((m): m is ModFile => !!m);
}

/** Reads one .rpf from FiveM's mods folder (only read – nothing is changed). */
export async function readModFile(name: string): Promise<Uint8Array> {
  if (!(await nativeInfo())) throw new InstallError('Dafür brauchst du die SP-Tool-Windows-App.', 'native');
  const r = await fetch(`/native/mods/file?name=${encodeURIComponent(name)}&root=${root()}`, { headers: { 'X-SPTool-Native': '1' } });
  if (!r.ok) throw new InstallError(`${name} konnte nicht gelesen werden (${r.status}).`, 'failed');
  return new Uint8Array(await r.arrayBuffer());
}
export const restoreBackup = (id: string) => call<Backup>('/native/backups/restore', { method: 'POST', body: JSON.stringify({ id }) });
export const deleteBackup = (id: string) => call<void>('/native/backups/delete', { method: 'POST', body: JSON.stringify({ id }) });

/** Stages every file, then installs them together. Returns the backup made before replacing. */
export async function installFiles(files: InstallFile[], pack: string, version: string, onProgress?: (done: number, total: number) => void): Promise<Backup> {
  const { session } = await call<{ session: string }>('/native/stage/session', { method: 'POST' });
  const refs: Array<{ name: string; sha256: string }> = [];
  try {
    for (const [i, f] of files.entries()) {
      onProgress?.(i, files.length);
      const res = await call<{ sha256: string; size: number }>(`/native/stage?session=${session}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f.bytes as unknown as BodyInit });
      if (res.size !== f.bytes.byteLength) throw new InstallError(`${f.name} wurde nicht vollständig übertragen.`, 'failed');
      refs.push({ name: f.name, sha256: res.sha256 });
    }
    onProgress?.(files.length, files.length);
    const b = await call<Backup>('/native/install', { method: 'POST', body: JSON.stringify({ session, pack, version, files: refs }) });
    logger.info(`Installed ${files.map((f) => f.name).join(', ')} (backup ${b.id})`);
    return b;
  } catch (e) {
    void call('/native/stage/discard?session=' + session, { method: 'POST' }).catch(() => {});
    throw e;
  }
}

// Archives handed over from Build / Pack Analyzer to the Install screen (kept in memory only).
let pending: { files: InstallFile[]; pack: string; version: string } | null = null;
const subs = new Set<() => void>();
export function setPendingInstall(p: typeof pending) { pending = p; subs.forEach((f) => f()); }
export function getPendingInstall() { return pending; }
export function onPendingInstall(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

// ── base pack search on the PC (Windows app; read-only) ──────────────────────
export interface BaseCandidate { id: string; source: string; label: string; path: string; kind: 'dir' | 'zip'; modified: number; files: Array<{ name: string; size: number }> }
export const findBaseCandidates = () => call<BaseCandidate[]>('/native/base/candidates');
export async function readBaseCandidate(c: BaseCandidate): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const out: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const f of c.files) {
    const r = await fetch(`/native/base/file?id=${encodeURIComponent(c.id)}&name=${encodeURIComponent(f.name)}`, { headers: { 'X-SPTool-Native': '1' } });
    if (!r.ok) throw new InstallError(`${f.name} konnte nicht gelesen werden (${r.status}).`, 'failed');
    out.push({ name: f.name, bytes: new Uint8Array(await r.arrayBuffer()) });
  }
  return out;
}
