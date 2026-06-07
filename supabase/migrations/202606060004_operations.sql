create or replace function public.confirm_payos_payment(
  p_provider_order_code bigint,
  p_amount numeric,
  p_transaction_id text,
  p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_payment public.payments; v_order_id uuid;
begin
  select * into v_payment from public.payments
  where provider_order_code = p_provider_order_code for update;
  if v_payment.payment_id is null then raise exception 'Payment not found'; end if;
  if v_payment.amount <> p_amount then raise exception 'Payment amount mismatch'; end if;
  if v_payment.status = 'paid' then return v_payment.order_id; end if;

  update public.payments set
    status = 'paid',
    transaction_id = p_transaction_id,
    provider_payload = p_payload,
    payment_date = now()
  where payment_id = v_payment.payment_id;

  update public.inventory i set
    quantity_available = quantity_available - oi.quantity,
    quantity_reserved = quantity_reserved - oi.quantity,
    last_updated = now()
  from public.order_items oi
  where oi.order_id = v_payment.order_id and oi.batch_id = i.batch_id
    and i.quantity_available >= oi.quantity and i.quantity_reserved >= oi.quantity;

  if not found then raise exception 'Inventory settlement failed'; end if;

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

  v_order_id := v_payment.order_id;
  perform public.sync_batch_statuses();
  return v_order_id;
end $$;

create or replace function public.confirm_cod_delivery(p_order_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.inventory i set
    quantity_available = quantity_available - oi.quantity,
    quantity_reserved = quantity_reserved - oi.quantity,
    last_updated = now()
  from public.order_items oi
  where oi.order_id = p_order_id and oi.batch_id = i.batch_id;

  update public.payments set status = 'paid', payment_date = now()
  where order_id = p_order_id and method = 'cod' and status = 'pending';
  perform public.sync_batch_statuses();
end $$;

create or replace function public.assign_delivery(p_order_id uuid, p_employee_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_delivery_id uuid; v_customer_id uuid;
begin
  if not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  if not exists (
    select 1 from public.users u join public.roles r on r.role_id = u.role_id
    where u.user_id = p_employee_id and u.status = 'active' and r.role_name = 'employee'
  ) then raise exception 'Employee is invalid'; end if;

  select user_id into v_customer_id from public.orders
  where order_id = p_order_id and status in ('confirmed','preparing') for update;
  if v_customer_id is null then raise exception 'Order cannot be assigned'; end if;

  insert into public.deliveries (order_id, employee_id)
  values (p_order_id, p_employee_id)
  on conflict (order_id) do update set employee_id = excluded.employee_id, status = 'assigned'
  returning delivery_id into v_delivery_id;

  update public.orders set status = 'preparing' where order_id = p_order_id;
  insert into public.order_tracking (order_id, status, note, created_by)
  values (p_order_id, 'assigned', 'Delivery assigned', private.current_user_id());
  insert into public.notifications (user_id, title, content, type, target_url) values
    (p_employee_id, 'New delivery assignment', 'A new order has been assigned to you.', 'delivery_assigned', '/shipper/orders/' || p_order_id),
    (v_customer_id, 'Order is being prepared', 'A delivery employee has been assigned to your order.', 'order_preparing', '/orders/' || p_order_id);
  return v_delivery_id;
end $$;

create or replace function public.update_delivery_status(
  p_delivery_id uuid,
  p_status public.delivery_status,
  p_note text default null,
  p_proof_image_url text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare v_delivery public.deliveries; v_customer_id uuid; v_payment_method public.payment_method;
begin
  select * into v_delivery from public.deliveries where delivery_id = p_delivery_id for update;
  if v_delivery.delivery_id is null then raise exception 'Delivery not found'; end if;
  if v_delivery.employee_id <> private.current_user_id()
     and not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;

  if (v_delivery.status = 'assigned' and p_status not in ('picked_up','failed'))
    or (v_delivery.status = 'picked_up' and p_status not in ('delivering','failed'))
    or (v_delivery.status = 'delivering' and p_status not in ('delivered','failed')) then
    raise exception 'Invalid delivery status transition';
  end if;
  if p_status = 'delivered' and nullif(trim(p_proof_image_url), '') is null then
    raise exception 'Delivery proof image is required';
  end if;

  update public.deliveries set status = p_status, note = p_note,
    proof_image_url = coalesce(p_proof_image_url, proof_image_url),
    pickup_time = case when p_status = 'picked_up' then now() else pickup_time end,
    delivery_time = case when p_status = 'delivered' then now() else delivery_time end
  where delivery_id = p_delivery_id;

  update public.orders set status = case
    when p_status in ('picked_up','delivering') then 'delivering'::public.order_status
    when p_status = 'delivered' then 'completed'::public.order_status
    else status end
  where order_id = v_delivery.order_id returning user_id into v_customer_id;

  insert into public.order_tracking (order_id, status, note, created_by)
  values (v_delivery.order_id, p_status::text, p_note, private.current_user_id());
  insert into public.notifications (user_id, title, content, type, target_url)
  values (v_customer_id, 'Delivery update', 'New status: ' || p_status::text,
    'delivery_status', '/orders/' || v_delivery.order_id);

  if p_status = 'delivered' then
    select method into v_payment_method from public.payments where order_id = v_delivery.order_id;
    if v_payment_method = 'cod' then perform public.confirm_cod_delivery(v_delivery.order_id); end if;
  end if;
end $$;

grant execute on function public.assign_delivery(uuid, uuid) to authenticated;
grant execute on function public.update_delivery_status(uuid, public.delivery_status, text, text) to authenticated;
revoke execute on function public.confirm_payos_payment(bigint, numeric, text, jsonb) from public, anon, authenticated;
revoke execute on function public.confirm_cod_delivery(uuid) from public, anon, authenticated;
