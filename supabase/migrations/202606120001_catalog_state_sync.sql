create or replace function public.sync_batch_statuses()
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.batches b set status = case
    when i.quantity_available = 0 then 'sold_out'::public.batch_status
    when b.expire_date < current_date then 'expired'::public.batch_status
    when b.expire_date <= current_date + 3 then 'near_expiry'::public.batch_status
    else 'available'::public.batch_status
  end
  from public.inventory i
  where i.batch_id = b.batch_id and b.status <> 'locked';

  update public.fresh_rescue_deals d
  set status = case
    when d.end_at <= now() then 'expired'::public.rescue_status
    when not exists (
      select 1 from public.inventory i
      where i.batch_id = d.batch_id and i.quantity_available > 0
    ) then 'sold_out'::public.rescue_status
    else 'active'::public.rescue_status
  end
  where d.status <> 'inactive';
end $$;

create or replace function public.refresh_catalog_state()
returns void language plpgsql security definer set search_path = public
as $$
begin
  perform public.sync_batch_statuses();
end $$;

create or replace function public.refresh_catalog_state_trigger()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() < 2 then
    perform public.sync_batch_statuses();
  end if;
  return null;
end $$;

drop trigger if exists refresh_catalog_after_inventory on public.inventory;
create trigger refresh_catalog_after_inventory
after insert or update on public.inventory
for each statement execute function public.refresh_catalog_state_trigger();

drop trigger if exists refresh_catalog_after_batches on public.batches;
create trigger refresh_catalog_after_batches
after insert or update on public.batches
for each statement execute function public.refresh_catalog_state_trigger();

drop trigger if exists refresh_catalog_after_rescue on public.fresh_rescue_deals;
create trigger refresh_catalog_after_rescue
after insert or update on public.fresh_rescue_deals
for each statement execute function public.refresh_catalog_state_trigger();

grant execute on function public.refresh_catalog_state() to authenticated;
