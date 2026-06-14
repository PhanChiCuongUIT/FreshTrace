-- Keep the deterministic demo catalog useful when a local database has been
-- running for several days. Only the fixed seed UUIDs are affected.
with demo_dates(batch_id, harvest_offset, expiry_offset) as (
  values
    ('40000000-0000-0000-0000-000000000001'::uuid, -1, 5),
    ('40000000-0000-0000-0000-000000000002'::uuid, -2, 2),
    ('40000000-0000-0000-0000-000000000003'::uuid, -2, 6),
    ('40000000-0000-0000-0000-000000000004'::uuid, -3, 2),
    ('40000000-0000-0000-0000-000000000005'::uuid, -1, 3),
    ('40000000-0000-0000-0000-000000000006'::uuid, 0, 4),
    ('40000000-0000-0000-0000-000000000007'::uuid, -1, 7),
    ('40000000-0000-0000-0000-000000000008'::uuid, -30, 300),
    ('40000000-0000-0000-0000-000000000009'::uuid, -2, 8),
    ('40000000-0000-0000-0000-000000000010'::uuid, 0, 4),
    ('40000000-0000-0000-0000-000000000011'::uuid, -1, 6),
    ('40000000-0000-0000-0000-000000000012'::uuid, -2, 5)
)
update public.batches b
set harvest_date = current_date + d.harvest_offset,
    expire_date = current_date + d.expiry_offset,
    updated_at = now()
from demo_dates d
where b.batch_id = d.batch_id;

update public.fresh_rescue_deals
set start_at = now() - interval '1 hour',
    end_at = now() + interval '36 hours',
    status = 'active'
where batch_id in (
  '40000000-0000-0000-0000-000000000004'::uuid,
  '40000000-0000-0000-0000-000000000005'::uuid
);

select public.refresh_catalog_state();

