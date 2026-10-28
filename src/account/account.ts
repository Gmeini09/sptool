// Account + license state: Discord sign-in (via the license server), HWID binding, license tickets.
//
// Flow: the app opens  <API>/api/v1/auth/discord/start?state=…&hwid=…  in the system browser,
// the user authorizes SP Tool on discord.com (scope "identify" – no password, no token),
// and the app polls  /auth/poll?state=…  until the server hands out a session token (once).
// Every API call sends the token AND the device hash; a token copied to another PC is refused.
import { useSyncExternalStore } from 'react';
import { API_URL, LICENSE_PUBKEY, accountsEnabled } from './config';
import { getDevice, type DeviceIdentity } from './hwid';
import { checkTicket, type Ticket, type TicketCheck } from './ticket';
import { invoke, isTauri } from '../services/tauri';
import { nativeFetch, nativeInfo } from '../services/native';
import { logger } from '../services/logger';
import { setState as setApp, getState as getApp } from '../app/store';

export type Plan = Ticket['plan'];
export interface License { plan: Plan | 'admin'; /** licence level (newer servers) */ tier?: 'free' | 'premium' | 'creator' | 'admin' | 'developer'; maxDevices: number; expiresAt: number | null; source: string; active: boolean; revoked?: boolean; note?: string | null }
export interface PublicUser { id: string; username: string; globalName: string | null; avatar: string | null; role: 'user' | 'admin'; /** licence level incl. admin role (servers since 1.9) */ tier?: string; banned: boolean; banReason: string | null; createdAt: number; lastLogin: number | null }
export interface PublicDevice { id: string; name: string; kind: string; firstSeen: number; lastSeen: number; revoked: boolean }
export interface Me { user: PublicUser; license: License | null; devices: PublicDevice[]; currentDevice: string; maxDevices: number; ticket: string | null }
export interface AuthError { code: string; message: string; discordId?: string }

export interface AccountState {
  phase: 'disabled' | 'loading' | 'signed-out' | 'signing-in' | 'ready';
  online: boolean;
  me: Me | null;
  device: DeviceIdentity | null;
  access: TicketCheck | null;
  error: AuthError | null;
  loginUrl: string | null;
  /** Short code for "/sptool verbinden code:…" in Discord (first 10 hex chars of SHA-256(state)). */
  pairCode?: string | null;
  /** true: Discord one-click sign-in in the browser; false: "/sptool verbinden" code; undefined: still asking. */
  oneClick?: boolean;
}

const TOKEN_KEY = 'sptool:auth-token';
const TICKET_KEY = 'sptool:auth-ticket';
const ME_KEY = 'sptool:auth-me';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } };

let state: AccountState = { phase: accountsEnabled() ? 'loading' : 'disabled', online: false, me: null, device: null, access: null, error: null, loginUrl: null };
const listeners = new Set<() => void>();
function set(p: Partial<AccountState>) { state = { ...state, ...p }; listeners.forEach((l) => l()); }
export const getAccount = () => state;
export function useAccount<T>(sel: (s: AccountState) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => sel(state), () => sel(state));
}

