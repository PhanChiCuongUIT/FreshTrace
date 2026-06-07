$ErrorActionPreference = "Stop"

$values = @{}
npx supabase status -o env | ForEach-Object {
  if ($_ -match '^([A-Z_]+)="?(.*?)"?$') {
    $values[$matches[1]] = $matches[2]
  }
}

if (-not $values["API_URL"] -or -not $values["ANON_KEY"] -or -not $values["SERVICE_ROLE_KEY"]) {
  throw "Could not read local Supabase credentials."
}

$email = "confirm.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@freshtrace.local"
$headers = @{
  apikey = $values["ANON_KEY"]
  Authorization = "Bearer $($values["ANON_KEY"])"
  "Content-Type" = "application/json"
}
$body = @{
  email = $email
  password = "FreshTrace!123"
  data = @{ name = "Confirmation Test" }
} | ConvertTo-Json -Depth 3

$signup = Invoke-RestMethod -Method Post -Uri "$($values["API_URL"])/auth/v1/signup" -Headers $headers -Body $body
Start-Sleep -Seconds 2
$mail = Invoke-RestMethod -Uri "http://127.0.0.1:54324/api/v1/messages"
$confirmationCount = @($mail.messages | Where-Object { $_.To[0].Address -eq $email }).Count

$adminHeaders = @{
  apikey = $values["SERVICE_ROLE_KEY"]
  Authorization = "Bearer $($values["SERVICE_ROLE_KEY"])"
}
try {
  Invoke-RestMethod -Method Delete -Uri "$($values["API_URL"])/auth/v1/admin/users/$($signup.id)" -Headers $adminHeaders | Out-Null
} catch {
  Write-Warning "Could not remove the temporary Auth user; the next backend reset will remove it."
}

if ($signup.access_token) {
  throw "Signup unexpectedly issued a session before email confirmation."
}
if ($confirmationCount -lt 1) {
  throw "Mailpit did not receive the confirmation email."
}

[pscustomobject]@{
  ok = $true
  email = $email
  sessionIssued = $false
  confirmationMailCount = $confirmationCount
} | ConvertTo-Json
