@echo off
cd /d "%~dp0"
title Reset Menu Passwords Only

node tools\reset-passwords-only.js
echo.
pause
