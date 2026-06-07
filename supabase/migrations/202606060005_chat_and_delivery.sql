grant usage on schema private to anon;
grant execute on function private.has_role(text[]) to anon;

create or replace function private.is_chat_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.chat_room_members
    where room_id = p_room_id and user_id = private.current_user_id()
  )
$$;
grant execute on function private.is_chat_member(uuid) to authenticated;

drop policy chat_rooms_member_read on public.chat_rooms;
drop policy chat_rooms_create on public.chat_rooms;
drop policy chat_members_read on public.chat_room_members;
drop policy chat_members_manage on public.chat_room_members;
drop policy chat_messages_member_read on public.chat_messages;
drop policy chat_messages_member_send on public.chat_messages;

create policy chat_rooms_member_read on public.chat_rooms for select to authenticated
using (private.is_chat_member(room_id));
create policy chat_members_read on public.chat_room_members for select to authenticated
using (private.is_chat_member(room_id));
create policy chat_messages_member_read on public.chat_messages for select to authenticated
using (private.is_chat_member(room_id));
create policy chat_messages_member_send on public.chat_messages for insert to authenticated
with check (sender_id = private.current_user_id() and private.is_chat_member(room_id));

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
  v_room_id uuid;
  v_pair text[];
begin
  select r.role_name into v_my_role from public.users u join public.roles r on r.role_id = u.role_id
  where u.user_id = v_me and u.status = 'active';
  select r.role_name into v_other_role from public.users u join public.roles r on r.role_id = u.role_id
  where u.user_id = p_other_user_id and u.status = 'active';
  if v_my_role is null or v_other_role is null or v_me = p_other_user_id then raise exception 'Invalid chat members'; end if;

  v_pair := array[v_my_role, v_other_role];
  if (p_type = 'customer_shipper' and not (v_pair @> array['customer','employee']))
    or (p_type = 'customer_manager' and not (v_pair @> array['customer','manager']))
    or (p_type = 'manager_shipper' and not (v_pair @> array['manager','employee']))
    or (p_type = 'manager_admin' and not (v_pair @> array['manager','admin'])) then
    raise exception 'Roles do not match chat room type';
  end if;

  if p_type in ('customer_shipper','manager_shipper') and p_order_id is null then
    raise exception 'orderId is required for this room type';
  end if;

  select r.room_id into v_room_id
  from public.chat_rooms r
  where r.type = p_type
    and r.order_id is not distinct from p_order_id
    and r.product_id is not distinct from p_product_id
    and exists (select 1 from public.chat_room_members m where m.room_id = r.room_id and m.user_id = v_me)
    and exists (select 1 from public.chat_room_members m where m.room_id = r.room_id and m.user_id = p_other_user_id)
  limit 1;
  if v_room_id is not null then return v_room_id; end if;

  insert into public.chat_rooms (type, order_id, product_id, created_by)
  values (p_type, p_order_id, p_product_id, v_me) returning room_id into v_room_id;
  insert into public.chat_room_members (room_id, user_id, role_in_room) values
    (v_room_id, v_me, v_my_role),
    (v_room_id, p_other_user_id, v_other_role);
  return v_room_id;
end $$;

create or replace function public.mark_chat_read(p_room_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.chat_room_members set last_read_at = now()
  where room_id = p_room_id and user_id = private.current_user_id()
$$;

create or replace function public.verify_delivery_batch(p_delivery_id uuid, p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_delivery public.deliveries; v_batch public.batches; v_matches boolean;
begin
  select * into v_delivery from public.deliveries where delivery_id = p_delivery_id;
  if v_delivery.delivery_id is null then raise exception 'Delivery not found'; end if;
  if v_delivery.employee_id <> private.current_user_id()
     and not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  select * into v_batch from public.batches where batch_id = p_batch_id;
  if v_batch.batch_id is null then raise exception 'Batch not found'; end if;
  select exists (
    select 1 from public.order_items
    where order_id = v_delivery.order_id and batch_id = p_batch_id
  ) into v_matches;
  insert into public.order_tracking (order_id, status, note, created_by)
  values (
    v_delivery.order_id,
    case when v_matches then 'batch_verified' else 'batch_mismatch' end,
    'Scanned batch ' || v_batch.batch_code,
    private.current_user_id()
  );
  return jsonb_build_object(
    'matches', v_matches,
    'batchId', v_batch.batch_id,
    'batchCode', v_batch.batch_code,
    'status', v_batch.status,
    'expireDate', v_batch.expire_date
  );
end $$;

grant execute on function public.create_chat_room(public.chat_room_type, uuid, uuid, uuid) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.verify_delivery_batch(uuid, uuid) to authenticated;
