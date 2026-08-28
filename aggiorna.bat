@echo off
title Aggiorna app online - Countries Been 3D
cd /d "%~dp0"
echo ============================================
echo  Pubblica la versione aggiornata su GitHub
echo ============================================
echo.
where git >nul 2>nul || ( echo ERRORE: git non trovato & pause & exit /b 1 )

git add index.html css js icons manifest.webmanifest sw.js >nul 2>&1
git status --short
echo.
echo  Inserisci una nota per questa versione (es. "nuovi colori"), poi premi INVIO:
set /p msg=
if "%msg%"=="" set msg=Aggiornamento app

git commit -m "%msg%" >nul 2>&1
git push origin main
if errorlevel 1 ( echo Push non riuscito & pause & exit /b 1 )

REM Forza GitHub Pages a ripubblicare i file nuovi
git pull origin main --rebase >nul 2>&1

echo.
echo  ✔ Pubblicato! Ora chiudi e riapri l'app sul telefono.
pause
