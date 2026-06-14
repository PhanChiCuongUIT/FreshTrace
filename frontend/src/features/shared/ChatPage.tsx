import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleEllipsis, Download, File, Frown, Heart, Laugh, Paperclip, Send, SmilePlus, ThumbsUp, X } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '../../components/AsyncState'
import { PageHeader } from '../../components/Page'
import { uploadChatFile } from '../../lib/cloudinary'
import { dateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/auth-context'
import { useFeedback } from '../../components/Feedback'
import { ProductImage } from '../../components/ProductImage'

type Room = { room_id: string; room_type: string; order_id: string | null; order_code: number | null; peer_user_id: string; peer_name: string; peer_avatar_url: string | null; peer_email: string; peer_phone: string | null; peer_role: string; created_at: string }
type Reaction = { reaction_id: string; reaction: ReactionName; user_id: string }
type Message = { message_id: string; sender_id: string; message: string | null; attachment_url: string | null; attachment_name: string | null; attachment_type: string | null; attachment_size: number | null; shared_product_id: string | null; shared_order_id: string | null; created_at: string; users: { name: string; avatar_url: string | null; email: string; phone: string | null; roles: { role_name: string } }; shared_product: { product_id: string; name: string; image_url: string | null; unit: string } | null; shared_order: { order_id: string; order_code: number; total_amount: number; status: string } | null; chat_message_reactions: Reaction[] }
type Contact = { user_id: string; name: string; role_name: string; order_id: string | null; order_code: number | null; room_type: string }
type ReactionName = 'like' | 'love' | 'laugh' | 'wow' | 'sad'

const reactions: Array<{ value: ReactionName; label: string; Icon: typeof ThumbsUp }> = [
  { value: 'like', label: 'Like', Icon: ThumbsUp },
  { value: 'love', label: 'Love', Icon: Heart },
  { value: 'laugh', label: 'Laugh', Icon: Laugh },
  { value: 'wow', label: 'Wow', Icon: CircleEllipsis },
  { value: 'sad', label: 'Sad', Icon: Frown },
]

function fileSize(value: number | null) {
  if (!value) return ''
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function ChatPage() {
  const { profile } = useAuth()
  const feedback = useFeedback()
  const { roomId: routeRoomId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [roomId, setRoomId] = useState(routeRoomId ?? '')
  const [message, setMessage] = useState('')
  const [contactKey, setContactKey] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [reactionFor, setReactionFor] = useState('')
  const [person, setPerson] = useState<Message['users'] | null>(null)
  const shareProduct = searchParams.get('shareProduct')
  const shareOrder = searchParams.get('shareOrder')
  const rooms = useQuery({ queryKey: ['chat-rooms', profile?.user_id], queryFn: async () => {
    const result = await supabase.rpc('list_my_chat_rooms')
    if (result.error) throw result.error
    return result.data as Room[]
  }})
  const contacts = useQuery({ queryKey: ['chat-contacts', profile?.user_id], queryFn: async () => {
    const result = await supabase.rpc('list_chat_contacts')
    if (result.error) throw result.error
    return result.data as Contact[]
  }})
  const messages = useQuery({ queryKey: ['chat-messages', roomId], enabled: Boolean(roomId), queryFn: async () => {
    const result = await supabase.from('chat_messages').select('message_id,sender_id,message,attachment_url,attachment_name,attachment_type,attachment_size,shared_product_id,shared_order_id,created_at,users(name,avatar_url,email,phone,roles(role_name)),shared_product:products!chat_messages_shared_product_id_fkey(product_id,name,image_url,unit),shared_order:orders!chat_messages_shared_order_id_fkey(order_id,order_code,total_amount,status),chat_message_reactions(reaction_id,reaction,user_id)').eq('room_id', roomId).order('created_at')
    if (result.error) throw result.error
    const marked = await supabase.rpc('mark_chat_read', { p_room_id: roomId })
    if (marked.error) throw marked.error
    return result.data as unknown as Message[]
  }})
  useEffect(() => {
    if (!roomId) return
    const refresh = () => client.invalidateQueries({ queryKey: ['chat-messages', roomId] })
    const channel = supabase.channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_message_reactions' }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [client, roomId])
  useEffect(() => {
    if ((!shareProduct && !shareOrder) || rooms.isLoading || contacts.isLoading) return
    const run = async () => {
      if (shareOrder) {
        const existing = rooms.data?.find(room => room.order_id === shareOrder)
          ?? rooms.data?.find(room => room.room_type === 'customer_manager' && !room.order_id)
        if (existing) return setRoomId(existing.room_id)
        const contact = contacts.data?.find(item => item.order_id === shareOrder)
          ?? contacts.data?.find(item => item.room_type === 'customer_manager' && !item.order_id)
        if (!contact) return
        const result = await supabase.rpc('create_chat_room', { p_type: contact.room_type, p_other_user_id: contact.user_id, p_order_id: contact.room_type === 'customer_manager' ? shareOrder : contact.order_id, p_product_id: null })
        if (result.error) return feedback.error(result.error.message)
        setRoomId(result.data as string)
        client.invalidateQueries({ queryKey: ['chat-rooms'] })
        return
      }
      if (shareProduct) {
        const existing = rooms.data?.find(room => room.room_type === 'customer_manager' && !room.order_id)
        if (existing) return setRoomId(existing.room_id)
        const contact = contacts.data?.find(item => item.room_type === 'customer_manager' && !item.order_id)
        if (!contact) return
        const result = await supabase.rpc('create_chat_room', { p_type: contact.room_type, p_other_user_id: contact.user_id, p_order_id: null, p_product_id: shareProduct })
        if (result.error) return feedback.error(result.error.message)
        setRoomId(result.data as string)
        client.invalidateQueries({ queryKey: ['chat-rooms'] })
      }
    }
    void run()
  }, [client, contacts.data, contacts.isLoading, feedback, rooms.data, rooms.isLoading, shareOrder, shareProduct])
  const createRoom = async () => {
    const contact = contacts.data?.find(item => `${item.user_id}:${item.room_type}:${item.order_id ?? ''}` === contactKey)
    if (!contact) return feedback.error('Select a valid contact')
    const result = await supabase.rpc('create_chat_room', { p_type: contact.room_type, p_other_user_id: contact.user_id, p_order_id: contact.order_id, p_product_id: null })
    if (result.error) return feedback.error(result.error.message)
    setRoomId(result.data as string)
    client.invalidateQueries({ queryKey: ['chat-rooms'] })
  }
  const send = async () => {
    if (!message.trim() && !attachment && !shareProduct && !shareOrder) return
    if (attachment && attachment.size > 10 * 1024 * 1024) return feedback.error('Attachments must be 10 MB or smaller')
    setSending(true)
    try {
      const attachmentUrl = attachment ? await uploadChatFile(attachment) : null
      const result = await supabase.from('chat_messages').insert({
        room_id: roomId,
        sender_id: profile!.user_id,
        message: message.trim() || null,
        attachment_url: attachmentUrl,
        attachment_name: attachment?.name ?? null,
        attachment_type: attachment?.type || null,
        attachment_size: attachment?.size ?? null,
        shared_product_id: shareProduct || null,
        shared_order_id: shareOrder || null,
      }).select('message_id').single()
      if (result.error) throw result.error
      setMessage('')
      setAttachment(null)
      if (shareProduct || shareOrder) navigate(roomId ? `/chat/${roomId}` : '/chat', { replace: true })
      client.invalidateQueries({ queryKey: ['chat-messages', roomId] })
    } catch (error) {
      feedback.error(String(error))
    } finally {
      setSending(false)
    }
  }
  const toggleReaction = async (item: Message, reaction: ReactionName) => {
    const existing = item.chat_message_reactions.find(value => value.user_id === profile!.user_id)
    const result = existing?.reaction === reaction
      ? await supabase.from('chat_message_reactions').delete().eq('reaction_id', existing.reaction_id).select('reaction_id').single()
      : await supabase.from('chat_message_reactions').upsert({ message_id: item.message_id, user_id: profile!.user_id, reaction }, { onConflict: 'message_id,user_id' }).select('reaction_id').single()
    if (result.error) feedback.error(result.error.message)
    else { setReactionFor(''); client.invalidateQueries({ queryKey: ['chat-messages', roomId] }) }
  }
  if (rooms.isLoading) return <LoadingState />
  if (rooms.error) return <ErrorState error={rooms.error} />
  return <div><PageHeader eyebrow="Support" title="Chat" />
    <details className="card mt-6 p-4"><summary className="cursor-pointer font-bold">Create a conversation</summary><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><select className="input" value={contactKey} onChange={event => setContactKey(event.target.value)}><option value="">Select an eligible contact</option>{contacts.data?.map(contact => <option key={`${contact.user_id}:${contact.room_type}:${contact.order_id ?? ''}`} value={`${contact.user_id}:${contact.room_type}:${contact.order_id ?? ''}`}>{contact.name} / {contact.role_name}{contact.order_code ? ` / order #${contact.order_code}` : ''}</option>)}</select><button className="btn-primary" onClick={createRoom}>Create</button></div></details>
    <div className="mt-5 grid min-h-[70vh] gap-4 lg:grid-cols-[280px_1fr]"><aside className="card flex gap-2 overflow-x-auto p-3 lg:block lg:max-h-none lg:overflow-y-auto">{!rooms.data?.length ? <EmptyState title="No conversations" /> : rooms.data.map(room => <button key={room.room_id} onClick={() => setRoomId(room.room_id)} className={`flex min-w-60 items-center gap-3 rounded-xl p-3 text-left lg:mb-2 lg:w-full ${roomId === room.room_id ? 'bg-brand-100' : 'hover:bg-black/5'}`}><div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 font-black text-brand-700">{room.peer_avatar_url ? <img src={room.peer_avatar_url} alt="" className="h-full w-full object-cover"/> : room.peer_name?.slice(0,1)}</div><span className="min-w-0"><b className="block truncate">{room.peer_name ?? 'Conversation'}</b><small className="block truncate capitalize text-black/45">{room.peer_role}{room.order_code ? ` / order #${room.order_code}` : ''}</small></span></button>)}</aside>
      <section className="card flex min-h-[68vh] flex-col overflow-hidden">{!roomId ? <div className="m-auto text-black/45">Select a conversation</div> : <><div className="border-b bg-white px-4 py-3"><b>{rooms.data?.find(room => room.room_id === roomId)?.peer_name ?? 'Conversation'}</b><p className="text-xs capitalize text-black/45">{rooms.data?.find(room => room.room_id === roomId)?.peer_role}</p></div><div className="flex-1 space-y-1 overflow-y-auto bg-gradient-to-b from-brand-50/30 to-white p-3 sm:p-4">{messages.isLoading ? <LoadingState/> : messages.error ? <ErrorState error={messages.error}/> : messages.data?.map((item, index) => {
        const mine = item.sender_id === profile?.user_id
        const startsGroup = index === 0 || messages.data?.[index - 1]?.sender_id !== item.sender_id
        return <div key={item.message_id} className={`group flex max-w-[94%] items-end gap-2 sm:max-w-[78%] ${startsGroup ? 'pt-3' : ''} ${mine ? 'ml-auto flex-row-reverse' : ''}`}>{startsGroup ? <button type="button" onClick={() => setPerson(item.users)} className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-100 font-bold text-brand-700">{item.users.avatar_url ? <img src={item.users.avatar_url} alt={item.users.name} className="h-full w-full object-cover"/> : item.users.name.slice(0,1)}</button> : <span className="w-9 shrink-0"/>}<div className="min-w-0"><div className={`rounded-2xl p-3 ${mine ? 'bg-brand-600 text-white' : 'border border-black/5 bg-white shadow-sm'}`}>{startsGroup && <b className="mb-1 block text-xs opacity-65">{item.users.name}</b>}{item.message && <p className="whitespace-pre-wrap">{item.message}</p>}{item.shared_product && <Link to={`/products/${item.shared_product.product_id}`} className={`mt-2 flex gap-3 rounded-xl p-3 ${mine ? 'bg-white/10' : 'bg-brand-50'}`}><ProductImage name={item.shared_product.name} source={item.shared_product.image_url} className="h-16 w-16 rounded-lg object-cover"/><span><small className="opacity-60">Shared product</small><b className="block">{item.shared_product.name}</b></span></Link>}{item.shared_order && <Link to={`/orders/${item.shared_order.order_id}`} className={`mt-2 block rounded-xl p-3 ${mine ? 'bg-white/10' : 'bg-brand-50'}`}><small className="opacity-60">Shared order</small><b className="block">Order #{item.shared_order.order_code} / {item.shared_order.status}</b></Link>}{item.attachment_url && <a href={item.attachment_url} target="_blank" rel="noreferrer" className={`mt-2 flex items-center gap-3 rounded-xl p-3 ${mine ? 'bg-white/10' : 'bg-black/[0.04]'}`}>{item.attachment_type?.startsWith('image/') ? <img src={item.attachment_url} alt={item.attachment_name ?? 'Chat attachment'} className="h-20 w-20 rounded-lg object-cover"/> : <span className="grid h-11 w-11 place-items-center rounded-lg bg-white/10"><File size={20}/></span>}<span className="min-w-0 flex-1"><b className="block truncate text-sm">{item.attachment_name ?? 'Attachment'}</b><small className="opacity-65">{fileSize(item.attachment_size)}</small></span><Download size={17}/></a>}<small className="mt-1 block opacity-60">{dateTime(item.created_at)}</small></div><div className={`relative mt-1 flex items-center gap-1 ${mine ? 'justify-end' : ''}`}><button type="button" title="React" onClick={() => setReactionFor(reactionFor === item.message_id ? '' : item.message_id)} className="rounded-full bg-white p-1.5 text-black/55 shadow-sm hover:bg-brand-50 sm:opacity-0 sm:group-hover:opacity-100"><SmilePlus size={16}/></button>{reactionFor === item.message_id && <div className={`absolute bottom-9 z-20 flex gap-1 rounded-full border bg-white p-1 shadow-lg ${mine ? 'right-0' : 'left-0'}`}>{reactions.map(({ value, label, Icon }) => <button key={value} type="button" title={label} onClick={() => toggleReaction(item, value)} className="rounded-full p-2.5 hover:bg-brand-50"><Icon size={17}/></button>)}</div>}{reactions.map(({ value, Icon }) => { const count = item.chat_message_reactions.filter(r => r.reaction === value).length; return count ? <span key={value} className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs shadow"><Icon size={12}/>{count}</span> : null })}</div></div></div>
      })}</div><form className="border-t bg-white p-3" onSubmit={event => { event.preventDefault(); send() }}>{(shareProduct || shareOrder) && <div className="mb-2 rounded-xl bg-brand-50 p-3 text-sm font-semibold">Ready to share {shareProduct ? 'a product' : 'an order'} in this conversation.</div>}{attachment && <div className="mb-2 flex items-center gap-2 rounded-xl bg-brand-50 p-2 text-sm"><Paperclip size={16}/><span className="min-w-0 flex-1 truncate">{attachment.name}</span><span className="text-black/40">{fileSize(attachment.size)}</span><button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X size={17}/></button></div>}<div className="flex gap-2"><label className="btn-secondary px-3" title="Attach a file up to 10 MB"><Paperclip size={18}/><input className="hidden" type="file" onChange={event => setAttachment(event.target.files?.[0] ?? null)}/></label><input className="input min-w-0" value={message} onChange={event => setMessage(event.target.value)} placeholder="Write a message"/><button className="btn-primary px-4" disabled={sending || (!message.trim() && !attachment && !shareProduct && !shareOrder)}>{sending ? 'Sending...' : <><Send size={18}/><span className="hidden sm:inline">Send</span></>}</button></div></form></>}</section>
    </div>
    {person && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setPerson(null)}><div className="card w-full max-w-sm p-6 text-center" onClick={event => event.stopPropagation()}><div className="mx-auto grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-brand-100 text-3xl font-black text-brand-700">{person.avatar_url ? <img src={person.avatar_url} alt="" className="h-full w-full object-cover"/> : person.name.slice(0,1)}</div><h2 className="mt-3 text-xl font-black">{person.name}</h2><p className="capitalize text-black/45">{person.roles.role_name}</p><p className="mt-3 text-sm">{person.email}</p>{person.phone && <p className="text-sm">{person.phone}</p>}<button className="btn-secondary mt-5" onClick={() => setPerson(null)}>Close</button></div></div>}
  </div>
}
