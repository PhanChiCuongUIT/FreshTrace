drop policy if exists users_admin_write on public.users;
drop policy if exists users_admin_delete on public.users;
drop policy if exists users_self_update on public.users;

create policy users_self_update on public.users
for update to authenticated
using (
  auth_user_id = (select auth.uid())
  and status = 'active'
)
with check (
  auth_user_id = (select auth.uid())
  and status = 'active'
);

create or replace function public.protect_user_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    new.auth_user_id := old.auth_user_id;
    new.role_id := old.role_id;
    new.email := old.email;
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop policy if exists carts_owner on public.carts;
create policy carts_owner_read on public.carts
for select to authenticated
using (user_id = private.current_user_id());

drop policy if exists reports_admin_update on public.reports;

create or replace function public.protect_notification_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    new.user_id := old.user_id;
    new.title := old.title;
    new.content := old.content;
    new.type := old.type;
    new.target_url := old.target_url;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace function public.record_delivery_collection(
  p_delivery_id uuid,
  p_method public.collection_method,
  p_proof_url text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.deliveries;
  v_payment public.payments;
  v_collection_id uuid;
begin
  select * into v_delivery
  from public.deliveries
  where delivery_id = p_delivery_id
  for update;

  if v_delivery.delivery_id is null then
    raise exception 'Delivery not found';
  end if;
  if v_delivery.employee_id <> private.current_user_id()
     and not private.has_role(array['admin', 'manager']) then
    raise exception 'Forbidden';
  end if;
  if v_delivery.status <> 'delivering' then
    raise exception 'Payment can only be collected while delivering';
  end if;
  if p_method <> 'cash' then
    raise exception 'Only cash can be recorded manually; transfers must be confirmed by payOS';
  end if;
  if nullif(trim(p_proof_url), '') is not null then
    raise exception 'A payment proof upload is not used for COD cash collection';
  end if;

  select * into v_payment
  from public.payments
  where order_id = v_delivery.order_id
  for update;

  if v_payment.payment_id is null then
    raise exception 'Payment not found';
  end if;
  if v_payment.method <> 'cod' then
    raise exception 'This order is not collect-on-delivery';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'This payment has already been settled or closed';
  end if;

  insert into public.delivery_payment_collections(
    delivery_id, payment_id, collected_by, method, amount, status,
    remittance_status, proof_url
  )
  values(
    p_delivery_id, v_payment.payment_id, private.current_user_id(), 'cash',
    v_payment.amount, 'collected', 'pending', null
  )
  on conflict(delivery_id) do update
  set method = 'cash',
      collected_by = excluded.collected_by,
      amount = excluded.amount,
      status = 'collected',
      remittance_status = 'pending',
      proof_url = null,
      collected_at = now(),
      remitted_at = null,
      updated_at = now()
  returning collection_id into v_collection_id;

  insert into public.order_tracking(order_id, status, note, created_by)
  values(
    v_delivery.order_id,
    'cash_collected',
    'Shipper received COD cash; payOS remittance is still required',
    private.current_user_id()
  );

  return v_collection_id;
end;
$$;

create or replace function public.confirm_payos_request(
  p_provider_order_code bigint,
  p_amount numeric,
  p_transaction_id text,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payos_requests;
  v_payment public.payments;
  v_order public.orders;
  v_delivery public.deliveries;
  v_collection public.delivery_payment_collections;
begin
  if p_provider_order_code is null or p_amount is null then
    raise exception 'Payment order code and amount are required';
  end if;

  select * into v_request
  from public.payos_requests
  where provider_order_code = p_provider_order_code
  for update;

  if v_request.request_id is null then
    raise exception 'Payment request not found';
  end if;
  if v_request.amount <> p_amount then
    raise exception 'Payment amount mismatch';
  end if;
  if v_request.status = 'paid' then
    return v_request.payment_id;
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Payment request is no longer pending';
  end if;

  select * into v_payment
  from public.payments
  where payment_id = v_request.payment_id
  for update;
  if v_payment.payment_id is null then
    raise exception 'Payment record not found';
  end if;

  select * into v_order
  from public.orders
  where order_id = v_payment.order_id
  for update;
  if v_order.order_id is null then
    raise exception 'Order not found';
  end if;

  if v_request.purpose = 'checkout' then
    if v_payment.method <> 'payos'
       or v_payment.status <> 'pending'
       or v_order.status <> 'pending' then
      raise exception 'Checkout payment is no longer eligible for confirmation';
    end if;
  elsif v_request.purpose = 'customer_cod' then
    select * into v_delivery
    from public.deliveries
    where delivery_id = v_request.delivery_id
      and order_id = v_order.order_id
    for update;
    if v_delivery.delivery_id is null
       or v_delivery.status <> 'delivering'
       or v_delivery.employee_id <> v_request.requested_by
       or v_payment.method <> 'cod'
       or v_payment.status <> 'pending' then
      raise exception 'COD payment is no longer eligible for confirmation';
    end if;
  else
    select * into v_collection
    from public.delivery_payment_collections
    where collection_id = v_request.collection_id
      and delivery_id = v_request.delivery_id
      and payment_id = v_request.payment_id
    for update;
    select * into v_delivery
    from public.deliveries
    where delivery_id = v_request.delivery_id
      and order_id = v_order.order_id
    for update;
    if v_collection.collection_id is null
       or v_collection.method <> 'cash'
       or v_collection.remittance_status <> 'pending'
       or v_delivery.delivery_id is null
       or v_delivery.status <> 'delivering'
       or v_payment.method <> 'cod'
       or v_payment.status <> 'pending' then
      raise exception 'Cash remittance is no longer eligible for confirmation';
    end if;
  end if;

  update public.payos_requests
  set status = 'paid',
      transaction_id = nullif(trim(p_transaction_id), ''),
      provider_payload = p_payload,
      paid_at = now(),
      updated_at = now()
  where request_id = v_request.request_id;

  if v_request.purpose in ('checkout', 'customer_cod') then
    update public.payments
    set status = 'paid',
        transaction_id = nullif(trim(p_transaction_id), ''),
        provider_payload = p_payload,
        payment_date = now()
    where payment_id = v_request.payment_id;

    if v_request.purpose = 'customer_cod' then
      insert into public.delivery_payment_collections(
        delivery_id, payment_id, collected_by, method, amount, status,
        remittance_status
      )
      values(
        v_request.delivery_id, v_request.payment_id, v_request.requested_by,
        'customer_payos', v_request.amount, 'collected', 'not_required'
      )
      on conflict(delivery_id) do update
      set method = 'customer_payos',
          collected_by = excluded.collected_by,
          amount = excluded.amount,
          status = 'collected',
          remittance_status = 'not_required',
          proof_url = null,
          collected_at = now(),
          remitted_at = null,
          updated_at = now();
    end if;

    insert into public.order_tracking(order_id, status, note)
    values(
      v_order.order_id,
      'payment_paid',
      case when v_request.purpose = 'checkout'
        then 'payOS checkout payment confirmed; awaiting Manager confirmation'
        else 'COD payOS payment confirmed at delivery'
      end
    );
    insert into public.notifications(user_id, title, content, type, target_url)
    values(
      v_order.user_id,
      'Payment successful',
      'The payOS payment was confirmed.',
      'payment_paid',
      '/orders/' || v_order.order_id
    );
  else
    update public.delivery_payment_collections
    set remittance_status = 'paid',
        remitted_at = now(),
        updated_at = now()
    where collection_id = v_request.collection_id;

    update public.payments
    set status = 'paid',
        transaction_id = nullif(trim(p_transaction_id), ''),
        provider_payload = p_payload,
        payment_date = now()
    where payment_id = v_request.payment_id;

    insert into public.order_tracking(order_id, status, note)
    values(
      v_order.order_id,
      'payment_paid',
      'Shipper cash remittance confirmed through payOS'
    );
    insert into public.notifications(user_id, title, content, type, target_url)
    values(
      v_order.user_id,
      'COD payment settled',
      'The shipper remittance was confirmed.',
      'payment_paid',
      '/orders/' || v_order.order_id
    );
  end if;

  return v_request.payment_id;
end;
$$;

revoke execute on function public.confirm_payos_request(bigint, numeric, text, jsonb)
from public, anon, authenticated;
grant execute on function public.confirm_payos_request(bigint, numeric, text, jsonb)
to service_role;

revoke execute on function public.refresh_coupon_statuses() from public, anon;
revoke execute on function public.replace_delivery_proof(uuid, text) from public, anon;
revoke execute on function public.record_delivery_collection(
  uuid, public.collection_method, text
) from public, anon;
grant execute on function public.record_delivery_collection(
  uuid, public.collection_method, text
) to authenticated;
