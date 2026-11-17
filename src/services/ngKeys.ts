// The NG keys SP Tool needs to save GTA's sound archives like OpenIV (formats/ngCrypto.ts). Loaded once per PC:
//  1. the AES key from the player's own GTA5.exe (Windows app: /native/gta/awckey; browser: a dropped GTA5.exe),
//  2. CodeWalker's magic.dat from GitHub (pinned commit, SHA-256 checked),
//  3. unlocked with that AES key and kept on this PC (IndexedDB). Nothing is sent anywhere, no key ships with SP Tool.
import { activeNgKeys, findAesKey, isAesKey, MAGIC_SHA256, MAGIC_URL, parseNgPayload, setNgKeys, unlockMagic } from '../formats/ngCrypto';
import { NeedNgKeysError } from '../formats/rpf';
import { getBlob, putBlob } from './storage';
import { nativeInfo } from './native';
import { logger } from './logger';

const BLOB = 'gta-ng-keys';

/** Loads keys kept from last time (no network). true when they are ready. */
export async function restoreNgKeys(): Promise<boolean> {
  if (activeNgKeys()) return true;
  try {
    const b = await getBlob(BLOB);
    if (b) { setNgKeys(parseNgPayload(b)); return true; }
  } catch (e) { logger.warn(`Gespeicherte NG-Schlüssel unbrauchbar: ${e instanceof Error ? e.message : String(e)}`); }
  return false;
}

const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b as unknown as ArrayBuffer));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function aesKey(dropped: File[]): Promise<Uint8Array> {
  const exe = dropped.find((f) => /^gta5\.exe$/i.test(f.name));
  if (exe) {
    const k = findAesKey(new Uint8Array(await exe.arrayBuffer()));
    if (k) return k;
  }
  if (await nativeInfo().catch(() => null)) {
    const r = await fetch('/native/gta/awckey', { headers: { 'X-SPTool-Native': '1' } });
    if (r.ok) {
      const j = (await r.json()) as { aes?: string };
      if (j.aes) { const k = hex(j.aes); if (isAesKey(k)) return k; }
    }
  }
  throw new NeedNgKeysError();
}

let loading: Promise<void> | null = null;
/**
 * Makes sure the NG keys are loaded: from this PC, else from GTA5.exe + CodeWalker's magic.dat (needs internet once).
 * Throws NeedNgKeysError when that is not possible.
 */
export function ensureNgKeys(dropped: File[] = []): Promise<void> {
  if (activeNgKeys()) return Promise.resolve();
  loading ??= (async () => {
    if (await restoreNgKeys()) return;
    const aes = await aesKey(dropped);
    let magic: Uint8Array;
    try {
      const r = await fetch(MAGIC_URL, { cache: 'force-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      magic = new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      logger.warn(`magic.dat (CodeWalker) nicht geladen: ${e instanceof Error ? e.message : String(e)}`);
      throw new NeedNgKeysError();
    }
    if ((await sha256Hex(magic)) !== MAGIC_SHA256) throw new Error('magic.dat von GitHub ist nicht die erwartete Datei – abgebrochen.');
    const payload = await unlockMagic(magic, aes);
    setNgKeys(parseNgPayload(payload));
    try { await putBlob(BLOB, payload); } catch { /* memory only this time */ }
    logger.info('NG-Schlüssel geladen (GTA5.exe + CodeWalker magic.dat) – Archive werden wie mit OpenIV gespeichert');
  })().finally(() => { loading = null; });
  return loading;
}
