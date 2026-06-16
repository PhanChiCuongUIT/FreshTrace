import { useMemo, useState } from 'react'
import { resolveProductImageCandidates } from '../lib/productImages'

type ProductImageProps = {
  name: string
  source?: string | null
  className?: string
}

export function ProductImage({ name, source, className }: ProductImageProps) {
  const sources = useMemo(() => resolveProductImageCandidates(name, source), [name, source])
  const sourceKey = `${name}:${source ?? ''}`
  const [fallback, setFallback] = useState({ key: sourceKey, index: 0 })
  const sourceIndex = fallback.key === sourceKey ? fallback.index : 0
  const src = sources[Math.min(sourceIndex, sources.length - 1)]

  return <img src={src} alt={name} className={className} onError={() => setFallback(current => current.key === sourceKey
    ? { key: sourceKey, index: Math.min(current.index + 1, sources.length - 1) }
    : { key: sourceKey, index: Math.min(1, sources.length - 1) })} />
}
