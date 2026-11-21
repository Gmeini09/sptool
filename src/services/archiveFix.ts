// ArchiveFix (GTA V archive re-encryption tool) run by the Windows app: a rebuilt archive (open table of contents, like
// OpenIV writes it) is handed to ArchiveFix.exe exactly as if the user dropped the file onto it. Afterwards the game
// reads it from x64/audio/sfx. Only in the Windows app – the browser preview cannot start programs.
import { getState, updateSettings } from '../app/store';
import { setArchiveFixMode } from '../formats/pack';
import { logger } from './logger';
import { nativeInfo } from './native';

const H = { 'X-SPTool-Native': '1' };

export interface ArchiveFixInfo { path: string; hasKeys: boolean }

/**
 * Where ArchiveFix.exe is (the path from the settings, else found on Desktop / Downloads / Documents); null if none.
 * Also switches the build to the OpenIV + ArchiveFix way when ArchiveFix is ready (with its key files).
 */
export async function findArchiveFix(): Promise<ArchiveFixInfo | null> {
  const native = await nativeInfo().catch(() => null);
  const r = native ? await fetch(`/native/archivefix/find?path=${encodeURIComponent(getState().settings.archiveFixPath || '')}`, { headers: H }).catch(() => null) : null;
  const info = r?.ok ? ((await r.json()) as ArchiveFixInfo) : null;
  setArchiveFixMode(!!info?.hasKeys);
  if (info && info.path !== getState().settings.archiveFixPath) updateSettings({ archiveFixPath: info.path });
  return info;
}

async function runArchiveFix(exe: string, name: string, bytes: Uint8Array): Promise<Uint8Array> {
  const r = await fetch(`/native/archivefix/run?exe=${encodeURIComponent(exe)}&file=${encodeURIComponent(name)}`, { method: 'POST', headers: H, body: bytes as unknown as BodyInit });
  if (!r.ok) throw new Error((await r.text()).trim() || `ArchiveFix fehlgeschlagen (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

export interface ArchiveFixResult<T> { outputs: T[]; fixed: string[]; missing: boolean; error: string | null }

/** Encrypts every rebuilt (open) archive with ArchiveFix; archives that are not open stay as they are. */
export async function applyArchiveFix<T extends { name: string; bytes: Uint8Array; open: boolean }>(outputs: T[], onStep?: (text: string) => void): Promise<ArchiveFixResult<T>> {
  if (!outputs.some((o) => o.open)) return { outputs, fixed: [], missing: false, error: null };
  const af = await findArchiveFix();
  if (!af) return { outputs, fixed: [], missing: true, error: null };
  const fixed: string[] = [];
  const out: T[] = [];
  try {
    for (const o of outputs) {
      if (!o.open) { out.push(o); continue; }
      onStep?.(`ArchiveFix verschlüsselt ${o.name}…`);
      out.push({ ...o, bytes: await runArchiveFix(af.path, o.name, o.bytes), open: false });
      fixed.push(o.name);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.warn(`ArchiveFix: ${error}`);
    return { outputs, fixed: [], missing: false, error };
  }
  logger.info(`ArchiveFix (${af.path}): ${fixed.join(', ')} verschlüsselt`);
  return { outputs: out, fixed, missing: false, error: null };
}
