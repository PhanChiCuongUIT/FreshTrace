$secrets = @{
  APP_ENV = "production"
  APP_URL = "https://your-domain.com"
  ALLOWED_ORIGINS = "https://your-domain.com"
  CLOUDINARY_CLOUD_NAME = "your_cloudinary_cloud_name"
  CLOUDINARY_API_KEY = "your_cloudinary_api_key"
  CLOUDINARY_API_SECRET = "your_cloudinary_api_secret"
  PAYOS_CLIENT_ID = "your_payos_client_id"
  PAYOS_API_KEY = "your_payos_api_key"
  PAYOS_CHECKSUM_KEY = "your_payos_checksum_key"
  PAYOS_RETURN_URL = "https://your-domain.com/payment/success"
  PAYOS_CANCEL_URL = "https://your-domain.com/payment/cancel"
  USE_AI_ASSISTANT = "true"
  AI_PROVIDER = "gemini"
  GEMINI_API_KEY = "your_gemini_api_key"
  GEMINI_MODEL = "gemini-3.1-flash-lite"
  QR_TRACE_BASE_URL = "https://your-domain.com/trace"
}

$arguments = @("supabase", "secrets", "set")
foreach ($entry in $secrets.GetEnumerator()) {
  $arguments += "$($entry.Key)=$($entry.Value)"
}

& npx @arguments
