-- LEGACY REFERENCE ONLY.
-- Do not execute this file for the application backend.
-- The runnable, secured schema is in supabase/migrations and includes Auth integration,
-- transactions, RLS policies, Realtime publication, RPC functions, and seed data.
-- Use: npx supabase db reset (local) or npx supabase db push (cloud).

-- UC to Database Mapping - generated for report v9
-- UC01: Đăng nhập hệ thống -> users, roles [Đủ]
-- UC02: Quản lý người dùng -> users, roles [Đủ]
-- UC03: Duyệt nhà cung cấp -> suppliers, users [Đủ]
-- UC04: Quản lý danh mục -> categories [Đủ]
-- UC05: Quản lý sản phẩm -> products, categories, suppliers, prices [Đủ]
-- UC06: Quản lý lô hàng -> batches, products, suppliers, inventory [Đủ]
-- UC07: Tạo QR cho lô hàng -> batches [Đủ - qr_code lưu trực tiếp trong batches]
-- UC08: Quản lý tồn kho -> inventory, inventory_transactions, batches [Đủ]
-- UC09: Quản lý bảng giá -> prices, products, batches [Đủ]
-- UC10: Tạo Fresh Rescue Deal -> fresh_rescue_deals, batches, prices [Đủ]
-- UC11: Xem/Mua Fresh Rescue -> fresh_rescue_deals, products, batches, inventory, carts, cart_items, orders, order_items [Đủ]
-- UC12: Quản lý đơn hàng -> orders, order_items, order_tracking, payments [Đủ]
-- UC13: Phân công giao hàng -> deliveries, orders, users, notifications [Đủ]
-- UC14: Xem đơn được giao -> deliveries, orders, order_items, users [Đủ]
-- UC15: Quét QR kiểm tra lô -> batches, order_items, deliveries, order_tracking [Đủ]
-- UC16: Cập nhật trạng thái giao hàng -> deliveries, order_tracking, orders, notifications [Đủ]
-- UC17: Chat Customer-Shipper -> chat_rooms, chat_room_members, chat_messages, orders, deliveries, notifications [Đủ]
-- UC18: Chat Customer-Manager -> chat_rooms, chat_room_members, chat_messages, products, orders, notifications [Đủ]
-- UC19: Chat Manager-Shipper -> chat_rooms, chat_room_members, chat_messages, deliveries, notifications [Đủ]
-- UC20: Chat Manager-Admin -> chat_rooms, chat_room_members, chat_messages, reports, suppliers, notifications [Đủ]
-- UC21: Notification realtime -> notifications, users [Đủ]
-- UC22: Xử lý report/khiếu nại -> reports, users, orders [Đủ]
-- UC23: Đăng ký tài khoản -> users, roles [Đủ]
-- UC24: Quản lý tài khoản -> users [Đủ]
-- UC25: Duyệt sản phẩm -> products, categories, suppliers, prices, batches, inventory, reviews [Đủ]
-- UC26: Tìm kiếm và lọc sản phẩm -> products, categories, suppliers, prices, batches, inventory, fresh_rescue_deals [Đủ]
-- UC27: Quét QR truy xuất nguồn gốc -> batches, products, suppliers, inventory [Đủ]
-- UC28: Quản lý giỏ hàng -> carts, cart_items, products, batches, prices [Đủ]
-- UC29: Ghi chú đi chợ hộ -> cart_items, orders [Đủ]
-- UC30: Tạo đơn hàng -> orders, order_items, carts, cart_items, inventory, payments [Đủ]
-- UC31: Thanh toán -> payments, orders, notifications [Đủ]
-- UC32: Theo dõi/hủy đơn hàng -> orders, order_tracking, deliveries, payments, reports, notifications [Đủ]
-- UC33: Đánh giá sản phẩm -> reviews, users, products, orders, order_items [Đủ]
-- UC34: Fresh Assistant -> assistant_logs, products, categories, suppliers, batches, prices, fresh_rescue_deals [Đủ]

-- FreshTrace Database v9 - PostgreSQL / Supabase
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop order is intentionally omitted for safety. Run in a clean schema or drop manually if needed.

