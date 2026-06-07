create or replace function public.replace_delivery_proof(
  p_delivery_id uuid,
  p_proof_image_url text
) returns void language plpgsql security definer set search_path=public
as $$
begin
  if p_proof_image_url not like 'https://res.cloudinary.com/%' then
    raise exception 'Delivery proof must be stored on Cloudinary';
  end if;
  update public.deliveries
  set proof_image_url=p_proof_image_url,updated_at=now()
  where delivery_id=p_delivery_id
    and (employee_id=private.current_user_id() or private.has_role(array['admin','manager']));
  if not found then raise exception 'Delivery not found or forbidden'; end if;
end $$;

grant execute on function public.replace_delivery_proof(uuid,text) to authenticated;
