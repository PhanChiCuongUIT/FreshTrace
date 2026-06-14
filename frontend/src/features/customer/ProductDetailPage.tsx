import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, MessageCircle, ShoppingCart, Star } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { Badge } from '../../components/Page'
import { currency, date, dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { CatalogProduct } from '../../lib/types'
import { useAuth } from '../auth/auth-context'
import { useQueryClient } from '@tanstack/react-query'
import { useFeedback } from '../../components/Feedback'
import { BatchQrButton } from '../../components/BatchQrButton'
import { ProductImage } from '../../components/ProductImage'

type Review = { review_id: string; rating: number; comment: string | null; created_at: string; users: { name: string } }

export function ProductDetailPage() {
  const { productId } = useParams()
  const { profile, role } = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { toast } = useFeedback()
  const detail = useQuery({ queryKey: ['product-detail', productId], queryFn: async () => {
    const [catalog, reviews] = await Promise.all([
      supabase.rpc('search_products', { p_limit: 100, p_offset: 0 }),
      supabase.from('reviews').select('review_id,rating,comment,created_at,users(name)').eq('product_id', productId!).order('created_at', { ascending: false }),
    ])
    if (catalog.error) throw catalog.error
    if (reviews.error) throw reviews.error
    const product = (catalog.data as CatalogProduct[]).find(item => item.product_id === productId)
    if (!product) throw new Error('Product is unavailable or not found')
    return { product, reviews: reviews.data as unknown as Review[] }
  }})
  if (detail.isLoading) return <LoadingState/>
  if (detail.error) return <ErrorState error={detail.error}/>
  const product = detail.data!.product
  const add = async () => {
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
  return <div><Link to="/products" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700"><ArrowLeft size={17}/> Back to products</Link><div className="mt-5 grid gap-6 lg:grid-cols-2"><div className="card min-h-72 overflow-hidden bg-brand-50"><ProductImage name={product.product_name} source={product.image_url} className="h-full min-h-72 w-full object-cover"/></div><section className="card p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-widest text-brand-700">{product.category_name}</p><h1 className="text-3xl font-black">{product.product_name}</h1><p className="text-black/50">{product.supplier_name}</p></div>{product.is_rescue && <Badge tone="orange">Rescue -{product.rescue_discount_percent}%</Badge>}</div><p className="mt-5">{product.description ?? 'No product description provided.'}</p><div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-black/[0.03] p-4"><div><small>Price</small><b className="block text-xl">{currency.format(product.current_price)}</b></div><div><small>Available</small><b className="block">{product.quantity_available} {product.unit}</b></div><div><small>Batch</small><b className="block">{product.batch_code}</b></div><div><small>Expires</small><b className="block">{date(product.expire_date)}</b></div><div><small>Origin</small><b className="block">{product.origin_location ?? '-'}</b></div><div><small>Certificate</small><b className="block">{product.certificate ?? '-'}</b></div></div><div className="mt-4 flex items-center gap-2"><Star fill="#f5b800" color="#f5b800"/><b>{product.average_rating}</b><span className="text-black/45">({product.review_count} reviews)</span></div><div className="mt-5 flex flex-wrap gap-3">{role === 'customer' && <button className="btn-primary" onClick={add}><ShoppingCart size={18}/> Add to cart</button>}<button className="btn-secondary" onClick={() => navigate(`/chat?shareProduct=${product.product_id}`)}><MessageCircle size={18}/> Share in chat</button><BatchQrButton batchId={product.batch_id} batchCode={product.batch_code} label="Check batch QR"/></div></section></div>
    <section className="mt-7"><h2 className="text-2xl font-black">Customer reviews</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{detail.data!.reviews.length ? detail.data!.reviews.map(review => <article className="card p-5" key={review.review_id}><div className="flex justify-between"><b>{review.users.name}</b><span className="font-bold text-amber-600">{review.rating}/5</span></div><p className="mt-2">{review.comment ?? 'No written comment.'}</p><small className="text-black/40">{dateTime(review.created_at)}</small></article>) : <p className="text-black/50">No reviews yet.</p>}</div></section>
  </div>
}
