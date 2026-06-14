drop policy if exists suppliers_manager_update_pending on public.suppliers;
create policy suppliers_manager_update_pending on public.suppliers
for update to authenticated
using (
  private.has_role(array['manager'])
)
with check (
  private.has_role(array['manager'])
  and status = 'pending'
  and approved_by is null
  and approved_at is null
);
