# User-Facing Errors and Verification

## Message Policy

`frontend/src/lib/errorMessages.ts` translates provider errors into actionable
English. Authentication forms, shared error panels, error toasts, Edge Function
responses, QR lookup and payment reconciliation use this formatter.

| Failure | User-facing message or action |
|---|---|
| Incorrect credentials | Incorrect email or password. Please check your details and try again. |
| Unconfirmed email | Ask the user to confirm their email and check spam. |
| Expired email link | Ask for a new confirmation/reset link. |
| Rate limit | Ask the user to wait before requesting another email or retrying. |
| Network failure | Explain that FreshTrace cannot be reached; suggest checking connectivity. |
| Duplicate record | Ask the user to check for an existing record. |
| Related-record constraint | Explain the conflict; Catalog retains operation-specific guidance. |
| Permission denied | Explain that the action is not permitted. |
| Camera denied/unavailable | Suggest browser permissions or selecting a QR image. |
| Upload service misconfiguration | Explain that image upload is temporarily unavailable. |

Do not distinguish an unknown email from an incorrect password: Supabase returns
`invalid_credentials` for both. This also avoids revealing account existence.
Prefer stable error codes over matching provider wording. See the official
[Supabase Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes).

Preserve meaningful business-rule errors, including inactive-account support
instructions. Do not display raw objects, SQL constraint identifiers, configuration
variables or HTML gateway responses. The formatter handles known technical errors;
backend responses must still avoid including secrets or sensitive diagnostic data.

Forgot-password confirmation does not promise delivery or disclose whether the
email is registered. A successful request is not proof of inbox delivery.

Payment reconciliation failure is not payment failure. Only a confirmed `paid`
response shows the green success icon. Users who have already been debited are
instructed not to pay again, and to recheck payment status or contact support.
This message update does not change payment settlement rules.

## Repeatable Checks

```powershell
npm run test:messages
npm run frontend:lint
npm run frontend:build
npm run test:types
npm run backend:lint
npm run test:app:local
npm run test:app:production
```

`test:app:local` needs Vite on port 5173 with the local proxy enabled, Supabase
and Edge Functions running. `test:app:production` reads the public URL/key/site
from root `.env.production`. Neither command requires a service-role key.
The checks use the four primary seeded demo accounts. Set
`FRESHTRACE_DEMO_PASSWORD` in the terminal if their password differs from the
documented demo password; do not retain public demo credentials for real users.

These scripts check application HTML, Auth health, Edge CORS, wrong-password
rejection, account-status checks, role login, page data queries and public batch
trace. They do not create/edit/delete business records. Login/logout can create
normal Auth sessions and audit logs. Successful queries do not prove every row,
calculation or workflow is correct.

For local CRUD integration tests, run `npm run test:backend` against disposable
data or take a snapshot first. See [Maintenance](maintenance.md): tests modify
shared demo stock, and deleting fixtures alone does not reverse all stock changes.
Do not point this mutation suite at a live production database.

## Verification on 2026-09-21

- 18 error-message tests passed; frontend lint/build, Deno type checks and database
  lint passed.
- Local backend suite passed, including workflow integration, Manager Catalog CRUD,
  non-Manager CRUD and coupon lifecycle checks.
- Local and production read-only diagnostics passed for Customer, Manager,
  Employee/Shipper and Admin. Queries included catalog/inventory, orders, cart,
  coupons, deliveries with batch checks, monitoring, finance, reports and notifications.
- Local test fixtures were removed and the test-only stock delta was restored from
  the pre-test snapshot. Production business records were not changed.
- No full browser click-through, physical-phone camera, real payment, SMTP inbox
  delivery or Cloudinary upload test was performed in this error-message pass.
  Payment tests exercise database workflow rules, not a real bank transfer.

This is scoped verification, not a guarantee that all possible CRUD or UI errors
have been eliminated. Re-test production after deploying the new frontend.

## Deploying These Message Changes

These frontend message fixes do not require a database reset, migration or reseed.
Review and commit the intended source/docs changes, push to the Vercel-connected
branch, and confirm that deployment uses the new commit. Existing unrelated backend
changes must be reviewed separately. Until redeployment, the hosted frontend may
still show the previous messages.

After deployment, check wrong-password login, inactive-account guidance, expired
email links, failed network requests and retrying payment verification. Keep any
real transaction checks supervised and never mark an order paid from URL parameters.
