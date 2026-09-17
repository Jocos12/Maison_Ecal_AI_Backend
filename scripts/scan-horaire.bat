@echo off
REM Alias du declencheur cron Windows (scan-horaire.bat).
REM Fire-and-forget via hourly-scrape.ps1 (HTTP 202, --max-time 15).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0hourly-scrape.ps1"
exit /b %ERRORLEVEL%
