@echo off
setlocal
title Chusy - Instalar "Convertir a STEP"

rem Instala el ayudante "Convertir a .STEP" de Chusy en ESTE ordenador y para ESTE
rem usuario de Windows. No pide permisos de administrador: solo escribe en
rem %LOCALAPPDATA%\Chusy y en HKEY_CURRENT_USER\Software\Classes\chusy-step.

set "SRC=%~dp0convertir-step.ps1"
set "DEST=%LOCALAPPDATA%\Chusy"
set "KEY=HKCU\Software\Classes\chusy-step"

if not exist "%SRC%" goto :nosrc

if not exist "%DEST%" mkdir "%DEST%"
copy /y "%SRC%" "%DEST%\convertir-step.ps1" >nul
if errorlevel 1 goto :nocopy

reg add "%KEY%" /ve /t REG_SZ /d "URL:Chusy - Convertir a STEP" /f >nul
if errorlevel 1 goto :noreg
reg add "%KEY%" /v "URL Protocol" /t REG_SZ /d "" /f >nul
if errorlevel 1 goto :noreg
reg add "%KEY%\shell\open\command" /ve /t REG_SZ /d "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DEST%\convertir-step.ps1\" \"%%1\"" /f >nul
if errorlevel 1 goto :noreg

echo.
echo Listo. Ya puedes usar el boton "Convertir a .STEP en mi PC" de Chusy en este ordenador.
echo.
echo La primera vez, el navegador preguntara si permite abrir "Chusy - Convertir a STEP":
echo marca la casilla de recordar la eleccion y acepta.
echo.
echo Necesitas tener Autodesk Inventor instalado en este ordenador.
echo.
pause
exit /b 0

:nosrc
echo.
echo No encuentro convertir-step.ps1 junto a este archivo.
echo Descomprime la carpeta entera antes de ejecutar el instalador.
echo.
pause
exit /b 1

:nocopy
echo.
echo No se ha podido copiar el ayudante a %DEST%
echo.
pause
exit /b 1

:noreg
echo.
echo No se ha podido registrar el ayudante en Windows.
echo Si tu ordenador esta gestionado por la empresa, puede que lo bloquee una directiva: avisa a Informatica.
echo.
pause
exit /b 1
