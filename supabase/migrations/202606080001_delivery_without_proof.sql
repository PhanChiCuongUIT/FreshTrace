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

grant execute on function public.update_delivery_status(uuid, public.delivery_status, text, text) to authenticated;
