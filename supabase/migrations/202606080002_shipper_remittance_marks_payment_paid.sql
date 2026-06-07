create or replace function public.confirm_payos_request(
  p_provider_order_code bigint,
  p_amount numeric,
  p_transaction_id text,
  p_payload jsonb
) returns uuid language plpgsql security definer set search_path=public
as $$
declare
  v_request public.payos_requests;
  v_order_id uuid;
  v_customer_id uuid;
begin
  select * into v_request from public.payos_requests
  where provider_order_code=p_provider_order_code for update;
  if v_request.request_id is null then raise exception 'Payment request not found'; end if;
  if v_request.amount<>p_amount then raise exception 'Payment amount mismatch'; end if;
  if v_request.status='paid' then return v_request.payment_id; end if;

  update public.payos_requests set status='paid',transaction_id=p_transaction_id,
    provider_payload=p_payload,paid_at=now(),updated_at=now()
  where request_id=v_request.request_id;

  select p.order_id,o.user_id into v_order_id,v_customer_id
  from public.payments p join public.orders o on o.order_id=p.order_id
  where p.payment_id=v_request.payment_id;

  if v_request.purpose in ('checkout','customer_cod') then
    update public.payments set status='paid',transaction_id=p_transaction_id,
      provider_payload=p_payload,payment_date=now()
    where payment_id=v_request.payment_id;
    if v_request.purpose='customer_cod' then
      insert into public.delivery_payment_collections(
        delivery_id,payment_id,collected_by,method,amount,status,remittance_status
      ) values(
        v_request.delivery_id,v_request.payment_id,v_request.requested_by,
        'customer_payos',v_request.amount,'collected','not_required'
      )
      on conflict(delivery_id) do update set
        method='customer_payos',status='collected',remittance_status='not_required',
        collected_at=now(),updated_at=now();
    end if;
    insert into public.order_tracking(order_id,status,note)
    values(v_order_id,'payment_paid',
      case when v_request.purpose='checkout'
        then 'payOS checkout payment confirmed; awaiting Manager confirmation'
        else 'COD payOS payment confirmed at delivery'
      end);
    insert into public.notifications(user_id,title,content,type,target_url)
    values(v_customer_id,'Payment successful','The payOS payment was confirmed.','payment_paid','/orders/' || v_order_id);
  else
    update public.delivery_payment_collections
    set remittance_status='paid',remitted_at=now(),updated_at=now()
    where collection_id=v_request.collection_id;

    update public.payments set status='paid',transaction_id=p_transaction_id,
      provider_payload=p_payload,payment_date=now()
    where payment_id=v_request.payment_id;

    insert into public.order_tracking(order_id,status,note)
    values(v_order_id,'payment_paid','Shipper cash remittance confirmed through payOS');
    insert into public.notifications(user_id,title,content,type,target_url)
    values(v_customer_id,'COD payment settled','The shipper remittance was confirmed.','payment_paid','/orders/' || v_order_id);
  end if;

  return v_request.payment_id;
end $$;

revoke execute on function public.confirm_payos_request(bigint,numeric,text,jsonb)
from public,anon,authenticated;
