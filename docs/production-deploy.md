# FreshTrace Production Deployment

This guide deploys the compact production setup:

- Frontend: Vercel
- Backend, Auth, Database, Realtime, Edge Functions: Supabase Cloud
- Email: Resend SMTP
- Media: Cloudinary
- Payment: payOS
- Assistant: Gemini

## 1. Required Values

Create a Supabase access token:

1. Open Supabase Dashboard.
2. Go to Account menu -> Access Tokens.
3. Create a token for deployment.
4. In PowerShell, set it for the current terminal:

```powershell
$env:SUPABASE_ACCESS_TOKEN="paste_token_here"
```

Project ref is the first part of the Supabase URL:

```text
https://puwfoxlvjzudypbxtrnr.supabase.co
        ^^^^^^^^^^^^^^^^^^^^
```

Current project ref:

```text
puwfoxlvjzudypbxtrnr
```

## 2. Production Secrets

Copy the example file:

```powershell
Copy-Item supabase-secrets.production.example.env supabase-secrets.production.env
```

Fill `supabase-secrets.production.env`.

Where to get each missing value:

- `SMTP_PASS`: Resend -> API Keys -> create Sending access key. It starts with `re_`.
- `SMTP_ADMIN_EMAIL`: use `no-reply@mail.freshtrace.online` after `mail.freshtrace.online` is verified in Resend.
- `SUPPORT_EMAIL`: use `support@freshtrace.online`; forward it in Porkbun to your real inbox.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: Cloudinary Dashboard -> API Keys.
- `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`: payOS Dashboard -> Developer/API credentials.
- `GEMINI_API_KEY`: Google AI Studio -> API keys.
- `EDGE_FUNCTION_SECRET`, `WEBHOOK_VERIFY_SECRET`: generate two random strings of at least 32 characters.

Production URLs should be:

```env
APP_URL=https://freshtrace-app.vercel.app
ALLOWED_ORIGINS=https://freshtrace-app.vercel.app
PAYOS_RETURN_URL=https://freshtrace-app.vercel.app/payment/success
PAYOS_CANCEL_URL=https://freshtrace-app.vercel.app/payment/cancel
PAYOS_WEBHOOK_URL=https://puwfoxlvjzudypbxtrnr.supabase.co/functions/v1/payos-webhook
QR_TRACE_BASE_URL=https://freshtrace-app.vercel.app/trace
```

Do not commit `supabase-secrets.production.env`.

## 3. Deploy Backend

For the FreshTrace defense/demo production environment, reset the linked
Supabase Cloud database, apply all migrations, set Edge Function secrets, and
deploy all Edge Functions:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -ResetLinkedDb
```

This script performs:

1. `supabase link`
2. `supabase db push`
3. `supabase secrets set`
4. Edge Function deployments

The script stops immediately if any Supabase CLI step fails. Do not continue to
deploy functions when `supabase db push` fails, because the functions expect the
latest database schema.

This is destructive for the linked production database. Use it only when the
remote database can be wiped.

For a real production cutover later, where you do not want demo seed data, reset
the schema without `supabase/seed.sql` and do not run the demo seeding step:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -ResetLinkedDb -NoSeed
```

For later non-destructive deployments after the migration history is clean, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-production.ps1
```

To run only the link and migration push:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipSecrets -SkipFunctions
```

### If `db push` says `relation already exists`

Example:

```text
ERROR: relation "roles" already exists
```

This means the Supabase Cloud database already has FreshTrace tables, but the
Supabase migration history does not mark the local migration files as applied.
Do not keep rerunning the full deploy script until the remote database state is
fixed.

First inspect the remote state in Supabase Dashboard -> SQL Editor:

```sql
select version, name, inserted_at
from supabase_migrations.schema_migrations
order by version;

select table_schema, table_name
from information_schema.tables
where table_schema in ('public', 'auth', 'storage')
order by table_schema, table_name;
```

Then choose one path:

- Empty/new production database: reset the remote database or create a fresh
  Supabase Cloud project, then rerun `scripts/deploy-production.ps1`.
- Database has data you must keep: do not reset it. Compare the existing schema
  with the local migrations, then use `supabase migration repair` only for the
  migrations that are already fully applied.

For this project, the cleanest path for a first production deploy is a fresh
empty Supabase database.

Use:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -ResetLinkedDb
```

## 4. Optional Demo Data

For the FreshTrace defense/demo environment, seed demo users and workflows after
the backend deploy succeeds. This creates the same representative demo accounts,
orders, deliveries, reports, chat messages, coupons, and dashboard data used by
the local demo setup.

Get the service-role key from:

```text
Supabase Dashboard -> Project Settings -> API Keys -> service_role
```

This is not the Supabase access token and not the browser anon/publishable key.
It is the secret server-side key for this project, usually a long JWT beginning
with `eyJ...`. Use it only in your local terminal for seeding or trusted backend
scripts.

Set it only in your local terminal:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="paste_service_role_key_here"
$env:FRESHTRACE_DEMO_PASSWORD="FreshTrace!123"
powershell -ExecutionPolicy Bypass -File scripts/seed-production-demo.ps1
```

Never put the service-role key in Vercel or commit it to Git.

Do not run this step for a real production launch.

Demo accounts created by the script:

```text
admin@freshtrace.local
manager@freshtrace.local
manager.hcm@freshtrace.local
shipper@freshtrace.local
shipper.linh@freshtrace.local
customer@freshtrace.local
customer.lan@freshtrace.local
```

Default password:

```text
FreshTrace!123
```

## 5. Supabase Auth Settings

In Supabase Dashboard:

Authentication -> URL Configuration:

```text
Site URL:
https://freshtrace-app.vercel.app

Redirect URLs:
https://freshtrace-app.vercel.app/auth/confirm
https://freshtrace-app.vercel.app/reset-password
https://freshtrace-app.vercel.app/**
```

Authentication -> SMTP Settings:

```text
Sender email address: no-reply@mail.freshtrace.online
Sender name: FreshTrace
Host: smtp.resend.com
Port: 465
Username: resend
Password: re_...
Minimum interval per user: 60
```

## 6. Vercel Frontend Settings

Root directory:

```text
frontend
```

Build command:

```text
npm run build
```

Output directory:

```text
dist
```

Add the browser-safe variables from `.env.production` to Vercel. Never add service-role, payOS secret, Cloudinary secret, SMTP password, or Gemini key to Vercel.

The frontend includes `frontend/vercel.json` so Vercel rewrites direct links such
as `/auth/confirm`, `/reset-password`, `/orders/...`, and `/trace/...` to
`index.html`.

## 7. payOS

Set webhook URL:

```text
https://puwfoxlvjzudypbxtrnr.supabase.co/functions/v1/payos-webhook
```

In the payOS dashboard, open the project/store/application that owns your
`PAYOS_CLIENT_ID`, then find the webhook or callback URL settings. The exact
label can vary by dashboard version, but it is the setting used for payment
status notifications. Paste the URL above there.

Return URL:

```text
https://freshtrace-app.vercel.app/payment/success
```

Cancel URL:

```text
https://freshtrace-app.vercel.app/payment/cancel
```

## 8. Production Smoke Test

After backend deploy, optional demo seed, Vercel deploy, Auth URL settings, SMTP,
and payOS webhook are configured, run:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="paste_service_role_key_here"
powershell -ExecutionPolicy Bypass -File scripts/test-production-smoke.ps1
```

This creates a temporary confirmed Customer, verifies the profile/cart trigger,
loads catalog data, adds an item to cart, and creates a COD order.
