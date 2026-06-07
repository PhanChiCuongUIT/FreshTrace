create or replace function private.can_view_order(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.orders o
    where o.order_id = p_order_id and (
      o.user_id = private.current_user_id()
      or private.has_role(array['admin','manager'])
      or exists (
        select 1 from public.deliveries d
        where d.order_id = o.order_id and d.employee_id = private.current_user_id()
      )
    )
  )
$$;
grant execute on function private.can_view_order(uuid) to authenticated;

drop policy orders_visible on public.orders;
drop policy order_items_visible on public.order_items;
drop policy payments_visible on public.payments;
drop policy deliveries_visible on public.deliveries;
drop policy tracking_visible on public.order_tracking;

create policy orders_visible on public.orders for select to authenticated
using (private.can_view_order(order_id));

create policy order_items_visible on public.order_items for select to authenticated
using (private.can_view_order(order_id));

create policy payments_visible on public.payments for select to authenticated
using (private.can_view_order(order_id));

create policy deliveries_visible on public.deliveries for select to authenticated
using (private.can_view_order(order_id));

create policy tracking_visible on public.order_tracking for select to authenticated
using (private.can_view_order(order_id));
