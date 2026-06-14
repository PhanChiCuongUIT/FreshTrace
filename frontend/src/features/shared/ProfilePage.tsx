import { useMemo, useState } from 'react'
import { Camera, Gift, ReceiptText, Search, ShieldCheck, UserRound } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Badge } from '../../components/Page'
import { authRedirect } from '../../lib/authRedirects'
import { currency, dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { uploadImage } from '../../lib/cloudinary'
import { useAuth } from '../auth/auth-context'
import { useFeedback } from '../../components/Feedback'

type Payment = { payment_id: string; method: string; status: string; amount: number; created_at: string; orders: { order_code: number } }
type Coupon = { coupon_id: string; code: string; coupon_type: string; amount: number; remaining_amount: number; discount_percent: number | null; min_order_amount: number; expires_at: string | null }
type CustomerTab = 'coupons' | 'transactions' | 'policies'

function Progress({ label, value, target, detail }: { label: string; value: number; target: number; detail: string }) {
  const current = value % target
  const percent = Math.min(100, current / target * 100)
  return <article className="rounded-2xl border border-black/10 bg-white p-4">
    <div className="flex items-start justify-between gap-3">
      <div><b>{label}</b><p className="mt-1 text-xs text-black/50">{detail}</p></div>
      <span className="shrink-0 text-sm font-black text-brand-700">{current.toLocaleString('en-US')} / {target.toLocaleString('en-US')}</span>
    </div>
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }}/></div>
  </article>
}

function couponLabel(coupon: Coupon) {
  if (coupon.coupon_type === 'free_shipping') return 'Free shipping'
  if (coupon.coupon_type === 'percent') return `${coupon.discount_percent ?? 0}% off`
  return currency.format(coupon.remaining_amount)
}

