// SP Tool Cloud – conflict-safe project sync with the license server (Premium and up).
//
// For every project the app remembers the cloud revision and a content hash from the last sync.
// From that, each project gets a status; automatic sync only does the safe cases (upload local changes,
// download newer cloud copies). Conflicts are never resolved silently – the user picks:
// keep local, use cloud or keep both.
import { getState, setState, toast } from '../app/store';
import { api, ApiError, getAccount } from '../account/account';
import { accountsEnabled } from '../account/config';
import { can } from '../account/perms';
import { logger } from '../services/logger';
import { buildProjectFile, importProjectSounds } from './actions';
import { newProject, parseProjectFile, type Project, type ProjectFile } from './project';

import { computeStatus, contentHash, type CloudProject, type CloudRow, type CloudUsage } from './cloudStatus';
import { readMeta, setMeta, setMetaUser, setMetaUserProvider } from './cloudMeta';
setMetaUserProvider(() => getAccount().me?.user.id ?? null);
export { computeStatus, contentHash, type CloudProject, type CloudRow, type CloudStatus, type CloudUsage } from './cloudStatus';

// ── state ────────────────────────────────────────────────────────────────────
const AUTO_KEY = 'sptool:cloud-auto';
export const autoSyncEnabled = () => localStorage.getItem(AUTO_KEY) !== 'false';
export const setAutoSync = (on: boolean) => localStorage.setItem(AUTO_KEY, on ? 'true' : 'false');

