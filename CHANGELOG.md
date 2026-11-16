# SP Tool – Changelog

So erkennt SP Tool die Einträge: Jede Version beginnt mit `## <Version>` (optional mit Datum dahinter),
jede Änderung ist eine Zeile mit `- `. Beim Bauen landet diese Datei in der App:
- „Update an alle verteilen“ (Admin) füllt „Was ist neu?“ automatisch mit dem Eintrag der Version.
- Nach einem Update zeigt die App einmal „Neu in SP Tool …“, und unter Einstellungen → Updates steht der ganze Verlauf.
Was ein Admin beim Verteilen selbst schreibt, ersetzt den Eintrag dieser Version bei allen Nutzern.

## 1.10.13 – 16.11.2026
- Soundpack erstellen: Jeder Abspiel-Knopf spielt deinen Sound jetzt so, wie er ins Spiel kommt – in Mono wie GTA, mit eigener Länge, Abtastrate und Lautstärke. Vorher lief in der Liste die Stereo-Datei, deshalb klang es im Spiel anders als im Creator
- „Alles anhören“ beim Nachladen spielt die Teile ebenfalls so, wie sie ins Spiel kommen
- Neu: Kill-Sound – eigener Schritt beim Soundpack erstellen, ein Sound für alle Waffen. Eigenen Sound reinziehen oder „Original behalten“
- Test im Spiel → Suchtest: Neues Ereignis „Kill-Sound“ (ein paar NPCs töten, die Pieptöne im Moment des Kills anklicken). Erst danach weiß SP Tool, wo GTA den Kill-Sound ablegt – bis dahin steht er auf „noch ohne Wirkung“
- Ein Pack, das nur den Kill-Sound ändert, verlangt keinen Pistol-Schuss und keinen Schalldämpfer-Sound mehr
- START-SPTOOL.cmd: Fehlt Node.js, lädt SP Tool einmalig eine portable Version von nodejs.org in den Ordner .node – keine Installation, keine Admin-Rechte

## 1.10.12 – 28.10.2026
- Pistol MK2: Der Schuss wurde in die Datei der Pistol .50 (ptl_50cal) geschrieben – behoben. Die MK2 nutzt vermutlich denselben Schuss wie die Pistol (ptl_pistol, noch nicht im Spiel bestätigt); „Original“ spielt ihn. Wählst du nur bei einer der beiden einen Sound, gilt er für beide; bei zwei verschiedenen behält die Pistol ihren, und der MK2-Sound wirkt nach dem Test im Spiel – keine Fehlermeldung
- Soundpack erstellen: „So klingt es im Spiel“ spielt deinen Sound genau so, wie er in die Spieldatei kommt
- Soundpack erstellen: Neuer Knopf „Bearbeiten“ öffnet deinen gewählten Schuss oder Reload direkt im Editor (kürzen, Lautstärke, Effekte …) – „Speichern und übernehmen“ legt einen neuen Sound an (z. B. „Turbo 37 bearbeitet“), setzt ihn ein und zeigt ihn oben in der Liste – das Original bleibt unverändert
- Behoben: Ein bearbeiteter Turbo-Sound klang wie das Original (die Änderungen gingen verloren); Turbo-Sounds werden außerdem mit ihrer eigenen Abtastrate geladen
- Schon vor dem Erstellen siehst du, wenn ein Sound nicht in die Vorlage passt (und um wie viele Sekunden) oder in Mono dünner wird
- Neuer Knopf „Alle importierten löschen“ leert die Liste deiner importierten Schüsse – Sounds aus gespeicherten Soundpacks bleiben dort erhalten
- Nachladen: Die alten Reload-Vorlagen sind raus – neu sind 4 freie Reload-Sounds aus dem Internet (CC0, gemeinfrei), oder du nimmst deinen eigenen
- „Ist ein Schuss“ / „Ist Nachladen“ lässt keine falsch einsortierten Sounds mehr zurück
- Hinweis beim Nachladen: Bei „In Teile schneiden“ wirkt im Spiel bisher nur „Magazin raus“
- Neu: Das Original-GTA-Soundpack als Vorlage – Original-Dateien (WEAPONS_PLAYER.rpf + RESIDENT.rpf) reinziehen oder in der Windows-App „Auf PC suchen“ klicken. Liegt das Original auf dem PC (GTA-V-Ordner, SP-Tool-Sicherung, Downloads, Desktop, Dokumente), ist es immer die Vorlage – kein anderes Soundpack ersetzt es mehr, auch „Vorlage mit mehr Platz“ nicht. Genommen werden nur Dateien, die Byte für Byte Rockstars Original sind – ein Custom-SP im GTA-Ordner wird erkannt und nicht untergemischt. „Original behalten“ klingt dann wie in GTA V. Den Schlüssel zum Öffnen liest SP Tool einmal aus deiner eigenen GTA5.exe (er bleibt nur auf deinem PC)
- Sounds kommen 1 : 1 ins Spiel: eigene Länge, eigene Abtastrate, eigene Lautstärke – SP Tool kürzt, normalisiert und rechnet nichts mehr selbst um. Passt ein Sound nicht in die Vorlage, bricht das Erstellen mit „… ist X s zu lang“ ab: kürze ihn selbst im Editor oder nimm eine Vorlage mit mehr Platz
- Vorlage mit Platz: Beim ersten Einrichten nimmt SP Tool unter deinen Soundpacks automatisch das mit dem meisten Platz für lange Sounds. Passt ein Sound trotzdem nicht, sucht „Vorlage mit mehr Platz suchen“ auf deinem PC nach einer besseren
- Import: WAV-Dateien werden genau so übernommen, wie sie sind (keine Umrechnung der Abtastrate, keine Stille am Anfang/Ende abgeschnitten)
- Neuer Knopf „Klingt im Spiel anders?“ nach dem Erstellen: kopiert einen Bericht (Vorlage, Länge und Rate vorher/im Spiel, gekürzt …) zum Weiterschicken
- Absturz-Erkennung in der Windows-App repariert: „Soundpack wiederhergestellt“ kommt nur noch nach einem echten Absturz, nicht nach normalem Schließen oder Updates
- „Original“ neben „So klingt es im Spiel“: spielt zum Vergleich den Sound, der jetzt an dieser Stelle in deiner Vorlage steckt
- Fertig-Bildschirm zeigt, aus welcher Vorlage die übrigen Sounds stammen
- INSTALLER-BAUEN.cmd und die GitHub-Release-Pipeline bauen jetzt die Windows-App (Go) statt der alten Tauri-Version
- Weniger Meldungen: Die Warnung „SP Tool wurde beim letzten Mal nicht richtig beendet“ kam fälschlich nach fast jedem Schließen und ist weg – ebenso überflüssige Bestätigungen (Reload übernommen, Slot gesetzt, Soundpack erstellt, „Danke – das hilft der Erkennung“ …)

