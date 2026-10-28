// Permissions by licence level: Free < Premium < Creator < Admin < Developer.
//   Free       every key: create soundpacks (import own sounds, take sounds from other packs, build, save)
//   Premium    more than Free: edit / generate sounds, WAV export, more soundpacks, cloud
//   Creator    everything in the app except key/user management (pack analysis, log, developer mode)
//   Admin      + admin area: keys, licences, users, PCs (hands out up to Creator)
//   Developer  all permissions (also Admin/Developer keys and accounts)
// The tier comes from the Ed25519-signed, HWID-bound license ticket (and the admin role),
// so it cannot be raised by editing local data.
import { accountsEnabled } from './config';
import { getAccount, useAccount, type AccountState } from './account';
import type { Route } from '../app/store';
import { getState, toast } from '../app/store';

export type Tier = 'free' | 'premium' | 'creator' | 'admin' | 'developer';
export const TIERS: Tier[] = ['free', 'premium', 'creator', 'admin', 'developer'];
export const TIER_LABEL: Record<Tier, string> = { free: 'Free', premium: 'Premium', creator: 'Creator', admin: 'Admin', developer: 'Developer' };
const RANK: Record<Tier, number> = { free: 0, premium: 1, creator: 2, admin: 3, developer: 4 };
const isTier = (x: unknown): x is Tier => typeof x === 'string' && Object.prototype.hasOwnProperty.call(RANK, x);

/** Level of a stored plan value (unknown → Free). */
export const tierOfPlan = (p: string | null | undefined): Tier => (isTier(p) ? p : 'free');
/** Level of a licence ticket: the "tier" field of newer servers, else the plan. */
export const ticketTier = (t: { plan: string; tier?: string }): Tier => (isTier(t.tier) ? t.tier : tierOfPlan(t.plan));
/** Display name of a plan or level. */
export const levelLabel = (p?: string | null) => (p ? TIER_LABEL[tierOfPlan(p)] : 'Keine Lizenz');

/** Minimum tier per feature. */
export const FEATURES = {
  library: 'free',
  projects: 'free',
  soundpack: 'free',
  weapons: 'free',
  editor: 'premium',
  generator: 'premium',
  wavExport: 'premium',
  projectFiles: 'premium', // .spproject import/export
  wavImport: 'free', // importing own sounds is the core of creating a soundpack – every key
  analyzer: 'creator', // open/patch GTA archives
  cloud: 'premium', // project sync
  logs: 'creator',
  devMode: 'creator',
  admin: 'admin', // keys, licences, users (Admin: up to Creator, Developer: everything – enforced by the server)
} as const satisfies Record<string, Tier>;
export type Feature = keyof typeof FEATURES;

export const FEATURE_LABEL: Record<Feature, string> = {
  library: 'Sound-Bibliothek', projects: 'Meine Soundpacks', soundpack: 'Soundpack befüllen', weapons: 'Waffen', editor: 'Sound bearbeiten',
  generator: 'Sound erstellen', wavExport: 'WAV-Export', projectFiles: 'Soundpack-Import/-Export', wavImport: 'Sound-Import',
  analyzer: 'Pack-Analyse', cloud: 'SP Tool Cloud', logs: 'Protokoll', devMode: 'Entwicklermodus', admin: 'Admin-Bereich',
};

/** What each tier unlocks (shown in the app). */
export const TIER_PERKS: Record<Tier, string[]> = {
  free: ['Soundpacks erstellen (WEAPONS_PLAYER + RESIDENT)', 'Eigene Sounds importieren (MP3, WAV …)', 'Sounds aus anderen Soundpacks übernehmen', 'Sound-Bibliothek'],
  premium: ['Alles aus Free', 'Sound bearbeiten + alle Effekte', 'Sound erstellen', 'WAV-Export', 'Bis zu 10 gespeicherte Soundpacks + .spproject-Dateien', 'Cloud-Synchronisierung (25 MB)'],
  creator: ['Alles aus Premium', 'Pack-Analyse (GTA-Archive, patchen & exportieren)', 'Protokoll & Diagnose', 'Entwicklermodus', 'Unbegrenzt viele Soundpacks'],
  admin: ['Alles aus Creator', 'Admin-Bereich: Keys, Lizenzen, Nutzer, PCs (bis Creator)'],
  developer: ['Alle Rechte', 'Auch Admin-/Developer-Keys und -Konten verwalten'],
};

export const PROJECT_LIMIT: Record<Tier, number> = { free: 1, premium: 10, creator: Infinity, admin: Infinity, developer: Infinity };

export const ROUTE_FEATURE: Partial<Record<Route, Feature>> = {
  editor: 'editor', generator: 'generator', analyzer: 'analyzer', cloud: 'cloud', logs: 'logs', admin: 'admin',
};

export function tierOf(acc: AccountState): Tier {
  if (!accountsEnabled()) return 'creator'; // local builds without a license server: everything except admin
  const lic: Tier = acc.phase === 'ready' && acc.access?.ok ? ticketTier(acc.access.ticket) : 'free';
  // the admin role only counts when it comes live from the server – the cached profile is unsigned
  if (acc.online && acc.me?.user.role === 'admin' && RANK[lic] < RANK.admin) return 'admin';
  return lic;
}
export const tierAtLeast = (t: Tier, min: Tier) => (RANK[t] ?? 0) >= RANK[min];
/** Plans this level may hand out in the admin area (the server checks the same rule). */
export const grantablePlans = (t: Tier): Tier[] => (t === 'developer' ? TIERS : tierAtLeast(t, 'admin') ? ['free', 'premium', 'creator'] : []);
export const can = (f: Feature, acc: AccountState = getAccount()) => tierAtLeast(tierOf(acc), FEATURES[f]);
export const useTier = (): Tier => useAccount(tierOf);
export const useCan = (f: Feature): boolean => useAccount((a) => can(f, a));
export const routeAllowed = (r: Route, acc: AccountState = getAccount()) => { const f = ROUTE_FEATURE[r]; return !f || can(f, acc); };

/** Guard for creating another project (plan limit). */
export function canAddProject(): boolean {
  const t = tierOf(getAccount());
  const limit = PROJECT_LIMIT[t];
  if (getState().projects.length < limit) return true;
  const next = TIERS.find((x) => PROJECT_LIMIT[x] > limit) ?? 'creator';
  toast('warning', `Soundpack-Limit erreicht (${limit} mit ${TIER_LABEL[t]})`, `${TIER_LABEL[next]} erlaubt ${PROJECT_LIMIT[next] === Infinity ? 'unbegrenzt viele' : PROJECT_LIMIT[next]} Soundpacks. Lösche eines oder steig auf eine höhere Lizenz um.`);
  return false;
}

/** Guard for actions: returns false and explains which plan is needed. */
export function requireFeature(f: Feature): boolean {
  if (can(f)) return true;
  toast('warning', `${FEATURE_LABEL[f]} braucht ${TIER_LABEL[FEATURES[f]]}`, 'Löse unter Einstellungen → Konto einen höheren Lizenz-Key ein oder frag das SP-Tool-Team.');
  return false;
}
