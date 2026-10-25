-- Atomically link a verified guest identity and merge its active guest conversations
-- into Amora's existing registered-user conversations. Unique participant keys and
-- closing each source conversation in the same transaction prevent duplicate imports.

create or replace function public.guest_link_account(p_token text,p_consent boolean)
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
  v_guest_alias text;
  v_owner_alias text;
  v_sender uuid;
  v_merged_conversations integer := 0;
  v_merged_messages integer := 0;
  v_last_message timestamptz;
begin
  v_user:=auth.uid();
  if v_user is null then raise exception 'Sign in to link this guest history.' using errcode='42501'; end if;
  if p_consent is distinct from true then raise exception 'Explicit consent is required to link guest history.' using errcode='42501'; end if;
  if not exists(select 1 from auth.users u where u.id=v_user and u.email_confirmed_at is not null) then
    raise exception 'Verify your account email before linking guest history.' using errcode='42501';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid guest recovery token.' using errcode='42501'; end if;

  select id,linked_user_id into v_guest,v_existing
  from public.guest_identities
  where recovery_token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
    and deleted_at is null
  for update;
  if v_guest is null then raise exception 'Guest identity not found or expired.' using errcode='42501'; end if;
  if v_existing is not null and v_existing<>v_user then
    raise exception 'This guest identity is already linked to another account.' using errcode='42501';
  end if;
  if exists(select 1 from public.guest_conversations
    where guest_identity_id=v_guest and owner_user_id=v_user and closed_at is null) then
    raise exception 'This guest identity cannot be linked to the account it was chatting with.' using errcode='42501';
  end if;

  update public.guest_identities
    set linked_user_id=v_user,linked_at=coalesce(linked_at,now()),last_seen_at=now()
    where id=v_guest;

  for v_source in
    select * from public.guest_conversations
    where guest_identity_id=v_guest and closed_at is null
    order by created_at
    for update
  loop
    select c.id into v_chat
    from public.conversations c
    where c.is_active=true
      and exists(select 1 from public.conversation_participants p where p.conversation_id=c.id and p.user_id=v_user)
      and exists(select 1 from public.conversation_participants p where p.conversation_id=c.id and p.user_id=v_source.owner_user_id)
      and (select count(*) from public.conversation_participants p where p.conversation_id=c.id)=2
    order by c.last_message_at desc
    limit 1;

    if v_chat is null then
      insert into public.conversations(is_active,last_message_at)
        values(true,coalesce(v_source.last_message_at,now()))
        returning id into v_chat;
      v_guest_alias := 'Guest-' || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text,'-',''),1,6);
      v_owner_alias := 'Anonymous-' || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text,'-',''),1,6);
      insert into public.conversation_participants(conversation_id,user_id,anonymous_name)
        values(v_chat,v_user,v_guest_alias),(v_chat,v_source.owner_user_id,v_owner_alias);
    end if;

    for v_message in
      select * from public.guest_messages
      where conversation_id=v_source.id and deleted_at is null and moderation_status='approved'
      order by created_at,id
    loop
      if v_message.sender_guest_identity_id=v_guest then
        v_sender:=v_user;
      else
        v_sender:=v_message.sender_user_id;
      end if;
      if v_sender is not null then
        insert into public.chat_messages(conversation_id,sender_id,message_text,created_at,moderation_status)
          values(v_chat,v_sender,v_message.message_text,v_message.created_at,'approved');
        v_merged_messages:=v_merged_messages+1;
      end if;
    end loop;

    select max(created_at) into v_last_message
    from public.guest_messages
    where conversation_id=v_source.id and deleted_at is null and moderation_status='approved';
    update public.conversations
      set last_message_at=greatest(last_message_at,coalesce(v_last_message,last_message_at))
      where id=v_chat;
    update public.guest_conversations set closed_at=now() where id=v_source.id;
    v_merged_conversations:=v_merged_conversations+1;
    v_chat:=null;
  end loop;

  return pg_catalog.jsonb_build_object(
    'status','linked',
    'merged_conversations',v_merged_conversations,
    'merged_messages',v_merged_messages
  );
end;
$function$;

revoke all on function public.guest_link_account(text,boolean) from public, anon, authenticated;
grant execute on function public.guest_link_account(text,boolean) to authenticated;
