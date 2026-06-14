import { useState } from 'react'
import { resolveProductImage } from '../lib/productImages'

type ProductImageProps = {
  name: string
  source?: string | null
  className?: string
}

export function ProductImage({ name, source, className }: ProductImageProps) {
  const resolvedSource = resolveProductImage(name, source)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const src = failedSource === resolvedSource ? '/Logo-FreshTrace.png' : resolvedSource

  return <img src={src} alt={name} className={className} onError={() => setFailedSource(resolvedSource)} />
}