export interface CloudSnapshot { rows: CloudRow[]; usage: CloudUsage | null; lastSync: number | null; error: string | null; busy: boolean }
let snap: CloudSnapshot = { rows: [], usage: null, lastSync: null, error: null, busy: false };
const subs = new Set<() => void>();
const emit = (patch: Partial<CloudSnapshot>) => { snap = { ...snap, ...patch }; subs.forEach((f) => f()); };
export const getCloud = () => snap;
export function onCloud(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

export const cloudAvailable = () => accountsEnabled() && getAccount().phase === 'ready' && can('cloud');

// ── server calls ─────────────────────────────────────────────────────────────
// Cloud problems must never sign the user out – the license session is checked by the license API.
const KEEP = { keepSession: true };
const listRemote = () => api<{ projects: CloudProject[]; usage: CloudUsage }>('GET', '/cloud/projects', undefined, KEEP);
const getRemote = (id: string) => api<{ id: string; name: string; rev: number; data: ProjectFile }>('GET', `/cloud/projects/${id}`, undefined, KEEP);
const putRemote = (id: string, baseRev: number, name: string, data: ProjectFile) => api<{ rev: number }>('POST', `/cloud/projects/${id}`, { baseRev, name, data }, KEEP);
const delRemote = (id: string, baseRev: number) => api<{ rev: number }>('POST', `/cloud/projects/${id}/delete`, { baseRev }, KEEP);

/** Cloud copy without local history (snapshots stay on this PC). */
async function payload(p: Project): Promise<ProjectFile> {
  const f = await buildProjectFile(p);
  return { ...f, project: { ...f.project, snapshots: [] } };
}

export async function refreshCloud(): Promise<CloudRow[]> {
  setMetaUser(getAccount().me?.user.id ?? null);
  const { projects, usage } = await listRemote();
  // forget "deleted here" marks once the cloud copy is gone as well
  const meta = readMeta();
  for (const [id, m] of Object.entries(meta)) if (m.removed && !projects.some((c) => c.id === id && !c.deleted)) setMeta(id, null);
  const local = getState().projects.map((p) => ({ project: p, hash: contentHash(p) }));
  const rows = computeStatus(local, projects, readMeta());
  emit({ rows, usage, error: null });
  return rows;
}

async function upload(p: Project, baseRev: number) {
  const r = await putRemote(p.id, baseRev, p.name, await payload(p));
  setMeta(p.id, { rev: r.rev, hash: contentHash(p) });
}

class LocalChanged extends Error {}

/** Downloads the cloud copy. Without `force` it refuses when the local project changed since the sync
 *  started (edits made while a sync runs are never overwritten – the project shows as a conflict instead). */
async function download(id: string, asNew = false, force = false): Promise<Project> {
  const before = getState().projects.find((p) => p.id === id);
  const beforeHash = before ? contentHash(before) : null;
  const r = await getRemote(id);
  const parsed = parseProjectFile(JSON.stringify(r.data));
  await importProjectSounds(parsed);
  const cur = getState().projects.find((p) => p.id === id);
  if (!asNew && !force && cur) {
    const m = readMeta()[id];
    if (contentHash(cur) !== beforeHash || (m && m.hash !== beforeHash)) throw new LocalChanged('changed locally');
  }
  if (asNew) {
    const fresh = newProject(`${parsed.project.name} (Cloud)`, parsed.project.author);
    const p = { ...parsed.project, id: fresh.id, name: fresh.name, snapshots: [], updatedAt: Date.now() };
    setState((s) => ({ projects: [p, ...s.projects] }));
    return p;
  }
  const p: Project = { ...parsed.project, id, snapshots: cur?.snapshots ?? [], updatedAt: Date.now() };
  setState((s) => ({ projects: cur ? s.projects.map((x) => (x.id === id ? p : x)) : [p, ...s.projects] }));
  setMeta(id, { rev: r.rev, hash: contentHash(p) });
  return p;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Safe automatic sync: uploads local changes and new projects, downloads newer and new cloud copies. */
export async function syncNow(opts: { quiet?: boolean } = {}): Promise<{ up: number; down: number; conflicts: number }> {
  if (snap.busy) return { up: 0, down: 0, conflicts: 0 };
  emit({ busy: true });
  let up = 0, down = 0;
  try {
    const rows = await refreshCloud();
    for (const r of rows) {
      try {
        if ((r.status === 'local-only' || r.status === 'modified') && r.local) { await upload(r.local, r.cloud && !r.cloud.deleted ? r.cloud.rev : r.cloud?.rev ?? 0); up++; }
        else if (r.status === 'cloud-newer' || r.status === 'cloud-only') { await download(r.id); down++; }
      } catch (e) {
        if (e instanceof LocalChanged || (e instanceof ApiError && e.status === 409)) continue; // changed meanwhile → shows as conflict after refresh
        if (e instanceof ApiError && (e.code === 'quota' || e.code === 'too_large')) { if (!opts.quiet) toast('warning', `${r.name} wurde nicht hochgeladen`, e.message); continue; }
        throw e;
      }
    }
    const after = await refreshCloud();
    const conflicts = after.filter((r) => r.status === 'conflict').length;
    emit({ lastSync: Date.now(), error: null });
    if (up || down) logger.info(`Cloud sync: ${up} uploaded, ${down} downloaded${conflicts ? `, ${conflicts} conflict(s)` : ''}`);
    if (!opts.quiet) toast(conflicts ? 'warning' : 'success', conflicts ? `${conflicts} Soundpack${conflicts > 1 ? 's brauchen' : ' braucht'} eine Entscheidung` : 'Cloud ist auf dem neuesten Stand', up || down ? `${up} hochgeladen · ${down} heruntergeladen` : undefined);
    return { up, down, conflicts };
  } catch (e) {
    emit({ error: msg(e) });
    if (!opts.quiet) toast('error', 'Cloud-Abgleich fehlgeschlagen', msg(e));
    return { up, down, conflicts: 0 };
  } finally { emit({ busy: false }); }
}

/** User decision for one project. Never loses data: "both" keeps the local project and adds the cloud copy. */
export type CloudChoice = 'local' | 'cloud' | 'both' | 'remove-local' | 'delete-cloud' | 'restore';
export async function resolve(row: CloudRow, choice: CloudChoice) {
  if (snap.busy) return; // one cloud operation at a time
  emit({ busy: true });
  try {
    const cloudRev = row.cloud?.rev ?? 0;
    if (choice === 'local' && row.local) await upload(row.local, cloudRev);
    else if (choice === 'cloud' || choice === 'restore') await download(row.id, false, true);
    else if (choice === 'both') {
      // save the cloud version as a new local project, then upload both; on failure the copy is removed again
      const copy = await download(row.id, true);
      try {
        if (row.local) await upload(row.local, cloudRev);
      } catch (e) {
        setState((s) => ({ projects: s.projects.filter((p) => p.id !== copy.id) }));
        throw e;
      }
      await upload(copy, 0);
    } else if (choice === 'remove-local') {
      setState((s) => ({ projects: s.projects.filter((p) => p.id !== row.id), currentProjectId: s.currentProjectId === row.id ? null : s.currentProjectId }));
      setMeta(row.id, null);
    } else if (choice === 'delete-cloud') {
      const r = await delRemote(row.id, cloudRev);
      // keep the local project, but do not upload it again on its own
      if (row.local) setMeta(row.id, { rev: r.rev, hash: contentHash(row.local), unlinked: true });
      else setMeta(row.id, null);
    }
    await refreshCloud();
  } catch (e) {
    toast('error', 'Cloud-Aktion fehlgeschlagen', e instanceof ApiError && e.status === 409 ? 'Die Cloud-Kopie wurde auf einem anderen PC geändert – prüf es noch einmal.' : msg(e));
    await refreshCloud().catch(() => {});
  } finally { emit({ busy: false }); }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Background sync every 2 minutes while signed in with a Premium+ plan and auto-sync is on. */
export function startCloudAutoSync() {
  if (timer) return;
  const tick = () => { if (cloudAvailable() && autoSyncEnabled() && navigator.onLine) void syncNow({ quiet: true }); };
  setTimeout(tick, 8000);
  timer = setInterval(tick, 120_000);
}
