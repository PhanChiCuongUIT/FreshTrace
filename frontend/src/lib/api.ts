import { apiBaseUrl, supabase } from './supabase'
import { errorMessage, responseErrorMessage } from './errorMessages'

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
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error })
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(responseErrorMessage(payload, response.status))
  if (payload === null) throw new Error('FreshTrace returned an unexpected response. Please try again later.')
  return payload as T
}
