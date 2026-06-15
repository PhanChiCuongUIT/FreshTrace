import { apiBaseUrl, supabase } from './supabase'

export async function callFunction<T>(name: string, body?: unknown, method = 'POST'): Promise<T> {
  const { data } = await supabase.auth.getSession()
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/${name}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new Error('Cannot reach FreshTrace backend. Check the production API URL and allowed origins.')
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? 'Request failed')
  return payload as T
}
