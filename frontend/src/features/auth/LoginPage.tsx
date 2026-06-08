import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { authRedirect } from '../../lib/authRedirects'
import { supabase } from '../../lib/supabase'
import { useAuth } from './auth-context'

export function LoginPage() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  if (session) return <Navigate to="/" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    const result = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (result.error) setError(result.error.message)
    setBusy(false)
  }
  const forgotPassword = async () => {
    setError(''); setMessage('')
    if (!email.trim()) return setError('Enter your email first, then request a reset link.')
    const result = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: authRedirect('/reset-password') })
    if (result.error) setError(result.error.message)
    else setMessage('Password reset email sent. Check your email inbox.')
  }

  const fillDemoAccount = (demoEmail: string) => {
    setEmail(demoEmail)
    setPassword('FreshTrace!123')
    setError('')
  }

  return <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,#d8fbe4,transparent_45%),#f7f8f3] p-4">
    <form onSubmit={submit} className="card w-full max-w-md p-8">
      <div className="mb-8 flex items-center gap-4"><img src="/Logo-FreshTrace.png" alt="FreshTrace logo" className="h-20 w-20 rounded-2xl object-contain shadow-sm"/><div><h1 className="text-2xl font-black">FreshTrace</h1><p className="text-sm text-black/50">Sign in to your marketplace</p></div></div>
      <div className="space-y-4"><input className="input" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input className="input" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required/></div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-4 text-sm text-green-700">{message}</p>}
      <button className="btn-primary mt-6 w-full" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      <button type="button" className="mt-3 w-full text-sm font-semibold text-brand-700" onClick={forgotPassword}>Forgot password?</button>
      {import.meta.env.DEV && <div className="mt-6 border-t pt-5"><p className="mb-3 text-center text-xs font-bold uppercase tracking-widest text-black/40">Demo accounts</p><div className="grid grid-cols-2 gap-2">{[
        ['Customer', 'customer@freshtrace.local'],
        ['Shipper', 'shipper@freshtrace.local'],
        ['Manager', 'manager@freshtrace.local'],
        ['Admin', 'admin@freshtrace.local'],
      ].map(([label, demoEmail]) => <button key={demoEmail} type="button" className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-semibold hover:bg-brand-50 hover:text-brand-700" onClick={() => fillDemoAccount(demoEmail)}>{label}</button>)}</div><p className="mt-3 text-center text-xs text-black/40">Password: FreshTrace!123</p></div>}
      <p className="mt-5 text-center text-sm text-black/55">New to FreshTrace? <Link className="font-semibold text-brand-700" to="/register">Create account</Link></p>
    </form>
  </div>
}
