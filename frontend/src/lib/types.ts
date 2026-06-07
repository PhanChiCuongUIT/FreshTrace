export type Role = 'admin' | 'manager' | 'employee' | 'customer'

export type Profile = {
  user_id: string
  auth_user_id: string
  name: string
  email: string
  phone: string | null
  address: string | null
  avatar_url: string | null
  status: 'active' | 'inactive' | 'banned'
  roles: { role_name: Role }
}

export type CatalogProduct = {
  product_id: string
  product_name: string
  description: string | null
  unit: string
  image_url: string | null
  certificate: string | null
  category_id: string
  category_name: string
  supplier_id: string
  supplier_name: string
  batch_id: string
  batch_code: string
  expire_date: string
  origin_location: string | null
  quantity_available: number
  current_price: number
  is_rescue: boolean
  rescue_discount_percent: number | null
  average_rating: number
  review_count: number
}
