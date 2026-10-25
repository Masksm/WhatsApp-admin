-- Read and continue guest conversations after explicit account linking.
-- Does not copy or rewrite existing registered conversations; guest history stays
-- in its own isolated conversation set, preventing duplicate chat/message inserts.

create or replace function public.account_get_linked_guest_conversations()
returns table(conversation_id uuid, my_anonymous_name text, other_anonymous_name text, last_message_at timestamptz, last_message_preview text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  if not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null) then
    raise exception 'Verify your email to access linked guest history.' using errcode='42501';
  end if;
  return query
  select c.id,c.guest_anonymous_name,c.owner_anonymous_name,c.last_message_at,
    (select m.message_text from public.guest_messages m where m.conversation_id=c.id and m.deleted_at is null and m.moderation_status='approved' order by m.created_at desc limit 1)
  from public.guest_conversations c
  join public.guest_identities g on g.id=c.guest_identity_id
  where g.linked_user_id=auth.uid() and c.closed_at is null
  order by c.last_message_at desc;
end;
$function$;

create or replace function public.account_get_linked_guest_messages(p_conversation_id uuid)
returns table(message_id uuid, sender_anonymous_name text, message_text text, sent_at timestamptz, sent_by_me boolean)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists(
    select 1 from public.guest_conversations c
    join public.guest_identities g on g.id=c.guest_identity_id
    where c.id=p_conversation_id and g.linked_user_id=auth.uid() and c.closed_at is null
  ) then raise exception 'Conversation unavailable.' using errcode='42501'; end if;
  return query
  select m.id,
    case when m.sender_guest_identity_id=c.guest_identity_id then c.guest_anonymous_name else c.owner_anonymous_name end,
    m.message_text,m.created_at,(m.sender_guest_identity_id=c.guest_identity_id)
  from public.guest_messages m
  join public.guest_conversations c on c.id=m.conversation_id
  join public.guest_identities g on g.id=c.guest_identity_id
  where m.conversation_id=p_conversation_id and g.linked_user_id=auth.uid()
    and m.deleted_at is null and m.moderation_status='approved'
  order by m.created_at asc;
end;
$function$;

create or replace function public.account_send_linked_guest_message(p_conversation_id uuid,p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_user uuid; v_message text; v_status text; v_id uuid; v_count integer;
begin
  v_user:=auth.uid();
  if v_user is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  if not exists(select 1 from auth.users u where u.id=v_user and u.email_confirmed_at is not null) then
    raise exception 'Verify your email to send from linked guest history.' using errcode='42501';
  end if;
  v_message:=pg_catalog.btrim(coalesce(p_message,''));
  if v_message='' or pg_catalog.char_length(v_message)>2000 then raise exception 'Message must contain 1 to 2000 characters.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || p_conversation_id::text,0));
  if not exists(select 1 from public.guest_conversations c join public.guest_identities g on g.id=c.guest_identity_id
    where c.id=p_conversation_id and g.linked_user_id=v_user and c.closed_at is null) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  select count(*) into v_count from public.guest_message_rate_limits
    where owner_user_id=v_user and action='send_message' and occurred_at>now()-interval '1 minute';
  if v_count>=30 then raise exception 'Message rate limit reached. Please wait before sending again.'; end if;
  v_status:=public.check_amora_message(v_message);
  if v_status<>'approved' then return pg_catalog.jsonb_build_object('status','blocked','message','This message may contain contact information or violate Amora messaging rules. Please revise it.'); end if;
  insert into public.guest_messages(conversation_id,sender_user_id,message_text,moderation_status)
    values(p_conversation_id,v_user,v_message,'approved') returning id into v_id;
  update public.guest_conversations set last_message_at=now() where id=p_conversation_id;
  insert into public.guest_message_rate_limits(owner_user_id,action) values(v_user,'send_message');
  return pg_catalog.jsonb_build_object('status','approved','message_id',v_id);
end;
$function$;

revoke all on function public.account_get_linked_guest_conversations() from public, anon, authenticated;
revoke all on function public.account_get_linked_guest_messages(uuid) from public, anon, authenticated;
revoke all on function public.account_send_linked_guest_message(uuid,text) from public, anon, authenticated;
grant execute on function public.account_get_linked_guest_conversations() to authenticated;
grant execute on function public.account_get_linked_guest_messages(uuid) to authenticated;
grant execute on function public.account_send_linked_guest_message(uuid,text) to authenticated;
