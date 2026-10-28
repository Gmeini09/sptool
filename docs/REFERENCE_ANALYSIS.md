# Referenz-Analyse: WEAPONS_PLAYER_5_7.rpf und RESIDENT_5_6.rpf

Stand 01.10.2026. Alle Angaben unten sind **gemessen**, nicht angenommen. Jede Format-Aussage ist durch einen Test abgesichert (`tests/awc.test.ts`, `tests/rpf.test.ts`).

## 1. Archive (RPF7)

| | WEAPONS_PLAYER_5_7.rpf | RESIDENT_5_6.rpf |
|---|---|---|
| Größe | 34 693 632 B (33,1 MB) | 178 361 344 B (170,1 MB) |
| Magic | `RPF7` (`0x52504637`) | `RPF7` |
| Einträge | 24 (Root + 23 Dateien) | 20 (Root + 19 Dateien) |
| Namenstabelle | 400 B | 288 B |
| Verschlüsselung | **NG** (`0x0FEFFFFF`) | **NG** |
| Dateidaten | 512-Byte-ausgerichtet | 512-Byte-ausgerichtet |
| Lesbare AWC-Container | **23 von 23** (unverschlüsselt) | **4 von 19** |
| Rest | – | ~107 MB mit Entropie 8,0 → Originaldateien, NG-verschlüsselt |

Das Inhaltsverzeichnis (Dateinamen, Offsets, Größen) ist in beiden Archiven mit Rockstars NG-Verfahren verschlüsselt. Ohne Schlüssel sind Dateinamen nicht lesbar; die Dateidaten der ersetzten Audios liegen aber unverschlüsselt vor.

**Die 4 lesbaren Container in RESIDENT sind byte-identisch (SHA-1) mit WEAPONS_PLAYER #3, #16, #21 und #22.** Der Pack-Ersteller hat dieselben Dateien in beide Archive gelegt.

## 2. Container (AWC)

