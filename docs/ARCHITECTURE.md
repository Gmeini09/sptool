# Architektur

## Grundprinzip

```
┌────────────────────────── Tauri-Fenster (WebView2) ──────────────────────────┐
│ React UI (main thread)                                                       │
│   store.ts ── views/* ── components/*                                        │
│        │                                                                     │
│        ├── audio/engine.ts      Web-Audio-Wiedergabe, Playhead, Peak-Meter   │
│        ├── library/assets.ts    Lazy-Loading, LRU-Audio-Cache, Metadaten-Cache│
│        └── audio/workerClient ──► audio.worker.js (eigener Thread)           │
│                                    synth/ · dsp/ (reines TypeScript)         │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ IPC (invoke)
                         src-tauri (Rust): detect.rs · fsio.rs · logs.rs
```

- **Kein UI-Freeze**: Synthese, Effektkette, WAV-Codierung und Analyse laufen ausschließlich im Worker (§122).
- **Reine DSP**: `src/dsp` und `src/synth` haben keine Browser-Abhängigkeit und sind in Node testbar.
- **Nicht-destruktiv**: `EditState` (JSON) + Original → `renderEdit()` (§50).
- **Ehrliche Grenzen**: Native Funktionen melden im Browser „Desktop only“ statt Ergebnisse zu simulieren (§140).

## Datenmodell

| Typ | Datei | Zweck |
|---|---|---|
| `LibraryEntry` | `models/types.ts` | Ein Sound. Audioquelle: `synth` (Rezept), `blobKey` (importierte WAV in IndexedDB) oder `edit` (Original-ID + EditState). |
| `EditState` | `dsp/chain.ts` | Trim, Cuts, Fades und alle Effekte. |
| `SynthParams` | `synth/synth.ts` | Generator-Parameter + Seed. |
| `WeaponProfile` | `weapon_profiles/*.json` | Waffe, Slots, später Container/Install-Mapping. |

## Persistenz

- `localStorage` (`sptool:*`): Profil, Einstellungen, Favoriten, Verlauf, eigene Sounds (Rezepte), Collections, Tags, Presets, Metadaten-Cache.
- IndexedDB (`sptool/blobs`): importierte WAV-Dateien.
- Logdatei: `%APPDATA%\app.sptool.desktop\logs\sptool.log` (Rotation bei 5 MB).

Ab Phase 3 kommen `.spproject`-Dateien (ZIP) im Dateisystem hinzu.

## Effektkette (Reihenfolge)

Regionen (Trim/Cuts) → Speed → Pitch → HP → LP → Bass/Mid/Treble → Param-EQ → Gate → Transient → Compressor → Delay → Reverb → Width/Mono → Gain → Normalize → Soft Clip → Limiter → Hard Limit → Fades.

## Sound-Synthese

Jeder Schuss besteht aus Layern (§57): Transient-Crack, Main (bandbegrenztes Rauschen), tonaler Body, Bass-Sweep, Mechanik (inharmonische Metall-Partials), Tail (tiefpassgefiltertes Rauschen mit fallender Grenzfrequenz), Room (frühe Reflexionen, stereo). Reload/Handling werden aus Primitiven (Klick, Reibung, Thud) zusammengesetzt. Deterministisch per Seed (mulberry32).

## Eine Waffe hinzufügen

1. `weapon_profiles/<id>.json` anlegen (Format wie `pistol.json`).
2. In `src/weapons/profiles.ts` importieren.
3. `WeaponId` in `models/types.ts` und `WEAPONS` in `library/catalog.ts` ergänzen (Kaliber, Pitch).

## Konto & Lizenz (0.7.0)

```
App (src/account)                         Lizenzserver (server/)
 hwid.ts   MachineGuid → SHA-256(salt) ─┐
 account.ts  Login: /auth/discord/start ─┼─► Discord OAuth2 (identify) ─► /callback
             Poll:  /auth/poll  ◄────────┘    Session (Token-Hash, Gerät)
             API:   Bearer + X-SPTool-HWID ─► authenticate(): Token + Gerät + Ban
 ticket.ts   Ed25519-Ticket prüfen  ◄──────── signTicket(plan, exp, hwid, offlineUntil)
 App.tsx     Gate: Login → Lizenz → App
 views/Admin.tsx  ────────────────────────► /api/v1/admin/* (Owner + Admins, Audit-Log)
```

Die App vertraut nur Tickets, die mit dem eingebauten Public Key signiert sind und deren HWID zum Gerät passt. Alle Entscheidungen (Lizenz, Gerätelimit, Ban) trifft der Server.
