param(
  [string]$EnvFile = ".env.production",
  [string]$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY,
  [switch]$DryRun,
  [switch]$ConfirmProductionCleanup
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

$values = Read-EnvFile $EnvFile
$supabaseUrl = $values["VITE_SUPABASE_URL"]

if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
  throw "VITE_SUPABASE_URL is missing in $EnvFile."
}
if ([string]::IsNullOrWhiteSpace($ServiceRoleKey) -or $ServiceRoleKey -match "^(your_|replace_)") {
  throw "SUPABASE_SERVICE_ROLE_KEY is required. Set it in this terminal or pass -ServiceRoleKey. Never commit it."
}
if (-not $DryRun -and -not $ConfirmProductionCleanup) {
  throw "Production cleanup is destructive. Re-run with -ConfirmProductionCleanup, or use -DryRun to preview."
}

$args = @("deno", "run", "--allow-net", "scripts/cleanup-test-data.ts", $supabaseUrl, $ServiceRoleKey)
if ($DryRun) { $args += "--dry-run" }

npx.cmd @args

if ($LASTEXITCODE -ne 0) {
  throw "Production test-data cleanup failed with exit code $LASTEXITCODE."
}
