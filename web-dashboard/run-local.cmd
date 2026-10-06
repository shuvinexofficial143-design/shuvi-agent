@echo off
setlocal
cd /d "%~dp0"

echo.
echo Shuvi Web Dashboard - Local Dev
echo --------------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not available in PATH.
  exit /b 1
)

if not exist node_modules (
  echo Installing dashboard dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo.
echo Starting Shuvi dashboard on localhost...
echo Press Ctrl+C to stop.
echo.
call npm run dev -- --host 127.0.0.1
