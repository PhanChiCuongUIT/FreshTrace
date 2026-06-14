create or replace function public.validate_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.description := trim(new.description);
  if length(new.description) < 10 or length(new.description) > 4000 then
    raise exception 'Report description must be between 10 and 4000 characters';
  end if;

  if new.user_id <> private.current_user_id()
     and not private.has_role(array['admin']) then
    raise exception 'Reports can only be submitted for the signed-in customer';
  end if;

  if new.order_id is not null and not exists (
    select 1
    from public.orders
    where order_id = new.order_id
      and user_id = new.user_id
  ) then
    raise exception 'The report order must belong to the customer';
  end if;

  if new.product_id is not null
     and new.order_id is not null
     and not exists (
       select 1
       from public.order_items
       where order_id = new.order_id
         and product_id = new.product_id
     ) then
    raise exception 'The reported product is not part of this order';
  end if;

  if new.reported_user_id is not null then
    if new.reported_user_id = new.user_id then
      raise exception 'You cannot report your own account';
    end if;
    if not exists (
      select 1
      from public.list_reportable_users(null, 50) candidate
      where candidate.user_id = new.reported_user_id
    ) then
      raise exception 'This user is not connected to your FreshTrace orders or conversations';
    end if;
  end if;

  if new.type = 'user_report' then
    if new.reported_user_id is null then
      raise exception 'Select the user being reported';
    end if;
    if new.order_id is not null or new.product_id is not null then
      raise exception 'User reports cannot be linked to an order or product';
    end if;
  elsif new.reported_user_id is not null then
    raise exception 'A reported user is only allowed for user reports';
  end if;

  return new;
end;
$$;

create or replace function public.protect_report_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_id := old.user_id;
  new.order_id := old.order_id;
  new.product_id := old.product_id;
  new.reported_user_id := old.reported_user_id;
  new.type := old.type;
  new.description := old.description;
  new.attachment_url := old.attachment_url;
  new.created_at := old.created_at;

  if old.status in ('resolved', 'rejected')
     and (
       new.status is distinct from old.status
       or new.response is distinct from old.response
       or new.resolved_by is distinct from old.resolved_by
       or new.resolved_at is distinct from old.resolved_at
     ) then
    raise exception 'Finalized reports cannot be changed';
  end if;

  if new.status = 'pending' and old.status <> 'pending' then
    raise exception 'Reports cannot return to pending';
  end if;
  if new.status = 'processing' and old.status <> 'pending' then
    raise exception 'Only pending reports can enter processing';
  end if;
  if new.status in ('resolved', 'rejected')
     and old.status not in ('pending', 'processing') then
    raise exception 'Only open reports can be finalized';
  end if;
  if new.status in ('processing', 'resolved', 'rejected')
     and new.resolved_by is null then
    raise exception 'The admin handling the report is required';
  end if;

  new.response := nullif(trim(new.response), '');
  new.resolved_at := case
    when new.status in ('resolved', 'rejected') then coalesce(new.resolved_at, now())
    else null
  end;
  return new;
end;
$$;