/** True when the app may be used: valid, signed, device-bound license ticket. */
export const hasAccess = (s: AccountState) => s.phase === 'disabled' || (s.phase === 'ready' && !!s.access?.ok);
export const isAdmin = (s: AccountState) => s.online && s.me?.user.role === 'admin';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** German texts for the server's error codes (the codes stay as they are; unknown codes keep the server text). */
const SERVER_MSG: Record<string, string> = {
  key_bound: 'Dieser Key wurde an einen anderen Discord-Account geschickt und funktioniert nur dort.',
  license_required: 'Updates gibt es nur mit aktiver SP-Tool-Lizenz.',
  no_release: 'Es wurde noch keine App-Version veröffentlicht.',
  too_large: 'Die Anfrage ist zu groß.',
  bad_json: 'Ungültige Anfrage.',
  unauthenticated: 'Bitte melde dich an.',
  session_expired: 'Deine Sitzung ist abgelaufen. Melde dich erneut an.',
  device_revoked: 'Dieser PC wurde aus deinem Konto entfernt. Melde dich erneut an.',
  hwid_mismatch: 'Diese Sitzung gehört zu einem anderen PC.',
  forbidden: 'Nur für Admins.',
  rate_limited: 'Zu viele Anfragen. Warte kurz und versuch es dann erneut.',
  bad_state: 'Ungültiger Anmeldestatus.',
  bad_hwid: 'Ungültige Geräte-ID.',
  bad_id: 'Ungültige Discord-ID.',
  bad_plan: 'Ungültiger Plan.',
  protected: 'Der Inhaber kann nicht gesperrt oder herabgestuft werden.',
  owner_only: 'Das darf nur der Inhaber.',
  bad_key: 'Das ist kein gültiger Lizenz-Key (SPT-XXXX-XXXX-XXXX-XXXX).',
  key_invalid: 'Diesen Key gibt es nicht oder er wurde widerrufen.',
  key_used: 'Dieser Key wurde schon eingelöst.',
  key_lower_plan: 'Du hast schon einen höheren Plan – dieser Key würde ihn herabstufen. Der Key wurde nicht verbraucht.',
  key_ends_lifetime: 'Du hast eine unbegrenzte Lizenz – dieser zeitlich begrenzte Key würde sie ersetzen. Der Key wurde nicht verbraucht; bitte einen Admin, dich hochzustufen.',
  device_limit: 'Deine Lizenz ist schon an die maximale Zahl von PCs gebunden. Bitte einen Admin, deine PCs zurückzusetzen – oder nutze SP Tool am Handy bzw. im Browser, dafür gibt es einen eigenen Platz.',
  discord_denied: 'Die Discord-Anmeldung wurde abgebrochen.',
  discord_failed: 'Die Discord-Anmeldung ist fehlgeschlagen. Versuch es erneut.',
};
/** Server message → German. `banned` keeps the ban reason the admin entered. */
export function serverMessage(code: string | undefined, message: string | undefined, fallback: string): string {
  if (code === 'banned') { const m = /banned: (.+)$/s.exec(message ?? ''); return m ? `Dieses Konto ist gesperrt: ${m[1]}` : 'Dieses Konto ist gesperrt.'; }
  if (code === 'not_found') return message?.startsWith('No user') ? 'Noch kein Nutzer mit dieser Discord-ID. Du kannst trotzdem eine Lizenz vergeben – sie gilt ab der ersten Anmeldung.' : message?.startsWith('Key') ? 'Key nicht gefunden oder schon eingelöst.' : message?.startsWith('Device') ? 'PC nicht gefunden.' : 'Nicht gefunden.';
  return (code && SERVER_MSG[code]) || message || fallback;
}

/** Login headers for a raw request (e.g. a download with progress). Never log them. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = read(TOKEN_KEY);
  const dev = state.device ?? await getDevice();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-SPTool-HWID': dev.hwid };
}

/** Authenticated request to the license server. Never logs the token. */
export async function api<T = any>(method: string, path: string, body?: unknown, opts: { keepSession?: boolean; raw?: Blob; headers?: Record<string, string> } = {}): Promise<T> {
  const token = read(TOKEN_KEY);
  const dev = state.device ?? await getDevice();
  let r: Response;
  try {
    r = await fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-SPTool-HWID': dev.hwid, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      body: opts.raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Der Lizenzserver ist nicht erreichbar.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (!opts.keepSession && (r.status === 401 || (r.status === 403 && ['hwid_mismatch', 'banned'].includes(data.error)))) dropSession({ code: data.error ?? 'unauthenticated', message: serverMessage(data.error, data.message, 'Melde dich erneut an.') });
    throw new ApiError(r.status, data.error ?? 'error', serverMessage(data.error, data.message, `Anfrage fehlgeschlagen (${r.status}).`));
  }
  return data as T;
}

function dropSession(error: AuthError | null) {
  write(TOKEN_KEY, null);
  write(TICKET_KEY, null);
  write(ME_KEY, null);
  set({ phase: 'signed-out', me: null, access: null, error, online: true });
}

