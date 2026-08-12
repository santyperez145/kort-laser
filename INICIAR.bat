@echo off
title KORT - Sistema de corte laser y plegado CNC
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No se encontro Node.js en esta computadora.
  echo   Descargalo gratis desde https://nodejs.org  ^(version LTS^)
  echo   Instalalo y volve a hacer doble clic en este archivo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\node-sqlite3-wasm" (
  echo.
  echo   Primera vez: instalando las librerias. Esto tarda un minuto
  echo   y solo pasa una vez.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Fallo la instalacion. Revisa que tengas internet la primera vez.
    echo.
    pause
    exit /b 1
  )
)

REM La interfaz se compila con Vite. Se arma sola si falta, asi el doble
REM clic sigue alcanzando para arrancar. Para rehacerla despues de cambiar
REM el codigo: npm run build
if not exist "web-dist\index.html" (
  echo.
  echo   Preparando la interfaz. Tarda unos segundos.
  echo.
  call npm run build
  if errorlevel 1 (
    echo.
    echo   Fallo la compilacion de la interfaz. El detalle esta arriba.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   Iniciando KORT...
echo.

start "" http://localhost:4321
node server.js

echo.
echo   El sistema se cerro. Si fue por un error, el detalle esta arriba.
pause
