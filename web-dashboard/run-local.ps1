$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Shuvi Web Dashboard - Local Dev" -ForegroundColor Cyan
Write-Host "--------------------------------" -ForegroundColor DarkGray

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is not installed or not available in PATH." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dashboard dependencies..." -ForegroundColor Yellow
  npm install
}

Write-Host ""
Write-Host "Starting Shuvi dashboard on localhost..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

npm run dev -- --host 127.0.0.1
