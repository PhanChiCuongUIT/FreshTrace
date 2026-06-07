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
  v_employee_id uuid;
  v_room_id uuid;
  v_pair text[];
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
    if p_order_id is not null and not exists (
      select 1 from public.orders where order_id = p_order_id and user_id = v_customer_id
    ) then
      raise exception 'Customer does not own this order';
    end if;
    if p_product_id is not null and not exists (
      select 1 from public.products where product_id = p_product_id and status = 'active'
    ) then
      raise exception 'Product is not available';
    end if;
  end if;

  select r.room_id into v_room_id
  from public.chat_rooms r
  where r.type = p_type
    and r.order_id is not distinct from p_order_id
    and r.product_id is not distinct from p_product_id
    and exists (
      select 1 from public.chat_room_members m
      where m.room_id = r.room_id and m.user_id = v_me
    )
    and exists (
      select 1 from public.chat_room_members m
      where m.room_id = r.room_id and m.user_id = p_other_user_id
    )
  limit 1;

  if v_room_id is not null then return v_room_id; end if;

  insert into public.chat_rooms (type, order_id, product_id, created_by)
  values (p_type, p_order_id, p_product_id, v_me)
  returning room_id into v_room_id;

  insert into public.chat_room_members (room_id, user_id, role_in_room) values
    (v_room_id, v_me, v_my_role),
    (v_room_id, p_other_user_id, v_other_role);
  return v_room_id;
end $$;

grant execute on function public.create_chat_room(
  public.chat_room_type, uuid, uuid, uuid
) to authenticated;
