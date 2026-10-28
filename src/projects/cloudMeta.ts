// Per-account sync bookkeeping for SP Tool Cloud (no app imports – used by the store and by cloud.ts).
// For each project: the cloud revision and content hash of the last sync, plus two local decisions:
//   removed  – the project was deleted on this PC; the cloud copy must not come back on its own
//   unlinked – the cloud copy was deleted from this PC but the local project was kept; it must not re-upload on its own
// Stored per Discord account, so a second account on the same PC never sees or overwrites these states.
import type { Meta } from './cloudStatus';

const LEGACY_KEY = 'sptool:cloud-meta';
let uid: string | null = null;
let provider: (() => string | null) | null = null;
/** cloud.ts registers where the signed-in Discord id comes from (keeps this module free of app imports). */
export function setMetaUserProvider(f: () => string | null) { provider = f; }

const keyFor = (id: string | null) => { const u = id ?? provider?.() ?? null; return u ? `${LEGACY_KEY}:${u}` : null; };

/** Called by cloud.ts with the signed-in Discord id (null when signed out). */
export function setMetaUser(id: string | null) {
  uid = id;
  const key = keyFor(id);
  // one-time migration of the old, unscoped bookkeeping to the account that is signed in now
  try {
    if (key && !localStorage.getItem(key) && localStorage.getItem(LEGACY_KEY)) {
      localStorage.setItem(key, localStorage.getItem(LEGACY_KEY)!);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch { /* storage unavailable */ }
}

export function readMeta(): Record<string, Meta> {
  const key = keyFor(provider?.() ?? uid);
  if (!key) return {};
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function writeMeta(m: Record<string, Meta>) {
  const key = keyFor(provider?.() ?? uid);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(m)); } catch { /* storage full */ }
}
export function setMeta(id: string, v: Meta | null) {
  const m = readMeta();
  if (v) m[id] = v; else delete m[id];
  writeMeta(m);
}

/** A synced project was deleted on this PC: remember it so the next sync asks instead of downloading it again. */
export function markRemovedLocally(id: string) {
  const m = readMeta();
  if (!m[id]) return; // never synced – nothing to remember
  m[id] = { ...m[id], removed: true, unlinked: false };
  writeMeta(m);
}
