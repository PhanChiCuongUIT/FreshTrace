create type public.payos_request_purpose as enum ('checkout', 'customer_cod', 'shipper_remittance');
create type public.payos_request_status as enum ('pending', 'paid', 'cancelled', 'failed');
create type public.collection_method as enum ('cash', 'bank_transfer', 'customer_payos');
create type public.remittance_status as enum ('not_required', 'pending', 'paid');

create table public.order_manager_assignments (
  order_id uuid primary key references public.orders(order_id) on delete cascade,
  manager_id uuid not null references public.users(user_id),
  assigned_at timestamptz not null default now()
);

create table public.delivery_payment_collections (
  collection_id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null unique references public.deliveries(delivery_id) on delete cascade,
  payment_id uuid not null unique references public.payments(payment_id) on delete cascade,
  collected_by uuid not null references public.users(user_id),
  method public.collection_method not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'collected' check (status in ('pending', 'collected', 'verified')),
  remittance_status public.remittance_status not null default 'not_required',
  proof_url text,
  collected_at timestamptz not null default now(),
  remitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payos_requests (
  request_id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(payment_id) on delete cascade,
  delivery_id uuid references public.deliveries(delivery_id) on delete cascade,
  collection_id uuid references public.delivery_payment_collections(collection_id) on delete cascade,
  purpose public.payos_request_purpose not null,
  requested_by uuid not null references public.users(user_id),
  provider_order_code bigint not null unique,
  amount numeric(12,2) not null check (amount > 0),
  status public.payos_request_status not null default 'pending',
  checkout_url text,
  qr_code text,
  transaction_id text,
  provider_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index payos_requests_one_open_purpose
  on public.payos_requests(payment_id, purpose)
  where status = 'pending';

alter table public.chat_messages
  add column shared_product_id uuid references public.products(product_id) on delete set null,
  add column shared_order_id uuid references public.orders(order_id) on delete set null;

alter table public.chat_messages drop constraint if exists chat_messages_content_check;
alter table public.chat_messages add constraint chat_messages_content_check check (
  (message is not null and length(trim(message)) between 1 and 4000)
  or attachment_url is not null
  or shared_product_id is not null
  or shared_order_id is not null
);
alter table public.chat_messages add constraint chat_messages_one_share_check check (
  not (shared_product_id is not null and shared_order_id is not null)
);

delete from public.chat_message_reactions a
using public.chat_message_reactions b
where a.message_id = b.message_id
  and a.user_id = b.user_id
  and (a.created_at, a.reaction_id) < (b.created_at, b.reaction_id);

alter table public.chat_message_reactions
  drop constraint if exists chat_message_reactions_message_id_user_id_reaction_key;
alter table public.chat_message_reactions
  add constraint chat_message_reactions_message_user_key unique (message_id, user_id);

create or replace function private.ensure_order_conversation(
  p_order_id uuid,
  p_type public.chat_room_type,
  p_first_user uuid,
  p_second_user uuid
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_room_id uuid;
begin
  select r.room_id into v_room_id
  from public.chat_rooms r
  where r.order_id = p_order_id and r.type = p_type
    and exists (select 1 from public.chat_room_members m where m.room_id = r.room_id and m.user_id = p_first_user)
    and exists (select 1 from public.chat_room_members m where m.room_id = r.room_id and m.user_id = p_second_user)
  limit 1;
  if v_room_id is null then
    insert into public.chat_rooms(type, order_id, created_by)
    values (p_type, p_order_id, p_first_user) returning room_id into v_room_id;
    insert into public.chat_room_members(room_id, user_id, role_in_room)
    values (v_room_id, p_first_user, 'member'), (v_room_id, p_second_user, 'member')
    on conflict do nothing;
  end if;
  return v_room_id;
end $$;

create or replace function public.assign_order_manager_and_chat()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_manager_id uuid;
begin
  select u.user_id into v_manager_id
  from public.users u
  join public.roles r on r.role_id = u.role_id
  left join public.order_manager_assignments a on a.manager_id = u.user_id
  where r.role_name = 'manager' and u.status = 'active'
  group by u.user_id, u.created_at
  order by count(a.order_id), u.created_at
  limit 1;
  if v_manager_id is not null then
    insert into public.order_manager_assignments(order_id, manager_id)
    values (new.order_id, v_manager_id) on conflict do nothing;
    perform private.ensure_order_conversation(new.order_id, 'customer_manager', new.user_id, v_manager_id);
  end if;
  return new;
end $$;

create trigger assign_order_manager_after_checkout
after insert on public.orders
for each row execute function public.assign_order_manager_and_chat();

insert into public.order_manager_assignments(order_id, manager_id)
select o.order_id, manager.user_id
from public.orders o
cross join lateral (
  select u.user_id
  from public.users u join public.roles r on r.role_id = u.role_id
  where r.role_name = 'manager' and u.status = 'active'
  order by u.created_at limit 1
) manager
on conflict do nothing;

select private.ensure_order_conversation(o.order_id, 'customer_manager', o.user_id, a.manager_id)
from public.orders o join public.order_manager_assignments a using(order_id);

create or replace function public.assign_delivery(p_order_id uuid, p_employee_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_delivery_id uuid; v_customer_id uuid; v_manager_id uuid;
begin
  if not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  if not exists (
    select 1 from public.users u join public.roles r on r.role_id = u.role_id
    where u.user_id = p_employee_id and u.status = 'active' and r.role_name = 'employee'
  ) then raise exception 'Employee is invalid'; end if;
  select user_id into v_customer_id from public.orders
  where order_id = p_order_id and status in ('confirmed','preparing') for update;
  if v_customer_id is null then raise exception 'Order cannot be assigned'; end if;
  insert into public.deliveries(order_id, employee_id) values (p_order_id, p_employee_id)
  on conflict(order_id) do update set employee_id = excluded.employee_id, status = 'assigned'
  returning delivery_id into v_delivery_id;
  update public.orders set status = 'preparing' where order_id = p_order_id;
  select manager_id into v_manager_id from public.order_manager_assignments where order_id = p_order_id;
  perform private.ensure_order_conversation(p_order_id, 'customer_shipper', v_customer_id, p_employee_id);
  if v_manager_id is not null then
    perform private.ensure_order_conversation(p_order_id, 'manager_shipper', v_manager_id, p_employee_id);
  end if;
  insert into public.order_tracking(order_id,status,note,created_by)
  values (p_order_id,'assigned','Delivery assigned',private.current_user_id());
  insert into public.notifications(user_id,title,content,type,target_url) values
    (p_employee_id,'New delivery assignment','A new order has been assigned to you.','delivery_assigned','/shipper/orders/' || p_order_id),
    (v_customer_id,'Order is being prepared','A delivery employee has been assigned to your order.','order_preparing','/orders/' || p_order_id);
  return v_delivery_id;
end $$;

create or replace function public.record_delivery_collection(
  p_delivery_id uuid,
  p_method public.collection_method,
  p_proof_url text default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_delivery public.deliveries; v_payment public.payments; v_collection_id uuid;
begin
  select * into v_delivery from public.deliveries where delivery_id = p_delivery_id for update;
  if v_delivery.delivery_id is null then raise exception 'Delivery not found'; end if;
  if v_delivery.employee_id <> private.current_user_id() and not private.has_role(array['admin','manager']) then
    raise exception 'Forbidden';
  end if;
  if v_delivery.status <> 'delivering' then raise exception 'Payment can only be collected while delivering'; end if;
  select * into v_payment from public.payments where order_id = v_delivery.order_id for update;
  if v_payment.method <> 'cod' then raise exception 'This order is not collect-on-delivery'; end if;
  if p_method = 'customer_payos' and v_payment.status <> 'paid' then
    raise exception 'Customer payOS payment has not been confirmed';
  end if;
  insert into public.delivery_payment_collections(
    delivery_id,payment_id,collected_by,method,amount,status,remittance_status,proof_url
  ) values (
    p_delivery_id,v_payment.payment_id,private.current_user_id(),p_method,v_payment.amount,'collected',
    case when p_method = 'cash' then 'pending'::public.remittance_status else 'not_required'::public.remittance_status end,
    p_proof_url
  )
  on conflict(delivery_id) do update set
    method=excluded.method, proof_url=excluded.proof_url, collected_at=now(),
    remittance_status=excluded.remittance_status, updated_at=now()
  returning collection_id into v_collection_id;
  update public.payments set status='paid', payment_date=coalesce(payment_date,now())
  where payment_id=v_payment.payment_id;
  return v_collection_id;
end $$;

create or replace function public.settle_order_inventory(p_order_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.inventory_transactions
    where type='export' and note like '%order ' || p_order_id::text || '%'
  ) then return; end if;
  if exists (
    select 1 from public.order_items oi left join public.inventory i on i.batch_id=oi.batch_id
    where oi.order_id=p_order_id and (i.batch_id is null or i.quantity_available<oi.quantity or i.quantity_reserved<oi.quantity)
  ) then raise exception 'Inventory settlement failed'; end if;
  update public.inventory i set
    quantity_available=quantity_available-oi.quantity,
    quantity_reserved=quantity_reserved-oi.quantity,last_updated=now()
  from public.order_items oi where oi.order_id=p_order_id and oi.batch_id=i.batch_id;
  insert into public.inventory_transactions(batch_id,type,quantity,note)
  select batch_id,'export',quantity,p_note || ' order ' || p_order_id
  from public.order_items where order_id=p_order_id;
  perform public.sync_batch_statuses();
end $$;

create or replace function public.update_delivery_status(
  p_delivery_id uuid,
  p_status public.delivery_status,
  p_note text default null,
  p_proof_image_url text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare v_delivery public.deliveries; v_customer_id uuid; v_payment public.payments;
begin
  select * into v_delivery from public.deliveries where delivery_id=p_delivery_id for update;
  if v_delivery.delivery_id is null then raise exception 'Delivery not found'; end if;
  if v_delivery.employee_id<>private.current_user_id() and not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  if (v_delivery.status='assigned' and p_status not in ('picked_up','failed'))
    or (v_delivery.status='picked_up' and p_status not in ('delivering','failed'))
    or (v_delivery.status='delivering' and p_status not in ('delivered','failed')) then
    raise exception 'Invalid delivery status transition';
  end if;
  if p_status='picked_up' and exists (
    select 1 from (select distinct batch_id from public.order_items where order_id=v_delivery.order_id) required
    left join public.delivery_batch_checks checked on checked.delivery_id=p_delivery_id and checked.batch_id=required.batch_id and checked.matched
    where checked.check_id is null
  ) then raise exception 'Every order batch must be verified before pickup'; end if;
  if p_status='delivered' and nullif(trim(p_proof_image_url),'') is null then raise exception 'Delivery proof image is required'; end if;
  select * into v_payment from public.payments where order_id=v_delivery.order_id for update;
  if p_status='delivered' and v_payment.method='cod' and not exists (
    select 1 from public.delivery_payment_collections where delivery_id=p_delivery_id and status in ('collected','verified')
  ) then raise exception 'Record COD collection before completing delivery'; end if;
  if p_status='delivered' and v_payment.status<>'paid' then raise exception 'Payment must be paid before completing delivery'; end if;
  update public.deliveries set status=p_status,note=p_note,
    proof_image_url=coalesce(p_proof_image_url,proof_image_url),
    pickup_time=case when p_status='picked_up' then now() else pickup_time end,
    delivery_time=case when p_status='delivered' then now() else delivery_time end
  where delivery_id=p_delivery_id;
  update public.orders set status=case
    when p_status in ('picked_up','delivering') then 'delivering'::public.order_status
    when p_status='delivered' then 'completed'::public.order_status
    when p_status='failed' then 'confirmed'::public.order_status else status end
  where order_id=v_delivery.order_id returning user_id into v_customer_id;
  insert into public.order_tracking(order_id,status,note,created_by)
  values(v_delivery.order_id,p_status::text,p_note,private.current_user_id());
  insert into public.notifications(user_id,title,content,type,target_url)
  values(v_customer_id,'Delivery update','New status: ' || p_status::text,'delivery_status','/orders/' || v_delivery.order_id);
  if p_status='delivered' then perform public.settle_order_inventory(v_delivery.order_id,'Delivered'); end if;
end $$;

create or replace function public.confirm_payos_request(
  p_provider_order_code bigint,
  p_amount numeric,
  p_transaction_id text,
  p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_request public.payos_requests; v_order_id uuid; v_customer_id uuid;
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
      provider_payload=p_payload,payment_date=now() where payment_id=v_request.payment_id;
    if v_request.purpose='checkout' then
      update public.orders set status='confirmed' where order_id=v_order_id and status='pending';
      insert into public.order_tracking(order_id,status,note)
      values(v_order_id,'confirmed','payOS checkout payment confirmed');
    end if;
    insert into public.notifications(user_id,title,content,type,target_url)
    values(v_customer_id,'Payment successful','The payOS payment was confirmed.','payment_paid','/orders/' || v_order_id);
  else
    update public.delivery_payment_collections set remittance_status='paid',remitted_at=now(),updated_at=now()
    where collection_id=v_request.collection_id;
  end if;
  return v_request.payment_id;
end $$;

create or replace function public.list_my_chat_rooms()
returns table(
  room_id uuid, room_type public.chat_room_type, order_id uuid, order_code bigint,
  peer_user_id uuid, peer_name text, peer_avatar_url text, peer_email text,
  peer_phone text, peer_role text, created_at timestamptz
) language sql stable security definer set search_path=public
as $$
  select r.room_id,r.type,r.order_id,o.order_code,u.user_id,u.name,u.avatar_url,u.email,u.phone,role.role_name,r.created_at
  from public.chat_rooms r
  join public.chat_room_members mine on mine.room_id=r.room_id and mine.user_id=private.current_user_id()
  left join public.orders o on o.order_id=r.order_id
  left join public.chat_room_members other on other.room_id=r.room_id and other.user_id<>private.current_user_id()
  left join public.users u on u.user_id=other.user_id
  left join public.roles role on role.role_id=u.role_id
  order by r.created_at desc
$$;

create or replace function public.validate_chat_share()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if new.shared_order_id is not null and not exists (
    select 1 from public.chat_rooms r where r.room_id=new.room_id and r.order_id=new.shared_order_id
  ) and not private.has_role(array['admin','manager']) then
    raise exception 'Only the related order can be shared in this conversation';
  end if;
  return new;
end $$;
create trigger validate_chat_share_before_insert
before insert on public.chat_messages for each row execute function public.validate_chat_share();

alter table public.order_manager_assignments enable row level security;
alter table public.delivery_payment_collections enable row level security;
alter table public.payos_requests enable row level security;

create policy order_manager_members_read on public.order_manager_assignments for select to authenticated using (
  manager_id=private.current_user_id()
  or exists(select 1 from public.orders o where o.order_id=order_manager_assignments.order_id and o.user_id=private.current_user_id())
  or private.has_role(array['admin'])
);
create policy collections_participant_read on public.delivery_payment_collections for select to authenticated using (
  collected_by=private.current_user_id()
  or exists(select 1 from public.deliveries d join public.orders o on o.order_id=d.order_id where d.delivery_id=delivery_payment_collections.delivery_id and o.user_id=private.current_user_id())
  or private.has_role(array['admin','manager'])
);
create policy payos_requests_participant_read on public.payos_requests for select to authenticated using (
  requested_by=private.current_user_id()
  or exists(select 1 from public.payments p join public.orders o on o.order_id=p.order_id where p.payment_id=payos_requests.payment_id and o.user_id=private.current_user_id())
  or private.has_role(array['admin','manager'])
);

grant select on public.order_manager_assignments,public.delivery_payment_collections,public.payos_requests to authenticated;
grant execute on function public.record_delivery_collection(uuid,public.collection_method,text) to authenticated;
grant execute on function public.list_my_chat_rooms() to authenticated;
revoke execute on function public.confirm_payos_request(bigint,numeric,text,jsonb) from public,anon,authenticated;
revoke execute on function public.settle_order_inventory(uuid,text) from public,anon,authenticated;
revoke execute on function private.ensure_order_conversation(uuid,public.chat_room_type,uuid,uuid) from public,anon,authenticated;

alter publication supabase_realtime add table public.delivery_payment_collections;
alter publication supabase_realtime add table public.payos_requests;
