# Deployment

## Release bauen (lokal)

```powershell
npm install
npm test
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

Installer: `src-tauri/target/release/bundle/nsis/*-setup.exe` (NSIS, Installation pro Benutzer, Startmenü + Desktop-Verknüpfung, „SP Tool starten“ am Ende).

## Lizenzserver

Siehe `server/README.md`: Discord-App anlegen, `npm run server:keys`, Umgebungsvariablen setzen, hinter HTTPS betreiben. Release-Builds der App brauchen dann:

```powershell
$env:SPTOOL_API_URL="https://license.example.com"
$env:SPTOOL_LICENSE_PUBKEY="<Public Key>"
npm run tauri:build
```

In CI als Repository-Secrets `SPTOOL_API_URL` und `SPTOOL_LICENSE_PUBKEY` hinterlegen. Der private Schlüssel bleibt ausschließlich auf dem Server.

## CI

`.github/workflows/release.yml` läuft bei Tags `v*`: Typecheck → Tests → Rust-Tests → Tauri-Build → `SPTool_Setup.exe` + SHA-256 als Artefakt.

## Code-Signing

Ohne Signatur zeigt Windows SmartScreen eine Warnung. Mit einem Code-Signing-Zertifikat:

1. Zertifikat-Thumbprint in `src-tauri/tauri.conf.json` unter `bundle.windows.certificateThumbprint` eintragen, `digestAlgorithm: "sha256"`, `timestampUrl` des Anbieters.
2. In CI das Zertifikat als Secret importieren.

## Auto-Updater (Phase 11)

Geplant mit `tauri-plugin-updater`: signierte Update-Manifeste (Ed25519), HTTPS, Hash-Prüfung, Kanäle stable/beta, Rollback bei Fehlschlag.
