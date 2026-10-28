@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SP Tool - exe bauen

rem ── Lizenzserver (beide Werte sind öffentlich, sie stehen in jeder SPTool.exe) ──
set SPTOOL_API_URL=https://bot-production-d58c.up.railway.app
set SPTOOL_LICENSE_PUBKEY=5iVZDgeKEizromOavt_4watv_TymaL7np_99Lys_gEQ

rem Go und go-winres auch aus den Standard-Ordnern (portable Installation)
set "PATH=%USERPROFILE%\sdk\go\bin;%USERPROFILE%\go\bin;%PATH%"

where node >nul 2>nul || ( echo Node.js fehlt: https://nodejs.org & start "" https://nodejs.org & pause & exit /b 1 )
where go >nul 2>nul || ( echo Go fehlt: https://go.dev/dl & start "" https://go.dev/dl & pause & exit /b 1 )
where go-winres >nul 2>nul || ( echo go-winres wird installiert... & go install github.com/tc-hib/go-winres@v0.3.3 || ( pause & exit /b 1 ) )

if not exist node_modules ( call npm install || ( pause & exit /b 1 ) )
call npm test
if errorlevel 1 ( echo FEHLER: Tests fehlgeschlagen - Text oben an Claude schicken. & pause & exit /b 1 )
node scripts\build-windows.mjs
if errorlevel 1 ( echo FEHLER beim Build - Text oben an Claude schicken. & pause & exit /b 1 )

echo.
echo Fertig! SPTool.exe und Turbo_Designs_SP_Tool.zip liegen hier:
dir /b release\SPTool.exe release\Turbo_Designs_SP_Tool.zip
explorer release
pause
