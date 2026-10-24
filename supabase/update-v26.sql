-- AGRON Workspace — v26 (Phase 9: production readiness). Builds on v25. One transaction; safe to run again.
-- Only two changes, both required by Phase 9 and both reversible (rollback-v26.sql):
--   1. Release identification: workspace_db_version() reports the database version the support and rollback
--      procedures need (B62). Readable by signed-in users and the server; not by anonymous callers.
--   2. Hardening (security advisor "anon can execute SECURITY DEFINER"): anonymous callers lose EXECUTE on
--      functions they never need — the classification lookup and the record trigger functions. Trigger functions
--      still fire (PostgreSQL checks EXECUTE only when a trigger is created). The access helpers used inside the
--      row-level policies (can_read, can_write, is_admin, is_external, record_visible) keep EXECUTE for anon on
--      purpose: a policy calls them for every role, and for an anonymous caller they answer false.
begin;

create or replace function public.workspace_db_version() returns int
  language sql immutable security invoker set search_path = public
as $$ select 26 $$;
comment on function public.workspace_db_version() is 'Database schema version of AGRON Workspace (update-vN.sql last applied). Phase 9 release identification.';
revoke all on function public.workspace_db_version() from public, anon;
grant execute on function public.workspace_db_version() to authenticated, service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.class_meta(text)',
    'public.records_crm_after()', 'public.records_crm_before()',
    'public.records_ops_after()', 'public.records_ops_before()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
end $$;

commit;
