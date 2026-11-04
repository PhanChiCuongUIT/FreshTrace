param([switch]$RefreshOnly)
$ErrorActionPreference = "Stop"
$env:SUPABASE_TELEMETRY_DISABLED = "1"

function Read-SupabaseStatus {
  $values = @{}
  npx.cmd supabase status -o env | ForEach-Object {
    if ($_ -match '^([A-Z_]+)="?(.*?)"?$') {
      $values[$matches[1]] = $matches[2]
    }
  }
  return $values
}

function Invoke-LocalSqlFile([string]$Label, [string]$Path) {
  Write-Host $Label
  if (-not (Test-Path $Path)) {
    throw "$Path was not found."
  }
  Get-Content -Raw $Path | docker exec -i supabase_db_freshtrace psql --single-transaction --file=- -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

function Invoke-DenoSeedScript([string]$Label, [string]$ScriptPath, [string[]]$Arguments) {
  Write-Host $Label
  npx.cmd deno run --allow-env --allow-net $ScriptPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

$status = Read-SupabaseStatus
$required = @("API_URL", "PUBLISHABLE_KEY", "SERVICE_ROLE_KEY")
foreach ($name in $required) {
  if (-not $status.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($status[$name])) {
    throw "Supabase is not running or $name was not returned by 'supabase status'."
  }
}

$authReady = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
  try {
    $health = docker inspect --format "{{.State.Health.Status}}" supabase_auth_freshtrace 2>$null
    if ($health -eq "healthy") {
      $authReady = $true
      break
    }
  } catch {}
  Start-Sleep -Seconds 2
}
if (-not $authReady) {
  throw "Supabase Auth did not become ready after 40 seconds."
}

Invoke-DenoSeedScript "Preparing existing demo catalog for current date..." "scripts/refresh-demo-data.ts" @(
  $status["API_URL"],
  $status["SERVICE_ROLE_KEY"],
  "--pre-seed"
)

Invoke-LocalSqlFile "Ensuring base catalog seed exists..." "supabase/seed.sql"

Invoke-DenoSeedScript "Refreshing deterministic demo catalog dates..." "scripts/refresh-demo-data.ts" @(
  $status["API_URL"],
  $status["SERVICE_ROLE_KEY"]
)

if ($RefreshOnly) {
  & "$PSScriptRoot/maintain-demo-month.ps1" -ConfirmDemoData
  Write-Host "Existing demo catalog refreshed for this month. Users, passwords and order history were preserved. For a new database, run npm run seed:demo to provision accounts/workflows."
  exit 0
}

Invoke-DenoSeedScript "Seeding FreshTrace demo users and workflows..." "scripts/seed-demo-data.ts" @(
  $status["API_URL"],
  $status["PUBLISHABLE_KEY"],
  $status["SERVICE_ROLE_KEY"]
)

Write-Host "Demo provisioning complete. Test-data cleanup is a separate, explicit operation."
