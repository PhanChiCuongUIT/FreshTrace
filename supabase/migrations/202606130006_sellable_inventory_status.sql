create or replace function public.sync_batch_statuses()
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.batches b set status = case
    when i.quantity_available - i.quantity_reserved <= 0 then 'sold_out'::public.batch_status
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
      where i.batch_id = d.batch_id
        and i.quantity_available - i.quantity_reserved > 0
    ) then 'sold_out'::public.rescue_status
    else 'active'::public.rescue_status
  end
  where d.status <> 'inactive';
end $$;

select public.refresh_catalog_state();
