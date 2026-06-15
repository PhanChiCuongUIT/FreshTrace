import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Edit3, PackagePlus, Plus, QrCode, Search, Trash2, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge, PageHeader } from '../../components/Page'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { BatchQrButton } from '../../components/BatchQrButton'
import { callFunction } from '../../lib/api'
import { uploadImage } from '../../lib/cloudinary'
import { ProductImage } from '../../components/ProductImage'
import { catalogErrorMessage } from '../../lib/catalogErrors'
import { currency, date } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useFeedback } from '../../components/Feedback'

type Section = 'suppliers' | 'categories' | 'products' | 'batches' | 'prices' | 'rescue' | 'inventory'
type Drawer = Section | null
type Supplier = { supplier_id: string; name: string; address: string | null; certificate: string | null; description: string | null; status: string }
type Category = { category_id: string; name: string; description: string | null; status: string }
type Product = { product_id: string; category_id: string | null; supplier_id: string | null; name: string; description: string | null; unit: string; image_url: string | null; certificate: string | null; status: string; categories?: { name: string } | null; suppliers?: { name: string } | null }
type Batch = { batch_id: string; product_id: string; supplier_id: string | null; batch_code: string; harvest_date: string; expire_date: string; quantity: number; origin_location: string | null; status: string; products: { product_id: string; name: string }; inventory: { quantity_available: number; quantity_reserved: number } | null }
type Price = { price_id: string; product_id: string; batch_id: string | null; price: number; price_type: string; start_date: string; end_date: string | null; products: { name: string }; batches: { batch_code: string } | null }
type Rescue = { deal_id: string; batch_id: string; title: string; description: string | null; original_price: number; rescue_price: number; start_at: string; end_at: string; status: string; batches: { batch_code: string } }
type Transaction = { transaction_id: string; type: string; quantity: number; note: string | null; created_at: string; batches: { batch_code: string; products: { name: string } } }
type InventoryReason = 'stock_count' | 'import' | 'export' | 'reserve' | 'release'

const sections: Section[] = ['suppliers', 'categories', 'products', 'batches', 'prices', 'rescue', 'inventory']
const emptySupplier = { id: '', name: '', address: '', certificate: '', description: '' }
const emptyCategory = { id: '', name: '', description: '', status: 'active' }
const emptyProduct = { id: '', name: '', categoryId: '', supplierId: '', unit: 'kg', description: '', certificate: '', imageUrl: '', status: 'active' }
const emptyBatch = { id: '', productId: '', batchCode: '', harvestDate: '', expireDate: '', quantity: '1', origin: '', status: 'available' }
const emptyPrice = { id: '', batchId: '', price: '', priceType: 'normal', startDate: new Date().toISOString().slice(0, 10), endDate: '' }
const emptyRescue = { id: '', batchId: '', title: '', description: '', originalPrice: '', rescuePrice: '', startAt: new Date().toISOString().slice(0, 16), endAt: '' }
const emptyInventory = { batchId: '', quantity: '', reason: 'stock_count' as InventoryReason, note: '' }

const sectionFilterLabels: Record<Section, string> = {
  suppliers: 'supplier status',
  categories: 'category status',
  products: 'product status',
  batches: 'batch status',
  prices: 'price type',
  rescue: 'deal status',
  inventory: 'batch status',
}
const staticFilterOptions: Partial<Record<Section, string[]>> = {
  suppliers: ['pending', 'approved', 'rejected'],
  categories: ['active', 'inactive'],
  products: ['active', 'inactive'],
  batches: ['available', 'near_expiry', 'locked', 'sold_out', 'expired'],
  prices: ['normal', 'promotion', 'rescue'],
  rescue: ['active', 'inactive', 'expired', 'sold_out'],
  inventory: ['available', 'near_expiry', 'locked', 'sold_out', 'expired'],
}

