import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/Page'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { supabase } from '../../lib/supabase'
import { useFeedback } from '../../components/Feedback'
import { Camera } from 'lucide-react'
import { uploadImage } from '../../lib/cloudinary'
import { catalogErrorMessage } from '../../lib/catalogErrors'

type Lookup = {
  categories: Array<{ category_id: string; name: string; status: string }>
  suppliers: Array<{ supplier_id: string; name: string; status: string }>
  product: { product_id: string; category_id: string | null; supplier_id: string | null; name: string; description: string | null; unit: string; image_url: string | null; certificate: string | null; status: string } | null
}

export function ManagerProductEditorPage() {
  const { recordId = '' } = useParams()
  const editing = Boolean(recordId)
  const navigate = useNavigate()
  const client = useQueryClient()
  const feedback = useFeedback()
  const [form, setForm] = useState({ name: '', categoryId: '', supplierId: '', unit: 'kg', description: '', certificate: '', imageUrl: '', status: 'active' })
  const [uploadingImage, setUploadingImage] = useState(false)
  const lookup = useQuery({ queryKey: ['manager-product-editor', recordId], queryFn: async () => {
    const [categories, suppliers, product] = await Promise.all([
      supabase.from('categories').select('category_id,name,status').order('name'),
      supabase.from('suppliers').select('supplier_id,name,status').order('name'),
      recordId ? supabase.from('products').select('product_id,category_id,supplier_id,name,description,unit,image_url,certificate,status').eq('product_id', recordId).single() : Promise.resolve({ data: null, error: null }),
    ])
    const error = categories.error ?? suppliers.error ?? product.error
    if (error) throw error
    return { categories: categories.data, suppliers: suppliers.data, product: product.data } as Lookup
  }})
  useEffect(() => {
    const product = lookup.data?.product
    if (!product) return
    const timer = window.setTimeout(() => setForm({ name: product.name, categoryId: product.category_id ?? '', supplierId: product.supplier_id ?? '', unit: product.unit, description: product.description ?? '', certificate: product.certificate ?? '', imageUrl: product.image_url ?? '', status: product.status }), 0)
    return () => window.clearTimeout(timer)
  }, [lookup.data?.product])
  const save = async () => {
    if (!form.name.trim() || !form.unit.trim()) return feedback.error('Product name and unit are required')
    if (!form.categoryId || !form.supplierId) return feedback.error('Select a category and an approved supplier')
    const ok = await feedback.confirm({ title: editing ? 'Save product changes?' : 'Create product?', message: 'Customers will see active products in the marketplace.', confirmLabel: editing ? 'Save product' : 'Create product' })
    if (!ok) return
    const values = { name: form.name.trim(), category_id: form.categoryId || null, supplier_id: form.supplierId || null, unit: form.unit.trim(), description: form.description.trim() || null, certificate: form.certificate.trim() || null, image_url: form.imageUrl.trim() || null, status: form.status }
    const result = editing
      ? await supabase.from('products').update(values).eq('product_id', recordId).select('product_id').single()
      : await supabase.from('products').insert(values).select('product_id').single()
    if (result.error) return feedback.error(catalogErrorMessage(result.error))
    await Promise.all([client.invalidateQueries({ queryKey: ['manager-catalog'] }), client.invalidateQueries({ queryKey: ['products'] })])
    feedback.success(editing ? 'Product updated' : 'Product created')
    navigate('/manager/catalog/products')
  }
  const uploadProductImage = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return feedback.error('Product image must be an image file')
    setUploadingImage(true)
    try {
      const imageUrl = await uploadImage(file, 'products')
      setForm(value => ({ ...value, imageUrl }))
      feedback.success('Product image uploaded')
    } catch (error) {
      feedback.error(String(error))
    } finally {
      setUploadingImage(false)
    }
  }
  if (lookup.isLoading) return <LoadingState/>
  if (lookup.error) return <ErrorState error={lookup.error}/>
  return <div>
    <PageHeader eyebrow="Product editor" title={editing ? 'Edit product' : 'Create product'} actions={<Link className="btn-secondary" to="/manager/catalog/products">Back to products</Link>}/>
    <form className="card mt-6 grid gap-5 p-6 xl:grid-cols-2" onSubmit={event => { event.preventDefault(); save() }}>
      <label className="text-sm font-bold">Product name<input className="input mt-1" required value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))}/></label>
      <label className="text-sm font-bold">Unit<input className="input mt-1" required value={form.unit} onChange={event => setForm(value => ({ ...value, unit: event.target.value }))}/></label>
      <label className="text-sm font-bold">Category<select className="input mt-1" required value={form.categoryId} onChange={event => setForm(value => ({ ...value, categoryId: event.target.value }))}><option value="">Select category</option>{lookup.data?.categories.filter(item => item.status === 'active' || item.category_id === form.categoryId).map(item => <option key={item.category_id} value={item.category_id}>{item.name}{item.status !== 'active' ? ' (inactive)' : ''}</option>)}</select></label>
      <label className="text-sm font-bold">Approved supplier<select className="input mt-1" required value={form.supplierId} onChange={event => setForm(value => ({ ...value, supplierId: event.target.value }))}><option value="">Select supplier</option>{lookup.data?.suppliers.filter(item => item.status === 'approved' || item.supplier_id === form.supplierId).map(item => <option key={item.supplier_id} value={item.supplier_id}>{item.name}{item.status !== 'approved' ? ` (${item.status})` : ''}</option>)}</select></label>
      <label className="text-sm font-bold">Certificate<input className="input mt-1" value={form.certificate} onChange={event => setForm(value => ({ ...value, certificate: event.target.value }))}/></label>
      <label className="text-sm font-bold">Status<select className="input mt-1" value={form.status} onChange={event => setForm(value => ({ ...value, status: event.target.value }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label className="btn-secondary cursor-pointer justify-center xl:col-span-2"><Camera size={18}/>{uploadingImage ? 'Uploading image...' : form.imageUrl ? 'Change product image' : 'Upload product image'}<input className="hidden" type="file" accept="image/*" onChange={event => uploadProductImage(event.target.files?.[0])}/></label>
      {form.imageUrl && <img src={form.imageUrl} alt={form.name || 'Product preview'} className="h-56 w-full rounded-2xl object-cover xl:col-span-2"/>}
      <label className="text-sm font-bold xl:col-span-2">Description<textarea className="input mt-1" rows={5} value={form.description} onChange={event => setForm(value => ({ ...value, description: event.target.value }))}/></label>
      <div className="flex flex-wrap gap-3 xl:col-span-2"><button className="btn-primary">{editing ? 'Save product' : 'Create product'}</button><Link className="btn-secondary" to="/manager/catalog/products">Cancel</Link></div>
    </form>
  </div>
}
