alter table public.reports
  add column if not exists reported_user_id uuid references public.users(user_id);

create index if not exists idx_reports_reported_user
  on public.reports(reported_user_id, status);

create or replace function public.list_reportable_users(
  p_query text default null,
  p_limit integer default 30
) returns table (
  user_id uuid,
  name text,
  role_name text
)
language sql
security definer
set search_path = public
as $$
  with me as (
    select private.current_user_id() id
  ),
  related as (
    select distinct member.user_id
    from me
    join public.chat_room_members mine on mine.user_id = me.id
    join public.chat_room_members member
      on member.room_id = mine.room_id
     and member.user_id <> me.id
    union
    select distinct assignment.manager_id
    from me
    join public.orders o on o.user_id = me.id
    join public.order_manager_assignments assignment on assignment.order_id = o.order_id
    union
    select distinct d.employee_id
    from me
    join public.orders o on o.user_id = me.id
    join public.deliveries d on d.order_id = o.order_id
    where d.employee_id is not null
  )
  select u.user_id, u.name, r.role_name
  from related
  join public.users u on u.user_id = related.user_id and u.status = 'active'
  join public.roles r on r.role_id = u.role_id
  where nullif(trim(p_query), '') is null
     or u.name ilike '%' || trim(p_query) || '%'
     or r.role_name ilike '%' || trim(p_query) || '%'
  order by u.name
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$$;

grant execute on function public.list_reportable_users(text, integer) to authenticated;

create or replace function public.validate_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id <> private.current_user_id()
     and not private.has_role(array['admin']) then
    raise exception 'Reports can only be submitted for the signed-in customer';
  end if;

  if new.order_id is not null and not exists (
    select 1 from public.orders
    where order_id = new.order_id and user_id = new.user_id
  ) then
    raise exception 'The report order must belong to the customer';
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

  if new.type = 'user_report' and new.reported_user_id is null then
    raise exception 'Select the user being reported';
  end if;
  if new.type <> 'user_report' and new.reported_user_id is not null then
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
begin
  if not private.has_role(array['admin']) then raise exception 'Forbidden'; end if;
  if p_status not in ('processing','resolved','rejected') then
    raise exception 'Invalid report status';
  end if;

  update public.reports set
    status = p_status,
    response = nullif(trim(p_response), ''),
    resolved_by = private.current_user_id(),
    resolved_at = case when p_status in ('resolved','rejected') then now() else null end
  where report_id = p_report_id
  returning user_id, reported_user_id, order_id
  into v_reporter_id, v_reported_user_id, v_order_id;
  if v_reporter_id is null then raise exception 'Report not found'; end if;

  if p_status = 'resolved' then
    insert into public.coupons(
      code,user_id,amount,remaining_amount,coupon_type,min_order_amount,
      expires_at,milestone_key,description
    )
    values(
      'REPORT-10K-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
      v_reporter_id,10000,10000,'fixed_amount',0,
      now()+interval '45 days','report_reward_' || p_report_id,
      '10,000 VND reward for an approved report'
    )
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end if;

  insert into public.notifications(user_id,title,content,type,target_url)
  values(
    v_reporter_id,
    'Report update',
    coalesce(nullif(trim(p_response), ''), 'New status: ' || p_status::text),
    'report_status',
    '/reports/' || p_report_id
  );

  if p_status = 'resolved' and v_reported_user_id is not null then
    insert into public.notifications(user_id,title,content,type,target_url)
    values(
      v_reported_user_id,
      'A report involving your account was resolved',
      coalesce(nullif(trim(p_response), ''), 'Admin resolved a report involving your FreshTrace account.'),
      'user_report_resolved',
      '/notifications'
    );
  end if;

  if p_status = 'resolved' and v_order_id is not null then
    insert into public.notifications(user_id,title,content,type,target_url)
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
