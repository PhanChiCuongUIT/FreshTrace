import { CheckCircle2, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

export function PaymentResultPage({ cancelled = false }: { cancelled?: boolean }) {
  return <div className="grid min-h-[65vh] place-items-center"><div className="card max-w-lg p-8 text-center">{cancelled ? <XCircle className="mx-auto text-orange-600" size={54}/> : <CheckCircle2 className="mx-auto text-brand-600" size={54}/>}<h1 className="mt-5 text-3xl font-black">{cancelled ? 'Payment was cancelled' : 'Payment submitted'}</h1><p className="mt-3 text-black/55">{cancelled ? 'The order remains unpaid. You can reopen it and try again.' : 'FreshTrace will update the order after the signed payOS webhook is verified.'}</p><Link to="/orders" className="btn-primary mt-6">View orders</Link></div></div>
}
