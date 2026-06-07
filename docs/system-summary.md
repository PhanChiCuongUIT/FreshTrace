# FreshTrace System Summary

This document summarizes the FreshTrace web application after the backend/API/database and frontend pass. It is written as an implementation map for the report use cases plus the extra use cases added during development.

## Use Case Flow Matrix

| Group | Actor | Frontend flow | Backend/API flow | Database flow |
| --- | --- | --- | --- | --- |
| Authentication and profile | Customer, Employee, Manager, Admin | Login, register, profile, avatar upload, password reset/change | Supabase Auth, profile update through PostgREST, Cloudinary upload helper for avatar | `auth.users`, `users`, `roles`, `coupons` signup trigger |
| Supplier governance | Manager, Admin | Manager Catalog > Suppliers drawer creates/edits; Admin Governance/Monitoring reviews | RLS scoped CRUD; `approve_supplier` workflow validates status | `suppliers`, `users`, notifications |
| Category management | Manager | Catalog > Categories drawer create/edit/activate/search/filter | PostgREST CRUD with manager/admin RLS | `categories` |
| Product management | Manager | Catalog > Products drawer create/edit, local image upload to Cloudinary | Cloudinary signed/unsigned upload helper; PostgREST product write | `products`, `suppliers`, `categories` |
| Batch and QR management | Manager, Customer, Employee | Catalog > Batches drawer creates/edits/generates QR; Customer product/order opens batch QR; Customer/Shipper scan live camera or choose a QR image; Shipper verifies checklist before pickup | `render-batch-qr`, `trace-batch`, `verify_delivery_batch` | `batches`, `inventory`, `delivery_batch_checks`, `order_tracking` |
| Inventory control | Manager | Catalog > Inventory drawer records stock adjustment and confirmation | Inventory transaction insert/update guarded by RLS/business constraints | `inventory`, `inventory_transactions`, `batches` |
| Price management | Manager | Catalog > Prices drawer creates/edits normal/promo/rescue pricing periods | PostGREST price write; product RPC resolves current price | `prices`, `products`, `batches` |
| Fresh Rescue | Customer, Manager | Customer Home/Rescue lists near-expiry offers; Manager Catalog > Rescue drawer creates/edits offers | Product search RPC merges rescue price and discount | `fresh_rescue_deals`, `batches`, `inventory`, `prices` |
| Product discovery | Customer | Products page search/filter/category/rescue/detail; Assistant can recommend products | `search_products`, assistant edge function | `products`, `categories`, `suppliers`, `batches`, `inventory`, `reviews` |
| Cart and checkout | Customer | Cart add/update/remove, coupon apply, checkout with COD/payos/bank_transfer | `checkout_cart`, PayOS create-payment edge function | `carts`, `cart_items`, `orders`, `order_items`, `payments`, `coupons` |
| Coupon promotion | Customer | Profile shows signup, loyalty, freeship, cancellation coupons | DB triggers issue coupons on signup/completed order; cancellation RPC issues refund coupon | `coupons`, `orders`, `payments` |
| Order operations | Manager | Operations page uses search, one workflow-status filter, shipper assignment and per-order tracking timeline | `confirm_order`, `mark_order_preparing`, `assign-delivery` edge function | `orders`, `order_items`, `deliveries`, `order_tracking`, `order_manager_assignments`, `chat_rooms` |
| Delivery workflow | Employee | Mobile Shipper Deliveries updates status, scans batch QR, collects COD cash/PayOS QR | `update_delivery_status`, `verify_delivery_batch`, `collect_delivery_cash`, PayOS edge function | `deliveries`, `delivery_batch_checks`, `payments`, `delivery_payment_collections`, `payos_requests`, `order_tracking` |
| COD/PayOS settlement | Customer, Employee | Customer selects COD; shipper screen supports cash collection or customer scans shipper PayOS QR | PayOS request creation; webhook/payment result marks paid; cash collection requires remittance before delivery close | `payments`, `payos_requests`, `delivery_payment_collections`, `order_tracking` |
| Order tracking | Customer, Manager, Employee | Customer Orders and Manager Operations show one workflow filter plus timeline; Manager/Employee status updates | RPCs append tracking rows during checkout, assignment, preparation, delivery and cancellation | `order_tracking`, `orders`, `deliveries` |
| Cancellation and refund coupon | Customer | Customer can cancel only pending orders; paid pending order returns full-value coupon | `cancel-order` edge function calls hardened cancellation RPC | `orders`, `payments`, `inventory`, `coupons`, `order_tracking` |
| Reviews and complaints | Customer, Admin | Customer reviews completed products and reports order issues; Admin handles reports | PostGREST write/read with role RLS | `reviews`, `reports`, `notifications` |
| Realtime notifications | All roles | Notification list, unread badges and Mark all as read update while using app | DB triggers and Supabase Realtime channels | `notifications`, Realtime publication |
| Chat | Customer, Manager, Employee, Admin | Messenger-like chat, avatar grouping, mobile reactions, attachments, share product/order | `create_chat_room`, `list_my_chat_rooms`, Cloudinary file upload, reaction upsert/update | `chat_rooms`, `chat_room_members`, `chat_messages`, `chat_message_reactions` |
| Auto chat after order | Customer, Manager, Employee | Order creates customer-manager chat; assignment creates customer-shipper/manager-shipper chat | DB trigger and `assign-delivery` function ensure rooms/members | `order_manager_assignments`, `chat_rooms`, `chat_room_members` |
| Admin user management | Admin | Users page search/filter and guarded role change warning | Role-change RPC/validation prevents unsafe DB-breaking role changes | `users`, `roles`, active `orders`/`deliveries` checks |
| Admin monitoring | Admin | Monitoring tabs for orders, deliveries, payments, catalog and inventory with search/status/date filters | Read-only aggregate/detail views through PostgREST; relation-safe rendering | Core operational tables |
| Admin finance | Admin | Finance page selects any week/month/year up to the current period in English UI, charts around the selected period, transaction table, CSV export | Client-side period grouping from payment/order rows under admin RLS | `payments`, `orders`, `order_items` |
| Admin/Manager dashboards | Admin, Manager | Metric cards, sparkline, vertical bar and donut charts | Aggregate reads through PostgREST | `users`, `suppliers`, `reports`, `orders`, `payments`, `deliveries`, `batches`, `inventory` |
| Fresh Assistant | Customer, Admin | Product recommendations by cheapest/freshest/category; Admin can inspect assistant usage | Edge function logs request/response and can return product suggestions | `assistant_logs`, product catalog tables |

