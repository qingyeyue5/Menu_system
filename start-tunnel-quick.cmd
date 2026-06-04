@echo off
cd /d "%~dp0"
title Cloudflare Quick Tunnel

if not exist "tools\cloudflared.exe" (
  echo Missing tools\cloudflared.exe
  echo Please download cloudflared.exe into the tools folder first.
  echo.
  pause
  exit /b 1
)

echo Starting Cloudflare Quick Tunnel...
echo.
echo Keep this window open. Copy the https://*.trycloudflare.com address and share it.
echo.
"tools\cloudflared.exe" tunnel --url http://localhost:3000
echo.
pause
