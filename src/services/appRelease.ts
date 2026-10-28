// Admin only: pushes this SP Tool build to every user. The admin clicks „An alle verteilen“ (with „Was ist neu?“):
// this build packs itself into Turbo_Designs_SP_Tool.zip and hands it to the license server. From then on every
// user sees the update after login and decides whether to install it; key DMs carry this version too.
// Nothing is pushed automatically – opening a newer build only shows that it could be pushed.
import { api, ApiError, getAccount, isAdmin } from '../account/account';
import { can } from '../account/perms';
import { accountsEnabled } from '../account/config';
import { toast } from '../app/store';
import { logger } from './logger';
import { nativeInfo } from './native';
import { setServerHistory, type ServerHistoryEntry } from './changelog';

/** Compares "1.4.1"-style versions. */
export function versionCmp(a: string | null | undefined, b: string | null | undefined): number {
  const x = String(a || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

export interface ReleaseState { botVersion: string | null; botNotes: string; appVersion: string | null; busy: boolean; ok: boolean; error: string | null; checkedAt: number | null }
let st: ReleaseState = { botVersion: null, botNotes: '', appVersion: null, busy: false, ok: false, error: null, checkedAt: null };
const subs = new Set<() => void>();
const emit = (p: Partial<ReleaseState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const getRelease = () => st;
export function onRelease(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

const why = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.code === 'admin_only') return 'Dein Konto ist kein SP-Tool-Admin.';
    if (e.code.startsWith('cloud_')) return 'Die Anmeldung auf diesem PC ist veraltet – melde dich ab und wieder an.';
    if (e.code === 'offline') return 'Der Lizenzserver ist nicht erreichbar.';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
};

/** Reads which version is pushed right now (no upload). */
export async function refreshRelease(): Promise<void> {
  const acc = getAccount();
  if (!accountsEnabled() || acc.phase !== 'ready' || !(isAdmin(acc) || can('admin'))) return;
  const info = await nativeInfo().catch(() => null);
  try {
    const cur = await api<{ version: string | null; notes?: string; history?: ServerHistoryEntry[] }>('GET', '/sptool-app/release', undefined, { keepSession: true });
    setServerHistory(cur.history);
    emit({ botVersion: cur.version, botNotes: cur.notes ?? '', appVersion: info?.version ?? null, checkedAt: Date.now(), error: null });
  } catch (e) { emit({ error: why(e), appVersion: info?.version ?? null }); }
}

/**
 * Pushes this build to every user (only a newer version than the pushed one). With the same version only the notes
 * are updated. Returns what happened.
 */
export async function pushRelease(notes: string): Promise<'published' | 'notes' | 'current' | 'skipped' | 'failed'> {
  const acc = getAccount();
  if (st.busy || !accountsEnabled() || acc.phase !== 'ready' || !(isAdmin(acc) || can('admin'))) return 'skipped';
  const info = await nativeInfo().catch(() => null); // only the Windows app can pack itself
  const appVersion = info?.version ?? '';
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) { toast('warning', 'Verteilen geht nur in der Windows-App'); return 'skipped'; }
  emit({ busy: true, appVersion, error: null });
  try {
    const cur = await api<{ version: string | null }>('GET', '/sptool-app/release', undefined, { keepSession: true });
    const cmp = versionCmp(appVersion, cur.version);
    if (cmp < 0) { toast('warning', `Verteilt ist schon die neuere v${cur.version}`, 'Öffne die neueste SP-Tool-Version, um sie zu verteilen.'); return 'current'; }
    const headers = { 'Content-Type': 'application/zip', 'X-SPTool-Version': appVersion, 'X-SPTool-Notes': encodeURIComponent(notes.trim().slice(0, 1000)) };
    let zip: Blob;
    if (cmp === 0) zip = new Blob([]); // same version: only the notes change
    else {
      const r = await fetch('/native/app-package', { cache: 'no-store', headers: { 'X-SPTool-Native': '1' } });
      if (!r.ok) throw new Error(`Packen der App fehlgeschlagen (${r.status}).`);
      zip = await r.blob();
    }
    const res = await api<{ stored: boolean; version: string; notesUpdated?: boolean }>('POST', '/sptool-app/release', undefined, { keepSession: true, raw: zip, headers });
    emit({ ok: true, botVersion: res.version, botNotes: notes.trim() });
    void refreshRelease(); // the changelog (Einstellungen → Updates) shows the new text right away
    if (res.notesUpdated) { toast('success', `„Was ist neu?“ für v${appVersion} aktualisiert`); return 'notes'; }
    if (!res.stored) return 'current';
    logger.info(`App v${appVersion} pushed to all users (${(zip.size / 1048576).toFixed(1)} MB)`);
    toast('success', `SP Tool v${appVersion} ist verteilt`, 'Alle Nutzer sehen das Update beim nächsten Login bzw. Start und entscheiden selbst. Key-DMs enthalten ab jetzt diese Version.');
    return 'published';
  } catch (e) {
    const msg = why(e);
    emit({ error: msg });
    logger.warn(`Pushing the app failed: ${msg}`);
    toast('error', 'Update konnte nicht verteilt werden', msg);
    return 'failed';
  } finally { emit({ busy: false }); }
}