create or replace function public.resolve_report(
  p_report_id uuid,
  p_status public.report_status,
  p_response text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter_id uuid;
  v_reported_user_id uuid;
  v_order_id uuid;
  v_current_status public.report_status;
begin
  if not private.has_role(array['admin']) then
    raise exception 'Forbidden';
  end if;
  if p_status not in ('processing', 'resolved', 'rejected') then
    raise exception 'Invalid report status';
  end if;

  select user_id, reported_user_id, order_id, status
  into v_reporter_id, v_reported_user_id, v_order_id, v_current_status
  from public.reports
  where report_id = p_report_id
  for update;

  if v_reporter_id is null then
    raise exception 'Report not found';
  end if;
  if v_current_status in ('resolved', 'rejected') then
    raise exception 'This report has already been finalized';
  end if;
  if p_status = 'processing' and v_current_status <> 'pending' then
    raise exception 'Only pending reports can enter processing';
  end if;

  update public.reports
  set status = p_status,
      response = nullif(trim(p_response), ''),
      resolved_by = private.current_user_id(),
      resolved_at = case when p_status in ('resolved', 'rejected') then now() else null end
  where report_id = p_report_id;

  if p_status = 'resolved' then
    insert into public.coupons(
      code, user_id, amount, remaining_amount, coupon_type, min_order_amount,
      expires_at, milestone_key, description
    )
    values(
      'REPORT-10K-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
      v_reporter_id, 10000, 10000, 'fixed_amount', 0,
      now() + interval '45 days', 'report_reward_' || p_report_id,
      '10,000 VND reward for an approved report'
    )
    on conflict(user_id, milestone_key) where milestone_key is not null do nothing;
  end if;

  insert into public.notifications(user_id, title, content, type, target_url)
  values(
    v_reporter_id,
    'Report update',
    coalesce(nullif(trim(p_response), ''), 'New status: ' || p_status::text),
    'report_status',
    '/reports/' || p_report_id
  );

  if p_status = 'resolved' and v_reported_user_id is not null then
    insert into public.notifications(user_id, title, content, type, target_url)
    values(
      v_reported_user_id,
      'A report involving your account was resolved',
      coalesce(
        nullif(trim(p_response), ''),
        'Admin resolved a report involving your FreshTrace account.'
      ),
      'user_report_resolved',
      '/notifications'
    );
  end if;

  if p_status = 'resolved' and v_order_id is not null then
    insert into public.notifications(user_id, title, content, type, target_url)
    select assignment.manager_id,
      'Order report resolved',
      'Admin resolved a customer report for an order assigned to you.',
      'order_report_resolved',
      '/manager/orders/' || v_order_id
    from public.order_manager_assignments assignment
    where assignment.order_id = v_order_id;
  end if;
end;
$$;

create or replace function public.approve_supplier(
  p_supplier_id uuid,
  p_status public.approval_status,
  p_response text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status public.approval_status;
begin
  if not private.has_role(array['admin']) then
    raise exception 'Forbidden';
  end if;
  if p_status = 'pending' then
    raise exception 'Use approved or rejected';
  end if;
  if length(coalesce(p_response, '')) > 2000 then
    raise exception 'Supplier approval response cannot exceed 2000 characters';
  end if;

  select status into v_current_status
  from public.suppliers
  where supplier_id = p_supplier_id
  for update;

  if v_current_status is null then
    raise exception 'Supplier not found';
  end if;
  if v_current_status <> 'pending' then
    raise exception 'Only pending suppliers can be approved or rejected';
  end if;

  update public.suppliers
  set status = p_status,
      approved_by = private.current_user_id(),
      approved_at = now()
  where supplier_id = p_supplier_id;
end;
$$;

create or replace function public.validate_chat_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shared_product_id is not null and not exists (
    select 1
    from public.products
    where product_id = new.shared_product_id
      and status = 'active'
  ) then
    raise exception 'Only active products can be shared';
  end if;

  if new.shared_order_id is not null then
    if not private.can_view_order(new.shared_order_id) then
      raise exception 'You cannot share this order';
    end if;

    if exists (
      select 1
      from public.chat_room_members member
      join public.users room_user on room_user.user_id = member.user_id
      join public.roles room_role on room_role.role_id = room_user.role_id
      join public.orders shared_order on shared_order.order_id = new.shared_order_id
      where member.room_id = new.room_id
        and room_role.role_name <> 'admin'
        and member.user_id <> shared_order.user_id
        and not exists (
          select 1
          from public.order_manager_assignments assignment
          where assignment.order_id = shared_order.order_id
            and assignment.manager_id = member.user_id
        )
        and not exists (
          select 1
          from public.deliveries delivery
          where delivery.order_id = shared_order.order_id
            and delivery.employee_id = member.user_id
        )
    ) then
      raise exception 'This order is not related to every participant in the conversation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_chat_share_before_insert on public.chat_messages;
create trigger validate_chat_share_before_insert
before insert on public.chat_messages
for each row execute function public.validate_chat_share();

create or replace function public.protect_chat_reaction_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.message_id := old.message_id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists protect_chat_reaction_before_update on public.chat_message_reactions;
create trigger protect_chat_reaction_before_update
before update on public.chat_message_reactions
for each row execute function public.protect_chat_reaction_update();

create or replace function public.protect_notification_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and not private.has_role(array['admin']) then
    new.user_id := old.user_id;
    new.title := old.title;
    new.content := old.content;
    new.type := old.type;
    new.target_url := old.target_url;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace function public.validate_review_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.comment := nullif(trim(new.comment), '');
  if length(coalesce(new.comment, '')) > 2000 then
    raise exception 'Review comment cannot exceed 2000 characters';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_review_content_before_write on public.reviews;
create trigger validate_review_content_before_write
before insert or update of comment on public.reviews
for each row execute function public.validate_review_content();

grant execute on function public.approve_supplier(uuid, public.approval_status, text) to authenticated;
grant execute on function public.resolve_report(uuid, public.report_status, text) to authenticated;
