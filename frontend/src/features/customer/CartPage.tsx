import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState'
import { PageHeader } from '../../components/Page'
import { callFunction } from '../../lib/api'
import { currency } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { CatalogProduct } from '../../lib/types'
import { useAuth } from '../auth/auth-context'
import { useFeedback } from '../../components/Feedback'

type CartItem = { cart_item_id: string; batch_id: string; quantity: number; note: string | null; products: { name: string; unit: string; image_url: string | null } }
type Coupon = { coupon_id: string; code: string; coupon_type: string; amount: number; remaining_amount: number; discount_percent: number | null; max_discount_amount: number | null; min_order_amount: number; expires_at: string | null; description: string | null }

export function CartPage() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const { confirm, toast } = useFeedback()
  const [address, setAddress] = useState(profile?.address ?? '')
  const [method, setMethod] = useState<'cod' | 'payos'>('cod')
  const [orderNote, setOrderNote] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const cart = useQuery({
    queryKey: ['cart', profile?.user_id],
    queryFn: async () => {
      const owner = await supabase.from('carts').select('cart_id').eq('user_id', profile!.user_id).single()
      if (owner.error) throw owner.error
      const [items, catalog] = await Promise.all([
        supabase.from('cart_items').select('cart_item_id,batch_id,quantity,note,products(name,unit,image_url)').eq('cart_id', owner.data.cart_id).order('created_at'),
        supabase.rpc('search_products', { p_limit: 100, p_offset: 0 }),
      ])
      if (items.error) throw items.error
      if (catalog.error) throw catalog.error
      const prices = new Map((catalog.data as CatalogProduct[]).map(item => [item.batch_id, item.current_price]))
      return (items.data as unknown as CartItem[]).map(item => ({ ...item, price: prices.get(item.batch_id) ?? 0 }))
    },
  })
  const total = useMemo(() => cart.data?.reduce((sum, item) => sum + item.price * item.quantity, 0) ?? 0, [cart.data])
  const coupons = useQuery({ queryKey: ['checkout-coupons', profile?.user_id], queryFn: async () => {
    const result = await supabase.from('coupons').select('coupon_id,code,coupon_type,amount,remaining_amount,discount_percent,max_discount_amount,min_order_amount,expires_at,description').eq('user_id', profile!.user_id).eq('status', 'active').gt('remaining_amount', 0).order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as Coupon[]
  }})
  const selectedCoupon = coupons.data?.find(coupon => coupon.code === couponCode)
  const deliveryFee = 20000
  const discount = selectedCoupon
    ? selectedCoupon.coupon_type === 'free_shipping'
      ? Math.min(deliveryFee, selectedCoupon.remaining_amount)
      : selectedCoupon.coupon_type === 'percent'
        ? Math.min(total * Number(selectedCoupon.discount_percent ?? 0) / 100, Number(selectedCoupon.max_discount_amount ?? selectedCoupon.remaining_amount), selectedCoupon.remaining_amount)
        : Math.min(selectedCoupon.remaining_amount, total + deliveryFee)
    : 0
  const update = async (id: string, quantity: number) => {
    if (quantity < 1 && !await confirm({ title: 'Remove this product?', description: 'The product and its shopping note will be removed from your cart.', confirmLabel: 'Remove', danger: true })) return
    const result = quantity < 1 ? await supabase.from('cart_items').delete().eq('cart_item_id', id) : await supabase.from('cart_items').update({ quantity }).eq('cart_item_id', id)
    if (result.error) toast(result.error.message, 'error')
    else { await client.invalidateQueries({ queryKey: ['cart'] }); toast(quantity < 1 ? 'Product removed from cart' : 'Cart quantity updated') }
  }
  const updateNote = async (id: string, note: string) => {
    const result = await supabase.from('cart_items').update({ note: note || null }).eq('cart_item_id', id)
    if (result.error) toast(result.error.message, 'error')
  }
  const checkout = useMutation({
    mutationFn: async () => {
      const approved = await confirm({
        title: 'Place this order?',
        description: `You are about to place an order worth ${currency.format(total + deliveryFee - discount)} using ${method === 'payos' ? 'payOS prepayment' : 'COD at delivery'}.`,
        confirmLabel: 'Place order',
      })
      if (!approved) throw new Error('Checkout cancelled')
      const result = await supabase.rpc('checkout_cart', { p_delivery_address: address, p_payment_method: method, p_delivery_fee: deliveryFee, p_note: orderNote || null, p_coupon_code: couponCode || null })
      if (result.error) throw result.error
      const orderId = result.data as string
      if (method === 'payos') {
        const localPayment = await supabase.from('payments').select('amount,status').eq('order_id', orderId).single()
        if (localPayment.error) throw localPayment.error
        if (Number(localPayment.data.amount) === 0 || localPayment.data.status === 'paid') {
          toast('Order paid in full by coupon')
          window.location.assign('/orders')
          return orderId
        }
        const payment = await callFunction<{ checkoutUrl?: string; paymentUrl?: string }>('create-payos-payment', { orderId })
        window.location.assign(payment.checkoutUrl ?? payment.paymentUrl ?? '/orders')
      }
      return orderId
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: ['cart'] }); if (method === 'cod') { toast('Order created successfully'); window.location.assign('/orders') } },
  })
  if (cart.isLoading) return <LoadingState />
  if (cart.error) return <ErrorState error={cart.error} />
  return <div><PageHeader eyebrow="Checkout" title="Your cart" />
    {!cart.data?.length ? <div className="mt-6"><EmptyState title="Your cart is empty">Add an available batch from the marketplace.</EmptyState></div> :
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">{cart.data.map(item => <div key={item.cart_item_id} className="card grid gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <div className="h-16 w-16 overflow-hidden rounded-xl bg-brand-50">{item.products.image_url && <img src={item.products.image_url} alt="" className="h-full w-full object-cover" />}</div>
          <div className="min-w-0"><h2 className="font-bold">{item.products.name}</h2><p className="text-sm text-black/50">{currency.format(item.price)} / {item.products.unit}</p><input className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2 text-sm" defaultValue={item.note ?? ''} onBlur={event => updateNote(item.cart_item_id, event.target.value)} placeholder="Shopping note, ripeness, replacement..."/></div>
          <div className="flex items-center gap-2"><button className="btn-secondary p-2" onClick={() => update(item.cart_item_id, item.quantity - 1)}><Minus size={15}/></button><b>{item.quantity}</b><button className="btn-secondary p-2" onClick={() => update(item.cart_item_id, item.quantity + 1)}><Plus size={15}/></button><button className="p-2 text-red-600" onClick={() => update(item.cart_item_id, 0)}><Trash2 size={17}/></button></div>
        </div>)}</div>
        <form className="card h-fit space-y-4 p-5" onSubmit={event => { event.preventDefault(); checkout.mutate() }}>
          <h2 className="text-xl font-black">Order summary</h2><div className="flex justify-between"><span>Subtotal</span><b>{currency.format(total)}</b></div><div className="flex justify-between"><span>Delivery fee</span><b>{currency.format(deliveryFee)}</b></div>{discount > 0 && <div className="flex justify-between text-green-700"><span>Coupon discount</span><b>-{currency.format(discount)}</b></div>}<div className="flex justify-between border-t pt-4 text-lg"><span>Total</span><b>{currency.format(total + deliveryFee - discount)}</b></div>
          <label className="block text-sm font-semibold">Coupon<select className="input mt-1" value={couponCode} onChange={event => setCouponCode(event.target.value)}><option value="">No coupon</option>{coupons.data?.map(coupon => <option key={coupon.coupon_id} value={coupon.code} disabled={total < Number(coupon.min_order_amount)}>{coupon.code} / {coupon.coupon_type === 'free_shipping' ? 'Free shipping' : currency.format(coupon.remaining_amount)}{Number(coupon.min_order_amount) > 0 ? ` / min ${currency.format(coupon.min_order_amount)}` : ''}</option>)}</select></label>
          <label className="block text-sm font-semibold">Delivery address<input className="input mt-1" required value={address} onChange={event => setAddress(event.target.value)} /></label>
          <label className="block text-sm font-semibold">Payment<select className="input mt-1" value={method} onChange={event => setMethod(event.target.value as 'cod' | 'payos')}><option value="cod">Cash on delivery</option><option value="payos">payOS</option></select></label>
          <label className="block text-sm font-semibold">Order note<textarea className="input mt-1" rows={3} value={orderNote} onChange={event => setOrderNote(event.target.value)} placeholder="Delivery time or general instructions"/></label>
          {checkout.error && String(checkout.error) !== 'Error: Checkout cancelled' && <p className="text-sm text-red-600">{String(checkout.error)}</p>}<button disabled={checkout.isPending} className="btn-primary w-full">{checkout.isPending ? 'Creating order...' : 'Place order'}</button>
        </form>
      </div>}
  </div>
}
