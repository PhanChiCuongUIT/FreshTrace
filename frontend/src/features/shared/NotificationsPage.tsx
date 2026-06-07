import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState'
import { PageHeader } from '../../components/Page'
import { dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/auth-context'

type Notification = { notification_id: string; title: string; content: string | null; type: string | null; target_url: string | null; is_read: boolean; created_at: string }

export function NotificationsPage() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const notifications = useQuery({ queryKey: ['notifications', profile?.user_id], queryFn: async () => {
    const result = await supabase.from('notifications').select('*').eq('user_id', profile!.user_id).order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as Notification[]
  }})
  useEffect(() => {
    if (!profile) return
    const channel = supabase.channel(`notifications:${profile.user_id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.user_id}` }, () => client.invalidateQueries({ queryKey: ['notifications'] })).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [client, profile])
  const read = async (item: Notification) => {
    if (!item.is_read) await supabase.from('notifications').update({ is_read: true }).eq('notification_id', item.notification_id)
    client.invalidateQueries({ queryKey: ['notifications'] })
    client.invalidateQueries({ queryKey: ['notification-unread-count'] })
    if (item.target_url) window.location.assign(item.target_url)
  }
  const markAllRead = async () => {
    if (!profile) return
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.user_id).eq('is_read', false)
    client.invalidateQueries({ queryKey: ['notifications'] })
    client.invalidateQueries({ queryKey: ['notification-unread-count'] })
  }
  if (notifications.isLoading) return <LoadingState />
  if (notifications.error) return <ErrorState error={notifications.error} />
  const unread = notifications.data?.filter(item => !item.is_read).length ?? 0
  return <div><PageHeader eyebrow="Realtime" title="Notifications" actions={unread > 0 && <button className="btn-secondary" onClick={markAllRead}>Mark all as read</button>} /><div className="mt-6 space-y-3">{!notifications.data?.length ? <EmptyState title="No notifications" /> : notifications.data.map(item => <button key={item.notification_id} onClick={() => read(item)} className={`card flex w-full gap-4 p-4 text-left ${item.is_read ? 'opacity-65' : ''}`}><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Bell size={18}/></div><div><div className="flex items-center gap-2"><b>{item.title}</b>{!item.is_read && <span className="h-2 w-2 rounded-full bg-brand-500"/>}</div><p className="text-sm text-black/55">{item.content}</p><small className="text-black/40">{dateTime(item.created_at)}</small></div></button>)}</div></div>
}
