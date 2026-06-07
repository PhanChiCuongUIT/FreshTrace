grant usage on schema public to anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.current_user_id() to authenticated;
grant execute on function private.has_role(text[]) to authenticated;

grant select on public.roles, public.categories, public.products, public.suppliers,
  public.batches, public.inventory, public.prices, public.fresh_rescue_deals,
  public.reviews to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'roles','users','suppliers','categories','products','batches','inventory',
    'inventory_transactions','prices','fresh_rescue_deals','carts','cart_items',
    'orders','order_items','payments','deliveries','order_tracking','reviews',
    'reports','chat_rooms','chat_room_members','chat_messages','notifications',
    'assistant_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy roles_read on public.roles for select using (true);

create policy users_self_read on public.users for select to authenticated
using (auth_user_id = (select auth.uid()) or private.has_role(array['admin','manager']));
create policy users_self_update on public.users for update to authenticated
using (auth_user_id = (select auth.uid()) or private.has_role(array['admin']))
with check (auth_user_id = (select auth.uid()) or private.has_role(array['admin']));
create policy users_admin_write on public.users for insert to authenticated
with check (private.has_role(array['admin']));
create policy users_admin_delete on public.users for delete to authenticated
using (private.has_role(array['admin']));

create or replace function public.protect_user_privileged_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not private.has_role(array['admin']) then
    new.auth_user_id = old.auth_user_id;
    new.role_id = old.role_id;
    new.email = old.email;
    new.status = old.status;
  end if;
  return new;
end $$;
create trigger protect_user_fields before update on public.users
for each row execute function public.protect_user_privileged_fields();

create policy suppliers_public_read on public.suppliers for select
using (status = 'approved' or private.has_role(array['admin','manager']));
create policy suppliers_admin_write on public.suppliers for all to authenticated
using (private.has_role(array['admin'])) with check (private.has_role(array['admin']));

create policy categories_public_read on public.categories for select
using (status = 'active' or private.has_role(array['admin','manager']));
create policy categories_manager_write on public.categories for all to authenticated
using (private.has_role(array['admin','manager'])) with check (private.has_role(array['admin','manager']));

create policy products_public_read on public.products for select
using (status = 'active' or private.has_role(array['admin','manager']));
create policy products_manager_write on public.products for all to authenticated
using (private.has_role(array['admin','manager'])) with check (private.has_role(array['admin','manager']));

create policy batches_public_read on public.batches for select
using (status in ('available','near_expiry','sold_out','expired') or private.has_role(array['admin','manager','employee']));
create policy batches_manager_write on public.batches for all to authenticated
using (private.has_role(array['admin','manager'])) with check (private.has_role(array['admin','manager']));

create policy inventory_public_read on public.inventory for select using (true);
create policy inventory_manager_write on public.inventory for all to authenticated
using (private.has_role(array['admin','manager'])) with check (private.has_role(array['admin','manager']));
create policy inventory_transactions_manager_read on public.inventory_transactions for select to authenticated
using (private.has_role(array['admin','manager']));
create policy inventory_transactions_manager_write on public.inventory_transactions for insert to authenticated
with check (private.has_role(array['admin','manager']));

create policy prices_public_read on public.prices for select using (true);
create policy prices_manager_write on public.prices for all to authenticated
using (private.has_role(array['admin','manager'])) with check (private.has_role(array['admin','manager']));

create policy rescue_public_read on public.fresh_rescue_deals for select
using (status = 'active' or private.has_role(array['admin','manager']));
create policy rescue_manager_write on public.fresh_rescue_deals for all to authenticated
using (private.has_role(array['admin','manager'])) with check (private.has_role(array['admin','manager']));

create policy carts_owner on public.carts for all to authenticated
using (user_id = private.current_user_id()) with check (user_id = private.current_user_id());
create policy cart_items_owner on public.cart_items for all to authenticated
using (exists (
  select 1 from public.carts c where c.cart_id = cart_items.cart_id and c.user_id = private.current_user_id()
)) with check (exists (
  select 1 from public.carts c where c.cart_id = cart_items.cart_id and c.user_id = private.current_user_id()
));

