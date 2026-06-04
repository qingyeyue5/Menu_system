@echo off
cd /d "%~dp0"
title Setup Fixed Cloudflare Tunnel

set "CLOUDFLARED=cloudflared"
where cloudflared >nul 2>nul
if errorlevel 1 (
  for /f "delims=" %%i in ('dir /b /s "%LOCALAPPDATA%\Microsoft\WinGet\Packages\Cloudflare.cloudflared_*\cloudflared.exe" 2^>nul') do (
    set "CLOUDFLARED=%%i"
    goto found_cloudflared
  )
  echo cloudflared was not found.
  echo Install it first:
  echo   winget install --id Cloudflare.cloudflared
  echo.
  pause
  exit /b 1
)
:found_cloudflared

echo This setup requires a domain that is already added to Cloudflare.
echo Example fixed hostname: menu.example.com
echo.
set /p FIXED_HOST=Fixed hostname:
if "%FIXED_HOST%"=="" (
  echo Hostname is required.
  pause
  exit /b 1
)

set /p TUNNEL_NAME=Tunnel name [menu-system]:
if "%TUNNEL_NAME%"=="" set TUNNEL_NAME=menu-system

echo.
echo A browser login may open. Log in to Cloudflare and choose your domain.
"%CLOUDFLARED%" tunnel login
if errorlevel 1 goto failed

set "TUNNEL_ID="
for /f "tokens=1" %%i in ('"%CLOUDFLARED%" tunnel list ^| findstr /i "%TUNNEL_NAME%"') do (
  set TUNNEL_ID=%%i
  goto got_tunnel
)

"%CLOUDFLARED%" tunnel create "%TUNNEL_NAME%"
if errorlevel 1 goto failed
for /f "tokens=1" %%i in ('"%CLOUDFLARED%" tunnel list ^| findstr /i "%TUNNEL_NAME%"') do (
  set TUNNEL_ID=%%i
  goto got_tunnel
)

:got_tunnel
if "%TUNNEL_ID%"=="" (
  echo Could not find the tunnel id.
  pause
  exit /b 1
)

"%CLOUDFLARED%" tunnel route dns "%TUNNEL_NAME%" "%FIXED_HOST%"
if errorlevel 1 goto failed

(
  echo tunnel: %TUNNEL_ID%
  echo credentials-file: %USERPROFILE%\.cloudflared\%TUNNEL_ID%.json
  echo ingress:
  echo   - hostname: %FIXED_HOST%
  echo     service: http://localhost:3000
  echo   - service: http_status:404
) > cloudflared-fixed.yml

echo.
echo Fixed tunnel is ready:
echo   https://%FIXED_HOST%
echo.
echo Next time run:
echo   start-all-fixed-tunnel.cmd
echo.
pause
exit /b 0

:failed
echo.
echo Setup failed. Check the message above, then run this file again.
echo.
pause
exit /b 1
