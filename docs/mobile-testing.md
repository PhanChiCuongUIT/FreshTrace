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

Find the active Wi-Fi adapter and copy its IPv4 address. On the current machine it
was:

```text
192.168.1.11
```

Do not use `127.0.0.1`. On a phone, `127.0.0.1` means the phone itself.

### 3. Configure the frontend

Update `frontend/.env.local`:

```env
VITE_SUPABASE_URL=http://192.168.1.11:55421
VITE_SUPABASE_ANON_KEY=YOUR_LOCAL_PUBLISHABLE_KEY
VITE_API_BASE_URL=http://192.168.1.11:55421/functions/v1
VITE_QR_TRACE_BASE_URL=http://192.168.1.11:5173/trace
```

Also update the LAN entries in `supabase/config.toml` under
`auth.additional_redirect_urls`, then restart Supabase. This allows confirmation
and password-recovery links opened on the phone to return to the LAN frontend.

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
ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.11:5173
```

Restart `backend:functions` after changing this file.

### 5. Allow Windows Firewall ports

Run PowerShell as Administrator:

```powershell
New-NetFirewallRule -DisplayName "FreshTrace Frontend" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173
New-NetFirewallRule -DisplayName "FreshTrace Supabase" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 55421
```

Only add these rules on a trusted private network.

### 6. Start FreshTrace

Terminal 1:

```powershell
npm run backend:start
npm run backend:reset
npm run seed:demo
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
http://192.168.1.11:5173
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

1. On the computer, open `http://192.168.1.11:5173`.
2. On the phone, open `http://192.168.1.11:55421/auth/v1/health`. A JSON health
   response proves the phone can reach Supabase.
3. If step 1 works but step 2 fails, allow inbound port `55421` in Windows Firewall
   and confirm Docker Desktop is running.
4. If both fail on the phone, set the Windows network profile to **Private**, keep
   both devices on the same Wi-Fi, and disable VPN, mobile data, Private Relay, or
   router AP/client isolation.
5. Confirm the frontend variables do not contain `127.0.0.1` or `localhost`, then
   stop and restart `npm run frontend:dev:lan`.
6. After `npm run backend:reset`, restart the stack if login reports a JWT timing
   error:

```powershell
npm run backend:stop
npm run backend:start
npm run seed:demo
```

7. Run `npm run test:backend`. Do not continue to phone testing until it passes.

The computer IP may change after reconnecting to Wi-Fi. Re-run `ipconfig` and update
both environment files whenever that happens.

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
The email buttons open `/auth/confirm` on the frontend first, then the frontend
verifies the token, which avoids Gmail on a phone opening a localhost-only Supabase
verification URL.

Open the real recipient inbox, then follow the confirmation or password-reset
link. For a physical phone to open local email links, the redirect URL must use the
computer's LAN IP and that URL must be listed in Supabase Auth redirect URLs.
