@echo off
cd /d "%~dp0"
title Cloudflare Fixed Tunnel

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared was not found.
  echo Install it first:
  echo   winget install --id Cloudflare.cloudflared
  echo.
  pause
  exit /b 1
)

if not exist "cloudflared-fixed.yml" (
  echo cloudflared-fixed.yml was not found.
  echo Run setup-fixed-tunnel.cmd first.
  echo.
  pause
  exit /b 1
)

echo Starting fixed Cloudflare Tunnel...
echo Keep this window open.
echo.
cloudflared tunnel --config "%~dp0cloudflared-fixed.yml" run
echo.
pause
