# Referenz-Soundpack – was ich brauche und was ich daraus ermittle

Build, Install und Backups bleiben gesperrt, bis ein **funktionierender** Soundpack analysiert wurde (Spezifikation §165/§166). So wird nie ein Build erzeugt, der FiveM-Dateien beschädigen könnte.

## Bitte bereitstellen

1. Einen Soundpack, der bei dir in FiveM nachweislich funktioniert und Pistol, Pistol MK2 und Pistol .50 ändert (inkl. Suppressor und Reload, falls enthalten) – als Archiv in genau der Struktur, wie er installiert wird.
2. Wo genau du ihn installierst (z. B. Pfad unterhalb von `FiveM.app`).
3. Optional: Die Original-Dateien, die dadurch ersetzt werden, damit ein sauberer „Restore Original“ möglich ist.

Nur Dateien schicken, die du teilen darfst.

## Was die Analyse ermittelt

| Punkt | Wofür |
|---|---|
| Ordner- und Dateistruktur, Install-Ziel | Install-Mapping im Waffenprofil |
| Containerformat(e) und deren Header | Lese- und Schreiblogik |
| Audio-Einträge, Namen/Hashes, Offsets, Größen | Slot-Zuordnung pro Waffe |
| Codec/Kompression, Samplerate, Kanäle | Konvertierung im Build |
| Metadaten-/Konfigurationsdateien | Was beim Build mitgeschrieben werden muss |
| Mapping Pistol / MK2 / .50 → Fire, Suppressed, Reload, … | `audioContainer` und `installMapping` in `weapon_profiles/*.json` |

## Danach

1. Analyse-Ergebnis als Dokument in `docs/`.
2. Reader für das Format + Round-Trip-Test (lesen → unverändert schreiben → byte-identisch).
3. Erst dann Writer, Build-Pipeline, Backup und atomarer Install (Phase 4).
