param(
  [switch]$Production,
  [switch]$DryRun,
  [string]$EnvFile = ".env.production"
)
$ErrorActionPreference = "Stop"
$previousKey = $env:SUPABASE_SERVICE_ROLE_KEY
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  $values = @{}
  if ($Production) {
    Get-Content -LiteralPath $EnvFile | ForEach-Object {
      if ($_ -match '^([A-Z_]+)=(.*)$') { $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'") }
    }
    $url = $values["VITE_SUPABASE_URL"]
    if (-not $env:SUPABASE_SERVICE_ROLE_KEY) {
      throw "Set SUPABASE_SERVICE_ROLE_KEY in this terminal (Supabase Project Settings > API Keys > service_role). Never use a VITE_ variable for this secret."
    }
    if (-not $url -or -not $url.StartsWith("https://")) { throw "Production requires an HTTPS VITE_SUPABASE_URL in $EnvFile." }
  } else {
    $status = npx.cmd supabase status -o env
    if ($LASTEXITCODE -ne 0) { throw "Start local Supabase first: npm run backend:start" }
    $status | ForEach-Object {
      if ($_ -match '^([A-Z_]+)="?(.*?)"?$') { $values[$matches[1]] = $matches[2] }
    }
    $url = $values["API_URL"]
    $env:SUPABASE_SERVICE_ROLE_KEY = $values["SERVICE_ROLE_KEY"]
    if (-not $url -or -not $env:SUPABASE_SERVICE_ROLE_KEY) { throw "Local API URL/service-role key is missing." }
  }
  $options = @()
  if ($DryRun) { $options += "--dry-run" }
  npx.cmd deno run --allow-env=SUPABASE_SERVICE_ROLE_KEY --allow-net scripts/refresh-demo-data.ts $url @options
  if ($LASTEXITCODE -ne 0) { throw "Demo date refresh failed. Completed updates are retained; inspect the error and rerun -DryRun before retrying." }
} finally {
  $env:SUPABASE_SERVICE_ROLE_KEY = $previousKey
  Pop-Location
}
