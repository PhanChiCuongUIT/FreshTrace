import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { authRedirect } from '../../lib/authRedirects'
import { supabase } from '../../lib/supabase'
import { callFunction } from '../../lib/api'
import { useAuth } from './auth-context'

export function RegisterPage() {
  const { session } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  if (session) return <Navigate to="/" replace />
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMessage(''); setError('')
    try {
      await callFunction<{ allowed: boolean }>('account-status', { email: form.email.trim().toLowerCase() })
    } catch (checkError) {
      return setError(checkError instanceof Error ? checkError.message : String(checkError))
    }
    const { error } = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      options: { data: { name: form.name }, emailRedirectTo: authRedirect('/login') },
    })
    if (error) setError(error.message)
    else setMessage('Account created. Please check your email inbox to confirm the account before signing in.')
  }
  return <div className="grid min-h-screen place-items-center bg-canvas p-4"><form onSubmit={submit} className="card w-full max-w-md p-8"><img src="/Logo-FreshTrace.png" alt="FreshTrace logo" className="mb-5 h-20 w-20 rounded-2xl object-contain shadow-sm"/><h1 className="text-2xl font-black">Create customer account</h1><p className="mb-6 mt-1 text-sm text-black/50">Privileged roles are assigned by an Admin.</p><div className="space-y-4"><input className="input" placeholder="Full name" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input className="input" type="email" placeholder="Email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/><input className="input" type="password" minLength={8} placeholder="Password (8+ characters)" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></div>{error && <p className="mt-4 text-sm text-red-600">{error}</p>}{message && <p className="mt-4 text-sm text-green-700">{message}</p>}<button className="btn-primary mt-6 w-full">Create account</button><Link to="/login" className="mt-4 block text-center text-sm text-brand-700">Back to sign in</Link></form></div>
}
