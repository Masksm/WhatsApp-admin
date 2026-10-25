-- Preserve the guest identity link-state constraint when a linked Auth user is deleted.
-- Deleting the account deletes its linked guest identity and dependent guest-only history.
alter table public.guest_identities
  drop constraint if exists guest_identities_linked_user_id_fkey;
alter table public.guest_identities
  add constraint guest_identities_linked_user_id_fkey
  foreign key (linked_user_id) references auth.users(id) on delete cascade;
