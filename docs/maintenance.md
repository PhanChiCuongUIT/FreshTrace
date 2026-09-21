# Restart and Data Maintenance

Use this guide when returning to the project after an extended break.
This is maintenance for the existing use cases, not a database reset.

Local ports: frontend 5173, Supabase API 55421, PostgreSQL 54322, Studio 55423.
The old PostgreSQL port 55432 overlapped a Windows reserved range on the current
machine. If Docker reports a forbidden socket, check
`netsh interface ipv4 show excludedportrange protocol=tcp` and choose a free local
`db.port` in `supabase/config.toml`. Do not remove Windows reservations or reset data.

## Local Restart

Use Node 22.12+ or Node 24 LTS, Docker Desktop (Linux containers), and PowerShell.
From the repository root:

```powershell
npm ci
npm --prefix frontend ci
npm run backend:start
npx supabase migration up --local
npm run data:refresh -- -DryRun
npm run data:refresh
npm run env:check
```

Keep these running in separate terminals:

```powershell
npm run backend:functions
```

```powershell
npm run frontend:dev:lan
```

Open http://localhost:5173 on the computer. On a phone, use the current Wi-Fi
IPv4 from `ipconfig`, port 5173. Use a trusted private network only.
Set `VITE_USE_LOCAL_PROXY=true` in `frontend/.env.local`; Vite forwards API/Auth/
Realtime calls to localhost:55421 so the browser does not need a fixed backend LAN IP.
This flag has no effect on production builds.

Auth email redirects, payOS return/cancel URLs and QR links still need the correct
frontend address. Update the local URL fields and `auth.additional_redirect_urls`
in `supabase/config.toml`, then stop/start Supabase and restart Edge Functions.
Do not copy local addresses or keys into Vercel production variables.

## What Date Refresh Does

- Reads only the 16 fixed seed batches and five fixed Rescue IDs.
- Updates demo harvest/expiry dates relative to the current UTC date.
- Renews eligible Rescue windows; preserves explicitly inactive deals and locked batches.
- Derives sold-out status from remaining stock, not from forced stock resets.
- Keeps the intentionally expired Mushroom Rescue fixture expired.
- Preserves user credentials, stock/reservations, price history, orders, payments,
  coupons and messages. Database triggers may recompute catalog status fields.
- Does not refill stock, restore missing prices or manufacture recent financial activity.
  Missing/invalid prerequisites are reported for Manager review.

Use Manager Inventory adjustments for genuine stock corrections, and create new
batches for real incoming merchandise. NEVER extend actual food expiry dates with
this demo script. A completed historical order must retain its actual date.

`-DryRun` performs reads only. Each update is atomic, not the complete run; run while
demo traffic is quiet, keep a backup, inspect errors and rerun if interrupted.
Repeated runs on the same day do not create extra prices, stock or accounts.

`npm run seed:demo` is full demo provisioning for new local setups. It can restore
the seven demo users and their passwords. Cleanup is intentionally separate:

```powershell
npm run cleanup:test-data:local -- -DryRun
```

Review before removing `-DryRun`. Never use `backend:reset` for an ordinary restart.

## Cloud Refresh and Deployment

The three actions below are independent:

1. **Data only:** no Git push or Vercel redeploy required. Set the cloud service-role
   key in the current terminal, then run:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_CLOUD_SERVICE_ROLE_KEY"
npm run data:refresh:production -- -DryRun
npm run data:refresh:production
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

Obtain the key from Supabase Project Settings > API Keys > legacy `service_role`.
It is not the anon key or access token. Never put it in a `VITE_` variable or Git.
The target URL comes from `.env.production`; verify it before accepting changes.

2. **Backend code/migrations:** get a personal token from Supabase account settings
   > Access Tokens. Set it for the current terminal and deploy non-destructively:

```powershell
$env:SUPABASE_ACCESS_TOKEN="YOUR_ACCESS_TOKEN"
powershell -ExecutionPolicy Bypass -File scripts/deploy-production.ps1
Remove-Item Env:SUPABASE_ACCESS_TOKEN
```

Never add `-ResetLinkedDb` to update an existing deployment. Auth email templates
must still be copied to Supabase Dashboard separately. Review the complete
[production checklist](production-deploy.md), including SMTP and allowed origins.

3. **Frontend/code backup:** review `git diff` and `git status`, commit only source,
   docs and lockfiles, then push to the branch connected to Vercel. Vercel must build
   `frontend` with cloud env variables; local `.env.local` is ignored by Git. A root
   `.env.production` is input for scripts, not automatically the frontend build env.

## Validation

For user-facing error policy and the latest local/production diagnostic results,
see [Error Handling and Verification](error-handling-and-verification.md).
Use `npm run test:app:production` for read-only business-data checks on the hosted
demo. This is separate from the production smoke test that creates fixtures.

```powershell
npm run frontend:lint
npm run frontend:build
npm run test:types
npm run backend:lint
npm run test:seed-repeat
npm run test:backend
```

Integration tests create fixtures. Use local/disposable data, not live customer
data. On the hosted app manually check login, catalog, Assistant, image upload,
email confirmation, one delivery flow and payment status reconciliation. A successful
build alone does not validate external payment, SMTP or camera services.

The legacy integration suite changes stock on shared demo batches. Deleting test
orders does not automatically reverse every reservation/stock mutation. Use a
disposable database or snapshot first; reconcile only test-caused changes afterward.
`test:seed-repeat` uses a transaction and rolls back all of its writes.

## Maintenance Verification: 2026-09-21

- Refreshed 16 local demo batches and four eligible Rescue fixture windows.
  A second dry-run returned no changes. Explicitly inactive and sold-out fixtures remain.
- Confirmed inventory and price-table hashes match the pre-refresh snapshot after
  reconciling the test-only stock delta. Kept seven demo accounts and ten original orders.
- Removed temporary test fixtures; cleanup dry-run returned zero remaining test users
  and zero duplicate Customer/Manager rooms.
- Frontend lint/build, Deno type checks, database lint, backend integration, Catalog
  CRUD, non-Manager CRUD and coupon lifecycle tests passed.
- Local Vite proxy Auth health, demo Customer login and catalog read passed.
  Assistant returned an answer and five recommendations. This alone does not prove
  Gemini was used, because the application supports a deterministic fallback.
- Frontend production dependency audit reported zero vulnerabilities after compatible
  lockfile updates (React Router 7.18.4, PostCSS 8.5.28, nanoid 3.3.19).
- Vercel homepage and Cloud Auth returned HTTP 200; public Cloud catalog returned
  16 products. No Cloud data was changed and no deployment was performed:
  Supabase access token, Cloud service-role key and Vercel deployment credentials
  were not available in this session.
- Live payments, SMTP delivery, Cloudinary upload and physical-phone camera flows
  were not re-tested end-to-end in this maintenance run.

The local pre-refresh backup is ignored by Git at
`supabase/.temp/freshtrace-before-refresh-20260921.dump`. Protect it as sensitive
database data. Do not commit or publish it.
