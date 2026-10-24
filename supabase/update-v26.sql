-- AGRON Workspace — v26 (Phase 9: production readiness). Builds on v25. One transaction; safe to run again.
-- Changes required by Phase 9 and P9-R1, all reversible (rollback-v26.sql):
--   1. Release identification: workspace_db_version() reports the database version the support and rollback
--      procedures need (B62). Readable by signed-in users and the server; not by anonymous callers.
--   2. Hardening (security advisor "anon can execute SECURITY DEFINER"): anonymous callers lose EXECUTE on
--      functions they never need — the classification lookup and the record trigger functions. Trigger functions
--      still fire (PostgreSQL checks EXECUTE only when a trigger is created). The access helpers used inside the
--      row-level policies (can_read, can_write, is_admin, is_external, record_visible) keep EXECUTE for anon on
--      purpose: a policy calls them for every role, and for an anonymous caller they answer false.
--   3. Backup covers every Workspace table (P9-R1 R9): backup_tables() lists all public tables in foreign-key order
--      (caches, request counters and device push endpoints excepted); restore_load() loads any of them with the
--      table's own triggers paused, nullable references to rows that may arrive later filled in a second pass.
--      Before v26 the backup held only the core tables (records, people, comments, approvals, access, documents),
--      so workflows, policies, CRM, management and manufacturing tables were not in it.
--   4. Operations statistics for monitoring and the support view (R16, R22, R23): ops_db_stats(), server only.
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

-- 3. backup and restore of every Workspace table ------------------------------------------------------------------
create or replace function public.backup_tables() returns text[]
  language sql stable security definer set search_path = public
as $$
  with recursive t as (
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\_%'
       and c.relname not in ('ai_cache', 'rate_limits', 'push_subs')),
  -- only references that must exist at insert time (NOT NULL columns) order the tables; nullable ones are filled in
  -- the restore's second pass, which also breaks cycles such as profiles <-> departments
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

-- the same list with each table's primary key (the backup pages through every table in key order)
create or replace function public.backup_meta() returns jsonb
  language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('table', t, 'pk',
    (select coalesce(jsonb_agg(a.attname order by array_position(i.indkey::int2[], a.attnum)), '[]') from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
      where i.indrelid = format('public.%I', t)::regclass and i.indisprimary)) order by o), '[]')
  from unnest(public.backup_tables()) with ordinality u(t, o)
$$;
revoke all on function public.backup_meta() from public, anon, authenticated;
grant execute on function public.backup_meta() to service_role;

drop function if exists public.restore_load(text, jsonb);
create or replace function public.restore_load(p_table text, p_rows jsonb, p_phase integer default 1) returns integer
  language plpgsql security definer set search_path = public
as $$
declare
  n integer := 0; tbls text[] := public.backup_tables(); pos integer; rel regclass;
  cols text; vals text; sets text; pk text; ov text := ''; deferred text[]; c record; tg boolean;