## 1.10.11 – 25.10.2026
- Pistol .50: Der Schuss kommt jetzt ins Spiel (fest eingetragen – zusammen mit seiner zweiten Kopie in den Spieldateien)
- Nachladen kommt jetzt bei allen drei Pistolen ins Spiel, nicht mehr nur bei der Pistol
- MK2-Schuss fest eingetragen – „Noch ohne Wirkung“ verschwindet für Schuss und Nachladen ohne Test im Spiel

## 1.10.10 – 24.10.2026
- Suchtest findet jetzt alles, was unter „Bauen“ noch „nicht zugeordnet“ ist: Schuss, Schuss mit Schalldämpfer und Nachladen – für Pistol, MK2 und .50 gleichzeitig
- Nachladen: Die Pieptöne in der gehörten Reihenfolge anklicken – daraus wird Magazin raus → Magazin rein → Schlitten → Nachladen fertig
- Vorher auswählbar, was gesucht wird (z. B. nur Schüsse = weniger Runden)
- Jede Runde wird neu gemischt, dadurch weniger Runden

## 1.10.9 – 23.10.2026
- Neu: **Suchtest im Spiel** (Knopf „Test im Spiel“ oben bei „Soundpack erstellen“) – findet ohne Raten heraus, welche Sounds das Spiel wirklich für Pistol, MK2 und .50 abspielt
- Runde 1 lässt JEDEN Sound im Pack piepen: Klingt eine Pistole trotzdem normal, liest dein Spiel die Dateien nicht – SP Tool sagt dir dann die möglichen Gründe (Ordner, FiveM-mods-Ordner, FiveM offen, Server)
- Ab Runde 2 piept jede Runde anders (1–3×, hoch oder tief); nach ein paar Runden ist jeder Schuss genau gefunden und alte, falsche Zuordnungen werden ersetzt
- Der bisherige Test mit 3 Kandidaten bleibt als „Schnelltest“

## 1.10.8 – 20.10.2026
- „Soundpack erstellen“ → Nachladen: Das Feld für den ganzen Reload-Sound ist sofort da – vorher musste man erst „Ganzer Reload-Sound“ anklicken, sonst blieb der Reload unbemerkt beim Original

