-- AGRON Workspace — rollback of v27 to v26. One transaction; safe to run twice. Removes the acceptance evidence
-- store (export the acceptance package first if its history must be kept); business data is not touched.
begin;

drop trigger if exists acceptance_log on public.approval_policies;
drop trigger if exists acceptance_log on public.profiles;
do $$ begin if to_regclass('public.crm_caps') is not null then drop trigger if exists acceptance_log on public.crm_caps; end if; end $$;
drop trigger if exists acceptance_log on public.security_settings;
drop function if exists public.acceptance_log_change();

drop function if exists public.acceptance_live();
drop function if exists public.acceptance_integrity();
drop function if exists public.acceptance_comment(text, text);
drop function if exists public.acceptance_reopen_action(integer, text);
drop function if exists public.acceptance_close_action(integer, uuid[], text);
drop function if exists public.acceptance_attest(text, text, text, jsonb, text, jsonb, text);
drop function if exists public.acceptance_record(jsonb);
drop function if exists public.acceptance_env();
drop function if exists public.acceptance_setting_save(text, jsonb);

-- the append-only guards forbid truncation and deletion; dropping the tables removes them with the guards
drop table if exists public.acceptance_comments;
drop table if exists public.acceptance_findings;
drop table if exists public.acceptance_owner_action_events;
drop table if exists public.acceptance_owner_actions;
drop table if exists public.acceptance_env_changes;
drop table if exists public.acceptance_evidence;
drop table if exists public.acceptance_settings;
drop table if exists public.acceptance_checks;
drop function if exists public.acceptance_immutable();

create or replace function public.workspace_db_version() returns int
  language sql immutable security invoker set search_path = public
as $$ select 26 $$;
revoke all on function public.workspace_db_version() from public, anon;
grant execute on function public.workspace_db_version() to authenticated, service_role;

-- v26 backup list (without the acceptance exclusion: there are no acceptance tables any more)
create or replace function public.backup_tables() returns text[]
  language sql stable security definer set search_path = public
as $$
  with recursive t as (
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\_%'
       and c.relname not in ('ai_cache', 'rate_limits', 'push_subs')),
  dep as (
    select distinct con.conrelid child, con.confrelid parent from pg_constraint con
     where con.contype = 'f' and con.conrelid <> con.confrelid
       and con.conrelid in (select oid from t) and con.confrelid in (select oid from t)
       and not exists (select 1 from pg_attribute a where a.attrelid = con.conrelid and a.attnum = any (con.conkey) and not a.attnotnull)),
  lvl(oid, depth) as (
    select oid, 0 from t
    union all
    select d.child, l.depth + 1 from lvl l join dep d on d.parent = l.oid where l.depth < 40)
  select array_agg(relname order by d, relname) from (select t.relname, max(l.depth) d from t join lvl l on l.oid = t.oid group by t.relname) x
$$;
revoke all on function public.backup_tables() from public, anon, authenticated;
grant execute on function public.backup_tables() to service_role;

commit;
