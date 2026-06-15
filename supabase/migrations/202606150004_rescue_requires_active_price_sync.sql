create or replace function public.sync_batch_statuses()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.batches b
  set status = case
    when i.quantity_available - i.quantity_reserved <= 0 then 'sold_out'::public.batch_status
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
    when deal.end_at <= now()
      or exists (
        select 1
        from public.batches batch
        where batch.batch_id = deal.batch_id
          and batch.expire_date < current_date
      ) then 'expired'::public.rescue_status
    when exists (
      select 1
      from public.inventory inventory
      where inventory.batch_id = deal.batch_id
        and inventory.quantity_available - inventory.quantity_reserved <= 0
    ) then 'sold_out'::public.rescue_status
    when not exists (
      select 1
      from public.batches batch
      join public.inventory inventory on inventory.batch_id = batch.batch_id
      left join public.suppliers supplier on supplier.supplier_id = batch.supplier_id
      where batch.batch_id = deal.batch_id
        and batch.expire_date between current_date and current_date + 3
        and batch.status in ('available', 'near_expiry')
        and inventory.quantity_available - inventory.quantity_reserved > 0
        and (batch.supplier_id is null or supplier.status = 'approved')
        and exists (
          select 1
          from public.prices price
          where price.product_id = batch.product_id
            and (price.batch_id = batch.batch_id or price.batch_id is null)
            and price.price_type in ('normal', 'promotion')
            and price.start_date <= current_date
            and (price.end_date is null or price.end_date >= current_date)
        )
    ) then 'inactive'::public.rescue_status
    else 'active'::public.rescue_status
  end
  where deal.status <> 'inactive';
end;
$$;

select public.refresh_catalog_state();
