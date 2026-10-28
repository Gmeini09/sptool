// Turbo Skin Tool licenses next to SP Tool: TSK keys (Skin Tool only), TMK multi keys (both), product-bound tickets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// @ts-ignore
import { createApp } from '../server/app.mjs';
// @ts-ignore
import { loadConfig, OWNER_DISCORD_ID } from '../server/config.mjs';
// @ts-ignore
import { openDb } from '../server/db.mjs';
// @ts-ignore
import { newSigningKey } from '../server/security.mjs';

const keys = newSigningKey();
const cfg = loadConfig({ LICENSE_PRIVATE_KEY: keys.privatePem, HWID_SERVER_SALT: 's', PUBLIC_URL: 'http://127.0.0.1', DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 'x' });
const server = createApp({ cfg, db: openDb(':memory:'), discordUser: async (code: string) => ({ id: code, username: `u${code.slice(-3)}`, global_name: null, avatar: null }) });
const hw = (s: string) => createHash('sha256').update(s).digest('hex');
let base = '';
let n = 0;
async function login(id: string, pc: string) {
  const state = `pst_${String(++n).padStart(3, '0')}_${'z'.repeat(32)}`;
  await fetch(`${base}/api/v1/auth/discord/start?state=${state}&hwid=${hw(pc)}&device=PC&kind=desktop`, { redirect: 'manual' });
  await fetch(`${base}/api/v1/auth/discord/callback?state=${state}&code=${id}`);
  const r = await (await fetch(`${base}/api/v1/auth/poll?state=${state}`)).json() as { token: string };
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${r.token}`, 'X-SPTool-HWID': hw(pc), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() as any };
  };
}
const ticketData = (t: string) => JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString());

test('skin keys, multi keys and product tickets', async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const owner = await login(OWNER_DISCORD_ID, 'owner-pc');
    const skin = await owner('POST', '/admin/keys', { kind: 'skin', plan: 'premium', count: 1, days: 30 });
    const multi = await owner('POST', '/admin/keys', { kind: 'multi', plan: 'premium', count: 1 });
    const spt = await owner('POST', '/admin/keys', { plan: 'premium', count: 1 });
    assert.match(skin.body.keys[0], /^TSK-/);
    assert.match(multi.body.keys[0], /^TMK-/);
    assert.match(spt.body.keys[0], /^SPT-/, 'old key creation unchanged');
    const all = (await owner('GET', '/admin/keys')).body.keys;
    assert.ok(all.some((k: any) => k.kind === 'skin') && all.some((k: any) => k.kind === 'sptool'));

    // A: skin key → Skin Tool only
    const a = await login('111111111111111111', 'pc-a');
    const r1 = await a('POST', '/license/redeem?product=skin', { key: skin.body.keys[0] });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r1.body.license.active, true);
    assert.equal(ticketData(r1.body.ticket).prod, 'skin');
    assert.equal((await a('GET', '/me')).body.ticket, null, 'no SP Tool ticket from a skin key');
    assert.equal((await a('GET', '/me?product=skin')).body.products.skin.plan, 'premium');
    assert.equal((await a('POST', '/license/redeem?product=skin', { key: skin.body.keys[0] })).body.error, 'key_used');

    // B: multi key → both tools
    const b = await login('222222222222222222', 'pc-b');
    assert.equal((await b('POST', '/license/redeem', { key: multi.body.keys[0] })).status, 200);
    const meB = (await b('GET', '/me')).body;
    assert.equal(meB.products.sptool.active, true);
    assert.equal(meB.products.skin.active, true);
    assert.equal(meB.products.skin.expiresAt, null, 'lifetime');
    assert.equal(ticketData(meB.ticket).prod, undefined, 'SP Tool ticket has no product field (old apps keep working)');
    assert.equal(ticketData((await b('GET', '/me?product=skin')).body.ticket).prod, 'skin');

    // C: lifetime Creator SP Tool + premium multi key → the skin part is still granted, SP Tool untouched
    await owner('POST', '/admin/users/333333333333333333/license', { plan: 'creator' });
    const multi2 = (await owner('POST', '/admin/keys', { kind: 'multi', plan: 'premium', count: 1 })).body.keys[0];
    const c = await login('333333333333333333', 'pc-c');
    assert.equal((await c('POST', '/license/redeem?product=skin', { key: multi2 })).status, 200);
    const meC = (await c('GET', '/me')).body;
    assert.equal(meC.products.sptool.plan, 'creator');
    assert.equal(meC.products.skin.plan, 'premium');

    // admin can grant / revoke a skin license directly
    await owner('POST', '/admin/users/111111111111111111/license', { product: 'skin', plan: 'none' });
    assert.equal((await a('GET', '/me?product=skin')).body.ticket, null);
    assert.equal((await a('GET', '/me?product=nope')).status, 400);
  } finally { server.close(); }
});
