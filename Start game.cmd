@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24.14 or newer is needed to run this development version.
  echo Install Node.js, then open this file again.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing the game dependencies...
  call npm.cmd ci
  if errorlevel 1 (
    echo Installation did not finish. Share the error above in the chat.
    pause
    exit /b 1
  )
)
echo Starting Courtside. Keep this window open while playing.
echo Close the window or press Ctrl+C to stop the local game server.
call npm.cmd run dev -- --open
if errorlevel 1 pause
