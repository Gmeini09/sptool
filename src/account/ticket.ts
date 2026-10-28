// License tickets: base64url(JSON) + "." + base64url(Ed25519 signature), issued by the license server.
// The app verifies them with the server's public key, so a ticket cannot be forged, edited
// (plan, expiry, device) or moved to another computer.

export interface Ticket {
  v: 1;
  sub: string; // Discord ID
  name: string;
  role: 'user' | 'admin';
  /** plan value apps up to 1.8.x understand (Admin appears as "developer") */
  plan: 'free' | 'premium' | 'creator' | 'developer';
  /** licence level Free … Developer (newer servers; missing on older tickets) */
  tier?: 'free' | 'premium' | 'creator' | 'admin' | 'developer';
  exp: number | null; // license expiry
  hwid: string; // device hash the ticket was issued to
  iat: number;
  offlineUntil: number; // the app may run offline until this time
}

const b64urlToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

let keyCache: { raw: string; key: Promise<CryptoKey> } | null = null;
function importKey(raw: string) {
  if (keyCache?.raw !== raw) keyCache = { raw, key: crypto.subtle.importKey('raw', b64urlToBytes(raw), { name: 'Ed25519' }, false, ['verify']) };
  return keyCache.key;
}

export type TicketCheck =
  | { ok: true; ticket: Ticket }
  | { ok: false; reason: 'missing' | 'malformed' | 'signature' | 'unsupported' | 'device' | 'expired' | 'offline_grace' | 'account' | 'clock' };

/**
 * Verifies a ticket. `online` = the server was just reached (then the offline grace does not apply).
 */
export async function checkTicket(raw: string | null | undefined, publicKey: string, hwid: string, now: number, online: boolean): Promise<TicketCheck> {
  if (!raw) return { ok: false, reason: 'missing' };
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  let ticket: Ticket;
  try { ticket = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))); } catch { return { ok: false, reason: 'malformed' }; }
  let valid = false;
  try {
    valid = await crypto.subtle.verify({ name: 'Ed25519' }, await importKey(publicKey), b64urlToBytes(parts[1]), new TextEncoder().encode(parts[0]));
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
  if (!valid) return { ok: false, reason: 'signature' };
  if (ticket.hwid !== hwid) return { ok: false, reason: 'device' };
  if (ticket.exp != null && ticket.exp <= now) return { ok: false, reason: 'expired' };
  if (!online && ticket.offlineUntil <= now) return { ok: false, reason: 'offline_grace' };
  return { ok: true, ticket };
}
