@echo off
setlocal
title Chusy - Quitar "Convertir a STEP"

rem Deshace Instalar-ConvertirStep.bat en ESTE ordenador y para ESTE usuario.

reg delete "HKCU\Software\Classes\chusy-step" /f >nul 2>&1
del /q "%LOCALAPPDATA%\Chusy\convertir-step.ps1" >nul 2>&1
rem rmdir sin /s solo borra la carpeta si esta vacia (puede contener tambien el ayudante de "Abrir Ubicacion")
rmdir "%LOCALAPPDATA%\Chusy" >nul 2>&1

echo.
echo Hecho. El ayudante "Convertir a STEP" se ha quitado de este ordenador.
echo.
pause
