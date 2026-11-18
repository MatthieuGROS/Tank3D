@echo off
rem Lance le serveur Tank 3D (double-clic). Installe les dependances au premier lancement.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Premiere utilisation : installation des dependances...
  call npm install
  if errorlevel 1 (
    echo L'installation a echoue.
    pause
    exit /b 1
  )
)
node server/index.js
pause
