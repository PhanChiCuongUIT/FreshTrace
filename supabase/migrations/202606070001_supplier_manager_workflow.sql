drop policy if exists suppliers_manager_insert on public.suppliers;
create policy suppliers_manager_insert on public.suppliers
for insert to authenticated
with check (
  private.has_role(array['manager'])
  and status = 'pending'
  and approved_by is null
  and approved_at is null
);

drop policy if exists suppliers_manager_update_pending on public.suppliers;
create policy suppliers_manager_update_pending on public.suppliers
for update to authenticated
using (
  private.has_role(array['manager'])
  and status = 'pending'
)
with check (
  private.has_role(array['manager'])
  and status = 'pending'
  and approved_by is null
  and approved_at is null
);

drop policy if exists users_chat_member_read on public.users;
create policy users_chat_member_read on public.users
for select to authenticated
using (
  exists (
    select 1
    from public.chat_room_members mine
    join public.chat_room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = private.current_user_id()
      and theirs.user_id = users.user_id
  )
);

create or replace function public.list_chat_contacts()
returns table (
  user_id uuid,
  name text,
  role_name text,
  order_id uuid,
  order_code bigint,
  room_type public.chat_room_type
) language sql stable security definer set search_path = public
as $$
  with me as (
    select u.user_id, r.role_name
    from public.users u join public.roles r on r.role_id = u.role_id
    where u.user_id = private.current_user_id() and u.status = 'active'
  )
  select distinct contact.user_id, contact.name, role.role_name, relation.order_id,
    relation.order_code, relation.room_type
  from me
  cross join lateral (
    select u.user_id, u.name, u.role_id
    from public.users u
    where u.status = 'active' and u.user_id <> me.user_id
  ) contact
  join public.roles role on role.role_id = contact.role_id
  cross join lateral (
    select null::uuid order_id, null::bigint order_code,
      'customer_manager'::public.chat_room_type room_type
    where me.role_name = 'customer' and role.role_name = 'manager'
    union all
    select o.order_id, o.order_code, 'customer_shipper'::public.chat_room_type
    from public.orders o join public.deliveries d on d.order_id = o.order_id
    where me.role_name = 'customer' and role.role_name = 'employee'
      and o.user_id = me.user_id and d.employee_id = contact.user_id
    union all
    select o.order_id, o.order_code, 'manager_shipper'::public.chat_room_type
    from public.deliveries d join public.orders o on o.order_id = d.order_id
    where me.role_name = 'manager' and role.role_name = 'employee'
      and d.employee_id = contact.user_id
    union all
    select null::uuid, null::bigint, 'manager_admin'::public.chat_room_type
    where me.role_name = 'manager' and role.role_name = 'admin'
    union all
    select o.order_id, o.order_code, 'manager_shipper'::public.chat_room_type
    from public.deliveries d join public.orders o on o.order_id = d.order_id
    where me.role_name = 'employee' and role.role_name = 'manager'
      and d.employee_id = me.user_id
    union all
    select o.order_id, o.order_code, 'customer_shipper'::public.chat_room_type
    from public.deliveries d join public.orders o on o.order_id = d.order_id
    where me.role_name = 'employee' and role.role_name = 'customer'
      and d.employee_id = me.user_id and o.user_id = contact.user_id
    union all
    select null::uuid, null::bigint, 'manager_admin'::public.chat_room_type
    where me.role_name = 'admin' and role.role_name = 'manager'
  ) relation
  order by contact.name, relation.order_code nulls first
$$;

grant execute on function public.list_chat_contacts() to authenticated;

create or replace function public.mark_order_preparing(p_order_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not private.has_role(array['admin','manager']) then
    raise exception 'Forbidden';
  end if;
  select * into v_order from public.orders where order_id = p_order_id for update;
  if v_order.order_id is null then raise exception 'Order not found'; end if;
  if v_order.status <> 'confirmed' then raise exception 'Only confirmed orders can enter preparation'; end if;
  update public.orders set status = 'preparing' where order_id = p_order_id;
  insert into public.order_tracking (order_id, status, note, created_by)
  values (p_order_id, 'preparing', 'Order preparation started', private.current_user_id());
  insert into public.notifications (user_id, title, content, type, target_url)
  values (v_order.user_id, 'Order is being prepared', 'Your order is being packed for delivery.',
    'order_status', '/orders');
end
$$;

grant execute on function public.mark_order_preparing(uuid) to authenticated;