begin
  pos := array_position(tbls, p_table);
  if pos is null then raise exception 'table % cannot be restored', p_table; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then return 0; end if;
  rel := format('public.%I', p_table)::regclass;
  -- nullable references to this table or to a table restored later: empty in phase 1, filled in phase 2
  select coalesce(array_agg(distinct a.attname::text), '{}') into deferred
    from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
   where con.contype = 'f' and con.conrelid = rel and not a.attnotnull
     and (con.confrelid = rel or coalesce(array_position(tbls, (select relname::text from pg_class where oid = con.confrelid)), 0) >= pos);
  select string_agg(quote_ident(k.column_name), ', ' order by k.ordinal_position),
         string_agg(case when k.column_name = any (deferred) then 'null' else quote_ident(k.column_name) end, ', ' order by k.ordinal_position)
    into cols, vals
    from information_schema.columns k
   where k.table_schema = 'public' and k.table_name = p_table and k.is_generated = 'NEVER'
     and k.column_name in (select jsonb_object_keys(p_rows->0));
  if exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = p_table and k.identity_generation = 'ALWAYS') then ov := 'overriding system value'; end if;
  select string_agg(quote_ident(a.attname), ', ') into pk from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = rel and i.indisprimary;
  tg := exists (select 1 from pg_trigger where tgrelid = rel and not tgisinternal);
  if tg then execute format('alter table public.%I disable trigger user', p_table); end if;
  if p_phase = 1 then
    execute format('insert into public.%1$I (%2$s) %4$s select %3$s from jsonb_populate_recordset(null::public.%1$I, $1) %5$s',
      p_table, cols, vals, ov, case when p_table = 'profiles' then 'on conflict (id) do update set ' ||
        (select string_agg(format('%1$I = excluded.%1$I', k.column_name), ', ') from information_schema.columns k
          where k.table_schema = 'public' and k.table_name = 'profiles' and k.is_generated = 'NEVER' and k.column_name <> 'id'
            and k.column_name in (select jsonb_object_keys(p_rows->0)) and not (k.column_name = any (deferred)))
        else 'on conflict do nothing' end) using p_rows;
    get diagnostics n = row_count;
    -- sequences behind serial/identity columns continue after the restored ids
    for c in select k.column_name from information_schema.columns k where k.table_schema = 'public' and k.table_name = p_table
               and pg_get_serial_sequence(format('public.%I', p_table), k.column_name) is not null loop
      execute format('select setval(pg_get_serial_sequence(%L, %L), greatest(1, (select coalesce(max(%I), 1) from public.%I)))', 'public.' || p_table, c.column_name, c.column_name, p_table);
    end loop;
  elsif p_phase = 2 and array_length(deferred, 1) > 0 and pk is not null then
    select string_agg(format('%1$I = x.%1$I', d), ', ') into sets from unnest(deferred) d where d in (select jsonb_object_keys(p_rows->0));
    if sets is not null then
      execute format('update public.%1$I t set %2$s from jsonb_populate_recordset(null::public.%1$I, $1) x where %3$s', p_table, sets,
        (select string_agg(format('t.%1$I = x.%1$I', a.attname), ' and ') from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey) where i.indrelid = rel and i.indisprimary))
        using p_rows;
      get diagnostics n = row_count;
    end if;
  end if;
  if tg then execute format('alter table public.%I enable trigger user', p_table); end if;
  return n;
end $$;
revoke all on function public.restore_load(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.restore_load(text, jsonb, integer) to service_role;

-- 4. operations statistics (monitoring, endurance, support view) --------------------------------------------------
create or replace function public.ops_db_stats() returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare r jsonb := jsonb_build_object('at', now(), 'db_version', 26,
  'connections', (select count(*) from pg_stat_activity where datname = current_database()),
  'db_bytes', pg_database_size(current_database()));
begin
  if to_regclass('public.automation_queue') is not null then
    r := r || jsonb_build_object('automation_queue', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.automation_queue group by 1) x)); end if;
  if to_regclass('public.outbound_messages') is not null then
    r := r || jsonb_build_object('outbound', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.outbound_messages group by 1) x)); end if;
  if to_regclass('public.notifications') is not null then
    r := r || jsonb_build_object('notifications_pending', (select count(*) from public.notifications where email_state = 'pending' or push_state = 'pending')); end if;
  if to_regclass('public.job_runs') is not null then
    r := r || jsonb_build_object('jobs_failed_24h', (select count(*) from public.job_runs where status in ('failed', 'timeout', 'dead') and started_at > now() - interval '24 hours'),
      'jobs_dead', (select count(*) from public.job_runs where status = 'dead' and started_at > now() - interval '7 days'),
      'jobs_running', (select count(*) from public.job_runs where status = 'running'),
      'last_run', (select max(started_at) from public.job_runs)); end if;
  if to_regclass('public.ops_state') is not null then
    r := r || jsonb_build_object('backup', (select value - 'counts' from public.ops_state where key = 'backup')); end if;
  if to_regclass('public.app_errors') is not null then
    r := r || jsonb_build_object('errors_24h', (select count(*) from public.app_errors where created_at > now() - interval '24 hours')); end if;
  r := r || jsonb_build_object('auth_failures_24h', (select count(*) from public.activity where section = 'security.log' and action in ('uninvited_sign_in_refused') and created_at > now() - interval '24 hours'));
  return r;
end $$;
revoke all on function public.ops_db_stats() from public, anon, authenticated;
grant execute on function public.ops_db_stats() to service_role;

commit;
