$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  $install = Get-Content -Raw scripts/sql/maintain-demo-month.sql
  $before = @'
begin;
set local timezone = 'UTC';
select set_config('freshtrace.demo_until',
  to_char(((now() at time zone 'Asia/Ho_Chi_Minh')::date + 7), 'YYYY-MM-DD'), true);
create temp table preserved_rows (name text, hash text);
do $snapshot$
declare name text; hash text;
begin
  foreach name in array array['inventory','prices','orders','order_items','payments','coupons','users','chat_rooms','chat_messages','inventory_transactions'] loop
    execute format('select md5(coalesce(string_agg(row_to_json(t)::text, %L order by row_to_json(t)::text), %L)) from public.%I t', ',', '', name) into hash;
    insert into preserved_rows values (name,hash);
  end loop;
end $snapshot$;
-- A locked seed batch and inactive Rescue must remain untouched.
update public.batches set status='locked' where batch_id='40000000-0000-0000-0000-000000000001';
update public.fresh_rescue_deals set status='inactive' where deal_id='50000000-0000-0000-0000-000000000004';
create temp table locked_before as select * from public.batches where batch_id='40000000-0000-0000-0000-000000000001';
create temp table inactive_before as select * from public.fresh_rescue_deals where deal_id='50000000-0000-0000-0000-000000000004';
'@
  $afterFirst = @'
create temp table batch_after as select * from public.batches;
create temp table rescue_after as select * from public.fresh_rescue_deals;
'@
  $verify = @'
do $test$
declare item record; actual text; command text;
begin
  for item in select * from preserved_rows loop
    execute format('select md5(coalesce(string_agg(row_to_json(t)::text, %L order by row_to_json(t)::text), %L)) from public.%I t', ',', '', item.name) into actual;
    if actual is distinct from item.hash then raise exception 'Maintenance changed preserved table %', item.name; end if;
  end loop;
  if exists ((select * from batch_after except select * from public.batches) union all
             (select * from public.batches except select * from batch_after))
     or exists ((select * from rescue_after except select * from public.fresh_rescue_deals) union all
                (select * from public.fresh_rescue_deals except select * from rescue_after)) then
    raise exception 'Repeat maintenance is not idempotent';
  end if;
  if exists (select * from locked_before except select * from public.batches)
     or exists (select * from inactive_before except select * from public.fresh_rescue_deals) then
    raise exception 'Locked batch or inactive deal was changed';
  end if;
  if (select count(*) from cron.job where jobname='freshtrace-demo-maintenance') <> 1 then
    raise exception 'Expected exactly one maintenance job';
  end if;
  if not exists (select 1 from public.batches where batch_id='40000000-0000-0000-0000-000000000004' and expire_date=current_date+2)
     or not exists (select 1 from public.fresh_rescue_deals where deal_id='50000000-0000-0000-0000-000000000005' and status='active' and end_at>now()) then
    raise exception 'Batch / eligible Potato Rescue was not refreshed';
  end if;
  if not exists (select 1 from public.fresh_rescue_deals where deal_id='50000000-0000-0000-0000-000000000003' and status='expired')
     or not exists (select 1 from public.batches where batch_id='40000000-0000-0000-0000-000000000014' and status='sold_out') then
    raise exception 'Expired / sold-out fixtures were not preserved';
  end if;
  select j.command into command from cron.job j where jobname='freshtrace-demo-maintenance';
  if position(current_setting('freshtrace.demo_until') in command) = 0 then
    raise exception 'Scheduled job did not freeze the requested deadline';
  end if;
  -- Simulate the job deadline having elapsed, without altering the database clock.
  execute regexp_replace(command, 'date ''[0-9]{4}-[0-9]{2}-[0-9]{2}''', 'date ''2000-01-01''');
  if exists(select 1 from cron.job where jobname='freshtrace-demo-maintenance')
     or exists(select * from batch_after except select * from public.batches)
     or exists(select * from rescue_after except select * from public.fresh_rescue_deals) then
    raise exception 'Expired job must remove itself without changing catalog data';
  end if;
end $test$;
rollback;
'@
  ($before + "`n" + $install + "`n" + $afterFirst + "`n" + $install + "`n" + $verify) |
    docker exec -i supabase_db_freshtrace psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw 'Demo maintenance regression failed; all test writes rolled back.' }
  Write-Host 'PASS: fresh dates, valid Rescue, preserved business data, locked/inactive/sold-out/expired fixtures, idempotence and automatic cutoff. All test writes rolled back.'
} finally { Pop-Location }
