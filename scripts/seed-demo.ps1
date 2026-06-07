$ErrorActionPreference = "Stop"

function Read-SupabaseStatus {
  $values = @{}
  npx supabase status -o env | ForEach-Object {
    if ($_ -match '^([A-Z_]+)="?(.*?)"?$') {
      $values[$matches[1]] = $matches[2]
    }
  }
  return $values
}

$status = Read-SupabaseStatus
$required = @("API_URL", "PUBLISHABLE_KEY", "SECRET_KEY")
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

npx deno run --allow-env --allow-net scripts/seed-demo-data.ts `
  $status["API_URL"] `
  $status["PUBLISHABLE_KEY"] `
  $status["SECRET_KEY"]

if ($LASTEXITCODE -ne 0) {
  throw "Demo data generation failed with exit code $LASTEXITCODE."
}
