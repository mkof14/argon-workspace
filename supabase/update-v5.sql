-- AGRON Workspace v0.5: security hardening (Supabase advisor findings)
-- Trigger and unused helper functions must not be callable through the REST API.
revoke execute on function public.protect_profile() from authenticated, anon, public;
revoke execute on function public.handle_new_user() from authenticated, anon, public;
revoke execute on function public.log_record_change() from authenticated, anon, public;
revoke execute on function public.my_profile() from authenticated, anon, public;
-- is_admin, can_read, can_write, is_external, record_visible, file_visible, file_writable, can_curate and faq_hit
-- stay executable: row-level security policies call them, and they only reveal the caller's own access.
-- ai_cache has RLS with no policies on purpose: only the server (service key) reads and writes it.
