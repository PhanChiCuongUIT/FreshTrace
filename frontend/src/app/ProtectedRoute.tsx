import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../features/auth/auth-context'
import type { Role } from '../lib/types'

export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { session, role, loading } = useAuth()
  if (loading) return <div className="grid min-h-screen place-items-center">Loading FreshTrace...</div>
  if (!session) return <Navigate to="/login" replace />
  if (roles && (!role || !roles.includes(role))) return <Navigate to="/" replace />
  return <Outlet />
}
