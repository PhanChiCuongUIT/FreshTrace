# FreshTrace Frontend

React, TypeScript, Vite, Tailwind CSS, TanStack Query, and Supabase client application
for the FreshTrace marketplace.

## Implemented Roles

- Customer mobile and desktop: product detail and filters, Fresh Rescue, cart notes,
  checkout, payment results, tracking, camera traceability, reviews, reports,
  assistant, structured product/order sharing, chat, notifications, transactions,
  avatar upload, password and profile.
- Manager desktop: metrics and revenue, category/product/batch/inventory/price/Rescue
  management in separate catalog sections, supplier submission, QR generation,
  order preparation and assignment.
- Employee/Shipper mobile-first: assigned deliveries, camera batch verification,
  phone call action, COD collection, payOS cash remittance, guarded status
  transitions, failed delivery handling and QR/payment verification.
- Admin desktop: metrics, users/roles/status, supplier approval, report resolution,
  Financial Reports, and read-only product/order/payment monitoring.

## Run

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_BASE_URL` in
`.env.local`. Use the local publishable key shown by `npx supabase status`, or the
publishable key from the Supabase project dashboard.

The application runs at `http://localhost:5173`.

Camera scanning works on `localhost` or HTTPS. Edge Function features require the
full local Supabase runtime or a deployed Supabase project.

Only browser-safe configuration belongs in this frontend file:

```env
VITE_SUPABASE_URL=http://127.0.0.1:55421
VITE_SUPABASE_ANON_KEY=your_local_publishable_key
VITE_API_BASE_URL=http://127.0.0.1:55421/functions/v1
VITE_QR_TRACE_BASE_URL=http://localhost:5173/trace
```

For a physical phone on the same Wi-Fi, replace `127.0.0.1` and `localhost` with
the computer LAN IPv4 address and run:

```powershell
npm run dev -- --host 0.0.0.0
```

LAN HTTP does not provide browser camera permission. Use HTTPS or a deployed build
for QR scanning and mobile capture flows.

## Verify

```powershell
npm run lint
npm run build
```
