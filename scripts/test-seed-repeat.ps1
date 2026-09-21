$ErrorActionPreference = "Stop"
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  $seed = Get-Content -Raw supabase/seed.sql
  $before = @'
begin;
create temp table seed_before as select
  (select count(*) from public.prices) as prices,
  (select count(*) from public.fresh_rescue_deals) as deals,
  (select md5(string_agg(row_to_json(i)::text, ',' order by inventory_id)) from public.inventory i) as inventory_hash,
  (select md5(string_agg(row_to_json(p)::text, ',' order by price_id)) from public.prices p) as price_hash;
'@
  $after = @'
do $$
begin
  if exists (
    select 1 from seed_before b
    where b.prices <> (select count(*) from public.prices)
      or b.deals <> (select count(*) from public.fresh_rescue_deals)
      or b.inventory_hash is distinct from (select md5(string_agg(row_to_json(i)::text, ',' order by inventory_id)) from public.inventory i)
      or b.price_hash is distinct from (select md5(string_agg(row_to_json(p)::text, ',' order by price_id)) from public.prices p)
  ) then raise exception 'Repeated seed changed inventory, price history or fixture counts'; end if;
end $$;
rollback;
'@
  ($before + "`n" + $seed + "`n" + $seed + "`n" + $after) |
    docker exec -i supabase_db_freshtrace psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw "Seed repeat regression failed. The transaction was not committed." }
  Write-Host "PASS: repeat seed preserves stock, price history and existing deal counts; all test writes rolled back."
} finally { Pop-Location }
