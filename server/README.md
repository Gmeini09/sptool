# SP Tool – Lizenzserver

Lizenzen sind an die **Discord-ID** gebunden und auf **Geräte (HWID)** beschränkt. Der Owner **697402284849627180** ist immer Admin und verwaltet alles im Admin-Bereich der App (Benutzer, Lizenzen, Keys, Geräte, Bans, Rollen, Audit-Log).

Keine externen Pakete: Node.js ≥ 22.13 (eingebautes `node:sqlite`, `node:crypto`, `node:http`).

## So funktioniert der Schutz

| Baustein | Umsetzung |
|---|---|
| Identität | Offizieller Discord-OAuth2-Flow, Scope nur `identify`. SP Tool sieht weder Discord-Passwort noch Discord-Token; das Discord-Access-Token wird nicht gespeichert. |
| Login in der App | Die App öffnet den Discord-Login im Browser und fragt mit einem geheimen `state` nach (`/auth/poll`). Das Sitzungs-Token wird **genau einmal** ausgegeben. |
| HWID | Desktop: Windows-MachineGuid (Linux machine-id, macOS Platform-UUID). Die App hasht sie (SHA-256 + App-Salt), der Server hasht nochmals mit `HWID_SERVER_SALT`. Die Roh-ID verlässt den PC nie. |
| Weitergabe-Sperre | Jede Sitzung gehört zu genau einem Gerät. Jede Anfrage schickt Token **und** HWID-Hash (`X-SPTool-HWID`); ein kopiertes Token auf einem anderen PC → `403 hwid_mismatch`. Neue PCs werden nur bis `max_devices` angenommen (Standard 1), danach `device_limit` – nur ein Admin kann Geräte zurücksetzen. |
| Lizenzprüfung | Immer serverseitig. Die App bekommt ein **Ed25519-signiertes Ticket** (Plan, Ablauf, Discord-ID, HWID). Sie prüft die Signatur mit dem eingebauten Public Key – Tickets lassen sich nicht fälschen, ändern oder auf einen anderen PC kopieren. Offline läuft die App bis `OFFLINE_GRACE_HOURS` (Standard 72 h) weiter. |
| Sitzungen | Zufällige 256-Bit-Tokens, in der Datenbank nur als SHA-256, 30 Tage gültig, widerrufbar (Abmelden, „überall abmelden“, Ban, Geräte-Reset). |
| Admin | Owner-ID fest im Code (`config.mjs`) + optional `ADMIN_DISCORD_IDS`. Der Owner kann nicht gebannt oder herabgestuft werden; nur der Owner vergibt Admin-Rechte. Jede Admin-Aktion steht im Audit-Log. |
| Härtung | Rate-Limits (allgemein, Login, Key-Einlösen), 64-KB-Body-Limit, Security-Header, keine Tokens/Passwörter in Logs. |

> Ehrlicher Hinweis: Jede Prüfung im Client lässt sich mit genug Aufwand (Patchen der App) umgehen. Der Server-Teil (Lizenzen, Keys, Geräte, Admin) ist dagegen nicht manipulierbar. Inhalte, die nur mit Lizenz verfügbar sein sollen (künftig z. B. Marketplace-Downloads, Cloud), liefert deshalb der Server nur gegen gültige Sitzung aus.

## Einrichten

### 1. Discord-Anwendung anlegen
1. <https://discord.com/developers/applications> → **New Application** → Name „SP Tool“.
2. **OAuth2** → *Client ID* und *Client Secret* kopieren.
3. **OAuth2 → Redirects** → `https://DEINE-DOMAIN/api/v1/auth/discord/callback` eintragen.

### 2. Signaturschlüssel erzeugen
```bash
node server/index.mjs --gen-keys
```
Schreibt `server/data/license-ed25519.pem` (geheim halten, sichern!) und gibt den **Public Key** aus. Den Public Key braucht der App-Build.

### 3. Konfiguration
`server/.env.example` nach `.env` kopieren bzw. als Umgebungsvariablen beim Hoster setzen:

| Variable | Bedeutung |
|---|---|
| `PUBLIC_URL` | Öffentliche HTTPS-Adresse des Servers |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | aus Schritt 1 |
| `HWID_SERVER_SALT` | langer Zufallswert (z. B. `openssl rand -hex 32`), danach nie mehr ändern |
| `ADMIN_DISCORD_IDS` | weitere Admins (kommagetrennt), optional |
| `DEFAULT_MAX_DEVICES` | Geräte ohne Lizenz (Standard 1) |
| `OFFLINE_GRACE_HOURS` | Offline-Nutzung ohne Serverkontakt (Standard 72) |
| `TRUST_PROXY=1` | nur hinter einem Reverse-Proxy (nginx, Caddy, Cloudflare) |

