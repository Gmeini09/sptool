# SP Tool – FiveM Soundpack Creator

**Create. Preview. Build. Install.**

SP Tool ist eine Windows-Desktop-App zum Erstellen, Bearbeiten und Generieren von Waffen-Soundpacks für GTA V / FiveM. Dieser Stand ist **Version 1.0.0 = Entwicklungsphase 1–3** plus Lizenzsystem (Discord-ID + HWID) (Fundament, UI, Audio-Engine, Sound Library, Audio Editor) plus ein funktionsfähiger Sound Generator.

> **Wichtig:** Build, Install und Backups sind in dieser Version absichtlich **gesperrt**. SP Tool schreibt keine GTA-/FiveM-Audiodateien, solange das Format nicht an einem funktionierenden Referenz-Soundpack verifiziert wurde (Spezifikation §165/§166). Deine FiveM-Installation wird von dieser Version nicht verändert.

---

## Inhalt
- [Was funktioniert in 0.2.0](#was-funktioniert-in-020)
- [Voraussetzungen](#voraussetzungen)
- [Installation & Start (Entwicklung)](#installation--start-entwicklung)
- [Windows-Installer bauen](#windows-installer-bauen)
- [Erster Start](#erster-start)
- [Lizenzen, Discord & Admin](#lizenzen-discord--admin)
- [Sound Library](#sound-library)
- [Audio Editor](#audio-editor)
- [Generator](#generator)
- [FiveM & GTA V](#fivem--gta-v)
- [Projektstruktur](#projektstruktur)
- [Tests](#tests)
- [Sicherheit & Datenschutz](#sicherheit--datenschutz)
- [Lizenzen der mitgelieferten Sounds](#lizenzen-der-mitgelieferten-sounds)
- [Roadmap](#roadmap)
- [Troubleshooting](#troubleshooting)

---

## Was funktioniert in 0.2.0

| Bereich | Status |
|---|---|
| Dark UI, Sidebar, Topbar, Statusleiste, 4 Themes, 4 Akzentfarben, UI-Skalierung, Reduced Motion | ✅ |
| **Animiertes HUD**: Seitenwechsel mit Kaskaden, gleitende Navigation, Aurora-Hintergrund, 3D-Neigung + Cursor-Glow auf Karten, Klick-Ripples, Partikel bei Erfolgen, audio-reaktiver Glow, Equalizer, Slot-Lock-in, rotierende Neon-Rahmen, hochzählende Zahlen – alles abschaltbar über *Reduce motion* | ✅ |
| Welcome-Screen + Onboarding (Profil, FiveM/GTA-Erkennung, Theme, Standard-Stil) | ✅ (lokales Profil) |
| Command Palette `Ctrl+K`, Suche überall, Toasts, Benachrichtigungen, Kontextmenüs | ✅ |
| **Sound Library**: 418 eingebaute Sounds, Filter, Suche, virtualisiertes Grid, Inspector, Favoriten, Collections, eigene Tags, Hover-Preview, WAV-Import (Drag & Drop), WAV-Export | ✅ |
| **Audio Editor**: nicht-destruktiv, Waveform mit Zoom/Scroll/Selektion/Markern/Trim-Handles, Cut/Crop, Undo/Redo, A/B/C-Vergleich, 20+ Effekte, Analyse (Peak/RMS/LUFS/…), Clipping-Schutz mit Auto Fix, eigene Presets | ✅ |
| **Generator**: Schuss-, Suppressor-, Reload- und Handling-Sounds aus Parametern, Smart Randomize, Verlauf, Speichern/Export | ✅ |
| Presets-Browser (13 eingebaute Audio-Presets + eigene) | ✅ |
| Waffenprofile als JSON (`weapon_profiles/`) | ✅ |
| FiveM-/GTA-V-Erkennung (Rockstar, Steam, Epic, FiveM-Config, eigener Pfad), „FiveM läuft“-Erkennung | ✅ (Desktop-App) |
| Logging (UI + Datei), Filter/Suche/Kopieren/Export | ✅ |
| **Pack Analyzer**: RPF7-Archive öffnen, AWC-Container und Streams auflisten, anhören, als WAV extrahieren, in die Library übernehmen, Streams ersetzen und gepatchte Kopie exportieren | ✅ (siehe `docs/REFERENCE_ANALYSIS.md`) |
| **Handy & Tablet**: eigene Touch-Oberfläche (Bottom-Navigation, Bottom-Sheets, Touch-Waveform), installierbar als Web-App (PWA, offline), Tauri-Mobile vorbereitet | ✅ (siehe `docs/MOBILE.md`) |
| **Schalldämpfer** als einziger Aufsatz; Build-Regel: wer eine Waffe ändert, muss den Schalldämpfer-Sound mitliefern; automatisch aus dem Schuss ableitbar | ✅ Regel + Profile; Stream-Zuordnung offen |
| **Mehrere RPFs gemeinsam** (z. B. WEAPONS_PLAYER + RESIDENT): identische Container werden erkannt und immer in allen Archiven gleich gepatcht | ✅ getestet mit Referenzpack |
| **Projekte & Soundpack-Editor**: Waffen links, Slots inkl. Aufsatz-Slots, Drag & Drop, Sound-Picker mit Empfehlungen, „Create pack for me“, „Play full pack“, Autosave, Snapshots/Versionsverlauf, Crash Recovery, `.spproject` Export/Import | ✅ |
| 3D-Preview, Mixer | ⏳ Phase 3, 5, 6 |
| Build / Install / Backup | 🔒 Phase 4 – AWC-Format verifiziert, Waffen-Zuordnung und Installationsort noch offen |
| **Lizenzsystem**: Login mit Discord (offizielles OAuth2), Lizenz pro Discord-ID, Bindung an Geräte (HWID) gegen Weitergeben, Key-Einlösen, signierte Offline-Tickets (72 h), Konto-Seite mit Geräten | ✅ (`server/`, siehe `server/README.md`) |
| **Admin-Panel** für den Owner `697402284849627180`: Benutzer, Lizenzen vergeben/verlängern/widerrufen, Geräte zurücksetzen, Bans, Admin-Rollen, Lizenz-Keys, Audit-Log | ✅ |
| Cloud, Marketplace, Updater | ⏳ Phase 9–12 |

Geplante Module sind in der Sidebar mit `P3`, `P4` … markiert und zeigen eine ehrliche Info-Seite statt funktionsloser Buttons.

## Windows-App (SPTool.exe)

`SPTool.exe` ist die fertige Windows-App von Turbo Design – eine einzelne Datei, keine Abhängigkeiten:

1. Doppelklick auf `SPTool.exe` → installiert sich für den aktuellen Benutzer (ohne Admin) nach `%LOCALAPPDATA%\Programs\SPTool`, legt Startmenü- und Desktop-Verknüpfung an und erscheint unter *Apps & Features* (dort auch deinstallierbar).
2. SP Tool öffnet sich als eigenständiges Windows-Programm: eigenes Fenster mit Turbo-Design-Icon und dunkler Titelleiste, gerendert mit der in Windows 10/11 eingebauten WebView2-Engine (wie Discord, Teams, Spotify). Fenster schließen = beendet.
3. Update: neue `SPTool.exe` starten – ersetzt die alte, Projekte bleiben.

Die Exe liefert die App lokal aus (nur 127.0.0.1) und stellt nativ bereit: echte **Hardware-ID** (Windows MachineGuid) für die Lizenzbindung, FiveM-/GTA-V-Erkennung. Bauen: `node scripts/build-windows.mjs` (Go 1.22+ und `go-winres`, auch von Linux/macOS aus). Quellcode: `windows/`.

## Voraussetzungen

- Windows 10/11 x64
- [Node.js 20+](https://nodejs.org)
- [Rust (stable)](https://rustup.rs) mit MSVC-Toolchain
- Microsoft C++ Build Tools und WebView2 (bei Windows 11 vorinstalliert) – siehe [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

## Installation & Start (Entwicklung)

```powershell
npm install
npm run tauri:dev
```

Nur das Frontend im Browser (ohne native Funktionen wie FiveM-Erkennung):

```powershell
npm run dev        # http://localhost:1420
```

## Windows-Installer bauen

```powershell
npm run tauri:build
```

Ergebnis: `src-tauri/target/release/bundle/nsis/SP Tool_0.2.0_x64-setup.exe`. Die CI-Pipeline (`.github/workflows/release.yml`) benennt ihn in `SPTool_Setup.exe` um und erzeugt eine SHA-256-Datei. Code-Signing siehe `docs/DEPLOYMENT.md`.

## Erster Start

1. Anzeigename eingeben → **Continue offline** (Online-Accounts kommen mit dem Backend).
2. FiveM und GTA V werden automatisch gesucht; sonst **Locate FiveM / Locate GTA V**.
3. Theme und Akzentfarbe wählen.
4. Standard-Soundstil wählen.
5. Library öffnen und Sounds anhören.

## Projekte

Projects → *New soundpack* legt ein Projekt an; der Soundpack Editor zeigt links die Waffen (mit `x / 10` gefüllten Slots), in der Mitte Basis-Slots und den Schalldämpfer-Slot, rechts den Sound-Picker. Sounds per Drag & Drop oder Klick zuweisen. Jede Änderung wird sofort gespeichert; jede Minute entsteht ein Snapshot (Versionsverlauf über das Uhr-Symbol). Ist der Schalldämpfer-Slot leer, zeigt der Editor das an; *Derive missing* erzeugt fehlende Schalldämpfer-Sounds aus dem Schuss. `.spproject`-Dateien enthalten auch eigene/importierte Sounds und lassen sich auf PC und Handy öffnen.

## Aufsätze und mehrere Archive

In GTA V nutzt eine Waffe mit Aufsatz teils andere Sounds (z. B. Schalldämpfer). Ändert ein Pack nur den normalen Schuss, spielt das Spiel mit Aufsatz den Original-Sound – der Pack „buggt“. SP Tool behandelt Aufsätze deshalb als Pflichtteil jeder Waffe:

- Einziger unterstützter Aufsatz ist der Schalldämpfer (`COMPONENT_AT_PI_SUPP_02` bzw. `COMPONENT_AT_AR_SUPP_02` bei der .50) mit eigenem Slot *Suppressed Fire*.
- Der Build lehnt Packs ab, die eine Waffe ändern, aber den Schalldämpfer-Slot leer lassen (`src/weapons/coverage.ts`). Ein fehlender Schalldämpfer-Sound kann automatisch aus dem Schuss abgeleitet werden (Preset *Suppressed (derived)*).
- Liegt derselbe Container in mehreren RPFs (im Referenzpack 4 Container in WEAPONS_PLAYER **und** RESIDENT), wird er immer in allen Archiven identisch ersetzt. Im Pack Analyzer daher alle RPFs eines Packs zusammen öffnen.

## Lizenzen, Discord & Admin

Wird die App mit `SPTOOL_API_URL` und `SPTOOL_LICENSE_PUBKEY` gebaut, startet sie mit **„Continue with Discord“**:

1. Discord-Login im Browser (SP Tool sieht nie dein Passwort oder Token).
2. Der PC wird an die Discord-ID gebunden (HWID = gehashte Windows-MachineGuid). Standard: 1 Gerät pro Lizenz.
3. Ohne Lizenz zeigt die App die Discord-ID zum Kopieren und ein Feld für einen Lizenz-Key.
4. Mit Lizenz läuft die App normal, auch bis zu 72 h offline.

Ein weitergegebener Account/Token funktioniert auf einem fremden PC nicht (`device limit` bzw. `hwid mismatch`); nur ein Admin kann Geräte zurücksetzen. Der Owner **697402284849627180** sieht in der Sidebar **Admin** und verwaltet dort alles. Einrichtung des Servers und der Discord-App: **`server/README.md`**.

Ohne die beiden Build-Variablen (z. B. die Browser-Vorschau) arbeitet die App wie bisher mit lokalem Profil.

## Sound Library

- **Play** auf jeder Card, **Doppelklick** öffnet den Editor, **Rechtsklick** für das Kontextmenü (Preview, Edit, Duplicate, Favorite, Export WAV, Details, Collections, Delete).
- **Space** spielt den ausgewählten Sound.
- **Import WAV**: Button oder Dateien ins Grid ziehen. PCM 8/16/24/32-bit und Float-WAV werden unterstützt; die Datei wird vorher validiert. Originaldateien werden nur gelesen.
- Metadaten (Dauer, Peak, LUFS, Mini-Waveform) werden beim ersten Anzeigen im Hintergrund berechnet und gecacht – Audio wird erst bei Bedarf erzeugt.

## Audio Editor

Alle Änderungen sind **nicht-destruktiv**: gespeichert wird nur das Original + eine Effektkette (JSON). Gerendert wird bei Vorschau und Export.

| Aktion | Bedienung |
|---|---|
| Auswahl | Auf der oberen Waveform ziehen |
| Trimmen | Orange Handles ziehen oder *Trim start/end* am Cursor |
| Cut / Crop | Auswahl → *Cut* (Entf) bzw. *Crop* |
| Zoom / Scroll | Mausrad / Shift+Mausrad, Scrollbar unten |
| Abspielen | Space; *L* = Loop |
| Vergleich | A = Original, B = bearbeitet, C = Alternative (Tasten 1/2/3) |
| Undo / Redo | Ctrl+Z / Ctrl+Y |
| Marker | M |
| Speichern | Ctrl+S → neuer Sound in „Edited“ |

Effekte: Gain, Normalize, Fade In/Out, Pitch (längenerhaltend), Speed, Bass/Mid/Treble, 3-Band parametrischer EQ, High-/Low-Pass, Compressor, Transient Shaper, Noise Reduction (Gate), Reverb, Delay, Stereo Width, Mono, Soft Clip, Limiter, Hard Limit.

## Generator

Erzeugt Sounds aus Parametern (Punch, Bass, Transient, Metal, Tail, Room, Noise, Dynamics, Pitch, Length) und einem Seed. Gleiche Parameter + Seed = identischer Sound. Gespeicherte Generator-Sounds belegen nur wenige Bytes (es wird das Rezept gespeichert).

## FiveM & GTA V

Erkennung (nur Desktop-App, nichts simuliert):

- FiveM: `%LOCALAPPDATA%\FiveM\FiveM.app` plus gängige Alternativpfade oder ein eigener Ordner. Liest `CitizenFX.ini` (`IVPath`) für den konfigurierten GTA-Pfad.
- GTA V: Rockstar-Registry, Steam (`libraryfolders.vdf`), Epic-Manifeste, FiveM-Config, eigener Pfad. Gültig, wenn `GTA5.exe` (Legacy) bzw. `GTA5_Enhanced.exe` existiert.
- „FiveM läuft“ wird über die Windows-Prozessliste geprüft.

## Projektstruktur

```
sptool/
├─ src/                      React-Frontend (TypeScript)
│  ├─ app/                   Store, Navigation, App-Shell
│  ├─ audio/                 Engine (Web Audio), Worker, Preview
│  ├─ dsp/                   reine DSP: Filter, Dynamik, Effekte, Stretch, Analyse, WAV, Effektkette
│  ├─ synth/                 prozeduraler Sound-Synthesizer
│  ├─ library/               Katalog (418 Sounds), Asset-Cache, Import/Export
│  ├─ components/            UI-Bausteine, Waveform-Editor, Icons
│  ├─ views/                 Seiten
│  ├─ services/              Tauri-Bridge, Logging, Storage, Systemerkennung
│  ├─ weapons/ models/ themes/ assets/
├─ src/account/              Discord-Login, HWID, Ticket-Prüfung, Konto-Status
├─ server/                   Lizenzserver (Node, SQLite, Ed25519) + Admin-API
├─ src-tauri/                Rust-Kern (Tauri v2): Erkennung, Datei-I/O, Logs, Machine-ID
├─ weapon_profiles/          pistol.json, pistol_mk2.json, pistol50.json
├─ tests/                    DSP-, Synth- und Katalog-Tests
├─ scripts/build.mjs         esbuild-Build / Dev-Server
└─ docs/                     Architektur, Roadmap, Deployment, Referenz-Soundpack
```

Mehr in `docs/ARCHITECTURE.md`.

## Tests

```powershell
npm test                                            # DSP, WAV, LUFS, Presets, Synth, Katalog, AWC/RPF
# Tests gegen echte Archive (nicht im Repo enthalten):
$env:SPTOOL_REF_RPF="C:\pfad\WEAPONS_PLAYER.rpf"; $env:SPTOOL_REF_AWC_DIR="C:\pfad\awc"; npm test
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml     # VDF-/INI-Parser
```

## Sicherheit & Datenschutz

- Keine Telemetrie, keine Analytics, keine Crash-Reports in diesem Build (Opt-in-Schalter sind vorbereitet und standardmäßig aus).
- Strikte Content-Security-Policy, keine externen Skripte.
- Logs filtern Passwörter/Tokens heraus.
- Discord nur über offiziellen OAuth2-Flow (Scope `identify`); Sitzungs-Tokens serverseitig nur als SHA-256; HWID wird doppelt gehasht übertragen/gespeichert; Lizenzen werden immer serverseitig geprüft, die App akzeptiert nur Ed25519-signierte Tickets.
- Dateien werden atomar geschrieben (Temp-Datei → Rename).
- Kein Schreibzugriff auf FiveM- oder GTA-Ordner in dieser Version.

## Lizenzen der mitgelieferten Sounds

Alle 418 eingebauten Sounds werden zur Laufzeit **prozedural erzeugt** (`src/synth/synth.ts`). Es sind keine Aufnahmen oder fremden Soundpacks enthalten. Lizenz: *SP Tool Built-in License – royalty-free, procedurally generated*. Quelle jedes Sounds steht im Inspector (`procedural:v1 seed …`).

Das Logo (`src/assets/logo.svg`) wurde für SP Tool erstellt. Es werden keine 3D-Modelle mitgeliefert.

## Roadmap

Siehe `docs/ROADMAP.md`. Die Referenzanalyse liegt in `docs/REFERENCE_ANALYSIS.md`. Nächste Schritte: Waffen-Zuordnung bestätigen, dann Phase 3 (Projekte, Slots) und Phase 4 (Build/Backup/Install).

## Troubleshooting

| Problem | Lösung |
|---|---|
| FiveM „Not detected“ | Settings → FiveM → *Locate FiveM* und den Ordner wählen, der `FiveM.app` enthält. |
| Kein Ton | Lautstärke in Settings → Audio prüfen; Windows-Ausgabegerät prüfen. |
| WAV-Import schlägt fehl | Nur RIFF/WAVE (PCM oder Float). MP3/OGG zuerst konvertieren. |
| Sound mit Aufsatz klingt alt | Alle RPFs des Packs zusammen im Pack Analyzer öffnen und den Aufsatz-Sound (z. B. Schalldämpfer) mit ersetzen. |
| Waveforms fehlen / veraltet | Settings → Advanced → *Clear cache*. |
| „already bound to 1 computer“ | Lizenz ist an einen anderen PC gebunden. Discord-ID an einen Admin schicken → *Reset all* bei den Geräten. |
| „You have been offline too long“ | Einmal mit Internet starten; das Offline-Ticket gilt 72 h. |
| Fehleranalyse | Logs-Seite → *Export* oder *Open log folder*. |
