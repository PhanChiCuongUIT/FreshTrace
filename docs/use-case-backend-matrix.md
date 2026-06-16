# Use Case Backend Matrix

| UC | Use case | Main backend/API | Status |
|---|---|---|---|
| UC01 | Sign in | Supabase Auth, `users`, `roles`, RLS | Complete |
| UC02 | Manage users | `admin-users` Edge Function | Complete |
| UC03 | Approve suppliers | `approve_supplier` RPC | Complete |
| UC04 | Manage categories | `categories` PostgREST with Manager RLS | Complete |
| UC05 | Manage products | `products` PostgREST and supplier validation | Complete |
| UC06 | Manage batches | `batches` PostgREST and inventory trigger | Complete |
| UC07 | Generate batch QR | `generate-batch-qr` Edge Function | Complete |
| UC08 | Manage inventory | `adjust_inventory` RPC and transaction history | Complete |
| UC09 | Manage prices | `prices` PostgREST and product/batch validation | Complete |
| UC10 | Create Fresh Rescue deals | Rescue constraints and stock checks | Complete |
| UC11 | View/buy Fresh Rescue | `search_products`, cart, and checkout | Complete |
| UC12 | Manage orders | `orders`, `confirm_order`, `cancel-order` | Complete |
| UC13 | Assign delivery | `assign_delivery` | Complete |
| UC14 | View assigned deliveries | RLS by `deliveries.employee_id` | Complete |
| UC15 | Verify order batches | `verify_delivery_batch` and audit checks | Complete |
| UC16 | Update delivery status | `update_delivery_status` with transition guards | Complete |
| UC17 | Customer-Shipper chat | `create_chat_room` and Realtime | Complete |
| UC18 | Customer-Manager chat | `create_chat_room` reuses one room per customer/manager pair; Realtime handles messages/reactions | Complete |
| UC19 | Manager-Shipper chat | `create_chat_room` and Realtime | Complete |
| UC20 | Manager-Admin chat | `create_chat_room` and Realtime | Complete |
| UC21 | Realtime notifications | Triggers, `notifications`, and Realtime | Complete |
| UC22 | Resolve reports/complaints | `reports` and `resolve_report` RPC | Complete |
| UC23 | Register account | Supabase Auth and profile/cart trigger | Complete |
| UC24 | Manage profile | `users` PostgREST with protected fields | Complete |
| UC25 | Browse products | `search_products` and product detail queries | Complete |
| UC26 | Search and filter products | `search_products` RPC | Complete |
| UC27 | Scan QR for traceability | `trace-batch` Edge Function | Complete |
| UC28 | Manage cart | `carts`, `cart_items`, invariant trigger | Complete |
| UC29 | Add shopping notes | `cart_items.note`, `orders.note` | Complete |
| UC30 | Create order | Transactional `checkout_cart` RPC | Complete |
| UC31 | Pay for order | COD, payOS function, signed webhook | Code complete; live keys required |
| UC32 | Track/cancel order | Order/tracking RLS and `cancel-order` Edge Function | Complete |
| UC33 | Review product | `reviews`, completed-order validation | Complete |
| UC34 | Fresh Assistant | `fresh-assistant` with real catalog data | Complete for rule-based MVP |

## External Verification Requirements

- payOS requires rotated sandbox/live credentials.
- Cloudinary requires rotated credentials for a real signed upload test.
- Realtime requires the full Supabase stack or a cloud project.
- The rule-based Fresh Assistant does not require an AI provider key.
