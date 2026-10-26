-- P9-S1 — hosted security acceptance at the DATABASE layer of STAGING (never production).
-- Installs a private schema "p9s1" (not exposed through the API) with:
--   p9s1.strip(j)              removes keys whose values change with the clock (at, ms, ages…) so two reads compare
--   p9s1.models()              every read model the CURRENT person may call → one fingerprint per model
--   p9s1.snapshot(run, phase)  for every synthetic persona: switches to that person (JWT claims + role
--                              authenticated, exactly what the API does), drops the per-transaction caches the engines
--                              keep, and stores the fingerprints in p9s1.results
-- Synthetic data only; the personas are "P9 Synthetic …" accounts on staging. Run as the database owner:
--   select p9s1.snapshot('<run>', 'A');  … fixtures …  select p9s1.snapshot('<run>', 'C');
create schema if not exists p9s1;
revoke all on schema p9s1 from public, anon, authenticated;
create table if not exists p9s1.results (run text, phase text, persona text, model text, fp text, n integer, err text, at timestamptz default now());
create table if not exists p9s1.fixtures (run text, key text, id uuid, section text, hidden_from text[], visible_to text[], at timestamptz default now());

create or replace function p9s1.strip(j jsonb) returns jsonb language sql immutable as $$
  select case jsonb_typeof(j)
    when 'object' then (select coalesce(jsonb_object_agg(k, p9s1.strip(v)), '{}') from jsonb_each(j) x(k, v)
                        where k not in ('at', 'ms', 'generated_at', 'now', 'age_days', 'age', 'age_hours', 'hours', 'days', 'since_days', 'asof', 'as_of', 'computed_at', 'today', 'last_at'))
    when 'array' then (select coalesce(jsonb_agg(p9s1.strip(v) order by p9s1.strip(v)::text), '[]') from jsonb_array_elements(j) v)
    else j end
$$;

create or replace function p9s1.models() returns jsonb language plpgsql as $$
-- every query runs as dynamic SQL: the engines create per-transaction temporary tables, and a cached plan would
-- outlive them between personas (SQLSTATE 0A000 "cached plan must not change result type")
declare r jsonb := '{}'; v jsonb; q record;
begin
  for q in select * from (values
    ('records', $q$select jsonb_build_object('n', count(*), 'ids', md5(coalesce(string_agg(id::text, ',' order by id), ''))) from public.records$q$),
    ('search', $q$select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.search_records('P9SYN', 50) s$q$),
    ('corp_search', $q$select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.corp_search(p_q => 'P9SYN', p_limit => 50) s$q$),
    ('attention', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.attention_items(200) a$q$),
    ('waiting', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.waiting_for() a$q$),
    ('open_loops', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.open_loops(null) a$q$),
    ('exec_overview', $q$select to_jsonb(public.exec_overview())$q$),
    ('team_status', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.team_status() a$q$),
    ('portfolio', $q$select to_jsonb(public.portfolio_overview())$q$),
    ('changes_week', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.management_changes('week') a$q$),
    ('deadlines', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.mgmt_deadlines(60) a$q$),
    ('crm_overview', $q$select to_jsonb(public.crm_overview('{}'))$q$),
    ('crm_pipeline', $q$select to_jsonb(public.crm_pipeline_value('{}'))$q$),
    ('crm_opps', $q$select to_jsonb(public.crm_list('opportunity', null, 500, '{}'))$q$),
    ('crm_followups', $q$select to_jsonb(public.crm_followups('all'))$q$),
    ('crm_waiting', $q$select to_jsonb(public.crm_waiting())$q$),
    ('mfg_overview', $q$select to_jsonb(public.mfg_overview())$q$),
    ('mfg_exec', $q$select to_jsonb(public.mfg_exec())$q$),
    ('mfg_today', $q$select to_jsonb(public.mfg_today())$q$),
    ('mfg_serials', $q$select to_jsonb(public.mfg_serial_search('C97', 50))$q$),
    ('ops_overview', $q$select to_jsonb(public.ops_overview())$q$),
    ('ops_attention', $q$select to_jsonb(public.ops_attention())$q$),
    ('ops_processes', $q$select to_jsonb(public.ops_my_processes())$q$),
    ('inow_engines', $q$select public.inow_engines(100, 500) - 'status'$q$),
    ('calendar', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.calendar_items(current_date - 30, current_date + 60, 'all') a$q$),
    ('documents', $q$select to_jsonb(public.document_center(p_view => 'all', p_limit => 200))$q$),
    ('notifications', $q$select jsonb_build_object('n', count(*)) from public.notifications$q$),
    ('storage', $q$select jsonb_build_object('n', count(*), 'names', md5(coalesce(string_agg(name, ',' order by name), ''))) from storage.objects where bucket_id = 'files'$q$),
    ('comments', $q$select jsonb_build_object('n', count(*), 'ids', md5(coalesce(string_agg(id::text, ',' order by id), ''))) from public.comments$q$)
  ) x(m, sql) loop
    begin
      execute q.sql into v;
      r := r || jsonb_build_object(q.m, jsonb_build_object('fp', md5(p9s1.strip(coalesce(v, 'null'))::text), 'n', case jsonb_typeof(v) when 'array' then jsonb_array_length(v) else null end,
             'leak_us', position('P9SYN SECRET' in coalesce(v, 'null')::text) > 0, 'leak_r', position('P9SYN RESTRICTED' in coalesce(v, 'null')::text) > 0));
    exception when others then
      r := r || jsonb_build_object(q.m, jsonb_build_object('err', sqlstate || ' ' || left(sqlerrm, 80)));
    end;
  end loop;
  return r;
end $$;

