// Changelog: what changed in which version. Two sources, merged:
//  · CHANGELOG.md in the source (written with each release) – built into the app (__CHANGELOG__)
//  · what an admin writes in „Was ist neu?“ when pushing a version – kept by the license server for every version
// The admin's text wins for its version (it is what the users were told); versions without one use CHANGELOG.md.

declare const __CHANGELOG__: string;

export interface ChangeEntry { version: string; date: string | null; items: string[]; source: 'app' | 'admin' }
export interface ServerHistoryEntry { version: string; notes: string; at?: number | null }

const VER = /^\d+\.\d+\.\d+$/;
/** Compares "1.4.1"-style versions (same as appRelease.versionCmp – kept here so both can import this file). */
function versionCmp(a: string | null | undefined, b: string | null | undefined): number {
  const x = String(a || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** Text → list items: "- a" / "• a" / "* a" lines become items, other lines continue or start an item. */
export function notesToItems(text: string): string[] {
  const items: string[] = [];
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:[-•*–]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) items.push(m[1].trim());
    else if (items.length && /^\s{2,}/.test(raw)) items[items.length - 1] += ` ${line}`; // indented: continues the item
    else items.push(line);
  }
  return items.filter(Boolean);
}

export const itemsToNotes = (items: string[]) => items.map((i) => `- ${i}`).join('\n');

/** Parses CHANGELOG.md: "## 1.9.7 – 12.10.2026" starts a version, "- …" lines are its changes. */
export function parseChangelog(md: string): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  let cur: ChangeEntry | null = null;
  let body: string[] = [];
  const flush = () => { if (cur) { cur.items = notesToItems(body.join('\n')); out.push(cur); } };
  for (const line of String(md ?? '').replace(/\r/g, '').split('\n')) {
    const h = /^#{2,3}\s*v?(\d+\.\d+\.\d+)\b\s*(?:[–—-]\s*(.+))?$/.exec(line.trim());
    if (h) { flush(); cur = { version: h[1], date: h[2]?.trim() || null, items: [], source: 'app' }; body = []; continue; }
    if (/^#/.test(line.trim())) { flush(); cur = null; body = []; continue; }
    if (cur) body.push(line);
  }
  flush();
  return out.filter((e) => e.items.length).sort((a, b) => versionCmp(b.version, a.version));
}

let bundledCache: ChangeEntry[] | null = null;
/** The changelog built into this app. */
export function bundledChangelog(): ChangeEntry[] {
  bundledCache ??= parseChangelog(typeof __CHANGELOG__ !== 'undefined' ? __CHANGELOG__ : '');
  return bundledCache;
}

/** CHANGELOG.md entry of one version as „Was ist neu?“ text, or '' when there is none. */
export function bundledNotes(version: string | null | undefined): string {
  const e = bundledChangelog().find((x) => x.version === version);
  return e ? itemsToNotes(e.items) : '';
}

/** Server history (admin notes) over the built-in changelog, newest first. */
export function mergeChangelog(server: ServerHistoryEntry[] | null | undefined, bundled: ChangeEntry[] = bundledChangelog()): ChangeEntry[] {
  const by = new Map<string, ChangeEntry>();
  for (const e of bundled) by.set(e.version, e);
  for (const s of server ?? []) {
    if (!s || !VER.test(String(s.version))) continue;
    const items = notesToItems(s.notes);
    const date = s.at ? new Date(s.at).toLocaleDateString('de-DE') : by.get(s.version)?.date ?? null;
    if (items.length) by.set(s.version, { version: s.version, date, items, source: 'admin' });
  }
  return [...by.values()].sort((a, b) => versionCmp(b.version, a.version));
}

/** Entries newer than `from` up to and including `to`. */
export const changesBetween = (entries: ChangeEntry[], from: string | null | undefined, to: string) =>
  entries.filter((e) => versionCmp(e.version, to) <= 0 && (!from || versionCmp(e.version, from) > 0));

// server history last seen (update check), so „Neu in …“ and Einstellungen show the admin's texts too
let serverHistory: ServerHistoryEntry[] = [];
const subs = new Set<() => void>();
export function setServerHistory(h: ServerHistoryEntry[] | null | undefined) {
  if (!Array.isArray(h)) return;
  serverHistory = h;
  subs.forEach((f) => f());
}
export const getServerHistory = () => serverHistory;
export function onServerHistory(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
