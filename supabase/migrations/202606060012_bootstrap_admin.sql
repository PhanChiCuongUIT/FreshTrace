create or replace function public.protect_user_privileged_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if session_user not in ('postgres', 'supabase_admin')
     and coalesce((select auth.role()), '') <> 'service_role'
     and not private.has_role(array['admin']) then
    new.auth_user_id = old.auth_user_id;
    new.role_id = old.role_id;
    new.email = old.email;
    new.status = old.status;
  end if;
  return new;
end $$;
