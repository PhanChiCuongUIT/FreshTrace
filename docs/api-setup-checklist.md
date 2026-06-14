# FreshTrace Backend Integration Checklist

## Supabase

1. Create a Supabase project and save its project reference.
2. Configure Email/Password Auth and redirect URLs.
3. Run `npx supabase link --project-ref ...`.
4. Run `npx supabase db push`.
5. Deploy Edge Functions with `npx supabase functions deploy`.
6. Never expose the service-role/secret key to the frontend.
7. Do not manually set reserved `SUPABASE_*` Edge Runtime variables.

The migrations automatically:

- Create schemas, indexes, triggers, RPCs, and scheduled jobs.
- Enable RLS.
- Add chat, notification, order, tracking, and delivery tables to Realtime.
- Create a Customer profile and cart after Auth signup.

## Cloudinary

Set:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

The frontend requests a signature from `sign-cloudinary-upload`, then uploads directly
to Cloudinary.

## payOS

Set:

- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `PAYOS_RETURN_URL`
- `PAYOS_CANCEL_URL`

Production webhook:

```text
https://PROJECT_REF.supabase.co/functions/v1/payos-webhook
```

The webhook does not require a Supabase JWT, but every payload must have a valid
payOS HMAC signature.

## QR

Set:

```env
QR_TRACE_BASE_URL=https://your-domain.com/trace
```

Managers call `generate-batch-qr`. Customers use `trace-batch`. Shippers use
`verify-delivery-batch`.

## Fresh Assistant

The assistant can use Gemini API, with deterministic FreshTrace ranking as a
fallback when no key is configured:

```env
USE_AI_ASSISTANT=true
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-lite
```

`gemini-3.1-flash-lite` is the recommended free-tier/default model for the
project. Use `gemini-3.5-flash` for stronger answers if your API tier allows it.
The assistant still only recommends products and admin insights that exist in
the database.

## Pre-Deployment Checks

```powershell
npm run backend:reset
npm run backend:lint
npm run test:types
```

After deployment, test signup, catalog search, COD checkout, payOS sandbox payments,
webhooks, delivery, Realtime chat, and notifications with accounts for every role.
