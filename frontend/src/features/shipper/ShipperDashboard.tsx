import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, MapPin, Phone, QrCode, TriangleAlert } from 'lucide-react'
import { Badge, PageHeader } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState'
import { QrScanner } from '../../components/QrScanner'
import { callFunction } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { normalizeBatchScan } from '../../lib/qr'
import { useAuth } from '../auth/auth-context'
import { useFeedback } from '../../components/Feedback'
import { BatchQrButton } from '../../components/BatchQrButton'

type Relation<T> = T | T[] | null
type BatchRef = { batch_id: string; batch_code: string }
type Delivery = { delivery_id: string; status: string; delivery_batch_checks: Array<{ batch_id: string; matched: boolean; checked_at: string }>; delivery_payment_collections: Array<{ method: string; status: string; remittance_status: string }>; orders: Relation<{ order_id: string; order_code: number; delivery_address: string; users: Relation<{ name: string; phone: string | null }>; payments: Relation<{ method: string; status: string }>; order_items: Array<{ order_item_id: string; product_name: string; quantity: number; batches: Relation<BatchRef> }> }> }

function one<T>(value: Relation<T> | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function many<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function text(value: unknown) {
  if (value == null || value === '') return '-'
  return typeof value === 'object' ? '-' : String(value)
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}

export function ShipperDashboard() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const { confirm, toast } = useFeedback()
  const [paymentQr, setPaymentQr] = useState<{ deliveryId: string; title: string; qrDataUrl: string; checkoutUrl: string } | null>(null)
  const deliveries = useQuery({ queryKey: ['shipper-deliveries', profile?.user_id], enabled: Boolean(profile?.user_id), queryFn: async () => {
    const result = await supabase.from('deliveries').select('delivery_id,status,delivery_batch_checks(batch_id,matched,checked_at),delivery_payment_collections(method,status,remittance_status),orders(order_id,order_code,delivery_address,users(name,phone),payments(method,status),order_items(order_item_id,product_name,quantity,batches(batch_id,batch_code)))').eq('employee_id', profile!.user_id).order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as unknown as Delivery[]
  }, refetchOnWindowFocus: false })
  useEffect(() => {
    if (!paymentQr) return undefined
    const timer = window.setInterval(() => {
      void client.invalidateQueries({ queryKey: ['shipper-deliveries'] })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [client, paymentQr])
  const verify = async (deliveryId: string, batchId: string) => {
    try { await callFunction('verify-delivery-batch', { deliveryId, batchId }); await client.invalidateQueries({ queryKey: ['shipper-deliveries'] }); toast('Batch verified') } catch (error) { toast(messageOf(error), 'error') }
  }
  const verifyScanned = async (delivery: Delivery, value: string) => {
    const parsed = normalizeBatchScan(value)
    const order = one(delivery.orders)
    const matched = many(order?.order_items).find(item => { const batch = one(item.batches); return parsed.batchId ? batch?.batch_id === parsed.batchId : batch?.batch_code === parsed.batchCode })
    if (!matched) return toast('This QR code does not belong to the selected delivery', 'error')
    const batch = one(matched.batches)
    if (batch) await verify(delivery.delivery_id, batch.batch_id)
  }
  const updateStatus = async (delivery: Delivery, status: 'picked_up' | 'delivering' | 'delivered' | 'failed') => {
    const note = status === 'failed' ? prompt('Failure reason') : undefined
    if (status === 'failed' && !note) return
    const order = one(delivery.orders)
    const approved = await confirm({ title: `Confirm ${status.replaceAll('_', ' ')}?`, description: `This updates order #${text(order?.order_code)} and notifies the Customer.`, confirmLabel: 'Update status', danger: status === 'failed' })
    if (!approved) return
    try {
      await callFunction('update-delivery-status', { deliveryId: delivery.delivery_id, status, note })
      await client.invalidateQueries({ queryKey: ['shipper-deliveries'] })
      toast('Delivery status updated')
    } catch (error) { toast(messageOf(error), 'error') }
  }
  const collectCash = async (delivery: Delivery) => {
    const payment = one(one(delivery.orders)?.payments)
    const approved = await confirm({ title: 'Confirm cash received?', description: `Confirm that you received ${payment?.status === 'paid' ? 'the payment' : 'the full COD amount'} from the Customer. You must then remit it using the payOS QR.`, confirmLabel: 'Cash received' })
    if (!approved) return
    try {
      await callFunction('record-delivery-payment', { deliveryId: delivery.delivery_id, method: 'cash' })
      await client.invalidateQueries({ queryKey: ['shipper-deliveries'] })
      toast('Cash collection recorded. Create the remittance QR next.')
    } catch (error) { toast(messageOf(error), 'error') }
  }
  const createPaymentQr = async (delivery: Delivery, purpose: 'customer_cod' | 'shipper_remittance') => {
    try {
      const order = one(delivery.orders)
      if (!order) throw new Error('Order is unavailable')
      const payment = await callFunction<{ checkoutUrl: string; qrDataUrl: string }>('create-payos-payment', { orderId: order.order_id, purpose })
      setPaymentQr({
        deliveryId: delivery.delivery_id,
        title: purpose === 'customer_cod' ? 'Customer scans to pay COD' : 'Shipper scans to remit collected cash',
        qrDataUrl: payment.qrDataUrl,
        checkoutUrl: payment.checkoutUrl,
      })
    } catch (error) { toast(messageOf(error), 'error') }
  }
  if (!profile) return <LoadingState label="Loading shipper profile..." />
  if (deliveries.isLoading) return <LoadingState />
  if (deliveries.error) return <ErrorState error={deliveries.error} />
  return <div className="mx-auto max-w-xl lg:max-w-4xl"><PageHeader eyebrow="Mobile delivery" title="My deliveries" /><div className="mt-5 space-y-4">{!deliveries.data?.length ? <EmptyState title="No deliveries assigned" /> : deliveries.data.map(delivery => { const order = one(delivery.orders); const customer = one(order?.users); const payment = one(order?.payments); const collections = many(delivery.delivery_payment_collections); const checks = many(delivery.delivery_batch_checks); const items = many(order?.order_items); const collection = collections[0]; const allVerified = items.length > 0 && items.every(item => { const batch = one(item.batches); return Boolean(batch && checks.some(check => check.batch_id === batch.batch_id && check.matched)) }); const codReady = payment?.method !== 'cod' || Boolean(collection && (collection.method !== 'cash' || collection.remittance_status === 'paid')); return <article key={delivery.delivery_id} className="card overflow-hidden">
    <div className="bg-[#173d28] p-4 text-white"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-white/55">Order</p><h2 className="text-xl font-black">#{text(order?.order_code)}</h2></div><Badge tone={delivery.status === 'delivered' ? 'green' : delivery.status === 'failed' ? 'red' : 'blue'}>{delivery.status}</Badge></div></div>
    <div className="p-4"><div className="flex items-start gap-3"><MapPin className="mt-1 shrink-0 text-brand-700" size={20}/><div><b>{text(customer?.name)}</b><p className="text-sm text-black/60">{text(order?.delivery_address)}</p></div></div>
      {customer?.phone && <a href={`tel:${customer.phone}`} className="btn-secondary mt-4 w-full"><Phone size={18}/> Call {customer.phone}</a>}
      <div className="my-4 space-y-3 border-y py-4">{items.map(item => { const batch = one(item.batches); const verified = Boolean(batch && checks.some(check => check.batch_id === batch.batch_id && check.matched)); return <div key={item.order_item_id} className={`rounded-xl p-3 ${verified ? 'bg-green-50 ring-1 ring-green-100' : 'bg-black/[0.03]'}`}><div className="flex justify-between gap-3"><span>{item.product_name} x {item.quantity}</span><b>{text(batch?.batch_code)}</b></div><div className="mt-2 flex flex-wrap items-center gap-3">{verified ? <span className="text-sm font-bold text-green-700"><CheckCircle2 className="mr-1 inline" size={16}/> Verified</span> : batch && <button className="text-sm font-bold text-brand-700" onClick={() => verify(delivery.delivery_id, batch.batch_id)}><CheckCircle2 className="mr-1 inline" size={16}/> Verify manually</button>}{batch && <BatchQrButton batchId={batch.batch_id} batchCode={batch.batch_code} label="Show QR"/>}</div></div> })}</div>
      {delivery.status === 'assigned' && <div className="space-y-2"><div className="grid gap-2 sm:grid-cols-2"><QrScanner label="Scan batch QR" showImageButton onResult={value => verifyScanned(delivery, value)}/><button className="btn-primary" disabled={!allVerified} onClick={() => updateStatus(delivery, 'picked_up')}><CheckCircle2 size={18}/> Confirm pickup</button></div>{!allVerified && <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">Scan or manually verify every batch before pickup.</p>}</div>}
      {delivery.status === 'picked_up' && <button className="btn-primary w-full" onClick={() => updateStatus(delivery, 'delivering')}><MapPin size={18}/> Start delivery</button>}
      {delivery.status === 'delivering' && <div className="space-y-3">{payment?.method === 'cod' && !collections.length && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3"><b className="block text-sm">Collect COD at the doorstep</b><p className="mb-3 text-xs text-black/55">Choose exactly one path: receive cash, or show the payOS QR for the Customer to scan and transfer directly.</p><div className="grid gap-2 sm:grid-cols-2"><button className="btn-secondary px-2 text-xs" onClick={() => collectCash(delivery)}>I received cash</button><button className="btn-primary px-2 text-xs" onClick={() => createPaymentQr(delivery, 'customer_cod')}><QrCode size={16}/> Show Customer payOS QR</button></div></div>}{collection?.method === 'customer_payos' && <div className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-700">Customer payOS transfer confirmed by webhook.</div>}{collection?.method === 'cash' && collection?.remittance_status === 'pending' && <><div className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">Cash is recorded, but delivery cannot be completed until the shipper remittance is confirmed.</div><button className="btn-secondary w-full" onClick={() => createPaymentQr(delivery, 'shipper_remittance')}><QrCode size={18}/> Show QR to remit collected cash</button></>}{collection?.remittance_status === 'paid' && <div className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-700">Cash remittance confirmed by payOS.</div>}<button className="btn-primary w-full" disabled={!codReady} onClick={() => updateStatus(delivery, 'delivered')}><CheckCircle2 size={18}/> Confirm delivered</button>{!codReady && <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">Confirm the COD payment or shipper remittance before completing this delivery.</p>}</div>}
      {!['delivered','failed'].includes(delivery.status) && <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold text-red-600 hover:bg-red-50" onClick={() => updateStatus(delivery, 'failed')}><TriangleAlert size={18}/> Mark delivery failed</button>}
    </div>
  </article> })}</div>{paymentQr && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4"><div className="card w-full max-w-sm p-5 text-center"><h2 className="text-xl font-black">{paymentQr.title}</h2><p className="mt-2 text-sm text-black/55">Keep this screen open until payOS confirms the transaction.</p><img src={paymentQr.qrDataUrl} alt="payOS payment QR" className="mx-auto mt-4 w-full max-w-[300px] rounded-2xl"/><a href={paymentQr.checkoutUrl} target="_blank" rel="noreferrer" className="btn-secondary mt-4 w-full">Open payment link</a><button className="btn-primary mt-2 w-full" onClick={() => { setPaymentQr(null); client.invalidateQueries({ queryKey: ['shipper-deliveries'] }) }}>Close and refresh</button></div></div>}</div>
}
