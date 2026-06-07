$ErrorActionPreference = "Stop"

function Read-EnvironmentFile([string]$Path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $values[$matches[1]] = $matches[2].Trim()
    }
  }
  return $values
}

function Is-Placeholder([string]$Value) {
  return [string]::IsNullOrWhiteSpace($Value) -or
    $Value -match '^(your_|replace_|YOUR_|https://YOUR|sb_publishable_YOUR)'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendPath = Join-Path $repoRoot "frontend\.env.local"
$backendPath = Join-Path $repoRoot "supabase\.env.local"
$frontend = Read-EnvironmentFile $frontendPath
$backend = Read-EnvironmentFile $backendPath

$requiredFrontend = @(
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_API_BASE_URL",
  "VITE_QR_TRACE_BASE_URL"
)
$optionalBackendGroups = @{
  "Cloudinary" = @("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET")
  "payOS" = @("PAYOS_CLIENT_ID", "PAYOS_API_KEY", "PAYOS_CHECKSUM_KEY")
}

$failed = $false
Write-Host "Frontend environment:"
foreach ($name in $requiredFrontend) {
  $configured = $frontend.ContainsKey($name) -and -not (Is-Placeholder $frontend[$name])
  Write-Host ("  {0}: {1}" -f $name, $(if ($configured) { "configured" } else { "missing or placeholder" }))
  if (-not $configured) { $failed = $true }
}

Write-Host "Optional live integrations:"
foreach ($group in $optionalBackendGroups.Keys) {
  $missing = @($optionalBackendGroups[$group] | Where-Object {
    -not $backend.ContainsKey($_) -or (Is-Placeholder $backend[$_])
  })
  Write-Host ("  {0}: {1}" -f $group, $(if ($missing.Count -eq 0) { "configured" } else { "not configured" }))
}

if ($failed) {
  throw "Required frontend environment values are missing."
}
