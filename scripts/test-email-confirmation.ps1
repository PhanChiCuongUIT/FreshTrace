param(
  [string]$Email
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root "supabase\.env.local"

if (-not $Email -and (Test-Path $envFile)) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
    $name, $value = $line.Split("=", 2)
    if ($name.Trim() -eq "SMTP_USER") { $script:Email = $value.Trim().Trim('"').Trim("'") }
  }
}

if (-not $Email -or $Email -like "your_*") {
  throw "Pass a real recipient email: npm run test:email -- -Email youraddress@gmail.com"
}

if ($Email -match '^([^@+]+)(\+[^@]+)?@gmail\.com$') {
  $Email = "$($matches[1])+freshtrace$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@gmail.com"
}

$values = @{}
npx supabase status -o env | ForEach-Object {
  if ($_ -match '^([A-Z_]+)="?(.*?)"?$') {
    $values[$matches[1]] = $matches[2]
  }
}

if (-not $values["API_URL"] -or -not $values["ANON_KEY"]) {
  throw "Could not read local Supabase credentials."
}

$headers = @{
  apikey = $values["ANON_KEY"]
  Authorization = "Bearer $($values["ANON_KEY"])"
  "Content-Type" = "application/json"
}
$body = @{
  email = $Email
  password = "FreshTrace!123"
  data = @{ name = "Confirmation Test" }
} | ConvertTo-Json -Depth 3

$signup = Invoke-RestMethod -Method Post -Uri "$($values["API_URL"])/auth/v1/signup" -Headers $headers -Body $body

if ($signup.access_token) {
  throw "Signup unexpectedly issued a session before email confirmation."
}

[pscustomobject]@{
  ok = $true
  email = $Email
  sessionIssued = $false
  message = "Supabase accepted the signup and should send the confirmation email through the configured SMTP provider. Check the real inbox/spam folder."
} | ConvertTo-Json
