import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Badge } from '../../components/Page'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { currency, date, dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'

type Tab = 'orders' | 'deliveries' | 'payments' | 'catalog' | 'inventory'
type Relation<T> = T | T[] | null
type MonitorOrder = { order_id: string; order_code: number; status: string; total_amount: number; created_at: string; users: Relation<{ name: string }> }
type MonitorDelivery = { delivery_id: string; status: string; created_at: string; pickup_time: string | null; delivery_time: string | null; orders: Relation<{ order_code: number }>; users: Relation<{ name: string }> }
type MonitorPayment = { payment_id: string; method: string; status: string; amount: number; created_at: string; orders: Relation<{ order_code: number }> }
type MonitorProduct = { product_id: string; name: string; status: string; categories: Relation<{ name: string }>; suppliers: Relation<{ name: string }> }
type MonitorInventory = { inventory_id: string; quantity_available: number; quantity_reserved: number; batches: Relation<{ batch_code: string; status: string; expire_date: string; products: Relation<{ name: string }> }> }

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function safe(value: unknown) {
  if (value == null || value === '') return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function searchText(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(searchText).join(' ')
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map(searchText).join(' ')
  return String(value)
}

export function AdminMonitoringPage() {
  const [tab, setTab] = useState<Tab>('orders')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const data = useQuery({
    queryKey: ['admin-monitoring'],
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [products, orders, payments, deliveries, inventory] = await Promise.all([
        supabase.from('products').select('product_id,name,status,categories(name),suppliers(name)').order('created_at', { ascending: false }).limit(100),
        supabase.from('orders').select('order_id,order_code,status,total_amount,created_at,users(name)').order('created_at', { ascending: false }).limit(100),
        supabase.from('payments').select('payment_id,method,status,amount,created_at,orders(order_code)').order('created_at', { ascending: false }).limit(100),
        supabase.from('deliveries').select('delivery_id,status,created_at,pickup_time,delivery_time,orders(order_code),users(name)').order('created_at', { ascending: false }).limit(100),
        supabase.from('inventory').select('inventory_id,quantity_available,quantity_reserved,last_updated,batches(batch_code,status,expire_date,products(name))').order('last_updated', { ascending: false }).limit(100),
      ])
      const error = products.error ?? orders.error ?? payments.error ?? deliveries.error ?? inventory.error
      if (error) throw error
      return {
        products: (products.data ?? []) as unknown as MonitorProduct[],
        orders: (orders.data ?? []) as unknown as MonitorOrder[],
        payments: (payments.data ?? []) as unknown as MonitorPayment[],
        deliveries: (deliveries.data ?? []) as unknown as MonitorDelivery[],
        inventory: (inventory.data ?? []) as unknown as MonitorInventory[],
      }
    },
  })
  const rows = useMemo(() => {
    if (!data.data) return []
    const source: Array<MonitorOrder | MonitorDelivery | MonitorPayment | MonitorProduct | MonitorInventory> =
      tab === 'catalog' ? data.data.products : data.data[tab]
    return source.filter(item => {
      const text = searchText(item).toLowerCase()
      const batch = 'batches' in item ? one(item.batches) : null
      const itemStatus = String(('status' in item ? item.status : undefined)
        ?? batch?.status ?? '')
      const dateValue = 'created_at' in item ? item.created_at : 'assigned_at' in item ? item.assigned_at : 'expire_date' in item ? item.expire_date : batch?.expire_date
      const time = dateValue ? new Date(String(dateValue)).getTime() : 0
      return (!query || text.includes(query.toLowerCase()))
        && (!status || itemStatus === status)
        && (!fromDate || (time && time >= new Date(fromDate).getTime()))
        && (!toDate || (time && time <= new Date(`${toDate}T23:59:59`).getTime()))
    })
  }, [data.data, fromDate, query, status, tab, toDate])
  if (data.isLoading) return <LoadingState/>
  if (data.error) return <ErrorState error={data.error}/>
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'orders', label: 'Orders' },
    { id: 'deliveries', label: 'Deliveries' },
    { id: 'payments', label: 'Payments' },
    { id: 'catalog', label: 'Catalog' },
    { id: 'inventory', label: 'Inventory risks' },
  ]
  return <div>
    <PageHeader eyebrow="Read-only oversight" title="System monitoring"/>
    <div className="card mt-6 flex flex-wrap gap-2 p-2">{tabs.map(item =>
      <button key={item.id} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === item.id ? 'bg-brand-600 text-white' : 'hover:bg-brand-50'}`} onClick={() => { setTab(item.id); setStatus('') }}>{item.label}</button>
    )}</div>
    <div className="card mt-4 grid gap-3 p-4 md:grid-cols-[1fr_180px_160px_160px]">
      <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${tab}`}/>
      <select className="input" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">All statuses</option>
        {['pending','confirmed','processing','assigned','delivering','delivered','completed','cancelled','paid','failed','active','inactive','available','locked','expired','sold_out'].map(value => <option key={value}>{value}</option>)}
      </select>
      <input className="input" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} aria-label="From date"/>
      <input className="input" type="date" value={toDate} onChange={event => setToDate(event.target.value)} aria-label="To date"/>
    </div>
    {/* <p className="mt-3 text-xs text-black/45">Monitoring is read-only by design. Use Governance, Users, Catalog or Operations for write actions.</p> */}
    <section className="card mt-5 overflow-x-auto">
      {tab === 'orders' && <table className="min-w-[760px] w-full text-left text-sm"><thead><tr className="border-b"><th className="p-4">Order</th><th>Customer</th><th>Created</th><th>Total</th><th>Status</th></tr></thead><tbody>{rows.map(raw => { const item = raw as MonitorOrder; const user = one(item.users); return <tr className="border-b last:border-0" key={item.order_id}><td className="p-4 font-bold">#{safe(item.order_code)}</td><td>{safe(user?.name)}</td><td>{dateTime(item.created_at)}</td><td>{currency.format(item.total_amount)}</td><td><Badge tone="blue">{safe(item.status)}</Badge></td></tr> })}</tbody></table>}
      {tab === 'deliveries' && <table className="min-w-[760px] w-full text-left text-sm"><thead><tr className="border-b"><th className="p-4">Order</th><th>Employee</th><th>Assigned</th><th>Pickup</th><th>Delivered</th><th>Status</th></tr></thead><tbody>{rows.map(raw => { const item = raw as MonitorDelivery; const order = one(item.orders); const user = one(item.users); return <tr className="border-b last:border-0" key={item.delivery_id}><td className="p-4 font-bold">#{safe(order?.order_code)}</td><td>{safe(user?.name)}</td><td>{dateTime(item.created_at)}</td><td>{item.pickup_time ? dateTime(item.pickup_time) : '-'}</td><td>{item.delivery_time ? dateTime(item.delivery_time) : '-'}</td><td><Badge tone="blue">{safe(item.status)}</Badge></td></tr> })}</tbody></table>}
      {tab === 'payments' && <table className="min-w-[700px] w-full text-left text-sm"><thead><tr className="border-b"><th className="p-4">Order</th><th>Method</th><th>Amount</th><th>Created</th><th>Status</th></tr></thead><tbody>{rows.map(raw => { const item = raw as MonitorPayment; const order = one(item.orders); return <tr className="border-b last:border-0" key={item.payment_id}><td className="p-4 font-bold">#{safe(order?.order_code)}</td><td className="uppercase">{safe(item.method)}</td><td>{currency.format(item.amount)}</td><td>{dateTime(item.created_at)}</td><td><Badge tone={item.status === 'paid' ? 'green' : item.status === 'failed' ? 'red' : 'orange'}>{safe(item.status)}</Badge></td></tr> })}</tbody></table>}
      {tab === 'catalog' && <table className="min-w-[700px] w-full text-left text-sm"><thead><tr className="border-b"><th className="p-4">Product</th><th>Category</th><th>Supplier</th><th>Status</th></tr></thead><tbody>{rows.map(raw => { const item = raw as MonitorProduct; const category = one(item.categories); const supplier = one(item.suppliers); return <tr className="border-b last:border-0" key={item.product_id}><td className="p-4 font-bold">{safe(item.name)}</td><td>{safe(category?.name)}</td><td>{safe(supplier?.name)}</td><td><Badge>{safe(item.status)}</Badge></td></tr> })}</tbody></table>}
      {tab === 'inventory' && <table className="min-w-[820px] w-full text-left text-sm"><thead><tr className="border-b"><th className="p-4">Batch</th><th>Product</th><th>Expiry</th><th>Available</th><th>Reserved</th><th>Risk</th></tr></thead><tbody>{rows.map(raw => { const item = raw as MonitorInventory; const batch = one(item.batches); const product = one(batch?.products); const low = item.quantity_available <= 10; return <tr className="border-b last:border-0" key={item.inventory_id}><td className="p-4 font-bold">{safe(batch?.batch_code)}</td><td>{safe(product?.name)}</td><td>{batch?.expire_date ? date(batch.expire_date) : '-'}</td><td>{item.quantity_available}</td><td>{item.quantity_reserved}</td><td><Badge tone={low ? 'red' : batch?.status === 'available' ? 'green' : 'orange'}>{low ? 'low stock' : safe(batch?.status)}</Badge></td></tr> })}</tbody></table>}
      {!rows.length && <p className="p-8 text-center text-sm text-black/50">No records match the current filters.</p>}
    </section>
  </div>
}
