@echo off
cd /d "%~dp0"
title Cloudflare Quick Tunnel

echo Starting Cloudflare Quick Tunnel...
echo.
echo Keep this window open. Copy the https://*.trycloudflare.com address and share it.
echo.

where cloudflared >nul 2>nul
if not errorlevel 1 (
  cloudflared tunnel --url http://localhost:3000
  goto done
)

echo Cloudflare Tunnel could not start.
echo.
echo System cloudflared was not found.
echo.
echo If you already installed it, close this window and open it again.
echo If it still fails, restart Windows once so PATH can refresh.
echo.
echo Install command:
echo   winget install --id Cloudflare.cloudflared
echo.
echo Then run this file again.

:done
echo.
pause
