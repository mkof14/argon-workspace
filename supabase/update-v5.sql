-- AGRON Workspace v0.5: security hardening (Supabase advisor findings)
-- Trigger and unused helper functions must not be callable through the REST API.
revoke execute on function public.protect_profile() from authenticated, anon, public;
revoke execute on function public.handle_new_user() from authenticated, anon, public;
revoke execute on function public.log_record_change() from authenticated, anon, public;
revoke execute on function public.my_profile() from authenticated, anon, public;
-- is_admin, can_read, can_write, is_external, record_visible, file_visible, file_writable, can_curate and faq_hit
-- stay executable: row-level security policies call them, and they only reveal the caller's own access.
-- ai_cache has RLS with no policies on purpose: only the server (service key) reads and writes it.

-- v0.6: protected owner account (cannot be demoted or limited by other users; no AI cap)
alter table public.profiles add column if not exists super boolean not null default false;
update public.profiles set role = 'owner', us_person = true, ai_monthly_tokens = 100000000, super = true where lower(email) = 'mkofman@gmail.com';
-- protect_profile() was updated the same way: the flag changes only in the database, and other users cannot edit a protected owner.