create or replace function p9s1.snapshot(p_run text, p_phase text) returns integer language plpgsql as $$
declare p record; t record; res jsonb; k text; v jsonb; n integer := 0;
begin
  for p in select id, full_name from public.profiles where full_name like 'P9 Synthetic %' order by full_name loop
    for t in select c.relname from pg_class c where c.relnamespace = pg_my_temp_schema() and c.relkind = 'r' loop
      execute format('drop table if exists pg_temp.%I cascade', t.relname);
    end loop;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p.id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint + 5)::text, true);
    perform set_config('request.jwt.claim.sub', p.id::text, true);
    execute 'set local role authenticated';
    if auth.uid() is distinct from p.id then raise exception 'persona switch failed (%)', p.full_name; end if;
    res := p9s1.models();
    execute 'reset role';
    for k, v in select * from jsonb_each(res) loop
      insert into p9s1.results(run, phase, persona, model, fp, n, err) values (p_run, p_phase, replace(p.full_name, 'P9 Synthetic ', ''), k,
        case when (v->>'leak_us')::boolean then 'LEAKUS:' else '' end || case when (v->>'leak_r')::boolean then 'LEAKR:' else '' end || coalesce(v->>'fp', ''), (v->>'n')::int, v->>'err');
      n := n + 1;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;
revoke all on all functions in schema p9s1 from public, anon, authenticated;
-- the read-model fingerprints run AS the persona: that role may call them (they read only what the caller may read);
-- the results, fixtures and the snapshot driver stay with the database owner. The schema is not exposed by the API.
grant usage on schema p9s1 to authenticated;
grant execute on function p9s1.models(), p9s1.strip(jsonb) to authenticated;

-- direct access by KNOWN id (the record, its comments and its files) for every fixture × persona
create table if not exists p9s1.direct (run text, fixture text, persona text, expected text, record_seen boolean, comments_seen integer, files_seen integer, verdict text, at timestamptz default now());
create or replace function p9s1.direct_check(p_run text) returns integer language plpgsql as $$
declare p record; f record; seen boolean; cm integer; fl integer; exp text; n integer := 0; who text;
begin
  for p in select id, replace(full_name, 'P9 Synthetic ', '') k from public.profiles where full_name like 'P9 Synthetic %' order by full_name loop
    for f in select * from p9s1.fixtures where run = p_run loop
      perform set_config('request.jwt.claims', jsonb_build_object('sub', p.id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint + 5)::text, true);
      perform set_config('request.jwt.claim.sub', p.id::text, true); -- hosted auth.uid() reads this one first
      execute 'set local role authenticated';
      if auth.uid() is distinct from p.id then raise exception 'persona switch failed (%)', p.k; end if;
      select exists (select 1 from public.records where id = f.id) into seen;
      select count(*) into cm from public.comments where record_id = f.id;
      select count(*) into fl from storage.objects where bucket_id = 'files' and name like f.section || '/' || f.id || '/%';
      execute 'reset role';
      who := p.k;
      exp := case when who = any(f.hidden_from) then 'hidden' when who = any(f.visible_to) then 'visible' else 'any' end;
      insert into p9s1.direct values (p_run, f.key, who, exp, seen, cm, fl,
        case when exp = 'hidden' and (seen or cm > 0 or fl > 0) then 'FAIL' when exp = 'visible' and not seen then 'FAIL' else 'PASS' end);
      n := n + 1;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;
revoke all on function p9s1.direct_check(text) from public, anon, authenticated;

-- staging performance at the database layer: p_n cold measurements per model AS the persona (the engines' per-transaction
-- caches are discarded before each one, as a single API request starts cold). Database execution time only — not the
-- hosted HTTP time, which needs the staging application reachable with its service key.
--   select p9s1.perf_run('<run>', 'mgmt-us', 30);  then percentiles from p9s1.perf
create table if not exists p9s1.perf (run text, persona text, model text, iter int, ms numeric, err text, at timestamptz default now());
create or replace function p9s1.perf_run(p_run text, p_persona text, p_n int) returns integer language plpgsql as $f$
declare pid uuid; q record; i int; t0 timestamptz; n int := 0; v jsonb;
begin
  select id into pid from public.profiles where full_name = 'P9 Synthetic ' || p_persona;
  if pid is null then raise exception 'no persona %', p_persona; end if;
  for i in 1..p_n loop
    for q in select * from (values
      ('my_day', $q$select public.inow_engines(100, 500)$q$),
      ('attention', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.attention_items(200) a$q$),
      ('waiting', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.waiting_for() a$q$),
      ('open_loops', $q$select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.open_loops(null) a$q$),
      ('executive', $q$select to_jsonb(public.exec_overview())$q$),
      ('project_dashboard', $q$select to_jsonb(public.portfolio_overview())$q$),
      ('commercial_dashboard', $q$select to_jsonb(public.crm_overview('{}'))$q$),
      ('manufacturing_dashboard', $q$select to_jsonb(public.mfg_exec())$q$),
      ('global_search', $q$select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.corp_search(p_q => 'P9PERF', p_limit => 50) s$q$)
    ) x(m, sql) loop
      execute 'discard temp';
      perform set_config('request.jwt.claims', jsonb_build_object('sub', pid, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', pid::text, true);
      execute 'set local role authenticated';
      t0 := clock_timestamp();
      begin
        execute q.sql into v;
        execute 'reset role';
        insert into p9s1.perf(run, persona, model, iter, ms) values (p_run, p_persona, q.m, i, extract(epoch from clock_timestamp() - t0) * 1000);
      exception when others then
        execute 'reset role';
        insert into p9s1.perf(run, persona, model, iter, err) values (p_run, p_persona, q.m, i, sqlstate || ' ' || left(sqlerrm, 80));
      end;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $f$;
revoke all on function p9s1.perf_run(text, text, int) from public, anon, authenticated;
