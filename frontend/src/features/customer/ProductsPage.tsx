import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, ShoppingCart, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { CatalogProduct } from '../../lib/types'
import { currency, date } from '../../lib/format'
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState'
import { useAuth } from '../auth/auth-context'
import { useFeedback } from '../../components/Feedback'
import { ProductImage } from '../../components/ProductImage'

export function ProductsPage({ rescueOnly = false }: { rescueOnly?: boolean }) {
  const { profile, role } = useAuth()
  const client = useQueryClient()
  const { toast } = useFeedback()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [certificate, setCertificate] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const categories = useQuery({ queryKey: ['categories'], queryFn: async () => {
    const result = await supabase.from('categories').select('category_id,name').eq('status', 'active').order('name')
    if (result.error) throw result.error
    return result.data
  }})
  const products = useQuery({
    queryKey: ['products', query, categoryId, certificate, maxPrice, rescueOnly],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_products', {
        p_query: query || null, p_category_id: categoryId || null, p_certificate: certificate || null,
        p_max_price: maxPrice ? Number(maxPrice) : null, p_rescue_only: rescueOnly, p_limit: 50, p_offset: 0,
      })
      if (error) throw error
      return data as CatalogProduct[]
    },
  })
  const add = async (product: CatalogProduct) => {
    if (role !== 'customer') return toast('Only Customer accounts can add products to a cart', 'error')
    const cart = await supabase.from('carts').select('cart_id').eq('user_id', profile!.user_id).single()
    if (cart.error) return toast(cart.error.message, 'error')
    const existing = await supabase.from('cart_items').select('cart_item_id,quantity').eq('cart_id', cart.data.cart_id).eq('batch_id', product.batch_id).maybeSingle()
    if (existing.error) return toast(existing.error.message, 'error')
    const result = existing.data
      ? await supabase.from('cart_items').update({ quantity: existing.data.quantity + 1 }).eq('cart_item_id', existing.data.cart_item_id).select('cart_item_id').single()
      : await supabase.from('cart_items').insert({ cart_id: cart.data.cart_id, product_id: product.product_id, batch_id: product.batch_id, quantity: 1 }).select('cart_item_id').single()
    if (result.error) return toast(result.error.message, 'error')
    await client.invalidateQueries({ queryKey: ['cart'] })
    toast('Added to cart')
  }
  return <div>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-widest text-brand-700">{rescueOnly ? 'Waste less' : 'Marketplace'}</p><h1 className="text-3xl font-black">{rescueOnly ? 'Fresh Rescue deals' : 'Verified fresh products'}</h1></div></div>
    <div className="card mt-5 grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35" size={18}/><input className="input" style={{ paddingLeft: '2.75rem' }} placeholder="Search products" value={query} onChange={event => setQuery(event.target.value)}/></label><select className="input" value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">All categories</option>{categories.data?.map(category => <option key={category.category_id} value={category.category_id}>{category.name}</option>)}</select><input className="input" placeholder="Certificate (VietGAP, Organic)" value={certificate} onChange={event => setCertificate(event.target.value)}/><input className="input" type="number" min="0" placeholder="Maximum price" value={maxPrice} onChange={event => setMaxPrice(event.target.value)}/></div>
    {products.isLoading ? <div className="mt-6"><LoadingState/></div> : products.error ? <div className="mt-6"><ErrorState error={products.error}/></div> : !products.data?.length ? <div className="mt-6"><EmptyState title="No products found"/></div> :
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{products.data.map(product => <article key={product.product_id} className="card flex min-w-0 flex-col overflow-hidden">
        <Link to={`/products/${product.product_id}`} className="relative block h-44 shrink-0 overflow-hidden bg-gradient-to-br from-brand-50 to-[#f1ead6] text-2xl font-black text-brand-700"><ProductImage name={product.product_name} source={product.image_url} className="absolute inset-0 h-full w-full object-cover"/></Link>
        <div className="flex flex-1 flex-col p-4 sm:p-5"><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><Link to={`/products/${product.product_id}`} className="block truncate font-bold hover:text-brand-700">{product.product_name}</Link><p className="truncate text-sm text-black/45">{product.supplier_name} / {product.category_name}</p></div>{product.is_rescue && <span className="shrink-0 rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-700">-{product.rescue_discount_percent}%</span>}</div>
          <div className="mt-4 flex items-center justify-between"><div><div className="text-lg font-black">{currency.format(product.current_price)}</div><div className="text-xs text-black/45">Expires {date(product.expire_date)} / {product.quantity_available} left</div></div><div className="flex items-center gap-1 text-sm"><Star size={15} fill="#f5b800" color="#f5b800"/>{product.average_rating}</div></div>
          {role === 'customer' && <button onClick={() => add(product)} className="btn-primary mt-4 w-full"><ShoppingCart size={17}/> Add to cart</button>}
        </div>
      </article>)}</div>}
  </div>
}
