create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare customer_role_id uuid; v_user_id uuid;
begin
  select role_id into customer_role_id from public.roles where role_name = 'customer';
  insert into public.users (auth_user_id, role_id, name, email)
  values (
    new.id,
    customer_role_id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
    lower(new.email)
  ) returning user_id into v_user_id;
  insert into public.carts (user_id) values (v_user_id);
  return new;
end $$;

create or replace function public.confirm_payos_payment(
  p_provider_order_code bigint,
  p_amount numeric,
  p_transaction_id text,
  p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_payment public.payments;
begin
  select * into v_payment from public.payments
  where provider_order_code = p_provider_order_code for update;
  if v_payment.payment_id is null then raise exception 'Payment not found'; end if;
  if v_payment.amount <> p_amount then raise exception 'Payment amount mismatch'; end if;
  if v_payment.status = 'paid' then return v_payment.order_id; end if;
  if exists (
    select 1 from public.order_items oi
    left join public.inventory i on i.batch_id = oi.batch_id
    where oi.order_id = v_payment.order_id
      and (i.batch_id is null or i.quantity_available < oi.quantity or i.quantity_reserved < oi.quantity)
  ) then raise exception 'Inventory settlement failed'; end if;

  update public.payments set
    status = 'paid', transaction_id = p_transaction_id, provider_payload = p_payload,
    payment_date = now()
  where payment_id = v_payment.payment_id;
  update public.inventory i set
    quantity_available = quantity_available - oi.quantity,
    quantity_reserved = quantity_reserved - oi.quantity,
    last_updated = now()
  from public.order_items oi
  where oi.order_id = v_payment.order_id and oi.batch_id = i.batch_id;
  insert into public.inventory_transactions (batch_id, type, quantity, note)
  select batch_id, 'export', quantity, 'Paid order ' || v_payment.order_id
  from public.order_items where order_id = v_payment.order_id;
  update public.orders set status = 'confirmed' where order_id = v_payment.order_id;
  insert into public.order_tracking (order_id, status, note)
  values (v_payment.order_id, 'confirmed', 'payOS payment confirmed');
  insert into public.notifications (user_id, title, content, type, target_url)
  select user_id, 'Payment successful', 'The order has been paid and confirmed.',
    'payment_paid', '/orders/' || order_id
  from public.orders where order_id = v_payment.order_id;
  perform public.sync_batch_statuses();
  return v_payment.order_id;
end $$;

create or replace function public.confirm_cod_delivery(p_order_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.order_items oi
    left join public.inventory i on i.batch_id = oi.batch_id
    where oi.order_id = p_order_id
      and (i.batch_id is null or i.quantity_available < oi.quantity or i.quantity_reserved < oi.quantity)
  ) then raise exception 'Inventory settlement failed'; end if;
  update public.inventory i set
    quantity_available = quantity_available - oi.quantity,
    quantity_reserved = quantity_reserved - oi.quantity,
    last_updated = now()
  from public.order_items oi
  where oi.order_id = p_order_id and oi.batch_id = i.batch_id;
  insert into public.inventory_transactions (batch_id, type, quantity, note)
  select batch_id, 'export', quantity, 'COD order delivered ' || p_order_id
  from public.order_items where order_id = p_order_id;
  update public.payments set status = 'paid', payment_date = now()
  where order_id = p_order_id and method = 'cod' and status = 'pending';
  perform public.sync_batch_statuses();
end $$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid := private.current_user_id(); v_order public.orders; v_payment public.payments;
begin
  select * into v_order from public.orders where order_id = p_order_id for update;
  if v_order.order_id is null then raise exception 'Order not found'; end if;
  if v_order.user_id <> v_user_id and not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  if v_order.status not in ('pending','confirmed') then raise exception 'Order can no longer be cancelled'; end if;
  select * into v_payment from public.payments where order_id = p_order_id;
  if v_payment.status = 'paid' then raise exception 'Paid orders require a refund workflow'; end if;

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

create or replace function public.confirm_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_payment public.payments;
begin
  if not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  select * into v_payment from public.payments where order_id = p_order_id;
  if v_payment.payment_id is null then raise exception 'Payment not found'; end if;
  if v_payment.method = 'payos' and v_payment.status <> 'paid' then
    raise exception 'payOS payment is not completed';
  end if;
  update public.orders set status = 'confirmed'
  where order_id = p_order_id and status = 'pending';
  if not found then raise exception 'Order cannot be confirmed'; end if;
  insert into public.order_tracking (order_id, status, note, created_by)
  values (p_order_id, 'confirmed', 'Order confirmed by manager', private.current_user_id());
  insert into public.notifications (user_id, title, content, type, target_url)
  select user_id, 'Order confirmed', 'FreshTrace is preparing your order.',
    'order_confirmed', '/orders/' || order_id
  from public.orders where order_id = p_order_id;
end $$;

grant execute on function public.confirm_order(uuid) to authenticated;
