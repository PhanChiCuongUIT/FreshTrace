#!/usr/bin/env bash
# FreshTrace - set Supabase secrets
# Replace placeholders with real values before running:
# chmod +x scripts/set-supabase-secrets.example.sh
# ./scripts/set-supabase-secrets.example.sh

supabase secrets set \
  APP_ENV="development" \
  APP_URL="http://localhost:5173" \
  API_BASE_URL="http://localhost:55421/functions/v1" \
  ALLOWED_ORIGINS="http://localhost:5173,https://your-domain.com" \
  CLOUDINARY_CLOUD_NAME="your_cloudinary_cloud_name" \
  CLOUDINARY_API_KEY="your_cloudinary_api_key" \
  CLOUDINARY_API_SECRET="your_cloudinary_api_secret" \
  CLOUDINARY_UPLOAD_PRESET="freshtrace_unsigned" \
  PAYOS_CLIENT_ID="your_payos_client_id" \
  PAYOS_API_KEY="your_payos_api_key" \
  PAYOS_CHECKSUM_KEY="your_payos_checksum_key" \
  PAYOS_RETURN_URL="http://localhost:5173/payment/success" \
  PAYOS_CANCEL_URL="http://localhost:5173/payment/cancel" \
  PAYOS_WEBHOOK_URL="http://localhost:55421/functions/v1/payos-webhook" \
  USE_AI_ASSISTANT="false" \
  AI_PROVIDER="rule-based" \
  GEMINI_API_KEY="your_gemini_api_key" \
  GEMINI_MODEL="gemini-2.0-flash" \
  OPENAI_API_KEY="your_openai_api_key" \
  OPENAI_MODEL="gpt-4.1-mini" \
  QR_TRACE_BASE_URL="http://localhost:5173/trace" \
  QR_BATCH_PREFIX="FRESHTRACE-BATCH" \
  EDGE_FUNCTION_SECRET="change_this_random_32_chars_or_more" \
  WEBHOOK_VERIFY_SECRET="change_this_random_32_chars_or_more"