export function ManagerCatalogPage() {
  const navigate = useNavigate()
  const params = useParams()
  const client = useQueryClient()
  const feedback = useFeedback()
  const section = sections.includes(params.section as Section) ? params.section as Section : 'products'
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [auditQuery, setAuditQuery] = useState('')
  const [auditType, setAuditType] = useState('')
  const [supplierForm, setSupplierForm] = useState(emptySupplier)
  const [categoryForm, setCategoryForm] = useState(emptyCategory)
  const [productForm, setProductForm] = useState(emptyProduct)
  const [batchForm, setBatchForm] = useState(emptyBatch)
  const [priceForm, setPriceForm] = useState(emptyPrice)
  const [rescueForm, setRescueForm] = useState(emptyRescue)
  const [inventoryForm, setInventoryForm] = useState(emptyInventory)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [productImageFile, setProductImageFile] = useState<File | null>(null)
  const [productImagePreview, setProductImagePreview] = useState('')

  const data = useQuery({ queryKey: ['manager-catalog'], queryFn: async () => {
    await supabase.rpc('refresh_catalog_state')
    const [suppliers, categories, products, batches, prices, deals, transactions] = await Promise.all([
      supabase.from('suppliers').select('supplier_id,name,address,certificate,description,status').order('name'),
      supabase.from('categories').select('category_id,name,description,status').order('name'),
      supabase.from('products').select('product_id,category_id,supplier_id,name,description,unit,image_url,certificate,status,categories(name),suppliers(name)').order('name'),
      supabase.from('batches').select('batch_id,product_id,supplier_id,batch_code,harvest_date,expire_date,quantity,origin_location,status,products(product_id,name),inventory(quantity_available,quantity_reserved)').order('expire_date'),
      supabase.from('prices').select('price_id,product_id,batch_id,price,price_type,start_date,end_date,products(name),batches(batch_code)').order('created_at', { ascending: false }),
      supabase.from('fresh_rescue_deals').select('deal_id,batch_id,title,description,original_price,rescue_price,start_at,end_at,status,batches(batch_code)').order('created_at', { ascending: false }),
      supabase.from('inventory_transactions').select('transaction_id,type,quantity,note,created_at,batches(batch_code,products(name))').order('created_at', { ascending: false }).limit(100),
    ])
    const error = suppliers.error ?? categories.error ?? products.error ?? batches.error ?? prices.error ?? deals.error ?? transactions.error
    if (error) throw error
    return {
      suppliers: suppliers.data as Supplier[],
      categories: categories.data as Category[],
      products: products.data as unknown as Product[],
      batches: batches.data as unknown as Batch[],
      prices: prices.data as unknown as Price[],
      deals: deals.data as unknown as Rescue[],
      transactions: transactions.data as unknown as Transaction[],
    }
  }})

  useEffect(() => () => { if (productImagePreview) URL.revokeObjectURL(productImagePreview) }, [productImagePreview])
  const matches = (text: string, itemStatus = '') => (!query || text.toLowerCase().includes(query.toLowerCase())) && (!status || itemStatus === status)
  const clearProductImageSelection = () => {
    if (productImagePreview) URL.revokeObjectURL(productImagePreview)
    setProductImagePreview('')
    setProductImageFile(null)
  }
  const closeDrawer = () => {
    clearProductImageSelection()
    setDrawer(null)
  }
  const invalidate = async () => {
    await supabase.rpc('refresh_catalog_state')
    await Promise.all([
      client.invalidateQueries({ queryKey: ['manager-catalog'] }),
      client.invalidateQueries({ queryKey: ['products'] }),
      client.invalidateQueries({ queryKey: ['categories'] }),
      client.invalidateQueries({ queryKey: ['home-rescue-deals'] }),
      client.invalidateQueries({ queryKey: ['product-detail'] }),
      client.invalidateQueries({ queryKey: ['manager-dashboard-statistics'] }),
    ])
  }
  const relationSummary = (target: Section) => {
    if (!data.data) return ''
    if (target === 'suppliers' && supplierForm.id) {
      const products = data.data.products.filter(item => item.supplier_id === supplierForm.id).length
      const batches = data.data.batches.filter(item => item.supplier_id === supplierForm.id).length
      return `Related records: ${products} products and ${batches} batches. Editing an approved supplier returns it to pending review and can hide linked products from the public marketplace until Admin approves it again.`
    }
    if (target === 'categories' && categoryForm.id) {
      const products = data.data.products.filter(item => item.category_id === categoryForm.id).length
      return `Related records: ${products} products. Inactive categories hide linked active products from customer search. Historical orders are preserved.`
    }
    if (target === 'products' && productForm.id) {
      const batches = data.data.batches.filter(item => item.product_id === productForm.id).length
      const prices = data.data.prices.filter(item => item.product_id === productForm.id).length
      return `Related records: ${batches} batches and ${prices} prices. The supplier cannot be changed after a batch exists because traceability must remain stable. Inactive products are hidden from checkout, but existing orders and reports remain intact.`
    }
    if (target === 'batches' && batchForm.id) {
      const batch = data.data.batches.find(item => item.batch_id === batchForm.id)
      return `Related records: inventory ${batch?.inventory?.quantity_available ?? 0} available / ${batch?.inventory?.quantity_reserved ?? 0} reserved. Quantity edits also create an inventory audit adjustment and cannot go below reserved stock.`
    }
    if (target === 'prices' && priceForm.id) return 'Price changes affect future product listing/search price immediately. Historical order item prices stay unchanged.'
    if (target === 'rescue' && rescueForm.id) return 'Fresh Rescue edits affect customer Rescue listing immediately. Expired or sold-out deals are synced automatically; inactive deals stay hidden.'
    return 'FreshTrace uses soft status changes and audit logs instead of hard delete for catalog records, so foreign-key history for orders, reports, inventory and chat remains safe.'
  }

  const openCreate = (target: Section) => {
    clearProductImageSelection()
    if (target === 'suppliers') setSupplierForm(emptySupplier)
    if (target === 'categories') setCategoryForm(emptyCategory)
    if (target === 'products') setProductForm(emptyProduct)
    if (target === 'batches') setBatchForm(emptyBatch)
    if (target === 'prices') setPriceForm(emptyPrice)
    if (target === 'rescue') setRescueForm(emptyRescue)
    if (target === 'inventory') setInventoryForm(emptyInventory)
    setDrawer(target)
  }

  const currentBatchPrice = (batchId: string) => {
    if (!data.data) return null
    const today = new Date().toISOString().slice(0, 10)
    const batch = data.data.batches.find(item => item.batch_id === batchId)
    if (!batch) return null
    const candidates = data.data.prices
      .filter(item => item.product_id === batch.product_id && (item.batch_id === batchId || !item.batch_id) && ['normal', 'promotion'].includes(item.price_type) && item.start_date <= today && (!item.end_date || item.end_date >= today))
      .sort((a, b) => Number(Boolean(b.batch_id)) - Number(Boolean(a.batch_id)) || Number(b.price_type === 'promotion') - Number(a.price_type === 'promotion') || b.start_date.localeCompare(a.start_date))
    return candidates[0]?.price ?? null
  }

  const saveSupplier = async () => {
    if (!supplierForm.name.trim()) return feedback.error('Supplier name is required')
    if (!await feedback.confirm({ title: supplierForm.id ? 'Save supplier request?' : 'Create supplier request?', description: relationSummary('suppliers'), confirmLabel: supplierForm.id ? 'Save supplier' : 'Create supplier' })) return
    const values = {
      name: supplierForm.name.trim(),
      address: supplierForm.address.trim() || null,
      certificate: supplierForm.certificate.trim() || null,
      description: supplierForm.description.trim() || null,
      status: 'pending' as const,
      approved_by: null,
      approved_at: null,
    }
    const result = supplierForm.id
      ? await supabase.from('suppliers').update(values).eq('supplier_id', supplierForm.id).select('supplier_id').single()
      : await supabase.from('suppliers').insert(values).select('supplier_id').single()
    if (result.error) return feedback.error(catalogErrorMessage(result.error))
    await invalidate(); closeDrawer(); feedback.success(supplierForm.id ? 'Supplier updated' : 'Supplier submitted')
  }
  const saveCategory = async () => {
    if (!categoryForm.name.trim()) return feedback.error('Category name is required')
    if (!await feedback.confirm({ title: categoryForm.id ? 'Save category?' : 'Create category?', description: relationSummary('categories'), confirmLabel: categoryForm.id ? 'Save category' : 'Create category' })) return
    const values = { name: categoryForm.name.trim(), description: categoryForm.description.trim() || null, status: categoryForm.status }
    const result = categoryForm.id
      ? await supabase.from('categories').update(values).eq('category_id', categoryForm.id).select('category_id').single()
      : await supabase.from('categories').insert(values).select('category_id').single()
    if (result.error) return feedback.error(catalogErrorMessage(result.error))
    await invalidate(); closeDrawer(); feedback.success(categoryForm.id ? 'Category updated' : 'Category created')
  }
  const saveProduct = async () => {
    if (!productForm.name.trim() || !productForm.unit.trim()) return feedback.error('Product name and unit are required')
    if (!productForm.categoryId) return feedback.error('Select a category')
    if (!productForm.supplierId) return feedback.error('Select an approved supplier')
    if (!await feedback.confirm({ title: productForm.id ? 'Save product?' : 'Create product?', description: relationSummary('products'), confirmLabel: productForm.id ? 'Save product' : 'Create product' })) return
    let imageUrl = productForm.imageUrl || null
    if (productImageFile) {
      setUploadingImage(true)
      try {
        imageUrl = await uploadImage(productImageFile, 'products')
      } catch (error) {
        setUploadingImage(false)
        return feedback.error(String(error))
      }
      setUploadingImage(false)
    }
    const values = { name: productForm.name.trim(), category_id: productForm.categoryId || null, supplier_id: productForm.supplierId || null, unit: productForm.unit.trim(), description: productForm.description.trim() || null, certificate: productForm.certificate.trim() || null, image_url: imageUrl, status: productForm.status }
    const result = productForm.id
      ? await supabase.from('products').update(values).eq('product_id', productForm.id).select('product_id').single()
      : await supabase.from('products').insert(values).select('product_id').single()
    if (result.error) return feedback.error(catalogErrorMessage(result.error))
    await invalidate(); closeDrawer(); feedback.success(productForm.id ? 'Product updated' : 'Product created')
  }
  const saveBatch = async () => {
    const product = data.data?.products.find(item => item.product_id === batchForm.productId)
    if (!product) return feedback.error('Select a valid product')
    const quantity = Number(batchForm.quantity)
    if (!batchForm.batchCode.trim()) return feedback.error('Batch code is required')
    if (!Number.isInteger(quantity) || quantity < 0) return feedback.error('Batch quantity must be a whole number of zero or greater')
    if (!batchForm.harvestDate || !batchForm.expireDate || batchForm.expireDate < batchForm.harvestDate) return feedback.error('Expiry date must be on or after the harvest date')
    if (!await feedback.confirm({ title: batchForm.id ? 'Save batch?' : 'Create batch?', description: relationSummary('batches'), confirmLabel: batchForm.id ? 'Save batch' : 'Create batch' })) return
    const values = { product_id: product.product_id, supplier_id: product.supplier_id, batch_code: batchForm.batchCode.trim(), harvest_date: batchForm.harvestDate, expire_date: batchForm.expireDate, quantity: Number(batchForm.quantity), origin_location: batchForm.origin.trim() || null, status: batchForm.status }
    const result = batchForm.id
      ? await supabase.rpc('update_batch_and_inventory', {
        p_batch_id: batchForm.id,
        p_product_id: values.product_id,
        p_supplier_id: values.supplier_id,
        p_batch_code: values.batch_code,
        p_harvest_date: values.harvest_date,
        p_expire_date: values.expire_date,
        p_quantity: values.quantity,
        p_origin_location: values.origin_location ?? '',
        p_status: values.status,
      })
      : await supabase.from('batches').insert(values).select('batch_id').single()
    if (result.error) return feedback.error(catalogErrorMessage(result.error))
    await invalidate(); closeDrawer(); feedback.success(batchForm.id ? 'Batch updated' : 'Batch created')
  }
  const savePrice = async () => {
    const batch = data.data?.batches.find(item => item.batch_id === priceForm.batchId)
    if (!batch) return feedback.error('Select a valid batch')
    const price = Number(priceForm.price)
    if (!Number.isFinite(price) || price <= 0) return feedback.error('Price must be greater than zero')
    if (!priceForm.startDate) return feedback.error('Price start date is required')
    if (priceForm.endDate && priceForm.endDate < priceForm.startDate) return feedback.error('Price end date cannot be before its start date')
    if (!await feedback.confirm({ title: priceForm.id ? 'Save price?' : 'Create price?', description: relationSummary('prices'), confirmLabel: priceForm.id ? 'Save price' : 'Create price' })) return
    const values = { product_id: batch.products.product_id, batch_id: batch.batch_id, price: Number(priceForm.price), price_type: priceForm.priceType as 'normal' | 'promotion', start_date: priceForm.startDate, end_date: priceForm.endDate || null }
    const result = priceForm.id
      ? await supabase.from('prices').update(values).eq('price_id', priceForm.id).select('price_id').single()
      : await supabase.from('prices').insert(values).select('price_id').single()
    if (result.error) return feedback.error(catalogErrorMessage(result.error))
    await invalidate(); closeDrawer(); feedback.success(priceForm.id ? 'Price updated' : 'Price created')
  }
  const saveRescue = async () => {
    const originalPrice = currentBatchPrice(rescueForm.batchId)
    const original = Number(originalPrice)
    const rescuePrice = Number(rescueForm.rescuePrice)
    if (!rescueForm.batchId || !rescueForm.title.trim()) return feedback.error('Batch and deal title are required')
    if (!Number.isFinite(original) || !Number.isFinite(rescuePrice) || original <= 0 || rescuePrice <= 0) return feedback.error('Fresh Rescue requires an active normal or promotion price, and a rescue price greater than zero')
    if (rescuePrice >= original) return feedback.error('Fresh Rescue price must be lower than the original price')
    if (!rescueForm.startAt || !rescueForm.endAt || rescueForm.endAt <= rescueForm.startAt) return feedback.error('Fresh Rescue end time must be after its start time')
    if (!await feedback.confirm({ title: rescueForm.id ? 'Save Fresh Rescue deal?' : 'Create Fresh Rescue deal?', description: relationSummary('rescue'), confirmLabel: rescueForm.id ? 'Save deal' : 'Create deal' })) return
    const values = { batch_id: rescueForm.batchId, title: rescueForm.title.trim(), description: rescueForm.description.trim() || null, original_price: original, rescue_price: Number(rescueForm.rescuePrice), start_at: new Date(rescueForm.startAt).toISOString(), end_at: new Date(rescueForm.endAt).toISOString() }
    const result = rescueForm.id
      ? await supabase.from('fresh_rescue_deals').update(values).eq('deal_id', rescueForm.id).select('deal_id').single()
      : await supabase.from('fresh_rescue_deals').insert(values).select('deal_id').single()
    if (result.error) return feedback.error(catalogErrorMessage(result.error))
    await invalidate(); closeDrawer(); feedback.success(rescueForm.id ? 'Fresh Rescue deal updated' : 'Fresh Rescue deal created')
  }
  const adjustInventory = async () => {
    const batch = data.data?.batches.find(item => item.batch_id === inventoryForm.batchId)
    if (!batch) return feedback.error('Select a valid batch')
    const nextQuantity = Number(inventoryForm.quantity)
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) return feedback.error('Inventory quantity must be zero or greater')
    const reasonText = inventoryForm.reason.replaceAll('_', ' ')
    if (!await feedback.confirm({ title: 'Adjust inventory?', message: `This creates an inventory audit transaction for ${reasonText}.`, confirmLabel: 'Adjust inventory' })) return
    const result = await supabase.rpc('adjust_inventory', { p_batch_id: batch.batch_id, p_new_quantity: nextQuantity, p_note: `[${reasonText}] ${inventoryForm.note.trim() || 'Manager inventory adjustment'}` })
    if (result.error) return feedback.error(catalogErrorMessage(result.error))
    await invalidate(); closeDrawer(); feedback.success('Inventory updated')
  }
  const uploadProductFormImage = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return feedback.error('Product image must be an image file')
    clearProductImageSelection()
    setProductImageFile(file)
    setProductImagePreview(URL.createObjectURL(file))
    feedback.success('Image selected. Save the product to upload it.')
  }
  const generateQr = async (batchId: string) => {
    try { await callFunction('generate-batch-qr', { batchId }); feedback.success('Batch QR is ready'); await invalidate() } catch (error) { feedback.error(String(error)) }
  }
  const toggleRecord = async (table: 'products' | 'batches' | 'fresh_rescue_deals', idColumn: string, id: string, values: Record<string, unknown>) => {
    if (!await feedback.confirm({ title: 'Apply this change?', description: 'This is a soft status update. Related order, inventory, report and chat history remains preserved by database constraints.', confirmLabel: 'Apply change' })) return
    const result = await supabase.from(table).update(values).eq(idColumn, id).select(idColumn).single()
    if (result.error) feedback.error(catalogErrorMessage(result.error))
    else { await invalidate(); feedback.success('Record updated') }
  }
  const deleteRecord = async (
    table: 'suppliers' | 'categories' | 'products' | 'batches' | 'prices' | 'fresh_rescue_deals',
    _idColumn: string,
    id: string,
    label: string,
  ) => {
    const entity = table === 'fresh_rescue_deals' ? 'rescue' : table.slice(0, -1)
    if (!await feedback.confirm({
      title: `Delete ${label}?`,
      description: 'FreshTrace will only delete this record when no order, inventory, price, traceability, approval, or audit record still depends on it. Otherwise the record will be kept and the blocking relationship will be reported.',
      confirmLabel: 'Delete',
      danger: true,
    })) return
    const result = await supabase.rpc('delete_catalog_record', { p_entity: entity, p_id: id })
    if (result.error) {
      return feedback.error(catalogErrorMessage(result.error))
    }
    await invalidate()
    feedback.success(`${label} deleted`)
  }

  if (data.isLoading) return <LoadingState />
  if (data.error) return <ErrorState error={data.error} />
  const d = data.data!
  const actionLabel = section === 'inventory' ? 'Adjust inventory' : `Create ${section === 'rescue' ? 'deal' : section.slice(0, -1)}`
  const filterOptions = staticFilterOptions[section] ?? []

  return <div>
    <PageHeader eyebrow="Supply" title="Catalog and inventory" actions={<button className="btn-primary" onClick={() => openCreate(section)}><Plus size={18}/>{actionLabel}</button>}/>
    <nav className="card mt-6 flex flex-wrap gap-2 p-2">{sections.map(item => <button key={item} onClick={() => { setStatus(''); setQuery(''); navigate(`/manager/catalog/${item}`) }} className={`rounded-xl px-4 py-2 text-sm font-bold capitalize ${section === item ? 'bg-brand-600 text-white' : 'hover:bg-brand-50'}`}>{item}</button>)}</nav>
    <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">You can deactivate or delete catalog records. Delete is available only when the record has no dependent order, inventory, price, traceability, approval, or audit history.</p>
    <div className="card mt-4 grid gap-3 p-4 md:grid-cols-[1fr_220px]"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35" size={18}/><input className="input" style={{ paddingLeft: '2.75rem' }} value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${section}`}/></label><select className="input" value={status} onChange={event => setStatus(event.target.value)}><option value="">All {sectionFilterLabels[section]}s</option>{filterOptions.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></div>

    {section === 'suppliers' && <DataGrid headers={['Supplier','Address','Certificate','Status','Actions']}>{d.suppliers.filter(item => matches(`${item.name} ${item.address ?? ''}`, item.status)).map(item => <tr key={item.supplier_id} className="border-b last:border-0"><td className="p-4"><b>{item.name}</b><small className="block text-black/45">{item.description}</small></td><td>{item.address ?? '-'}</td><td>{item.certificate ?? '-'}</td><td><Badge tone={item.status === 'approved' ? 'green' : item.status === 'rejected' ? 'red' : 'orange'}>{item.status}</Badge></td><td><div className="flex flex-wrap gap-3"><button className="font-bold text-brand-700" onClick={() => { setSupplierForm({ id: item.supplier_id, name: item.name, address: item.address ?? '', certificate: item.certificate ?? '', description: item.description ?? '' }); setDrawer('suppliers') }}><Edit3 className="mr-1 inline" size={15}/>Edit</button><button className="font-bold text-red-700" onClick={() => deleteRecord('suppliers', 'supplier_id', item.supplier_id, 'supplier')}><Trash2 className="mr-1 inline" size={15}/>Delete</button></div></td></tr>)}</DataGrid>}
    {section === 'categories' && <DataGrid headers={['Name','Description','Status','Actions']}>{d.categories.filter(item => matches(item.name, item.status)).map(item => <tr key={item.category_id} className="border-b last:border-0"><td className="p-4 font-bold">{item.name}</td><td>{item.description ?? '-'}</td><td><Badge tone={item.status === 'active' ? 'green' : 'gray'}>{item.status}</Badge></td><td><div className="flex flex-wrap gap-3"><button className="font-bold text-brand-700" onClick={() => { setCategoryForm({ id: item.category_id, name: item.name, description: item.description ?? '', status: item.status }); setDrawer('categories') }}>Edit</button><button className="font-bold text-orange-700" onClick={() => { setCategoryForm({ id: item.category_id, name: item.name, description: item.description ?? '', status: item.status === 'active' ? 'inactive' : 'active' }); setDrawer('categories') }}>{item.status === 'active' ? 'Deactivate' : 'Activate'}</button><button className="font-bold text-red-700" onClick={() => deleteRecord('categories', 'category_id', item.category_id, 'category')}>Delete</button></div></td></tr>)}</DataGrid>}
    {section === 'products' && <DataGrid headers={['Product','Category','Supplier','Unit','Status','Actions']}>{d.products.filter(item => matches(`${item.name} ${item.categories?.name ?? ''} ${item.suppliers?.name ?? ''}`, item.status)).map(item => <tr key={item.product_id} className="border-b last:border-0"><td className="p-4"><div className="flex items-center gap-3"><ProductImage name={item.name} source={item.image_url} className="h-12 w-12 rounded-xl object-cover"/><b>{item.name}</b></div></td><td>{item.categories?.name ?? '-'}</td><td>{item.suppliers?.name ?? '-'}</td><td>{item.unit}</td><td><Badge tone={item.status === 'active' ? 'green' : 'gray'}>{item.status}</Badge></td><td><div className="flex flex-wrap gap-3"><button className="font-bold text-brand-700" onClick={() => { clearProductImageSelection(); setProductForm({ id: item.product_id, name: item.name, categoryId: item.category_id ?? '', supplierId: item.supplier_id ?? '', unit: item.unit, description: item.description ?? '', certificate: item.certificate ?? '', imageUrl: item.image_url ?? '', status: item.status }); setDrawer('products') }}>Edit</button><button className="font-bold text-orange-700" onClick={() => toggleRecord('products', 'product_id', item.product_id, { status: item.status === 'active' ? 'inactive' : 'active' })}>{item.status === 'active' ? 'Deactivate' : 'Activate'}</button><button className="font-bold text-red-700" onClick={() => deleteRecord('products', 'product_id', item.product_id, 'product')}>Delete</button></div></td></tr>)}</DataGrid>}
    {section === 'batches' && <DataGrid headers={['Batch','Product','Expiry','Available','Reserved','Status','Actions']}>{d.batches.filter(item => matches(`${item.batch_code} ${item.products.name}`, item.status)).map(item => <tr key={item.batch_id} className="border-b last:border-0"><td className="p-4 font-bold">{item.batch_code}</td><td>{item.products.name}</td><td>{date(item.expire_date)}</td><td>{item.inventory?.quantity_available ?? 0}</td><td>{item.inventory?.quantity_reserved ?? 0}</td><td><Badge tone={item.status === 'available' ? 'green' : 'orange'}>{item.status}</Badge></td><td><div className="flex flex-wrap gap-3"><button className="font-bold text-brand-700" onClick={() => { setBatchForm({ id: item.batch_id, productId: item.product_id, batchCode: item.batch_code, harvestDate: item.harvest_date, expireDate: item.expire_date, quantity: String(item.quantity), origin: item.origin_location ?? '', status: item.status }); setDrawer('batches') }}>Edit</button><button className="font-bold text-orange-700" onClick={() => toggleRecord('batches', 'batch_id', item.batch_id, { status: item.status === 'locked' ? 'available' : 'locked' })}>{item.status === 'locked' ? 'Unlock' : 'Lock'}</button><button className="font-bold text-brand-700" onClick={() => generateQr(item.batch_id)}><QrCode className="mr-1 inline" size={15}/>Generate</button><BatchQrButton batchId={item.batch_id} batchCode={item.batch_code} label="Show QR"/><button className="font-bold text-red-700" onClick={() => deleteRecord('batches', 'batch_id', item.batch_id, 'batch')}>Delete</button></div></td></tr>)}</DataGrid>}
    {section === 'prices' && <DataGrid headers={['Product / Batch','Type','Period','Price','Actions']}>{d.prices.filter(item => matches(`${item.products.name} ${item.batches?.batch_code ?? ''}`, item.price_type)).map(item => <tr key={item.price_id} className="border-b last:border-0"><td className="p-4"><b>{item.products.name}</b><small className="block">{item.batches?.batch_code ?? 'Default'}</small></td><td>{item.price_type}</td><td>{item.start_date} - {item.end_date ?? 'open'}</td><td>{currency.format(item.price)}</td><td><div className="flex gap-3"><button className="font-bold text-brand-700" onClick={() => { setPriceForm({ id: item.price_id, batchId: item.batch_id ?? '', price: String(item.price), priceType: item.price_type, startDate: item.start_date, endDate: item.end_date ?? '' }); setDrawer('prices') }}>Edit</button><button className="font-bold text-red-700" onClick={() => deleteRecord('prices', 'price_id', item.price_id, 'price')}>Delete</button></div></td></tr>)}</DataGrid>}
    {section === 'rescue' && <DataGrid headers={['Deal','Price','Period','Status','Actions']}>{d.deals.filter(item => matches(`${item.title} ${item.batches.batch_code}`, item.status)).map(item => <tr key={item.deal_id} className="border-b last:border-0"><td className="p-4"><b>{item.title}</b><small className="block">{item.batches.batch_code}</small></td><td><s className="text-black/40">{currency.format(item.original_price)}</s><b className="ml-2 text-brand-700">{currency.format(item.rescue_price)}</b></td><td>{date(item.start_at)} - {date(item.end_at)}</td><td><Badge tone={item.status === 'active' ? 'green' : 'gray'}>{item.status}</Badge></td><td><div className="flex flex-wrap gap-3"><button className="font-bold text-brand-700" onClick={() => { setRescueForm({ id: item.deal_id, batchId: item.batch_id, title: item.title, description: item.description ?? '', originalPrice: String(item.original_price), rescuePrice: String(item.rescue_price), startAt: item.start_at.slice(0, 16), endAt: item.end_at.slice(0, 16) }); setDrawer('rescue') }}>Edit</button><button className="font-bold text-orange-700" onClick={() => toggleRecord('fresh_rescue_deals', 'deal_id', item.deal_id, { status: item.status === 'active' ? 'inactive' : 'active' })}>{item.status === 'active' ? 'Deactivate' : 'Activate'}</button><button className="font-bold text-red-700" onClick={() => deleteRecord('fresh_rescue_deals', 'deal_id', item.deal_id, 'Fresh Rescue deal')}>Delete</button></div></td></tr>)}</DataGrid>}
    {section === 'inventory' && <><DataGrid headers={['Batch','Product','Available','Reserved','Status','Actions']}>{d.batches.filter(item => matches(`${item.batch_code} ${item.products.name}`, item.status)).map(item => <tr key={item.batch_id} className="border-b last:border-0"><td className="p-4 font-bold">{item.batch_code}</td><td>{item.products.name}</td><td>{item.inventory?.quantity_available ?? 0}</td><td>{item.inventory?.quantity_reserved ?? 0}</td><td><Badge tone={item.status === 'available' ? 'green' : 'orange'}>{item.status}</Badge></td><td><button className="font-bold text-brand-700" onClick={() => { setInventoryForm({ batchId: item.batch_id, quantity: String(item.inventory?.quantity_available ?? 0), reason: 'stock_count', note: `Stock count for ${item.batch_code}` }); setDrawer('inventory') }}>Edit stock</button></td></tr>)}</DataGrid><section className="mt-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-black">Inventory audit history</h2><p className="text-sm text-black/50">Search by batch, product, or note and filter by transaction type.</p></div><div className="grid gap-2 sm:grid-cols-[minmax(240px,1fr)_180px]"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35" size={18}/><input className="input" style={{ paddingLeft: '2.75rem' }} value={auditQuery} onChange={event => setAuditQuery(event.target.value)} placeholder="Search audit history"/></label><select className="input" value={auditType} onChange={event => setAuditType(event.target.value)}><option value="">All transaction types</option>{[...new Set(d.transactions.map(item => item.type))].sort().map(type => <option key={type}>{type}</option>)}</select></div></div><DataGrid headers={['Batch','Product','Type','Quantity','Note','Created']}>{d.transactions.filter(item => (!auditQuery || `${item.batches.batch_code} ${item.batches.products.name} ${item.note ?? ''}`.toLowerCase().includes(auditQuery.toLowerCase())) && (!auditType || item.type === auditType)).map(item => <tr key={item.transaction_id} className="border-b last:border-0"><td className="p-4 font-bold">{item.batches.batch_code}</td><td>{item.batches.products.name}</td><td><Badge>{item.type}</Badge></td><td>{item.quantity}</td><td>{item.note ?? '-'}</td><td>{date(item.created_at)}</td></tr>)}</DataGrid></section></>}

    {drawer && <DrawerPanel title={drawer === 'inventory' ? 'Adjust inventory' : `${drawer === 'rescue' ? rescueForm.id ? 'Edit Fresh Rescue deal' : 'Create Fresh Rescue deal' : (drawer === 'prices' ? priceForm.id ? 'Edit price' : 'Create price' : drawer.slice(0, -1).replace(/^./, c => c.toUpperCase()) + (drawer === 'products' ? productForm.id ? ' editor' : ' editor' : drawer === 'batches' ? batchForm.id ? ' editor' : ' editor' : ' form'))}`} onClose={closeDrawer}>
      {drawer === 'suppliers' && <FormShell onSubmit={saveSupplier}><input className="input" required value={supplierForm.name} onChange={e => setSupplierForm(v => ({ ...v, name: e.target.value }))} placeholder="Supplier name"/><input className="input" value={supplierForm.address} onChange={e => setSupplierForm(v => ({ ...v, address: e.target.value }))} placeholder="Address"/><input className="input" value={supplierForm.certificate} onChange={e => setSupplierForm(v => ({ ...v, certificate: e.target.value }))} placeholder="Certificate code or URL"/><textarea className="input" value={supplierForm.description} onChange={e => setSupplierForm(v => ({ ...v, description: e.target.value }))} placeholder="Description"/><SubmitRow label={supplierForm.id ? 'Save supplier' : 'Create supplier'} onCancel={closeDrawer}/></FormShell>}
      {drawer === 'categories' && <FormShell onSubmit={saveCategory}><input className="input" required value={categoryForm.name} onChange={e => setCategoryForm(v => ({ ...v, name: e.target.value }))} placeholder="Category name"/><select className="input" value={categoryForm.status} onChange={e => setCategoryForm(v => ({ ...v, status: e.target.value }))}><option value="active">Active</option><option value="inactive">Inactive</option></select><textarea className="input" value={categoryForm.description} onChange={e => setCategoryForm(v => ({ ...v, description: e.target.value }))} placeholder="Description"/><SubmitRow label={categoryForm.id ? 'Save category' : 'Create category'} onCancel={closeDrawer}/></FormShell>}
      {drawer === 'products' && <FormShell onSubmit={saveProduct}><input className="input" required value={productForm.name} onChange={e => setProductForm(v => ({ ...v, name: e.target.value }))} placeholder="Product name"/><input className="input" required value={productForm.unit} onChange={e => setProductForm(v => ({ ...v, unit: e.target.value }))} placeholder="Unit"/><select className="input" required value={productForm.categoryId} onChange={e => setProductForm(v => ({ ...v, categoryId: e.target.value }))}><option value="">Category</option>{d.categories.filter(c => c.status === 'active' || c.category_id === productForm.categoryId).map(c => <option key={c.category_id} value={c.category_id}>{c.name}{c.status !== 'active' ? ' (inactive)' : ''}</option>)}</select><select className="input" required value={productForm.supplierId} onChange={e => setProductForm(v => ({ ...v, supplierId: e.target.value }))}><option value="">Approved supplier</option>{d.suppliers.filter(s => s.status === 'approved' || s.supplier_id === productForm.supplierId).map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.name}{s.status !== 'approved' ? ` (${s.status})` : ''}</option>)}</select><label className="btn-secondary cursor-pointer justify-center"><Camera size={18}/>{uploadingImage ? 'Uploading image...' : productImagePreview || productForm.imageUrl ? 'Change image' : 'Upload image from computer'}<input className="hidden" type="file" accept="image/*" onChange={e => uploadProductFormImage(e.target.files?.[0])}/></label>{(productImagePreview || productForm.imageUrl) && <img src={productImagePreview || productForm.imageUrl} alt="" className="h-36 w-full rounded-2xl object-cover"/>}<input className="input" value={productForm.certificate} onChange={e => setProductForm(v => ({ ...v, certificate: e.target.value }))} placeholder="Certificate"/><select className="input" value={productForm.status} onChange={e => setProductForm(v => ({ ...v, status: e.target.value }))}><option value="active">Active</option><option value="inactive">Inactive</option></select><textarea className="input" rows={4} value={productForm.description} onChange={e => setProductForm(v => ({ ...v, description: e.target.value }))} placeholder="Description"/><SubmitRow label={productForm.id ? 'Save product' : 'Create product'} onCancel={closeDrawer}/></FormShell>}
      {drawer === 'batches' && <FormShell onSubmit={saveBatch}><select className="input disabled:bg-black/5" required disabled={Boolean(batchForm.id)} value={batchForm.productId} onChange={e => setBatchForm(v => ({ ...v, productId: e.target.value }))}><option value="">Product</option>{d.products.filter(p => p.status === 'active' || p.product_id === batchForm.productId).map(p => <option key={p.product_id} value={p.product_id}>{p.name}{p.status !== 'active' ? ' (inactive)' : ''}</option>)}</select>{batchForm.id && <p className="-mt-2 text-xs text-black/50">A batch product cannot be changed after creation because inventory, prices, traceability and order history reference it.</p>}<input className="input" required value={batchForm.batchCode} onChange={e => setBatchForm(v => ({ ...v, batchCode: e.target.value }))} placeholder="Batch code"/><input className="input" required min={0} type="number" value={batchForm.quantity} onChange={e => setBatchForm(v => ({ ...v, quantity: e.target.value }))} placeholder="Quantity"/><label className="text-sm font-bold">Harvest date<input className="input mt-1" required type="date" value={batchForm.harvestDate} onChange={e => setBatchForm(v => ({ ...v, harvestDate: e.target.value }))}/></label><label className="text-sm font-bold">Expiry date<input className="input mt-1" required type="date" value={batchForm.expireDate} onChange={e => setBatchForm(v => ({ ...v, expireDate: e.target.value }))}/></label><input className="input" value={batchForm.origin} onChange={e => setBatchForm(v => ({ ...v, origin: e.target.value }))} placeholder="Origin"/><select className="input" value={batchForm.status} onChange={e => setBatchForm(v => ({ ...v, status: e.target.value }))}><option value="available">Available</option><option value="near_expiry">Near expiry</option><option value="locked">Locked</option><option value="sold_out">Sold out</option><option value="expired">Expired</option></select><SubmitRow label={batchForm.id ? 'Save batch' : 'Create batch'} onCancel={closeDrawer}/></FormShell>}
      {drawer === 'prices' && <FormShell onSubmit={savePrice}><select className="input" required value={priceForm.batchId} onChange={e => setPriceForm(v => ({ ...v, batchId: e.target.value }))}><option value="">Batch</option>{d.batches.map(b => <option key={b.batch_id} value={b.batch_id}>{b.batch_code} / {b.products.name}</option>)}</select><input className="input" required min={0} type="number" value={priceForm.price} onChange={e => setPriceForm(v => ({ ...v, price: e.target.value }))} placeholder="Price"/><select className="input" value={priceForm.priceType} onChange={e => setPriceForm(v => ({ ...v, priceType: e.target.value }))}><option value="normal">Normal</option><option value="promotion">Promotion</option>{priceForm.priceType === 'rescue' && <option value="rescue" disabled>Rescue</option>}</select><label className="text-sm font-bold">Start date<input className="input mt-1" type="date" value={priceForm.startDate} onChange={e => setPriceForm(v => ({ ...v, startDate: e.target.value }))}/></label><label className="text-sm font-bold">End date<input className="input mt-1" type="date" value={priceForm.endDate} onChange={e => setPriceForm(v => ({ ...v, endDate: e.target.value }))}/></label><SubmitRow label={priceForm.id ? 'Save price' : 'Create price'} onCancel={closeDrawer}/></FormShell>}
      {drawer === 'rescue' && <FormShell onSubmit={saveRescue}><select className="input" required value={rescueForm.batchId} onChange={e => setRescueForm(v => ({ ...v, batchId: e.target.value, originalPrice: String(currentBatchPrice(e.target.value) ?? '') }))}><option value="">Batch</option>{d.batches.map(b => <option key={b.batch_id} value={b.batch_id}>{b.batch_code} / {b.products.name}</option>)}</select><input className="input" required value={rescueForm.title} onChange={e => setRescueForm(v => ({ ...v, title: e.target.value }))} placeholder="Deal title"/><textarea className="input" value={rescueForm.description} onChange={e => setRescueForm(v => ({ ...v, description: e.target.value }))} placeholder="Description"/><label className="text-sm font-bold">Original price from Prices<input className="input mt-1 bg-black/5" readOnly value={String(currentBatchPrice(rescueForm.batchId) ?? rescueForm.originalPrice)} placeholder="Select a batch with an active price"/></label><input className="input" required min={0} type="number" value={rescueForm.rescuePrice} onChange={e => setRescueForm(v => ({ ...v, rescuePrice: e.target.value }))} placeholder="Rescue price"/><label className="text-sm font-bold">Starts at<input className="input mt-1" type="datetime-local" value={rescueForm.startAt} onChange={e => setRescueForm(v => ({ ...v, startAt: e.target.value }))}/></label><label className="text-sm font-bold">Ends at<input className="input mt-1" type="datetime-local" value={rescueForm.endAt} onChange={e => setRescueForm(v => ({ ...v, endAt: e.target.value }))}/></label><SubmitRow label={rescueForm.id ? 'Save deal' : 'Create deal'} onCancel={closeDrawer}/></FormShell>}
      {drawer === 'inventory' && <FormShell onSubmit={adjustInventory}><select className="input" required value={inventoryForm.batchId} onChange={e => setInventoryForm(v => ({ ...v, batchId: e.target.value }))}><option value="">Batch</option>{d.batches.map(b => <option key={b.batch_id} value={b.batch_id}>{b.batch_code} / {b.products.name}</option>)}</select><select className="input" value={inventoryForm.reason} onChange={e => setInventoryForm(v => ({ ...v, reason: e.target.value as InventoryReason }))}><option value="stock_count">Stock count correction</option><option value="import">Import received</option><option value="export">Manual export</option><option value="reserve">Reservation correction</option><option value="release">Release correction</option></select><input className="input" required min={0} type="number" value={inventoryForm.quantity} onChange={e => setInventoryForm(v => ({ ...v, quantity: e.target.value }))} placeholder="New available quantity"/><textarea className="input" value={inventoryForm.note} onChange={e => setInventoryForm(v => ({ ...v, note: e.target.value }))} placeholder="Adjustment note"/><SubmitRow label="Adjust inventory" onCancel={closeDrawer}/></FormShell>}
    </DrawerPanel>}
  </div>
}

