insert into public.categories(category_id, name, description, status)
values(
  '10000000-0000-0000-0000-000000000006',
  'Meat',
  'Chilled traceable meat products',
  'active'
)
on conflict(category_id) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status;

insert into public.products(
  product_id, category_id, supplier_id, name, description, unit,
  image_url, certificate, status
)
values(
  '30000000-0000-0000-0000-000000000016',
  '10000000-0000-0000-0000-000000000006',
  '20000000-0000-0000-0000-000000000004',
  'Grass-fed Beef Tenderloin',
  'Chilled grass-fed beef with farm and batch traceability.',
  'kg',
  'https://images.unsplash.com/photo-1603048297172-c92544798d5a?auto=format&fit=crop&w=900&q=80',
  'VietGAHP',
  'active'
)
on conflict(product_id) do update set
  category_id = excluded.category_id,
  supplier_id = excluded.supplier_id,
  name = excluded.name,
  description = excluded.description,
  unit = excluded.unit,
  image_url = excluded.image_url,
  certificate = excluded.certificate,
  status = excluded.status;

insert into public.batches(
  batch_id, product_id, supplier_id, batch_code, harvest_date,
  expire_date, quantity, origin_location, status
)
values(
  '40000000-0000-0000-0000-000000000016',
  '30000000-0000-0000-0000-000000000016',
  '20000000-0000-0000-0000-000000000004',
  'FT-BEEF-001',
  current_date - 1,
  current_date + 7,
  35,
  'Bao Loc, Lam Dong',
  'available'
)
on conflict(batch_id) do update set
  expire_date = greatest(public.batches.expire_date, excluded.expire_date),
  origin_location = excluded.origin_location;

insert into public.prices(product_id, batch_id, price, price_type)
select
  '30000000-0000-0000-0000-000000000016',
  '40000000-0000-0000-0000-000000000016',
  285000,
  'normal'
where not exists (
  select 1
  from public.prices
  where product_id = '30000000-0000-0000-0000-000000000016'
    and batch_id = '40000000-0000-0000-0000-000000000016'
    and price_type = 'normal'
);