CREATE TABLE IF NOT EXISTS roles (
  role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name VARCHAR(30) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE,
  role_id UUID REFERENCES roles(role_id),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255),
  phone VARCHAR(20),
  address VARCHAR(255),
  avatar_url TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','banned')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255),
  certificate TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  description TEXT,
  approved_by UUID REFERENCES users(user_id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(category_id),
  supplier_id UUID REFERENCES suppliers(supplier_id),
  name VARCHAR(150) NOT NULL,
  description TEXT,
  unit VARCHAR(20) NOT NULL,
  image_url TEXT,
  certificate VARCHAR(100),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batches (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(product_id),
  supplier_id UUID REFERENCES suppliers(supplier_id),
  batch_code VARCHAR(100) UNIQUE,
  harvest_date DATE NOT NULL,
  expire_date DATE NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  origin_location VARCHAR(255),
  qr_code TEXT UNIQUE,
  status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available','expired','sold_out','locked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (expire_date >= harvest_date)
);

CREATE TABLE IF NOT EXISTS inventory (
  inventory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL UNIQUE REFERENCES batches(batch_id) ON DELETE CASCADE,
  quantity_available INTEGER NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  last_updated TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(batch_id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('import','export','adjust','reserve','release')),
  quantity INTEGER NOT NULL,
  note TEXT,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prices (
  price_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(product_id),
  batch_id UUID REFERENCES batches(batch_id),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  price_type VARCHAR(20) DEFAULT 'normal' CHECK (price_type IN ('normal','rescue','promotion')),
  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fresh_rescue_deals (
  deal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(batch_id),
  title VARCHAR(150) NOT NULL,
  description TEXT,
  original_price NUMERIC(10,2) NOT NULL CHECK (original_price >= 0),
  rescue_price NUMERIC(10,2) NOT NULL CHECK (rescue_price >= 0),
  discount_percent INTEGER CHECK (discount_percent >= 0 AND discount_percent <= 100),
  start_at TIMESTAMPTZ DEFAULT now(),
  end_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','expired','sold_out','inactive')),
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carts (
  cart_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(product_id),
  batch_id UUID REFERENCES batches(batch_id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  order_date TIMESTAMPTZ DEFAULT now(),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','confirmed','preparing','delivering','completed','cancelled')),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  delivery_address VARCHAR(255) NOT NULL,
  delivery_fee NUMERIC(10,2) DEFAULT 0 CHECK (delivery_fee >= 0),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  order_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(product_id),
  batch_id UUID REFERENCES batches(batch_id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(order_id),
  method VARCHAR(30) NOT NULL CHECK (method IN ('cod','payos','bank_transfer')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  transaction_id VARCHAR(255),
  payment_url TEXT,
  payment_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(order_id),
  employee_id UUID REFERENCES users(user_id),
  status VARCHAR(20) DEFAULT 'assigned' CHECK (status IN ('assigned','picked_up','delivering','delivered','failed')),
  pickup_time TIMESTAMPTZ,
  delivery_time TIMESTAMPTZ,
  proof_image_url TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_tracking (
  tracking_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL,
  note TEXT,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  product_id UUID NOT NULL REFERENCES products(product_id),
  order_id UUID REFERENCES orders(order_id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, product_id, order_id)
);

CREATE TABLE IF NOT EXISTS reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  order_id UUID REFERENCES orders(order_id),
  type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','processing','resolved','rejected')),
  resolved_by UUID REFERENCES users(user_id),
  response TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_rooms (
  room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(30) NOT NULL CHECK (type IN ('customer_shipper','customer_manager','manager_shipper','manager_admin')),
  order_id UUID REFERENCES orders(order_id),
  product_id UUID REFERENCES products(product_id),
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id),
  role_in_room VARCHAR(30),
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(user_id),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  title VARCHAR(150) NOT NULL,
  content TEXT,
  type VARCHAR(50),
  target_url TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assistant_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(user_id),
  question TEXT,
  answer TEXT,
  recommended_product_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_batches_product ON batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_expire ON batches(expire_date);
CREATE INDEX IF NOT EXISTS idx_inventory_batch ON inventory(batch_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_employee ON deliveries(employee_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_fresh_rescue_status ON fresh_rescue_deals(status, end_at);

-- Seed roles
INSERT INTO roles (role_name, description) VALUES
('admin', 'System administrator'),
('manager', 'Operations manager'),
('employee', 'Delivery employee'),
('customer', 'Customer')
ON CONFLICT (role_name) DO NOTHING;

-- Realtime note:
-- In Supabase Dashboard, enable Realtime for: chat_messages, notifications, orders, order_tracking, deliveries.
