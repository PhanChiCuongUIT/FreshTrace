import { useQuery } from '@tanstack/react-query'
import { DonutChart, HorizontalBarChart, SparklineCard, VerticalBarChart } from '../../components/Charts'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { Metric, PageHeader } from '../../components/Page'
import { currency } from '../../lib/format'
import { supabase } from '../../lib/supabase'

export function ManagerDashboard() {
  const dashboard = useQuery({ queryKey: ['manager-dashboard-statistics'], queryFn: async () => {
    const [orders, deliveries, batches, rescue, payments, inventory] = await Promise.all([
      supabase.from('orders').select('status,created_at'),
      supabase.from('deliveries').select('status,created_at'),
      supabase.from('batches').select('status,expire_date'),
      supabase.from('fresh_rescue_deals').select('status'),
      supabase.from('payments').select('status,amount,created_at'),
      supabase.from('inventory').select('quantity_available,quantity_reserved,batches(batch_code)'),
    ])
    const error = orders.error ?? deliveries.error ?? batches.error ?? rescue.error ?? payments.error ?? inventory.error
    if (error) throw error
    const months = Array.from({ length: 6 }, (_, index) => {
      const value = new Date()
      value.setMonth(value.getMonth() - (5 - index))
      return value.toISOString().slice(0, 7)
    })
    const paid = payments.data?.filter(item => item.status === 'paid') ?? []
    return {
      orders: orders.data ?? [],
      deliveries: deliveries.data ?? [],
      batches: batches.data ?? [],
      rescue: rescue.data ?? [],
      inventory: inventory.data ?? [],
      revenue: paid.reduce((sum, item) => sum + Number(item.amount), 0),
      months,
      revenueTrend: months.map(month => paid.filter(item => item.created_at.startsWith(month)).reduce((sum, item) => sum + Number(item.amount), 0)),
      orderTrend: months.map(month => orders.data?.filter(item => item.created_at.startsWith(month)).length ?? 0),
    }
  }})
  if (dashboard.isLoading) return <LoadingState/>
  if (dashboard.error) return <ErrorState error={dashboard.error}/>
  const data = dashboard.data!
  const batchName = (value: unknown) => {
    const row = Array.isArray(value) ? value[0] : value
    return row && typeof row === 'object' && 'batch_code' in row ? String(row.batch_code) : 'Batch'
  }
  return <div><PageHeader eyebrow="Operations" title="Manager dashboard"/>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Open orders" value={data.orders.filter(item => ['pending','confirmed','preparing'].includes(item.status)).length}/><Metric label="Active deliveries" value={data.deliveries.filter(item => ['assigned','picked_up','delivering'].includes(item.status)).length}/><Metric label="Near-expiry batches" value={data.batches.filter(item => item.status === 'near_expiry').length}/><Metric label="Fresh Rescue deals" value={data.rescue.filter(item => item.status === 'active').length}/><Metric label="Paid revenue" value={currency.format(data.revenue)}/></div>
    <div className="mt-6 grid gap-5 xl:grid-cols-3"><SparklineCard label="Revenue trend" value={currency.format(data.revenue)} values={data.revenueTrend} footer="Paid revenue over 6 months"/><SparklineCard label="Order intake" value={data.orders.length} values={data.orderTrend} footer="Orders created over 6 months"/><DonutChart title="Delivery status" items={['assigned','picked_up','delivering','delivered','failed'].map((status, index) => ({ label: status.replaceAll('_', ' '), value: data.deliveries.filter(item => item.status === status).length, color: ['#8b5cf6','#3b82f6','#0ea5e9','#16a34a','#ef4444'][index] }))}/></div>
    <div className="mt-6 grid gap-5 xl:grid-cols-2"><VerticalBarChart title="Revenue by month" items={data.months.map((month, index) => ({ label: month, value: data.revenueTrend[index] ?? 0 }))} valueLabel={currency.format}/><HorizontalBarChart title="Order pipeline" items={['pending','confirmed','preparing','delivering','completed','cancelled'].map((status, index) => ({ label: status, value: data.orders.filter(item => item.status === status).length, color: ['#eab308','#3b82f6','#8b5cf6','#0ea5e9','#16a34a','#64748b'][index] }))}/><HorizontalBarChart title="Available inventory by batch" items={data.inventory.slice(0, 8).map(item => ({ label: batchName(item.batches), value: item.quantity_available - item.quantity_reserved }))}/></div>
  </div>
}
