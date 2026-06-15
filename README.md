# FreshTrace

FreshTrace is a smart clean-food marketplace with traceability, Fresh Rescue,
role-based operations, delivery verification, realtime communication, coupons,
email governance, and COD/payOS payments.

## Features

- Customer marketplace with responsive desktop/mobile product discovery, cart,
  coupons, checkout, order tracking, reviews, reports, chat, QR traceability and
  Fresh Assistant recommendations.
- Mobile-first Shipper workflow with assigned/picked-up/delivering/delivered
  delivery states, batch QR verification, COD cash collection and payOS QR
  settlement.
- Manager workspace for suppliers, categories, products, batches, prices, Fresh
  Rescue and audited inventory adjustments.
- Admin workspace for users, governance, operational monitoring, finance reports,
  CSV export and account status enforcement.
- Hardened backend with PostgreSQL constraints, RLS, RPC workflows, Edge
  Functions, Cloudinary signed uploads, Realtime chat/notifications and Gemini
  Assistant fallback logic.

## Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS, TanStack Query
- Backend: Supabase Auth, PostgreSQL, RLS, PostgREST, RPC, Realtime, Edge Functions
- Integrations: payOS, Cloudinary, Resend/Gmail SMTP, Gemini, QR traceability

The application covers the 34 MVP use cases in the project report. See
[End-to-End Use Case Coverage](docs/use-case-coverage.md) and
[System Summary](docs/system-summary.md).

The responsive strategy is role-specific:

- Customer: mobile web and desktop web.
- Employee/Shipper: mobile-first web with camera QR scanning and photo capture.
- Manager and Admin: desktop administration workspaces.

## Prerequisites

- Node.js 20 or newer
- npm
- Docker Desktop
- A Supabase cloud project for deployment and full Edge Function testing
- payOS and Cloudinary accounts for live integrations

## Install

```powershell
npm install
npm run frontend:install
Copy-Item supabase\.env.local.example supabase\.env.local
Copy-Item frontend\.env.example frontend\.env.local
```

## Run Locally

Start Docker Desktop, then start and reset the local backend:

```powershell
npm run backend:start
npm run backend:reset
npm run seed:demo
npx supabase status
```

Copy the displayed `PUBLISHABLE_KEY` into `VITE_SUPABASE_ANON_KEY` in
`frontend/.env.local`. Never put `SECRET_KEY` or `SERVICE_ROLE_KEY` in the frontend.

Check configuration without printing secret values:

```powershell
npm run env:check
```

If `backend:functions` reports a 403 response for
`https://jsr.io/@panva/jose/meta.json`, the current network is receiving a
Cloudflare challenge from JSR. Apply the repository workaround once:

```powershell
npm run backend:runtime-fix
```

The command builds a local image from the official Supabase Edge Runtime and changes
only its bootstrap import from `jsr:@panva/jose@6` to `npm:jose@6.1.2`. Function
source code and cloud deployment are unchanged. Re-run the fix after pulling or
updating the official `v1.74.0` image.

Start Edge Functions in another terminal:

```powershell
npm run backend:functions
```

Keep this terminal running when testing Cloudinary upload, payOS, QR rendering,
delivery APIs, cancellation, notifications and Fresh Assistant. `backend:start`
intentionally does not start the embedded Edge Runtime, because that runtime does
not load `supabase/.env.local` secrets on this Windows local setup.

With Edge Functions running, migrate demo product images, avatars, and a chat
attachment into the configured Cloudinary account:

```powershell
npm run seed:cloudinary
```

The command is idempotent for records that already use `res.cloudinary.com`.

Start the frontend in a third terminal:

```powershell
npm run frontend:dev
```

Open `http://localhost:5173`.

