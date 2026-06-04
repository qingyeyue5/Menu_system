@echo off
cd /d "%~dp0"
title Fix Cloudflare Tool Access

if not exist "tools\cloudflared.exe" (
  echo tools\cloudflared.exe was not found.
  echo.
  pause
  exit /b 1
)

echo Fixing access for tools\cloudflared.exe...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '%~dp0tools\cloudflared.exe'"
icacls "%~dp0tools\cloudflared.exe" /grant "%USERNAME%:RX"

echo.
echo Done. Now run:
echo   start-all-quick-tunnel.cmd
echo.
pause
