$ErrorActionPreference = "Stop"
$values = @{}
npx.cmd supabase status -o env | ForEach-Object {
  if ($_ -match '^([A-Z_]+)="?(.*?)"?$') {
    $values[$matches[1]] = $matches[2]
  }
}

if (-not $values["API_URL"] -or -not $values["ANON_KEY"] -or -not $values["SERVICE_ROLE_KEY"]) {
  throw "Could not read local Supabase credentials."
}

npx.cmd deno run --allow-net scripts/non-manager-crud-test.ts `
  $values["API_URL"] `
  $values["ANON_KEY"] `
  $values["SERVICE_ROLE_KEY"]

if ($LASTEXITCODE -ne 0) {
  throw "Non-manager CRUD integration test failed."
}
