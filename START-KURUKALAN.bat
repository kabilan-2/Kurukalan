@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install Node.js LTS, then reopen this file.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
if not exist node_modules\pg\package.json (
  echo Installing project dependencies...
  call npm ci --omit=dev
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection.
    pause
    exit /b 1
  )
)
node scripts/start-local.js
if errorlevel 1 pause