The reset adds a representative catalog with approved and pending suppliers, twelve
products, traceable batches, inventory, prices, and active Fresh Rescue deals.
`npm run seed:demo` then creates operational data and these local accounts:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@freshtrace.local` | `FreshTrace!123` |
| Manager | `manager@freshtrace.local` | `FreshTrace!123` |
| Manager | `manager.hcm@freshtrace.local` | `FreshTrace!123` |
| Employee/Shipper | `shipper@freshtrace.local` | `FreshTrace!123` |
| Employee/Shipper | `shipper.linh@freshtrace.local` | `FreshTrace!123` |
| Customer | `customer@freshtrace.local` | `FreshTrace!123` |
| Customer | `customer.lan@freshtrace.local` | `FreshTrace!123` |

The local demo intentionally contains only seven application accounts: one Admin,
two Managers, two Shippers, and two Customers.

The demo command is for local development only. It also creates pending and
completed COD orders, delivery tracking, a review, a report, chat rooms, messages,
and notifications.

## Environment File Ownership

- `.env`: retained legacy frontend configuration. It is not loaded by the current
  `frontend` Vite process.
- `frontend/.env.local`: browser-safe values only: Supabase URL, publishable key,
  Edge Function base URL and QR trace URL.
- `supabase/.env.local`: local Edge Function secrets for payOS, Cloudinary and
  optional AI providers.
- `supabase-secrets.example.env`: cloud deployment template only.

Do not prefix backend secrets with `VITE_`. Every `VITE_` value is embedded into the
browser bundle and must be treated as public.

The frontend needs only these browser-safe values:

```env
VITE_SUPABASE_URL=http://127.0.0.1:55421
VITE_SUPABASE_ANON_KEY=your_local_publishable_key
VITE_API_BASE_URL=http://127.0.0.1:55421/functions/v1
VITE_QR_TRACE_BASE_URL=http://localhost:5173/trace
VITE_SITE_URL=http://localhost:5173
VITE_AUTH_REDIRECT_URL=http://localhost:5173/login
VITE_PASSWORD_RESET_REDIRECT_URL=http://localhost:5173/reset-password
```

payOS secret keys, Cloudinary API secrets, service-role keys, and AI provider keys
belong only in `supabase/.env.local`.

Required values for live integrations in `supabase/.env.local`:

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
PAYOS_CLIENT_ID=
PAYOS_API_KEY=
PAYOS_CHECKSUM_KEY=
SMTP_HOST=smtp.gmail.com
SMTP_USER=your_gmail_address@gmail.com
SMTP_PASS=your_gmail_app_password
SMTP_ADMIN_EMAIL=your_gmail_address@gmail.com
SMTP_SENDER_NAME=FreshTrace
SUPPORT_EMAIL=your_support_email@example.com
EMAIL_LOGO_URL=https://res.cloudinary.com/dbltlcpkc/image/upload/v1780920367/freshtrace/email/logo-freshtrace.png
```

Supabase Auth sends signup confirmation and password reset emails through real
SMTP. For Gmail, enable 2-Step Verification, create an App Password, remove spaces
from that app password, put it in `SMTP_PASS`, then restart the backend:

```powershell
npm run backend:stop
npm run backend:start
```

Test real email delivery with:

```powershell
npm run test:email -- -Email youraddress@gmail.com
```

The email templates live in `supabase/templates`. The FreshTrace logo is uploaded
to Cloudinary with `npm run seed:email-logo` so Gmail can load it from a public
HTTPS URL instead of a local LAN address.

Local Auth email uses:

- `supabase/templates/confirmation.html`
- `supabase/templates/recovery.html`

Edge Function emails, such as Admin inactive/ban governance notices, use the same
FreshTrace branded layout from `supabase/functions/_shared/email.ts`. Set
`EMAIL_LOGO_URL` only when you want to override the default public logo.

For Supabase Cloud production, copy the same Auth templates into Supabase
Dashboard -> Authentication -> Emails -> Templates. The hosted Auth service does
not automatically read the files in this repository.

Local Auth email rate limiting is raised in `supabase/config.toml` for development
(`auth.rate_limit.email_sent = 60`, `auth.email.max_frequency = "5s"`). If you use
a hosted Supabase project, set the equivalent Auth rate limit in the Supabase
Dashboard/API.

For a low-memory backend:

```powershell
npm run backend:start:lite
```

Lite mode provides Database, Auth, and REST. It does not provide local Realtime,
Storage, Studio, or Edge Functions. Use the full stack or a Supabase cloud project
for chat subscriptions, notifications, payOS, Cloudinary signing, QR generation,
Fresh Assistant, delivery APIs, and admin user APIs.

Add payOS and Cloudinary credentials to `supabase/.env.local` before testing online
payment or image upload. Product/avatar/chat images are uploaded to Cloudinary
through signed Edge Function payloads, and Manager product image changes are only
committed after Save. The catalog, cart, COD, database RPCs and Auth do not need
those third-party credentials.

If the local Edge Runtime receives HTTP 403 while downloading `@panva/jose` from
`jsr.io`, the failure occurs before FreshTrace code loads. Allow access to `jsr.io`,
or deploy the functions to Supabase cloud.

## Verify

```powershell
npm run backend:lint
npm run test:types
npm run test:backend
npm run test:realtime
npm run test:email
npm run frontend:lint
npm run frontend:build
```

`npm run test:backend` reads local credentials from `supabase status` without
printing them and runs both the smoke and integration suites.

