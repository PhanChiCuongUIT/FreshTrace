insert into public.categories (category_id, name, description) values
  ('10000000-0000-0000-0000-000000000001', 'Vegetables', 'Fresh vegetables and root produce'),
  ('10000000-0000-0000-0000-000000000002', 'Fruit', 'Seasonal fresh fruit'),
  ('10000000-0000-0000-0000-000000000003', 'Dry Goods', 'Rice, grains, and packaged food'),
  ('10000000-0000-0000-0000-000000000004', 'Mushrooms', 'Fresh and dried edible mushrooms'),
  ('10000000-0000-0000-0000-000000000005', 'Herbs', 'Fresh culinary herbs')
on conflict do nothing;

insert into public.suppliers (
  supplier_id, name, address, certificate, status, description, approved_at
) values
  (
    '20000000-0000-0000-0000-000000000001',
    'FreshTrace Da Lat Farm',
    'Da Lat, Lam Dong',
    'VietGAP-DL-2026',
    'approved',
    'Leafy vegetables and root produce from Da Lat.',
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'Mekong Organic Cooperative',
    'Cai Be, Tien Giang',
    'ORGANIC-MK-2026',
    'approved',
    'Seasonal fruit supplied by small organic farms.',
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'Green Basket Candidate',
    'Cu Chi, Ho Chi Minh City',
    'VietGAP application pending',
    'pending',
    'Pending supplier record for the Admin approval use case.',
    null
  )
on conflict do nothing;

insert into public.products (
  product_id, category_id, supplier_id, name, description, unit, certificate
) values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'VietGAP Spinach',
    'Fresh spinach from Da Lat.',
    'bunch',
    'VietGAP'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'Da Lat Carrots',
    'Fresh carrots suitable for soups and juice.',
    'kg',
    'VietGAP'
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'Hoa Loc Mango',
    'Sweet mango harvested in the Mekong Delta.',
    'kg',
    'Organic'
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'Seedless Guava',
    'Crisp guava suitable for snacks and juice.',
    'kg',
    'VietGAP'
  ),
  (
    '30000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    'Oyster Mushrooms',
    'Fresh oyster mushrooms grown in a controlled environment.',
    'box',
    'VietGAP'
  ),
  (
    '30000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000001',
    'Sweet Basil',
    'Aromatic basil for salads and cooked dishes.',
    'bunch',
    'VietGAP'
  ),
  (
    '30000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'Cherry Tomatoes',
    'Naturally sweet cherry tomatoes.',
    'box',
    'Organic'
  ),
  (
    '30000000-0000-0000-0000-000000000008',
    '10000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000002',
    'ST25 Brown Rice',
    'Whole-grain ST25 rice in a sealed package.',
    'bag',
    'OCOP'
  ),
  (
    '30000000-0000-0000-0000-000000000009',
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'Dak Lak Avocado',
    'Creamy avocado harvested from highland farms.',
    'kg',
    'VietGAP'
  ),
  (
    '30000000-0000-0000-0000-000000000010',
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'Da Lat Strawberries',
    'Sweet strawberries packed on the harvest day.',
    'box',
    'VietGAP'
  ),
  (
    '30000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'Green Broccoli',
    'Crisp broccoli suitable for steaming and stir-fry.',
    'head',
    'Organic'
  ),
  (
    '30000000-0000-0000-0000-000000000012',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    'Baby Cucumbers',
    'Small crunchy cucumbers for salads and snacks.',
    'kg',
    'VietGAP'
  )
on conflict do nothing;

