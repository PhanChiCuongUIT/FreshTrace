# FreshTrace Presentation and Demo Guide

This guide is written for the project defense/demo. It summarizes what to put in
the slide deck and which user flows to demonstrate.

## Recommended Slide Structure

1. Title and team information
   - Project name: FreshTrace.
   - Short tagline: smart clean-food marketplace with traceability.
   - Student, class, instructor and date.

2. Problem and motivation
   - Customers need trusted clean-food origin, expiry visibility and convenient
     buying.
   - Managers need catalog, batch, stock, price and rescue control.
   - Shippers need mobile verification and payment settlement.
   - Admins need governance, monitoring and finance reporting.

3. Objectives and scope
   - Build a role-based marketplace for Customer, Manager, Employee/Shipper and
     Admin.
   - Support product discovery, QR traceability, cart/checkout, Fresh Rescue,
     delivery, chat, reports, coupons and governance.

4. Actors and use cases
   - Customer: browse, assistant, trace QR, cart, checkout, coupon, orders,
     report, review, chat, profile.
   - Manager: suppliers, categories, products, batches, prices, rescue,
     inventory, order operations.
   - Employee/Shipper: assigned deliveries, batch QR check, pickup, delivery,
     COD cash/payOS settlement.
   - Admin: user governance, supplier/report moderation, monitoring, finance.

5. System architecture
   - Frontend: React, TypeScript, Vite, TanStack Query.
   - Backend: Supabase Auth, PostgreSQL, RLS, RPC, Realtime and Edge Functions.
   - Integrations: Cloudinary for media, payOS for payment, Resend/Gmail SMTP for
     email, Gemini for Assistant, QR generation/scanning for traceability.

6. Database overview
   - Identity: `auth.users`, `users`, `roles`.
   - Catalog: `suppliers`, `categories`, `products`, `batches`, `inventory`,
     `inventory_transactions`, `prices`, `fresh_rescue_deals`.
   - Commerce: `carts`, `cart_items`, `orders`, `order_items`, `payments`,
     `coupons`, `payos_requests`.
   - Fulfillment and support: `deliveries`, `delivery_batch_checks`,
     `delivery_payment_collections`, `order_tracking`, `reports`, `reviews`,
     `chat_*`, `notifications`, `assistant_logs`.

7. Important business logic
   - RLS protects role-based access.
   - Checkout locks inventory and creates order/payment/tracking data in one
     transaction.
   - Fresh Rescue original price is copied from the active Prices row and is
     read-only in the UI.
   - Product images are uploaded to Cloudinary only after Save.
   - Inactive/banned accounts are blocked during login, signup and password
     reset; Admin governance emails include the acting admin and support address.
   - payOS webhook is supported, and `sync-payos-payment` is the fallback when
     webhook access is unavailable.

8. Testing and deployment
   - Local test commands: `npm run test:backend`, `npm run test:catalog-crud`,
     `npm run test:types`, `npm run frontend:build`, `npm run backend:lint`.
   - Production: Vercel frontend, Supabase Cloud backend, Resend SMTP,
     Cloudinary, payOS, Gemini.
   - Mention production smoke test and demo seed data.

9. Demo flow
   - Use the actor sequence below.
   - Keep production as the preferred demo target if it is stable.
   - Keep local as a backup target for CRUD and database flows.

10. Limitations and future work
    - Real payment operations depend on payOS account capability and webhook
      access.
    - More analytics, merchant onboarding, native mobile app and advanced AI
      personalization can be future extensions.

## Recommended Demo Target

Use production for the main defense demo if the Vercel and Supabase Cloud setup
is stable. Production is better for:

- Phone camera QR scanning because HTTPS is available.
- Gmail confirmation/password recovery emails.
- payOS return flow and public Cloudinary assets.
- Showing the app as a real deployed system.

Keep local ready as a fallback for:

- Manager Catalog CRUD.
- Admin governance.
- Seeded demo data that must remain predictable.
- Cases where payOS, email or network services are unstable during presentation.

## Demo Flow By Actor And Use Case

### 1. Customer discovery and checkout

Account: `customer@freshtrace.local`

Use cases:

- Login/register.
- Browse products and Fresh Rescue.
- Ask Fresh Assistant for a recommendation, for example "rau rẻ nhất" or
  "Fresh meat".
- Open product detail and traceability QR/batch information.
- Add to cart.
- Apply coupon.
- Checkout with COD or payOS.

Goal: show the customer can find trusted food, see origin/expiry, use coupons and
place an order.

### 2. Manager catalog and operations

Account: `manager@freshtrace.local`

Use cases:

- Open Dashboard.
- Create/edit a product or batch.
- Show product image selection and explain that it uploads to Cloudinary only
  after Save.
- Create/edit price.
- Create Fresh Rescue deal and show that original price is read-only from Prices.
- Adjust inventory and explain stock count/import/export/reserve/release.
- Open Operations, confirm/preparing order and assign Shipper.

Goal: show the supplier-product-batch-price-inventory-rescue workflow and order
handoff to delivery.

### 3. Shipper delivery and COD/payment settlement

Account: `shipper@freshtrace.local`

Use cases:

- Open mobile Shipper Deliveries.
- Switch between assigned, picked-up, delivering and delivered tabs.
- Scan or upload batch QR to verify pickup.
- Move delivery to picked-up/delivering.
- For COD, either record cash collection and remittance payOS QR, or show the
  customer payOS QR on the Shipper screen.
- Complete delivery after required payment/verification conditions are satisfied.

Goal: show the delivery use case is mobile-first, QR-verified and payment-aware.

### 4. Customer after checkout

Account: `customer@freshtrace.local`

Use cases:

- Open Orders and tracking timeline.
- Chat with Manager/Shipper.
- Report an issue or review a completed order.
- Cancel a pending order if needed; paid pending order returns a coupon.

Goal: show order tracking, support and post-order workflows.

### 5. Admin governance and reporting

Account: `admin@freshtrace.local`

Use cases:

- Open Dashboard.
- Manage users with search/filter.
- Inactive/ban a user with reason and governance email.
- Review supplier approval/report moderation.
- Open Monitoring tabs for orders, deliveries, payments, catalog and inventory.
- Open Finance, choose week/month/year, review charts and export CSV.

Goal: show Admin oversight, security governance and finance reporting.

## Demo Notes

- If payOS webhook is unavailable, explain that FreshTrace uses
  `sync-payos-payment` after the payOS return screen or from the Shipper QR dialog.
- Do not spend too long creating data during the demo. Use seeded data first, then
  create one small new product/rescue/order only if time allows.
- If production payment is unstable during the defense, switch to COD and mention
  that webhook/payment reconciliation is already implemented in the backend.
