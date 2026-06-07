create table public.delivery_batch_checks (
  check_id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(delivery_id) on delete cascade,
  batch_id uuid not null references public.batches(batch_id),
  matched boolean not null,
  checked_by uuid not null references public.users(user_id),
  checked_at timestamptz not null default now(),
  unique (delivery_id, batch_id)
);

create index idx_delivery_batch_checks_delivery
  on public.delivery_batch_checks(delivery_id, matched);

alter table public.delivery_batch_checks enable row level security;
grant select on public.delivery_batch_checks to authenticated;

create policy delivery_batch_checks_visible
on public.delivery_batch_checks for select to authenticated
using (
  exists (
    select 1 from public.deliveries d
    where d.delivery_id = delivery_batch_checks.delivery_id
      and private.can_view_order(d.order_id)
  )
);

create or replace function public.validate_product_supplier()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.supplier_id is not null and not exists (
    select 1 from public.suppliers
    where supplier_id = new.supplier_id and status = 'approved'
  ) then
    raise exception 'Product supplier must be approved';
  end if;
  return new;
end $$;

create trigger validate_product_supplier_before_write
before insert or update of supplier_id on public.products
for each row execute function public.validate_product_supplier();

create or replace function public.validate_batch_write()
returns trigger language plpgsql set search_path = public
as $$
declare v_product_supplier uuid;
begin
  select supplier_id into v_product_supplier
  from public.products where product_id = new.product_id and status = 'active';
  if not found then raise exception 'Batch product must be active'; end if;
  if new.supplier_id is not null and not exists (
    select 1 from public.suppliers
    where supplier_id = new.supplier_id and status = 'approved'
  ) then
    raise exception 'Batch supplier must be approved';
  end if;
  if v_product_supplier is not null
     and new.supplier_id is distinct from v_product_supplier then
    raise exception 'Batch supplier must match product supplier';
  end if;
  if tg_op = 'UPDATE' then
    if new.product_id is distinct from old.product_id then
      raise exception 'Batch product cannot be changed';
    end if;
    if new.quantity is distinct from old.quantity then
      raise exception 'Use adjust_inventory to change stock';
    end if;
  end if;
  return new;
end $$;

create trigger validate_batch_before_write
before insert or update on public.batches
for each row execute function public.validate_batch_write();

create or replace function public.validate_cart_item()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_available integer;
begin
  select i.quantity_available - i.quantity_reserved into v_available
  from public.batches b
  join public.products p on p.product_id = b.product_id
  join public.inventory i on i.batch_id = b.batch_id
  where b.batch_id = new.batch_id
    and b.product_id = new.product_id
    and b.status in ('available', 'near_expiry')
    and b.expire_date >= current_date
    and p.status = 'active';
  if v_available is null then
    raise exception 'Product and batch are not available or do not match';
  end if;
  if new.quantity > v_available then
    raise exception 'Cart quantity exceeds available stock';
  end if;
  return new;
end $$;

create trigger validate_cart_item_before_write
before insert or update of product_id, batch_id, quantity on public.cart_items
for each row execute function public.validate_cart_item();

create or replace function public.validate_price()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.batch_id is not null and not exists (
    select 1 from public.batches
    where batch_id = new.batch_id and product_id = new.product_id
  ) then
    raise exception 'Price batch must belong to product';
  end if;
  return new;
end $$;

create trigger validate_price_before_write
before insert or update on public.prices
for each row execute function public.validate_price();

create or replace function public.validate_rescue_deal()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_expire_date date; v_stock integer;
begin
  select b.expire_date, i.quantity_available - i.quantity_reserved
  into v_expire_date, v_stock
  from public.batches b
  join public.inventory i on i.batch_id = b.batch_id
  where b.batch_id = new.batch_id
    and b.status in ('available', 'near_expiry')
    and b.expire_date between current_date and current_date + 3;
  if v_expire_date is null then
    raise exception 'Fresh Rescue requires a non-expired batch within 3 days of expiry';
  end if;
  if v_stock <= 0 then raise exception 'Fresh Rescue batch is out of stock'; end if;
  if new.end_at > (v_expire_date + interval '1 day') then
    raise exception 'Fresh Rescue cannot end after batch expiry';
  end if;
  if exists (
    select 1 from public.fresh_rescue_deals d
    where d.batch_id = new.batch_id and d.status = 'active'
      and d.deal_id is distinct from new.deal_id
  ) then
    raise exception 'Batch already has an active Fresh Rescue deal';
  end if;
  return new;
