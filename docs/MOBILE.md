# SP Tool auf Handy und Tablet

Die Oberfläche passt sich ab einer Breite von 760 px an: Bottom-Navigation (Home, Library, Generate, Editor, More), Filter und Sound-Details als Bottom-Sheets, Touch-Waveform mit fingergroßen Trim-Griffen, größere Bedienelemente, Safe-Areas für Notch und Home-Indicator.

## Web-App (live)

- Adresse: **https://sp-tool-web-production.up.railway.app/** (Railway-Service „SP Tool Web“, Branch `sptool-web` im Bot-Repo).
- Update: `SPTOOL_API_URL=https://bot-production-d58c.up.railway.app SPTOOL_LICENSE_PUBKEY=… npm run build`, `dist/` nach `public/` im Branch `sptool-web` kopieren, pushen – Railway deployt automatisch.
- iPhone: in Safari öffnen → Teilen → *Zum Home-Bildschirm*. Android: Chrome → *App installieren*. (Eine eigene Android-App gibt es nicht mehr.)
- Anmeldung mit Discord wie am PC. Handy/Browser haben einen eigenen Geräteplatz (einer pro Lizenz, ein neues ersetzt das alte) und zählen nicht gegen das PC-Limit.
- Fertige Soundpacks kommen als **eine ZIP** (`<Name>.zip` mit Ordner, darin WEAPONS_PLAYER.rpf + RESIDENT.rpf) – am PC entpacken und in den FiveM-mods-Ordner kopieren.


## iPhone als native App

Nicht enthalten: dafür braucht es macOS/Xcode und ein Apple-Entwicklerkonto. Auf dem iPhone die Web-App über *Zum Home-Bildschirm* nutzen.

## Native App (Tauri Mobile)

Der Rust-Kern hat einen Mobile-Einstiegspunkt (`#[cfg_attr(mobile, tauri::mobile_entry_point)]`).

```bash
npm run tauri android init   # benötigt Android Studio + NDK
npm run tauri android dev
npm run tauri ios init       # nur auf macOS mit Xcode
```

## Was am Handy geht – und was nicht

| Funktion | Handy |
|---|---|
| Library, Anhören, Favoriten, Collections | ✅ |
| Audio Editor, Presets, Generator | ✅ |
| WAV-Import/-Export | ✅ (Dateiauswahl/Download des Systems) |
| Pack Analyzer, Streams ersetzen, gepatchte RPFs exportieren | ✅ (große Archive brauchen genug RAM) |
| FiveM/GTA-Erkennung, Installation | ❌ nur Windows-App – FiveM läuft nur auf dem PC |

Daten (eigene Sounds, Favoriten, Einstellungen) liegen lokal im jeweiligen Gerät/Browser. Synchronisation zwischen PC und Handy kommt mit der Cloud (Phase 9).
