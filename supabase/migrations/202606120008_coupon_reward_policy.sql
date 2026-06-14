create or replace function public.issue_signup_coupons()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role_name into v_role from public.roles where role_id = new.role_id;
  if v_role = 'customer' then
    insert into public.coupons(
      code,user_id,amount,remaining_amount,coupon_type,discount_percent,max_discount_amount,
      min_order_amount,expires_at,milestone_key,description
    ) values
      ('WELCOME-FREESHIP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,20000,20000,'free_shipping',null,null,0,now()+interval '30 days','welcome_freeship_1','Welcome free shipping coupon'),
      ('WELCOME-FREESHIP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,20000,20000,'free_shipping',null,null,0,now()+interval '30 days','welcome_freeship_2','Welcome free shipping coupon'),
      ('WELCOME-10P-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,100000,100000,'percent',10,100000,120000,now()+interval '30 days','welcome_10_percent','Welcome 10% discount coupon')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  else
    delete from public.coupons
    where user_id = new.user_id
      and milestone_key in ('welcome_freeship_1', 'welcome_freeship_2', 'welcome_10_percent')
      and used_order_id is null;
  end if;
  return new;
end;
$$;

create or replace function public.issue_loyalty_coupons()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_count integer;
  v_completed_spend numeric(12,2);
  v_step integer;
  v_random_amount integer;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  if not exists (select 1 from public.deliveries where order_id = new.order_id and status = 'delivered') then
    return new;
  end if;

  select count(*), coalesce(sum(o.total_amount),0)
  into v_completed_count, v_completed_spend
  from public.orders o
  where o.user_id = new.user_id
    and o.status = 'completed'
    and exists (select 1 from public.deliveries d where d.order_id = o.order_id and d.status = 'delivered');

  for v_step in 1..floor(v_completed_spend / 500000)::integer loop
    insert into public.coupons(code,user_id,amount,remaining_amount,coupon_type,min_order_amount,expires_at,milestone_key,description)
    values('SPEND-FREESHIP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,20000,20000,'free_shipping',0,now()+interval '60 days','spend_freeship_500k_' || v_step,'Free shipping for each 500,000 VND delivered spend')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end loop;

  for v_step in 1..floor(v_completed_spend / 1000000)::integer loop
    insert into public.coupons(code,user_id,amount,remaining_amount,coupon_type,discount_percent,max_discount_amount,min_order_amount,expires_at,milestone_key,description)
    values('SPEND-10P-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,100000,100000,'percent',10,100000,200000,now()+interval '60 days','spend_percent10_1m_' || v_step,'10% discount for each 1,000,000 VND delivered spend')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end loop;

  for v_step in 1..floor(v_completed_spend / 2000000)::integer loop
    insert into public.coupons(code,user_id,amount,remaining_amount,coupon_type,discount_percent,max_discount_amount,min_order_amount,expires_at,milestone_key,description)
    values('SPEND-20P-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,200000,200000,'percent',20,200000,300000,now()+interval '60 days','spend_percent20_2m_' || v_step,'20% discount for each 2,000,000 VND delivered spend')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end loop;

  for v_step in 1..floor(v_completed_count / 5)::integer loop
    insert into public.coupons(code,user_id,amount,remaining_amount,coupon_type,min_order_amount,expires_at,milestone_key,description)
    values('ORDERS-FREESHIP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,20000,20000,'free_shipping',0,now()+interval '60 days','orders_freeship_5_' || v_step,'Free shipping for each 5 delivered orders')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end loop;

  for v_step in 1..floor(v_completed_count / 10)::integer loop
    insert into public.coupons(code,user_id,amount,remaining_amount,coupon_type,discount_percent,max_discount_amount,min_order_amount,expires_at,milestone_key,description)
    values('ORDERS-10P-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,100000,100000,'percent',10,100000,200000,now()+interval '60 days','orders_percent10_10_' || v_step,'10% discount for each 10 delivered orders')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end loop;

  if new.total_amount >= 1000000 and random() < 0.35 then
    v_random_amount := (5000 + floor(random() * 4)::integer * 5000);
    insert into public.coupons(code,user_id,amount,remaining_amount,coupon_type,min_order_amount,expires_at,milestone_key,description)
    values('LUCKY-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),new.user_id,v_random_amount,v_random_amount,'fixed_amount',0,now()+interval '45 days','large_order_lucky_' || new.order_id,'Lucky reward for a delivered order over 1,000,000 VND')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end if;

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
  v_user_id uuid;
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
  returning user_id into v_user_id;
  if v_user_id is null then raise exception 'Report not found'; end if;

  if p_status = 'resolved' then
    insert into public.coupons(code,user_id,amount,remaining_amount,coupon_type,min_order_amount,expires_at,milestone_key,description)
    values('REPORT-10K-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),v_user_id,10000,10000,'fixed_amount',0,now()+interval '45 days','report_reward_' || p_report_id,'10,000 VND reward for an approved report')
    on conflict(user_id,milestone_key) where milestone_key is not null do nothing;
  end if;

  insert into public.notifications (user_id, title, content, type, target_url)
  values (
    v_user_id,
    'Report update',
    coalesce(nullif(trim(p_response), ''), 'New status: ' || p_status::text),
    'report_status',
    '/reports/' || p_report_id
  );
end;
$$;

create or replace function public.remove_successfully_used_coupon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon_id uuid := new.applied_coupon_id;
begin
  if old.status <> 'completed'
     and new.status = 'completed'
     and v_coupon_id is not null
     and exists (
       select 1 from public.coupons
       where coupon_id = v_coupon_id
         and used_order_id = new.order_id
         and status = 'used'
     ) then
    update public.orders set applied_coupon_id = null where order_id = new.order_id;
    delete from public.coupons where coupon_id = v_coupon_id;
  end if;
  return new;
end;
$$;

create or replace function public.mark_coupon_single_use()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.used_order_id is not null
     and new.used_order_id is distinct from old.used_order_id then
    new.status := 'used';
    new.used_at := coalesce(new.used_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists mark_coupon_single_use_before_update on public.coupons;
create trigger mark_coupon_single_use_before_update
before update of used_order_id on public.coupons
for each row execute function public.mark_coupon_single_use();

drop trigger if exists remove_successfully_used_coupon_after_order on public.orders;
create trigger remove_successfully_used_coupon_after_order
after update of status on public.orders
for each row execute function public.remove_successfully_used_coupon();

create or replace function public.refresh_coupon_statuses()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coupons
  set status = 'expired'
  where status = 'active'
    and expires_at is not null
    and expires_at <= now();

  update public.orders o
  set applied_coupon_id = null
  from public.coupons c
  where o.applied_coupon_id = c.coupon_id
    and o.status = 'completed'
    and c.status = 'used';

  delete from public.coupons c
  where c.status = 'used'
    and exists (
      select 1 from public.orders o
      where o.order_id = c.used_order_id
        and o.status = 'completed'
    );
end;
$$;

grant execute on function public.refresh_coupon_statuses() to authenticated;
