# Soundpack-Engine (C#)

Baut in der Windows-App (SPTool.exe) die Soundpacks: ermittelt aus den GTA-Spieldaten (game.dat151 / sounds.dat54),
welche AWC-Einträge zu Schuss, Schalldämpfer und Nachladen gehören, ersetzt sie in Kopien der Original-RPFs aus dem
GTA-Ordner (NG-Verschlüsselung wie Community-Packs), liest das Ergebnis zurück und prüft es.

- `src/GtaSoundpack.Core` – Logik (Audio, AWC, RPF, Analyse, Build, Prüfung)
- `src/SpEngine` – `spengine.exe plan|build <request.json>`, aufgerufen von `windows/engine_api.go` (`/native/sp/*`)
- `tests/` – Unit-Tests (`dotnet test SpEngine.sln`)
- `external/CodeWalker` – Git-Submodule (RPF/AWC/REL-Zugriff, Keys aus der lokalen GTA5.exe)

`node scripts/build-windows.mjs` veröffentlicht die Engine und bettet sie als `windows/engine/spengine.zip` in SPTool.exe ein.
Voraussetzungen: .NET 8 SDK, `git submodule update --init` (bei langen Pfaden `git config core.longpaths true`).
