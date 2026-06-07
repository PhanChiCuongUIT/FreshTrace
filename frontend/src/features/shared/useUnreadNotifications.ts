import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/auth-context'
import { useFeedback } from '../../components/Feedback'

export function useUnreadNotifications() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { info } = useFeedback()
  const query = useQuery({
    queryKey: ['notification-unread-count', profile?.user_id],
    enabled: Boolean(profile),
    queryFn: async () => {
      const result = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile!.user_id)
        .eq('is_read', false)
      if (result.error) throw result.error
      return result.count ?? 0
    },
  })

  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel(`notification-count:${profile.user_id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.user_id}` },
        payload => {
          queryClient.invalidateQueries({ queryKey: ['notification-unread-count', profile.user_id] })
          if (payload.eventType === 'INSERT') {
            const notification = payload.new as { title?: string; content?: string }
            info(notification.title ?? notification.content ?? 'You have a new notification')
          }
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [info, profile, queryClient])

  return query.data ?? 0
}
