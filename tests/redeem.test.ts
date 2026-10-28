// Key redemption rules: a key never downgrades a plan or silently ends a lifetime license.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error – plain JS server module without types
import { openDb } from '../server/db.mjs';
// @ts-expect-error – plain JS server module without types
import { createLicenseService } from '../server/service.mjs';

const DAY = 86_400_000;
const OWNER = '697402284849627180';
const U = (n: number) => String(400000000000000000n + BigInt(n));

function setup() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'redeem-')), 'db.sqlite'));
  const svc = createLicenseService({ cfg: { adminIds: new Set([OWNER]) }, db });
  const key = (plan: string, days: number | null, maxDevices = 1) => svc.createKeys(OWNER, { plan, count: 1, days, maxDevices })[0];
  const lic = (id: string) => db.prepare('SELECT * FROM licenses WHERE discord_id = ?').get(id) as { plan: string; expires_at: number | null; max_devices: number };
  const left = (id: string) => { const l = lic(id); return l.expires_at == null ? 'lifetime' : Math.round((l.expires_at - Date.now()) / DAY); };
  const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as { code?: string }).code; } };
  return { db, svc, key, lic, left, code };
}

test('same plan adds time, lifetime stays lifetime', () => {
  const { svc, key, left } = setup();
  svc.redeemKey(U(1), key('premium', 30));
  svc.redeemKey(U(1), key('premium', 30));
  assert.equal(left(U(1)), 60);
  svc.redeemKey(U(2), key('premium', null));
  svc.redeemKey(U(2), key('premium', 30));
  assert.equal(left(U(2)), 'lifetime');
});

test('lower plan is refused and the key stays unused', () => {
  const { db, svc, key, lic, code } = setup();
  svc.redeemKey(U(1), key('developer', 100));
  const k = key('premium', 30);
  assert.equal(code(() => svc.redeemKey(U(1), k)), 'key_lower_plan');
  assert.equal(lic(U(1)).plan, 'developer');
  assert.equal((db.prepare('SELECT redeemed_by FROM license_keys WHERE key = ?').get(k) as { redeemed_by: string | null }).redeemed_by, null);
  svc.redeemKey(U(2), k); // usable by someone else
});

test('upgrade: key term from now; a limited upgrade never ends a lifetime license', () => {
  const { svc, key, lic, left, code } = setup();
  svc.redeemKey(U(1), key('premium', 10));
  svc.redeemKey(U(1), key('creator', 30, 2));
  assert.equal(lic(U(1)).plan, 'creator'); assert.equal(left(U(1)), 30); assert.equal(lic(U(1)).max_devices, 2);
  svc.redeemKey(U(2), key('premium', null));
  assert.equal(code(() => svc.redeemKey(U(2), key('developer', 30))), 'key_ends_lifetime');
  assert.equal(lic(U(2)).plan, 'premium'); assert.equal(left(U(2)), 'lifetime');
  svc.redeemKey(U(2), key('developer', null)); // lifetime upgrade is fine
  assert.equal(lic(U(2)).plan, 'developer'); assert.equal(left(U(2)), 'lifetime');
});

test('a key sent to one user through the Discord panel only works for that user', () => {
  const { db, svc, key, lic, code } = setup();
  const k = key('premium', 30);
  db.prepare('UPDATE license_keys SET note = ? WHERE key = ?').run(`Discord-Panel für ${U(1)}`, k);
  assert.equal(code(() => svc.redeemKey(U(2), k)), 'key_bound');
  assert.equal((db.prepare('SELECT redeemed_by FROM license_keys WHERE key = ?').get(k) as { redeemed_by: string | null }).redeemed_by, null);
  svc.redeemKey(U(1), k);
  assert.equal(lic(U(1)).plan, 'premium');
  // keys created without a recipient stay transferable
  const free = key('premium', 30);
  db.prepare('UPDATE license_keys SET note = ? WHERE key = ?').run('Discord-Panel', free);
  svc.redeemKey(U(3), free);
  assert.equal(lic(U(3)).plan, 'premium');
});