| Eigenschaft | Wert |
|---|---|
| Magic | `ADAT` |
| Version | 1 |
| Flags | `0xFF01` (Chunk-Index-Tabelle, Mono-Streams, unverschlüsselt) – in allen 23 Containern |
| Streams gesamt | **638** (größter Container #22: 516) |
| Codec | **0 = PCM 16-bit LE, mono – bei allen 638 Streams** |
| Sampleraten | 20 000 – 60 000 Hz (häufig 20 000, 32 000, 36 0xx, 44 100, 48 000) |
| Pegel | Audio auf 0 dBFS normalisiert; Lautstärke im Spiel über `headroom` (1/100 dB) |

### Header-Layout (verifiziert)

```
0   u32  magic "ADAT"
4   u16  version (1)
6   u16  flags (0xFF01)
8   i32  streamCount
12  u32  dataOffset (= Header-Ende)
16  u16[streamCount]  chunkIndex  – laufende Summe der Chunk-Anzahlen
..  u32[streamCount]  streamInfo  – Bits 0–28 Stream-ID, Bits 29–31 Chunk-Anzahl
..  u64[Σ chunks]     chunkInfo   – Bits 0–27 Offset, 28–55 Größe, 56–63 Typ
```

Streams sind aufsteigend nach ID sortiert.

### Chunk-Typen

| Typ | Name | Inhalt |
|---|---|---|
| `0xFA` | format | 24 Bytes, siehe unten |
| `0x55` | data | PCM16, Größe = samples × 2 |
| `0x36` | peak | u16 pro 4096-Sample-Block ab Block 1: `min(65535, maxAbs × 2)` |
| `0xBD` | markers | 16 Bytes, 3 Streams in #22; werden unverändert übernommen |

### Format-Chunk (24 Bytes)

```
0  u32 samples        8  u16 sampleRate     12 u16 loopBegin   16 u16 playEnd
4  i32 loopPoint (-1) 10 i16 headroom       14 u16 loopEnd     18 u8  playBegin
19 u8  codec (0)      20 u16 peak0 = Peak Block 0 × 2 (0 = nicht gesetzt)
22 u16 reserviert (immer 0)
```

`peak0` bestätigt: bei 329 Streams exakt `min(65535, maxAbs(Block 0) × 2)`, bei 302 Streams 0, bei 7 veraltet.

### Datei-Layout (verifiziert)

Header → alle Format-Chunks (Stream-Reihenfolge) → alle Peak-Chunks → alle Marker-Chunks → Daten-Chunks, jeweils auf 16 Byte ausgerichtet, Lücken mit Nullen.

**Round-Trip-Test: Parsen → Schreiben ergibt für alle 23 Container und 638 Streams eine byte-identische Datei.**

### Auffälligkeit

Bei 61 Streams passen die gespeicherten Peaks nicht zum Audio (veraltet). Das deutet darauf hin, dass das Werkzeug des Pack-Erstellers beim Ersetzen die Peaks nicht neu berechnet hat. SP Tool berechnet sie immer neu.

## 3. Stream-Namen

Stream-IDs sind die unteren 29 Bit des Jenkins-Hash (`joaat`) des Namens. Bestätigt wurden nur Namen, die eine zusammenhängende Serie bilden (Einzeltreffer können Zufall sein und werden verworfen):

| Container | bestätigte Namen |
|---|---|
| #22 | `PTL_PISTOL_MID_1/2`, `PTL_PISTOL_FAR_1/2` (Distanz-Layer Pistole) |
| #22 | `PISTOL_DRY_FIRE_01`, `SMG_DRY_FIRE_01`, `RIFLE_DRY_FIRE_01`, `SHOTGUN_DRY_FIRE_01` |
| #22 | `PISTOL_IMPACT_01/02/04/05/06/08/09/11`, `SMG_IMPACT_01/03/04/06/08/12/14/15` |

Container #0–#21 folgen einem anderen Namensschema, das nicht verlässlich ableitbar ist. **Welche Container/Streams zu Pistol, Pistol MK2 und Pistol .50 gehören, ist damit noch nicht belegt.**

## 4. Was daraus folgt

**Machbar und getestet (ohne Rockstar-Schlüssel):**
- Lesen, Anhören und Extrahieren aller unverschlüsselten Streams (Pack Analyzer).
- Ersetzen von Streams **bei gleicher Länge**: neues Audio wird auf Samplerate und Sample-Anzahl des Originals gebracht, Headroom/Loop/Marker bleiben, Peaks werden neu berechnet. Die AWC bleibt byte-gleich lang, das verschlüsselte Inhaltsverzeichnis bleibt gültig. Getestet: Ausgabe gleich groß, kein Byte außerhalb des Containers verändert.

**Offen, bevor Build/Install freigeschaltet werden:**
1. Zuordnung Container/Stream → Waffe und Slot (Fire, Suppressed, Reload, …).
2. Installationsort und -art in FiveM.
3. Bedeutung der Suffixe `_5_7` / `_5_6` (Teil des Dateinamens beim Installieren?).
4. Optional: Inhaltsverzeichnis entschlüsseln. Das ginge nur mit Schlüsseln aus der lokalen `GTA5.exe` des Nutzers – wird nur mit ausdrücklicher Zustimmung umgesetzt und nie mit SP Tool ausgeliefert.

Die Original-Archive wurden nur gelesen; Fixtures liegen außerhalb des Repos und werden nicht mitgeliefert.

## 5. Nachtrag: Container in mehreren Archiven

Gruppiert man die Container beider Archive nach Inhalt, ergeben sich **23 eindeutige Container, davon 4 in beiden Archiven** (WEAPONS_PLAYER #3, #16, #21, #22). SP Tool behandelt solche Container als Einheit: eine Ersetzung wird in jede Kopie geschrieben (`src/formats/pack.ts`, Test `tests/pack.test.ts`: beide Archive gleich groß, alle Kopien byte-identisch, Originale unverändert). Damit kann das Spiel nicht auf eine alte Kopie zurückfallen – laut Nutzer genau die Ursache für Fehler bei Aufsätzen.

## 6. Nachtrag 02.10.2026: 12 Archive von 5 Erstellern

Analysiert: 6× WEAPONS_PLAYER.rpf und 6× RESIDENT.rpf (Referenzpack + 5 weitere Packs), zusammen ~10 000 lesbare Streams.

- Gruppiert nach Stream-IDs ergeben sich **29 verschiedene Original-Spieldateien** (Katalog `src/formats/catalogData.ts`, Schlüssel F01–F29). Die Stream-ID-Mengen sind über alle Packs **identisch** – jede Datei wird in jedem Pack eindeutig wiedererkannt (Test `tests/build.test.ts`: alle Container aller Testpacks erkannt, keine ID in zwei Dateien).
- F01 (516 Streams) liegt in fast allen Packs in WEAPONS_PLAYER **und** RESIDENT; beide Referenz-Hashes aus der Community (`0x18595065`, `0x1E0651DE`) gehören zu F01.
- **Stream-Namen lassen sich nicht zuverlässig ableiten.** Eine Wörterbuchsuche (388 Mio. Kandidaten) liefert scheinbare Serien wie `RICO_V1_RICOCHET_02…09`, die Unsinn sind: `joaat` mischt die letzten Zeichen schwach, sodass falsche Stämme mit passender Endung ganze Serien erzeugen. Auch OpenIV zeigt nur Hash-Namen.
- Folge: Die Zuordnung Stream → Waffe/Slot wird **einmal per Gehör** im Pack Analyzer erstellt (Developer/Admin), exportiert (`sptool-mapping.json`) und mit der App ausgeliefert (`weapon_profiles/mapping.json`). Build baut nur zugeordnete Slots, alles andere bleibt original – es wird nie geraten.
- Installationsziel: `FiveM.app\mods\<Archivname>.rpf`; Namen wie `WEAPONS_PLAYER_4.rpf` / `RESIDENT_5_6.rpf` werden auf den Originalnamen normalisiert.

## 7. Nachtrag 03.10.2026: Klangcharakter der Community-Packs (nur Messwerte)

Ziel: die eingebauten SP-Tool-Sounds „in die Richtung“ der Packs bringen, **ohne** Audio daraus zu übernehmen
(Projektvorgabe §39: keine Sounds aus fremden Soundpacks in der Library). Verwendet werden ausschließlich Zahlen.

Methode (`scripts/analyze-refs.ts`): Streams, die sich zwischen den 6 WEAPONS_PLAYER-Archiven unterscheiden, sind die von den Erstellern
ersetzten Waffensounds (1 893 von 2 772). Pro Stream: Energieanteil in 6 Bändern (erste 400 ms), Attack, Abklingzeit auf −20/−40 dB,
Crest-Faktor, Echo-Buckel 80–400 ms. Einteilung nach Hüllkurve in Schuss-Kerne, Nachhall/Echo und Reload/Mechanik. Medianwerte:

| | Länge | −20 dB nach | sub <80 | low 80–250 | lowmid 250–800 | mid 0,8–2,5k | presence 2,5–6k | air >6k |
|---|---|---|---|---|---|---|---|---|
| Schuss-Kern (n=150) | 0,15 s | 64 ms | 5 % | 19 % | 28 % | 19 % | 16 % | 13 % |
| Nachhall/Echo (n=211) | 1,34 s | 310 ms | 21 % | 24 % | 27 % | 15 % | 8 % | 4 % |
| Reload/Mechanik (n=801) | 0,14 s | 18 ms | 9 % | 8 % | 18 % | 44 % | 13 % | 8 % |

Die Packs unterscheiden sich deutlich: eines ist sehr dicht/komprimiert (Crest ~9 dB, lowmid 36 %), zwei sind hell/„cracky“
(presence + air > 50 %), die übrigen ausgewogen. Daraus abgeleitet: `TONE_PROFILES` in `src/synth/synth.ts`
(`balanced`, `dense`, `bright`, `reload`) und der automatische Klangabgleich `matchTone` (`src/dsp/spectrum.ts`).
Neue Library-Stile *Balanced*, *Dense*, *Bright*; alle übrigen Engine-2-Schüsse werden leicht (50 %) Richtung *balanced* gezogen,
Reload-/Mechanik-Sounds zu 90 % Richtung *reload*.

## 8. Nachtrag 05.10.2026: deutsche Gangwar-/„Gambo“-Packs (nur Messwerte)

Weitere 5 WEAPONS_PLAYER- und 9 RESIDENT-Archive vom Nutzer, zusammen mit den 6 bisherigen ausgewertet (`scripts/analyze-refs.ts`).
Mehrere der neuen Archive sind Versionen schon bekannter Packs (gleiche Messwerte). Medianwerte der ersetzten Schuss-Kerne je Pack-Familie:

| Familie | Dauer | −20 dB nach | −40 dB nach | Crest | sub | low | lowmid | mid | presence | air |
|---|---|---|---|---|---|---|---|---|---|---|
| A (3 Archive) | 0,2 s | 62–66 ms | 170 ms | 16 dB | 1 % | 20 % | 36 % | 20 % | 11–13 % | 3–4 % |
| B (dicht, 2 Archive) | 0,2 s | 104 ms | 198 ms | 8,7 dB | 1 % | 15 % | 36 % | 20 % | 21 % | 7 % |
| C (2 Archive) | 0,2 s | 30–36 ms | 156 ms | 16,8 dB | 1 % | 25–31 % | 27–33 % | 20 % | 9–10 % | 2–3 % |

Daraus: Tonprofil `gambo` (sub 2, low 20, lowmid 36, mid 20, presence 16, air 6), Library-Stile *Gambo*, *Gangwar*, *Hood*
(kurz, −20 dB nach ~100 ms, Crest 8–11 dB) und die Presets *Gambo* / *Gambo Echo*. Kein Audio aus den Packs wird verwendet oder gespeichert.
