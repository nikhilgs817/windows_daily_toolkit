@echo off
setlocal DisableDelayedExpansion
title Windows Daily Toolkit Installer
set "psHost=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "psHost=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
"%psHost%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Install-WindowsDailyToolkit.ps1"
set "installExit=%ERRORLEVEL%"
echo.
if not "%installExit%"=="0" echo Installation did not finish. See the message above for the next step.
pause
exit /b %installExit%
