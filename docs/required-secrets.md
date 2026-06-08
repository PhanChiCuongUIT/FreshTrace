# Required Secrets and Configuration

## Required for Cloud Deployment

- Supabase project reference
- Supabase project URL
- Supabase publishable/anon key
- Supabase service-role/secret key, stored only in Edge Function secrets
- Production frontend domain

## Required for payOS

- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- Production return URL
- Production cancel URL

## Required for Cloudinary

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

## Optional

- `OPENAI_API_KEY` or `GEMINI_API_KEY` for a future AI-assisted Fresh Assistant

## Required for Real Auth Email

- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_ADMIN_EMAIL`
- `SMTP_SENDER_NAME`

For Gmail, enable 2-Step Verification and create an App Password. Use that app
password as `SMTP_PASS`; do not use your normal Gmail password.

Never send real credentials through chat or commit them to the repository. Store them
in an ignored local file or set them with `supabase secrets set`.

All credentials that previously appeared in `supabase-secrets.example.env` must be
rotated before use.

## Local File Placement

Put browser-safe values in `frontend/.env.local`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` or the local publishable key
- `VITE_API_BASE_URL`
- `VITE_QR_TRACE_BASE_URL`

Put private integration credentials in `supabase/.env.local`:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_ADMIN_EMAIL`
- `SMTP_SENDER_NAME`

The root `.env` is retained for reference but is not loaded by the current frontend
or Edge Function commands.