const SERVER_KEY = 'sptool:server-pubkey';
const LAST_SEEN_KEY = 'sptool:clock';

/** Key that signs tickets: the one learned from this app's own HTTPS server, else the built-in one. */
const activeKey = () => read(SERVER_KEY) || LICENSE_PUBKEY;

/** Fetches the signing key from the configured license server (HTTPS only). */
async function fetchServerKey(): Promise<string | null> {
  if (!/^https:\/\//.test(API_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(API_URL)) return null;
  try {
    const r = await fetch(`${API_URL}/api/v1/public-key`);
    if (!r.ok) return null;
    const d = await r.json();
    return typeof d.publicKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(d.publicKey) ? d.publicKey : null;
  } catch { return null; }
}

async function applyTicket(ticket: string | null, online: boolean) {
  const dev = state.device!;
  let access = await checkTicket(ticket, activeKey(), dev.hwid, Date.now(), online);
  // The server signs with a different key than the one built into this app (server key changed):
  // learn the key from our own license server and verify again.
  if (!access.ok && access.reason === 'signature' && online && ticket) {
    const key = await fetchServerKey();
    if (key && key !== activeKey()) {
      const retry = await checkTicket(ticket, key, dev.hwid, Date.now(), online);
      if (retry.ok) {
        write(SERVER_KEY, key);
        logger.warn('License server uses a different signing key than this build – adopted the server key.');
        access = retry;
      }
    }
  }
  // Hardening: the ticket must belong to the signed-in Discord account, and the PC clock must not be
  // turned back (that would stretch the offline time or an expired license).
  if (access.ok) {
    const now = Date.now();
    const lastSeen = Number(read(LAST_SEEN_KEY) || 0);
    const meId = state.me?.user.id;
    if (meId && access.ticket.sub !== meId) access = { ok: false, reason: 'account' };
    else if (online) write(LAST_SEEN_KEY, String(now)); // server confirmed – trust this clock again
    else if (access.ticket.iat > now + 10 * 60_000 || (lastSeen && now < lastSeen - 10 * 60_000)) access = { ok: false, reason: 'clock' };
    else write(LAST_SEEN_KEY, String(Math.max(now, lastSeen)));
  }
  if (access.ok) write(TICKET_KEY, ticket);
  else if (online) write(TICKET_KEY, null);
  set({ access });
}

function linkProfile(me: Me) {
  const displayName = me.user.globalName || me.user.username || 'Creator';
  const cur = getApp().session;
  if (!cur || cur.discordId !== me.user.id || cur.displayName !== displayName) {
    setApp({ session: { mode: 'discord', discordId: me.user.id, displayName, avatar: me.user.avatar, createdAt: cur?.createdAt ?? Date.now() } });
  }
}

/** Loads /me. Falls back to the cached, signed ticket when the server is unreachable. */
export async function refresh(): Promise<void> {
  try {
    const me = await api<Me>('GET', '/me');
    write(ME_KEY, JSON.stringify({ ...me, ticket: null }));
    set({ me, online: true, error: null });
    linkProfile(me);
    await applyTicket(me.ticket, true);
    set({ phase: 'ready' });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) {
      const cachedMe = read(ME_KEY);
      set({ me: cachedMe ? JSON.parse(cachedMe) : null, online: false });
      await applyTicket(read(TICKET_KEY), false);
      set({ phase: 'ready' });
      return;
    }
    // 401/403 already signed the user out (see api()); anything else: keep the current state.
    if (state.phase === 'loading') set({ phase: 'signed-out' });
  }
}

export async function initAccount(): Promise<void> {
  if (!accountsEnabled()) return;
  try {
    set({ device: await getDevice() });
  } catch (e) {
    set({ phase: 'signed-out', error: { code: 'device', message: `Die ID dieses PCs konnte nicht gelesen werden: ${String(e)}` } });
    return;
  }
  if (!read(TOKEN_KEY)) { set({ phase: 'signed-out' }); return; }
  await refresh();
  // Re-check periodically so revocations, bans and new licenses apply without restart.
  setInterval(() => { if (read(TOKEN_KEY)) void refresh(); }, 10 * 60_000);
}

