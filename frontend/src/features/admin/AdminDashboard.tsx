import { useQuery } from '@tanstack/react-query'
import { DonutChart, HorizontalBarChart, SparklineCard, VerticalBarChart } from '../../components/Charts'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { Metric, PageHeader } from '../../components/Page'
import { currency } from '../../lib/format'
import { supabase } from '../../lib/supabase'

type Order = { status: string; total_amount: number; created_at: string }
type Payment = { status: string; amount: number; created_at: string }

export function AdminDashboard() {
  const dashboard = useQuery({ queryKey: ['admin-dashboard-statistics'], queryFn: async () => {
    const [users, suppliers, reports, orders, payments] = await Promise.all([
      supabase.from('users').select('status,created_at'),
      supabase.from('suppliers').select('status'),
      supabase.from('reports').select('status'),
      supabase.from('orders').select('status,total_amount,created_at'),
      supabase.from('payments').select('status,amount,created_at'),
    ])
    const error = users.error ?? suppliers.error ?? reports.error ?? orders.error ?? payments.error
    if (error) throw error
    const orderRows = orders.data as Order[]
    const paymentRows = payments.data as Payment[]
    const months = Array.from({ length: 6 }, (_, index) => {
      const value = new Date()
      value.setMonth(value.getMonth() - (5 - index))
      return value.toISOString().slice(0, 7)
    })
    return {
      users: users.data ?? [],
      suppliers: suppliers.data ?? [],
      reports: reports.data ?? [],
      orders: orderRows,
      payments: paymentRows,
      months,
      revenue: paymentRows.filter(item => item.status === 'paid').reduce((sum, item) => sum + Number(item.amount), 0),
      revenueTrend: months.map(month => paymentRows.filter(item => item.status === 'paid' && item.created_at.startsWith(month)).reduce((sum, item) => sum + Number(item.amount), 0)),
      orderTrend: months.map(month => orderRows.filter(item => item.created_at.startsWith(month)).length),
    }
  }})
  if (dashboard.isLoading) return <LoadingState/>
  if (dashboard.error) return <ErrorState error={dashboard.error}/>
  const data = dashboard.data!
  return <div><PageHeader eyebrow="Governance" title="Admin dashboard"/>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="User profiles" value={data.users.length}/><Metric label="Pending suppliers" value={data.suppliers.filter(item => item.status === 'pending').length}/><Metric label="Open reports" value={data.reports.filter(item => ['pending', 'processing'].includes(item.status)).length}/><Metric label="Banned accounts" value={data.users.filter(item => item.status === 'banned').length}/></div>
    <div className="mt-6 grid gap-5 xl:grid-cols-3"><SparklineCard label="Paid revenue" value={currency.format(data.revenue)} values={data.revenueTrend} footer="Last 6 months"/><SparklineCard label="Order volume" value={data.orders.length} values={data.orderTrend} footer="Orders created over the last 6 months"/><DonutChart title="Order status" items={['pending','confirmed','preparing','delivering','completed','cancelled'].map((status, index) => ({ label: status.replaceAll('_', ' '), value: data.orders.filter(order => order.status === status).length, color: ['#eab308','#3b82f6','#8b5cf6','#0ea5e9','#16a34a','#ef4444'][index] }))} center={<><b className="text-2xl">{data.orders.length}</b><span className="block text-xs text-black/45">orders</span></>}/></div>
    <div className="mt-6 grid gap-5 xl:grid-cols-2"><VerticalBarChart title="Revenue by month" items={data.months.map((month, index) => ({ label: month, value: data.revenueTrend[index] ?? 0 }))} valueLabel={currency.format}/><HorizontalBarChart title="Payment status" items={['pending','paid','failed','cancelled'].map((status, index) => ({ label: status, value: data.payments.filter(payment => payment.status === status).length, color: ['#eab308','#16a34a','#ef4444','#64748b'][index] }))}/><HorizontalBarChart title="Supplier governance" items={['approved','pending','rejected'].map((status, index) => ({ label: status, value: data.suppliers.filter(supplier => supplier.status === status).length, color: ['#16a34a','#eab308','#ef4444'][index] }))}/></div>
  </div>
}
