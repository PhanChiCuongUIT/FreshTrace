import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

type VerifyType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'

function nextPath(value: string | null, fallback: string) {
  if (!value) return fallback
  try {
    const parsed = new URL(value)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return value.startsWith('/') ? value : fallback
  }
}

export function AuthConfirmPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState('Confirming your FreshTrace email...')
  const [error, setError] = useState('')
  const missingTokenError = params.get('token_hash')
    ? ''
    : 'This confirmation link is missing its verification token.'

  useEffect(() => {
    const tokenHash = params.get('token_hash')
    const type = (params.get('type') || 'email') as VerifyType
    const fallback = type === 'recovery' ? '/reset-password' : '/login'
    const next = nextPath(params.get('next'), fallback)

    if (!tokenHash) {
      return
    }

    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(result => {
      if (result.error) {
        setError(result.error.message)
        return
      }
      setMessage(type === 'recovery' ? 'Password recovery confirmed. Redirecting...' : 'Email confirmed. Redirecting...')
      window.setTimeout(() => navigate(next, { replace: true }), 700)
    })
  }, [navigate, params])

  const visibleError = missingTokenError || error
  return <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,#d8fbe4,transparent_45%),#f7f8f3] p-4">
    <section className="card w-full max-w-md p-8 text-center">
      <img src="/Logo-FreshTrace.png" alt="FreshTrace logo" className="mx-auto mb-5 h-20 w-20 rounded-2xl object-contain shadow-sm"/>
      <h1 className="text-2xl font-black">FreshTrace verification</h1>
      <p className={`mt-3 text-sm ${visibleError ? 'text-red-600' : 'text-black/55'}`}>{visibleError || message}</p>
      {visibleError && <Link className="btn-primary mt-6 w-full" to="/login">Back to sign in</Link>}
    </section>
  </div>
}
