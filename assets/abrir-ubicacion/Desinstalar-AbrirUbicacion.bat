@echo off
setlocal
title Chusy - Quitar "Abrir Ubicacion"

rem Deshace Instalar-AbrirUbicacion.bat en ESTE ordenador y para ESTE usuario.

reg delete "HKCU\Software\Classes\chusy-open" /f >nul 2>&1
del /q "%LOCALAPPDATA%\Chusy\abrir-ubicacion.ps1" >nul 2>&1
rem rmdir sin /s solo borra la carpeta si esta vacia
rmdir "%LOCALAPPDATA%\Chusy" >nul 2>&1

echo.
echo Hecho. El ayudante "Abrir Ubicacion" se ha quitado de este ordenador.
echo.
pause
