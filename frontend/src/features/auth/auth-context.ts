import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Profile, Role } from '../../lib/types'

export type AuthValue = {
  session: Session | null
  profile: Profile | null
  role: Role | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)

export const useAuth = () => {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
