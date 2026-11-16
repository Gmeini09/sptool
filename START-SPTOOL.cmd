@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SP Tool

rem ── Lizenzserver (Werte aus /sptool-admin setup eintragen, leer = lokales Profil ohne Login) ──
set SPTOOL_API_URL=
set SPTOOL_LICENSE_PUBKEY=

rem Node.js: installiert, sonst portabel in .node\ (wird bei Bedarf einmalig von nodejs.org geladen)
where node >nul 2>nul
if errorlevel 1 (
  if not exist "%~dp0.node\node.exe" (
    echo Node.js fehlt - lade portable Version von nodejs.org ^(einmalig, ca. 30 MB^)...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $v=((Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1).version; $z=Join-Path $env:TEMP ('node-'+$v+'.zip'); Invoke-WebRequest ('https://nodejs.org/dist/'+$v+'/node-'+$v+'-win-x64.zip') -OutFile $z; $t=Join-Path $env:TEMP ('node-'+$v); Expand-Archive $z -DestinationPath $t -Force; Move-Item (Join-Path $t ('node-'+$v+'-win-x64')) '%~dp0.node'; Remove-Item $z"
    if not exist "%~dp0.node\node.exe" (
      echo Node.js konnte nicht geladen werden. Bitte Node.js 22 von https://nodejs.org installieren.
      start "" https://nodejs.org
      pause
      exit /b 1
    )
  )
  set "PATH=%~dp0.node;%PATH%"
)

if not exist node_modules (
  echo Erster Start: installiere Abhaengigkeiten ^(einmalig, 1-2 Minuten^)...
  call npm install
  if errorlevel 1 ( echo FEHLER bei npm install. & pause & exit /b 1 )
  rem Desktop-Verknuepfung "SP Tool" anlegen (startet minimiert)
  powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\SP Tool.lnk');$s.TargetPath='%~f0';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"
  echo Verknuepfung "SP Tool" auf dem Desktop erstellt.
)

rem Ab jetzt im Hintergrund (minimiert) weiterlaufen
if not "%~1"=="min" ( start "SP Tool" /min "%~f0" min & exit /b )

call node scripts/build.mjs >nul
if errorlevel 1 ( echo FEHLER beim Bauen. & node scripts/build.mjs & pause & exit /b 1 )

node scripts/serve.mjs