The suite currently verifies 19 groups, including Manager supplier submission and
Admin approval, order preparation transitions, relationship-based chat contacts,
transactional checkout, COD settlement and cash remittance, delivery batch gates,
inventory enforcement, Fresh Rescue eligibility, paid cancellation coupons,
failed-delivery reassignment, report ownership and banned-user access revocation.

Fresh Rescue original prices are stored from the active `prices` table, not from
free text. The Manager Rescue form shows the original price as read-only and the
database rejects active rescue deals without a valid active catalog price.

## Bootstrap the First Admin

Signup creates a Customer profile. Promote the first account in the Supabase SQL
Editor:

```sql
update public.users
set role_id = (select role_id from public.roles where role_name = 'admin')
where email = 'your-admin@example.com';
```

The Admin can then create Managers and Employees from the frontend.

## Deploy

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-production.ps1
```

The compact production setup is Vercel for the frontend and Supabase Cloud for
Auth, PostgreSQL, Realtime and Edge Functions. See
[Production Deployment](docs/production-deploy.md) for the full checklist.

Configure the payOS webhook when your payOS account supports it:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/payos-webhook
```

If webhook access is not enabled for your account yet, FreshTrace still supports
the demo/defense payment flow through `sync-payos-payment`, which checks payOS
payment-request status after return/callback screens and from the Shipper COD QR
flow.

Build the frontend and deploy `frontend/dist` to Vercel or another static host:

```powershell
npm run frontend:build
```

Set the frontend environment values to the cloud Supabase URL, publishable key, and
Edge Function base URL before building.

## Test on a Physical Phone

The phone and computer must use the same Wi-Fi network. Find the computer IPv4
address with `ipconfig`, then replace `192.168.1.20` below with that address:

```env
# frontend/.env.local
VITE_SUPABASE_URL=http://192.168.1.20:55421
VITE_API_BASE_URL=http://192.168.1.20:55421/functions/v1
VITE_QR_TRACE_BASE_URL=http://192.168.1.20:5173/trace
VITE_SITE_URL=http://192.168.1.20:5173
VITE_AUTH_REDIRECT_URL=http://192.168.1.20:5173/login
VITE_PASSWORD_RESET_REDIRECT_URL=http://192.168.1.20:5173/reset-password
```

Also add the LAN frontend origin to `ALLOWED_ORIGINS` in `supabase/.env.local`:

```env
ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.20:5173
```

Run the frontend on all network interfaces:

```powershell
npm run frontend:dev:lan
```

Open `http://192.168.1.20:5173` on the phone. Allow inbound TCP ports `5173` and
`55421` in Windows Firewall if the page or API cannot be reached. Confirmation and
password reset links are sent to the real recipient inbox through SMTP, so use an
email account you can open on the phone.

Plain LAN HTTP is enough for responsive layout, authentication, catalog, cart,
orders, chat, and role screens. Mobile browsers require HTTPS for camera QR
scanning and photo capture. Use an HTTPS development certificate/tunnel, or deploy
the frontend and Supabase backend before testing those features. payOS webhooks
also require a publicly reachable HTTPS backend.

## Documentation

- [Backend API](docs/backend-api.md)
- [End-to-End Use Case Coverage](docs/use-case-coverage.md)
- [Extended Use Cases](docs/extended-use-cases.md)
- [System Summary](docs/system-summary.md)
- [Physical Phone Testing](docs/mobile-testing.md)
- [Use Case Backend Matrix](docs/use-case-backend-matrix.md)
- [Integration Setup Checklist](docs/api-setup-checklist.md)
- [Required Secrets](docs/required-secrets.md)
- [Frontend Guide](frontend/README.md)
- [Production Deployment](docs/production-deploy.md)
- [Presentation and Demo Guide](docs/presentation-demo-guide.md)

## Security

Never commit local environment files, service-role keys, payOS credentials,
Cloudinary secrets, or AI provider keys. Rotate any credential that has appeared in
an old example file.

## Repository Structure

The Supabase backend intentionally remains in the root-level `supabase/` directory.
This is the standard layout expected by Supabase CLI for `config.toml`, migrations,
seed data and Edge Functions. Moving it into `backend/supabase` would require every
CLI command and script to pass a different working directory without providing a
clear architectural benefit.

Supporting backend code remains grouped in:

- `supabase/`: database, RLS, seed and Edge Functions.
- `scripts/`: setup and integration-test automation.
- `docs/`: API, secrets and use-case contracts.
- `docker/`: local infrastructure workarounds only.

Supabase CLI also creates a few local support folders:

- `supabase/.temp/`: generated CLI version/cache metadata.
- `supabase/.branches/`: local branch state, including `_current_branch`.
- `supabase/snippets/`: optional reusable SQL snippets; it may remain empty.

The first two are ignored by Git and must not contain application code.
