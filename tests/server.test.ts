// License server: Discord login, HWID binding, licenses, keys, admin, tickets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
// @ts-ignore – plain ESM server modules
import { createApp } from '../server/app.mjs';
// @ts-ignore
import { loadConfig, OWNER_DISCORD_ID } from '../server/config.mjs';
// @ts-ignore
import { openDb } from '../server/db.mjs';
// @ts-ignore
import { newSigningKey, signTicket } from '../server/security.mjs';
import { checkTicket } from '../src/account/ticket';
import { hashMachineId } from '../src/account/hwid';

const USER = '123456789012345678';
const OTHER = '223456789012345678';
const hw = (s: string) => createHash('sha256').update(`sptool-hwid-v1:${s}`).digest('hex');
const PC1 = hw('pc-1'), PC2 = hw('pc-2');

const keys = newSigningKey();
const cfg = loadConfig({ LICENSE_PRIVATE_KEY: keys.privatePem, HWID_SERVER_SALT: 'test-salt', PUBLIC_URL: 'http://127.0.0.1', DISCORD_CLIENT_ID: '123', DISCORD_CLIENT_SECRET: 'test-secret' });
const db = openDb(':memory:');
// The Discord code is "<id>:<name>" in tests – the real app exchanges it with Discord.
const server = createApp({ cfg, db, discordUser: async (code: string) => { const [id, name] = code.split(':'); return { id, username: name, global_name: name, avatar: null }; } });
let base = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

let stateN = 0;
async function login(discordId: string, hwid: string, name = 'tester') {
  const state = `state_${String(++stateN).padStart(4, '0')}_${'x'.repeat(30)}`;
  const s = await fetch(`${base}/api/v1/auth/discord/start?state=${state}&hwid=${hwid}&device=Test%20PC&kind=desktop`, { redirect: 'manual' });
  assert.equal(s.status, 302);
  assert.match(s.headers.get('location')!, /discord\.com\/oauth2\/authorize.*scope=identify/);
  const pending = await (await fetch(`${base}/api/v1/auth/poll?state=${state}`)).json();
  assert.equal(pending.status, 'pending');
  await fetch(`${base}/api/v1/auth/discord/callback?state=${state}&code=${discordId}:${name}`);
  const r = await (await fetch(`${base}/api/v1/auth/poll?state=${state}`)).json();
  const again = await fetch(`${base}/api/v1/auth/poll?state=${state}`);
  assert.equal(again.status, 404, 'token is handed out only once');
  return r as { status: string; token?: string; code?: string };
}
const api = (token: string, hwid: string) => async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'X-SPTool-HWID': hwid, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as any };
};

function verifyTicket(ticket: string) {
  const [payload, sig] = ticket.split('.');
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(keys.publicRaw, 'base64url')]);
  const ok = verify(null, Buffer.from(payload), createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(sig, 'base64url'));
  return { ok, data: JSON.parse(Buffer.from(payload, 'base64url').toString()) };
}

let owner: ReturnType<typeof api>;
let user: ReturnType<typeof api>;