create policy orders_visible on public.orders for select to authenticated
using (
  user_id = private.current_user_id()
  or private.has_role(array['admin','manager'])
  or exists (
    select 1 from public.deliveries d
    where d.order_id = orders.order_id and d.employee_id = private.current_user_id()
  )
);
create policy orders_manager_update on public.orders for update to authenticated
using (private.has_role(array['admin','manager'])) with check (private.has_role(array['admin','manager']));

create policy order_items_visible on public.order_items for select to authenticated
using (exists (
  select 1 from public.orders o where o.order_id = order_items.order_id and (
    o.user_id = private.current_user_id()
    or private.has_role(array['admin','manager'])
    or exists (
      select 1 from public.deliveries d
      where d.order_id = o.order_id and d.employee_id = private.current_user_id()
    )
  )
));

create policy payments_visible on public.payments for select to authenticated
using (exists (
  select 1 from public.orders o where o.order_id = payments.order_id
    and (o.user_id = private.current_user_id() or private.has_role(array['admin','manager']))
));

create policy deliveries_visible on public.deliveries for select to authenticated
using (
  employee_id = private.current_user_id()
  or private.has_role(array['admin','manager'])
  or exists (
    select 1 from public.orders o where o.order_id = deliveries.order_id and o.user_id = private.current_user_id()
  )
);

create policy tracking_visible on public.order_tracking for select to authenticated
using (exists (
  select 1 from public.orders o where o.order_id = order_tracking.order_id and (
    o.user_id = private.current_user_id()
    or private.has_role(array['admin','manager'])
    or exists (
      select 1 from public.deliveries d
      where d.order_id = o.order_id and d.employee_id = private.current_user_id()
    )
  )
));

create policy reviews_public_read on public.reviews for select using (true);
create policy reviews_customer_insert on public.reviews for insert to authenticated
with check (
  user_id = private.current_user_id()
  and exists (
    select 1 from public.orders o join public.order_items oi on oi.order_id = o.order_id
    where o.order_id = reviews.order_id and o.user_id = private.current_user_id()
      and o.status = 'completed' and oi.product_id = reviews.product_id
  )
);
create policy reviews_owner_update on public.reviews for update to authenticated
using (user_id = private.current_user_id()) with check (user_id = private.current_user_id());

create policy reports_visible on public.reports for select to authenticated
using (user_id = private.current_user_id() or private.has_role(array['admin']));
create policy reports_customer_insert on public.reports for insert to authenticated
with check (user_id = private.current_user_id());
create policy reports_admin_update on public.reports for update to authenticated
using (private.has_role(array['admin'])) with check (private.has_role(array['admin']));

create policy chat_rooms_member_read on public.chat_rooms for select to authenticated
using (exists (
  select 1 from public.chat_room_members m
  where m.room_id = chat_rooms.room_id and m.user_id = private.current_user_id()
));
create policy chat_rooms_create on public.chat_rooms for insert to authenticated
with check (created_by = private.current_user_id());
create policy chat_members_read on public.chat_room_members for select to authenticated
using (exists (
  select 1 from public.chat_room_members self
  where self.room_id = chat_room_members.room_id and self.user_id = private.current_user_id()
));
create policy chat_members_manage on public.chat_room_members for insert to authenticated
with check (exists (
  select 1 from public.chat_rooms r
  where r.room_id = chat_room_members.room_id
    and (r.created_by = private.current_user_id() or private.has_role(array['admin','manager']))
));
create policy chat_messages_member_read on public.chat_messages for select to authenticated
using (exists (
  select 1 from public.chat_room_members m
  where m.room_id = chat_messages.room_id and m.user_id = private.current_user_id()
));
create policy chat_messages_member_send on public.chat_messages for insert to authenticated
with check (
  sender_id = private.current_user_id()
  and exists (
    select 1 from public.chat_room_members m
    where m.room_id = chat_messages.room_id and m.user_id = private.current_user_id()
  )
);

create policy notifications_owner_read on public.notifications for select to authenticated
using (user_id = private.current_user_id());
create policy notifications_owner_update on public.notifications for update to authenticated
using (user_id = private.current_user_id()) with check (user_id = private.current_user_id());

create policy assistant_logs_owner_read on public.assistant_logs for select to authenticated
using (user_id = private.current_user_id());

alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_tracking;
alter publication supabase_realtime add table public.deliveries;
