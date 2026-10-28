// In-app update: asks the license server for the newest SP Tool version (needs an active license), downloads
// the release ZIP with progress, checks its SHA-256 and hands it to the Windows app, which installs it and
// restarts. Nothing else changes: projects, settings and the login stay.
import { api, ApiError, authHeaders, getAccount } from '../account/account';
import { API_URL, accountsEnabled } from '../account/config';
import { getState } from '../app/store';
import { logger } from './logger';
import { nativeInfo } from './native';
import { versionCmp } from './appRelease';
import { changesBetween, mergeChangelog, setServerHistory, type ChangeEntry, type ServerHistoryEntry } from './changelog';

/** `changes`: every version between the installed one and this update, newest first (what the user gets). */
export interface UpdateInfo { version: string; size: number; sha256: string; notes: string; changes: ChangeEntry[] }
export interface UpdateState {
  available: UpdateInfo | null;
  phase: 'idle' | 'checking' | 'downloading' | 'installing' | 'restarting' | 'error';
  progress: number | null;
  error: string | null;
  checkedAt: number | null;
  dismissed: string | null; // version the user postponed in this session
  prompt: boolean; // the after-login window („Neues Update – willst du es?“) is open
}
let st: UpdateState = { available: null, phase: 'idle', progress: null, error: null, checkedAt: null, dismissed: null, prompt: false };
const subs = new Set<() => void>();
const emit = (p: Partial<UpdateState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const getUpdate = () => st;
export function onUpdate(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

const msg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

// „Diese Version überspringen“ is remembered on this PC – the next pushed version asks again.
const SKIP_KEY = 'sptool:update-skip';
export function skippedVersion(): string | null { try { return localStorage.getItem(SKIP_KEY); } catch { return null; } }

/**
 * Asks the server for a newer version. `manual` = the user clicked „Nach Updates suchen“ (reports „aktuell“ too).
 * `login` = right after signing in / starting: a pushed update is offered in a window, whatever the settings say,
 * unless the user skipped exactly that version.
 */
export async function checkForUpdate(manual = false, login = false): Promise<UpdateInfo | null> {
  if (st.phase === 'downloading' || st.phase === 'installing' || st.phase === 'restarting') return st.available;
  if (!manual && !login && !getState().settings.checkUpdates) return null;
  const info = await nativeInfo(); // only the Windows app can replace itself
  const acc = getAccount();
  if (!info || !/^\d+\.\d+\.\d+$/.test(info.version) || !accountsEnabled() || acc.phase !== 'ready' || !acc.online) {
    if (manual) emit({ error: !info ? 'Updates gibt es nur in der Windows-App.' : 'Melde dich an, um nach Updates zu suchen.' });
    return null;
  }
  emit({ phase: 'checking', error: null });
  try {
    const r = await api<{ version: string | null; size: number; sha256: string | null; notes?: string; history?: ServerHistoryEntry[] }>('GET', `/sptool-app/latest?v=${encodeURIComponent(info.version)}`, undefined, { keepSession: true }); // v → /sptool-version in Discord (a query, not a header: no new CORS header needed)
    setServerHistory(r.history);
    const newer = r.version && r.sha256 && versionCmp(r.version, info.version) > 0 ? { version: r.version, size: r.size, sha256: r.sha256, notes: (r.notes ?? '').trim(), changes: updateChanges(r, info.version) } : null;
    const skipped = !manual && !!newer && skippedVersion() === newer.version;
    const ask = !!newer && login && !skipped && st.dismissed !== newer.version;
    emit({ available: newer, phase: 'idle', checkedAt: Date.now(), prompt: ask, ...(skipped ? { dismissed: newer.version } : {}) });
    if (newer) logger.info(`Update available: v${newer.version} (installed v${info.version})`);
    return newer;
  } catch (e) {
    emit({ phase: 'idle', error: manual ? msg(e) : null, checkedAt: Date.now() });
    return null;
  }
}

/** What the update brings: the server's changelog (admin notes) for every skipped version; an older server sends only `notes`. */
function updateChanges(r: { version: string | null; notes?: string; history?: ServerHistoryEntry[] }, installed: string): ChangeEntry[] {
  const hist: ServerHistoryEntry[] = Array.isArray(r.history) ? r.history : r.version ? [{ version: r.version, notes: r.notes ?? '' }] : [];
  // only the server knows versions newer than this app; its built-in changelog fills older gaps
  return changesBetween(mergeChangelog(hist), installed, r.version!).filter((e) => e.items.length);
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Downloads, verifies and installs the available update. The app closes and restarts on success. */
export async function installUpdate(): Promise<void> {
  const up = st.available;
  if (!up || st.phase === 'downloading' || st.phase === 'installing' || st.phase === 'restarting') return;
  emit({ phase: 'downloading', progress: 0, error: null });
  try {
    const r = await fetch(`${API_URL}/api/v1/sptool-app/download`, { headers: await authHeaders(), cache: 'no-store' });
    if (!r.ok || !r.body) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error === 'license_required' ? 'Updates gibt es nur mit aktiver SP-Tool-Lizenz.' : `Download fehlgeschlagen (${r.status}).`);
    }
    const total = Number(r.headers.get('Content-Length')) || up.size || 0;
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) emit({ progress: Math.min(1, got / total) });
    }
    const zip = new Uint8Array(got);
    let o = 0; for (const c of chunks) { zip.set(c, o); o += c.length; }
    // the server may have published a newer build meanwhile – take version + hash from this very download
    const version = r.headers.get('X-SPTool-Version') || up.version;
    const sha = r.headers.get('X-SPTool-SHA256') || up.sha256;
    if ((await sha256Hex(zip.buffer)) !== sha.toLowerCase()) throw new Error('Die heruntergeladene Datei ist beschädigt. Versuch es noch einmal.');
    emit({ phase: 'installing', progress: null });
    const res = await fetch('/native/update', { method: 'POST', body: zip, headers: { 'X-SPTool-Native': '1', 'Content-Type': 'application/zip', 'X-SPTool-Version': version, 'X-SPTool-SHA256': sha } });
    if (res.status !== 202) throw new Error((await res.text().catch(() => '')).trim() || `Installation fehlgeschlagen (${res.status}).`);
    logger.info(`Update v${version} handed to the Windows app – restarting`);
    emit({ phase: 'restarting' });
  } catch (e) {
    const m = msg(e);
    logger.warn(`Update failed: ${m}`);
    emit({ phase: 'error', progress: null, error: m });
  }
}

/** „Später“: hidden until the next start / login. */
export const postponeUpdate = () => emit({ dismissed: st.available?.version ?? null, prompt: false });
/** „Diese Version überspringen“: never asked again for this version on this PC (Einstellungen can still install it). */
export function skipUpdate() {
  const v = st.available?.version;
  if (v) { try { localStorage.setItem(SKIP_KEY, v); } catch { /* storage blocked */ } logger.info(`Update v${v} skipped by the user`); }
  emit({ dismissed: v ?? null, prompt: false });
}
export const openUpdatePrompt = () => { if (st.available) emit({ prompt: true }); };
