@echo off
setlocal
cd /d "%~dp0"
if not exist ".local-data\europe-2025-26\browse.html" (
  echo Downloading the official EuroLeague and EuroCup reference data...
  node "scripts\euroleague-data.mjs"
  if errorlevel 1 (
    echo The download could not finish. Please share the error above in the chat.
    pause
    exit /b 1
  )
)
start "" "%~dp0.local-data\europe-2025-26\browse.html"
