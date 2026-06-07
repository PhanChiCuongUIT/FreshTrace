# FreshTrace Backend API

## Authentication

Authenticated requests use:

```http
Authorization: Bearer <supabase_access_token>
apikey: <supabase_publishable_key>
```

Standard CRUD uses Supabase JS/PostgREST. RLS restricts rows by user and role.

## Auth and Accounts

- Signup, sign-in, password reset, and session management: Supabase Auth.
- The signup trigger creates a `customer` profile and one cart.
- Current profile: `users?select=*,roles(role_name)`.
- Admins create, disable, and assign roles through `admin-users`.

```http
POST /functions/v1/admin-users
{"action":"create","email":"shipper@example.com","password":"...","name":"Shipper","role":"employee"}
```

```http
POST /functions/v1/admin-users
{"action":"update","userId":"<uuid>","status":"banned","role":"employee"}
```

## Catalog

Recommended frontend query:

```ts
supabase.rpc("search_products", {
  p_query: "spinach",
  p_category_id: null,
  p_certificate: "VietGAP",
  p_rescue_only: false,
  p_min_price: 10000,
  p_max_price: 100000,
  p_limit: 20,
  p_offset: 0
})
```

The RPC returns the product, category, supplier, FEFO batch, available inventory,
current price, Fresh Rescue information, and rating.

Catalog tables are also available through PostgREST:

- `categories`
- `products`
- `suppliers`
- `batches`
- `inventory`
- `prices`
- `fresh_rescue_deals`
- `reviews`

## Manager and Admin Operations

Managers maintain categories, products, batches, prices, and rescue deals through
PostgREST. Database constraints validate approved suppliers, product/batch consistency,
prices, inventory, and rescue eligibility.

Adjust inventory:

```ts
supabase.rpc("adjust_inventory", {
  p_batch_id: batchId,
  p_new_quantity: 50,
  p_note: "End-of-day stock count"
})
```

Approve a supplier:

```ts
supabase.rpc("approve_supplier", {
  p_supplier_id: supplierId,
  p_status: "approved",
  p_response: null
})
```

Resolve a report:

```ts
supabase.rpc("resolve_report", {
  p_report_id: reportId,
  p_status: "resolved",
  p_response: "The issue has been resolved."
})
```

Generate a QR code:

```http
POST /functions/v1/generate-batch-qr
{"batchId":"<uuid>"}
```

Render an existing batch QR for Product, Order, or Shipper verification screens:

```http
POST /functions/v1/render-batch-qr
{"batchId":"<uuid>"}
```

or:

```http
POST /functions/v1/render-batch-qr
{"batchCode":"FT-SPINACH-001"}
```

Returns `{ batchId, batchCode, traceUrl, qrDataUrl }`.

## Cart and Checkout

Customers maintain `cart_items` through PostgREST. A trigger validates product/batch
consistency, expiration, status, and available inventory.

```ts
supabase.rpc("checkout_cart", {
  p_delivery_address: "123 Main Street",
  p_payment_method: "cod",
  p_delivery_fee: 20000,
  p_note: "Deliver during business hours"
})
```

Checkout runs in one database transaction: it locks inventory, creates the order,
items, payment, and tracking record, reserves stock, clears the cart, and creates
notifications. It also assigns the least-loaded active Manager and creates the
Customer-Manager order conversation.

```http
POST /functions/v1/cancel-order
{"orderId":"<uuid>","reason":"Plans changed"}
```

The function cancels an existing payOS payment link before releasing reserved stock.
A paid order cannot be cancelled until a refund workflow is implemented.

## Orders and Delivery

```ts
supabase.rpc("confirm_order", { p_order_id: orderId })
```

```http
POST /functions/v1/assign-delivery
{"orderId":"<uuid>","employeeId":"<uuid>"}
```

Assignment automatically creates Customer-Shipper and Manager-Shipper order rooms.

```http
POST /functions/v1/verify-delivery-batch
{"deliveryId":"<uuid>","batchId":"<uuid>"}
```

```http
POST /functions/v1/update-delivery-status
{"deliveryId":"<uuid>","status":"delivered","proofImageUrl":"https://..."}
```

