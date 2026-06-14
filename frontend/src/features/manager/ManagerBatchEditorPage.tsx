import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/Page'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { supabase } from '../../lib/supabase'
import { useFeedback } from '../../components/Feedback'
import { catalogErrorMessage } from '../../lib/catalogErrors'

type Lookup = {
  products: Array<{ product_id: string; supplier_id: string | null; name: string; status: string }>
  batch: { batch_id: string; product_id: string; batch_code: string; harvest_date: string; expire_date: string; quantity: number; origin_location: string | null; status: string } | null
}

export function ManagerBatchEditorPage() {
  const { recordId = '' } = useParams()
  const editing = Boolean(recordId)
  const navigate = useNavigate()
  const client = useQueryClient()
  const feedback = useFeedback()
  const [form, setForm] = useState({ productId: '', batchCode: '', harvestDate: '', expireDate: '', quantity: '1', origin: '', status: 'available' })
  const lookup = useQuery({ queryKey: ['manager-batch-editor', recordId], queryFn: async () => {
    const [products, batch] = await Promise.all([
      supabase.from('products').select('product_id,supplier_id,name,status').order('name'),
      recordId ? supabase.from('batches').select('batch_id,product_id,batch_code,harvest_date,expire_date,quantity,origin_location,status').eq('batch_id', recordId).single() : Promise.resolve({ data: null, error: null }),
    ])
    const error = products.error ?? batch.error
    if (error) throw error
    return { products: products.data, batch: batch.data } as Lookup
  }})
  useEffect(() => {
    const batch = lookup.data?.batch
    if (!batch) return
    const timer = window.setTimeout(() => setForm({ productId: batch.product_id, batchCode: batch.batch_code, harvestDate: batch.harvest_date, expireDate: batch.expire_date, quantity: String(batch.quantity), origin: batch.origin_location ?? '', status: batch.status }), 0)
    return () => window.clearTimeout(timer)
  }, [lookup.data?.batch])
  const save = async () => {
    const product = lookup.data?.products.find(item => item.product_id === form.productId)
    if (!product) return feedback.error('Select a valid product')
    const quantity = Number(form.quantity)
    if (!form.batchCode.trim()) return feedback.error('Batch code is required')
    if (!Number.isInteger(quantity) || quantity < 0) return feedback.error('Batch quantity must be a whole number of zero or greater')
    if (!form.harvestDate || !form.expireDate || form.expireDate < form.harvestDate) return feedback.error('Expiry date must be on or after the harvest date')
    const ok = await feedback.confirm({ title: editing ? 'Save batch changes?' : 'Create batch?', message: 'Batch data is used for traceability QR, inventory and delivery verification.', confirmLabel: editing ? 'Save batch' : 'Create batch' })
    if (!ok) return
    const values = { product_id: product.product_id, supplier_id: product.supplier_id, batch_code: form.batchCode.trim(), harvest_date: form.harvestDate, expire_date: form.expireDate, quantity: Number(form.quantity), origin_location: form.origin.trim() || null, status: form.status }
    const result = editing
      ? await supabase.rpc('update_batch_and_inventory', {
        p_batch_id: recordId,
        p_product_id: values.product_id,
        p_supplier_id: values.supplier_id,
        p_batch_code: values.batch_code,
        p_harvest_date: values.harvest_date,
        p_expire_date: values.expire_date,
        p_quantity: values.quantity,
        p_origin_location: values.origin_location,
        p_status: values.status,
      })
      : await supabase.from('batches').insert(values).select('batch_id').single()
    if (result.error) return feedback.error(catalogErrorMessage(result.error))
    await Promise.all([client.invalidateQueries({ queryKey: ['manager-catalog'] }), client.invalidateQueries({ queryKey: ['products'] })])
    feedback.success(editing ? 'Batch updated' : 'Batch created')
    navigate('/manager/catalog/batches')
  }
  if (lookup.isLoading) return <LoadingState/>
  if (lookup.error) return <ErrorState error={lookup.error}/>
  return <div>
    <PageHeader eyebrow="Batch editor" title={editing ? 'Edit batch' : 'Create batch'} actions={<Link className="btn-secondary" to="/manager/catalog/batches">Back to batches</Link>}/>
    <form className="card mt-6 grid gap-5 p-6 xl:grid-cols-2" onSubmit={event => { event.preventDefault(); save() }}>
      <label className="text-sm font-bold xl:col-span-2">Product<select className="input mt-1 disabled:bg-black/5" required disabled={editing} value={form.productId} onChange={event => setForm(value => ({ ...value, productId: event.target.value }))}><option value="">Select product</option>{lookup.data?.products.filter(item => item.status === 'active' || item.product_id === form.productId).map(item => <option key={item.product_id} value={item.product_id}>{item.name}{item.status !== 'active' ? ' (inactive)' : ''}</option>)}</select></label>
      <label className="text-sm font-bold">Batch code<input className="input mt-1" required value={form.batchCode} onChange={event => setForm(value => ({ ...value, batchCode: event.target.value }))}/></label>
      <label className="text-sm font-bold">Imported quantity<input className="input mt-1" required min={0} type="number" value={form.quantity} onChange={event => setForm(value => ({ ...value, quantity: event.target.value }))}/></label>
      <label className="text-sm font-bold">Harvest date<input className="input mt-1" required type="date" value={form.harvestDate} onChange={event => setForm(value => ({ ...value, harvestDate: event.target.value }))}/></label>
      <label className="text-sm font-bold">Expiry date<input className="input mt-1" required type="date" value={form.expireDate} onChange={event => setForm(value => ({ ...value, expireDate: event.target.value }))}/></label>
      <label className="text-sm font-bold">Origin<input className="input mt-1" value={form.origin} onChange={event => setForm(value => ({ ...value, origin: event.target.value }))}/></label>
      <label className="text-sm font-bold">Status<select className="input mt-1" value={form.status} onChange={event => setForm(value => ({ ...value, status: event.target.value }))}><option value="available">Available</option><option value="near_expiry">Near expiry</option><option value="locked">Locked</option><option value="sold_out">Sold out</option><option value="expired">Expired</option></select></label>
      <div className="flex flex-wrap gap-3 xl:col-span-2"><button className="btn-primary">{editing ? 'Save batch' : 'Create batch'}</button><Link className="btn-secondary" to="/manager/catalog/batches">Cancel</Link></div>
    </form>
  </div>
}
