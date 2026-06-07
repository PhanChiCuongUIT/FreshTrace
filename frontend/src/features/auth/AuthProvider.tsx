import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { AuthContext, type AuthValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = async () => {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return setProfile(null)
    const result = await supabase.from('users').select('*,roles(role_name)').eq('auth_user_id', data.session.user.id).single()
    if (result.error) throw result.error
    setProfile(result.data as Profile)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) await refreshProfile()
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next)
      if (next) await refreshProfile()
      else setProfile(null)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthValue>(() => ({
    session, profile, role: profile?.roles.role_name ?? null, loading, refreshProfile,
    signOut: async () => { await supabase.auth.signOut() },
  }), [session, profile, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
