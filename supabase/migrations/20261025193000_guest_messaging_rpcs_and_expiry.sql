-- Amora guest messaging foundation
-- ADDITIVE DRAFT ONLY: this migration has not been applied to Supabase.
-- It does not alter existing anonymous messaging or chat tables.
-- Do not apply until RPCs, account linking, expiry scheduling and tests are reviewed.
-- Guest recovery credentials are bearer secrets; store only SHA-256 hashes.
-- All client access must use narrowly scoped server-side RPCs, never table grants.

begin;

create table if not exists public.guest_identities (
  id uuid primary key default gen_random_uuid(),
  recovery_token_hash text not null unique
    check (recovery_token_hash ~ '^[a-f0-9]{64}$'),
  linked_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  linked_at timestamptz null,
  deleted_at timestamptz null,
  constraint guest_identity_link_state_check check (
    (linked_user_id is null and linked_at is null)
    or (linked_user_id is not null and linked_at is not null)
  )
);

create table if not exists public.guest_conversations (
  id uuid primary key default gen_random_uuid(),
  guest_identity_id uuid not null
    references public.guest_identities(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  guest_anonymous_name text not null default ('Guest-' || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  owner_anonymous_name text not null default ('Anonymous-' || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz null,
  unique (guest_identity_id, owner_user_id)
);

create table if not exists public.guest_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.guest_conversations(id) on delete cascade,
  sender_guest_identity_id uuid null
    references public.guest_identities(id) on delete cascade,
  sender_user_id uuid null references auth.users(id) on delete cascade,
  message_text text not null
    check (char_length(btrim(message_text)) between 1 and 2000),
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'blocked')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint guest_message_exactly_one_sender_check check (
    (sender_guest_identity_id is not null and sender_user_id is null)
    or (sender_guest_identity_id is null and sender_user_id is not null)
  )
);

-- Server-only rate-limit events. Message bodies and recovery tokens are not stored.
create table if not exists public.guest_message_rate_limits (
  id bigint generated always as identity primary key,
  identity_id uuid null references public.guest_identities(id) on delete cascade,
  owner_user_id uuid null references auth.users(id) on delete cascade,
  requester_hash text null check (requester_hash is null or requester_hash ~ '^[a-f0-9]{64}$'),
  action text not null check (action in ('identity_create', 'send_message', 'recover', 'link_account')),
    check (action in ('identity_create', 'send_message', 'recover', 'link_account')),
  occurred_at timestamptz not null default now(),
  constraint guest_rate_limit_actor_check
    check (identity_id is not null or owner_user_id is not null or requester_hash is not null)
);

create index if not exists guest_conversations_owner_recent_idx
  on public.guest_conversations (owner_user_id, last_message_at desc);
create index if not exists guest_conversations_identity_recent_idx
  on public.guest_conversations (guest_identity_id, last_message_at desc);
create index if not exists guest_messages_conversation_recent_idx
  on public.guest_messages (conversation_id, created_at desc)
  where deleted_at is null;
create index if not exists guest_messages_moderation_queue_idx
  on public.guest_messages (created_at)
  where moderation_status = 'pending' and deleted_at is null;
create index if not exists guest_rate_limits_identity_action_time_idx
  on public.guest_message_rate_limits (identity_id, action, occurred_at desc);
create index if not exists guest_rate_limits_user_action_time_idx
  on public.guest_message_rate_limits (owner_user_id, action, occurred_at desc);
create index if not exists guest_rate_limits_requester_action_time_idx
  on public.guest_message_rate_limits (requester_hash, action, occurred_at desc);

alter table public.guest_identities enable row level security;
alter table public.guest_conversations enable row level security;
alter table public.guest_messages enable row level security;
alter table public.guest_message_rate_limits enable row level security;

-- No client-facing RLS policies or direct table grants by design.
revoke all on table public.guest_identities from anon, authenticated;
revoke all on table public.guest_conversations from anon, authenticated;
revoke all on table public.guest_messages from anon, authenticated;
revoke all on table public.guest_message_rate_limits from anon, authenticated;
revoke all on sequence public.guest_message_rate_limits_id_seq from anon, authenticated;

commit;
),
  action text not null
    check (action in ('identity_create', 'send_message', 'recover', 'link_account')),
  occurred_at timestamptz not null default now(),
  constraint guest_rate_limit_actor_check
    check (identity_id is not null or owner_user_id is not null)
);