export function ProfilePage() {
  const { profile, role, refreshProfile } = useAuth()
  const feedback = useFeedback()
  const [name, setName] = useState(profile?.name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [address, setAddress] = useState(profile?.address ?? '')
  const [saving, setSaving] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [customerTab, setCustomerTab] = useState<CustomerTab>('coupons')
  const [transactionQuery, setTransactionQuery] = useState('')
  const [transactionStatus, setTransactionStatus] = useState('')
  const [transactionMethod, setTransactionMethod] = useState('')

  const payments = useQuery({ queryKey: ['profile-payments', profile?.user_id], enabled: role === 'customer', queryFn: async () => {
    const result = await supabase.from('payments').select('payment_id,method,status,amount,created_at,orders!inner(order_code,user_id)').eq('orders.user_id', profile!.user_id).order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as unknown as Payment[]
  }})
  const coupons = useQuery({ queryKey: ['profile-coupons', profile?.user_id], enabled: role === 'customer', queryFn: async () => {
    await supabase.rpc('refresh_coupon_statuses')
    const result = await supabase.from('coupons').select('coupon_id,code,coupon_type,amount,remaining_amount,discount_percent,min_order_amount,expires_at')
      .eq('user_id', profile!.user_id)
      .eq('status', 'active')
      .gt('remaining_amount', 0)
      .order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as Coupon[]
  }})
  const rewards = useQuery({ queryKey: ['customer-reward-progress', profile?.user_id], enabled: role === 'customer', queryFn: async () => {
    const [orders, reports] = await Promise.all([
      supabase.from('orders').select('order_id,total_amount,status,deliveries(status)').eq('user_id', profile!.user_id).eq('status', 'completed'),
      supabase.from('reports').select('report_id,status').eq('user_id', profile!.user_id).eq('status', 'resolved'),
    ])
    if (orders.error) throw orders.error
    if (reports.error) throw reports.error
    const delivered = orders.data.filter(order => {
      const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [order.deliveries]
      return deliveries.some(delivery => delivery?.status === 'delivered')
    })
    return {
      completedOrders: delivered.length,
      completedSpend: delivered.reduce((sum, order) => sum + Number(order.total_amount), 0),
      approvedReports: reports.data.length,
    }
  }})
  const filteredPayments = useMemo(() => {
    const value = transactionQuery.trim().toLowerCase()
    return payments.data?.filter(payment =>
      (!value || `#${payment.orders.order_code} ${payment.method} ${payment.status}`.toLowerCase().includes(value)) &&
      (!transactionStatus || payment.status === transactionStatus) &&
      (!transactionMethod || payment.method === transactionMethod)
    ) ?? []
  }, [payments.data, transactionMethod, transactionQuery, transactionStatus])

  const save = async () => {
    setSaving(true)
    const result = await supabase.from('users')
      .update({
        name: name.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
        avatar_url: avatarUrl || null,
      })
      .eq('user_id', profile!.user_id)
      .select('user_id')
      .single()
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
    {role === 'customer' && <section className="mt-7"><div className="flex gap-2 overflow-x-auto rounded-2xl bg-black/[0.04] p-2">{([
      ['coupons', Gift, 'My coupons'],
      ['transactions', ReceiptText, 'Transactions'],
      ['policies', ShieldCheck, 'Policies & guide'],
    ] as const).map(([tab, Icon, label]) => <button key={tab} type="button" onClick={() => setCustomerTab(tab)} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${customerTab === tab ? 'bg-white text-brand-700 shadow-sm' : 'text-black/55'}`}><Icon size={18}/>{label}</button>)}</div>

      {customerTab === 'coupons' && <div className="mt-5"><h2 className="text-2xl font-black">Reward progress</h2><p className="mt-1 text-sm text-black/50">Only completed orders with delivered shipment count toward rewards.</p><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Progress label="Free shipping from spending" value={rewards.data?.completedSpend ?? 0} target={500000} detail="Every 500,000 VND earns one free-shipping coupon"/><Progress label="10% reward from spending" value={rewards.data?.completedSpend ?? 0} target={1000000} detail="Every 1,000,000 VND earns one 10% coupon"/><Progress label="20% reward from spending" value={rewards.data?.completedSpend ?? 0} target={2000000} detail="Every 2,000,000 VND earns one 20% coupon"/><Progress label="Free shipping from orders" value={rewards.data?.completedOrders ?? 0} target={5} detail="Every 5 delivered orders earns free shipping"/><Progress label="10% reward from orders" value={rewards.data?.completedOrders ?? 0} target={10} detail="Every 10 delivered orders earns one 10% coupon"/><Progress label="Approved report reward" value={rewards.data?.approvedReports ?? 0} target={1} detail="Every approved report earns a 10,000 VND coupon"/></div>
        <h2 className="mt-7 text-2xl font-black">My coupons</h2><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{coupons.data?.map(coupon => <article key={coupon.coupon_id} className="card p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-widest text-brand-700">{couponLabel(coupon)}</p><h3 className="mt-1 truncate text-lg font-black">{coupon.code}</h3></div><Badge tone="green">active</Badge></div><div className="mt-3 flex items-end justify-between gap-3 text-sm text-black/55"><span>{coupon.min_order_amount > 0 ? `Min ${currency.format(coupon.min_order_amount)}` : 'No minimum'}</span><b className="text-black">{coupon.coupon_type === 'percent' ? `Cap ${currency.format(coupon.remaining_amount)}` : currency.format(coupon.remaining_amount)}</b></div>{coupon.expires_at && <p className="mt-2 text-xs text-black/45">Expires {dateTime(coupon.expires_at)}</p>}</article>)}</div>{!coupons.isLoading && !coupons.data?.length && <div className="card mt-4 p-5 text-black/50">No available coupons.</div>}</div>}

      {customerTab === 'transactions' && <div className="mt-5"><h2 className="text-2xl font-black">Transaction history</h2><div className="card mt-4 grid gap-3 p-4 md:grid-cols-[1fr_160px_160px]"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35" size={18}/><input className="input" style={{ paddingLeft: '2.75rem' }} value={transactionQuery} onChange={event => setTransactionQuery(event.target.value)} placeholder="Search order, method, status"/></label><select className="input" value={transactionStatus} onChange={event => setTransactionStatus(event.target.value)}><option value="">All statuses</option>{[...new Set((payments.data ?? []).map(item => item.status))].sort().map(status => <option key={status}>{status}</option>)}</select><select className="input" value={transactionMethod} onChange={event => setTransactionMethod(event.target.value)}><option value="">All methods</option>{[...new Set((payments.data ?? []).map(item => item.method))].sort().map(method => <option key={method}>{method}</option>)}</select></div><div className="card mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b"><th className="p-4">Order</th><th>Method</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead><tbody>{filteredPayments.map(payment => <tr key={payment.payment_id} className="border-b last:border-0"><td className="p-4 font-bold">#{payment.orders.order_code}</td><td className="uppercase">{payment.method}</td><td>{currency.format(payment.amount)}</td><td>{dateTime(payment.created_at)}</td><td><Badge tone={payment.status === 'paid' ? 'green' : payment.status === 'failed' ? 'red' : 'orange'}>{payment.status}</Badge></td></tr>)}</tbody></table>{!payments.isLoading && !filteredPayments.length && <p className="p-5 text-black/50">No matching transactions.</p>}</div></div>}

      {customerTab === 'policies' && <div className="mt-5 grid gap-4 lg:grid-cols-2"><article className="card p-5"><h2 className="text-xl font-black">Coupon policy</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-black/65"><li>New customers receive two free-shipping coupons and one 10% coupon.</li><li>Only delivered orders count toward reward progress.</li><li>Every 500,000 VND of delivered-order spending earns one free-shipping coupon.</li><li>Every 1,000,000 VND earns one 10% coupon; every 2,000,000 VND earns one 20% coupon.</li><li>Every 5 delivered orders earns free shipping; every 10 delivered orders earns one 10% coupon.</li><li>Each approved report earns a 10,000 VND coupon.</li><li>A delivered order worth at least 1,000,000 VND may randomly earn 5,000 to 20,000 VND.</li><li>Cancelling an eligible paid pending order returns the paid amount as a coupon.</li><li>A fully used coupon is removed after the order is completed successfully.</li></ul></article><article className="card p-5"><h2 className="text-xl font-black">Reports and support</h2><p className="mt-3 text-sm leading-6 text-black/65">Open an order, choose Report issue, describe the problem and attach useful details. FreshTrace reviews the report before resolving or rejecting it. Only approved reports qualify for rewards.</p></article><article className="card p-5"><h2 className="text-xl font-black">Password and security</h2><p className="mt-3 text-sm leading-6 text-black/65">Use the password-reset button above to receive a secure email link. Never share verification codes, payment QR details or your password. Contact the administrator if your account is inactive or you notice unfamiliar activity.</p></article><article className="card p-5"><h2 className="text-xl font-black">Customer guide</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-black/65"><li>Browse Products or Fresh Rescue and inspect batch traceability.</li><li>Add an available batch to the cart, choose a coupon and payment method, then confirm checkout.</li><li>Track the order from Orders and chat with its manager or shipper.</li><li>Confirm delivery, review products, or report an issue when necessary.</li></ol></article></div>}
    </section>}
  </div>
}
