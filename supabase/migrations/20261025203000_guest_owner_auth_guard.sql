create or replace function public.owner_get_guest_conversations()
returns table(conversation_id uuid, guest_anonymous_name text, last_message_at timestamptz, last_message_preview text, unread_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  return query
  select c.id,c.guest_anonymous_name,c.last_message_at,
    (select m.message_text from public.guest_messages m where m.conversation_id=c.id and m.deleted_at is null and m.moderation_status='approved' order by m.created_at desc limit 1),
    0::bigint
  from public.guest_conversations c
  where c.owner_user_id=auth.uid() and c.closed_at is null
  order by c.last_message_at desc;
end;
$function$;
revoke all on function public.owner_get_guest_conversations() from public, anon, authenticated;
grant execute on function public.owner_get_guest_conversations() to authenticated;
