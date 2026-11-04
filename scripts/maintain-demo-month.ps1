param(
  [switch]$Production,
  [switch]$DryRun,
  [switch]$ConfirmDemoData,
  [string]$EnvFile = '.env.production',
  [string]$Until
)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  if (-not $DryRun -and -not $ConfirmDemoData) {
    throw 'Use -DryRun first, then -ConfirmDemoData. This renews fixed DEMO batch dates, not real food expiry dates.'
  }
  $vietnamToday = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'SE Asia Standard Time').Date
  if (-not $Until) { $Until = $vietnamToday.AddDays(1 - $vietnamToday.Day).AddMonths(1).AddDays(-1).ToString('yyyy-MM-dd') }
  $deadline = [DateTime]::ParseExact($Until, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
  if ($deadline -lt $vietnamToday) { throw 'Deadline is in the past. No data changed.' }
  $install = Get-Content -Raw scripts/sql/maintain-demo-month.sql
  $sql = "begin; select set_config('freshtrace.demo_until', '$Until', true);`n" + $install + "`ncommit;"
  if ($DryRun) {
    $sql = @'
select b.batch_code, b.status, b.harvest_date, b.expire_date,
       i.quantity_available, i.quantity_reserved
from public.batches b left join public.inventory i on i.batch_id = b.batch_id
where b.batch_id in (select ('40000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,16) n)
order by b.batch_id;
select jobname, schedule, active from cron.job where jobname in ('freshtrace-demo-maintenance','freshtrace-demo-october-2026');
'@
  }
  if ($Production) {
    if (-not $env:SUPABASE_ACCESS_TOKEN) { throw 'Set SUPABASE_ACCESS_TOKEN (Supabase account > Access Tokens, database write permission), or run scripts/sql/maintain-demo-month.sql in the Cloud SQL Editor. Do not use a frontend key.' }
    $values = @{}
    Get-Content -LiteralPath $EnvFile | ForEach-Object {
      if ($_ -match '^([A-Z_]+)=(.*)$') { $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'") }
    }
    $url = $values['VITE_SUPABASE_URL']
    if ($url -notmatch '^https://([a-z0-9]{20})\.supabase\.co/?$') { throw 'Expected a hosted Supabase URL in .env.production; target was not changed.' }
    $projectRef = $matches[1]
    Write-Host "Target Cloud project: $projectRef (demo maintenance through $Until only)"
    $body = @{ query = $sql; read_only = [bool]$DryRun } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$projectRef/database/query" -Headers @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" } -ContentType 'application/json' -Body $body -TimeoutSec 90
    $result | ConvertTo-Json -Depth 8
  } else {
    $sql | docker exec -i supabase_db_freshtrace psql -v ON_ERROR_STOP=1 -U postgres -d postgres
    if ($LASTEXITCODE -ne 0) { throw 'Local maintenance failed. The install/refresh transaction was rolled back.' }
  }
  if (-not $DryRun) { Write-Host "Installed and refreshed. Job renews demo dates while the database runs, through $Until (Vietnam time), then removes itself. No Vercel rebuild is needed for these data changes." }
} finally { Pop-Location }