create index if not exists guest_conversations_owner_recent_idx
  on public.guest_conversations (owner_user_id, last_message_at desc);
create index if not exists guest_conversations_identity_recent_idx
  on public.guest_conversations (guest_identity_id, last_message_at desc);
create index if not exists guest_messages_conversation_recent_idx
  on public.guest_messages (conversation_id, created_at desc)
  where deleted_at is null;
create index if not exists guest_messages_moderation_queue_idx
  on public.guest_messages (created_at)
  where moderation_status = 'pending' and deleted_at is null;
create index if not exists guest_rate_limits_identity_action_time_idx
  on public.guest_message_rate_limits (identity_id, action, occurred_at desc);
create index if not exists guest_rate_limits_user_action_time_idx
  on public.guest_message_rate_limits (owner_user_id, action, occurred_at desc);

alter table public.guest_identities enable row level security;
alter table public.guest_conversations enable row level security;
alter table public.guest_messages enable row level security;
alter table public.guest_message_rate_limits enable row level security;

-- No client-facing RLS policies or direct table grants by design.
revoke all on table public.guest_identities from anon, authenticated;
revoke all on table public.guest_conversations from anon, authenticated;
revoke all on table public.guest_messages from anon, authenticated;
revoke all on table public.guest_message_rate_limits from anon, authenticated;
revoke all on sequence public.guest_message_rate_limits_id_seq from anon, authenticated;

commit;