## 1.10.7 – 19.10.2026
- Das fertige Soundpack ziehst du selbst in deinen sfx-Ordner (Grand Theft Auto V › x64 › audio › sfx) – Anleitung, „Prüfen“ und der neue Knopf „sfx-Ordner öffnen“ zeigen jetzt dorthin statt auf den FiveM-mods-Ordner
- SP Tool installiert weiter nichts automatisch: Es wird nur die ZIP gespeichert, „Prüfen“ liest den sfx-Ordner nur

## 1.10.6 – 19.10.2026
- SP Tool meldet beim Start seine Version an den Turbo Bot: Mit **/sptool-version** in Discord siehst du, welche Version auf jedem deiner PCs läuft und welche die neueste ist

## 1.10.5 – 19.10.2026
- Neu: „Prüfen“ nach dem Erstellen – SP Tool schaut in deinen FiveM-mods-Ordner und sagt dir, ob dort wirklich dein neues Soundpack liegt oder noch das alte (nur lesen, es wird nichts verändert)
- Erkennt die häufigsten Gründe für „im Spiel ist immer noch das alte Pack“: alte Datei nicht ersetzt, neue Dateien in einem Unterordner von mods, Datei heißt „WEAPONS_PLAYER (2).rpf“, FiveM läuft noch
- Die ZIP enthält WEAPONS_PLAYER.rpf und RESIDENT.rpf jetzt direkt (kein Ordner mehr) – so landen sie nicht aus Versehen in einem Unterordner, wo FiveM sie nicht liest
- Fertig-Seite: genaue Anleitung in drei Schritten, Knopf „mods-Ordner öffnen“ und eine Zeile, welche Sounds im Spiel wirken

## 1.10.4 – 14.10.2026
- SP Tool installiert nichts mehr automatisch in FiveM: Jedes Soundpack kommt immer als eine ZIP-Datei in Downloads › SP Tool – egal ob aus „Soundpack erstellen“, „Bauen“, der Pack-Analyse oder dem Test im Spiel
- In der ZIP liegt ein Ordner mit WEAPONS_PLAYER.rpf und RESIDENT.rpf – entpacken und in den FiveM-mods-Ordner kopieren
- Der Menüpunkt „Installieren“ und alle „In FiveM installieren“-Knöpfe sind entfernt; alte Backups findest du weiter unter „Backups“

## 1.10.3 – 14.10.2026
- Lange Schüsse klingen im Spiel nicht mehr dumpf: Ist ein Schuss länger als der Platz im Spiel, bleibt er in voller Qualität und das Ende wird weich ausgeblendet (vorher wurde die Qualität bis auf Telefon-Niveau gesenkt)
- „Soundpack erstellen“ und „Bauen“ sagen jetzt, wenn ein Sound gekürzt oder in niedrigerer Qualität gespeichert wurde
- Schuss oder Nachladen wird zuverlässiger erkannt – Schüsse mit lautem Echo wurden manchmal als Nachladen einsortiert
- Dadurch sind 24 Turbo-Sounds, die eigentlich Schüsse sind, jetzt bei den Schüssen: 190 Schüsse und 42 Reloads (Turbo 1 – 190 Schüsse, Turbo 191 – 232 Reloads)
- „Soundpack befüllen“ startet bei der Pistol statt bei der MK2
- „Waffen“ und die Startseite zählen die Turbo-Sounds mit

## 1.10.2 – 14.10.2026
- Alle Turbo-Sounds sind jetzt der Reihe nach durchnummeriert: Turbo 1, Turbo 2, … bis Turbo 232 – zuerst die 20 empfohlenen Schüsse, dann alle anderen Schüsse, dann die Reloads

## 1.10.1 – 14.10.2026
- Jeder Turbo-Schuss hat jetzt einen gemessenen Stil (Heavy, Cracky, Punchy, Short, Echo, Realistic, Clean) – die Stil-Filter beim Soundpack-Erstellen zeigen nur noch Stile, die es wirklich gibt
- Neu: „★ Empfohlen“ – die 20 klarsten und lautesten Turbo-Schüsse stehen ganz oben, auch als eigener Bereich unter „Meine Sounds“
- Schüsse und Reloads sind getrennt nummeriert: Turbo 1 – 166 und Turbo Reload 1 – 66

