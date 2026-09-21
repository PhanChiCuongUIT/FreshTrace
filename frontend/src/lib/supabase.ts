import { createClient } from '@supabase/supabase-js'

export const usesLocalProxy = import.meta.env.DEV && import.meta.env.VITE_USE_LOCAL_PROXY === 'true'
const url = usesLocalProxy ? `${window.location.origin}/supabase` : import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('FreshTrace is not configured correctly. Please contact the system administrator.')
}

export const supabase = createClient(url, key)
export const apiBaseUrl = usesLocalProxy ? `${url}/functions/v1` : import.meta.env.VITE_API_BASE_URL ?? `${url}/functions/v1`
