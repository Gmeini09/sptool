// Minimal global store (no external dependency) + persisted app state.
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { LibraryEntry, Style } from '../models/types';
import type { Project } from '../projects/project';
import type { DetectState, FiveMStatus, GtaInstall } from '../services/system';
import { loadJSON, saveJSON } from '../services/storage';
import { markRemovedLocally } from '../projects/cloudMeta';
import { nativeInfo } from '../services/native';

export type Route =
  | 'home' | 'create' | 'projects' | 'soundpack' | 'weapons' | 'library' | 'editor' | 'generator' | 'mixer'
  | 'marketplace' | 'downloads' | 'build' | 'install' | 'backups' | 'cloud' | 'analyzer' | 'settings' | 'logs' | 'admin';

export type ThemeId = 'turbo' | 'sp-dark' | 'pure-black' | 'graphite' | 'midnight';
export type AccentId = 'blue' | 'purple' | 'white' | 'red';

export interface Settings {
  theme: ThemeId;
  accent: AccentId;
  reducedMotion: boolean;
  uiScale: number;
  hoverPreview: boolean;
  volume: number;
  defaultStyle: Style;
  devMode: boolean;
  fivemPath: string;
  gtaPath: string;
  /** ArchiveFix.exe – runs on rebuilt archives right after "Soundpack erstellen" (found automatically when empty) */
  archiveFixPath: string;
  analytics: boolean;
  crashReports: boolean;
  checkUpdates: boolean;
  /** Beginner view: hides expert and not-yet-built modules from the menus. */
  simpleMode: boolean;
  /** Pages whose "what is this page" tip was closed. */
  hintsSeen: string[];
  /** Welcome tour was shown once. */
  tourDone: boolean;
  /** Anleitungs-Panel links offen. */
  tutorialOpen: boolean;
  /** "Soundpack erstellen": own sounds get the loudness of the sound they replace in the template */
}

export interface Session {
  mode: 'offline' | 'discord';
  displayName: string;
  createdAt: number;
  /** Discord account the profile is linked to (accounts builds only). */
  discordId?: string;
  avatar?: string | null;
}
export interface Toast { id: number; kind: 'info' | 'success' | 'warning' | 'error'; title: string; body?: string; leaving?: boolean; ms?: number }
export interface Notice { id: number; time: number; title: string; body?: string; read: boolean }
export interface Collection { id: string; name: string; ids: string[] }

export interface AppState {
  route: Route;
  session: Session | null;
  onboarded: boolean;
  settings: Settings;
  favorites: string[];
  recent: string[];
  userEntries: LibraryEntry[];
  collections: Collection[];
  userTags: Record<string, string[]>;
  projects: Project[];
  currentProjectId: string | null;
  recovered: boolean;
  toasts: Toast[];
  notices: Notice[];
  paletteOpen: boolean;
  /** Welcome tour (opens once for new users, and from the help button). */
  tourOpen: boolean;
  /** In-game mapping test (beep test) */
  gameTestOpen: boolean;
  paletteQuery: string;
  editorEntryId: string | null;
  libraryFocus: string | null;
  fivem: DetectState<FiveMStatus>;
  gta: DetectState<GtaInstall[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'turbo', accent: 'blue', reducedMotion: false, uiScale: 1, hoverPreview: false, volume: 0.85,
  defaultStyle: 'Clean', devMode: false, fivemPath: '', gtaPath: '', archiveFixPath: '', analytics: false, crashReports: false, checkUpdates: true,
  simpleMode: false, hintsSeen: [], tourDone: false, tutorialOpen: false,
};

const PERSIST: Array<keyof AppState> = ['session', 'onboarded', 'settings', 'favorites', 'recent', 'userEntries', 'collections', 'userTags', 'projects', 'currentProjectId'];

/** 0.9: Turbo Design becomes the look for everyone once; later choices are kept. */
function migrateSettings(s: Settings): Settings {
  try {
    // 1.8: everything visible again, neatly grouped (the reduced view stays available in the settings)
    if (localStorage.getItem('sptool:ui') !== 'all-2') { localStorage.setItem('sptool:ui', 'all-2'); s = { ...s, simpleMode: false }; }
    if (localStorage.getItem('sptool:design') !== 'turbo-1') {
      localStorage.setItem('sptool:design', 'turbo-1');
      return { ...s, theme: 'turbo', accent: 'blue' };
    }
  } catch { /* storage blocked */ }
  return s;
}

function initial(): AppState {
  return {
    route: 'home',
    session: loadJSON('session', null),
    onboarded: loadJSON('onboarded', false),
    settings: migrateSettings({ ...DEFAULT_SETTINGS, ...loadJSON<Partial<Settings>>('settings', {}) }),
    favorites: loadJSON('favorites', []),
    recent: loadJSON('recent', []),
    userEntries: loadJSON('userEntries', []),
    collections: loadJSON('collections', []),
    userTags: loadJSON('userTags', {}),
    projects: loadJSON('projects', []),
    currentProjectId: loadJSON('currentProjectId', null),
    recovered: false,
    toasts: [],
    notices: [],
    paletteOpen: false,
    tourOpen: false,
    gameTestOpen: false,
    paletteQuery: '',
    editorEntryId: null,
    libraryFocus: null,
    fivem: { state: 'checking' },
    gta: { state: 'checking' },
  };
}

let state: AppState = initial();
const listeners = new Set<() => void>();

export function getState(): AppState { return state; }

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const k of Object.keys(p) as Array<keyof AppState>) if (PERSIST.includes(k)) saveJSON(k, state[k]);
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

