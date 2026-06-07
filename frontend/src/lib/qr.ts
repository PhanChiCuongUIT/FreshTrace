const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function batchTraceUrl(batchId: string) {
  const base = import.meta.env.VITE_QR_TRACE_BASE_URL ?? `${window.location.origin}/trace`
  return `${base.replace(/\/$/, '')}/${batchId}`
}

export function normalizeBatchScan(value: string) {
  const raw = value.trim()
  if (uuidPattern.test(raw)) return { batchId: raw, batchCode: '' }
  try {
    const url = new URL(raw)
    const code = url.searchParams.get('code') ?? url.searchParams.get('batchCode') ?? ''
    const id = url.searchParams.get('batchId') ?? ''
    if (uuidPattern.test(id)) return { batchId: id, batchCode: '' }
    if (code) return uuidPattern.test(code) ? { batchId: code, batchCode: '' } : { batchId: '', batchCode: code.trim() }
    const last = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
    if (uuidPattern.test(last)) return { batchId: last, batchCode: '' }
    if (last) return { batchId: '', batchCode: last.trim() }
  } catch {
    return { batchId: '', batchCode: raw }
  }
  return { batchId: '', batchCode: raw }
}
