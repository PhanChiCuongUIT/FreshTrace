import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setMessage('')
    if (password.length < 8) return setError('Password must contain at least 8 characters.')
    if (password !== confirmPassword) return setError('Passwords do not match.')

    setBusy(true)
    const result = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (result.error) return setError(result.error.message)

    setMessage('Password updated. Redirecting to FreshTrace...')
    window.setTimeout(() => navigate('/', { replace: true }), 900)
  }

  return <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,#d8fbe4,transparent_45%),#f7f8f3] p-4">
    <form onSubmit={submit} className="card w-full max-w-md p-8">
      <div className="mb-7 flex items-center gap-4">
        <img src="/Logo-FreshTrace.png" alt="FreshTrace logo" className="h-16 w-16 rounded-2xl object-contain shadow-sm"/>
        <div><h1 className="text-2xl font-black">Set a new password</h1><p className="text-sm text-black/50">Use the secure recovery session from your email.</p></div>
      </div>
      <div className="space-y-4">
        <input className="input" type="password" autoComplete="new-password" minLength={8} required placeholder="New password" value={password} onChange={event => setPassword(event.target.value)}/>
        <input className="input" type="password" autoComplete="new-password" minLength={8} required placeholder="Confirm new password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}/>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-4 text-sm text-green-700">{message}</p>}
      <button className="btn-primary mt-6 w-full" disabled={busy}>{busy ? 'Updating...' : 'Update password'}</button>
      <Link className="mt-4 block text-center text-sm font-semibold text-brand-700" to="/login">Back to sign in</Link>
    </form>
  </div>
}
