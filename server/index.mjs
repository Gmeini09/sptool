#!/usr/bin/env node
// SP Tool license server.
//   node server/index.mjs             start the API
//   node server/index.mjs --gen-keys  create the Ed25519 signing key and print the public key
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { fetchDiscordUser } from './discord.mjs';
import { newSigningKey, publicRawFromPrivate } from './security.mjs';

const cfg = loadConfig();

if (process.argv.includes('--gen-keys')) {
  if (existsSync(cfg.privateKeyPath)) {
    console.log(`Key already exists at ${cfg.privateKeyPath}.\nPublic key (SPTOOL_LICENSE_PUBKEY): ${publicRawFromPrivate(cfg.privateKeyPem)}`);
    process.exit(0);
  }
  const k = newSigningKey();
  mkdirSync(dirname(cfg.privateKeyPath), { recursive: true });
  writeFileSync(cfg.privateKeyPath, k.privatePem, { mode: 0o600 });
  console.log(`Private key written to ${cfg.privateKeyPath} (keep it secret, back it up).\nPublic key – put into the client build as SPTOOL_LICENSE_PUBKEY:\n${k.publicRaw}`);
  process.exit(0);
}

if (cfg.fakeDiscord && cfg.production) { console.error('SPTOOL_FAKE_DISCORD must never be enabled in production.'); process.exit(1); }
if (!cfg.privateKeyPem) { console.error('No signing key. Run: node server/index.mjs --gen-keys'); process.exit(1); }
if (!cfg.fakeDiscord && (!cfg.discord.clientId || !cfg.discord.clientSecret)) { console.error('Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET (see server/.env.example).'); process.exit(1); }

const db = openDb(cfg.dbPath);
const server = createApp({ cfg, db, discordUser: (code) => fetchDiscordUser(cfg, code) });
server.listen(cfg.port, cfg.host, () => {
  console.log(`SP Tool license server on ${cfg.publicUrl} (port ${cfg.port})`);
  console.log(`Admins: ${[...cfg.adminIds].join(', ')}`);
  if (cfg.fakeDiscord) console.log('⚠ Fake Discord login enabled (development only).');
});
