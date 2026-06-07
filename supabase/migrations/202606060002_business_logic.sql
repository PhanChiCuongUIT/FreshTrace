create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.current_user_id()
returns uuid language sql stable security definer set search_path = public
as $$ select user_id from public.users where auth_user_id = (select auth.uid()) $$;

create or replace function private.has_role(allowed_roles text[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users u
    join public.roles r on r.role_id = u.role_id
    where u.auth_user_id = (select auth.uid())
      and u.status = 'active'
      and r.role_name = any(allowed_roles)
  )
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users','suppliers','categories','products','batches','carts','cart_items',
    'orders','payments','deliveries','reviews','reports'
  ] loop
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name, table_name
    );
  end loop;
end $$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare customer_role_id uuid;
begin
  select role_id into customer_role_id from public.roles where role_name = 'customer';
  insert into public.users (auth_user_id, role_id, name, email)
  values (
    new.id,
    customer_role_id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
    lower(new.email)
  );
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.create_inventory_for_batch()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.inventory (batch_id, quantity_available) values (new.batch_id, new.quantity);
  insert into public.inventory_transactions (batch_id, type, quantity, note, created_by)
  values (new.batch_id, 'import', new.quantity, 'Initial batch stock', private.current_user_id());
  return new;
end $$;

create trigger on_batch_created
after insert on public.batches
for each row execute function public.create_inventory_for_batch();

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

  update public.fresh_rescue_deals
  set status = case
    when end_at <= now() then 'expired'::public.rescue_status
    when not exists (
      select 1 from public.inventory i
      where i.batch_id = fresh_rescue_deals.batch_id and i.quantity_available > 0
    ) then 'sold_out'::public.rescue_status
    else status
  end
  where status = 'active';
end $$;

create or replace function public.checkout_cart(
  p_delivery_address text,
  p_payment_method public.payment_method,
  p_delivery_fee numeric default 0,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := private.current_user_id();
  v_cart_id uuid;
  v_order_id uuid;
  v_subtotal numeric(12,2);
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

  insert into public.orders (user_id, subtotal, total_amount, delivery_address, delivery_fee, note)
  values (v_user_id, v_subtotal, v_subtotal + greatest(p_delivery_fee, 0), trim(p_delivery_address), greatest(p_delivery_fee, 0), p_note)
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

  update public.inventory i
  set quantity_reserved = quantity_reserved + ci.quantity, last_updated = now()
  from public.cart_items ci where ci.cart_id = v_cart_id and ci.batch_id = i.batch_id;

  insert into public.inventory_transactions (batch_id, type, quantity, note, created_by)
  select batch_id, 'reserve', quantity, 'Reserved for order ' || v_order_id, v_user_id
  from public.cart_items where cart_id = v_cart_id;

  insert into public.payments (order_id, method, amount)
  values (v_order_id, p_payment_method, v_subtotal + greatest(p_delivery_fee, 0));

  insert into public.order_tracking (order_id, status, note, created_by)
  values (v_order_id, 'pending', 'Order created', v_user_id);

  insert into public.notifications (user_id, title, content, type, target_url)
  values (v_user_id, 'Order created', 'Your order has been created.', 'order_created', '/orders/' || v_order_id);

  delete from public.cart_items where cart_id = v_cart_id;
  return v_order_id;
end $$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid := private.current_user_id(); v_order public.orders;
begin
  select * into v_order from public.orders where order_id = p_order_id for update;
  if v_order.order_id is null then raise exception 'Order not found'; end if;
  if v_order.user_id <> v_user_id and not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  if v_order.status not in ('pending','confirmed') then raise exception 'Order can no longer be cancelled'; end if;

  update public.inventory i set quantity_reserved = greatest(0, quantity_reserved - oi.quantity), last_updated = now()
  from public.order_items oi where oi.order_id = p_order_id and oi.batch_id = i.batch_id;
  insert into public.inventory_transactions (batch_id, type, quantity, note, created_by)
  select batch_id, 'release', quantity, coalesce(p_reason, 'Order cancelled'), v_user_id
  from public.order_items where order_id = p_order_id;
  update public.orders set status = 'cancelled' where order_id = p_order_id;
  update public.payments set status = 'cancelled' where order_id = p_order_id and status = 'pending';
  insert into public.order_tracking (order_id, status, note, created_by)
  values (p_order_id, 'cancelled', p_reason, v_user_id);
end $$;

create or replace function public.create_chat_message_notification()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, content, type, target_url)
  select m.user_id, 'New message', left(new.message, 160), 'chat_message', '/chat/' || new.room_id
  from public.chat_room_members m
  where m.room_id = new.room_id and m.user_id <> new.sender_id;
  return new;
end $$;

create trigger on_chat_message_created
after insert on public.chat_messages
for each row execute function public.create_chat_message_notification();

grant execute on function public.checkout_cart(text, public.payment_method, numeric, text) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
revoke execute on function private.current_user_id() from public, anon, authenticated;
revoke execute on function private.has_role(text[]) from public, anon, authenticated;
