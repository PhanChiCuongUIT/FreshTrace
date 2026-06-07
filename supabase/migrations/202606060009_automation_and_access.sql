create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.current_user_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select user_id from public.users
  where auth_user_id = (select auth.uid()) and status = 'active'
$$;

drop policy users_self_read on public.users;
drop policy users_self_update on public.users;

create policy users_self_read on public.users for select to authenticated
using (
  (auth_user_id = (select auth.uid()) and status = 'active')
  or private.has_role(array['admin','manager'])
);

create policy users_self_update on public.users for update to authenticated
using (
  (auth_user_id = (select auth.uid()) and status = 'active')
  or private.has_role(array['admin'])
)
with check (
  (auth_user_id = (select auth.uid()) and status = 'active')
  or private.has_role(array['admin'])
);

create or replace function public.validate_rescue_deal()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_expire_date date; v_stock integer;
begin
  if new.status <> 'active' then return new; end if;
  select b.expire_date, i.quantity_available - i.quantity_reserved
  into v_expire_date, v_stock
  from public.batches b
  join public.inventory i on i.batch_id = b.batch_id
  where b.batch_id = new.batch_id
    and b.status in ('available', 'near_expiry')
    and b.expire_date between current_date and current_date + 3;
  if v_expire_date is null then
    raise exception 'Fresh Rescue requires a non-expired batch within 3 days of expiry';
  end if;
  if v_stock <= 0 then raise exception 'Fresh Rescue batch is out of stock'; end if;
  if new.end_at > (v_expire_date + interval '1 day') then
    raise exception 'Fresh Rescue cannot end after batch expiry';
  end if;
  if exists (
    select 1 from public.fresh_rescue_deals d
    where d.batch_id = new.batch_id and d.status = 'active'
      and d.deal_id is distinct from new.deal_id
  ) then
    raise exception 'Batch already has an active Fresh Rescue deal';
  end if;
  return new;
end $$;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job
  where jobname = 'freshtrace-operational-events';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'freshtrace-operational-events',
    '5 * * * *',
    'select public.notify_operational_events()'
  );
end $$;
