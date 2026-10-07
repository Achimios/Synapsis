@echo off
rem Drag a project folder onto this file: it gets __synapsis\, .synapsis\ and a Synapsis.vbs launcher.
rem Safe to run again: existing files are kept, only the generated launcher is refreshed.
chcp 65001 >nul
if "%~1"=="" (
  echo Drag a project folder onto Synapsis_init.bat
  echo   or run: Synapsis_init.bat "C:\path\to\project"
  pause
  exit /b 1
)
node "%~dp0core\cli.js" init "%~1"
pause
