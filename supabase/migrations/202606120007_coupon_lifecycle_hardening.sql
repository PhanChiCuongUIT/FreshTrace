create or replace function public.refresh_coupon_statuses()
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.coupons
  set status = 'expired'
  where status = 'active'
    and expires_at is not null
    and expires_at <= now();
end $$;

create or replace function public.restore_coupon_after_order_cancellation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.status <> 'cancelled'
     and new.status = 'cancelled'
     and new.applied_coupon_id is not null
     and new.discount_amount > 0 then
    update public.coupons
    set remaining_amount = least(amount, remaining_amount + new.discount_amount),
        status = case
          when expires_at is not null and expires_at <= now() then 'expired'::public.coupon_status
          else 'active'::public.coupon_status
        end,
        used_order_id = null,
        used_at = null,
        updated_at = now()
    where coupon_id = new.applied_coupon_id;
  end if;
  return new;
end $$;

drop trigger if exists restore_coupon_after_order_cancelled on public.orders;
create trigger restore_coupon_after_order_cancelled
after update of status on public.orders
for each row execute function public.restore_coupon_after_order_cancellation();

grant execute on function public.refresh_coupon_statuses() to authenticated;

