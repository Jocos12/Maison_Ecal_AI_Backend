#Requires -RunAsAdministrator
# Installation unique : PM2 + relance auto après crash + au logon Windows.
# Usage (PowerShell Admin, depuis backend/) :
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-pm2-windows.ps1

$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
Set-Location $backendRoot

$node = (Get-Command node -ErrorAction Stop).Source
$npm = (Get-Command npm -ErrorAction Stop).Source
$pm2Cli = Join-Path $backendRoot 'node_modules\pm2\bin\pm2'

Write-Host "Backend: $backendRoot"
Write-Host "Node: $node"

if (-not (Test-Path $pm2Cli)) {
  Write-Host 'Installation de pm2 (dépendance locale)...'
  & $npm install pm2 --save-dev
}

Write-Host 'Arrêt d''un éventuel process déjà sur le port 5000...'
& $node (Join-Path $backendRoot 'scripts\kill-port.mjs') 5000

Write-Host 'Démarrage mecal-api via PM2...'
& $node $pm2Cli delete mecal-api 2>$null
& $node $pm2Cli start (Join-Path $backendRoot 'ecosystem.config.cjs')
& $node $pm2Cli save

$env:PM2_HOME = if ($env:PM2_HOME) { $env:PM2_HOME } else { Join-Path $env:USERPROFILE '.pm2' }
$taskName = 'M-ECAL PM2 resurrect'
$tr = "`"$node`" `"$pm2Cli`" resurrect"
schtasks /Create /F /TN $taskName /SC ONLOGON /RL HIGHEST /TR $tr | Out-Host

Write-Host ''
Write-Host 'PM2 est en place. Vérification :'
& $node $pm2Cli status
Write-Host ''
Write-Host "Tâche Windows: $taskName (ONLOGON)."
Write-Host 'Après un reboot PC, PM2 relance mecal-api tout seul.'
