-- Amora guest messaging hardening: idempotent account linking and bounded guest-only retention.
-- Additive and non-destructive to existing account, social, and seven-day claim data.

begin;

-- Keep a stable link from each imported guest message to its source row.
-- This prevents duplicate history imports if linking is retried.
alter table public.chat_messages
  add column if not exists guest_source_message_id uuid
  references public.guest_messages(id) on delete set null;

create unique index if not exists chat_messages_guest_source_message_uidx
  on public.chat_messages(guest_source_message_id)
  where guest_source_message_id is not null;

-- Replacing the function is safe: it retains its public signature and return shape.
-- Every guest conversation is imported into its own chat so the existing per-conversation
-- aliases are preserved and unrelated chats are never silently combined.
create or replace function public.guest_link_account(p_token text, p_consent boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_guest uuid;
  v_user uuid;
  v_existing uuid;
  v_source record;
  v_message record;
  v_chat uuid;
  v_sender uuid;
  v_merged_conversations integer := 0;
  v_merged_messages integer := 0;
  v_last_message timestamptz;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Sign in to link this guest history.' using errcode = '42501';
  end if;
  if p_consent is distinct from true then
    raise exception 'Explicit consent is required to link guest history.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = v_user and u.email_confirmed_at is not null
  ) then
    raise exception 'Verify your account email before linking guest history.' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid guest recovery token.' using errcode = '42501';
  end if;

  select g.id, g.linked_user_id
    into v_guest, v_existing
  from public.guest_identities g
  where g.recovery_token_hash =
    encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and g.deleted_at is null
  for update;

  if v_guest is null then
    raise exception 'Guest identity not found or expired.' using errcode = '42501';
  end if;
  if v_existing is not null and v_existing <> v_user then
    raise exception 'This guest identity is already linked to another account.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.guest_conversations c
    where c.guest_identity_id = v_guest
      and c.owner_user_id = v_user
      and c.closed_at is null
  ) then
    raise exception 'This guest identity cannot be linked to the account it was chatting with.' using errcode = '42501';
  end if;

  -- Row lock serializes concurrent linking attempts for this identity.
  update public.guest_identities
  set linked_user_id = v_user,
      linked_at = coalesce(linked_at, now()),
      last_seen_at = now()
  where id = v_guest;

  for v_source in
    select c.*
    from public.guest_conversations c
    where c.guest_identity_id = v_guest
      and c.closed_at is null
    order by c.created_at, c.id
    for update
  loop
    -- A separate target chat preserves the source conversation's anonymous aliases.
    insert into public.conversations(is_active, last_message_at)
    values (true, coalesce(v_source.last_message_at, now()))
    returning id into v_chat;

    insert into public.conversation_participants(conversation_id, user_id, anonymous_name)
    values
      (v_chat, v_user, v_source.guest_anonymous_name),
      (v_chat, v_source.owner_user_id, v_source.owner_anonymous_name);

    for v_message in
      select m.*
      from public.guest_messages m
      where m.conversation_id = v_source.id
        and m.deleted_at is null
        and m.moderation_status = 'approved'
      order by m.created_at, m.id
    loop
      if v_message.sender_guest_identity_id = v_guest then
        v_sender := v_user;
      else
        v_sender := v_message.sender_user_id;
      end if;

      if v_sender is not null then
        insert into public.chat_messages(
          conversation_id, sender_id, message_text, created_at,
          moderation_status, guest_source_message_id
        )
        values (
          v_chat, v_sender, v_message.message_text, v_message.created_at,
          'approved', v_message.id
        )
        on conflict (guest_source_message_id)
          where guest_source_message_id is not null
          do nothing;

        if found then
          v_merged_messages := v_merged_messages + 1;
        end if;
      end if;
    end loop;

    select max(m.created_at) into v_last_message
    from public.guest_messages m
    where m.conversation_id = v_source.id
      and m.deleted_at is null
      and m.moderation_status = 'approved';

    update public.conversations
    set last_message_at = coalesce(v_last_message, v_source.last_message_at, now())
    where id = v_chat;

    update public.guest_conversations
    set closed_at = now()
    where id = v_source.id
      and closed_at is null;

    if found then
      v_merged_conversations := v_merged_conversations + 1;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', 'linked',
    'merged_conversations', v_merged_conversations,
    'merged_messages', v_merged_messages
  );
end;
$function$;

-- Guest-only identities expire 30 days after creation. Linked identities and their
-- history are excluded. Cascades remove only rows owned by an eligible guest identity.
create or replace function public.expire_guest_history()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count bigint := 0;
  v_deleted bigint := 0;
begin
  delete from public.guest_identities g
  where g.linked_user_id is null
    and g.deleted_at is null
    and g.created_at < now() - interval '30 days';

  get diagnostics v_deleted = row_count;
  v_count := v_deleted;

  delete from public.guest_message_rate_limits r
  where r.occurred_at < now() - interval '1 day';

  return v_count;
end;
$function$;

-- Do not expose the maintenance routine to browser roles.
revoke all on function public.expire_guest_history() from public, anon, authenticated;
grant execute on function public.expire_guest_history() to service_role;

commit;
