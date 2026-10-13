@echo off
REM Wrapper pour le Planificateur de taches Windows.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0hourly-scrape.ps1"
exit /b %ERRORLEVEL%
