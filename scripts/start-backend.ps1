param(
  [switch]$Lite,
  [switch]$SkipInstall,
  [switch]$SkipReset
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI is not installed."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Desktop is not running."
}

if (-not $SkipInstall) {
  npm install
}

if ($Lite) {
  npm run backend:start:lite
} else {
  npm run backend:start
}

if (-not $SkipReset) {
  npm run backend:reset
}

Write-Host ""
Write-Host "FreshTrace backend is ready:"
Write-Host "  API:    http://127.0.0.1:55421"
Write-Host "  REST:   http://127.0.0.1:55421/rest/v1"
Write-Host "  Studio: http://127.0.0.1:55423 (full mode only)"
Write-Host ""
Write-Host "Run Edge Functions in another terminal:"
Write-Host "  npm run backend:functions"
