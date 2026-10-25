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
    references public.guest_identities(id) on delete set null,
  sender_user_id uuid null references auth.users(id) on delete set null,
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