test('owner signs in with Discord and is admin with a Developer licence (all permissions)', async () => {
  const r = await login(OWNER_DISCORD_ID, PC1, 'owner');
  assert.equal(r.status, 'ok');
  owner = api(r.token!, PC1);
  const me = await owner('GET', '/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, OWNER_DISCORD_ID);
  assert.equal(me.body.user.role, 'admin');
  assert.equal(me.body.license.plan, 'developer');
  const t = verifyTicket(me.body.ticket);
  assert.ok(t.ok, 'ticket signature verifies with the public key');
  assert.equal(t.data.tier, 'developer', 'ticket carries the licence level');
  assert.equal(t.data.plan, 'developer', 'and a plan value that apps up to 1.8.x understand');
  assert.equal(t.data.sub, OWNER_DISCORD_ID);
  assert.equal(t.data.hwid, PC1);
});

test('new user has no license; the token only works on the computer it was issued to', async () => {
  const r = await login(USER, PC1);
  assert.equal(r.status, 'ok');
  user = api(r.token!, PC1);
  const me = await user('GET', '/me');
  assert.equal(me.body.license, null);
  assert.equal(me.body.ticket, null);
  assert.equal(me.body.devices.length, 1);
  const stolen = await api(r.token!, PC2)('GET', '/me');
  assert.equal(stolen.status, 403);
  assert.equal(stolen.body.error, 'hwid_mismatch');
  const noHwid = await api(r.token!, '')('GET', '/me');
  assert.equal(noHwid.status, 403);
});

test('a second computer is refused (device limit) until an admin resets devices', async () => {
  const r = await login(USER, PC2);
  assert.equal(r.status, 'error');
  assert.equal(r.code, 'device_limit');
  const reset = await owner('POST', `/admin/users/${USER}/devices/reset`);
  assert.equal(reset.body.removed, 1);
  assert.equal((await user('GET', '/me')).status, 401, 'old sessions die with the reset');
  const r2 = await login(USER, PC2);
  assert.equal(r2.status, 'ok');
  user = api(r2.token!, PC2);
});

test('non-admins cannot reach admin routes', async () => {
  const r = await user('GET', '/admin/stats');
  assert.equal(r.status, 403);
  assert.equal((await fetch(`${base}/api/v1/admin/stats`)).status, 401);
});

test('admin grants a license by Discord ID; ticket is bound to the HWID', async () => {
  const g = await owner('POST', `/admin/users/${USER}/license`, { plan: 'premium', maxDevices: 2, days: 30, note: 'test' });
  assert.equal(g.status, 200);
  assert.equal(g.body.license.plan, 'premium');
  const c = await user('POST', '/license/check');
  assert.equal(c.body.license.active, true);
  const t = verifyTicket(c.body.ticket);
  assert.ok(t.ok);
  assert.equal(t.data.hwid, PC2);
  assert.equal(t.data.plan, 'premium');
  assert.ok(t.data.offlineUntil <= Date.now() + 72 * 3600_000 + 1000);
  // tampering breaks the signature
  const [p, s] = c.body.ticket.split('.');
  const forged = Buffer.from(JSON.stringify({ ...t.data, plan: 'developer' })).toString('base64url');
  assert.equal(verifyTicket(`${forged}.${s}`).ok, false);
  assert.ok(p);
  // second device is now allowed (max 2)
  const r = await login(USER, PC1);
  assert.equal(r.status, 'ok');
  // revoke
  await owner('POST', `/admin/users/${USER}/license`, { plan: 'none' });
  assert.equal((await user('POST', '/license/check')).body.ticket, null);
});

test('license keys: generate, redeem once, revoke', async () => {
  const g = await owner('POST', '/admin/keys', { plan: 'creator', count: 3, days: 7, maxDevices: 1 });
  assert.equal(g.body.keys.length, 3);
  const [k1, k2, k3] = g.body.keys;
  assert.match(k1, /^SPT-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  const r = await user('POST', '/license/redeem', { key: k1.toLowerCase() });
  assert.equal(r.status, 200);
  assert.equal(r.body.license.plan, 'creator');
  assert.ok(verifyTicket(r.body.ticket).ok);
  const reuse = await user('POST', '/license/redeem', { key: k1 });
  assert.equal(reuse.status, 409);
  await owner('POST', `/admin/keys/${k2}/revoke`);
  assert.equal((await user('POST', '/license/redeem', { key: k2 })).status, 404);
  assert.equal((await user('POST', '/license/redeem', { key: 'SPT-AAAA' })).status, 400);
  const list = await owner('GET', '/admin/keys');
  const row = list.body.keys.find((x: any) => x.key === k1);
  assert.equal(row.redeemedBy, USER);
  assert.ok(list.body.keys.some((x: any) => x.key === k3 && !x.redeemedBy));
});

test('ban kills sessions and blocks login; unban restores', async () => {
  const b = await owner('POST', `/admin/users/${USER}/ban`, { reason: 'sharing' });
  assert.equal(b.status, 200);
  assert.equal((await user('GET', '/me')).status, 401);
  const r = await login(USER, PC2);
  assert.equal(r.code, 'banned');
  await owner('POST', `/admin/users/${USER}/unban`);
  const r2 = await login(USER, PC2);
  assert.equal(r2.status, 'ok');
  user = api(r2.token!, PC2);
});

test('owner is protected: cannot be banned or demoted, even by other admins', async () => {
  assert.equal((await owner('POST', `/admin/users/${OWNER_DISCORD_ID}/ban`, {})).status, 403);
  assert.equal((await owner('POST', `/admin/users/${OWNER_DISCORD_ID}/role`, { role: 'user' })).status, 403);
  // promote OTHER to admin, check they cannot touch the owner or change roles
  const r = await login(OTHER, PC1, 'mod');
  const mod = api(r.token!, PC1);
  assert.equal((await owner('POST', `/admin/users/${OTHER}/role`, { role: 'admin' })).status, 200);
  assert.equal((await mod('GET', '/admin/stats')).status, 200);
  assert.equal((await mod('POST', `/admin/users/${OWNER_DISCORD_ID}/ban`, {})).status, 403);
  assert.equal((await mod('POST', `/admin/users/${USER}/role`, { role: 'admin' })).status, 403);
  assert.equal((await owner('POST', `/admin/users/${OTHER}/role`, { role: 'user' })).status, 200);
  assert.equal((await mod('GET', '/admin/stats')).status, 403);
});

test('admin lookup, stats and audit log', async () => {
  const u = await owner('GET', `/admin/users/${USER}`);
  assert.equal(u.body.user.id, USER);
  assert.ok(u.body.devices.length >= 1);
  const list = await owner('GET', '/admin/users?q=1234567890');
  assert.ok(list.body.users.some((x: any) => x.id === USER));
  const s = await owner('GET', '/admin/stats');
  assert.ok(s.body.users >= 3);
  const a = await owner('GET', '/admin/audit');
  const actions = a.body.entries.map((e: any) => e.action);
  for (const x of ['login', 'device.bound', 'devices.reset', 'license.set', 'key.redeemed', 'user.banned', 'keys.created']) assert.ok(actions.includes(x), x);
  // nothing secret in the audit log
  assert.ok(!JSON.stringify(a.body).includes(PC1));
  // the DB never stores raw tokens or raw client HWIDs
  const dev = db.prepare('SELECT hwid_hash FROM devices LIMIT 1').get() as any;
  assert.notEqual(dev.hwid_hash, PC1);
  assert.notEqual(dev.hwid_hash, PC2);
});

test('logout revokes the session; bad input is rejected', async () => {
  assert.equal((await user('POST', '/auth/logout')).status, 200);
  assert.equal((await user('GET', '/me')).status, 401);
  const bad = await fetch(`${base}/api/v1/auth/discord/start?state=short&hwid=${PC1}`, { redirect: 'manual' });
  assert.equal(bad.status, 400);
  const badHw = await fetch(`${base}/api/v1/auth/discord/start?state=${'y'.repeat(40)}&hwid=nothex`, { redirect: 'manual' });
  assert.equal(badHw.status, 400);
});

test('redeem is rate limited', async () => {
  const r = await login(OTHER, PC2, 'mod');
  assert.equal(r.status, 'error'); // OTHER is limited to 1 device (PC1)
  await owner('POST', `/admin/users/${OTHER}/devices/reset`);
  const r2 = await login(OTHER, PC2, 'mod');
  const o = api(r2.token!, PC2);
  let limited = false;
  for (let i = 0; i < 20 && !limited; i++) limited = (await o('POST', '/license/redeem', { key: 'SPT-AAAA-AAAA-AAAA-AAAA' })).status === 429;
  assert.ok(limited);
});

test('client ticket check: accepts server tickets, rejects forged, moved, expired and stale ones', async () => {
  const now = Date.now();
  const base = { v: 1, sub: USER, name: 'x', role: 'user', plan: 'premium', exp: now + 86_400_000, hwid: PC1, iat: now, offlineUntil: now + 3_600_000 };
  const good = signTicket(base, keys.privatePem);
  assert.equal((await checkTicket(good, keys.publicRaw, PC1, now, true)).ok, true);
  assert.deepEqual(await checkTicket(good, keys.publicRaw, PC2, now, true), { ok: false, reason: 'device' });
  const other = newSigningKey();
  assert.deepEqual(await checkTicket(signTicket(base, other.privatePem), keys.publicRaw, PC1, now, true), { ok: false, reason: 'signature' });
  const [, sig] = good.split('.');
  const edited = Buffer.from(JSON.stringify({ ...base, plan: 'developer' })).toString('base64url');
  assert.deepEqual(await checkTicket(`${edited}.${sig}`, keys.publicRaw, PC1, now, true), { ok: false, reason: 'signature' });
  assert.deepEqual(await checkTicket(signTicket({ ...base, exp: now - 1 }, keys.privatePem), keys.publicRaw, PC1, now, true), { ok: false, reason: 'expired' });
  // offline: allowed within the grace window, refused after it
  assert.equal((await checkTicket(good, keys.publicRaw, PC1, now + 1000, false)).ok, true);
  assert.deepEqual(await checkTicket(good, keys.publicRaw, PC1, now + 2 * 3_600_000, false), { ok: false, reason: 'offline_grace' });
  assert.deepEqual(await checkTicket(null, keys.publicRaw, PC1, now, true), { ok: false, reason: 'missing' });
  // the client's HWID hash has the format the server accepts
  assert.match(await hashMachineId('4C4C4544-0042-3510-8048-B4C04F4E4D32'), /^[a-f0-9]{64}$/);
  assert.equal(await hashMachineId('ABC'), await hashMachineId(' abc '));
});

test('without Discord OAuth credentials the start page shows the /sptool verbinden code', async () => {
  const { createHash } = await import('node:crypto');
  const noOauth = loadConfig({ LICENSE_PRIVATE_KEY: keys.privatePem, HWID_SERVER_SALT: 'test-salt', PUBLIC_URL: 'http://127.0.0.1' });
  const srv = createApp({ cfg: noOauth, db: openDb(':memory:'), discordUser: async () => { throw new Error('unused'); } });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const b = `http://127.0.0.1:${(srv.address() as any).port}`;
  const state = `pair_${'y'.repeat(40)}`;
  const s = await fetch(`${b}/api/v1/auth/discord/start?state=${state}&hwid=${'a'.repeat(64)}&device=PC&kind=desktop`, { redirect: 'manual' });
  assert.equal(s.status, 200);
  const html = await s.text();
  const code = createHash('sha256').update(state).digest('hex').slice(0, 10).toUpperCase();
  assert.ok(html.includes(`/sptool verbinden code:${code}`), 'page shows the exact command');
  const pending = await (await fetch(`${b}/api/v1/auth/poll?state=${state}`)).json();
  assert.equal(pending.status, 'pending');
  srv.close();
});

test('auth mode tells the app whether Discord one-click sign-in is set up', async () => {
  const r = await (await fetch(`${base}/api/v1/auth/mode`)).json();
  assert.equal(r.oneClick, true);
});

test('each Discord account gets its own identity – another person on the same PC never gets the owner', async () => {
  const PC3 = hw('pc-3');
  const FRIEND = '323456789012345678';
  const a = await login(OWNER_DISCORD_ID, PC3, 'owner');
  const b = await login(FRIEND, PC3, 'friend');
  assert.equal(a.status, 'ok');
  assert.equal(b.status, 'ok');
  assert.notEqual(a.token, b.token);
  const meA = await api(a.token!, PC3)('GET', '/me');
  const meB = await api(b.token!, PC3)('GET', '/me');
  assert.equal(meA.body.user.id, OWNER_DISCORD_ID);
  assert.equal(meB.body.user.id, FRIEND, 'the friend is signed in as the friend');
  assert.equal(meB.body.user.role, 'user', 'no admin rights for the friend');
  assert.equal(meB.body.license, null, 'the owner license is not shared');
  assert.equal(meB.body.ticket, null);
  assert.equal((await api(b.token!, PC3)('GET', '/admin/stats')).status, 403);
});
