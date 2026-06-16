create or replace function private.ensure_order_conversation(
  p_order_id uuid,
  p_type public.chat_room_type,
  p_first_user uuid,
  p_second_user uuid
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_room_id uuid;
  v_room_order_id uuid := p_order_id;
begin
  if p_type = 'customer_manager' then
    v_room_order_id := null;
  end if;

  select r.room_id into v_room_id
  from public.chat_rooms r
  where r.type = p_type
    and (
      (p_type = 'customer_manager')
      or r.order_id = v_room_order_id
    )
    and exists (select 1 from public.chat_room_members m where m.room_id = r.room_id and m.user_id = p_first_user)
    and exists (select 1 from public.chat_room_members m where m.room_id = r.room_id and m.user_id = p_second_user)
  order by r.created_at, r.room_id
  limit 1;

  if v_room_id is null then
    insert into public.chat_rooms(type, order_id, product_id, created_by)
    values (p_type, v_room_order_id, null, p_first_user)
    returning room_id into v_room_id;

    insert into public.chat_room_members(room_id, user_id, role_in_room)
    values (v_room_id, p_first_user, 'member'), (v_room_id, p_second_user, 'member')
    on conflict do nothing;
  end if;

  return v_room_id;
end $$;

create or replace function public.create_chat_room(
  p_type public.chat_room_type,
  p_other_user_id uuid,
  p_order_id uuid default null,
  p_product_id uuid default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := private.current_user_id();
  v_my_role text;
  v_other_role text;
  v_customer_id uuid;
  v_manager_id uuid;
  v_employee_id uuid;
  v_room_id uuid;
  v_pair text[];
  v_room_order_id uuid := p_order_id;
  v_room_product_id uuid := p_product_id;
begin
  select r.role_name into v_my_role
  from public.users u join public.roles r on r.role_id = u.role_id
  where u.user_id = v_me and u.status = 'active';

  select r.role_name into v_other_role
  from public.users u join public.roles r on r.role_id = u.role_id
  where u.user_id = p_other_user_id and u.status = 'active';

  if v_my_role is null or v_other_role is null or v_me = p_other_user_id then
    raise exception 'Invalid chat members';
  end if;

  v_pair := array[v_my_role, v_other_role];
  if (p_type = 'customer_shipper' and not (v_pair @> array['customer','employee']))
    or (p_type = 'customer_manager' and not (v_pair @> array['customer','manager']))
    or (p_type = 'manager_shipper' and not (v_pair @> array['manager','employee']))
    or (p_type = 'manager_admin' and not (v_pair @> array['manager','admin'])) then
    raise exception 'Roles do not match chat room type';
  end if;

  v_customer_id := case
    when v_my_role = 'customer' then v_me
    when v_other_role = 'customer' then p_other_user_id
  end;
  v_manager_id := case
    when v_my_role = 'manager' then v_me
    when v_other_role = 'manager' then p_other_user_id
  end;
  v_employee_id := case
    when v_my_role = 'employee' then v_me
    when v_other_role = 'employee' then p_other_user_id
  end;

  if p_type = 'customer_shipper' and not exists (
    select 1 from public.orders o
    join public.deliveries d on d.order_id = o.order_id
    where o.order_id = p_order_id
      and o.user_id = v_customer_id
      and d.employee_id = v_employee_id
  ) then
    raise exception 'Customer and shipper are not linked to this order';
  end if;

  if p_type = 'manager_shipper' and not exists (
    select 1 from public.deliveries
    where order_id = p_order_id and employee_id = v_employee_id
  ) then
    raise exception 'Shipper is not assigned to this order';
  end if;

  if p_type = 'customer_manager' then
    v_room_order_id := null;
    v_room_product_id := null;

    if p_order_id is not null and not exists (
      select 1
      from public.orders o
      join public.order_manager_assignments a on a.order_id = o.order_id
      where o.order_id = p_order_id
        and o.user_id = v_customer_id
        and a.manager_id = v_manager_id
    ) then
      raise exception 'Customer and manager are not linked to this order';
    end if;

    if p_product_id is not null and not exists (
      select 1 from public.products where product_id = p_product_id and status = 'active'
    ) then
      raise exception 'Product is not available';
    end if;
  end if;

  if p_type = 'customer_manager' then
    select r.room_id into v_room_id
    from public.chat_rooms r
    where r.type = p_type
      and exists (
        select 1 from public.chat_room_members m
        where m.room_id = r.room_id and m.user_id = v_me
      )
      and exists (
        select 1 from public.chat_room_members m
        where m.room_id = r.room_id and m.user_id = p_other_user_id
      )
    order by r.created_at, r.room_id
    limit 1;
  else
    select r.room_id into v_room_id
    from public.chat_rooms r
    where r.type = p_type
      and r.order_id is not distinct from v_room_order_id
      and r.product_id is not distinct from v_room_product_id
      and exists (
        select 1 from public.chat_room_members m
        where m.room_id = r.room_id and m.user_id = v_me
      )
      and exists (
        select 1 from public.chat_room_members m
        where m.room_id = r.room_id and m.user_id = p_other_user_id
      )
    limit 1;
  end if;

  if v_room_id is not null then return v_room_id; end if;

  insert into public.chat_rooms (type, order_id, product_id, created_by)
  values (p_type, v_room_order_id, v_room_product_id, v_me)
  returning room_id into v_room_id;

  insert into public.chat_room_members (room_id, user_id, role_in_room) values
    (v_room_id, v_me, v_my_role),
    (v_room_id, p_other_user_id, v_other_role);

  return v_room_id;
end $$;

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
    select o.order_id, o.order_code, 'customer_manager'::public.chat_room_type
    from public.orders o
    join public.order_manager_assignments a on a.order_id = o.order_id
    where me.role_name = 'customer'
      and role.role_name = 'manager'
      and o.user_id = me.user_id
      and a.manager_id = contact.user_id
    union all
    select null::uuid, null::bigint, 'customer_manager'::public.chat_room_type
    from public.order_manager_assignments a
    join public.orders o on o.order_id = a.order_id
    where me.role_name = 'manager'
      and role.role_name = 'customer'
      and a.manager_id = me.user_id
      and o.user_id = contact.user_id
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

with customer_manager_rooms as (
  select
    r.room_id,
    r.created_at,
    min(m.user_id) filter (where role.role_name = 'customer') as customer_id,
    min(m.user_id) filter (where role.role_name = 'manager') as manager_id
  from public.chat_rooms r
  join public.chat_room_members m on m.room_id = r.room_id
  join public.users u on u.user_id = m.user_id
  join public.roles role on role.role_id = u.role_id
  where r.type = 'customer_manager'
  group by r.room_id, r.created_at
),
ranked as (
  select *,
    first_value(room_id) over (
      partition by customer_id, manager_id
      order by created_at, room_id
    ) as keeper_id
  from customer_manager_rooms
  where customer_id is not null and manager_id is not null
),
duplicates as (
  select room_id, keeper_id
  from ranked
  where room_id <> keeper_id
)
update public.chat_messages message
set room_id = duplicates.keeper_id
from duplicates
where message.room_id = duplicates.room_id;

with customer_manager_rooms as (
  select
    r.room_id,
    r.created_at,
    min(m.user_id) filter (where role.role_name = 'customer') as customer_id,
    min(m.user_id) filter (where role.role_name = 'manager') as manager_id
  from public.chat_rooms r
  join public.chat_room_members m on m.room_id = r.room_id
  join public.users u on u.user_id = m.user_id
  join public.roles role on role.role_id = u.role_id
  where r.type = 'customer_manager'
  group by r.room_id, r.created_at
),
ranked as (
  select *,
    first_value(room_id) over (
      partition by customer_id, manager_id
      order by created_at, room_id
    ) as keeper_id
  from customer_manager_rooms
  where customer_id is not null and manager_id is not null
),
duplicates as (
  select room_id, keeper_id
  from ranked
  where room_id <> keeper_id
)
update public.notifications notification
set target_url = '/chat/' || duplicates.keeper_id
from duplicates
where notification.target_url = '/chat/' || duplicates.room_id;

with customer_manager_rooms as (
  select
    r.room_id,
    r.created_at,
    min(m.user_id) filter (where role.role_name = 'customer') as customer_id,
    min(m.user_id) filter (where role.role_name = 'manager') as manager_id
  from public.chat_rooms r
  join public.chat_room_members m on m.room_id = r.room_id
  join public.users u on u.user_id = m.user_id
  join public.roles role on role.role_id = u.role_id
  where r.type = 'customer_manager'
  group by r.room_id, r.created_at
),
ranked as (
  select *,
    first_value(room_id) over (
      partition by customer_id, manager_id
      order by created_at, room_id
    ) as keeper_id
  from customer_manager_rooms
  where customer_id is not null and manager_id is not null
),
duplicates as (
  select room_id
  from ranked
  where room_id <> keeper_id
)
delete from public.chat_room_members member
using duplicates
where member.room_id = duplicates.room_id;

with customer_manager_rooms as (
  select
    r.room_id,
    r.created_at,
    min(m.user_id) filter (where role.role_name = 'customer') as customer_id,
    min(m.user_id) filter (where role.role_name = 'manager') as manager_id
  from public.chat_rooms r
  left join public.chat_room_members m on m.room_id = r.room_id
  left join public.users u on u.user_id = m.user_id
  left join public.roles role on role.role_id = u.role_id
  where r.type = 'customer_manager'
  group by r.room_id, r.created_at
),
ranked as (
  select *,
    first_value(room_id) over (
      partition by customer_id, manager_id
      order by created_at, room_id
    ) as keeper_id
  from customer_manager_rooms
  where customer_id is not null and manager_id is not null
),
duplicates as (
  select room_id
  from ranked
  where room_id <> keeper_id
)
delete from public.chat_rooms room
using duplicates
where room.room_id = duplicates.room_id;

update public.chat_rooms
set order_id = null,
    product_id = null
where type = 'customer_manager';

grant execute on function public.create_chat_room(
  public.chat_room_type, uuid, uuid, uuid
) to authenticated;
grant execute on function public.list_chat_contacts() to authenticated;
revoke execute on function private.ensure_order_conversation(uuid, public.chat_room_type, uuid, uuid)
from public, anon, authenticated;