end $$;

create trigger validate_rescue_deal_before_write
before insert or update on public.fresh_rescue_deals
for each row execute function public.validate_rescue_deal();

create or replace function public.adjust_inventory(
  p_batch_id uuid,
  p_new_quantity integer,
  p_note text
) returns void language plpgsql security definer set search_path = public
as $$
declare v_inventory public.inventory; v_delta integer;
begin
  if not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  if p_new_quantity < 0 then raise exception 'Quantity cannot be negative'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Adjustment note is required'; end if;

  select * into v_inventory from public.inventory
  where batch_id = p_batch_id for update;
  if v_inventory.inventory_id is null then raise exception 'Inventory not found'; end if;
  if p_new_quantity < v_inventory.quantity_reserved then
    raise exception 'Quantity cannot be lower than reserved stock';
  end if;
  v_delta := p_new_quantity - v_inventory.quantity_available;
  if v_delta = 0 then return; end if;

  update public.inventory set
    quantity_available = p_new_quantity,
    last_updated = now()
  where inventory_id = v_inventory.inventory_id;
  insert into public.inventory_transactions (batch_id, type, quantity, note, created_by)
  values (
    p_batch_id,
    'adjust',
    abs(v_delta),
    trim(p_note) || case when v_delta > 0 then ' (increase)' else ' (decrease)' end,
    private.current_user_id()
  );
  perform public.sync_batch_statuses();
end $$;

drop policy inventory_manager_write on public.inventory;
drop policy inventory_transactions_manager_write on public.inventory_transactions;
grant execute on function public.adjust_inventory(uuid, integer, text) to authenticated;

drop policy orders_manager_update on public.orders;

create or replace function public.protect_notification_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  if not private.has_role(array['admin','manager']) then
    new.user_id := old.user_id;
    new.title := old.title;
    new.content := old.content;
    new.type := old.type;
    new.target_url := old.target_url;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

create trigger protect_notification_before_update
before update on public.notifications
for each row execute function public.protect_notification_update();

create or replace function public.protect_review_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.user_id := old.user_id;
  new.product_id := old.product_id;
  new.order_id := old.order_id;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger protect_review_before_update
before update on public.reviews
for each row execute function public.protect_review_update();

create or replace function public.protect_report_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.user_id := old.user_id;
  new.order_id := old.order_id;
  new.product_id := old.product_id;
  new.type := old.type;
  new.description := old.description;
  new.attachment_url := old.attachment_url;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger protect_report_before_update
before update on public.reports
for each row execute function public.protect_report_update();

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

  insert into public.delivery_batch_checks (delivery_id, batch_id, matched, checked_by)
  values (p_delivery_id, p_batch_id, v_matches, private.current_user_id())
  on conflict (delivery_id, batch_id) do update set
    matched = excluded.matched,
    checked_by = excluded.checked_by,
    checked_at = now();

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
  if p_status = 'picked_up' and exists (
    select 1
    from (select distinct batch_id from public.order_items where order_id = v_delivery.order_id) required
    left join public.delivery_batch_checks checked
      on checked.delivery_id = p_delivery_id
      and checked.batch_id = required.batch_id
      and checked.matched
    where checked.check_id is null
  ) then
    raise exception 'Every order batch must be verified before pickup';
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

  v_customer_id := case when v_my_role = 'customer' then v_me
                        when v_other_role = 'customer' then p_other_user_id end;
  v_employee_id := case when v_my_role = 'employee' then v_me
                        when v_other_role = 'employee' then p_other_user_id end;

  if p_type = 'customer_shipper' and not exists (
    select 1 from public.orders o
    join public.deliveries d on d.order_id = o.order_id
    where o.order_id = p_order_id
      and o.user_id = v_customer_id
      and d.employee_id = v_employee_id
  ) then raise exception 'Customer and shipper are not linked to this order'; end if;

  if p_type = 'manager_shipper' and not exists (
    select 1 from public.deliveries
    where order_id = p_order_id and employee_id = v_employee_id
  ) then raise exception 'Shipper is not assigned to this order'; end if;

  if p_type = 'customer_manager' then
    if p_order_id is not null and not exists (
      select 1 from public.orders where order_id = p_order_id and user_id = v_customer_id
    ) then raise exception 'Customer does not own this order'; end if;
    if p_product_id is not null and not exists (
      select 1 from public.products where product_id = p_product_id and status = 'active'
    ) then raise exception 'Product is not available'; end if;
    if p_order_id is null and p_product_id is null then
      raise exception 'Customer-manager chat requires an order or product';
    end if;
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