Valid flow: `assigned -> picked_up -> delivering -> delivered`. Every order batch
must be verified before pickup. Delivery proof is required for `delivered`. COD
orders must also have a recorded collection before completion. A cash collection
must have `remittance_status = paid` before the delivery can be completed.

## Payments

payOS requests have an explicit purpose so webhook processing cannot confuse
checkout, doorstep Customer COD payment, and Shipper cash remittance:

```http
POST /functions/v1/create-payos-payment
{"orderId":"<uuid>","purpose":"checkout"}
```

```http
POST /functions/v1/create-payos-payment
{"orderId":"<uuid>","purpose":"customer_cod"}
```

`customer_cod` is authorized only for the assigned Shipper while the delivery is
in `delivering`. Its QR is shown on the Shipper screen for the Customer to scan.

```http
POST /functions/v1/record-delivery-payment
{"deliveryId":"<uuid>","method":"cash"}
```

Collection methods include `cash` and `customer_payos` (`bank_transfer` remains for
legacy records). Cash creates a pending remittance obligation. The assigned Shipper
creates its payOS QR with:

```http
POST /functions/v1/create-payos-payment
{"orderId":"<uuid>","purpose":"shipper_remittance"}
```

Webhook:

```http
POST /functions/v1/payos-webhook
```

The webhook does not require a Supabase JWT, but it requires a valid payOS HMAC
signature. `payos_requests` records the purpose and the webhook applies only the
corresponding payment or remittance transition.

Only a `pending` order may be cancelled. If its payment is already `paid`, the
transaction remains paid for audit purposes and FreshTrace issues an active coupon
whose value equals the payment amount.

## QR Traceability

```http
GET /functions/v1/trace-batch?batchId=<uuid>
GET /functions/v1/trace-batch?code=<batch_code>
```

## Chat and Realtime

```ts
supabase.rpc("create_chat_room", {
  p_type: "customer_shipper",
  p_other_user_id: shipperUserId,
  p_order_id: orderId,
  p_product_id: null
})
```

The database verifies that the Customer owns the order and that the Shipper is assigned
to it. General Customer-Manager support rooms may omit both order and product.
Messages are inserted into `chat_messages`; only room members can read or send.
Use `list_my_chat_rooms()` to get the other member's correct name, avatar, role,
phone, email, and related order code.

Text and attachment-only messages are supported:

```ts
supabase.from("chat_messages").insert({
  room_id: roomId,
  sender_id: profileId,
  message: null,
  attachment_url: cloudinaryUrl,
  attachment_name: "quality-report.pdf",
  attachment_type: "application/pdf",
  attachment_size: 2048
})
```

Reactions are stored in `chat_message_reactions`. The allowed values are `like`,
`love`, `laugh`, `wow`, and `sad`. RLS validates room membership; only the reaction
owner can remove it. A user has at most one reaction per message; upserting a
different value changes the reaction.

Products and orders can be shared as structured chat cards through
`shared_product_id` or `shared_order_id`. Order sharing is restricted to the
related order conversation unless the sender is an Admin or Manager.

Subscribe to `chat_messages`, `notifications`, `orders`, `order_tracking`, and
`deliveries` through Supabase Realtime. Chat clients also subscribe to
`chat_message_reactions`.

## Notifications

Users can only read and change `is_read` on their own notifications. Triggers protect
the owner, content, type, target, and creation time.

```http
POST /functions/v1/create-notification
{"userId":"<uuid>","title":"...","content":"...","type":"...","targetUrl":"/..."}
```

## Cloudinary

```http
POST /functions/v1/sign-cloudinary-upload
{"folder":"products"}
```

Supported folders: `products`, `certificates`, `deliveries`, `avatars`, and `chat`.
The browser never receives `CLOUDINARY_API_SECRET`; it receives only a short-lived
signed upload payload from this function.

## Fresh Assistant

```http
POST /functions/v1/fresh-assistant
{"question":"I need certified vegetables with a long shelf life"}
```

The rule-based MVP only returns products that exist in the database. It supports
cheapest, nearest expiry, longest shelf life, Fresh Rescue savings, certified
products, and vegetable requests. An AI provider is optional.
