# FreshTrace End-to-End Use Case Coverage

Audited against `DA1_23520207_PhanChiCuong_SE121.Q21.docx` and the current
implementation on June 13, 2026.

## Report Use Cases

| UC | Actor | Use case and frontend flow | Backend/API flow | Database flow |
|---|---|---|---|---|
| UC01 | All roles | Login page submits email/password, then routes by role | Supabase Auth validates credentials; profile lookup resolves role/status | `auth.users`, `users`, `roles` |
| UC02 | Admin | User Governance searches, filters, changes status/role with confirmation | `admin-users` validates protected role changes and prevents unsafe self/last-admin changes | `users`, `roles` |
| UC03 | Manager, Admin | Manager submits Supplier; Admin approves/rejects in Monitoring; editing an approved Supplier resubmits it as pending | RLS prevents Manager self-approval; the resubmission policy clears approval metadata and `approve_supplier` records the next decision | `suppliers`, `supplier_approval_history`, `users` |
| UC04 | Manager | Catalog Categories tab creates, edits, searches, filters and activates/deactivates | Authenticated Manager/Admin CRUD with validation | `categories` |
| UC05 | Manager | Product list opens dedicated Create/Edit pages and confirms writes | Product CRUD verifies approved Supplier and valid Category | `products`, `categories`, `suppliers` |
| UC06 | Manager | Batch list opens dedicated Create/Edit pages and confirms writes | Batch CRUD validates dates, code, Product and Supplier; inventory row is initialized | `batches`, `inventory`, `inventory_transactions` |
| UC07 | Manager | Generate QR action downloads/displays a trace QR; Product/Order/Shipper screens can show the same batch QR for scanning practice | `generate-batch-qr` and `render-batch-qr` sign direct trace URLs | `batches.qr_code` |
| UC08 | Manager | Inventory tab searches batches and confirms stock adjustment | `adjust_inventory` enforces nonnegative available stock and writes an audit event | `inventory`, `inventory_transactions` |
| UC09 | Manager | Prices tab creates/edits normal, promotion and rescue prices | RLS and constraints validate amount, batch/product and date range | `prices` |
| UC10 | Manager | Rescue tab creates/edits/deactivates an eligible deal | Constraints reject invalid price/date/batch combinations | `fresh_rescue_deals`, `batches`, `inventory` |
| UC11 | Customer | Responsive Rescue catalog opens details and adds a batch to cart | `search_products` returns only active, stocked, valid offers | `fresh_rescue_deals`, `products`, `batches`, `inventory`, `prices` |
| UC12 | Manager | Operations searches/filters orders, confirms, starts preparation and reviews supplier packing groups | Guarded RPCs enforce valid `pending -> confirmed -> preparing` transitions | `orders`, `order_items`, `order_tracking` |
| UC13 | Manager | Operations filters available Shippers and confirms assignment | `assign-delivery` validates role, order state and active assignment | `deliveries`, `orders`, `users` |
| UC14 | Shipper | Mobile delivery cards show only assigned jobs | Delivery RLS limits Employee access to their assignments | `deliveries`, `orders`, `users` |
| UC15 | Shipper | Mobile camera, chosen QR image, captured QR image, or the in-order QR modal verifies each delivery batch; verified batches are marked immediately | `verify-delivery-batch` checks assignment and required order batches | `delivery_batch_checks`, `order_items`, `batches` |
| UC16 | Shipper | Mobile actions update pickup, delivering, delivered or failed with confirmation | `update-delivery-status` enforces transition, QR verification and payment/remittance gates | `deliveries`, `orders`, `order_tracking`, `notifications` |
| UC17 | Customer, Shipper | Order-linked chat with grouped avatars, files, shares and reactions | Room RPC verifies Customer/Shipper assignment; Realtime broadcasts updates | `chat_rooms`, `chat_room_members`, `chat_messages`, `chat_message_reactions` |
| UC18 | Customer, Manager | One reusable Manager chat per customer/manager pair, with product or owned-order cards shared inside it | Room RPC verifies roles, product availability and order relationship without duplicating rooms per order | Same chat tables plus `orders`, `products` |
| UC19 | Manager, Shipper | Order-linked operational chat | Room RPC requires the Shipper assignment | Same chat tables plus `deliveries` |
| UC20 | Manager, Admin | Governance/operations chat | Room RPC validates the Manager/Admin role pair | Chat tables |
| UC21 | All roles | Unread badge, notification list, Mark all as read and deep links update live | Database triggers create events; Realtime subscription receives inserts/updates | `notifications`, Realtime publication |
| UC22 | Customer, Admin, Manager | Customer submits an order/product/payment/delivery complaint or reports a related user; Admin searches, filters and resolves/rejects it; the reporter, reported user, and assigned order Manager receive the applicable result | Ownership/relationship validation and Admin resolution RPCs protect state changes and issue idempotent notifications/reward | `reports`, `orders`, `order_manager_assignments`, `users`, `notifications`, `coupons` |
| UC23 | Customer | Registration requires email confirmation before normal login | Supabase Auth sends confirmation email; auth trigger creates Customer profile/cart | `auth.users`, `users`, `carts`, `coupons` |
| UC24 | All roles | Profile edits identity/avatar; password change uses an emailed recovery link and dedicated reset page | Profile RLS protects fields; signed Cloudinary upload; Supabase recovery/update API | `users`, `auth.users` |
| UC25 | Customer | Responsive browse and product detail screens use the same Cloudinary-backed image resolver as Home, Assistant and Chat | Catalog RPC aggregates current stock, price, Rescue and review data | `products`, `batches`, `inventory`, `prices`, `reviews`; image binaries in Cloudinary |
| UC26 | Customer | Search/filter by keyword, category, certificate, price and Rescue | Parameterized `search_products` RPC performs server-side filtering | Catalog tables |
| UC27 | Customer/Public | Mobile camera/captured image, Product QR, Order QR, direct trace URL or manual batch code opens trace details | Public `trace-batch` returns only trace-safe fields | `batches`, `products`, `suppliers` |
| UC28 | Customer | Add, change quantity, note and remove with confirmation | RLS plus cart/product/batch/stock invariants validate every item | `carts`, `cart_items`, `inventory` |
| UC29 | Customer | Per-item shopping notes and order-level note | Checkout copies notes into the immutable order snapshot | `cart_items.note`, `orders.note`, `order_items.note` |
| UC30 | Customer | Checkout confirms address, payment, coupon and total | Transactional `checkout_cart` locks stock, applies one coupon and creates order/payment | `orders`, `order_items`, `inventory`, `payments`, `coupons` |
| UC31 | Customer, Shipper | Customer prepays by payOS or pays COD at delivery; Shipper handles direct transfer/cash remittance | Signed payment creation/webhook and COD settlement functions enforce purpose and amount | `payments`, `payos_requests`, `delivery_payment_collections` |
| UC32 | Customer | Orders page searches/filters, shows timeline and permits cancellation only while pending | `cancel-order` releases stock; paid pending orders issue exact-value credit | `orders`, `order_tracking`, `inventory`, `payments`, `coupons` |
| UC33 | Customer | Completed-order Product review form submits rating/comment | RLS requires ownership and a completed purchase | `reviews`, `orders`, `order_items` |
| UC34 | Customer, Admin | Assistant understands product, price, expiry and certification requests; Admin mode summarizes users, reports, finance and monitoring; result cards deep-link to the matching workspace | `fresh-assistant` gathers authorized live data, applies deterministic intent/ranking, and optionally uses Gemini for a concise natural-language answer | Product, user, report, payment and monitoring data; request/answer audit in `assistant_logs` |

