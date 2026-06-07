import { Navigate } from 'react-router-dom'
import { useAuth } from '../features/auth/auth-context'
import { CustomerHomePage } from '../features/customer/CustomerHomePage'

export function RoleHome() {
  const { role } = useAuth()
  if (role === 'employee') return <Navigate to="/shipper" replace />
  if (role === 'manager') return <Navigate to="/manager" replace />
  if (role === 'admin') return <Navigate to="/admin" replace />
  return <CustomerHomePage />
}
