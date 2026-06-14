import productImages from '../generated/productImages.json'

const images = productImages as Record<string, string>

export function resolveProductImage(productName: string, source?: string | null) {
  return images[productName] || source || '/Logo-FreshTrace.png'
}