### 4. Starten
```bash
node --env-file=.env server/index.mjs
```
Der Server muss per **HTTPS** erreichbar sein (z. B. Caddy davor: `license.example.com { reverse_proxy localhost:8787 }`). Die Datenbank liegt in `server/data/sptool.db` – regelmäßig sichern.

### 5. App mit dem Server bauen
```powershell
$env:SPTOOL_API_URL="https://license.example.com"
$env:SPTOOL_LICENSE_PUBKEY="<Public Key aus Schritt 2>"
npm run tauri:build
```
Ohne diese beiden Variablen baut die App wie bisher mit lokalem Profil (ohne Login/Lizenz).

## Als Admin arbeiten

Mit der Owner-ID anmelden → in der Sidebar erscheint **Admin**:

- **Users**: Suchen nach Name oder Discord-ID. Eine vollständige Discord-ID, die sich noch nie angemeldet hat, kann direkt eine Lizenz bekommen (gilt beim ersten Login).
- **Benutzer öffnen**: Lizenz vergeben/verlängern (Plan, Tage oder lebenslang, erlaubte Geräte, Notiz), widerrufen; gebundene Geräte sehen, einzeln entfernen oder alle zurücksetzen (Umzug auf neuen PC); überall abmelden; bannen mit Grund / entbannen; Admin machen (nur Owner).
- **License keys**: Keys erzeugen (`SPT-XXXX-XXXX-XXXX-XXXX`, je einmal einlösbar), kopieren, unbenutzte widerrufen. Nutzer lösen sie in der App ein.
- **Audit log**: alle Logins, abgelehnten Logins (Ban, Gerätelimit), Lizenz-, Key-, Geräte- und Rollenänderungen.

## Entwicklung

```bash
# Testlauf ohne echte Discord-App (nur lokal, in production verweigert):
node server/index.mjs --gen-keys
SPTOOL_FAKE_DISCORD=1 node server/index.mjs
# App dagegen bauen:
SPTOOL_API_URL=http://localhost:8787 SPTOOL_LICENSE_PUBKEY=<key> npm run dev
```
Tests: `npm test` (enthält `tests/server.test.ts`: Login, HWID-Bindung, Gerätelimit, Admin-Reset, Lizenzen, Keys, Bans, Owner-Schutz, Ticket-Signatur, Rate-Limit).

## API (v1)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/v1/auth/discord/start?state&hwid&device&kind` | Login starten → Weiterleitung zu Discord |
| GET | `/api/v1/auth/discord/callback` | Rückkehr von Discord |
| GET | `/api/v1/auth/poll?state` | Token abholen (einmalig) |
| GET | `/api/v1/me` | Benutzer, Lizenz, Geräte, signiertes Ticket |
| POST | `/api/v1/license/check` | Lizenz + frisches Ticket |
| POST | `/api/v1/license/redeem` `{key}` | Key einlösen |
| POST | `/api/v1/auth/logout`, `/logout-all` | Abmelden |
| GET | `/api/v1/admin/stats`, `/users?q=`, `/users/:id`, `/keys`, `/audit` | Admin-Übersichten |
| POST | `/api/v1/admin/users/:id/license` `{plan|none, days, maxDevices, note}` | Lizenz setzen/widerrufen |
| POST | `/api/v1/admin/users/:id/ban` `{reason}`, `/unban`, `/role` `{role}`, `/devices/reset`, `/logout-all` | Moderation |
| DELETE | `/api/v1/admin/devices/:id` | Einzelnes Gerät entfernen |
| POST | `/api/v1/admin/keys` `{plan, count, days, maxDevices, note}`, `/admin/keys/:key/revoke` | Keys |

Alle geschützten Routen: `Authorization: Bearer <token>` + `X-SPTool-HWID: <hash>`.

## Im Discord-Bot betreiben (empfohlen, wenn du schon einen Bot hast)

`server/integrations/discord-bot.cjs` hängt das komplette Lizenzsystem in einen bestehenden discord.js-Bot: API unter `/api/v1` auf dem Webserver des Bots, plus globale Slash-Commands `/sptool` und `/sptool-admin` (Lizenz geben/entziehen, Geräte-Reset, Ban, Keys, Stats, Setup). Schlüssel und Salt werden beim ersten Start automatisch auf dem Volume erzeugt. Für den Turbo-Designs-Bot ist das bereits fertig eingebaut (`sptool-license/`, Anleitung `SPTOOL-LICENSE.md` im Bot-Repo).
