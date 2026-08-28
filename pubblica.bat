@echo off
title Pubblica app - Countries Been 3D
cd /d "%~dp0"
echo ============================================
echo  Pubblica Countries Been 3D su Internet
echo ============================================
echo.
echo  Hai bisogno di Node.js installato.
if not exist "node.exe" (
  where node >nul 2>nul || ( echo.
  echo  ERRORE: Node.js non trovato. Installalo da nodejs.org
  echo  oppure dimmelo e te lo preparo io.
  pause
  exit /b 1 )
)

echo.
echo  Attendo che tu faccia il login una sola volta...
echo  (si apre il browser: confermi e torni qui)
echo.
call npx netlify-cli login
if errorlevel 1 ( echo Login non riuscito & pause & exit /b 1 )

echo.
echo  Associo la cartella al sito esistente...
call npx netlify-cli link --name glittering-syrniki-e33632
if errorlevel 1 ( echo Link non riuscito & pause & exit /b 1 )

echo.
echo  Carico i file sul sito (pochi secondi)...
call npx netlify-cli deploy --dir="%~dp0" --prod
if errorlevel 1 ( echo Deploy fallito & pause & exit /b 1 )

echo.
echo  ✔ Pubblicato! Chiudi e riapri l'app sul telefono.
pause
