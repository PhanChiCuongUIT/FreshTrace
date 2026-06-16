import productImages from '../generated/productImages.json'

const images = productImages as Record<string, string>

export function resolveProductImageCandidates(productName: string, source?: string | null) {
  return [...new Set([source, images[productName], '/Logo-FreshTrace.png'].filter(Boolean))] as string[]
}

export function resolveProductImage(productName: string, source?: string | null) {
  return resolveProductImageCandidates(productName, source)[0]
}
