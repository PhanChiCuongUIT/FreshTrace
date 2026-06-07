$ErrorActionPreference = "Stop"

$values = @{}
npx supabase status -o env | ForEach-Object {
  if ($_ -match '^([A-Z_]+)="?(.*?)"?$') {
    $values[$matches[1]] = $matches[2]
  }
}

if (-not $values["API_URL"] -or -not $values["PUBLISHABLE_KEY"]) {
  throw "The local Supabase API is not running."
}

npx deno run --allow-net scripts/realtime-chat-test.ts `
  $values["API_URL"] `
  $values["PUBLISHABLE_KEY"]

if ($LASTEXITCODE -ne 0) {
  throw "Realtime test failed with exit code $LASTEXITCODE."
}
