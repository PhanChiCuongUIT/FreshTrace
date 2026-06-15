create or replace function public.validate_rescue_deal()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_expire_date date;
  v_stock integer;
  v_original_price numeric(12,2);
begin
  if new.status <> 'active' then
    return new;
  end if;

  select b.expire_date, i.quantity_available - i.quantity_reserved
  into v_expire_date, v_stock
  from public.batches b
  join public.inventory i on i.batch_id = b.batch_id
  where b.batch_id = new.batch_id
    and b.status in ('available', 'near_expiry')
    and b.expire_date between current_date and current_date + 3;

  if v_expire_date is null then
    raise exception 'Fresh Rescue requires a non-expired batch within 3 days of expiry';
  end if;
  if v_stock <= 0 then
    raise exception 'Fresh Rescue batch is out of stock';
  end if;
  if new.end_at > (v_expire_date + interval '1 day') then
    raise exception 'Fresh Rescue cannot end after batch expiry';
  end if;

  select pr.price
  into v_original_price
  from public.prices pr
  join public.batches b on b.batch_id = new.batch_id
  where pr.product_id = b.product_id
    and (pr.batch_id = b.batch_id or pr.batch_id is null)
    and pr.price_type in ('normal', 'promotion')
    and pr.start_date <= current_date
    and (pr.end_date is null or pr.end_date >= current_date)
  order by (pr.batch_id = b.batch_id) desc, (pr.price_type = 'promotion') desc, pr.start_date desc
  limit 1;

  if v_original_price is null then
    raise exception 'Fresh Rescue requires an active normal or promotion price for this batch';
  end if;

  new.original_price := v_original_price;

  if new.rescue_price <= 0 or new.rescue_price >= new.original_price then
    raise exception 'Fresh Rescue price must be greater than zero and lower than the current catalog price';
  end if;

  if exists (
    select 1 from public.fresh_rescue_deals d
    where d.batch_id = new.batch_id and d.status = 'active'
      and d.deal_id is distinct from new.deal_id
  ) then
    raise exception 'Batch already has an active Fresh Rescue deal';
  end if;
  return new;
end $$;
