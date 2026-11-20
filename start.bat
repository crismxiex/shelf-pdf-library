@echo off
setlocal
title Shelf - PDF library
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :no_node

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto :old_node

if exist "node_modules\pdfjs-dist\package.json" if exist "node_modules\express\package.json" goto :run
echo Installing Shelf's dependencies - first run only, this takes a minute...
call npm install --omit=dev --no-fund --no-audit
if errorlevel 1 goto :install_failed

:run
node --disable-warning=ExperimentalWarning server\index.js --open
if errorlevel 1 pause
exit /b

:no_node
echo.
echo   Node.js is not installed, or Windows can't find it.
echo   1. Download the LTS version from https://nodejs.org
echo   2. Run the installer with the default options
echo   3. Double-click start.bat again
echo.
pause
exit /b 1

:old_node
echo.
echo   Your Node.js version is too old. Shelf needs Node.js 22.13 or newer.
echo   Install the current LTS version from https://nodejs.org and try again.
echo.
pause
exit /b 1

:install_failed
echo.
echo   Installing dependencies failed. Check your internet connection and try again.
echo.
pause
exit /b 1
