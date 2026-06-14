import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bot, ShoppingCart } from 'lucide-react'
import { PageHeader } from '../../components/Page'
import { callFunction } from '../../lib/api'
import { currency, date } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/auth-context'
import { useFeedback } from '../../components/Feedback'
import { ProductImage } from '../../components/ProductImage'

type Recommendation = { productId: string; batchId: string; name: string; unit: string; imageUrl: string | null; category: string; expireDate: string; currentPrice: number; certificate: string | null; isRescue: boolean; rescueDiscountPercent: number | null }
type AdminInsight = { title: string; description: string; value: string | number; tone?: 'green' | 'orange' | 'red' | 'blue' | 'gray'; href?: string }
type Answer = { answer: string; intent: string; recommendations: Recommendation[]; insights?: AdminInsight[] }

function cleanAssistantText(value: string) {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(?:^|\s)[*-]\s+/g, '\n')
    .replace(/\s*(\d+\.\s+)/g, '\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function displayInsightValue(item: AdminInsight) {
  if (typeof item.value !== 'number') return item.value
  const title = item.title.toLowerCase()
  if (title.includes('revenue') || title.includes('value')) return currency.format(item.value)
  return item.value.toLocaleString('en-US')
}

export function AssistantPage() {
  const { profile, role } = useAuth()
  const client = useQueryClient()
  const feedback = useFeedback()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(false)
  const ask = async () => { setLoading(true); try { setAnswer(await callFunction<Answer>('fresh-assistant', { question })) } catch (error) { feedback.error(String(error)) } finally { setLoading(false) } }
  const addToCart = async (item: Recommendation) => {
    const cart = await supabase.from('carts').select('cart_id').eq('user_id', profile!.user_id).single()
    if (cart.error) return feedback.error(cart.error.message)
    const existing = await supabase.from('cart_items').select('cart_item_id,quantity').eq('cart_id', cart.data.cart_id).eq('batch_id', item.batchId).maybeSingle()
    if (existing.error) return feedback.error(existing.error.message)
    const result = existing.data
      ? await supabase.from('cart_items').update({ quantity: existing.data.quantity + 1 }).eq('cart_item_id', existing.data.cart_item_id).select('cart_item_id').single()
      : await supabase.from('cart_items').insert({ cart_id: cart.data.cart_id, product_id: item.productId, batch_id: item.batchId, quantity: 1 }).select('cart_item_id').single()
    if (result.error) feedback.error(result.error.message)
    else {
      client.invalidateQueries({ queryKey: ['cart'] })
      feedback.success(`${item.name} added to cart`)
    }
  }
  const adminMode = role === 'admin'
  const prompts = adminMode
    ? ['Find banned users', 'Show pending reports', 'Finance payment risks', 'Monitoring low stock', 'Supplier approvals waiting', 'Revenue overview']
    : ['Cheapest rice', 'Fresh meat', 'Certified vegetables', 'Fruit with long shelf life', 'Mushrooms expiring soon', 'Best Fresh Rescue deals']
  return <div><PageHeader eyebrow="Decision support" title="Fresh Assistant" />
    <div className="card mt-6 p-6"><div className="flex gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700"><Bot /></div><div><h2 className="font-black">Ask using natural language</h2><p className="text-sm text-black/50">Recommendations only use products currently available in FreshTrace.</p></div></div>
      <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={event => { event.preventDefault(); ask() }}><input className="input" minLength={3} required placeholder={adminMode ? 'Find users, reports, finance risks, or monitoring issues' : 'Show the cheapest products or products expiring soon'} value={question} onChange={event => setQuestion(event.target.value)} /><button disabled={loading} className="btn-primary">{loading ? 'Thinking...' : 'Ask'}</button></form>
      <div className="mt-3 flex flex-wrap gap-2">{prompts.map(value => <button key={value} type="button" className="rounded-full bg-black/[0.04] px-3 py-1.5 text-xs font-semibold hover:bg-brand-50 hover:text-brand-700" onClick={() => setQuestion(value)}>{value}</button>)}</div>
    </div>
    {answer && <div className="mt-6"><div className="mb-4 rounded-xl bg-brand-50 p-4"><p className="whitespace-pre-line text-sm leading-7 text-black/70">{cleanAssistantText(answer.answer)}</p></div>{adminMode ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{answer.insights?.map((item, index) => <article key={`${item.title}:${index}`} className="card p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{item.title}</h3><p className="mt-1 text-sm text-black/55">{item.description}</p></div><span className={`rounded-full px-3 py-1 text-sm font-black ${item.tone === 'red' ? 'bg-red-100 text-red-700' : item.tone === 'orange' ? 'bg-orange-100 text-orange-700' : item.tone === 'blue' ? 'bg-blue-100 text-blue-700' : item.tone === 'green' ? 'bg-green-100 text-green-700' : 'bg-black/5 text-black/60'}`}>{displayInsightValue(item)}</span></div>{item.href && <Link className="btn-secondary mt-4 py-2" to={item.href}>Open workspace</Link>}</article>)}</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{answer.recommendations.map(item => <article key={`${item.productId}:${item.batchId}`} className="card overflow-hidden"><Link to={`/products/${item.productId}`} className="block h-40 bg-gradient-to-br from-brand-50 to-orange-50"><ProductImage name={item.name} source={item.imageUrl} className="h-full w-full object-cover"/></Link><div className="p-5"><div className="flex justify-between gap-3"><Link to={`/products/${item.productId}`} className="font-black hover:text-brand-700">{item.name}</Link>{item.isRescue && <span className="text-sm font-bold text-orange-600">-{item.rescueDiscountPercent}%</span>}</div><p className="text-sm text-black/50">{item.category} / expires {date(item.expireDate)}</p><p className="mt-3 text-lg font-black">{currency.format(item.currentPrice)} / {item.unit}</p><p className="text-sm">{item.certificate ?? 'No certificate listed'}</p><div className="mt-4 grid grid-cols-2 gap-2"><Link className="btn-secondary py-2" to={`/products/${item.productId}`}>View details</Link><button className="btn-primary py-2" onClick={() => addToCart(item)}><ShoppingCart size={16}/> Add</button></div></div></article>)}</div>}</div>}
  </div>
}