create or replace function public.approve_supplier(
  p_supplier_id uuid,
  p_status public.approval_status,
  p_response text default null
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if not private.has_role(array['admin']) then raise exception 'Forbidden'; end if;
  if p_status = 'pending' then raise exception 'Use approved or rejected'; end if;
  update public.suppliers set
    status = p_status,
    approved_by = private.current_user_id(),
    approved_at = now(),
    description = coalesce(p_response, description)
  where supplier_id = p_supplier_id;
  if not found then raise exception 'Supplier not found'; end if;
end $$;

create or replace function public.resolve_report(
  p_report_id uuid,
  p_status public.report_status,
  p_response text
) returns void language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid;
begin
  if not private.has_role(array['admin']) then raise exception 'Forbidden'; end if;
  if p_status not in ('processing','resolved','rejected') then
    raise exception 'Invalid report status';
  end if;
  update public.reports set
    status = p_status,
    response = nullif(trim(p_response), ''),
    resolved_by = private.current_user_id(),
    resolved_at = case when p_status in ('resolved','rejected') then now() else null end
  where report_id = p_report_id
  returning user_id into v_user_id;
  if v_user_id is null then raise exception 'Report not found'; end if;
  insert into public.notifications (user_id, title, content, type, target_url)
  values (
    v_user_id,
    'Report update',
    coalesce(nullif(trim(p_response), ''), 'New status: ' || p_status::text),
    'report_status',
    '/reports/' || p_report_id
  );
end $$;

create or replace function public.notify_operational_events()
returns void language plpgsql security definer set search_path = public
as $$
begin
  perform public.sync_batch_statuses();
  insert into public.notifications (user_id, title, content, type, target_url)
  select u.user_id, 'Batch nearing expiration',
    'Batch ' || b.batch_code || ' expires on ' || b.expire_date,
    'batch_near_expiry', '/manager/batches/' || b.batch_id
  from public.batches b
  cross join public.users u
  join public.roles r on r.role_id = u.role_id and r.role_name = 'manager'
  where b.status = 'near_expiry' and u.status = 'active'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = u.user_id
        and n.type = 'batch_near_expiry'
        and n.target_url = '/manager/batches/' || b.batch_id
        and n.created_at >= current_date
    );
end $$;

grant execute on function public.approve_supplier(uuid, public.approval_status, text) to authenticated;
grant execute on function public.resolve_report(uuid, public.report_status, text) to authenticated;
revoke execute on function public.notify_operational_events() from public, anon, authenticated;

create or replace function public.notify_new_order()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, content, type, target_url)
  select u.user_id, 'New order', 'A new order requires processing.',
    'new_order', '/manager/orders/' || new.order_id
  from public.users u join public.roles r on r.role_id = u.role_id
  where r.role_name = 'manager' and u.status = 'active';
  return new;
end $$;

create trigger notify_managers_on_new_order
after insert on public.orders
for each row execute function public.notify_new_order();

create or replace function public.notify_new_supplier()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, content, type, target_url)
  select u.user_id, 'Supplier pending approval', new.name,
    'supplier_pending', '/admin/suppliers/' || new.supplier_id
  from public.users u join public.roles r on r.role_id = u.role_id
  where r.role_name = 'admin' and u.status = 'active';
  return new;
end $$;

create trigger notify_admins_on_new_supplier
after insert on public.suppliers
for each row when (new.status = 'pending')
execute function public.notify_new_supplier();

create or replace function public.notify_new_report()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, content, type, target_url)
  select u.user_id, 'New report', left(new.description, 160),
    'new_report', '/admin/reports/' || new.report_id
  from public.users u join public.roles r on r.role_id = u.role_id
  where r.role_name = 'admin' and u.status = 'active';
  return new;
end $$;

create trigger notify_admins_on_new_report
after insert on public.reports
for each row execute function public.notify_new_report();
