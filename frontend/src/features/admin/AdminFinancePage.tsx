import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DonutChart, HorizontalBarChart, SparklineCard, VerticalBarChart } from '../../components/Charts'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { Badge, PageHeader } from '../../components/Page'
import { currency, dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'

type Payment = { payment_id: string; method: string; status: string; amount: number; created_at: string; orders: { order_code: number } }
type OrderItem = { product_name: string; quantity: number; price: number; orders: { status: string } }

const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
const currentYear = new Date().getFullYear()

function isoWeekKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : new Date(value)
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function monthKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function periodKey(value: string, period: 'week' | 'month' | 'year') {
  const date = new Date(value)
  if (period === 'week') return isoWeekKey(date)
  if (period === 'month') return monthKey(date)
  return String(date.getFullYear())
}

function labelPeriod(key: string, period: 'week' | 'month' | 'year') {
  if (period === 'week') return `Week ${Number(key.slice(-2))}, ${key.slice(0, 4)}`
  if (period === 'month') return `${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
  return key
}

function weeksInYear(year: number) {
  return Number(isoWeekKey(new Date(Date.UTC(year, 11, 28))).slice(-2))
}

function dateFromKey(key: string, period: 'week' | 'month' | 'year') {
  if (period === 'year') return new Date(Number(key), 0, 1)
  if (period === 'month') return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1)
  const year = Number(key.slice(0, 4))
  const week = Number(key.slice(-2))
  const first = new Date(Date.UTC(year, 0, 4))
  const day = first.getUTCDay() || 7
  first.setUTCDate(first.getUTCDate() - day + 1 + (week - 1) * 7)
  return first
}

function addPeriodKey(key: string, period: 'week' | 'month' | 'year', amount: number) {
  const date = dateFromKey(key, period)
  if (period === 'week') date.setUTCDate(date.getUTCDate() + amount * 7)
  else if (period === 'month') date.setMonth(date.getMonth() + amount)
  else date.setFullYear(date.getFullYear() + amount)
  return period === 'week' ? isoWeekKey(date) : period === 'month' ? monthKey(date) : String(date.getFullYear())
}

function comparePeriod(a: string, b: string, period: 'week' | 'month' | 'year') {
  return dateFromKey(a, period).getTime() - dateFromKey(b, period).getTime()
}

function periodWindow(selected: string, period: 'week' | 'month' | 'year', maxKey: string, size = 10) {
  const keys: string[] = []
  for (let offset = -5; offset <= 4; offset += 1) {
    const key = addPeriodKey(selected, period, offset)
    if (comparePeriod(key, maxKey, period) <= 0) keys.push(key)
  }
  while (keys.length < size) {
    const previous = addPeriodKey(keys[0] ?? selected, period, -1)
    if (keys.includes(previous)) break
    keys.unshift(previous)
  }
  return keys.slice(-size)
}

export function AdminFinancePage() {
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month')
  const [selectedWeek, setSelectedWeek] = useState(() => isoWeekKey(new Date()))
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()))
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()))
  const finance = useQuery({ queryKey: ['admin-finance'], queryFn: async () => {
    const [paymentsResult, itemsResult] = await Promise.all([
      supabase.from('payments').select('payment_id,method,status,amount,created_at,orders(order_code)').order('created_at', { ascending: false }),
      supabase.from('order_items').select('product_name,quantity,price,orders(status)'),
    ])
    const error = paymentsResult.error ?? itemsResult.error
    if (error) throw error
    const payments = paymentsResult.data as unknown as Payment[]
    const items = itemsResult.data as unknown as OrderItem[]
    const paid = payments.filter(payment => payment.status === 'paid')
    const months = Array.from({ length: 6 }, (_, index) => {
      const value = new Date()
      value.setMonth(value.getMonth() - (5 - index))
      return monthKey(value)
    })
    const revenueByMonth = months.map(month => paid.filter(payment => payment.created_at.startsWith(month)).reduce((sum, payment) => sum + Number(payment.amount), 0))
    const productRevenue = new Map<string, number>()
    items.filter(item => item.orders?.status === 'completed').forEach(item => productRevenue.set(item.product_name, (productRevenue.get(item.product_name) ?? 0) + item.quantity * Number(item.price)))
    return {
      payments,
      months,
      revenueByMonth,
      revenue: paid.reduce((sum, payment) => sum + Number(payment.amount), 0),
      pending: payments.filter(payment => payment.status === 'pending').reduce((sum, payment) => sum + Number(payment.amount), 0),
      failed: payments.filter(payment => payment.status === 'failed').length,
      methods: ['cod', 'payos', 'bank_transfer'].map((method, index) => ({ label: method.toUpperCase(), value: payments.filter(payment => payment.method === method).length, color: ['#16a34a','#3b82f6','#8b5cf6'][index] })),
      topProducts: [...productRevenue.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6),
    }
  }})
  if (finance.isLoading) return <LoadingState/>
  if (finance.error) return <ErrorState error={finance.error}/>
  const data = finance.data!
  const minYear = Math.min(currentYear, ...data.payments.map(payment => new Date(payment.created_at).getFullYear()))
  const yearOptions = Array.from({ length: currentYear - minYear + 1 }, (_, index) => String(currentYear - index))
  const periodRows = (() => {
    const grouped = new Map<string, { label: string; revenue: number; transactions: number; pending: number; failed: number }>()
    data.payments.forEach(payment => {
      const label = periodKey(payment.created_at, period)
      const current = grouped.get(label) ?? { label, revenue: 0, transactions: 0, pending: 0, failed: 0 }
      current.transactions += 1
      if (payment.status === 'paid') current.revenue += Number(payment.amount)
      if (payment.status === 'pending') current.pending += Number(payment.amount)
      if (payment.status === 'failed') current.failed += 1
      grouped.set(label, current)
    })
    return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label))
  })()
  const selectedKey = period === 'week' ? selectedWeek : period === 'month' ? selectedMonth : selectedYear
  const maxKey = periodKey(new Date().toISOString(), period)
  const chartKeys = periodWindow(selectedKey, period, maxKey)
  const selectedRow = periodRows.find(row => row.label === selectedKey) ?? { label: selectedKey, revenue: 0, transactions: 0, pending: 0, failed: 0 }
  const selectedPayments = data.payments.filter(payment => {
    return periodKey(payment.created_at, period) === selectedKey
  })
  const selectedRevenueTrend = chartKeys.map(key => periodRows.find(row => row.label === key)?.revenue ?? 0)
  const paidCount = selectedPayments.filter(payment => payment.status === 'paid').length
  const pendingCount = selectedPayments.filter(payment => payment.status === 'pending').length
  const failedCount = selectedPayments.filter(payment => payment.status === 'failed').length
  const exportReport = () => {
    const escapeHtml = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    const periodName = labelPeriod(selectedKey, period)
    const chartRows = chartKeys.map(key => {
      const row = periodRows.find(item => item.label === key)
      return [labelPeriod(key, period), row?.revenue ?? 0, row?.transactions ?? 0, row?.pending ?? 0, row?.failed ?? 0]
    })
    const money = (value: number) => currency.format(value)
    const table = (title: string, headers: string[], rows: Array<Array<unknown>>) => `<h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:Calibri,Arial,sans-serif;color:#17301f;background:#fff}
      h1{font-size:32px;color:#0f6b45;margin:0 0 6px;text-align:center;font-weight:800;letter-spacing:.02em}
      .meta{color:#5d6b61;margin:0 0 24px;text-align:center;font-size:13px}
      h2{font-size:18px;color:#102b1c;margin:24px 0 8px;font-weight:800;border-left:5px solid #0f6b45;padding-left:10px}
      table{border-collapse:collapse;width:100%;margin-bottom:22px;border:2px solid #0a4b31}
      th{background:#0f6b45;color:#fff;font-weight:800;text-align:center;border:2px solid #0a4b31;padding:10px;font-size:13px}
      td{border:1.5px solid #8ea390;padding:9px;vertical-align:top;font-size:12px}
      tr:nth-child(even) td{background:#f6faf3}
      .summary td:first-child{font-weight:700;color:#102b1c}
      .number{text-align:right}
    </style></head><body>
      <h1>FreshTrace Financial Report</h1>
      <p class="meta">Generated at ${escapeHtml(new Date().toLocaleString('en-US'))} / ${escapeHtml(period)} / ${escapeHtml(periodName)}</p>
      ${table('Summary', ['Metric', 'Value'], [
        ['Selected revenue', money(selectedRow.revenue)],
        ['Pending value', money(selectedRow.pending)],
        ['Failed payments', selectedRow.failed],
        ['Total transactions', selectedRow.transactions],
        ['Paid transactions', paidCount],
        ['Pending transactions', pendingCount],
        ['Failed transactions', failedCount],
      ])}
      ${table(`Revenue window around selected ${period}`, ['Period', 'Paid revenue', 'Transactions', 'Pending value', 'Failed payments'], chartRows.map(row => [row[0], money(Number(row[1])), row[2], money(Number(row[3])), row[4]]))}
      ${table('Selected period detail', ['Period', 'Paid revenue', 'Transactions', 'Pending value', 'Failed payments'], [[periodName, money(selectedRow.revenue), selectedRow.transactions, money(selectedRow.pending), selectedRow.failed]])}
      ${table('Transactions', ['Order code', 'Method', 'Status', 'Amount', 'Created at', 'Payment id'], selectedPayments.map(payment => [payment.orders?.order_code ? `#${payment.orders.order_code}` : '', payment.method.toUpperCase(), payment.status, money(payment.amount), dateTime(payment.created_at), payment.payment_id]))}
    </body></html>`
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `freshtrace-finance-${period}-${periodName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xls`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const selectedWeekYear = Number(selectedWeek.slice(0, 4))
  const selectedWeekNo = Number(selectedWeek.slice(-2))
  const selectedMonthYear = Number(selectedMonth.slice(0, 4))
  const selectedMonthNo = Number(selectedMonth.slice(5, 7))
  return <div><PageHeader eyebrow="Financial control" title="Financial reports" actions={<div className="flex max-w-full flex-wrap justify-end gap-2"><select className="input" style={{ width: '10rem' }} value={period} onChange={event => setPeriod(event.target.value as 'week' | 'month' | 'year')}><option value="week">By week</option><option value="month">By month</option><option value="year">By year</option></select>{period === 'week' && <><select className="input" style={{ width: '7rem' }} value={selectedWeekYear} onChange={event => setSelectedWeek(`${event.target.value}-W${String(Math.min(selectedWeekNo, weeksInYear(Number(event.target.value)))).padStart(2, '0')}`)}>{yearOptions.map(year => <option key={year}>{year}</option>)}</select><select className="input" style={{ width: '9rem' }} value={selectedWeekNo} onChange={event => setSelectedWeek(`${selectedWeekYear}-W${String(event.target.value).padStart(2, '0')}`)}>{Array.from({ length: selectedWeekYear === currentYear ? Number(maxKey.slice(-2)) : weeksInYear(selectedWeekYear) }, (_, index) => index + 1).map(week => <option key={week} value={week}>Week {week}</option>)}</select></>}{period === 'month' && <><select className="input" style={{ width: '9rem' }} value={selectedMonthNo} onChange={event => setSelectedMonth(`${selectedMonthYear}-${String(event.target.value).padStart(2, '0')}`)}>{monthNames.map((name, index) => <option key={name} value={index + 1} disabled={selectedMonthYear === currentYear && index + 1 > new Date().getMonth() + 1}>{name}</option>)}</select><select className="input" style={{ width: '7rem' }} value={selectedMonthYear} onChange={event => setSelectedMonth(`${event.target.value}-${String(Math.min(selectedMonthNo, Number(event.target.value) === currentYear ? new Date().getMonth() + 1 : 12)).padStart(2, '0')}`)}>{yearOptions.map(year => <option key={year}>{year}</option>)}</select></>}{period === 'year' && <select className="input" style={{ width: '9rem' }} value={selectedYear} onChange={event => setSelectedYear(event.target.value)}>{yearOptions.map(year => <option key={year}>{year}</option>)}</select>}<button className="btn-primary" onClick={exportReport}>Export report</button></div>}/>
    <div className="mt-6 grid gap-4 lg:grid-cols-3"><SparklineCard label="Selected revenue" value={currency.format(selectedRow.revenue)} values={selectedRevenueTrend} footer={labelPeriod(selectedKey, period)}/><SparklineCard label="Pending value" value={currency.format(selectedRow.pending)} values={chartKeys.map(key => periodRows.find(row => row.label === key)?.pending ?? 0)} footer="Unsettled payments in the selected period"/><SparklineCard label="Failed payments" value={selectedRow.failed} values={chartKeys.map(key => periodRows.find(row => row.label === key)?.failed ?? 0)} footer="Payment attempts requiring attention"/></div>
    <div className="mt-6 grid gap-5 xl:grid-cols-2"><VerticalBarChart title={`Revenue around selected ${period}`} items={chartKeys.map(key => ({ label: labelPeriod(key, period), value: periodRows.find(row => row.label === key)?.revenue ?? 0, color: key === selectedKey ? '#16a34a' : undefined }))} valueLabel={currency.format}/><DonutChart title="Selected payment status" items={[{ label: 'Paid', value: paidCount, color: '#16a34a' }, { label: 'Pending', value: pendingCount, color: '#eab308' }, { label: 'Failed', value: failedCount, color: '#ef4444' }]} center={<><b className="text-2xl">{selectedRow.transactions}</b><span className="block text-xs text-black/45">transactions</span></>}/><HorizontalBarChart title="Payment method usage" items={data.methods}/><HorizontalBarChart title="Top completed products" items={data.topProducts} valueLabel={currency.format}/><section className="card overflow-x-auto xl:col-span-2"><div className="p-5 pb-0"><h2 className="text-lg font-black">Transactions for {labelPeriod(selectedKey, period)}</h2></div><table className="mt-3 w-full min-w-[720px] text-left text-sm"><thead className="border-y bg-black/[0.02]"><tr><th className="p-4">Order</th><th>Method</th><th>Amount</th><th>Created</th><th>Status</th></tr></thead><tbody>{selectedPayments.map(payment => <tr key={payment.payment_id} className="border-b last:border-0"><td className="p-4 font-bold">#{payment.orders?.order_code}</td><td>{payment.method.toUpperCase()}</td><td>{currency.format(payment.amount)}</td><td>{dateTime(payment.created_at)}</td><td><Badge tone={payment.status === 'paid' ? 'green' : payment.status === 'failed' ? 'red' : 'orange'}>{payment.status}</Badge></td></tr>)}</tbody></table>{!selectedPayments.length && <p className="p-5 text-center text-sm text-black/50">No transactions in this period.</p>}</section></div>
  </div>
}
