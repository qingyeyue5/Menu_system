@echo off
cd /d "%~dp0"
title Cloudflare Quick Tunnel

echo Starting Cloudflare Quick Tunnel...
echo.
echo Keep this window open. Copy the https://*.trycloudflare.com address and share it.
echo.

if exist "tools\cloudflared.exe" (
  "tools\cloudflared.exe" tunnel --url http://localhost:3000
  if not errorlevel 1 goto done
  echo.
  echo Local cloudflared.exe could not start. Trying system cloudflared...
  echo.
)

where cloudflared >nul 2>nul
if not errorlevel 1 (
  cloudflared tunnel --url http://localhost:3000
  goto done
)

echo Cloudflare Tunnel could not start.
echo.
echo If Windows says "Access denied", first run:
echo   fix-cloudflared-access.cmd
echo.
echo If it still fails, install the official system version:
echo   winget install --id Cloudflare.cloudflared
echo.
echo Then run this file again.

:done
echo.
pause
