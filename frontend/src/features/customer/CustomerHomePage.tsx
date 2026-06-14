import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bot, PackageCheck, QrCode, ShoppingBasket } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { supabase } from '../../lib/supabase'
import { currency, date } from '../../lib/format'
import type { CatalogProduct } from '../../lib/types'
import { ProductImage } from '../../components/ProductImage'

export function CustomerHomePage() {
  const { profile, role } = useAuth()
  const rescueDeals = useQuery({
    queryKey: ['home-rescue-deals'],
    queryFn: async () => {
      const result = await supabase.rpc('search_products', { p_rescue_only: true, p_limit: 3, p_offset: 0 })
      if (result.error) throw result.error
      return result.data as CatalogProduct[]
    },
  })
  const actions = [
    ['/products','Browse products','Fresh food with transparent batches',ShoppingBasket],
    ['/rescue','Fresh Rescue','Save near-expiry food at better prices',PackageCheck],
    ['/trace','Trace a batch','Verify origin and expiration by QR',QrCode],
    ['/assistant','Fresh Assistant','Find products for your needs',Bot],
  ] as const
  return <div><div className="rounded-3xl bg-[#173d28] p-7 text-white sm:p-10"><span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-widest">{role} workspace</span><h1 className="mt-5 max-w-2xl text-3xl font-black sm:text-5xl">Good food starts with clear information.</h1><p className="mt-4 max-w-xl text-white/65">Welcome back, {profile?.name}. Shop verified produce, trace every batch, and coordinate in real time.</p><Link to="/products" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-[#173d28]">Explore marketplace <ArrowRight size={18}/></Link></div><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{actions.map(([to,title,text,Icon])=><Link key={to} to={to} className="card p-5 transition hover:-translate-y-1"><Icon className="text-brand-600"/><h2 className="mt-5 font-bold">{title}</h2><p className="mt-1 text-sm text-black/50">{text}</p></Link>)}</div>
    {Boolean(rescueDeals.data?.length) && <section className="mt-9"><div className="flex items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-widest text-orange-700">Waste less</p><h2 className="text-2xl font-black">Fresh Rescue today</h2></div><Link to="/rescue" className="flex shrink-0 items-center gap-1 text-sm font-bold text-brand-700">View all <ArrowRight size={16}/></Link></div><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rescueDeals.data?.map(product => <Link key={product.product_id} to={`/products/${product.product_id}`} className="card flex min-w-0 flex-col overflow-hidden transition hover:-translate-y-1"><div className="relative h-44 shrink-0 overflow-hidden bg-gradient-to-br from-orange-50 to-brand-50"><ProductImage name={product.product_name} source={product.image_url} className="absolute inset-0 h-full w-full object-cover"/></div><div className="flex min-w-0 flex-1 flex-col p-4"><div className="flex min-w-0 items-start justify-between gap-3"><b className="min-w-0 flex-1 truncate">{product.product_name}</b><span className="shrink-0 rounded-full bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">-{product.rescue_discount_percent}%</span></div><p className="mt-1 truncate text-sm text-black/45">{product.supplier_name}</p><div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-3"><strong className="whitespace-nowrap text-lg">{currency.format(product.current_price)}</strong><small className="whitespace-nowrap text-black/45">Expires {date(product.expire_date)}</small></div></div></Link>)}</div></section>}
  </div>
}