// ── Actions ─────────────────────────────────────────────────────────────────
// Page changes run through the View Transitions API: the old page leaves, the new one arrives,
// and the direction follows the menu order (down the menu = forward). Without support or with
// reduced motion it is a plain state change.
const ROUTE_ORDER: Route[] = ['home', 'create', 'projects', 'library', 'generator', 'editor', 'mixer', 'soundpack', 'weapons', 'build', 'install', 'backups', 'cloud', 'marketplace', 'downloads', 'analyzer', 'settings', 'logs', 'admin'];
type VTDoc = Document & { startViewTransition?: (cb: () => void) => unknown };
let vtBusy = false;
export function changeRoute(patch: Partial<AppState> & { route: Route }) {
  const doc = typeof document !== 'undefined' ? (document as VTDoc) : null;
  const reduced = state.settings.reducedMotion || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!doc?.startViewTransition || reduced || vtBusy || patch.route === state.route) { setState(patch); return; }
  doc.documentElement.dataset.vt = '1';
  doc.documentElement.dataset.navDir = ROUTE_ORDER.indexOf(patch.route) >= ROUTE_ORDER.indexOf(state.route) ? 'fwd' : 'back';
  vtBusy = true;
  try {
    const t = doc.startViewTransition(() => flushSync(() => setState(patch))) as { finished?: Promise<unknown> };
    void Promise.resolve(t?.finished).catch(() => {}).finally(() => { vtBusy = false; });
  } catch { vtBusy = false; setState(patch); }
}
export const navigate = (route: Route) => changeRoute({ route, paletteOpen: false });

export function updateSettings(p: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...p } }));
}

let toastSeq = 0;
/** Files dropped somewhere on the window that no drop zone took; a page can claim them (detail.taken = true). */
export const FILES_DROPPED = 'sptool:files-dropped';

export function toast(kind: Toast['kind'], title: string, body?: string) {
  const id = ++toastSeq;
  if (kind === 'success') import('../fx/effects').then((fx) => fx.burst(undefined, undefined, 34, 0.8)).catch(() => {});
  const ms = kind === 'error' ? 7000 : 3500;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, title, body, ms }] }));
  // slide out first, then remove
  setTimeout(() => setState((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })), ms - 340);
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function notify(title: string, body?: string) {
  setState((s) => ({ notices: [{ id: Date.now() + Math.random(), time: Date.now(), title, body, read: false }, ...s.notices].slice(0, 50) }));
}

export function toggleFavorite(id: string) {
  setState((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [id, ...s.favorites] }));
}

export function markRecent(id: string) {
  setState((s) => ({ recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, 40) }));
}

export function openInEditor(id: string) {
  markRecent(id);
  changeRoute({ editorEntryId: id, route: 'editor', paletteOpen: false });
}

export function addUserEntry(e: LibraryEntry) {
  setState((s) => ({ userEntries: [e, ...s.userEntries] }));
}

export function removeUserEntry(id: string) {
  setState((s) => ({
    userEntries: s.userEntries.filter((e) => e.id !== id),
    favorites: s.favorites.filter((f) => f !== id),
    recent: s.recent.filter((r) => r !== id),
    collections: s.collections.map((c) => ({ ...c, ids: c.ids.filter((x) => x !== id) })),
  }));
}

// ── Projects ────────────────────────────────────────────────────────────────
export function currentProject(): Project | undefined {
  const s = getState();
  return s.projects.find((p) => p.id === s.currentProjectId);
}

/** Every change is written to local storage immediately (autosave, spec §95). */
export function updateProject(id: string, fn: (p: Project) => Project) {
  setState((s) => ({ projects: s.projects.map((p) => (p.id === id ? fn(p) : p)) }));
}

export function addProject(p: Project, open = true) {
  setState((s) => ({ projects: [p, ...s.projects], currentProjectId: open ? p.id : s.currentProjectId }));
}

export function deleteProject(id: string) {
  markRemovedLocally(id); // a synced project must not come back from the cloud on its own
  setState((s) => ({ projects: s.projects.filter((p) => p.id !== id), currentProjectId: s.currentProjectId === id ? null : s.currentProjectId }));
}

export function openProject(id: string) {
  changeRoute({ currentProjectId: id, route: 'soundpack', paletteOpen: false });
}

// Crash recovery (spec §96): a marker is set while the app runs and cleared on a clean exit.
// If it is still set on the next start, the previous session ended unexpectedly. In the Windows app the window is
// closed without "pagehide", so the Go side keeps that marker (lastRunCrashed); the browser uses localStorage.
const SESSION_KEY = 'sptool:session-open';
export function startSessionGuard() {
  void nativeInfo().catch(() => null).then((n) => {
    if (!n) return browserSessionGuard();
    if (n.lastRunCrashed && getState().currentProjectId) setState({ recovered: true });
  });
}
function browserSessionGuard() {
  try {
    const crashed = localStorage.getItem(SESSION_KEY) === '1';
    localStorage.setItem(SESSION_KEY, '1');
    window.addEventListener('pagehide', () => { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } });
    if (crashed && getState().currentProjectId) setState({ recovered: true });
  } catch { /* storage blocked – nothing to recover */ }
}
