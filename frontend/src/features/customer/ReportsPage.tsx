import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, PageHeader } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState'
import { dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useFeedback } from '../../components/Feedback'
import { useAuth } from '../auth/auth-context'

type OrderOption = { order_id: string; order_code: number; status: string }
type ReportableUser = { user_id: string; name: string; role_name: string }
type Report = {
  report_id: string
  type: string
  description: string
  status: string
  response: string | null
  created_at: string
  orders: { order_code: number } | null
  reported_user: { name: string } | null
}

export function ReportsPage() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const feedback = useFeedback()
  const [type, setType] = useState('order_issue')
  const [orderId, setOrderId] = useState('')
  const [description, setDescription] = useState('')
  const [reportedUserId, setReportedUserId] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const data = useQuery({ queryKey: ['customer-reports', profile?.user_id], queryFn: async () => {
    const [reports, orders] = await Promise.all([
      supabase.from('reports').select('report_id,type,description,status,response,created_at,orders(order_code),reported_user:users!reports_reported_user_id_fkey(name)').eq('user_id', profile!.user_id).order('created_at', { ascending: false }),
      supabase.from('orders').select('order_id,order_code,status').eq('user_id', profile!.user_id).order('created_at', { ascending: false }),
    ])
    const error = reports.error ?? orders.error
    if (error) throw error
    return {
      reports: reports.data as unknown as Report[],
      orders: orders.data as OrderOption[],
    }
  }})
  const reportableUsers = useQuery({ queryKey: ['reportable-users', userQuery], enabled: type === 'user_report', queryFn: async () => {
    const result = await supabase.rpc('list_reportable_users', { p_query: userQuery.trim() || null, p_limit: 30 })
    if (result.error) throw result.error
    return result.data as ReportableUser[]
  }})

  const submit = async () => {
    setSubmitting(true)
    const result = await supabase.from('reports').insert({
      user_id: profile!.user_id,
      order_id: type === 'user_report' ? null : orderId || null,
      reported_user_id: type === 'user_report' ? reportedUserId || null : null,
      type,
      description: description.trim(),
    }).select('report_id').single()
    setSubmitting(false)
    if (result.error) return feedback.error(result.error.message)
    setDescription('')
    setOrderId('')
    setReportedUserId('')
    setUserQuery('')
    setType('order_issue')
    await client.invalidateQueries({ queryKey: ['customer-reports'] })
    feedback.success('Report submitted to Admin')
  }

  if (data.isLoading) return <LoadingState />
  if (data.error) return <ErrorState error={data.error} />

  return <div>
    <PageHeader eyebrow="Support" title="Reports and complaints" />
    <form className="card mt-6 grid gap-4 p-5" onSubmit={event => { event.preventDefault(); void submit() }}>
      <h2 className="text-xl font-black">Create a report</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-bold">Type<select className="input mt-1" value={type} onChange={event => { setType(event.target.value); setOrderId(''); setReportedUserId('') }}><option value="order_issue">Order issue</option><option value="quality_issue">Product quality</option><option value="delivery_issue">Delivery issue</option><option value="payment_issue">Payment issue</option><option value="user_report">Report a user</option><option value="other">Other</option></select></label>
        {type === 'user_report'
          ? <div className="grid gap-2"><label className="text-sm font-bold">Find a related user<input className="input mt-1" value={userQuery} onChange={event => setUserQuery(event.target.value)} placeholder="Search name or role"/></label><label className="text-sm font-bold">User being reported<select className="input mt-1" required value={reportedUserId} onChange={event => setReportedUserId(event.target.value)}><option value="">Select a user</option>{reportableUsers.data?.map(user => <option key={user.user_id} value={user.user_id}>{user.name} / {user.role_name}</option>)}</select></label></div>
          : <label className="text-sm font-bold">Related order<select className="input mt-1" value={orderId} onChange={event => setOrderId(event.target.value)}><option value="">No specific order</option>{data.data?.orders.map(order => <option key={order.order_id} value={order.order_id}>Order #{order.order_code} / {order.status}</option>)}</select></label>}
      </div>
      <label className="text-sm font-bold">Description<textarea className="input mt-1" rows={5} required minLength={10} value={description} onChange={event => setDescription(event.target.value)} placeholder="Describe what happened, including product, delivery or payment details."/></label>
      <button className="btn-primary w-fit" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit report'}</button>
    </form>
    <section className="mt-7">
      <h2 className="text-2xl font-black">My reports</h2>
      <div className="mt-4 space-y-3">{!data.data?.reports.length ? <EmptyState title="No reports yet" /> : data.data.reports.map(report => <article key={report.report_id} className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><b className="capitalize">{report.type.replaceAll('_', ' ')}</b><p className="text-sm text-black/45">{report.orders ? `Order #${report.orders.order_code} / ` : report.reported_user ? `User: ${report.reported_user.name} / ` : ''}{dateTime(report.created_at)}</p></div><Badge tone={report.status === 'resolved' ? 'green' : report.status === 'rejected' ? 'red' : 'orange'}>{report.status}</Badge></div>
        <p className="mt-3 whitespace-pre-wrap">{report.description}</p>
        {report.response && <p className="mt-3 rounded-xl bg-brand-50 p-3 text-sm"><b>Admin response:</b> {report.response}</p>}
      </article>)}</div>
    </section>
  </div>
}
