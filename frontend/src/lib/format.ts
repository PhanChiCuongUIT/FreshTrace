export const currency = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
})

export const date = (value: string | null) =>
  value ? new Intl.DateTimeFormat('vi-VN').format(new Date(value)) : '-'

export const dateTime = (value: string | null) =>
  value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-'
