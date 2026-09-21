import { CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { callFunction } from '../../lib/api'
import { errorMessage } from '../../lib/errorMessages'

export function PaymentResultPage({ cancelled = false }: { cancelled?: boolean }) {
  const [params] = useSearchParams()
  const providerOrderCode = useMemo(() => {
    const raw = params.get('orderCode') ?? params.get('order_code') ?? params.get('providerOrderCode')
    const parsed = raw ? Number(raw) : 0
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [params])
  const [status, setStatus] = useState<'idle' | 'syncing' | 'paid' | 'pending' | 'failed'>(cancelled || !providerOrderCode ? 'idle' : 'syncing')
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (cancelled || !providerOrderCode) return
    let active = true
    callFunction<{ status: string; providerStatus?: string; synced?: boolean }>('sync-payos-payment', { providerOrderCode })
      .then(result => {
        if (!active) return
        if (result.status === 'paid') {
          setStatus('paid')
          setMessage(result.synced ? 'FreshTrace confirmed the payment with payOS.' : 'This payment was already confirmed.')
        } else {
          setStatus('pending')
          setMessage(`payOS currently reports ${result.providerStatus ?? result.status}. If you just paid, wait a few seconds and refresh.`)
        }
      })
      .catch(error => {
        if (!active) return
        setStatus('failed')
        setMessage(`${errorMessage(error)} If money has already left your account, do not pay again. Check the payment status again or contact support.`)
      })
    return () => { active = false }
  }, [cancelled, providerOrderCode])
  const title = cancelled ? 'Payment was cancelled' : status === 'paid' ? 'Payment confirmed' : status === 'failed' ? 'Payment not yet verified' : 'Checking payment status'
  const detail = cancelled
    ? 'Checkout was closed. Open Orders to check the payment status before trying again. If money has already left your account, do not pay again.'
    : message || (providerOrderCode ? 'FreshTrace is checking the payment status with payOS.' : 'Open Orders to refresh the payment status.')
  return <div className="grid min-h-[65vh] place-items-center"><div className="card max-w-lg p-8 text-center">{cancelled ? <XCircle className="mx-auto text-orange-600" size={54}/> : status === 'paid' ? <CheckCircle2 className="mx-auto text-brand-600" size={54}/> : <Clock3 className="mx-auto text-orange-600" size={54}/>}<h1 className="mt-5 text-3xl font-black">{title}</h1><p className="mt-3 text-black/55">{detail}</p>{status === 'syncing' && <p className="mt-3 text-sm font-semibold text-brand-700">Syncing with payOS...</p>}{status === 'failed' && <button className="btn-secondary mt-4" onClick={() => window.location.reload()}>Try syncing again</button>}<Link to="/orders" className="btn-primary mt-6">View orders</Link></div></div>
}
