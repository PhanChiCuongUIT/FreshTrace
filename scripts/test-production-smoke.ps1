param(
  [string]$EnvFile = ".env.production",
  [string]$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
)

$ErrorActionPreference = "Stop"

function Read-EnvFile([string]$Path) {
  $values = @{}
  if (-not (Test-Path $Path)) {
    throw "$Path was not found."
  }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#") -or $line -notmatch "^[A-Za-z0-9_]+=") { return }
    $key, $value = $line -split "=", 2
    $values[$key] = $value.Trim().Trim('"').Trim("'")
  }
  return $values
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required but was not found in PATH."
  }
}

Require-Command "npx.cmd"

$values = Read-EnvFile $EnvFile
$supabaseUrl = $values["VITE_SUPABASE_URL"]
$anonKey = $values["VITE_SUPABASE_ANON_KEY"]

if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
  throw "VITE_SUPABASE_URL is missing in $EnvFile."
}
if ([string]::IsNullOrWhiteSpace($anonKey)) {
  throw "VITE_SUPABASE_ANON_KEY is missing in $EnvFile."
}
if ([string]::IsNullOrWhiteSpace($ServiceRoleKey) -or $ServiceRoleKey -match "^(your_|replace_)") {
  throw "SUPABASE_SERVICE_ROLE_KEY is required. Set it in this terminal or pass -ServiceRoleKey. Never commit it."
}

Write-Host "Running FreshTrace production smoke test..."
npx.cmd deno run --allow-net scripts/smoke-test.ts `
  $supabaseUrl `
  $anonKey `
  $ServiceRoleKey

$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  throw "Production smoke test failed with exit code $exitCode."
}

Write-Host "Production smoke test passed."
