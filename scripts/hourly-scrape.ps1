# Hourly local scrape trigger for Windows Task Scheduler.
# Reads CRON_SECRET from backend/.env — never hardcode the secret here.
$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $backendRoot '.env'
$logDir = Join-Path $backendRoot 'logs'
$logFile = Join-Path $logDir 'hourly-scrape.log'
$apiUrl = if ($env:MECAL_SCRAPE_URL) { $env:MECAL_SCRAPE_URL } else { 'http://127.0.0.1:5000/api/internal/scrape' }

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Write-Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

if (-not (Test-Path $envFile)) {
  Write-Log "ERREUR: fichier .env introuvable: $envFile"
  exit 1
}

$secret = $null
Get-Content -Path $envFile | ForEach-Object {
  if ($_ -match '^\s*CRON_SECRET\s*=\s*(.*)\s*$') {
    $secret = $Matches[1].Trim().Trim('"').Trim("'")
  }
}

if (-not $secret) {
  Write-Log 'ERREUR: CRON_SECRET absent de backend/.env'
  exit 1
}

$tmp = Join-Path $env:TEMP ('mecal-scrape-{0}.txt' -f [guid]::NewGuid().ToString('n'))
try {
  # Fire-and-forget: API returns 202 as soon as the scan is accepted.
  $code = & curl.exe -sS -o $tmp -w '%{http_code}' --max-time 15 -X POST $apiUrl `
    -H "Authorization: Bearer $secret" `
    -H 'Accept: application/json'
  $body = if (Test-Path $tmp) { Get-Content -Raw -Path $tmp } else { '' }
  $snippet = if ($body) { $body.Substring(0, [Math]::Min(240, $body.Length)) } else { '' }
  if ($code -eq '202' -or $code -eq '200') {
    Write-Log ("OK HTTP {0} {1}" -f $code, $snippet)
    exit 0
  }
  Write-Log ("ECHEC HTTP {0} {1}" -f $code, $snippet)
  exit 1
} catch {
  Write-Log ("ECHEC {0}" -f $_.Exception.Message)
  exit 1
} finally {
  if (Test-Path $tmp) { Remove-Item -Force $tmp }
}
