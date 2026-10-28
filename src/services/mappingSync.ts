// Keeps the published stream → slot mapping in sync: every app loads it from the license server, so a mapping
// an admin publishes reaches everyone without a new app version. Admins publish from the Pack Analyzer.
import { api } from '../account/account';
import { accountsEnabled } from '../account/config';
import { notifyMapping, parseMapping, SERVER_MAPPING_KEY, type Mapping } from '../formats/mapping';
import { logger } from './logger';

const subs = new Set<() => void>();
export function onMappingChange(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

/** Loads the published mapping (keeps the cached copy when offline). Returns the number of entries or null. */
export async function refreshServerMapping(): Promise<number | null> {
  if (!accountsEnabled()) return null;
  try {
    const m = parseMapping(await api('GET', '/sptool-app/mapping', undefined, { keepSession: true }));
    const before = localStorage.getItem(SERVER_MAPPING_KEY);
    const next = JSON.stringify(m);
    if (before !== next) {
      localStorage.setItem(SERVER_MAPPING_KEY, next);
      logger.info(`Published mapping loaded: ${m.entries.length} sounds`);
      subs.forEach((f) => f()); notifyMapping();
    }
    return m.entries.length;
  } catch { return null; }
}

/** Admin: publish this mapping for every SP Tool. */
export async function publishMapping(m: Mapping): Promise<number> {
  const r = await api<{ entries: number }>('POST', '/sptool-app/mapping', { version: 1, entries: m.entries }, { keepSession: true });
  localStorage.setItem(SERVER_MAPPING_KEY, JSON.stringify({ version: 1, updatedAt: Date.now(), entries: m.entries }));
  subs.forEach((f) => f()); notifyMapping();
  return r.entries;
}
