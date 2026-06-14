export type CatalogError = { message: string; code?: string | null }

export function catalogErrorMessage(error: CatalogError) {
  const message = error.message.toLowerCase()
  if (message.includes('cannot delete') || error.code === '23503') return 'This record cannot be deleted because products, batches, inventory, prices, orders, reports, or audit history still reference it. Deactivate or lock the record instead.'
  if (error.code === '23505' || message.includes('duplicate key')) return 'A catalog record with the same unique value already exists. Check the name, batch code, or active period.'
  if (message.includes('supplier cannot be changed after batches exist')) return 'This product already has traceable batches, so its supplier cannot be changed. Create a new product for a different supplier.'
  if (message.includes('supplier must be approved')) return 'Select an approved supplier before saving this product or batch.'
  if (message.includes('batch product must be active')) return 'New batches can only be created for active products.'
  if (message.includes('batch product cannot be changed')) return 'A batch product cannot be changed after creation because inventory and traceability already reference it.'
  if (message.includes('expiry') || message.includes('expire')) return 'Check the harvest, expiry, and deal end dates. Expiry must be later and Fresh Rescue cannot run beyond batch expiry.'
  if (message.includes('rescue price')) return 'Fresh Rescue price must be lower than the original price.'
  if (message.includes('reserved stock')) return 'Available quantity cannot be lower than stock already reserved for customer orders.'
  if (message.includes('row-level security') || message.includes('forbidden')) return 'Your account is not allowed to perform this catalog operation.'
  if (error.code === '23514' || message.includes('check constraint')) return 'One or more values violate a catalog rule. Check quantities, prices, dates, and statuses.'
  return error.message
}