## 1.10.0 – 13.10.2026
- Neu: 232 Turbo-Sounds (Turbo 1 – Turbo 232) sind in SP Tool eingebaut – 166 Schüsse und 66 ganze Reloads, unter „Meine Sounds“ → „Turbo“
- Turbo-Schüsse passen für Pistol, Pistol MK2 und Pistol .50; beim Soundpack-Erstellen unter „Oder einen deiner Sounds aus der Bibliothek nehmen“
- Turbo-Reloads gibt es beim Nachladen unter „Ganzer Reload-Sound“ → „Oder ein ganzer Reload von Turbo“
- Schüsse, die du in „Meine Sounds“ importierst, kannst du jetzt bei jeder Pistole verwenden

## 1.9.9 – 13.10.2026
- Schüsse und Reloads, die SP Tool noch nicht ins Spiel schreiben kann (z. B. Pistol .50), zeigen jetzt direkt den Knopf „Im Spiel testen“: einmal schießen, Pieptöne zählen – danach wirkt der Sound
- Fehlt in deiner Vorlage der Schuss einer Waffe, sagt SP Tool das jetzt klar, statt auf ein Update zu vertrösten
- Ein ganzer Reload-Sound ohne einzelne Klicks wird nicht mehr zu einem kurzen „Magazin rein“ abgeschnitten, sondern läuft als ganzer Reload
- Nach dem Test im Spiel stimmt der Hinweis, ob das Testpack noch installiert ist oder von Hand entfernt werden muss

## 1.9.8 – 13.10.2026
- Alle Presets entfernt: SP Tool bringt keine fertigen Sounds und keine Effekt-Presets mehr mit – du arbeitest nur noch mit deinen eigenen Sounds
- Die Seite „Presets“, das Preset-Menü und „Als Preset speichern“ im Editor sind weg
- „Soundpack in 1 Minute“ und „Pack automatisch erstellen“ sind weg, weil sie auf den mitgelieferten Sounds aufgebaut haben
- Soundpacks und bearbeitete Sounds, die du schon mit mitgelieferten Sounds gemacht hast, funktionieren weiter

## 1.9.7 – 12.10.2026
- Changelog: SP Tool erkennt die Änderungen jeder Version – das Update-Fenster zeigt alles, was seit deiner Version neu ist
- Nach einem Update zeigt SP Tool einmal „Neu in SP Tool …“, den ganzen Verlauf gibt es unter Einstellungen → Updates
- Admin: „Was ist neu?“ wird beim Verteilen automatisch aus dem Changelog ausgefüllt (du kannst es ändern oder ergänzen)
- Seitenleiste: Die Pfeile der aufklappbaren Bereiche zeigen jetzt richtig (zu = nach rechts, offen = nach unten)
- Handy/Web: Unten „Erstellen“ öffnet jetzt „Soundpack erstellen“, „Meine Packs“ deine Soundpacks
- Einstellungen am Handy ohne große Lücke, Uhrzeiten und Daten immer im deutschen Format
- Handy: Knöpfe und Reiter werden nicht mehr abgeschnitten (Sound erstellen, Sound bearbeiten, Bauen, Bibliothek, Admin)
- Kleinigkeiten: Schalldämpfer-Hinweis bei Waffen wird nicht mehr abgeschnitten, Backups/Cloud-Seite ohne gestreckte Kästen

## 1.9.6 – 12.10.2026
- Update an alle verteilen: Admins verteilen eine Version selbst mit „Was ist neu?“
- Nach dem Login zeigt SP Tool ein neues Update in einem Fenster – jetzt aktualisieren, später oder diese Version überspringen

## 1.9.5
- Drag & Drop: Sounds und Soundpacks einfach auf die Seite „Soundpack erstellen“ ziehen

## 1.9.4
- „Falsch erkannt“: Mit „Ist Nachladen“ / „Ist ein Schuss“ korrigierst du die Erkennung – das hilft, sie für alle zu verbessern
- Im Browser und am Handy kommt das fertige Soundpack als ZIP in deine Downloads

## 1.9.3
- Bessere Erkennung von Schuss und Nachlade-Sounds, auch bei Sounds aus anderen Soundpacks

## 1.9.2
- Ganzer Reload-Sound: Ein kompletter Nachlade-Sound (Audio oder aus einem anderen Soundpack) wird richtig ins Spiel geschrieben
- Ingame-Test für das Nachladen

## 1.9.1
- Behoben: Mit „Reload & Rest“ als Vorlage kam manchmal genau die Vorlage heraus, obwohl du Sounds geändert hattest

## 1.9.0
- SP Tool im Browser, auf dem Handy und Tablet – mit Lizenz-Login