// ── sign in ──────────────────────────────────────────────────────────────────
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let loginState: string | null = null;

export async function openExternal(url: string) {
  if (isTauri()) { await invoke('plugin:opener|open_url', { url }); return; }
  if (await nativeInfo()) { await nativeFetch('/native/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }); return; }
  window.open(url, '_blank', 'noopener');
}

/** Must be called from a click handler (browsers only allow pop-ups then). */
export function signIn() {
  const dev = state.device;
  if (!dev) return;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  loginState = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const u = new URL(`${API_URL}/api/v1/auth/discord/start`);
  u.searchParams.set('state', loginState);
  u.searchParams.set('hwid', dev.hwid);
  u.searchParams.set('device', dev.name);
  u.searchParams.set('kind', dev.kind);
  set({ phase: 'signing-in', error: null, loginUrl: u.toString(), pairCode: null, oneClick: undefined });
  const mine = loginState;
  void crypto.subtle.digest('SHA-256', new TextEncoder().encode(loginState)).then((d) => {
    if (loginState !== mine) return;
    set({ pairCode: [...new Uint8Array(d)].slice(0, 5).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase() });
  });
  // One-click (Discord OAuth set up on the server): open Discord in the browser, the user clicks "Autorisieren".
  // Otherwise register the login without a browser tab and show the "/sptool verbinden" command in the app.
  const openBrowser = () => openExternal(u.toString()).catch((e) => logger.warn(`Could not open browser: ${String(e)}`));
  void fetch(`${API_URL}/api/v1/auth/mode`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ oneClick: false }))
    .then((m: { oneClick?: boolean }) => {
      if (loginState !== mine) return;
      set({ oneClick: !!m.oneClick });
      if (m.oneClick) return openBrowser();
      return fetch(u.toString(), { mode: 'no-cors', redirect: 'manual', cache: 'no-store' }).catch(openBrowser);
    });
  const started = Date.now();
  const tick = async () => {
    if (!loginState) return;
    if (Date.now() - started > 10 * 60_000) { cancelSignIn({ code: 'timeout', message: 'Die Anmeldung hat zu lange gedauert. Versuch es erneut.' }); return; }
    try {
      const r = await fetch(`${API_URL}/api/v1/auth/poll?state=${encodeURIComponent(loginState)}`);
      const d = await r.json().catch(() => ({}));
      if (d.status === 'ok' && d.token) {
        loginState = null;
        write(TOKEN_KEY, d.token);
        logger.info('Signed in with Discord');
        set({ loginUrl: null, pairCode: null });
        await refresh();
        return;
      }
      if (d.status === 'error') { cancelSignIn({ code: d.code, message: serverMessage(d.code, d.message, 'Anmeldung fehlgeschlagen.'), discordId: d.discordId }); return; }
      if (d.status === 'expired' || r.status === 404) { cancelSignIn({ code: 'expired', message: 'Der Anmeldelink ist abgelaufen. Versuch es erneut.' }); return; }
    } catch { /* offline for a moment – keep polling */ }
    pollTimer = setTimeout(tick, 1500);
  };
  pollTimer = setTimeout(tick, 1500);
}

export function cancelSignIn(error: AuthError | null = null) {
  loginState = null;
  if (pollTimer) clearTimeout(pollTimer);
  set({ phase: 'signed-out', error, loginUrl: null, pairCode: null });
}

export async function signOut(everywhere = false) {
  try { await api('POST', everywhere ? '/auth/logout-all' : '/auth/logout'); } catch { /* sign out locally anyway */ }
  logger.info(everywhere ? 'Signed out on all devices' : 'Signed out');
  dropSession(null);
}

export async function redeemKey(key: string): Promise<License | null> {
  const r = await api<{ license: License; ticket: string | null }>('POST', '/license/redeem', { key });
  await refresh();
  return r.license;
}
