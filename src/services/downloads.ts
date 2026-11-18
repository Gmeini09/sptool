// Saves finished archives as ONE ZIP – Downloads\SP Tool\<pack>.zip in the Windows app (no save dialog), the browser's
// download folder otherwise. Nothing is ever written into FiveM: the user unpacks the ZIP into the mods folder himself.
import { nativeInfo } from './native';
import { saveBytes } from './tauri';
import { writeZip } from '../formats/zipWrite';

/** `zip`: phones and browsers get one ZIP (files at its top level) instead of several downloads in a row. */
export interface SavedFiles { dir: string | null; names: string[]; zip?: string }

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Soundpack';

export async function saveToDownloads(folder: string, files: Array<{ name: string; bytes: Uint8Array }>): Promise<SavedFiles> {
  const dir = safeName(folder);
  const zip = `${dir}.zip`;
  // the archives at the top of the ZIP, no folder: they belong DIRECTLY into FiveM.app\mods – FiveM does not read
  // WEAPONS_PLAYER.rpf / RESIDENT.rpf from a subfolder, so a folder in the ZIP led to "still the old pack in game"
  const bytes = writeZip(files.map((f) => ({ name: f.name, bytes: f.bytes })));
  if (await nativeInfo()) {
    const r = await fetch(`/native/downloads/save?file=${encodeURIComponent(zip)}`, {
      method: 'POST', headers: { 'X-SPTool-Native': '1', 'Content-Type': 'application/zip' }, body: new Blob([bytes as unknown as BlobPart]),
    });
    if (!r.ok) throw new Error((await r.text().catch(() => '')) || `${zip} konnte nicht gespeichert werden (${r.status}).`);
    return { dir: ((await r.json()) as { dir: string }).dir, names: files.map((f) => f.name), zip };
  }
  await saveBytes(zip, bytes, { name: 'ZIP-Datei', extensions: ['zip'] });
  return { dir: null, names: files.map((f) => f.name), zip };
}

// ── Windows app: export into a folder the user picks ─────────────────────────────────────────────────────────────

const native = (path: string, init?: RequestInit) =>
  fetch(path, { method: 'POST', ...init, headers: { 'X-SPTool-Native': '1', ...(init?.headers ?? {}) } });

/** Windows folder dialog; null when cancelled. Refuses the GTA V folder (SP Tool never writes into the game). */
export async function pickExportFolder(initial = ''): Promise<string | null> {
  const r = await native(`/native/export/pick?initial=${encodeURIComponent(initial)}`);
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `Ordner-Dialog fehlgeschlagen (${r.status}).`);
  return ((await r.json()) as { folder: string }).folder || null;
}

/** Writes WEAPONS_PLAYER.rpf / RESIDENT.rpf directly into `folder` (replacing files of the same name there). */
export async function saveToFolder(folder: string, files: Array<{ name: string; bytes: Uint8Array }>): Promise<SavedFiles> {
  let dir = folder;
  for (const f of files) {
    const r = await native(`/native/export/save?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(f.name)}`, {
      headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([f.bytes as unknown as BlobPart]),
    });
    if (!r.ok) throw new Error((await r.text().catch(() => '')) || `${f.name} konnte nicht gespeichert werden (${r.status}).`);
    dir = ((await r.json()) as { dir: string }).dir;
  }
  return { dir, names: files.map((f) => f.name) };
}

export async function showFolder(folder: string): Promise<boolean> {
  return (await native(`/native/export/show?folder=${encodeURIComponent(folder)}`)).ok;
}

/** Opens Downloads\SP Tool\<folder> in Explorer (Windows app only). */
export async function showDownloads(folder?: string): Promise<boolean> {
  if (!(await nativeInfo())) return false;
  const r = await fetch(`/native/downloads/show${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`, { method: 'POST', headers: { 'X-SPTool-Native': '1' } });
  return r.ok;
}
