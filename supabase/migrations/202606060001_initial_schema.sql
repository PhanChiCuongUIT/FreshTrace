create extension if not exists pgcrypto;

create type public.user_status as enum ('active', 'inactive', 'banned');
create type public.approval_status as enum ('pending', 'approved', 'rejected');
create type public.record_status as enum ('active', 'inactive');
create type public.batch_status as enum ('available', 'near_expiry', 'expired', 'sold_out', 'locked');
create type public.inventory_transaction_type as enum ('import', 'export', 'adjust', 'reserve', 'release');
create type public.price_type as enum ('normal', 'rescue', 'promotion');
create type public.rescue_status as enum ('active', 'expired', 'sold_out', 'inactive');
create type public.order_status as enum ('pending', 'confirmed', 'preparing', 'delivering', 'completed', 'cancelled');
create type public.payment_method as enum ('cod', 'payos', 'bank_transfer');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'cancelled');
create type public.delivery_status as enum ('assigned', 'picked_up', 'delivering', 'delivered', 'failed');
create type public.report_status as enum ('pending', 'processing', 'resolved', 'rejected');
create type public.chat_room_type as enum ('customer_shipper', 'customer_manager', 'manager_shipper', 'manager_admin');

create table public.roles (
  role_id uuid primary key default gen_random_uuid(),
  role_name text not null unique check (role_name in ('admin', 'manager', 'employee', 'customer')),
  description text
);

create table public.users (
  user_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(role_id),
  name text not null check (length(trim(name)) between 2 and 100),
  email text not null unique,
  phone text,
  address text,
  avatar_url text,
  status public.user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.suppliers (
  supplier_id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  certificate text,
  status public.approval_status not null default 'pending',
  description text,
  approved_by uuid references public.users(user_id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  category_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  product_id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(category_id),
  supplier_id uuid references public.suppliers(supplier_id),
  name text not null,
  description text,
  unit text not null,
  image_url text,
  certificate text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.batches (
  batch_id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(product_id),
  supplier_id uuid references public.suppliers(supplier_id),
  batch_code text not null unique,
  harvest_date date not null,
  expire_date date not null,
  quantity integer not null check (quantity >= 0),
  origin_location text,
  qr_code text unique,
  status public.batch_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expire_date >= harvest_date)
);

create table public.inventory (
  inventory_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique references public.batches(batch_id) on delete cascade,
  quantity_available integer not null default 0 check (quantity_available >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),
  last_updated timestamptz not null default now(),
  check (quantity_reserved <= quantity_available)
);

create table public.inventory_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(batch_id),
  type public.inventory_transaction_type not null,
  quantity integer not null check (quantity > 0),
  note text,
  created_by uuid references public.users(user_id),
  created_at timestamptz not null default now()
);

create table public.prices (
  price_id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(product_id),
  batch_id uuid references public.batches(batch_id),
  price numeric(12,2) not null check (price >= 0),
  price_type public.price_type not null default 'normal',
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table public.fresh_rescue_deals (
  deal_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(batch_id),
  title text not null,
  description text,
  original_price numeric(12,2) not null check (original_price >= 0),
  rescue_price numeric(12,2) not null check (rescue_price >= 0 and rescue_price < original_price),
  discount_percent integer generated always as (
    round((1 - rescue_price / nullif(original_price, 0)) * 100)
  ) stored,
  start_at timestamptz not null default now(),
  end_at timestamptz not null,
  status public.rescue_status not null default 'active',
  created_by uuid references public.users(user_id),
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table public.carts (
  cart_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  cart_item_id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(cart_id) on delete cascade,
  product_id uuid not null references public.products(product_id),
  batch_id uuid not null references public.batches(batch_id),
  quantity integer not null check (quantity > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, batch_id)
);

create table public.orders (
  order_id uuid primary key default gen_random_uuid(),
  order_code bigint generated always as identity unique,
  user_id uuid not null references public.users(user_id),
  order_date timestamptz not null default now(),
  status public.order_status not null default 'pending',
  subtotal numeric(12,2) not null check (subtotal >= 0),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  delivery_address text not null,
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  order_item_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(order_id) on delete cascade,
  product_id uuid not null references public.products(product_id),
  batch_id uuid not null references public.batches(batch_id),
  product_name text not null,
  unit text not null,
  quantity integer not null check (quantity > 0),
  price numeric(12,2) not null check (price >= 0)
);

create table public.payments (
  payment_id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(order_id),
  method public.payment_method not null,
  status public.payment_status not null default 'pending',
  amount numeric(12,2) not null check (amount >= 0),
  provider_order_code bigint unique,
  transaction_id text,
  payment_url text,
  qr_code text,
  provider_payload jsonb,
  payment_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.deliveries (
  delivery_id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(order_id),
  employee_id uuid references public.users(user_id),
  status public.delivery_status not null default 'assigned',
  pickup_time timestamptz,
  delivery_time timestamptz,
  proof_image_url text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_tracking (
  tracking_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(order_id) on delete cascade,
  status text not null,
  note text,
  created_by uuid references public.users(user_id),
  created_at timestamptz not null default now()
);

create table public.reviews (
  review_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(user_id),
  product_id uuid not null references public.products(product_id),
  order_id uuid not null references public.orders(order_id),
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id, order_id)
);

create table public.reports (
  report_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(user_id),
  order_id uuid references public.orders(order_id),
  product_id uuid references public.products(product_id),
  type text not null,
  description text not null,
  attachment_url text,
  status public.report_status not null default 'pending',
  resolved_by uuid references public.users(user_id),
  response text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.chat_rooms (
  room_id uuid primary key default gen_random_uuid(),
  type public.chat_room_type not null,
  order_id uuid references public.orders(order_id),
  product_id uuid references public.products(product_id),
  created_by uuid references public.users(user_id),
  created_at timestamptz not null default now()
);

create table public.chat_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(room_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  role_in_room text,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create table public.chat_messages (
  message_id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(room_id) on delete cascade,
  sender_id uuid not null references public.users(user_id),
  message text not null check (length(trim(message)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.notifications (
  notification_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(user_id) on delete cascade,
  title text not null,
  content text,
  type text,
  target_url text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.assistant_logs (
  log_id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(user_id) on delete set null,
  question text not null,
  answer text not null,
  intent text,
  recommended_product_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_users_auth on public.users(auth_user_id);
create index idx_products_category on public.products(category_id);
create index idx_products_supplier on public.products(supplier_id);
create index idx_products_search on public.products using gin (to_tsvector('simple', name || ' ' || coalesce(description, '')));
create index idx_batches_product on public.batches(product_id);
create index idx_batches_expire on public.batches(expire_date);
create index idx_prices_lookup on public.prices(product_id, batch_id, price_type, start_date, end_date);
create index idx_orders_user on public.orders(user_id, created_at desc);
create index idx_order_items_order on public.order_items(order_id);
create index idx_deliveries_employee on public.deliveries(employee_id, status);
create index idx_tracking_order on public.order_tracking(order_id, created_at);
create index idx_chat_members_user on public.chat_room_members(user_id, room_id);
create index idx_chat_messages_room on public.chat_messages(room_id, created_at);
create index idx_notifications_user_read on public.notifications(user_id, is_read, created_at desc);
create index idx_rescue_active on public.fresh_rescue_deals(status, end_at);

insert into public.roles (role_name, description) values
  ('admin', 'System administrator'),
  ('manager', 'Operations manager'),
  ('employee', 'Delivery employee'),
  ('customer', 'Customer');
