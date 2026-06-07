grant update on public.chat_message_reactions to authenticated;

create policy chat_reactions_owner_update
on public.chat_message_reactions for update to authenticated
using (
  user_id = private.current_user_id()
  and exists (
    select 1
    from public.chat_messages message
    join public.chat_room_members member on member.room_id = message.room_id
    where message.message_id = chat_message_reactions.message_id
      and member.user_id = private.current_user_id()
  )
)
with check (
  user_id = private.current_user_id()
  and exists (
    select 1
    from public.chat_messages message
    join public.chat_room_members member on member.room_id = message.room_id
    where message.message_id = chat_message_reactions.message_id
      and member.user_id = private.current_user_id()
  )
);
