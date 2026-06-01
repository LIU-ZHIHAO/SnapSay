@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "package.json" (
  echo SnapSay project files were not found in "%ROOT%".
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing SnapSay dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting SnapSay main development build...
call npm run electron
if errorlevel 1 (
  echo SnapSay failed to start.
  pause
  exit /b 1
)
