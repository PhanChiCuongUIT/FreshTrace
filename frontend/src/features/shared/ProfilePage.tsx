import { useState } from 'react'
import { Camera, UserRound } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Badge } from '../../components/Page'
import { authRedirect } from '../../lib/authRedirects'
import { currency, dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { uploadImage } from '../../lib/cloudinary'
import { useAuth } from '../auth/auth-context'
import { useFeedback } from '../../components/Feedback'

type Payment = { payment_id: string; method: string; status: string; amount: number; created_at: string; orders: { order_code: number } }
type Coupon = { coupon_id: string; code: string; coupon_type: string; amount: number; remaining_amount: number; status: string; expires_at: string | null; created_at: string; description: string | null }

export function ProfilePage() {
  const { profile, role, refreshProfile } = useAuth()
  const feedback = useFeedback()
  const [name, setName] = useState(profile?.name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [address, setAddress] = useState(profile?.address ?? '')
  const [saving, setSaving] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const payments = useQuery({ queryKey: ['profile-payments', profile?.user_id], enabled: role === 'customer', queryFn: async () => {
    const result = await supabase.from('payments').select('payment_id,method,status,amount,created_at,orders!inner(order_code,user_id)').eq('orders.user_id', profile!.user_id).order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as unknown as Payment[]
  }})
  const coupons = useQuery({ queryKey: ['profile-coupons', profile?.user_id], enabled: role === 'customer', queryFn: async () => {
    const result = await supabase.from('coupons').select('coupon_id,code,coupon_type,amount,remaining_amount,status,expires_at,created_at,description').eq('user_id', profile!.user_id).order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as Coupon[]
  }})
  const save = async () => {
    setSaving(true)
    const result = await supabase.from('users').update({ name, phone: phone || null, address: address || null, avatar_url: avatarUrl || null }).eq('user_id', profile!.user_id)
    setSaving(false)
    if (result.error) feedback.error(result.error.message)
    else { await refreshProfile(); feedback.success('Profile updated') }
  }
  const uploadAvatar = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return feedback.error('Avatar must be an image')
    setUploadingAvatar(true)
    try {
      const url = await uploadImage(file, 'avatars')
      setAvatarUrl(url)
      feedback.info('Avatar uploaded. Click Save profile to apply the new avatar.')
    } catch (error) { feedback.error(String(error)) } finally { setUploadingAvatar(false) }
  }
  const sendPasswordReset = async () => {
    if (!profile?.email) return
    const result = await supabase.auth.resetPasswordForEmail(profile.email, { redirectTo: authRedirect('/reset-password') })
    if (result.error) feedback.error(result.error.message)
    else feedback.success('Password reset email sent. Check your email inbox.')
  }
  return <div><PageHeader eyebrow="Account" title="Profile and settings" />
    <div className="mt-6 grid gap-5 xl:grid-cols-2"><form className="card space-y-4 p-5 sm:p-6" onSubmit={event => { event.preventDefault(); save() }}><h2 className="text-xl font-black">Personal information</h2>
      <div className="flex items-center gap-4"><div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-brand-700">{avatarUrl ? <img src={avatarUrl} alt={name} className="h-full w-full object-cover"/> : <UserRound size={38}/>}</div><div><b className="block">{name || 'FreshTrace user'}</b><span className="text-sm capitalize text-black/45">{role}</span><label className="btn-secondary mt-2 cursor-pointer px-3 py-2"><Camera size={16}/>{uploadingAvatar ? 'Uploading...' : 'Change avatar'}<input className="hidden" type="file" accept="image/*" onChange={event => uploadAvatar(event.target.files?.[0])}/></label></div></div>
      <label className="block text-sm font-semibold">Email<input className="input mt-1 bg-black/5" disabled value={profile?.email ?? ''}/></label>
      <label className="block text-sm font-semibold">Full name<input className="input mt-1" required minLength={2} value={name} onChange={event => setName(event.target.value)}/></label>
      <label className="block text-sm font-semibold">Phone<input className="input mt-1" value={phone} onChange={event => setPhone(event.target.value)}/></label>
      <label className="block text-sm font-semibold">Default address<textarea className="input mt-1" rows={3} value={address} onChange={event => setAddress(event.target.value)}/></label>
      <button disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save profile'}</button>
    </form>
    <section className="card h-fit space-y-4 p-5 sm:p-6"><h2 className="text-xl font-black">Password security</h2><p className="text-sm text-black/50">FreshTrace sends a secure email link before changing your password.</p><button type="button" className="btn-secondary" onClick={sendPasswordReset}>Send password reset email</button></section></div>
    {role === 'customer' && <><section className="mt-7"><h2 className="text-2xl font-black">My coupons</h2><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{coupons.data?.map(coupon => <article key={coupon.coupon_id} className="card overflow-hidden"><div className="border-b border-dashed bg-brand-50 p-5"><p className="text-xs font-bold uppercase tracking-widest text-brand-700">{coupon.coupon_type === 'free_shipping' ? 'Free shipping' : 'FreshTrace reward'}</p><h3 className="mt-1 break-all text-xl font-black">{coupon.code}</h3></div><div className="p-5"><p className="text-sm text-black/50">{coupon.description ?? 'Coupon balance'}</p><p className="mt-1 text-2xl font-black">{currency.format(coupon.remaining_amount)}</p><div className="mt-3 flex items-center justify-between"><Badge tone={coupon.status === 'active' ? 'green' : 'gray'}>{coupon.status}</Badge><span className="text-xs text-black/45">{coupon.expires_at ? `Expires ${dateTime(coupon.expires_at)}` : 'No expiry'}</span></div></div></article>)}</div>{!coupons.isLoading && !coupons.data?.length && <div className="card mt-4 p-5 text-black/50">Welcome, loyalty, and eligible cancellation coupons will appear here.</div>}</section>
    <section className="mt-7"><h2 className="text-2xl font-black">Transaction history</h2><div className="card mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b"><th className="p-4">Order</th><th>Method</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead><tbody>{payments.data?.map(payment => <tr key={payment.payment_id} className="border-b last:border-0"><td className="p-4 font-bold">#{payment.orders.order_code}</td><td className="uppercase">{payment.method}</td><td>{currency.format(payment.amount)}</td><td>{dateTime(payment.created_at)}</td><td><Badge tone={payment.status === 'paid' ? 'green' : payment.status === 'failed' ? 'red' : 'orange'}>{payment.status}</Badge></td></tr>)}</tbody></table>{!payments.isLoading && !payments.data?.length && <p className="p-5 text-black/50">No transactions yet.</p>}</div></section></>}
  </div>
}
