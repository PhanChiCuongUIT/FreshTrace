# Run FreshTrace on a Physical Phone

## Option A - Same Wi-Fi, Basic Mobile Testing

This option supports login, responsive screens, products, cart, orders, Assistant,
chat, notifications, Admin/Manager pages, and Shipper workflows that do not require
camera permission.

### 1. Connect both devices

Connect the Windows computer and phone to the same Wi-Fi network. Disable phone
mobile data temporarily if the phone keeps leaving the local network.

### 2. Find the computer IPv4 address

Run:

```powershell
ipconfig
```

Find the active Wi-Fi adapter and copy its IPv4 address. The address below is an
example; replace it with your current address:

```text
192.168.1.20
```

Do not use `127.0.0.1`. On a phone, `127.0.0.1` means the phone itself.

### 3. Configure the frontend

Update `frontend/.env.local`:

```env
VITE_USE_LOCAL_PROXY=true
VITE_SUPABASE_URL=http://127.0.0.1:55421
VITE_SUPABASE_ANON_KEY=YOUR_LOCAL_PUBLISHABLE_KEY
VITE_API_BASE_URL=http://127.0.0.1:55421/functions/v1
VITE_QR_TRACE_BASE_URL=http://192.168.1.20:5173/trace
```

Also update the LAN entries in `supabase/config.toml` under
`auth.additional_redirect_urls`, then restart Supabase. This allows confirmation
and password-recovery links opened on the phone to return to the LAN frontend.

The dev proxy forwards browser API and WebSocket requests through Vite to Docker.
The browser uses its own frontend origin for auth redirects in proxy mode. Backend
`APP_URL`, `QR_TRACE_BASE_URL` and payOS return/cancel URLs must still use a reachable
frontend LAN address. Do not enable local proxy mode when developing against Cloud.

FreshTrace local development sends confirmation and password-reset email through
real SMTP. For Gmail, configure a Gmail App Password in `supabase/.env.local`, then
restart Supabase.

Get the local publishable key with:

```powershell
npx supabase status
```

### 4. Configure Edge Function CORS

Update `ALLOWED_ORIGINS` in `supabase/.env.local`:

```env
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.20:5173
```

Restart `backend:functions` after changing this file.

### 5. Allow Windows Firewall ports

Run PowerShell as Administrator:

```powershell
New-NetFirewallRule -DisplayName "FreshTrace Frontend" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Private -RemoteAddress LocalSubnet
```

Only add this rule on a trusted private network. The proxy avoids exposing the
Supabase gateway directly to the phone. Never expose PostgreSQL to the public internet.

### 6. Start FreshTrace

Terminal 1:

```powershell
npm run backend:start
npm run data:refresh -- -DryRun
npm run data:refresh
```

Terminal 2:

```powershell
npm run backend:functions
```

Terminal 3:

```powershell
npm run frontend:dev:lan
```

### 7. Open the phone

Restart Vite after every `.env.local` change, then open:

```text
http://192.168.1.20:5173
```

Customer login:

```text
customer@freshtrace.local
FreshTrace!123
```

Shipper login:

```text
shipper@freshtrace.local
FreshTrace!123
```

## Fix `Failed to fetch` or Login That Never Completes

Work through these checks in order:

1. On the computer, open `http://192.168.1.20:5173` (use your own current IP).
2. On the phone, open the same URL. Inspect failed `/supabase/` requests in browser
   devtools if login fails. Auth health may require the public API key, so a bare
   health URL returning 401 does not mean the service is down.
3. Confirm Docker Desktop, `backend:functions` and the Vite proxy are running.
   Restart Vite after enabling `VITE_USE_LOCAL_PROXY=true`.
4. If both fail on the phone, set the Windows network profile to **Private**, keep
   both devices on the same Wi-Fi, and disable VPN, mobile data, Private Relay, or
   router AP/client isolation.
5. With proxy mode enabled, localhost backend URLs are correct. Without it, the
   phone must use a reachable LAN backend URL. Do not mix cloud keys with local URLs.
6. Restart the stack if needed; do not reset it:

```powershell
npm run backend:stop
npm run backend:start
```

7. Run `npm run test:backend`. Do not continue to phone testing until it passes.

The computer IP may change after reconnecting to Wi-Fi. Re-run `ipconfig` and update
frontend links, backend callbacks and the Auth redirect allowlist. The local API
proxy itself does not need a new IP. See [local setup](../README.md#run-locally).

## Why Camera Does Not Work on LAN HTTP

Mobile Chrome and Safari require a secure HTTPS context for camera access.
`localhost` is a special exception only on the device running the browser. A phone
opening `http://192.168.1.20:5173` is not in a secure context.

FreshTrace therefore:

- Offers live QR camera scanning when HTTPS is available.
- On LAN HTTP, offers **Take or choose QR image** so the phone camera app captures
  a still image and FreshTrace decodes it without browser camera streaming.
- Keeps manual batch-code entry available on every device.

If the browser still reports `camera streaming not supported`, use the image button.
That message is a browser security limitation on HTTP, not a Supabase or QR API
failure.

## Option B - Full Mobile Testing with HTTPS

The most reliable approach is to deploy Supabase and the frontend:

1. Link the repository to a Supabase cloud project.
2. Push migrations and deploy Edge Functions.
3. Set payOS, Cloudinary, and allowed-origin secrets.
4. Deploy `frontend/dist` to Vercel, Netlify, or another HTTPS static host.
5. Build the frontend with the cloud Supabase URL and publishable key.

Commands:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase secrets set --env-file supabase-secrets.env
npx supabase functions deploy
npm run frontend:build
```

Production frontend variables:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_CLOUD_PUBLISHABLE_KEY
VITE_API_BASE_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1
VITE_QR_TRACE_BASE_URL=https://YOUR_FRONTEND_DOMAIN/trace
```

Set backend origins:

```env
ALLOWED_ORIGINS=https://YOUR_FRONTEND_DOMAIN
PAYOS_RETURN_URL=https://YOUR_FRONTEND_DOMAIN/payment/success
PAYOS_CANCEL_URL=https://YOUR_FRONTEND_DOMAIN/payment/cancel
PAYOS_WEBHOOK_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/payos-webhook
```

The deployed HTTPS version supports QR scanning, Shipper photo capture, Realtime,
Cloudinary uploads, and public payOS callbacks without local-network limitations.

## Email Confirmation and Password Recovery

Local Supabase delivers registration confirmation and password recovery messages
through the SMTP provider configured in `supabase/.env.local`.

For Gmail:

```env
SMTP_HOST=smtp.gmail.com
SMTP_USER=your_gmail_address@gmail.com
SMTP_PASS=your_16_character_gmail_app_password
SMTP_ADMIN_EMAIL=your_gmail_address@gmail.com
SMTP_SENDER_NAME=FreshTrace
```

Remove spaces from the Gmail App Password before saving `SMTP_PASS`. Local Auth
email rate limiting is raised in `supabase/config.toml` for development; hosted
Supabase projects need the equivalent Auth rate limit set in the Dashboard/API.
Local confirmation and password-recovery messages use the branded HTML templates
in `supabase/templates`, including the FreshTrace logo from a public Cloudinary
URL so the image loads on mobile Gmail.
The email buttons open `/auth/confirm` on the frontend first, then the frontend
verifies the token, which avoids Gmail on a phone opening a localhost-only Supabase
verification URL.

Open the real recipient inbox, then follow the confirmation or password-reset
link. For a physical phone to open local email links, the redirect URL must use the
computer's LAN IP and that URL must be listed in Supabase Auth redirect URLs.
