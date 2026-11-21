// "Ist es im Spiel?" – compares the archives SP Tool just built with what lies in GTA V\x64\audio\sfx, where the user
// puts them himself. Read only: nothing is copied or changed. The game reads WEAPONS_PLAYER.rpf / RESIDENT.rpf only
// directly from sfx\ and only when it starts, so the usual reasons for "still the old pack" are found here.
import { getState } from '../app/store';
import { nativeInfo } from './native';
import { canonicalArchiveName } from './install';

export interface ScanFile { path: string; name: string; depth: number; size: number; modified: number; sha256: string }
export interface ScanResult { modsDir: string; running: boolean; files: ScanFile[] }

export type FileState =
  | { kind: 'ok' }
  | { kind: 'old'; modified: number }                 // another file of that name lies in sfx\ (original or old pack)
  | { kind: 'subfolder'; path: string; old: boolean } // ours lies in a subfolder – the game does not read it there
  | { kind: 'renamed'; path: string }                 // ours lies in sfx\ under another name ("WEAPONS_PLAYER (2).rpf")
  | { kind: 'needsFix' }                              // ours lies in sfx\ but ArchiveFix has not encrypted it yet
  | { kind: 'missing' };
export interface CheckResult { modsDir: string; running: boolean; files: Array<{ name: string; state: FileState }>; allOk: boolean }

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Pure part (tested): built files (name + hash) against a scan of the sfx folder. open: the file still has an open
 * table of contents – the exact file in sfx\ needs ArchiveFix; ArchiveFix only encrypts the table of contents, so a
 * file of the same size with another hash is ours after ArchiveFix.
 */
export function compareWithMods(built: Array<{ name: string; sha256: string; size?: number; open?: boolean }>, scan: ScanResult): CheckResult {
  const files = built.map(({ name, sha256, size, open }) => {
    const top = scan.files.find((f) => f.depth === 0 && f.name.toLowerCase() === name.toLowerCase());
    if (top && top.sha256 === sha256) return { name, state: (open ? { kind: 'needsFix' } : { kind: 'ok' }) as FileState };
    if (open && top && size !== undefined && top.size === size) return { name, state: { kind: 'ok' } as FileState };
    const ours = scan.files.filter((f) => f.sha256 === sha256);
    const renamed = ours.find((f) => f.depth === 0);
    if (renamed && canonicalArchiveName(renamed.name).toLowerCase() === name.toLowerCase()) return { name, state: { kind: 'renamed', path: renamed.path } as FileState };
    const sub = ours.find((f) => f.depth > 0);
    if (sub) return { name, state: { kind: 'subfolder', path: sub.path, old: !!top } as FileState };
    if (top) return { name, state: { kind: 'old', modified: top.modified } as FileState };
    return { name, state: { kind: 'missing' } as FileState };
  });
  return { modsDir: scan.modsDir, running: scan.running, files, allOk: files.every((f) => f.state.kind === 'ok') };
}

const q = () => `root=${encodeURIComponent(getState().settings.fivemPath || '')}&gta=${encodeURIComponent(getState().settings.gtaPath || '')}`;

export async function scanMods(): Promise<ScanResult> {
  if (!(await nativeInfo())) throw new Error('Das Prüfen geht nur in der SP-Tool-Windows-App.');
  const r = await fetch(`/native/sfx/scan?${q()}`, { headers: { 'X-SPTool-Native': '1' } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 404 ? 'GTA V wurde nicht gefunden. Trag den GTA-V-Ordner unter Einstellungen ein.' : String(body?.error ?? `Prüfen fehlgeschlagen (${r.status})`));
  return body as ScanResult;
}

export async function checkInGame(built: Array<{ name: string; sha256: string; size?: number; open?: boolean }>): Promise<CheckResult> {
  return compareWithMods(built, await scanMods());
}

/** Opens GTA V\x64\audio\sfx in Explorer (only opens the folder). */
export async function showSfxFolder(): Promise<boolean> {
  if (!(await nativeInfo())) return false;
  const r = await fetch(`/native/sfx/show?${q()}`, { method: 'POST', headers: { 'X-SPTool-Native': '1' } });
  return r.ok;
}
