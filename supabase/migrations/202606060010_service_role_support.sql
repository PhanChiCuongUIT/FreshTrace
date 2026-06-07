create or replace function public.protect_user_privileged_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and not private.has_role(array['admin']) then
    new.auth_user_id = old.auth_user_id;
    new.role_id = old.role_id;
    new.email = old.email;
    new.status = old.status;
  end if;
  return new;
end $$;

create or replace function public.protect_notification_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and not private.has_role(array['admin','manager']) then
    new.user_id := old.user_id;
    new.title := old.title;
    new.content := old.content;
    new.type := old.type;
    new.target_url := old.target_url;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
