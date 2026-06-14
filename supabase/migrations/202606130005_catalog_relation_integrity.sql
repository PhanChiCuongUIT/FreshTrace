create or replace function public.validate_product_supplier()
returns trigger language plpgsql set search_path = public
as $$
declare
  v_supplier_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_supplier_changed := new.supplier_id is distinct from old.supplier_id;
    if v_supplier_changed and exists (
      select 1 from public.batches where product_id = old.product_id
    ) then
      raise exception 'Product supplier cannot be changed after batches exist';
    end if;
  end if;

  if v_supplier_changed
     and new.supplier_id is not null
     and not exists (
       select 1 from public.suppliers
       where supplier_id = new.supplier_id and status = 'approved'
     ) then
    raise exception 'Product supplier must be approved';
  end if;
  return new;
end $$;

create or replace function public.validate_batch_write()
returns trigger language plpgsql set search_path = public
as $$
declare
  v_product_supplier uuid;
  v_product_status public.record_status;
  v_supplier_changed boolean := true;
  v_atomic_quantity_update boolean :=
    coalesce(current_setting('freshtrace.atomic_batch_update', true), '') = 'on';
begin
  if tg_op = 'UPDATE' then
    if new.product_id is distinct from old.product_id then
      raise exception 'Batch product cannot be changed';
    end if;
    v_supplier_changed := new.supplier_id is distinct from old.supplier_id;
  end if;

  select supplier_id, status into v_product_supplier, v_product_status
  from public.products where product_id = new.product_id;
  if not found then raise exception 'Batch product does not exist'; end if;
  if tg_op = 'INSERT' and v_product_status <> 'active' then
    raise exception 'Batch product must be active';
  end if;

  if v_supplier_changed
     and new.supplier_id is not null
     and not exists (
       select 1 from public.suppliers
       where supplier_id = new.supplier_id and status = 'approved'
     ) then
    raise exception 'Batch supplier must be approved';
  end if;
  if v_product_supplier is not null
     and new.supplier_id is distinct from v_product_supplier then
    raise exception 'Batch supplier must match product supplier';
  end if;

  if tg_op = 'UPDATE'
     and new.quantity is distinct from old.quantity
     and not v_atomic_quantity_update then
    raise exception 'Use update_batch_and_inventory to change batch quantity';
  end if;
  return new;
end $$;
