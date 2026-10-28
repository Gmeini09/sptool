// Pure cloud-sync status logic (no app state) – see cloud.ts.
import type { Project } from './project';

export interface CloudProject { id: string; name: string; rev: number; updatedAt: number; size: number; deleted: boolean }
export interface CloudUsage { count: number; bytes: number; maxBytes: number; maxCount: number; maxProject: number }
export type CloudStatus = 'synced' | 'modified' | 'cloud-newer' | 'conflict' | 'local-only' | 'cloud-only' | 'deleted-in-cloud'
  | 'removed-here' // deleted on this PC, still in the cloud – waits for a decision
  | 'unlinked'; // removed from the cloud on this PC, kept locally – not uploaded again on its own
export interface CloudRow { id: string; name: string; status: CloudStatus; local?: Project; cloud?: CloudProject }
export interface Meta { rev: number; hash: string; removed?: boolean; unlinked?: boolean }

// ── content hash (what counts as a change) ───────────────────────────────────
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16);
}
/** Snapshots and timestamps are local history, not content. */
export const contentHash = (p: Project) => fnv(JSON.stringify({ name: p.name, author: p.author, version: p.version, description: p.description, weapons: p.weapons }));

// ── status (pure) ────────────────────────────────────────────────────────────
export function computeStatus(local: Array<{ project: Project; hash: string }>, cloud: CloudProject[], meta: Record<string, Meta>): CloudRow[] {
  const rows: CloudRow[] = [];
  const cmap = new Map(cloud.map((c) => [c.id, c]));
  for (const { project, hash } of local) {
    const c = cmap.get(project.id), m = meta[project.id];
    cmap.delete(project.id);
    const base = { id: project.id, name: project.name, local: project, cloud: c };
    if (!c) { rows.push({ ...base, status: 'local-only' }); continue; }
    if (!m || m.removed) { rows.push({ ...base, status: c.deleted ? 'local-only' : 'conflict' }); continue; } // same id, never synced here
    const changedLocal = m.hash !== hash, changedCloud = c.rev !== m.rev;
    if (m.unlinked && c.deleted) { rows.push({ ...base, status: 'unlinked' }); continue; }
    if (c.deleted) rows.push({ ...base, status: changedLocal ? 'conflict' : 'deleted-in-cloud' });
    else rows.push({ ...base, status: changedLocal && changedCloud ? 'conflict' : changedLocal ? 'modified' : changedCloud ? 'cloud-newer' : 'synced' });
  }
  for (const c of cmap.values()) {
    if (c.deleted) continue;
    rows.push({ id: c.id, name: c.name, status: meta[c.id]?.removed ? 'removed-here' : 'cloud-only', cloud: c });
  }
  return rows;
}

