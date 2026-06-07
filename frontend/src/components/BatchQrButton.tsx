import { useState } from 'react'
import { QrCode, X } from 'lucide-react'
import { callFunction } from '../lib/api'
import { useFeedback } from './Feedback'

type BatchQr = { batchId: string; batchCode: string; traceUrl: string; qrDataUrl: string }

export function BatchQrButton({ batchId, batchCode, label = 'Show batch QR' }: { batchId?: string | null; batchCode?: string | null; label?: string }) {
  const { toast } = useFeedback()
  const [qr, setQr] = useState<BatchQr | null>(null)
  const [loading, setLoading] = useState(false)
  const open = async () => {
    if (!batchId && !batchCode) return toast('Batch information is unavailable', 'error')
    setLoading(true)
    try {
      const result = await callFunction<BatchQr>('render-batch-qr', { batchId, batchCode })
      setQr(result)
    } catch (error) {
      toast(String(error), 'error')
    } finally {
      setLoading(false)
    }
  }
  return <>
    <button type="button" className="font-bold text-brand-700" onClick={open}><QrCode className="mr-1 inline" size={16}/>{loading ? 'Creating QR...' : label}</button>
    {qr && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="card w-full max-w-sm p-5 text-center">
        <div className="flex items-center justify-between gap-3 text-left"><div><p className="text-xs font-bold uppercase tracking-widest text-brand-700">Traceability QR</p><h2 className="text-xl font-black">{qr.batchCode}</h2></div><button type="button" onClick={() => setQr(null)} className="rounded-xl p-2 hover:bg-black/5" aria-label="Close QR"><X size={20}/></button></div>
        <img src={qr.qrDataUrl} alt={`Trace QR for ${qr.batchCode}`} className="mx-auto mt-4 w-full max-w-[280px] rounded-2xl border bg-white p-2"/>
        <p className="mt-3 break-all text-xs text-black/50">{qr.traceUrl}</p>
        <a className="btn-primary mt-4 w-full" href={qr.qrDataUrl} download={`${qr.batchCode}-trace-qr.png`}>Download QR</a>
      </div>
    </div>}
  </>
}