## Additional Report-Defined Use Cases

The current report already defines UC35-UC36 and UC38-UC46. UC37 is intentionally
skipped because Customer Analytics was removed from the final scope.

| UC | Actor | Use case and frontend flow | Backend/API flow | Database flow |
|---|---|---|---|---|
| UC35 | Chat members | Attach an image/file up to 10 MB | `sign-cloudinary-upload` authorizes folder/type; browser uploads directly | Attachment metadata in `chat_messages`; binary in Cloudinary |
| UC36 | Chat members | Choose one reaction per message and change/remove it | RLS verifies room membership and reaction ownership | Unique `(message_id,user_id)` in `chat_message_reactions` |
| UC38 | Admin | Finance page chooses any week, month or year up to the current period with English selectors, chart window around the selected period and CSV export | Admin-readable payment/order aggregates grouped by matching period keys | `payments`, `orders`, `order_items` |
| UC39 | Manager | One multi-supplier order is packed by Supplier groups and assigned to one Shipper | Existing order/assignment APIs keep one atomic order and delivery | `orders`, `order_items`, `suppliers`, `deliveries` |
| UC40 | Customer, Shipper | Doorstep COD uses Shipper cash confirmation/remittance QR or Customer direct payOS QR | Purpose-bound payOS request/webhook and delivery completion gate | `payments`, `payos_requests`, `delivery_payment_collections` |
| UC41 | Customer | Cancel a paid pending order after confirmation and receive full-value credit | `cancel-order` creates one idempotent coupon and notification | `orders`, `payments`, `coupons`, `notifications` |
| UC42 | Admin | Export polished finance summary/detail CSV for the selected week, month or year | Client exports only Admin-authorized queried rows | Read-only finance tables |
| UC43 | All eligible chat roles | Share a Product or owned Order into an eligible conversation | Room RPC validates relationship, Product state and Order ownership | `chat_messages.shared_product_id`, `shared_order_id` |
| UC44 | Customer | View reward progress; receive two welcome free-shipping coupons and one 10% coupon; earn free shipping per 500K delivered spend, 10% per 1M, 20% per 2M, free shipping per 5 delivered orders, 10% per 10 orders, 10K per approved report, and an optional 5K-20K reward for a delivered order of at least 1M | Signup, completed-delivery and report-resolution triggers issue idempotent rewards; coupons are single-use, restored on eligible pending cancellation and deleted after successful order completion | `coupons`, `orders`, `deliveries`, `reports` |
| UC45 | All roles | Request password recovery/change by email and set a new password in a recovery session | Supabase Auth recovery email and `updateUser` | `auth.users` |
| UC46 | Admin, Manager | Search/filter Monitoring with date/status filters, drawer-based Catalog CRUD, unified workflow Operations, Users, Reports and Finance | Existing RLS/RPC scopes each result set by role | Corresponding domain tables |

