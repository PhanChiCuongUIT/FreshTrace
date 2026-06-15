param(
  [string]$ProjectRef,
  [string]$SecretsFile = "supabase-secrets.production.env",
  [switch]$ResetLinkedDb,
  [switch]$NoSeed,
  [switch]$SkipDbPush,
  [switch]$SkipSecrets,
  [switch]$SkipFunctions
)

$ErrorActionPreference = "Stop"

function Read-EnvFile([string]$Path) {
  $values = @{}
  if (-not (Test-Path $Path)) { return $values }
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

function Require-SecretKeys([hashtable]$Values, [string[]]$Keys) {
  $missing = @()
  foreach ($key in $Keys) {
    if (-not $Values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($Values[$key]) -or $Values[$key] -match "^(your_|replace_|re_your_)") {
      $missing += $key
    }
  }
  if ($missing.Count -gt 0) {
    throw "Missing or placeholder production secrets in $SecretsFile`: $($missing -join ', ')"
  }
}

function Invoke-Supabase([string]$Label, [string[]]$Arguments) {
  Write-Host $Label
  & npx.cmd @("supabase") @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$Label failed. Supabase CLI exited with code $exitCode."
  }
}

Require-Command "npx.cmd"

$productionEnv = Read-EnvFile ".env.production"
if (-not $ProjectRef) {
  $supabaseUrl = $productionEnv["VITE_SUPABASE_URL"]
  if ($supabaseUrl -match "^https://([^.]+)\.supabase\.co") {
    $ProjectRef = $Matches[1]
  }
}
if (-not $ProjectRef) {
  throw "Project ref was not supplied and could not be inferred from .env.production VITE_SUPABASE_URL."
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  throw "SUPABASE_ACCESS_TOKEN is not set. Create it in Supabase Dashboard -> Account -> Access Tokens, then set it before running this script."
}

Invoke-Supabase "Linking Supabase project $ProjectRef..." @("link", "--project-ref", $ProjectRef)

if ($ResetLinkedDb) {
  $resetArgs = @("--yes", "db", "reset", "--linked")
  if ($NoSeed) {
    $resetArgs += "--no-seed"
  }
  Invoke-Supabase "Resetting linked Supabase database and applying migrations..." $resetArgs
} elseif (-not $SkipDbPush) {
  Invoke-Supabase "Pushing database migrations..." @("--yes", "db", "push")
}

if (-not $SkipSecrets) {
  if (-not (Test-Path $SecretsFile)) {
    throw "$SecretsFile was not found. Copy supabase-secrets.production.example.env to $SecretsFile and fill the real values."
  }
  $secrets = Read-EnvFile $SecretsFile
  Require-SecretKeys $secrets @(
    "APP_ENV",
    "APP_URL",
    "ALLOWED_ORIGINS",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_ADMIN_EMAIL",
    "SMTP_SENDER_NAME",
    "SUPPORT_EMAIL",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "PAYOS_CLIENT_ID",
    "PAYOS_API_KEY",
    "PAYOS_CHECKSUM_KEY",
    "PAYOS_RETURN_URL",
    "PAYOS_CANCEL_URL",
    "PAYOS_WEBHOOK_URL",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "QR_TRACE_BASE_URL",
    "QR_BATCH_PREFIX",
    "EDGE_FUNCTION_SECRET",
    "WEBHOOK_VERIFY_SECRET"
  )
  Invoke-Supabase "Setting Edge Function secrets from $SecretsFile..." @("secrets", "set", "--env-file", $SecretsFile)
}

if (-not $SkipFunctions) {
  $functions = @(
    "admin-users",
    "assign-delivery",
    "cancel-order",
    "create-notification",
    "create-payos-payment",
    "fresh-assistant",
    "generate-batch-qr",
    "payos-webhook",
    "record-delivery-payment",
    "render-batch-qr",
    "sign-cloudinary-upload",
    "trace-batch",
    "update-delivery-status",
    "verify-delivery-batch"
  )
  foreach ($fn in $functions) {
    Invoke-Supabase "Deploying Edge Function: $fn" @("functions", "deploy", $fn)
  }
}

Write-Host "Production deployment steps completed."
