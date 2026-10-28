// cloud-sync (cloud projects, in-app updates, admin app hand-off) must accept the license server's sessions:
// same database, same hardware-ID salt (read from the salt file on the volume, as the bot creates it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
// @ts-ignore
import { createApp } from '../server/app.mjs';
// @ts-ignore
import { loadConfig, OWNER_DISCORD_ID } from '../server/config.mjs';
// @ts-ignore
import { openDb } from '../server/db.mjs';
// @ts-ignore
import { newSigningKey } from '../server/security.mjs';

test('cloud-sync accepts license sessions when the HWID salt only exists as the bot\'s salt file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sptool-cs-'));
  writeFileSync(join(dir, 'sptool-hwid-salt.txt'), 'volume-salt-123\n');
  const cfg = loadConfig({ LICENSE_PRIVATE_KEY: newSigningKey().privatePem, HWID_SERVER_SALT: 'volume-salt-123', PUBLIC_URL: 'http://127.0.0.1', DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 's', DB_PATH: join(dir, 'sptool-license.db') });
  const server = createApp({ cfg, db: openDb(cfg.dbPath), discordUser: async () => ({ id: OWNER_DISCORD_ID, username: 'owner', global_name: 'owner', avatar: null }) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const hw = createHash('sha256').update('pc').digest('hex');
  const state = `st_${'y'.repeat(40)}`;
  await fetch(`${base}/api/v1/auth/discord/start?state=${state}&hwid=${hw}&device=PC&kind=desktop`, { redirect: 'manual' });
  await fetch(`${base}/api/v1/auth/discord/callback?state=${state}&code=x`);
  const { token } = await (await fetch(`${base}/api/v1/auth/poll?state=${state}`)).json() as { token: string };
  server.close();

  delete process.env.HWID_SERVER_SALT; delete process.env.SPTOOL_HWID_SALT;
  process.env.DATA_DIR = dir; process.env.SPTOOL_CLOUD = 'false'; // no http patching in the test
  const cs = createRequire(import.meta.url)('../server/integrations/cloud-sync.cjs');
  const call = async (hwid: string) => {
    let status = 0, body = '';
    const req = { method: 'GET', url: '/api/v1/sptool-app/release', headers: { authorization: `Bearer ${token}`, 'x-sptool-hwid': hwid } };
    const res = { writeHead: (s: number) => { status = s; }, end: (b: string) => { body = b; }, headersSent: false };
    try { await cs.handleApp(req, res); } catch (e: any) { return { status: e.status, error: e.code }; }
    return { status, body: JSON.parse(body) };
  };
  const ok = await call(hw);
  assert.equal(ok.status, 200, JSON.stringify(ok));
  const other = await call(createHash('sha256').update('other-pc').digest('hex'));
  assert.equal(other.error, 'cloud_hwid', 'a token from another PC is still refused');

  // Skin Tool has its own release, separate from SP Tool's
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2000, 1), Buffer.from('Turbo Skin Tool/TurboSkinTool.exe')]);
  const post = async (url: string, body: Buffer, version: string) => {
    let status = 0, out = '';
    const req = Object.assign(new EventEmitter(), { method: 'POST', url, headers: { authorization: `Bearer ${token}`, 'x-sptool-hwid': hw, 'x-sptool-version': version }, destroy() {} });
    const res = { writeHead: (st: number) => { status = st; }, end: (b: string) => { out = b; }, headersSent: false };
    const p = cs.handleApp(req, res).catch((e: any) => { status = e.status; out = JSON.stringify({ error: e.code }); });
    setImmediate(() => { req.emit('data', body); req.emit('end'); });
    await p;
    return { status, body: JSON.parse(out) };
  };
  const up = await post('/api/v1/sptool-app/release?product=skin', zip, '1.0.0');
  assert.equal(up.status, 200, JSON.stringify(up));
  assert.equal(up.body.stored, true);
  const wrong = await post('/api/v1/sptool-app/release', zip, '9.0.0');
  assert.equal(wrong.body.error, 'bad_zip', 'an SP Tool release must contain SPTool.exe');
  const get = async (url: string) => {
    let status = 0, body = '';
    const req = { method: 'GET', url, headers: { authorization: `Bearer ${token}`, 'x-sptool-hwid': hw } };
    const res = { writeHead: (st: number) => { status = st; }, end: (b: string) => { body = b; }, headersSent: false };
    await cs.handleApp(req, res);
    return { status, body: JSON.parse(body) };
  };
  assert.equal((await get('/api/v1/sptool-app/release?product=skin')).body.version, '1.0.0');
  assert.equal((await get('/api/v1/sptool-app/release')).body.version, null, 'SP Tool release untouched');
  assert.equal((await get('/api/v1/sptool-app/latest?product=skin')).body.version, '1.0.0');

  // push with "Was ist neu?": every user's app shows the notes; the same version again only changes the notes
  const push = async (version: string, notes: string | null, body = zip) => {
    let status = 0, out = '';
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'x-sptool-hwid': hw, 'x-sptool-version': version };
    if (notes !== null) headers['x-sptool-notes'] = encodeURIComponent(notes);
    const req = Object.assign(new EventEmitter(), { method: 'POST', url: '/api/v1/sptool-app/release?product=skin', headers, destroy() {} });
    const res = { writeHead: (st: number) => { status = st; }, end: (b: string) => { out = b; }, headersSent: false };
    const p = cs.handleApp(req, res).catch((e: any) => { status = e.status; out = JSON.stringify({ error: e.code }); });
    setImmediate(() => { req.emit('data', body); req.emit('end'); });
    await p;
    return { status, body: JSON.parse(out) };
  };
  assert.equal((await push('1.1.0', 'Reload klingt jetzt\nvoller – Ümlaute ✓')).body.stored, true);
  assert.equal((await get('/api/v1/sptool-app/latest?product=skin')).body.notes, 'Reload klingt jetzt\nvoller – Ümlaute ✓');
  const again = await push('1.1.0', 'Tippfehler korrigiert');
  assert.equal(again.body.notesUpdated, true);
  const latest = (await get('/api/v1/sptool-app/latest?product=skin')).body;
  assert.equal(latest.notes, 'Tippfehler korrigiert');
  assert.equal(latest.version, '1.1.0');
  assert.equal((await push('1.0.5', 'älter')).body.stored, false, 'an older version is never pushed');
  // changelog: every pushed version with its notes, newest first (the update window shows all skipped versions)
  assert.deepEqual(latest.history.map((e: any) => [e.version, e.notes]), [['1.1.0', 'Tippfehler korrigiert'], ['1.0.0', '']]);
  assert.deepEqual((await get('/api/v1/sptool-app/release?product=skin')).body.history.map((e: any) => e.version), ['1.1.0', '1.0.0']);

  // "Falsch erkannt": features + right answer are stored (numbers only), admins read them back
  const json = async (url: string, data: unknown) => {
    let status = 0, out = '';
    const req = Object.assign(new EventEmitter(), { method: 'POST', url, headers: { authorization: `Bearer ${token}`, 'x-sptool-hwid': hw }, destroy() {} });
    const res = { writeHead: (st: number) => { status = st; }, end: (b: string) => { out = b; }, headersSent: false };
    const p = cs.handleApp(req, res).catch((e: any) => { status = e.status; out = JSON.stringify({ error: e.code }); });
    setImmediate(() => { req.emit('data', Buffer.from(JSON.stringify(data))); req.emit('end'); });
    await p;
    return { status, body: JSON.parse(out) };
  };
  const fb = await json('/api/v1/sptool-app/feedback', { version: 1, items: [{ label: 'reload', predicted: 'shot', score: 1.234567, inputs: { density: 0.5, zcr: 2.1, 'bad key!': 3, evil: 'x' }, app: '1.9.4', source: 'import' }] });
  assert.equal(fb.body.stored, 1, JSON.stringify(fb));
  assert.equal((await json('/api/v1/sptool-app/feedback', { version: 1, items: [{ label: 'banana', predicted: 'shot', inputs: {} }] })).body.error, 'bad_feedback');
  const back = (await get('/api/v1/sptool-app/feedback')).body.items;
  assert.equal(back.length, 1);
  assert.deepEqual(back[0].inputs, { density: 0.5, zcr: 2.1 }, 'only numeric features with clean names are kept');
  assert.equal(back[0].label, 'reload');
});
