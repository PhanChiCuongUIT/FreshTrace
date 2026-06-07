import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge, PageHeader } from '../../components/Page'
import { QrScanner } from '../../components/QrScanner'
import { date } from '../../lib/format'
import { apiBaseUrl } from '../../lib/supabase'
import { normalizeBatchScan } from '../../lib/qr'

type Trace = { batch_code: string; harvest_date: string; expire_date: string; origin_location: string | null; status: string; products: { name: string; description: string | null; certificate: string | null }; suppliers: { name: string; address: string | null; certificate: string | null }; inventory: { quantity_available: number } | null }

export function TracePage() {
  const { batchId } = useParams()
  const [code, setCode] = useState('')
  const [data, setData] = useState<Trace | null>(null)
  const [error, setError] = useState('')
  const loadedBatch = useRef('')
  const trace = useCallback(async (rawValue?: string) => {
    const value = rawValue ?? batchId ?? code
    const parsed = normalizeBatchScan(value)
    setCode(parsed.batchId || parsed.batchCode)
    setError('')
    const query = parsed.batchId ? `batchId=${encodeURIComponent(parsed.batchId)}` : `code=${encodeURIComponent(parsed.batchCode)}`
    const response = await fetch(`${apiBaseUrl}/trace-batch?${query}`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
    const payload = await response.json()
    if (!response.ok) return setError(payload.error ?? 'Traceability record not found')
    setData(payload.data)
  }, [batchId, code])
  useEffect(() => {
    if (batchId && loadedBatch.current !== batchId) {
      loadedBatch.current = batchId
      void trace(batchId)
    }
  }, [batchId, trace])
  return <div><PageHeader eyebrow="Transparency" title="Trace a food batch" />
    <form className="card mt-4 grid gap-3 p-4 sm:grid-cols-[1fr_auto] lg:mt-6" onSubmit={event => { event.preventDefault(); trace() }}><input className="input" required placeholder="Enter a batch code" value={code} onChange={event => setCode(event.target.value)} /><div className="flex gap-2"><QrScanner showImageButton onResult={value => trace(value)}/><button className="btn-primary flex-1">Trace</button></div></form>
    {error && <p className="mt-4 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {data && <div className="card mt-6 p-5 sm:p-6"><div className="flex justify-between"><div><p className="text-sm text-black/50">Batch</p><h2 className="text-2xl font-black">{data.batch_code}</h2></div><Badge tone="green">{data.status}</Badge></div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2"><section><h3 className="font-bold">Product</h3><p>{data.products.name}</p><p className="text-sm text-black/55">{data.products.description}</p><p className="mt-2 text-sm">Certificate: {data.products.certificate ?? 'Not provided'}</p></section><section><h3 className="font-bold">Supplier</h3><p>{data.suppliers.name}</p><p className="text-sm text-black/55">{data.suppliers.address}</p><p className="mt-2 text-sm">Certificate: {data.suppliers.certificate ?? 'Not provided'}</p></section></div>
      <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl bg-brand-50 p-4 sm:grid-cols-4"><div><small>Origin</small><b className="block">{data.origin_location ?? 'Unknown'}</b></div><div><small>Harvested</small><b className="block">{date(data.harvest_date)}</b></div><div><small>Expires</small><b className="block">{date(data.expire_date)}</b></div><div><small>Available</small><b className="block">{data.inventory?.quantity_available ?? 0}</b></div></div>
    </div>}
  </div>
}
