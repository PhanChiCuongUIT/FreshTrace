$ErrorActionPreference = "Stop"

function Read-SupabaseStatus {
  $values = @{}
  npx.cmd supabase status -o env | ForEach-Object {
    if ($_ -match '^([A-Z_]+)="?(.*?)"?$') {
      $values[$matches[1]] = $matches[2]
    }
  }
  return $values
}

$status = Read-SupabaseStatus
$required = @("API_URL", "SECRET_KEY")
foreach ($name in $required) {
  if (-not $status.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($status[$name])) {
    throw "Supabase is not running or $name was not returned by 'supabase status'."
  }
}

npx.cmd deno run --allow-net scripts/cleanup-test-data.ts `
  $status["API_URL"] `
  $status["SECRET_KEY"]

if ($LASTEXITCODE -ne 0) {
  throw "Local test-data cleanup failed with exit code $LASTEXITCODE."
}
