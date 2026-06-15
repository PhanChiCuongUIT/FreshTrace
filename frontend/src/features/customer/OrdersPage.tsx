import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock3, CreditCard, MessageCircle, RefreshCw, Search, Truck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge, PageHeader } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState'
import { callFunction } from '../../lib/api'
import { currency, dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/auth-context'
import { useFeedback } from '../../components/Feedback'
import { BatchQrButton } from '../../components/BatchQrButton'

type Relation<T> = T | T[] | null | undefined
type Tracking = { tracking_id: string; status: string; note: string | null; created_at: string }
type Order = { order_id: string; order_code: number; status: string; total_amount: number; delivery_address: string; created_at: string; order_items: Array<{ order_item_id: string; product_id: string; batch_id: string; product_name: string; quantity: number; unit: string; price: number; batches: Relation<{ batch_code: string }> }>; payments: Relation<{ method: string; status: string }>; deliveries: Relation<{ status: string }>; order_tracking: Tracking[] }

const workflowStatuses = ['', 'pending', 'order_placed', 'confirmed', 'preparing', 'assigned', 'picked_up', 'delivering', 'delivered', 'completed', 'cancelled', 'failed']
const one = <T,>(value: Relation<T>) => Array.isArray(value) ? value[0] : value

export function OrdersPage() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const navigate = useNavigate()
  const { confirm, prompt: askText, toast } = useFeedback()
  const [query, setQuery] = useState('')
  const [workflowStatus, setWorkflowStatus] = useState('')
  const orders = useQuery({ queryKey: ['orders', profile?.user_id], queryFn: async () => {
    const result = await supabase.from('orders').select('order_id,order_code,status,total_amount,delivery_address,created_at,order_items(order_item_id,product_id,batch_id,product_name,quantity,unit,price,batches(batch_code)),payments(method,status),deliveries(status),order_tracking(tracking_id,status,note,created_at)').eq('user_id', profile!.user_id).order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as unknown as Order[]
  }})
  const cancel = async (orderId: string) => {
    const approved = await confirm({ title: 'Cancel this pending order?', description: 'Reserved stock will be released. If the order was already paid, FreshTrace will issue a coupon for the full paid amount.', confirmLabel: 'Cancel order', danger: true })
    if (!approved) return
    try {
      const result = await callFunction<{ couponCode: string | null }>('cancel-order', { orderId, reason: 'Cancelled by customer' })
      await client.invalidateQueries({ queryKey: ['orders'] })
      toast(result.couponCode ? `Order cancelled. Coupon ${result.couponCode} was issued.` : 'Order cancelled')
    } catch (error) { toast(String(error), 'error') }
  }
  const payWithPayos = async (orderId: string) => {
    try {
      const payment = await callFunction<{ checkoutUrl?: string; paymentUrl?: string }>('create-payos-payment', { orderId })
      const url = payment.checkoutUrl ?? payment.paymentUrl
      if (!url) throw new Error('FreshTrace could not open the payOS checkout link.')
      window.location.href = url
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    }
  }
  const syncPayosPayment = async (orderId: string) => {
    try {
      const result = await callFunction<{ status: string; providerStatus?: string; synced?: boolean }>('sync-payos-payment', { orderId, purpose: 'checkout' })
      await client.invalidateQueries({ queryKey: ['orders'] })
      if (result.status === 'paid') toast(result.synced ? 'Payment confirmed with payOS.' : 'This payment was already confirmed.')
      else toast(`payOS currently reports ${result.providerStatus ?? result.status}.`, 'error')
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    }
  }
  const report = async (order: Order) => {
    const delivery = one(order.deliveries)
    const description = await askText({
      title: `Report issue for order #${order.order_code}`,
      description: delivery?.status === 'delivered'
        ? 'If the order is marked delivered but you did not receive it, describe what happened. Admin will review this with the shipper and manager.'
        : 'Describe the order, product, delivery, or payment problem. Admin will review it from the Reports workspace.',
      placeholder: 'Example: The order is marked delivered but I did not receive it...',
      confirmLabel: 'Submit report',
      required: true,
    })
    if (!description) return
    const result = await supabase.from('reports')
      .insert({
        user_id: profile!.user_id,
        order_id: order.order_id,
        type: delivery?.status === 'delivered' ? 'delivery_not_received' : 'order_issue',
        description: description.trim(),
      })
      .select('report_id')
      .single()
    if (result.error) toast(result.error.message, 'error')
    else toast('Report submitted to Admin')
  }
  const review = async (order: Order, productId: string) => {
    const rating = Number(prompt('Rating from 1 to 5', '5'))
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return toast('Rating must be from 1 to 5', 'error')
    const comment = prompt('Review comment') ?? null
    const result = await supabase.from('reviews')
      .upsert({
        user_id: profile!.user_id,
        order_id: order.order_id,
        product_id: productId,
        rating,
        comment: comment?.trim() || null,
      }, { onConflict: 'user_id,product_id,order_id' })
      .select('review_id')
      .single()
    if (result.error) toast(result.error.message, 'error')
    else toast('Review saved')
  }
  if (orders.isLoading) return <LoadingState />
  if (orders.error) return <ErrorState error={orders.error} />
  const filtered = orders.data?.filter(order => {
    const latestTracking = [...order.order_tracking].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    const delivery = one(order.deliveries)
    const text = `${order.order_code} ${order.delivery_address} ${order.order_items.map(item => item.product_name).join(' ')}`.toLowerCase()
    return (!query || text.includes(query.toLowerCase()))
      && (!workflowStatus || order.status === workflowStatus || latestTracking?.status === workflowStatus || delivery?.status === workflowStatus)
  })
  return <div><PageHeader eyebrow="History" title="Your orders" />
    <div className="card mt-6 space-y-4 p-4">
      <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35" size={18}/><input className="input" style={{ paddingLeft: '2.75rem' }} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search order, address, or product"/></label>
      <div><p className="mb-2 text-xs font-bold uppercase tracking-widest text-black/40">Workflow status</p><div className="flex flex-wrap gap-2">{workflowStatuses.map(value => <button key={value || 'all'} type="button" onClick={() => setWorkflowStatus(value)} className={`rounded-full px-4 py-2 text-sm font-bold capitalize ${workflowStatus === value ? 'bg-brand-600 text-white' : 'bg-black/[0.05] text-black/60'}`}>{value ? value.replaceAll('_',' ') : 'All workflow'}</button>)}</div></div>
    </div>
    <div className="mt-5 space-y-4">{!filtered?.length ? <EmptyState title="No matching orders" /> : filtered.map(order => {
      const payment = one(order.payments)
      const delivery = one(order.deliveries)
      const tracking = [...order.order_tracking].sort((a,b) => a.created_at.localeCompare(b.created_at))
      const latest = tracking.at(-1)
      const payosPending = order.status === 'pending' && payment?.method === 'payos' && payment.status === 'pending'
      return <article className="card overflow-hidden" key={order.order_id}>
        <div className="bg-gradient-to-r from-brand-50 to-blue-50 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black">Order #{order.order_code}</h2><p className="text-sm text-black/50">{dateTime(order.created_at)} / {order.delivery_address}</p></div><div className="flex gap-2"><Badge tone={order.status === 'completed' ? 'green' : order.status === 'cancelled' ? 'red' : 'orange'}>{order.status}</Badge><Badge tone={payment?.status === 'paid' ? 'green' : 'blue'}>{payment?.status ?? 'unpaid'}</Badge></div></div>{latest && <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/75 p-3"><Truck className="text-blue-600"/><div><b className="capitalize">{latest.status.replaceAll('_', ' ')}</b><p className="text-xs text-black/45">{latest.note ?? 'Tracking updated'} / {dateTime(latest.created_at)}</p></div></div>}</div>
        <div className="space-y-2 border-y p-5">{order.order_items.map(item => { const batch = one(item.batches); return <div key={item.order_item_id} className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{item.product_name} x {item.quantity} {item.unit}</span><div className="flex flex-wrap items-center gap-3"><BatchQrButton batchId={item.batch_id} batchCode={batch?.batch_code} label="Batch QR"/><b>{currency.format(item.price * item.quantity)}</b>{order.status === 'completed' && <button className="font-bold text-brand-700" onClick={() => review(order, item.product_id)}>Review</button>}</div></div> })}</div>
        <details className="m-5 rounded-2xl bg-black/[0.03] p-4"><summary className="cursor-pointer text-sm font-bold">Order tracking ({tracking.length})</summary><ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{tracking.map(item => <li key={item.tracking_id} className="rounded-2xl bg-white p-3 shadow-sm"><div className="flex items-center gap-2">{item.status.includes('delivered') || item.status === 'completed' ? <CheckCircle2 size={17} className="text-green-600"/> : <Clock3 size={17} className="text-blue-600"/>}<b className="capitalize">{item.status.replaceAll('_', ' ')}</b></div><p className="mt-1 text-xs text-black/45">{dateTime(item.created_at)}{item.note ? ` / ${item.note}` : ''}</p></li>)}</ol></details>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pt-0"><div><span className="text-sm text-black/50">Delivery: </span><b className="capitalize">{delivery?.status ?? 'not assigned'}</b>{payment?.method === 'cod' && delivery?.status === 'delivering' && payment.status === 'pending' && <p className="text-xs text-blue-700">Pay cash or scan the payOS QR shown on the Shipper's screen.</p>}{payosPending && <p className="text-xs text-blue-700">This order is waiting for payOS payment. You can reopen checkout or check payment status.</p>}</div><div className="flex flex-wrap items-center gap-4">{payosPending && <><button className="text-sm font-bold text-brand-700" onClick={() => payWithPayos(order.order_id)}><CreditCard className="mr-1 inline" size={16}/>Pay with payOS</button><button className="text-sm font-bold text-blue-700" onClick={() => syncPayosPayment(order.order_id)}><RefreshCw className="mr-1 inline" size={16}/>Check payment</button></>}<button className="text-sm font-bold text-brand-700" onClick={() => navigate(`/chat?shareOrder=${order.order_id}`)}><MessageCircle className="mr-1 inline" size={16}/>Share</button><button className="text-sm font-bold text-orange-700" onClick={() => report(order)}>Report issue</button><b>{currency.format(order.total_amount)}</b>{order.status === 'pending' && <button className="text-sm font-bold text-red-600" onClick={() => cancel(order.order_id)}>Cancel order</button>}</div></div>
      </article>
    })}</div>
  </div>
}
