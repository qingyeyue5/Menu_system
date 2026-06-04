@echo off
cd /d "%~dp0"
title Menu System Fixed Tunnel Launcher

start "Menu System" cmd /k ""%~dp0start-menu.cmd""
timeout /t 2 /nobreak >nul
start "Cloudflare Fixed Tunnel" cmd /k ""%~dp0start-tunnel-fixed.cmd""

echo Opened two windows:
echo   1. Menu System
echo   2. Cloudflare Fixed Tunnel
echo.
echo Keep both windows open while using the remote menu.
echo.
pause
