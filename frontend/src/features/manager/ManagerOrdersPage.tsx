import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock3, Search } from 'lucide-react'
import { Badge, PageHeader } from '../../components/Page'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { callFunction } from '../../lib/api'
import { currency, dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useFeedback } from '../../components/Feedback'

type Relation<T> = T | T[] | null | undefined
type Customer = { name: string; phone: string | null }
type Delivery = { delivery_id: string; employee_id: string | null; status: string }
type Tracking = { tracking_id: string; status: string; note: string | null; created_at: string }
type Order = { order_id: string; order_code: number; status: string; total_amount: number; delivery_address: string; users: Relation<Customer>; deliveries: Relation<Delivery>; order_tracking: Tracking[]; order_items: Array<{ order_item_id: string; product_name: string; quantity: number; products: Relation<{ suppliers: Relation<{ name: string }> }> }> }
type Employee = { user_id: string; name: string }

const workflowStatuses = ['', 'pending', 'confirmed', 'preparing', 'assigned', 'picked_up', 'delivering', 'delivered', 'completed', 'cancelled', 'failed']
const one = <T,>(value: Relation<T>) => Array.isArray(value) ? value[0] : value

export function ManagerOrdersPage() {
  const client = useQueryClient()
  const feedback = useFeedback()
  const [query, setQuery] = useState('')
  const [workflowStatus, setWorkflowStatus] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const orders = useQuery({ queryKey: ['manager-orders'], queryFn: async () => {
    const result = await supabase.from('orders').select('order_id,order_code,status,total_amount,delivery_address,users(name,phone),deliveries(delivery_id,employee_id,status),order_tracking(tracking_id,status,note,created_at),order_items(order_item_id,product_name,quantity,products(suppliers(name)))').order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as unknown as Order[]
  }})
  const employees = useQuery({ queryKey: ['employees'], queryFn: async () => {
    const result = await supabase.from('users').select('user_id,name,roles!inner(role_name)').eq('roles.role_name', 'employee').eq('status', 'active')
    if (result.error) throw result.error
    return result.data as Employee[]
  }})
  const confirmOrder = async (orderId: string) => {
    if (!await feedback.confirm({ title: 'Confirm order?', description: 'Inventory remains reserved and the order moves into fulfillment.', confirmLabel: 'Confirm order' })) return
    const result = await supabase.rpc('confirm_order', { p_order_id: orderId })
    if (result.error) feedback.error(result.error.message)
    else { client.invalidateQueries({ queryKey: ['manager-orders'] }); feedback.success('Order confirmed') }
  }
  const prepareOrder = async (orderId: string) => {
    if (!await feedback.confirm({ title: 'Start preparation?', description: 'Packing teams will prepare supplier groups for consolidated delivery.', confirmLabel: 'Start preparation' })) return
    const result = await supabase.rpc('mark_order_preparing', { p_order_id: orderId })
    if (result.error) feedback.error(result.error.message)
    else { client.invalidateQueries({ queryKey: ['manager-orders'] }); feedback.success('Order preparation started') }
  }
  const assign = async (orderId: string, nextEmployeeId: string) => {
    if (!nextEmployeeId) return
    const employee = employees.data?.find(item => item.user_id === nextEmployeeId)
    if (!await feedback.confirm({ title: 'Assign delivery?', description: `${employee?.name ?? 'This employee'} will receive the order, batch checklist and chat rooms.`, confirmLabel: 'Assign shipper' })) return
    try { await callFunction('assign-delivery', { orderId, employeeId: nextEmployeeId }); client.invalidateQueries({ queryKey: ['manager-orders'] }); feedback.success('Delivery assigned') } catch (error) { feedback.error(error instanceof Error ? error.message : String(error)) }
  }
  if (orders.isLoading || employees.isLoading) return <LoadingState />
  if (orders.error || employees.error) return <ErrorState error={orders.error ?? employees.error} />
  const filtered = orders.data?.filter(order => {
    const customer = one(order.users)
    const delivery = one(order.deliveries)
    const latestTracking = [...order.order_tracking].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    const text = `${order.order_code} ${customer?.name ?? ''} ${customer?.phone ?? ''} ${order.delivery_address} ${order.order_items.map(item => item.product_name).join(' ')}`.toLowerCase()
    return (!query || text.includes(query.toLowerCase()))
      && (!workflowStatus || order.status === workflowStatus || delivery?.status === workflowStatus || latestTracking?.status === workflowStatus)
      && (!employeeId || delivery?.employee_id === employeeId)
  })
  return <div><PageHeader eyebrow="Fulfillment" title="Order operations" />
    <div className="card mt-6 space-y-4 p-4">
      <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35" size={18}/><input className="input" style={{ paddingLeft: '2.75rem' }} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search order, customer, address, product"/></label>
      <div><p className="mb-2 text-xs font-bold uppercase tracking-widest text-black/40">Workflow status</p><div className="flex flex-wrap gap-2">{workflowStatuses.map(value => <button key={value || 'all'} type="button" onClick={() => setWorkflowStatus(value)} className={`rounded-full px-4 py-2 text-sm font-bold capitalize ${workflowStatus === value ? 'bg-brand-600 text-white' : 'bg-black/[0.05] text-black/60 hover:bg-brand-50'}`}>{value ? value.replaceAll('_',' ') : 'All workflow'}</button>)}</div></div>
      <label><span className="mb-2 block text-xs font-bold uppercase tracking-widest text-black/40">Shipper</span><select className="input" value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="">All shippers</option>{employees.data?.map(employee => <option key={employee.user_id} value={employee.user_id}>{employee.name}</option>)}</select></label>
    </div>
    <div className="mt-5 space-y-3">{filtered?.map(order => {
      const customer = one(order.users)
      const delivery = one(order.deliveries)
      const tracking = [...order.order_tracking].sort((a,b) => a.created_at.localeCompare(b.created_at))
      const supplierGroups = Object.entries(order.order_items.reduce<Record<string, string[]>>((groups, item) => {
        const product = one(item.products)
        const supplier = one(product?.suppliers)?.name ?? 'Unknown supplier'
        groups[supplier] = [...(groups[supplier] ?? []), `${item.product_name} x ${item.quantity}`]
        return groups
      }, {}))
      return <article key={order.order_id} className="card p-5"><div className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-black">Order #{order.order_code}</h2><Badge tone="orange">{order.status}</Badge>{delivery?.status && <Badge tone="blue">{delivery.status}</Badge>}</div><p className="text-sm text-black/50">{customer?.name ?? 'Customer'} / {customer?.phone ?? 'No phone'} / {order.delivery_address}</p><b>{currency.format(order.total_amount)}</b></div><div>{order.status === 'pending' && <button className="btn-primary" onClick={() => confirmOrder(order.order_id)}>Confirm order</button>}{order.status === 'confirmed' && <button className="btn-primary" onClick={() => prepareOrder(order.order_id)}>Start preparation</button>}</div><select className="input min-w-52" value={delivery?.employee_id ?? ''} onChange={event => assign(order.order_id, event.target.value)}><option value="">Assign one delivery employee</option>{employees.data?.map(employee => <option key={employee.user_id} value={employee.user_id}>{employee.name}</option>)}</select></div><details className="mt-4 rounded-xl bg-black/[0.03] p-3"><summary className="cursor-pointer text-sm font-bold">Tracking ({tracking.length})</summary><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{tracking.map(item => <div key={item.tracking_id} className="rounded-xl bg-white p-3 shadow-sm"><div className="flex items-center gap-2"><Clock3 size={15} className="text-blue-600"/><b className="capitalize">{item.status.replaceAll('_', ' ')}</b></div><p className="mt-1 text-xs text-black/45">{dateTime(item.created_at)}{item.note ? ` / ${item.note}` : ''}</p></div>)}</div></details><details className="mt-4 rounded-xl bg-black/[0.03] p-3"><summary className="cursor-pointer text-sm font-bold">Packing groups by supplier ({supplierGroups.length})</summary><div className="mt-3 grid gap-2 md:grid-cols-2">{supplierGroups.map(([supplier, items]) => <div key={supplier} className="rounded-xl bg-white p-3"><b className="text-sm text-brand-700">{supplier}</b>{items.map(item => <p key={item} className="text-sm text-black/55">{item}</p>)}</div>)}</div><p className="mt-3 text-xs text-black/45">FreshTrace uses centralized fulfillment: supplier groups are consolidated into one customer order and assigned to one shipper.</p></details></article>
    })}{!filtered?.length && <div className="card p-8 text-center text-black/50">No orders match the current filters.</div>}</div>
  </div>
}
