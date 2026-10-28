@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SP Tool - Installer bauen

rem ── Lizenzserver (Werte aus /sptool-admin setup) ──
set SPTOOL_API_URL=
set SPTOOL_LICENSE_PUBKEY=

where node >nul 2>nul || ( echo Node.js fehlt: https://nodejs.org & pause & exit /b 1 )
where cargo >nul 2>nul || ( echo Rust fehlt: https://rustup.rs installieren, dazu Visual Studio Build Tools "Desktop development with C++". & start "" https://rustup.rs & pause & exit /b 1 )

if not exist node_modules ( call npm install || ( pause & exit /b 1 ) )
call npm run tauri:build
if errorlevel 1 ( echo FEHLER beim Build - Text oben an Claude schicken. & pause & exit /b 1 )

echo.
echo Fertig! Installer liegt hier:
dir /b src-tauri\target\release\bundle\nsis\*-setup.exe
explorer src-tauri\target\release\bundle\nsis
pause
