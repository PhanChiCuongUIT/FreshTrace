create type public.coupon_status as enum ('active', 'used', 'expired', 'cancelled');

create table public.coupons (
  coupon_id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references public.users(user_id) on delete cascade,
  source_order_id uuid not null unique references public.orders(order_id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  remaining_amount numeric(12,2) not null check (remaining_amount >= 0),
  status public.coupon_status not null default 'active',
  expires_at timestamptz not null default (now() + interval '180 days'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (remaining_amount <= amount)
);

alter table public.coupons enable row level security;
grant select on public.coupons to authenticated;

create policy coupons_owner_read on public.coupons for select to authenticated
using (user_id = private.current_user_id() or private.has_role(array['admin']));

create trigger set_coupons_updated_at
before update on public.coupons
for each row execute function public.set_updated_at();

create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := private.current_user_id();
  v_order public.orders;
  v_payment public.payments;
  v_coupon_code text;
begin
  select * into v_order from public.orders where order_id=p_order_id for update;
  if v_order.order_id is null then raise exception 'Order not found'; end if;
  if v_order.user_id<>v_user_id and not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  if v_order.status<>'pending' then raise exception 'Only pending orders can be cancelled'; end if;
  select * into v_payment from public.payments where order_id=p_order_id for update;
  if v_payment.method='payos' and v_payment.status<>'paid' and v_payment.provider_order_code is not null then
    raise exception 'Use the cancel-order Edge Function for pending payOS orders';
  end if;
  update public.inventory i set quantity_reserved=greatest(0,quantity_reserved-oi.quantity),last_updated=now()
  from public.order_items oi where oi.order_id=p_order_id and oi.batch_id=i.batch_id;
  insert into public.inventory_transactions(batch_id,type,quantity,note,created_by)
  select batch_id,'release',quantity,coalesce(p_reason,'Order cancelled'),v_user_id
  from public.order_items where order_id=p_order_id;
  update public.orders set status='cancelled' where order_id=p_order_id;
  update public.payments set status='cancelled' where order_id=p_order_id and status<>'paid';
  insert into public.order_tracking(order_id,status,note,created_by)
  values(p_order_id,'cancelled',p_reason,v_user_id);
  if v_payment.status='paid' then
    insert into public.coupons(code,user_id,source_order_id,amount,remaining_amount)
    values('FT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_order.user_id,p_order_id,v_payment.amount,v_payment.amount)
    on conflict(source_order_id) do update set updated_at=now()
    returning code into v_coupon_code;
    insert into public.notifications(user_id,title,content,type,target_url)
    values(v_order.user_id,'Cancellation coupon issued','Coupon ' || v_coupon_code || ' was issued with the full paid value.','coupon_issued','/profile');
  end if;
  perform public.sync_batch_statuses();
end $$;

drop function if exists public.cancel_order_service(uuid,text,uuid);

create or replace function public.cancel_order_service(
  p_order_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_issue_coupon boolean default true
) returns text language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_payment public.payments;
  v_coupon_code text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Forbidden'; end if;
  select * into v_order from public.orders where order_id=p_order_id for update;
  if v_order.order_id is null then raise exception 'Order not found'; end if;
  if v_order.status<>'pending' then raise exception 'Only pending orders can be cancelled'; end if;
  select * into v_payment from public.payments where order_id=p_order_id for update;
  update public.inventory i set quantity_reserved=greatest(0,quantity_reserved-oi.quantity),last_updated=now()
  from public.order_items oi where oi.order_id=p_order_id and oi.batch_id=i.batch_id;
  insert into public.inventory_transactions(batch_id,type,quantity,note,created_by)
  select batch_id,'release',quantity,coalesce(p_reason,'Order cancelled'),p_actor_id
  from public.order_items where order_id=p_order_id;
  update public.orders set status='cancelled' where order_id=p_order_id;
  update public.payments set status='cancelled' where order_id=p_order_id and status<>'paid';
  update public.payos_requests set status='cancelled',updated_at=now()
  where payment_id=v_payment.payment_id and status='pending';
  insert into public.order_tracking(order_id,status,note,created_by)
  values(p_order_id,'cancelled',p_reason,p_actor_id);
  if p_issue_coupon and v_payment.status='paid' then
    insert into public.coupons(code,user_id,source_order_id,amount,remaining_amount)
    values('FT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_order.user_id,p_order_id,v_payment.amount,v_payment.amount)
    on conflict(source_order_id) do update set updated_at=now()
    returning code into v_coupon_code;
    insert into public.notifications(user_id,title,content,type,target_url)
    values(v_order.user_id,'Cancellation coupon issued','Coupon ' || v_coupon_code || ' was issued with the full paid value.','coupon_issued','/profile');
  end if;
  perform public.sync_batch_statuses();
  return v_coupon_code;
end $$;

revoke execute on function public.cancel_order_service(uuid,text,uuid,boolean)
from public,anon,authenticated;

create or replace function public.confirm_payos_request(
  p_provider_order_code bigint,
  p_amount numeric,
  p_transaction_id text,
  p_payload jsonb
) returns uuid language plpgsql security definer set search_path=public
as $$
declare
  v_request public.payos_requests;
  v_order_id uuid;
  v_customer_id uuid;
begin
  select * into v_request from public.payos_requests
  where provider_order_code=p_provider_order_code for update;
  if v_request.request_id is null then raise exception 'Payment request not found'; end if;
  if v_request.amount<>p_amount then raise exception 'Payment amount mismatch'; end if;
  if v_request.status='paid' then return v_request.payment_id; end if;
  update public.payos_requests set status='paid',transaction_id=p_transaction_id,
    provider_payload=p_payload,paid_at=now(),updated_at=now()
  where request_id=v_request.request_id;
  select p.order_id,o.user_id into v_order_id,v_customer_id
  from public.payments p join public.orders o on o.order_id=p.order_id
  where p.payment_id=v_request.payment_id;

  if v_request.purpose in ('checkout','customer_cod') then
    update public.payments set status='paid',transaction_id=p_transaction_id,
      provider_payload=p_payload,payment_date=now()
    where payment_id=v_request.payment_id;
    if v_request.purpose='customer_cod' then
      insert into public.delivery_payment_collections(
        delivery_id,payment_id,collected_by,method,amount,status,remittance_status
      ) values(
        v_request.delivery_id,v_request.payment_id,v_request.requested_by,
        'customer_payos',v_request.amount,'collected','not_required'
      )
      on conflict(delivery_id) do update set
        method='customer_payos',status='collected',remittance_status='not_required',
        collected_at=now(),updated_at=now();
    end if;
    insert into public.order_tracking(order_id,status,note)
    values(v_order_id,'payment_paid',
      case when v_request.purpose='checkout'
        then 'payOS checkout payment confirmed; awaiting Manager confirmation'
        else 'COD payOS payment confirmed at delivery'
      end);
    insert into public.notifications(user_id,title,content,type,target_url)
    values(v_customer_id,'Payment successful','The payOS payment was confirmed.','payment_paid','/orders/' || v_order_id);
  else
    update public.delivery_payment_collections
    set remittance_status='paid',remitted_at=now(),updated_at=now()
    where collection_id=v_request.collection_id;
  end if;
  return v_request.payment_id;
end $$;

revoke execute on function public.confirm_payos_request(bigint,numeric,text,jsonb)
from public,anon,authenticated;

create or replace function public.enforce_cash_remittance_before_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'delivered'
    and old.status is distinct from 'delivered'
    and exists (
      select 1
      from public.delivery_payment_collections collection
      where collection.delivery_id = new.delivery_id
        and collection.method = 'cash'
        and collection.remittance_status <> 'paid'
    )
  then
    raise exception 'Cash collection must be remitted through payOS before completing delivery';
  end if;

  return new;
end;
$$;

drop trigger if exists deliveries_require_cash_remittance on public.deliveries;
create trigger deliveries_require_cash_remittance
before update of status on public.deliveries
for each row execute function public.enforce_cash_remittance_before_delivery();

alter publication supabase_realtime add table public.coupons;
