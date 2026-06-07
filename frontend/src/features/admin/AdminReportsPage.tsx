import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, PageHeader } from '../../components/Page'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useFeedback } from '../../components/Feedback'

type Report = { report_id: string; type: string; description: string; status: string; response: string | null; created_at: string; users: { name: string; email: string } }
type Supplier = { supplier_id: string; name: string; certificate: string | null; status: string; description: string | null }

export function AdminReportsPage() {
  const client = useQueryClient()
  const feedback = useFeedback()
  const [responses, setResponses] = useState<Record<string, string>>({})
  const reports = useQuery({ queryKey: ['admin-reports'], queryFn: async () => {
    const result = await supabase.from('reports').select('report_id,type,description,status,response,created_at,users!reports_user_id_fkey(name,email)').order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as unknown as Report[]
  }})
  const suppliers = useQuery({ queryKey: ['admin-suppliers'], queryFn: async () => {
    const result = await supabase.from('suppliers').select('supplier_id,name,certificate,status,description').order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as Supplier[]
  }})
  const resolve = async (reportId: string, status: 'resolved' | 'rejected') => {
    const approved = await feedback.confirm({ title: `${status === 'resolved' ? 'Resolve' : 'Reject'} report?`, description: 'This response is final and the reporter will be notified.', confirmLabel: status === 'resolved' ? 'Resolve report' : 'Reject report', danger: status === 'rejected' })
    if (!approved) return
    const result = await supabase.rpc('resolve_report', { p_report_id: reportId, p_status: status, p_response: responses[reportId] || null })
    if (result.error) feedback.error(result.error.message)
    else { client.invalidateQueries({ queryKey: ['admin-reports'] }); feedback.success('Report updated') }
  }
  const approve = async (supplierId: string, status: 'approved' | 'rejected') => {
    const approved = await feedback.confirm({ title: `${status === 'approved' ? 'Approve' : 'Reject'} supplier?`, description: status === 'approved' ? 'Approved suppliers can be attached to active products and batches.' : 'The supplier will remain unavailable to the public catalog.', confirmLabel: status === 'approved' ? 'Approve supplier' : 'Reject supplier', danger: status === 'rejected' })
    if (!approved) return
    const result = await supabase.rpc('approve_supplier', { p_supplier_id: supplierId, p_status: status, p_response: null })
    if (result.error) feedback.error(result.error.message)
    else { client.invalidateQueries({ queryKey: ['admin-suppliers'] }); feedback.success('Supplier status updated') }
  }
  useEffect(() => {
    const channel = supabase.channel('admin-reports-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => client.invalidateQueries({ queryKey: ['admin-reports'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, () => client.invalidateQueries({ queryKey: ['admin-suppliers'] }))
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [client])
  if (reports.isLoading || suppliers.isLoading) return <LoadingState />
  if (reports.error || suppliers.error) return <ErrorState error={reports.error ?? suppliers.error} />
  return <div><PageHeader eyebrow="Moderation" title="Reports and supplier approval" />
    <h2 className="mb-3 mt-7 text-xl font-black">Pending suppliers</h2><div className="grid gap-3 lg:grid-cols-2">{suppliers.data?.map(item => <article key={item.supplier_id} className="card p-5"><div className="flex justify-between"><b>{item.name}</b><Badge tone={item.status === 'approved' ? 'green' : item.status === 'rejected' ? 'red' : 'orange'}>{item.status}</Badge></div><p className="text-sm text-black/50">{item.description}</p><p className="my-3 text-sm">Certificate: {item.certificate ?? 'Not provided'}</p>{item.status === 'pending' && <div className="flex gap-2"><button className="btn-primary py-2" onClick={() => approve(item.supplier_id, 'approved')}>Approve</button><button className="btn-secondary py-2 text-red-600" onClick={() => approve(item.supplier_id, 'rejected')}>Reject</button></div>}</article>)}</div>
    <h2 className="mb-3 mt-7 text-xl font-black">User reports</h2><div className="space-y-3">{reports.data?.map(item => <article key={item.report_id} className="card p-5"><div className="flex flex-wrap justify-between gap-2"><div><b className="capitalize">{item.type}</b><p className="text-sm text-black/50">{item.users.name} / {item.users.email} / {dateTime(item.created_at)}</p></div><Badge tone={item.status === 'resolved' ? 'green' : item.status === 'rejected' ? 'red' : 'orange'}>{item.status}</Badge></div><p className="my-4">{item.description}</p>{['pending','processing'].includes(item.status) ? <div className="flex flex-col gap-2 sm:flex-row"><input className="input" placeholder="Admin response" value={responses[item.report_id] ?? ''} onChange={event => setResponses({ ...responses, [item.report_id]: event.target.value })}/><button className="btn-primary" onClick={() => resolve(item.report_id, 'resolved')}>Resolve</button><button className="btn-secondary text-red-600" onClick={() => resolve(item.report_id, 'rejected')}>Reject</button></div> : <p className="text-sm text-black/55">Response: {item.response ?? 'No response'}</p>}</article>)}</div>
  </div>
}
