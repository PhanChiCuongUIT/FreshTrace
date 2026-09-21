const fallbackMessage = 'Something went wrong. Please try again. If the problem continues, contact support.'

const codeMessages: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password. Please check your details and try again.',
  email_not_confirmed: 'Please confirm your email address before signing in. Check your inbox and spam folder.',
  email_address_invalid: 'Please enter a valid email address that can receive email.',
  email_exists: 'An account with this email already exists. Sign in or reset your password.',
  user_already_exists: 'An account with this email already exists. Sign in or reset your password.',
  weak_password: 'Please choose a stronger password with at least 8 characters, including letters, numbers and symbols.',
  same_password: 'Please choose a new password different from your current password.',
  otp_expired: 'This email link has expired or has already been used. Please request a new link.',
  flow_state_expired: 'This email link has expired. Please request a new link.',
  flow_state_not_found: 'This email link is no longer valid. Please request a new link.',
  over_email_send_rate_limit: 'Too many email requests. Please wait a few minutes before requesting another email.',
  over_request_rate_limit: 'Too many attempts. Please wait a few minutes and try again.',
  session_not_found: 'Your session has expired. Please sign in again.',
  refresh_token_not_found: 'Your session has expired. Please sign in again.',
  refresh_token_already_used: 'Your session has expired. Please sign in again.',
  bad_jwt: 'Your session has expired. Please sign in again.',
  reauthentication_needed: 'Please sign in again before changing your password.',
  user_banned: 'This account has been banned. Please contact support if you need more information.',
  request_timeout: 'The request took too long. Please check your connection and try again.',
  '23505': 'A record with these details already exists. Check the information and try again.',
  '23503': 'This change conflicts with related records. Refresh the page and check the selected records before trying again.',
  '23502': 'Some required information is missing. Please complete all required fields.',
  '23514': 'One or more values are not allowed. Please check the quantities, prices, dates and status.',
  '42501': 'You do not have permission to perform this action.',
  PGRST116: 'This record is no longer available. Refresh the page and try again.',
}

function details(error: unknown, depth = 0): { message: string; code: string; status?: number; name?: string } {
  if (depth > 3 || error == null) return { message: '', code: '' }
  if (typeof error === 'string') return { message: error.replace(/^(?:Error|TypeError):\s*/i, '').trim(), code: '' }
  if (typeof error !== 'object') return { message: '', code: '' }
  const value = error as Record<string, unknown>
  const nested = details(value.error ?? value.message ?? value.error_description, depth + 1)
  return {
    message: nested.message,
    code: typeof value.code === 'string' ? value.code : typeof value.error_code === 'string' ? value.error_code : nested.code,
    status: typeof value.status === 'number' ? value.status : nested.status,
    name: typeof value.name === 'string' ? value.name : nested.name,
  }
}

/** Translate provider errors at display boundaries without exposing SQL or config details. */
export function errorMessage(error: unknown, fallback = fallbackMessage): string {
  const { message, code, status, name } = details(error)
  if (codeMessages[code]) return codeMessages[code]
  if (/invalid login credentials|invalid credentials/i.test(message)) return codeMessages.invalid_credentials
  if (/email not confirmed/i.test(message)) return codeMessages.email_not_confirmed
  if (/email rate limit|email.*too many|over_email_send_rate_limit/i.test(message)) return codeMessages.over_email_send_rate_limit
  if (/rate limit|too many requests|too many attempts/i.test(message) || status === 429) return codeMessages.over_request_rate_limit
  if (/same password|different from.*old password/i.test(message)) return codeMessages.same_password
  if (/password.*(?:at least|too short|weak)/i.test(message)) return codeMessages.weak_password
  if (/already registered|user already exists/i.test(message)) return codeMessages.user_already_exists
  if (/token.*(?:expired|invalid)|jwt.*(?:expired|invalid)|invalid jwt|auth session missing/i.test(message)) return codeMessages.session_not_found
  if (/email link.*(?:expired|invalid)|otp.*expired/i.test(message)) return codeMessages.otp_expired
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed|cannot reach freshtrace backend/i.test(message)) {
    return 'Unable to connect to FreshTrace. Please check your internet connection and try again.'
  }
  if (/timeout|timed out|aborted/i.test(message) || name === 'AbortError' || name === 'TimeoutError') return codeMessages.request_timeout
  if (name === 'NotAllowedError' || /NotAllowedError|permission denied.*camera|Permission dismissed|^Permission denied$/i.test(message)) {
    return 'Camera access was denied. Allow camera access in your browser settings or choose a QR image from your device.'
  }
  if (name === 'NotFoundError' || /requested device not found/i.test(message)) return 'No camera was found. Please choose a QR image from your device instead.'
  if (name === 'NotReadableError' || /could not start video source/i.test(message)) return 'The camera is unavailable or in use by another app. Close that app or choose a QR image instead.'
  if (/No MultiFormat Readers/i.test(message)) return 'No QR code was found. Try a clearer photo showing the entire QR code.'
  if (/cloud_name|invalid signature|unknown api key|api_key|upload preset/i.test(message)) return 'Image upload is temporarily unavailable. Please try again later or contact support.'
  if (/duplicate key|unique constraint/i.test(message)) return codeMessages['23505']
  if (/foreign key constraint|still referenced from table/i.test(message)) return codeMessages['23503']
  if (/not-null constraint/i.test(message)) return codeMessages['23502']
  if (/check constraint/i.test(message)) return codeMessages['23514']
  if (/row.level security|permission denied for|^forbidden$/i.test(message)) return codeMessages['42501']
  if (/JSON object requested|multiple \(or no\) rows/i.test(message)) return codeMessages.PGRST116
  if (status === 404 || /^(batch|product|order|record) not found$/i.test(message)) return 'This item could not be found. Refresh the page or check the details and try again.'
  if (status === 401 || /^(unauthorized|not authenticated)$/i.test(message)) return codeMessages.session_not_found
  if ((status && status >= 500) || /internal server error|bad gateway|service unavailable|database error|smtp|schema cache|SQLSTATE|PGRST\d+|column .* does not exist|relation .* does not exist|environment variable|allowed origins|production API URL|Unexpected token|<!doctype|<html|(?:SUPABASE|PAYOS|CLOUDINARY|GEMINI|EDGE_FUNCTION)_[A-Z_]+|not configured|Edge Function returned a non-2xx/i.test(message)) {
    return 'FreshTrace is temporarily unable to complete this request. Please try again later or contact support.'
  }
  if (!message && status === 403) return codeMessages['42501']
  if (!message || /^(\[object Object\]|undefined|null|request failed|error|failed)$/i.test(message) || /^[{[]/.test(message)) return fallback
  return message
}

export function responseErrorMessage(payload: unknown, status: number): string {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  return errorMessage({ ...body, status })
}