function DataGrid({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <section className="card mt-6 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b bg-black/[0.02]"><tr>{headers.map((header, index) => <th key={header} className={index === 0 ? 'p-4' : ''}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></section>
}

function DrawerPanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-sm" role="dialog" aria-modal="true"><aside className="h-full w-full max-w-xl animate-[slideIn_.22s_ease-out] overflow-y-auto bg-white p-5 shadow-2xl"><div className="mb-5 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-brand-700">Manager catalog</p><h2 className="text-2xl font-black">{title}</h2></div><button className="rounded-xl p-2 hover:bg-black/5" onClick={onClose} aria-label="Close form"><X size={22}/></button></div>{children}</aside><style>{'@keyframes slideIn{from{transform:translateX(-100%);opacity:.7}to{transform:translateX(0);opacity:1}}'}</style></div>
}

function FormShell({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return <form className="grid gap-4" onSubmit={event => { event.preventDefault(); onSubmit() }}>{children}</form>
}

function SubmitRow({ label, onCancel }: { label: string; onCancel: () => void }) {
  return <div className="sticky bottom-0 -mx-5 mt-2 flex gap-3 border-t bg-white/95 p-5 backdrop-blur"><button className="btn-primary flex-1"><PackagePlus size={18}/>{label}</button><button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button></div>
}
