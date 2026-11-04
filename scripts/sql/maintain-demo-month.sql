-- DEMO ONLY. Run as postgres; never install on real food inventory.
-- Optional maintenance, deliberately not an automatically applied migration.
-- One transaction installs the bounded job and refreshes today's fixtures.
do $install$
declare
  until_date date := coalesce(nullif(current_setting('freshtrace.demo_until', true), '')::date,
    (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') + interval '1 month - 1 day')::date);
  command text := $command$
do $refresh$
declare
  today date := (now() at time zone 'UTC')::date;
  fixture record;
  deal record;
  next_status public.rescue_status;
  starts timestamptz;
  ends timestamptz;
  current_price numeric;
  refreshed integer := 0;
begin
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date > date '__DEMO_UNTIL__' then
    perform cron.unschedule(jobid) from cron.job
      where jobname = 'freshtrace-demo-maintenance';
    return;
  end if;
  if not pg_try_advisory_xact_lock(20261031, 16) then return; end if;
  perform set_config('TimeZone', 'UTC', true);

  -- Match both seed batch and product IDs; do not touch later/user-created stock.
  for fixture in
    select ('40000000-0000-0000-0000-' || lpad(o.id::text,12,'0'))::uuid as batch_id,
      ('30000000-0000-0000-0000-' || lpad(o.id::text,12,'0'))::uuid as product_id,
      o.harvest_offset, o.expiry_offset
    from (values
      (1,-1,5), (2,-2,2), (3,-2,6), (4,-3,2), (5,-1,3), (6,0,4),
      (7,-1,7), (8,-30,300), (9,-2,8), (10,0,4), (11,-1,6),
      (12,-2,2), (13,-3,2), (14,0,1), (15,-4,12), (16,-1,7)
    ) o(id, harvest_offset, expiry_offset)
    order by o.id
  loop
    -- Iterate constant IDs: catalog triggers update other batch rows, so a
    -- FOR UPDATE cursor over batches could skip rows changed by those triggers.
    if exists (select 1 from public.batches b where b.batch_id = fixture.batch_id
      and b.product_id = fixture.product_id and b.status <> 'locked'
      and (b.harvest_date is distinct from today + fixture.harvest_offset
        or b.expire_date is distinct from today + fixture.expiry_offset)) then
      update public.batches set harvest_date = today + fixture.harvest_offset,
        expire_date = today + fixture.expiry_offset
        where batch_id = fixture.batch_id and product_id = fixture.product_id and status <> 'locked';
      refreshed := refreshed + 1;
    end if;
  end loop;

  for deal in
    select d.*, b.expire_date, b.status as batch_status, b.product_id,
      i.quantity_available - i.quantity_reserved as free_stock
    from (values (2,4), (3,5), (4,12), (5,13), (6,14)) o(deal_no,batch_no)
    join public.fresh_rescue_deals d
      on d.deal_id = ('50000000-0000-0000-0000-' || lpad(o.deal_no::text,12,'0'))::uuid
      and d.batch_id = ('40000000-0000-0000-0000-' || lpad(o.batch_no::text,12,'0'))::uuid
    join public.batches b on b.batch_id = d.batch_id
      and b.product_id = ('30000000-0000-0000-0000-' || lpad(o.batch_no::text,12,'0'))::uuid
    join public.inventory i on i.batch_id = b.batch_id
    where b.status <> 'locked' and d.status <> 'inactive'
    order by o.deal_no
    for update of d
  loop
    next_status := case
      when deal.deal_id = '50000000-0000-0000-0000-000000000003' then 'expired'
      when deal.free_stock <= 0 then 'sold_out'
      else 'active' end;
    if next_status = 'active' then
      select p.price into current_price from public.prices p
      where p.product_id = deal.product_id
        and (p.batch_id = deal.batch_id or p.batch_id is null)
        and p.price_type in ('normal','promotion')
        and p.start_date <= today and (p.end_date is null or p.end_date >= today)
      order by (p.batch_id = deal.batch_id) desc nulls last,
        (p.price_type = 'promotion') desc, p.start_date desc limit 1;
      if deal.batch_status not in ('available','near_expiry')
        or deal.expire_date not between today and today + 3
        or current_price is null or current_price <= deal.rescue_price
        or exists (select 1 from public.fresh_rescue_deals other
          where other.batch_id = deal.batch_id and other.status = 'active'
            and other.deal_id <> deal.deal_id) then
        raise warning 'Skipped ineligible demo Rescue %; review stock, price and supplier', deal.deal_id;
        continue;
      end if;
    end if;
    starts := (today + case when next_status = 'expired' then -3 else 0 end)::timestamp at time zone 'UTC';
    ends := ((today + case when next_status = 'expired' then -1 else 1 end)::timestamp + interval '12 hours') at time zone 'UTC';
    update public.fresh_rescue_deals set status = next_status, start_at = starts, end_at = ends
    where deal_id = deal.deal_id
      and (status is distinct from next_status or start_at is distinct from starts or end_at is distinct from ends);
  end loop;
  raise notice 'Demo maintenance: refreshed % batch dates for %; stock and financial history preserved', refreshed, today;
end $refresh$;
$command$;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Enable pg_cron before installing demo maintenance';
  end if;
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date > until_date then
    raise exception 'Demo maintenance deadline has ended; no data changed';
  end if;
  command := replace(command, '__DEMO_UNTIL__', to_char(until_date, 'YYYY-MM-DD'));
  perform cron.unschedule(jobid) from cron.job where jobname = 'freshtrace-demo-october-2026';
  -- Hourly catch-up after downtime; unchanged dates are not rewritten.
  perform cron.schedule('freshtrace-demo-maintenance', '10 * * * *', command);
  execute command;
end $install$;