update public.products as product
set image_url = images.image_url
from (values
  ('30000000-0000-0000-0000-000000000001'::uuid, 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000002'::uuid, 'https://images.unsplash.com/photo-1447175008436-054170c2e979?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000003'::uuid, 'https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000004'::uuid, 'https://images.unsplash.com/photo-1536511132770-e5058c7e8c46?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000005'::uuid, 'https://images.unsplash.com/photo-1504545102780-26774c1bb073?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000006'::uuid, 'https://images.unsplash.com/photo-1618375569909-3c8616cf7733?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000007'::uuid, 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000008'::uuid, 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000009'::uuid, 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000010'::uuid, 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000011'::uuid, 'https://images.unsplash.com/photo-1459411621453-7b03977f4bfc?auto=format&fit=crop&w=900&q=80'),
  ('30000000-0000-0000-0000-000000000012'::uuid, 'https://images.unsplash.com/photo-1604977042946-1eecc30f269e?auto=format&fit=crop&w=900&q=80')
) as images(product_id, image_url)
where product.product_id = images.product_id;

insert into public.batches (
  batch_id, product_id, supplier_id, batch_code, harvest_date, expire_date,
  quantity, origin_location
) values
  (
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'FT-SPINACH-001',
    current_date - 1,
    current_date + 5,
    50,
    'Da Lat, Lam Dong'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'FT-CARROT-001',
    current_date - 2,
    current_date + 2,
    80,
    'Don Duong, Lam Dong'
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000002',
    'FT-MANGO-001',
    current_date - 2,
    current_date + 6,
    45,
    'Cai Be, Tien Giang'
  ),
  (
    '40000000-0000-0000-0000-000000000004',
    '30000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000002',
    'FT-GUAVA-001',
    current_date - 3,
    current_date + 2,
    55,
    'Cai Lay, Tien Giang'
  ),
  (
    '40000000-0000-0000-0000-000000000005',
    '30000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000001',
    'FT-MUSHROOM-001',
    current_date - 1,
    current_date + 3,
    35,
    'Bao Loc, Lam Dong'
  ),
  (
    '40000000-0000-0000-0000-000000000006',
    '30000000-0000-0000-0000-000000000006',
    '20000000-0000-0000-0000-000000000001',
    'FT-BASIL-001',
    current_date,
    current_date + 4,
    60,
    'Da Lat, Lam Dong'
  ),
  (
    '40000000-0000-0000-0000-000000000007',
    '30000000-0000-0000-0000-000000000007',
    '20000000-0000-0000-0000-000000000001',
    'FT-TOMATO-001',
    current_date - 1,
    current_date + 7,
    70,
    'Don Duong, Lam Dong'
  ),
  (
    '40000000-0000-0000-0000-000000000008',
    '30000000-0000-0000-0000-000000000008',
    '20000000-0000-0000-0000-000000000002',
    'FT-RICE-001',
    current_date - 30,
    current_date + 300,
    100,
    'Soc Trang'
  ),
  (
    '40000000-0000-0000-0000-000000000009',
    '30000000-0000-0000-0000-000000000009',
    '20000000-0000-0000-0000-000000000002',
    'FT-AVOCADO-001',
    current_date - 2,
    current_date + 8,
    48,
    'Buon Ma Thuot, Dak Lak'
  ),
  (
    '40000000-0000-0000-0000-000000000010',
    '30000000-0000-0000-0000-000000000010',
    '20000000-0000-0000-0000-000000000001',
    'FT-STRAWBERRY-001',
    current_date,
    current_date + 4,
    40,
    'Da Lat, Lam Dong'
  ),
  (
    '40000000-0000-0000-0000-000000000011',
    '30000000-0000-0000-0000-000000000011',
    '20000000-0000-0000-0000-000000000001',
    'FT-BROCCOLI-001',
    current_date - 1,
    current_date + 6,
    65,
    'Don Duong, Lam Dong'
  ),
  (
    '40000000-0000-0000-0000-000000000012',
    '30000000-0000-0000-0000-000000000012',
    '20000000-0000-0000-0000-000000000002',
    'FT-CUCUMBER-001',
    current_date - 2,
    current_date + 2,
    75,
    'Cu Chi, Ho Chi Minh City'
  )
on conflict do nothing;

insert into public.prices (product_id, batch_id, price, price_type) values
  ('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 25000, 'normal'),
  ('30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 32000, 'normal'),
  ('30000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 85000, 'normal'),
  ('30000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 42000, 'normal'),
  ('30000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', 38000, 'normal'),
  ('30000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000006', 18000, 'normal'),
  ('30000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000007', 49000, 'normal'),
  ('30000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000008', 145000, 'normal'),
  ('30000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000009', 78000, 'normal'),
  ('30000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000010', 95000, 'normal'),
  ('30000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000011', 36000, 'normal'),
  ('30000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000012', 28000, 'normal')
on conflict do nothing;

insert into public.fresh_rescue_deals (
  deal_id, batch_id, title, description, original_price, rescue_price, end_at
) values
  (
    '50000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000004',
    'Guava Rescue',
    'Ripe fruit at a reduced price.',
    42000,
    29000,
    now() + interval '36 hours'
  ),
  (
    '50000000-0000-0000-0000-000000000003',
    '40000000-0000-0000-0000-000000000005',
    'Mushroom Rescue',
    'Cook within the next two days.',
    38000,
    26000,
    now() + interval '36 hours'
  ),
  (
    '50000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000012',
    'Cucumber Rescue',
    'A crunchy near-expiry batch for salads today.',
    28000,
    19000,
    now() + interval '30 hours'
  )
on conflict do nothing;

select public.sync_batch_statuses();
