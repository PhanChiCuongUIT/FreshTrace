create or replace function public.delete_catalog_record(
  p_entity text,
  p_id uuid
) returns void language plpgsql security definer set search_path = public
as $$
declare
  v_deleted integer;
begin
  if not private.has_role(array['admin','manager']) then
    raise exception 'Forbidden';
  end if;

  case p_entity
    when 'supplier' then delete from public.suppliers where supplier_id = p_id;
    when 'category' then delete from public.categories where category_id = p_id;
    when 'product' then delete from public.products where product_id = p_id;
    when 'batch' then delete from public.batches where batch_id = p_id;
    when 'price' then delete from public.prices where price_id = p_id;
    when 'rescue' then delete from public.fresh_rescue_deals where deal_id = p_id;
    else raise exception 'Unsupported catalog entity';
  end case;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then raise exception 'Catalog record not found'; end if;
exception
  when foreign_key_violation then
    raise exception 'Cannot delete % because related FreshTrace records still reference it. Deactivate or lock it instead.', p_entity;
end $$;

grant execute on function public.delete_catalog_record(text, uuid) to authenticated;