-- Server-side guest identity and messaging RPCs. All guest RPCs authenticate
-- with a high-entropy recovery token; only its SHA-256 hash is stored.
create or replace function public.guest_create_identity()
returns table(recovery_token text, guest_identity_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token text;
  v_hash text;
  v_requester text;
  v_count integer;
  v_id uuid;
  v_headers jsonb;
begin
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  v_requester := coalesce(nullif(v_headers->>'x-real-ip',''), nullif(split_part(coalesce(v_headers->>'x-forwarded-for',''), ',', 1),''), 'unknown');
  v_hash := encode(extensions.digest(convert_to(v_requester, 'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hash || ':identity_create', 0));
  select count(*) into v_count
    from public.guest_message_rate_limits
    where requester_hash = v_hash and action = 'identity_create'
      and occurred_at > now() - interval '1 hour';
  if v_count >= 20 then
    raise exception 'Guest identity creation limit reached. Try again later.' using errcode = 'P0001';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex');
  insert into public.guest_identities(recovery_token_hash)
    values (v_hash) returning id into v_id;
  insert into public.guest_message_rate_limits(requester_hash, action)
    values (encode(extensions.digest(convert_to(v_requester, 'UTF8'), 'sha256'), 'hex'), 'identity_create');
  return query select v_token, v_id;
end;
$function$;

create or replace function public.guest_touch_identity(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare v_id uuid; v_hash text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid guest recovery token.' using errcode='42501';
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
  update public.guest_identities
    set last_seen_at = now()
    where recovery_token_hash = v_hash and deleted_at is null
    returning id into v_id;
  if v_id is null then raise exception 'Guest identity not found or expired.' using errcode='42501'; end if;
  return v_id;
end;
$function$;

create or replace function public.guest_send_first_message(p_token text, p_slug text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_guest uuid;
  v_owner uuid;
  v_conversation uuid;
  v_message text;
  v_status text;
  v_message_id uuid;
  v_count integer;
begin
  v_guest := public.guest_touch_identity(p_token);
  v_message := pg_catalog.btrim(coalesce(p_message, ''));
  if v_message = '' or pg_catalog.char_length(v_message) > 2000 then
    raise exception 'Message must contain 1 to 2000 characters.';
  end if;
  select owner_id into v_owner from public.anonymous_links
    where slug = p_slug and is_active = true;
  if v_owner is null then raise exception 'This anonymous link is unavailable.'; end if;
  if v_owner = (select linked_user_id from public.guest_identities where id=v_guest) then
    raise exception 'You cannot start a guest conversation with your own account.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_guest::text || ':' || v_owner::text, 0));
  select count(*) into v_count from public.guest_message_rate_limits
    where identity_id=v_guest and action='send_message' and occurred_at > now()-interval '1 minute';
  if v_count >= 8 then raise exception 'Message rate limit reached. Please wait before sending again.'; end if;
  v_status := public.check_amora_message(v_message);
  if v_status <> 'approved' then
    return pg_catalog.jsonb_build_object('status','blocked','message','This message may contain contact information or violate Amora messaging rules. Please revise it.');
  end if;
  insert into public.guest_conversations(guest_identity_id, owner_user_id)
    values(v_guest,v_owner)
    on conflict(guest_identity_id,owner_user_id) do update
      set last_message_at=now(), closed_at=null
    returning id into v_conversation;
  insert into public.guest_messages(conversation_id,sender_guest_identity_id,message_text,moderation_status)
    values(v_conversation,v_guest,v_message,'approved') returning id into v_message_id;
  update public.guest_conversations set last_message_at=now() where id=v_conversation;
  insert into public.guest_message_rate_limits(identity_id,action) values(v_guest,'send_message');
  return pg_catalog.jsonb_build_object('status','approved','conversation_id',v_conversation,'message_id',v_message_id);
end;
$function$;

create or replace function public.guest_get_conversations(p_token text)
returns table(conversation_id uuid, other_anonymous_name text, last_message_at timestamptz, last_message_preview text, unread_count bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare v_guest uuid;
begin
  v_guest := public.guest_touch_identity(p_token);
  return query
  select c.id, c.owner_anonymous_name, c.last_message_at,
    (select m.message_text from public.guest_messages m where m.conversation_id=c.id and m.deleted_at is null and m.moderation_status='approved' order by m.created_at desc limit 1),
    0::bigint
  from public.guest_conversations c
  where c.guest_identity_id=v_guest and c.closed_at is null
  order by c.last_message_at desc;
end;
$function$;

create or replace function public.guest_get_messages(p_token text, p_conversation_id uuid)
returns table(message_id uuid, sender_anonymous_name text, message_text text, sent_at timestamptz, sent_by_me boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare v_guest uuid;
begin
  v_guest := public.guest_touch_identity(p_token);
  if not exists(select 1 from public.guest_conversations c where c.id=p_conversation_id and c.guest_identity_id=v_guest and c.closed_at is null) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  return query
  select m.id,
    case when m.sender_guest_identity_id=v_guest then c.guest_anonymous_name else c.owner_anonymous_name end,
    m.message_text,m.created_at,(m.sender_guest_identity_id=v_guest)
  from public.guest_messages m join public.guest_conversations c on c.id=m.conversation_id
  where m.conversation_id=p_conversation_id and m.deleted_at is null and m.moderation_status='approved'
  order by m.created_at asc;
end;
$function$;

create or replace function public.guest_send_reply(p_token text, p_conversation_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_guest uuid; v_message text; v_status text; v_message_id uuid; v_count integer;
begin
  v_guest := public.guest_touch_identity(p_token);
  v_message := pg_catalog.btrim(coalesce(p_message,''));
  if v_message='' or pg_catalog.char_length(v_message)>2000 then raise exception 'Message must contain 1 to 2000 characters.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_guest::text || ':' || p_conversation_id::text,0));
  if not exists(select 1 from public.guest_conversations c where c.id=p_conversation_id and c.guest_identity_id=v_guest and c.closed_at is null) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  select count(*) into v_count from public.guest_message_rate_limits
    where identity_id=v_guest and action='send_message' and occurred_at>now()-interval '1 minute';
  if v_count>=8 then raise exception 'Message rate limit reached. Please wait before sending again.'; end if;
  v_status:=public.check_amora_message(v_message);
  if v_status<>'approved' then return pg_catalog.jsonb_build_object('status','blocked','message','This message may contain contact information or violate Amora messaging rules. Please revise it.'); end if;
  insert into public.guest_messages(conversation_id,sender_guest_identity_id,message_text,moderation_status)
    values(p_conversation_id,v_guest,v_message,'approved') returning id into v_message_id;
  update public.guest_conversations set last_message_at=now() where id=p_conversation_id;
  insert into public.guest_message_rate_limits(identity_id,action) values(v_guest,'send_message');
  return pg_catalog.jsonb_build_object('status','approved','message_id',v_message_id);
end;
$function$;

create or replace function public.owner_get_guest_conversations()
returns table(conversation_id uuid, guest_anonymous_name text, last_message_at timestamptz, last_message_preview text, unread_count bigint)
language sql
stable security definer
set search_path = ''
as $function$
  select c.id,c.guest_anonymous_name,c.last_message_at,
    (select m.message_text from public.guest_messages m where m.conversation_id=c.id and m.deleted_at is null and m.moderation_status='approved' order by m.created_at desc limit 1),
    0::bigint
  from public.guest_conversations c
  where c.owner_user_id=auth.uid() and c.closed_at is null
  order by c.last_message_at desc;
$function$;

create or replace function public.owner_get_guest_messages(p_conversation_id uuid)
returns table(message_id uuid, sender_anonymous_name text, message_text text, sent_at timestamptz, sent_by_me boolean)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists(select 1 from public.guest_conversations c where c.id=p_conversation_id and c.owner_user_id=auth.uid() and c.closed_at is null) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  return query
  select m.id,case when m.sender_user_id=auth.uid() then c.owner_anonymous_name else c.guest_anonymous_name end,
    m.message_text,m.created_at,(m.sender_user_id=auth.uid())
  from public.guest_messages m join public.guest_conversations c on c.id=m.conversation_id
  where m.conversation_id=p_conversation_id and m.deleted_at is null and m.moderation_status='approved'
  order by m.created_at asc;
end;
$function$;

create or replace function public.owner_send_guest_message(p_conversation_id uuid,p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_user uuid; v_message text; v_status text; v_id uuid; v_count integer;
begin
  v_user:=auth.uid();
  if v_user is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  v_message:=pg_catalog.btrim(coalesce(p_message,''));
  if v_message='' or pg_catalog.char_length(v_message)>2000 then raise exception 'Message must contain 1 to 2000 characters.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || p_conversation_id::text,0));
  if not exists(select 1 from public.guest_conversations c where c.id=p_conversation_id and c.owner_user_id=v_user and c.closed_at is null) then
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

create or replace function public.guest_delete_message(p_token text,p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare v_guest uuid; v_deleted integer;
begin
  v_guest:=public.guest_touch_identity(p_token);
  update public.guest_messages m set deleted_at=now()
  from public.guest_conversations c
  where m.id=p_message_id and m.conversation_id=c.id
    and c.guest_identity_id=v_guest and m.sender_guest_identity_id=v_guest and m.deleted_at is null;
  get diagnostics v_deleted=row_count;
  return v_deleted=1;
end;
$function$;

create or replace function public.owner_delete_guest_message(p_conversation_id uuid,p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare v_deleted integer;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  update public.guest_messages m set deleted_at=now()
  from public.guest_conversations c
  where m.id=p_message_id and m.conversation_id=c.id and c.id=p_conversation_id
    and c.owner_user_id=auth.uid() and m.sender_user_id=auth.uid() and m.deleted_at is null;
  get diagnostics v_deleted=row_count;
  return v_deleted=1;
end;
$function$;

create or replace function public.guest_link_account(p_token text,p_consent boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_guest uuid; v_user uuid; v_existing uuid;
begin
  v_user:=auth.uid();
  if v_user is null then raise exception 'Sign in to link this guest history.' using errcode='42501'; end if;
  if p_consent is distinct from true then raise exception 'Explicit consent is required to link guest history.' using errcode='42501'; end if;
  if not exists(select 1 from auth.users u where u.id=v_user and u.email_confirmed_at is not null) then
    raise exception 'Verify your account email before linking guest history.' using errcode='42501';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid guest recovery token.' using errcode='42501'; end if;
  v_existing:=null;
  select id,linked_user_id into v_guest,v_existing from public.guest_identities
    where recovery_token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
      and deleted_at is null for update;
  if v_guest is null then raise exception 'Guest identity not found or expired.' using errcode='42501'; end if;
  if v_existing is not null and v_existing<>v_user then raise exception 'This guest identity is already linked to another account.' using errcode='42501'; end if;
  update public.guest_identities set linked_user_id=v_user,linked_at=coalesce(linked_at,now()),last_seen_at=now()
    where id=v_guest;
  return pg_catalog.jsonb_build_object('status','linked','guest_identity_id',v_guest,
    'conversation_count',(select count(*) from public.guest_conversations where guest_identity_id=v_guest),
    'message_count',(select count(*) from public.guest_messages m join public.guest_conversations c on c.id=m.conversation_id where c.guest_identity_id=v_guest and m.deleted_at is null));
end;
$function$;

create or replace function public.expire_guest_history()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare v_count bigint;
begin
  delete from public.guest_identities
  where linked_user_id is null and deleted_at is null and last_seen_at < now()-interval '30 days';
  get diagnostics v_count=row_count;
  delete from public.guest_message_rate_limits where occurred_at < now()-interval '1 day';
  return v_count;
end;
$function$;

revoke all on function public.guest_create_identity() from public, anon, authenticated;
revoke all on function public.guest_touch_identity(text) from public, anon, authenticated;
revoke all on function public.guest_send_first_message(text,text,text) from public, anon, authenticated;
revoke all on function public.guest_get_conversations(text) from public, anon, authenticated;
revoke all on function public.guest_get_messages(text,uuid) from public, anon, authenticated;
revoke all on function public.guest_send_reply(text,uuid,text) from public, anon, authenticated;
revoke all on function public.guest_delete_message(text,uuid) from public, anon, authenticated;
revoke all on function public.owner_get_guest_conversations() from public, anon, authenticated;
revoke all on function public.owner_get_guest_messages(uuid) from public, anon, authenticated;
revoke all on function public.owner_send_guest_message(uuid,text) from public, anon, authenticated;
revoke all on function public.owner_delete_guest_message(uuid,uuid) from public, anon, authenticated;
revoke all on function public.guest_link_account(text,boolean) from public, anon, authenticated;
revoke all on function public.expire_guest_history() from public, anon, authenticated;

grant execute on function public.guest_create_identity() to anon, authenticated;
grant execute on function public.guest_touch_identity(text) to anon, authenticated;
grant execute on function public.guest_send_first_message(text,text,text) to anon, authenticated;
grant execute on function public.guest_get_conversations(text) to anon, authenticated;
grant execute on function public.guest_get_messages(text,uuid) to anon, authenticated;
grant execute on function public.guest_send_reply(text,uuid,text) to anon, authenticated;
grant execute on function public.guest_delete_message(text,uuid) to anon, authenticated;
grant execute on function public.owner_get_guest_conversations() to authenticated;
grant execute on function public.owner_get_guest_messages(uuid) to authenticated;
grant execute on function public.owner_send_guest_message(uuid,text) to authenticated;
grant execute on function public.owner_delete_guest_message(uuid,uuid) to authenticated;
grant execute on function public.guest_link_account(text,boolean) to authenticated;

do $cron$
begin
  if exists(select 1 from cron.job where jobname='amora-guest-history-expiry') then
    perform cron.unschedule(jobid) from cron.job where jobname='amora-guest-history-expiry';
  end if;
  perform cron.schedule('amora-guest-history-expiry','17 3 * * *','select public.expire_guest_history();');
end;
$cron$;
