alter table public.coupons
  alter column source_order_id drop not null,
  add column if not exists coupon_type text not null default 'fixed_amount'
    check (coupon_type in ('fixed_amount','free_shipping','percent')),
  add column if not exists discount_percent integer check (discount_percent between 1 and 100),
  add column if not exists max_discount_amount numeric(12,2),
  add column if not exists min_order_amount numeric(12,2) not null default 0 check (min_order_amount >= 0),
  add column if not exists used_order_id uuid references public.orders(order_id),
  add column if not exists milestone_key text,
  add column if not exists description text;

create unique index if not exists coupons_user_milestone_unique
on public.coupons(user_id, milestone_key)
where milestone_key is not null;

alter table public.orders
  add column if not exists applied_coupon_id uuid references public.coupons(coupon_id),
  add column if not exists discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0);

create or replace function public.issue_signup_coupons()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role_name into v_role from public.roles where role_id = new.role_id;
  if v_role = 'customer' then
    insert into public.coupons(
      code,user_id,amount,remaining_amount,coupon_type,min_order_amount,expires_at,milestone_key,description
    ) values
      ('WELCOME-FREESHIP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,20000,20000,'free_shipping',0,now()+interval '30 days','welcome_freeship_1','Welcome free shipping coupon'),
      ('WELCOME-FRESH-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,30000,30000,'fixed_amount',120000,now()+interval '30 days','welcome_30k','Welcome discount for first fresh-food order')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  else
    delete from public.coupons
    where user_id = new.user_id
      and milestone_key in ('welcome_freeship_1', 'welcome_30k')
      and used_order_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists issue_signup_coupons_after_user on public.users;
create trigger issue_signup_coupons_after_user
after insert or update of role_id on public.users
for each row execute function public.issue_signup_coupons();

create or replace function public.issue_loyalty_coupons()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_count integer;
  v_completed_spend numeric(12,2);
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  select count(*), coalesce(sum(total_amount),0)
  into v_completed_count, v_completed_spend
  from public.orders
  where user_id = new.user_id and status = 'completed';

  if v_completed_count >= 3 then
    insert into public.coupons(code,user_id,amount,remaining_amount,coupon_type,min_order_amount,expires_at,milestone_key,description)
    values('LOYAL-FREESHIP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,25000,25000,'free_shipping',0,now()+interval '60 days','loyal_3_orders','Free shipping after 3 completed orders')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end if;

  if v_completed_spend >= 500000 then
    insert into public.coupons(code,user_id,amount,remaining_amount,coupon_type,min_order_amount,expires_at,milestone_key,description)
    values('LOYAL-50K-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,50000,50000,'fixed_amount',200000,now()+interval '60 days','loyal_500k_spend','50K discount after 500K completed spend')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists issue_loyalty_coupons_after_completed_order on public.orders;
create trigger issue_loyalty_coupons_after_completed_order
after update of status on public.orders
for each row execute function public.issue_loyalty_coupons();

drop function if exists public.checkout_cart(text, public.payment_method, numeric, text);

create or replace function public.checkout_cart(
  p_delivery_address text,
  p_payment_method public.payment_method,
  p_delivery_fee numeric default 0,
  p_note text default null,
  p_coupon_code text default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := private.current_user_id();
  v_cart_id uuid;
  v_order_id uuid;
  v_subtotal numeric(12,2);
  v_delivery_fee numeric(12,2) := greatest(p_delivery_fee, 0);
  v_discount numeric(12,2) := 0;
  v_total numeric(12,2);
  v_coupon public.coupons;
  item record;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_delivery_address is null or length(trim(p_delivery_address)) < 5 then
    raise exception 'Delivery address is required';
  end if;
  select cart_id into v_cart_id from public.carts where user_id = v_user_id;
  if v_cart_id is null then raise exception 'Cart is empty'; end if;

  for item in
    select ci.*, p.name product_name, p.unit,
      coalesce(
        (select d.rescue_price from public.fresh_rescue_deals d
         where d.batch_id = ci.batch_id and d.status = 'active'
           and now() between d.start_at and d.end_at order by d.created_at desc limit 1),
        (select pr.price from public.prices pr
         where pr.product_id = ci.product_id
           and (pr.batch_id = ci.batch_id or pr.batch_id is null)
           and current_date >= pr.start_date
           and (pr.end_date is null or current_date <= pr.end_date)
         order by (pr.batch_id is not null) desc, pr.created_at desc limit 1)
      ) unit_price
    from public.cart_items ci
    join public.products p on p.product_id = ci.product_id
    where ci.cart_id = v_cart_id
    for update of ci
  loop
    if item.unit_price is null then raise exception 'No active price for batch %', item.batch_id; end if;
    perform 1 from public.inventory
      where batch_id = item.batch_id and quantity_available - quantity_reserved >= item.quantity
      for update;
    if not found then raise exception 'Insufficient stock for batch %', item.batch_id; end if;
  end loop;

  select sum(ci.quantity * coalesce(
    (select d.rescue_price from public.fresh_rescue_deals d
     where d.batch_id = ci.batch_id and d.status = 'active'
       and now() between d.start_at and d.end_at order by d.created_at desc limit 1),
    (select pr.price from public.prices pr
     where pr.product_id = ci.product_id and (pr.batch_id = ci.batch_id or pr.batch_id is null)
       and current_date >= pr.start_date and (pr.end_date is null or current_date <= pr.end_date)
     order by (pr.batch_id is not null) desc, pr.created_at desc limit 1)
  )) into v_subtotal
  from public.cart_items ci where ci.cart_id = v_cart_id;
  if v_subtotal is null then raise exception 'Cart is empty'; end if;

  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select * into v_coupon from public.coupons
    where upper(code)=upper(trim(p_coupon_code))
      and user_id=v_user_id
      and status='active'
      and remaining_amount > 0
    for update;
    if v_coupon.coupon_id is null then raise exception 'Coupon is invalid or already used'; end if;
    if v_coupon.expires_at is not null and v_coupon.expires_at < now() then raise exception 'Coupon has expired'; end if;
    if v_subtotal < v_coupon.min_order_amount then raise exception 'Order does not meet coupon minimum amount'; end if;

    v_discount := case v_coupon.coupon_type
      when 'free_shipping' then least(v_delivery_fee, v_coupon.remaining_amount)
      when 'percent' then least(round(v_subtotal * coalesce(v_coupon.discount_percent,0) / 100), coalesce(v_coupon.max_discount_amount, v_coupon.remaining_amount), v_coupon.remaining_amount)
      else least(v_coupon.remaining_amount, v_subtotal + v_delivery_fee)
    end;
  end if;

  v_total := greatest(0, v_subtotal + v_delivery_fee - v_discount);

  insert into public.orders (user_id, subtotal, total_amount, delivery_address, delivery_fee, note, applied_coupon_id, discount_amount)
  values (v_user_id, v_subtotal, v_total, trim(p_delivery_address), v_delivery_fee, p_note, v_coupon.coupon_id, v_discount)
  returning order_id into v_order_id;

  insert into public.order_items (order_id, product_id, batch_id, product_name, unit, quantity, price)
  select v_order_id, ci.product_id, ci.batch_id, p.name, p.unit, ci.quantity,
    coalesce(
      (select d.rescue_price from public.fresh_rescue_deals d
       where d.batch_id = ci.batch_id and d.status = 'active'
         and now() between d.start_at and d.end_at order by d.created_at desc limit 1),
      (select pr.price from public.prices pr
       where pr.product_id = ci.product_id and (pr.batch_id = ci.batch_id or pr.batch_id is null)
         and current_date >= pr.start_date and (pr.end_date is null or current_date <= pr.end_date)
       order by (pr.batch_id is not null) desc, pr.created_at desc limit 1)
    )
  from public.cart_items ci join public.products p on p.product_id = ci.product_id
  where ci.cart_id = v_cart_id;

  if v_coupon.coupon_id is not null then
    update public.coupons
    set remaining_amount = greatest(0, remaining_amount - v_discount),
        status = case when greatest(0, remaining_amount - v_discount) <= 0 then 'used'::public.coupon_status else status end,
        used_at = case when greatest(0, remaining_amount - v_discount) <= 0 then now() else used_at end,
        used_order_id = v_order_id,
        updated_at = now()
    where coupon_id = v_coupon.coupon_id;
  end if;

  update public.inventory i
  set quantity_reserved = quantity_reserved + ci.quantity, last_updated = now()
  from public.cart_items ci where ci.cart_id = v_cart_id and ci.batch_id = i.batch_id;

  insert into public.inventory_transactions (batch_id, type, quantity, note, created_by)
  select batch_id, 'reserve', quantity, 'Reserved for order ' || v_order_id, v_user_id
  from public.cart_items where cart_id = v_cart_id;

  insert into public.payments (order_id, method, amount, status, payment_date)
  values (
    v_order_id,
    p_payment_method,
    v_total,
    case when v_total = 0 then 'paid'::public.payment_status else 'pending'::public.payment_status end,
    case when v_total = 0 then now() else null end
  );

  insert into public.order_tracking (order_id, status, note, created_by)
  values (v_order_id, 'pending', 'Order created', v_user_id);

  insert into public.notifications (user_id, title, content, type, target_url)
  values (v_user_id, 'Order created', 'Your order has been created.', 'order_created', '/orders/' || v_order_id);

  delete from public.cart_items where cart_id = v_cart_id;
  return v_order_id;
end $$;

grant execute on function public.checkout_cart(text, public.payment_method, numeric, text, text) to authenticated;