Customer Analytics from the earlier admin wireframe has been intentionally removed. The current admin reporting surface keeps Governance, Monitoring and Finance because they match the final use-case scope more directly.

## Database Summary

Core identity tables: `users`, `roles`.

Catalog and traceability tables: `suppliers`, `categories`, `products`, `batches`, `inventory`, `inventory_transactions`, `prices`, `fresh_rescue_deals`.

Commerce tables: `carts`, `cart_items`, `orders`, `order_items`, `payments`, `coupons`.

Fulfillment tables: `deliveries`, `delivery_batch_checks`, `delivery_payment_collections`, `order_tracking`, `order_manager_assignments`, `payos_requests`.

Community/support tables: `reviews`, `reports`, `chat_rooms`, `chat_room_members`, `chat_messages`, `chat_message_reactions`, `notifications`, `assistant_logs`.

Important RPC/functions include `search_products`, `checkout_cart`, `confirm_order`, `mark_order_preparing`, `cancel_order`, `update_delivery_status`, `verify_delivery_batch`, `collect_delivery_cash`, `create_chat_room`, `list_my_chat_rooms`, `mark_chat_read`, `trace_batch`, `issue_signup_coupons`, and `issue_loyalty_coupons`.

## Technology Stack

Frontend: React, TypeScript, Vite, Tailwind-style utility classes, React Router, TanStack Query, Lucide icons. Purpose: role-based web UI, cache/query management, responsive customer/shipper mobile flows, desktop admin/manager workspaces.

Backend/API: Supabase local stack, PostgREST, PostgreSQL RPC, Edge Functions in Deno. Purpose: auth, database API, business workflows, PayOS integration, QR rendering/tracing, assistant endpoint, delivery assignment and cancellation APIs.

Database: PostgreSQL with Supabase Auth/RLS/Realtime. Purpose: domain constraints, role-based access, transactional stock/order/payment changes, live chat/notifications/tracking.

Media: Cloudinary. Purpose: product images, user avatars, and chat attachments.

Payments: PayOS plus COD flow. Purpose: prepaid checkout, COD QR from shipper screen, shipper cash collection/remittance, webhook/payment state updates.

QR: browser scanner plus image upload fallback with `BarcodeDetector`/`html5-qrcode`, QR generation endpoint and batch trace endpoint. Purpose: traceability and shipper batch verification on mobile.

## Main Pages And Goals

Customer:
- Home: quick actions, Fresh Rescue cards, responsive mobile/desktop discovery.
- Products/Rescue/Product Detail: browse, filter, view details, add to cart, share in chat, show batch QR.
- Cart: update items, apply coupons, choose payment method, checkout.
- Orders: search/filter by one workflow state, view timeline, batch QR, cancel pending order, review/report/share.
- Trace: scan or upload QR image, or enter batch code manually.
- Assistant: ask for cheap/fresh/category-based recommendations.
- Chat/Profile/Notifications: conversation, coupons/profile/avatar, realtime alerts.

Employee/Shipper:
- Deliveries: mobile-first delivery cards, status updates, batch camera/image QR verification, COD cash or PayOS QR settlement.
- Chat/Profile/Notifications: customer/manager coordination and alerts.

Manager:
- Dashboard: operational metrics and charts.
- Catalog: separate tabs with left slide-in create/edit drawers for suppliers, categories, products, batches, prices, rescue and inventory.
- Operations: search, one workflow-status filter, tracking timeline, shipper assignment, supplier packing groups.
- Chat/Profile/Notifications: order coordination.

Admin:
- Dashboard: governance metrics and charts.
- Users: search/filter, role change warning and guarded role mutation.
- Governance: supplier/report moderation.
- Monitoring: tabbed read-only operational monitoring for orders, deliveries, payments, catalog and inventory with date/status/search filters.
- Finance: week/month/year report selector in English, chart window around the selected period, selected transactions and CSV export.
- Assistant/Chat/Profile/Notifications: oversight and support flows.
