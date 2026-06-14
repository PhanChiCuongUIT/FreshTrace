create or replace function public.validate_batch_write()
returns trigger language plpgsql set search_path = public
as $$
declare
  v_product_supplier uuid;
  v_atomic_quantity_update boolean :=
    coalesce(current_setting('freshtrace.atomic_batch_update', true), '') = 'on';
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
    if new.quantity is distinct from old.quantity and not v_atomic_quantity_update then
      raise exception 'Use update_batch_and_inventory to change batch quantity';
    end if;
  end if;
  return new;
end $$;

create or replace function public.update_batch_and_inventory(
  p_batch_id uuid,
  p_product_id uuid,
  p_supplier_id uuid,
  p_batch_code text,
  p_harvest_date date,
  p_expire_date date,
  p_quantity integer,
  p_origin_location text,
  p_status public.batch_status
) returns void language plpgsql security definer set search_path = public
as $$
declare
  v_batch public.batches;
  v_inventory public.inventory;
  v_next_available integer;
  v_delta integer;
begin
  if not private.has_role(array['admin','manager']) then raise exception 'Forbidden'; end if;
  if p_quantity < 0 then raise exception 'Batch quantity cannot be negative'; end if;
  if p_expire_date < p_harvest_date then raise exception 'Expiry date cannot be before harvest date'; end if;

  select * into v_batch from public.batches
  where batch_id = p_batch_id for update;
  if v_batch.batch_id is null then raise exception 'Batch not found'; end if;
  if p_product_id is distinct from v_batch.product_id then
    raise exception 'Batch product cannot be changed after creation';
  end if;

  select * into v_inventory from public.inventory
  where batch_id = p_batch_id for update;
  if v_inventory.inventory_id is null then raise exception 'Inventory not found'; end if;

  v_next_available := p_quantity - v_inventory.quantity_reserved;
  if v_next_available < 0 then
    raise exception 'Batch quantity cannot be lower than reserved stock (%)', v_inventory.quantity_reserved;
  end if;

  perform set_config('freshtrace.atomic_batch_update', 'on', true);
  update public.batches set
    supplier_id = p_supplier_id,
    batch_code = trim(p_batch_code),
    harvest_date = p_harvest_date,
    expire_date = p_expire_date,
    quantity = p_quantity,
    origin_location = nullif(trim(p_origin_location), ''),
    status = p_status,
    updated_at = now()
  where batch_id = p_batch_id;
  perform set_config('freshtrace.atomic_batch_update', 'off', true);

  v_delta := v_next_available - v_inventory.quantity_available;
  if v_delta <> 0 then
    update public.inventory set quantity_available = v_next_available, last_updated = now()
    where inventory_id = v_inventory.inventory_id;
    insert into public.inventory_transactions(batch_id,type,quantity,note,created_by)
    values(
      p_batch_id,
      'adjust',
      abs(v_delta),
      '[batch quantity edit] ' || v_batch.quantity || ' -> ' || p_quantity ||
        case when v_delta > 0 then ' (increase)' else ' (decrease)' end,
      private.current_user_id()
    );
  end if;
  perform public.sync_batch_statuses();
end $$;

