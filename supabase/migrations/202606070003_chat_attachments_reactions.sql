alter table public.chat_messages
  alter column message drop not null,
  add column attachment_url text,
  add column attachment_name text,
  add column attachment_type text,
  add column attachment_size bigint check (
    attachment_size is null or attachment_size between 1 and 10485760
  );

alter table public.chat_messages
  drop constraint if exists chat_messages_message_check;

alter table public.chat_messages
  add constraint chat_messages_content_check check (
    (message is not null and length(trim(message)) between 1 and 4000)
    or attachment_url is not null
  );

create table public.chat_message_reactions (
  reaction_id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(message_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  reaction text not null check (reaction in ('like', 'love', 'laugh', 'wow', 'sad')),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, reaction)
);

create index idx_chat_reactions_message
  on public.chat_message_reactions(message_id, created_at);

alter table public.chat_message_reactions enable row level security;
grant select, insert, delete on public.chat_message_reactions to authenticated;

create policy chat_reactions_member_read
on public.chat_message_reactions for select to authenticated
using (
  exists (
    select 1
    from public.chat_messages message
    join public.chat_room_members member on member.room_id = message.room_id
    where message.message_id = chat_message_reactions.message_id
      and member.user_id = private.current_user_id()
  )
);

create policy chat_reactions_member_insert
on public.chat_message_reactions for insert to authenticated
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

create policy chat_reactions_owner_delete
on public.chat_message_reactions for delete to authenticated
using (user_id = private.current_user_id());

alter publication supabase_realtime add table public.chat_message_reactions;
