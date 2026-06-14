create or replace function public.sync_batch_statuses()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.batches b set status = case
    when i.quantity_available = 0 then 'sold_out'::public.batch_status
    when b.expire_date < current_date then 'expired'::public.batch_status
    when b.expire_date <= current_date + 3 then 'near_expiry'::public.batch_status
    else 'available'::public.batch_status
  end
  from public.inventory i
  where i.batch_id = b.batch_id
    and b.status <> 'locked'
    and (
      b.supplier_id is null
      or exists (
        select 1
        from public.suppliers supplier
        where supplier.supplier_id = b.supplier_id
          and supplier.status = 'approved'
      )
    );

  update public.fresh_rescue_deals deal
  set status = case
    when deal.end_at <= now() then 'expired'::public.rescue_status
    when not exists (
      select 1
      from public.inventory inventory
      where inventory.batch_id = deal.batch_id
        and inventory.quantity_available > 0
    ) then 'sold_out'::public.rescue_status
    else 'active'::public.rescue_status
  end
  where deal.status <> 'inactive';
end;
$$;