## Implementation-Only Use Case

| UC | Actor | Use case and frontend flow | Backend/API flow | Database flow |
|---|---|---|---|---|
| UC47 | Customer, Admin, reported user, Manager | Customer reports a user related through an order/chat; Admin resolves it; affected actors receive the applicable notification | `list_reportable_users`, report validation and `resolve_report` enforce relationship, ownership, reward and notification rules | `reports.reported_user_id`, `order_manager_assignments`, `notifications`, `coupons` |

## Differences From The Report

- **UC03 was strengthened:** approved Supplier edits now return the Supplier to
  `pending`, clear its previous approval, temporarily hide affected public catalog
  results, and require a new Admin decision.
- **UC04-UC10 were strengthened:** Catalog supports confirmed create/edit/delete or
  deactivate/lock flows. Foreign-key history blocks unsafe hard deletes with a
  user-facing explanation. Batch quantity changes atomically synchronize Inventory
  and create an audit transaction.
- **UC22 was expanded:** the report described complaints primarily around orders
  and products. The implementation also supports reporting a user who is related
  through an order or chat. Resolution notifies the reporter and, where applicable,
  the reported user and assigned Manager.
- **UC25/UC34 were strengthened:** Home, Product, Assistant and shared-product cards
  resolve the same Cloudinary image by product name, preventing a stale database URL
  from producing inconsistent images.
- **UC32/UC44 add promotion behavior:** a paid pending cancellation issues exact-value
  credit; delivered milestones and approved reports issue loyalty coupons. These
  reward rules are additions beyond the original report.
- **Catalog sample coverage was expanded:** the active database now includes a
  traceable Meat category, beef Product, Batch, Inventory and Price in addition to
  the report's produce examples.

## Scope Decision

FreshTrace models Managers as centralized marketplace operators, not independent
sellers. A cart may contain batches from multiple Suppliers, but checkout creates
one order, one payment and one consolidated delivery. Splitting into seller
sub-orders would require store ownership, split settlement, partial cancellation,
multiple deliveries and refund allocation, none of which belongs to the report's
domain model.

## Runtime Requirements

- Realtime requires the full local Supabase stack or Supabase cloud.
- payOS requires valid sandbox/live credentials and a publicly reachable webhook.
- Cloudinary uploads require valid credentials in `supabase/.env.local`.
- Live browser camera streaming requires HTTPS or device-local `localhost`.
- LAN HTTP mobile testing uses QR image capture/upload or manual batch code as a
  standards-compliant fallback.
