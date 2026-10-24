-- AGRON Workspace — v27 (P9-R2: acceptance evidence). Builds on v26. One transaction; safe to run again.
-- Reversible (rollback-v27.sql). What it adds:
--   1. An append-only acceptance evidence store. Every execution (a regression run, a build, an audit, a security
--      suite, a backup, a restore drill, a performance or endurance run, an owner attestation, a snapshot of the
--      system state) is one row bound to environment, app version, Git SHA, database version and migration set.
--      Rows are never changed or deleted: a new result supersedes an old one, and the old one stays visible.
--      A PASS without evidence (source, reference, completion time, metrics) cannot be stored.
--   2. A check catalog (phase, check id, kind, freshness class, environments that count, gates, mandatory). Future
--      phases register their checks here with their own migration; nothing is hard-coded to P1–P9.
--   3. The 22 owner actions of P9-R1 and their closure events. Only an owner closes an action, and only with
--      evidence of a check the action names (code evidence cannot close an owner action).
--   4. Findings (append-only versions), owner comments (separate from machine evidence), the environment change log
--      (no secret values) with automatic entries for policy approval, role and capability changes, MFA enforcement.
--   5. Freshness defaults (SYSTEM DEFAULT — OWNER MAY CHANGE), the live state for the Evidence Center
--      (policies, access, MFA, backup) and the post-restore integrity check (triggers enabled, constraints valid,
--      functions present, row-level security on).
--   Readiness itself is computed in the application (src/lib/acceptance.ts) from these rows — deterministic, no AI.
--   The acceptance tables are not part of the business backup: evidence belongs to the environment that produced it.
begin;

create or replace function public.workspace_db_version() returns int
  language sql immutable security invoker set search_path = public
as $$ select 27 $$;
revoke all on function public.workspace_db_version() from public, anon;
grant execute on function public.workspace_db_version() to authenticated, service_role;

-- evidence of this environment is not restored into another one
create or replace function public.backup_tables() returns text[]
  language sql stable security definer set search_path = public
as $$
  with recursive t as (
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\_%' and c.relname not like 'acceptance\_%'
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

-- 1. catalog -----------------------------------------------------------------------------------------------------
create table if not exists public.acceptance_checks (
  id text primary key check (id ~ '^[A-Z0-9][A-Z0-9._-]{1,79}$'),
  phase text not null,
  name text not null,
  kind text not null,
  freshness text not null check (freshness in ('release', 'environment', 'operational', 'validation', 'live')),
  envs text[] not null default '{}',            -- environments whose evidence counts ('{}' = any, local included)
  gates text[] not null default '{}',           -- development, staging, production, live
  mandatory boolean not null default true,
  params jsonb not null default '{}'::jsonb,    -- kind-specific requirements (e.g. the suites a check is derived from)
  attestable boolean not null default false,    -- an owner may record it (real users, devices, MFA steps, plans …)
  sort integer not null default 0,
  description text
);

-- 2. evidence (append-only) ---------------------------------------------------------------------------------------
create table if not exists public.acceptance_evidence (
  id uuid primary key default gen_random_uuid(),
  seq bigserial unique,
  check_id text not null references public.acceptance_checks(id),
  status text not null check (status in ('PASS', 'FAIL', 'NOT RUN', 'NOT VERIFIED', 'OWNER ACTION REQUIRED', 'BLOCKED', 'IN PROGRESS')),
  environment text not null check (environment in ('local', 'ci', 'preview', 'staging', 'production', 'production-copy')),
  app_version text, git_sha text, db_version integer, migration_hash text,
  started_at timestamptz, completed_at timestamptz,
  source text not null check (length(source) between 1 and 200),
  source_ref text check (source_ref is null or length(source_ref) <= 300),
  recorded_at timestamptz not null default now(),
  recorded_via text not null check (recorded_via in ('service', 'owner', 'system')),
  recorded_by uuid,
  summary text check (summary is null or length(summary) <= 2000),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object' and pg_column_size(metrics) < 200000),
  blocker text check (blocker is null or length(blocker) <= 1000),
  -- a PASS needs evidence: what produced it, which execution, when it finished, and what it measured
  constraint acceptance_pass_needs_evidence check (status <> 'PASS' or (source_ref is not null and completed_at is not null and metrics <> '{}'::jsonb)),
  constraint acceptance_fail_needs_reason check (status not in ('FAIL', 'BLOCKED') or coalesce(blocker, summary) is not null)
);
create index if not exists acceptance_evidence_check_idx on public.acceptance_evidence(check_id, seq desc);

-- 3. owner actions ------------------------------------------------------------------------------------------------
create table if not exists public.acceptance_owner_actions (
  id integer primary key, category text not null, title text not null, action text not null, where_ text not null,
  why text not null, blocks_staging boolean not null, blocks_production boolean not null,
  closure_evidence text not null, closes_with text[] not null check (array_length(closes_with, 1) >= 1)
);
create table if not exists public.acceptance_owner_action_events (
  id bigserial primary key, action_id integer not null references public.acceptance_owner_actions(id),
  event text not null check (event in ('closed', 'reopened')), evidence_ids uuid[] not null default '{}',
  note text check (note is null or length(note) <= 2000), actor uuid not null, at timestamptz not null default now()
);

-- 4. findings, comments, environment changes, settings --------------------------------------------------------------
create table if not exists public.acceptance_findings (
  seq bigserial primary key, finding_id text not null check (finding_id ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  severity text not null check (severity in ('P0', 'P1', 'P2', 'P3')), description text not null check (length(description) <= 2000),
  state text not null check (state in ('open', 'fixed', 'mitigated', 'accepted')), owner text not null default 'engineering',
  blocking_gate text not null default 'none' check (blocking_gate in ('none', 'staging', 'production', 'live')),
  evidence_id uuid references public.acceptance_evidence(id), recorded_at timestamptz not null default now(), source text not null
);
create table if not exists public.acceptance_comments (
  id bigserial primary key, target text not null check (length(target) <= 100), body text not null check (length(body) between 1 and 4000),
  author uuid not null, at timestamptz not null default now()
);
create table if not exists public.acceptance_env_changes (
  id bigserial primary key, at timestamptz not null default now(),
  environment text not null, category text not null check (category in ('code_deploy', 'db_migration', 'config', 'secret_rotation', 'role_change',
    'policy_approval', 'backup', 'integration', 'signup', 'mfa', 'plan', 'repo_privacy', 'scheduler', 'staging_deploy')),
  what text not null check (length(what) <= 500), actor text, reference text check (reference is null or length(reference) <= 300),
  source text not null default 'system'
);
create table if not exists public.acceptance_settings (
  key text primary key, value jsonb not null, updated_at timestamptz not null default now(), updated_by uuid
);

-- immutability: evidence, closures, findings, comments and the change log are never changed or deleted
create or replace function public.acceptance_immutable() returns trigger language plpgsql as $$
begin raise exception 'Acceptance records are append-only (%)', tg_table_name using errcode = '42501'; end $$;
do $$ declare t text; begin
  foreach t in array array['acceptance_evidence', 'acceptance_owner_action_events', 'acceptance_findings', 'acceptance_comments', 'acceptance_env_changes'] loop
    execute format('drop trigger if exists %1$s_immutable on public.%1$s', t);
    execute format('create trigger %1$s_immutable before update or delete on public.%1$s for each row execute function public.acceptance_immutable()', t);
    execute format('drop trigger if exists %1$s_no_truncate on public.%1$s', t);
    execute format('create trigger %1$s_no_truncate before truncate on public.%1$s for each statement execute function public.acceptance_immutable()', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['acceptance_checks', 'acceptance_evidence', 'acceptance_owner_actions', 'acceptance_owner_action_events', 'acceptance_findings',
                           'acceptance_comments', 'acceptance_env_changes', 'acceptance_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage on all sequences in schema public to service_role;

-- 5. settings: freshness classes (SYSTEM DEFAULT — OWNER MAY CHANGE) -------------------------------------------------
insert into public.acceptance_settings(key, value) values
  ('freshness', jsonb_build_object(
    'label', 'SYSTEM DEFAULT — OWNER MAY CHANGE',
    'release', 'bound to the exact Git SHA, app version and database version; no time limit',
    'environment_days', 14, 'operational_hours', 26, 'validation_days', 90,
    'live', 'read from the system when the page or the package is produced')),
  ('gates', jsonb_build_object('label', 'SYSTEM DEFAULT — OWNER MAY CHANGE', 'require_pilot', false)),
  -- the release cycle being accepted: everything after the release that production runs (v2.33, main @ 7234c5e)
  ('cycle', jsonb_build_object('name', 'v2.34–v2.42+ (P1–P9, P9-R1, P9-R2)', 'started_at', '2026-10-19T00:54:00Z', 'production_baseline', 'v2.33 (main @ 7234c5e, production deployment 2026-10-19T00:53:41Z)'))
on conflict (key) do nothing;

create or replace function public.acceptance_setting_save(p_key text, p_value jsonb) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'owner' and not disabled) then
    raise exception 'Only an owner changes acceptance settings' using errcode = '42501'; end if;
  if p_key not in ('freshness', 'gates') then raise exception 'Unknown setting %', p_key using errcode = '22023'; end if;
  insert into public.acceptance_settings(key, value, updated_at, updated_by) values (p_key, p_value || jsonb_build_object('label', 'CHANGED BY OWNER'), now(), me)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = me;
  insert into public.acceptance_env_changes(environment, category, what, actor, source)
    values (coalesce((select value->>'name' from public.acceptance_settings where key = 'environment'), 'unknown'), 'config', format('acceptance setting %s changed', p_key), me::text, 'owner');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.acceptance_setting_save(text, jsonb) from public, anon;
grant execute on function public.acceptance_setting_save(text, jsonb) to authenticated;

-- the environment name of this database, set by the server that verified its project (src/lib/env.ts)
create or replace function public.acceptance_env() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select value->>'name' from public.acceptance_settings where key = 'environment'), 'unknown')
$$;
revoke all on function public.acceptance_env() from public, anon, authenticated;
grant execute on function public.acceptance_env() to service_role;

-- 6. recording ------------------------------------------------------------------------------------------------------
-- machine evidence: scripts, jobs and the server (service role only)
create or replace function public.acceptance_record(p jsonb) returns uuid
  language plpgsql security definer set search_path = public
as $$
declare new_id uuid; ck public.acceptance_checks;
begin
  select * into ck from public.acceptance_checks c where c.id = p->>'check_id';
  if not found then raise exception 'Unknown acceptance check %', p->>'check_id' using errcode = '22023'; end if;
  if coalesce(p->>'recorded_via', 'service') = 'owner' then raise exception 'Owner attestations go through acceptance_attest' using errcode = '42501'; end if;
  insert into public.acceptance_evidence(check_id, status, environment, app_version, git_sha, db_version, migration_hash, started_at, completed_at,
      source, source_ref, recorded_via, summary, metrics, blocker)
    values (ck.id, p->>'status', p->>'environment', p->>'app_version', p->>'git_sha', nullif(p->>'db_version', '')::int, p->>'migration_hash',
      nullif(p->>'started_at', '')::timestamptz, nullif(p->>'completed_at', '')::timestamptz, coalesce(p->>'source', 'unknown'), p->>'source_ref',
      coalesce(p->>'recorded_via', 'service'), p->>'summary', coalesce(p->'metrics', '{}'::jsonb), p->>'blocker')
    returning acceptance_evidence.id into new_id;
  return new_id;
end $$;
revoke all on function public.acceptance_record(jsonb) from public, anon, authenticated;
grant execute on function public.acceptance_record(jsonb) to service_role;

-- owner attestations (real users, real devices, live MFA steps, plans, authorisations …): only checks marked
-- attestable, only by an owner, always recorded as an owner attestation with the owner's id
create or replace function public.acceptance_attest(p_check text, p_status text, p_environment text, p_identity jsonb, p_summary text, p_metrics jsonb, p_ref text)
  returns uuid language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); ck public.acceptance_checks; new_id uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'owner' and not disabled) then
    raise exception 'Only an owner records an attestation' using errcode = '42501'; end if;
  select * into ck from public.acceptance_checks c where c.id = p_check;
  if not found or not ck.attestable then raise exception 'This check is measured by the system, not attested' using errcode = '42501'; end if;
  insert into public.acceptance_evidence(check_id, status, environment, app_version, git_sha, db_version, migration_hash, started_at, completed_at,
      source, source_ref, recorded_via, recorded_by, summary, metrics)
    values (ck.id, p_status, p_environment, p_identity->>'app_version', p_identity->>'git_sha', nullif(p_identity->>'db_version', '')::int, p_identity->>'migration_hash',
      now(), now(), 'owner attestation', coalesce(nullif(p_ref, ''), 'attestation ' || to_char(now(), 'YYYY-MM-DD HH24:MI')), 'owner', me, p_summary, coalesce(p_metrics, '{}'::jsonb))
    returning acceptance_evidence.id into new_id;
  return new_id;
end $$;
revoke all on function public.acceptance_attest(text, text, text, jsonb, text, jsonb, text) from public, anon;
grant execute on function public.acceptance_attest(text, text, text, jsonb, text, jsonb, text) to authenticated;

-- closing an owner action: an owner, with PASS evidence of every check the action names
create or replace function public.acceptance_close_action(p_action integer, p_evidence uuid[], p_note text) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); a public.acceptance_owner_actions; missing text[];
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'owner' and not disabled) then
    raise exception 'Only an owner closes an owner action' using errcode = '42501'; end if;
  select * into a from public.acceptance_owner_actions x where x.id = p_action;
  if not found then raise exception 'Owner action % not found', p_action using errcode = 'P0002'; end if;
  if exists (select 1 from unnest(coalesce(p_evidence, '{}')) e where not exists (
      select 1 from public.acceptance_evidence x where x.id = e and x.status = 'PASS' and x.check_id = any (a.closes_with))) then
    raise exception 'The evidence does not belong to this action, or is not a PASS' using errcode = '22023'; end if;
  select array_agg(c) into missing from unnest(a.closes_with) c
   where not exists (select 1 from public.acceptance_evidence x where x.id = any (coalesce(p_evidence, '{}')) and x.check_id = c);
  if missing is not null then raise exception 'Evidence is still missing for: %', array_to_string(missing, ', ') using errcode = '22023'; end if;
  insert into public.acceptance_owner_action_events(action_id, event, evidence_ids, note, actor) values (p_action, 'closed', p_evidence, p_note, me);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.acceptance_close_action(integer, uuid[], text) from public, anon;
grant execute on function public.acceptance_close_action(integer, uuid[], text) to authenticated;

create or replace function public.acceptance_reopen_action(p_action integer, p_note text) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'owner' and not disabled) then
    raise exception 'Only an owner reopens an owner action' using errcode = '42501'; end if;
  insert into public.acceptance_owner_action_events(action_id, event, note, actor) values (p_action, 'reopened', p_note, me);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.acceptance_reopen_action(integer, text) from public, anon;
grant execute on function public.acceptance_reopen_action(integer, text) to authenticated;

create or replace function public.acceptance_comment(p_target text, p_body text) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'owner' and not disabled) then
    raise exception 'Only an owner comments on acceptance evidence' using errcode = '42501'; end if;
  insert into public.acceptance_comments(target, body, author) values (p_target, p_body, me);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.acceptance_comment(text, text) from public, anon;
grant execute on function public.acceptance_comment(text, text) to authenticated;

-- 7. automatic change log: policy approvals, roles, capabilities, MFA enforcement ---------------------------------------
create or replace function public.acceptance_log_change() returns trigger language plpgsql security definer set search_path = public as $$
declare env text := public.acceptance_env(); who text := coalesce(auth.uid()::text, 'service');
begin
  -- one branch per table: a condition naming another table's column is only evaluated inside its own branch
  if tg_table_name = 'approval_policies' then
    if new.config_status = 'Approved' and old.config_status is distinct from 'Approved' then
      insert into public.acceptance_env_changes(environment, category, what, actor, reference) values (env, 'policy_approval', format('policy %s v%s approved', new.code, new.version), who, new.code);
    end if;
  elsif tg_table_name = 'profiles' then
    if new.role is distinct from old.role or new.disabled is distinct from old.disabled or new.us_person is distinct from old.us_person then
      insert into public.acceptance_env_changes(environment, category, what, actor, reference) values (env, 'role_change',
        format('account %s: %s', left(new.id::text, 8), concat_ws(', ', case when new.role is distinct from old.role then format('role %s → %s', old.role, new.role) end,
          case when new.disabled is distinct from old.disabled then case when new.disabled then 'switched off' else 'switched on' end end,
          case when new.us_person is distinct from old.us_person then format('US person %s', new.us_person) end)), who, left(new.id::text, 8));
    end if;
  elsif tg_table_name = 'crm_caps' then
    if tg_op = 'INSERT' or new.revoked_at is distinct from old.revoked_at then
      insert into public.acceptance_env_changes(environment, category, what, actor, reference) values (env, 'role_change',
        format('capability %s %s for account %s', new.cap, case when new.revoked_at is null then 'granted' else 'revoked' end, left(new.user_id::text, 8)), who, new.cap);
    end if;
  elsif tg_table_name = 'security_settings' then
    if new.mfa_required is distinct from old.mfa_required then
      insert into public.acceptance_env_changes(environment, category, what, actor) values (env, 'mfa', case when new.mfa_required then 'two-step sign-in required for owners and administrators' else 'two-step sign-in no longer required' end, who);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.acceptance_log_change() from public, anon, authenticated;
drop trigger if exists acceptance_log on public.approval_policies;
create trigger acceptance_log after update on public.approval_policies for each row execute function public.acceptance_log_change();
drop trigger if exists acceptance_log on public.profiles;
create trigger acceptance_log after update on public.profiles for each row execute function public.acceptance_log_change();
drop trigger if exists acceptance_log on public.crm_caps;
create trigger acceptance_log after insert or update on public.crm_caps for each row execute function public.acceptance_log_change();
drop trigger if exists acceptance_log on public.security_settings;
create trigger acceptance_log after update on public.security_settings for each row execute function public.acceptance_log_change();

-- 8. post-restore integrity: triggers enabled, constraints valid, functions present, row-level security on ------------
--    (tables named _* and functions named _p9_* are operator test helpers of a staging project, not part of Workspace)
create or replace function public.acceptance_integrity() returns jsonb
  language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'triggers', (select jsonb_build_object('total', count(*), 'disabled', coalesce(jsonb_agg(c.relname || '.' || t.tgname) filter (where t.tgenabled = 'D'), '[]'),
                   'fingerprint', md5(coalesce(string_agg(c.relname || '.' || t.tgname, ',' order by c.relname, t.tgname), '')))
                 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal and c.relname not like '\_%'),
    'constraints', (select jsonb_build_object('total', count(*), 'not_valid', coalesce(jsonb_agg(c.relname || '.' || k.conname) filter (where not k.convalidated), '[]'),
                   'fingerprint', md5(coalesce(string_agg(c.relname || '.' || k.conname, ',' order by c.relname, k.conname), '')))
                 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname not like '\_%'),
    'functions', (select jsonb_build_object('total', count(*), 'fingerprint', md5(coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ',' order by p.proname, pg_get_function_identity_arguments(p.oid)), '')))
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname not like '\_p9\_%'),
    'rls', (select jsonb_build_object('tables', count(*), 'without_rls', coalesce(jsonb_agg(c.relname) filter (where not c.relrowsecurity), '[]'),
                   'policies', (select count(*) from pg_policies where schemaname = 'public' and tablename not like '\_%'))
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\_%'),
    'schema_fingerprint', (select md5(string_agg(table_name || '.' || column_name || ':' || data_type, ',' order by table_name, ordinal_position)) from information_schema.columns where table_schema = 'public' and table_name not like '\_%'),
    'db_version', public.workspace_db_version(),
    'at', now())
$$;
revoke all on function public.acceptance_integrity() from public, anon, authenticated;
grant execute on function public.acceptance_integrity() to service_role;

-- 9. live state for the Evidence Center (server only; the page is for owners and administrators) -------------------
create or replace function public.acceptance_live() returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare r jsonb; mfa jsonb; mfa_req boolean := coalesce((select mfa_required from public.security_settings limit 1), false);
begin
  r := jsonb_build_object('at', now(), 'db_version', public.workspace_db_version(), 'environment', public.acceptance_env());
  r := r || jsonb_build_object('policies', (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'version', p.version, 'status', p.config_status,
      'active', p.active, 'seeded', p.seeded, 'approved_by', (select full_name from public.profiles where id = p.approved_by), 'approved_at', p.approved_at,
      'approved_version', p.approved_version, 'owner_approved', p.config_status = 'Approved' and exists (select 1 from public.profiles where id = p.approved_by and role = 'owner'),
      'currency', (select string_agg(distinct coalesce(x->>'currency', x->'when'->>'currency'), ',') from jsonb_array_elements(p.tiers) x where coalesce(x->>'currency', x->'when'->>'currency') is not null),
      'chain', (select jsonb_agg(jsonb_build_object('tier', x->>'label', 'mode', x->>'mode',
                  'steps', (select jsonb_agg(coalesce(s->>'label', s->>'kind')) from jsonb_array_elements(coalesce(x->'steps', '[]'::jsonb)) s))) from jsonb_array_elements(p.tiers) x)) order by p.code), '[]')
    from public.approval_policies p));
  r := r || jsonb_build_object('access', (select jsonb_build_object(
      'active', count(*) filter (where not p.disabled and p.role <> 'pending'),
      'disabled', count(*) filter (where p.disabled),
      'pending', count(*) filter (where p.role = 'pending' and not p.disabled),
      'owners', count(*) filter (where p.role = 'owner' and not p.disabled),
      'admins', count(*) filter (where p.role = 'admin' and not p.disabled),
      'external', count(*) filter (where p.role in ('partner', 'vendor', 'investor') and not p.disabled),
      'controlled_data_users', count(*) filter (where p.us_person and not p.disabled and p.role <> 'pending'),
      'mfa_required', mfa_req,
      'requiring_mfa', count(*) filter (where p.role in ('owner', 'admin') and not p.disabled))
    from public.profiles p));
  -- enrolled second factors (the sign-in service's own table; absent on a stack without MFA support)
  if to_regclass('auth.mfa_factors') is not null then
    execute $q$select jsonb_build_object(
        'with_mfa', count(*) filter (where not p.disabled and exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified')),
        'privileged_with_mfa', count(*) filter (where p.role in ('owner', 'admin') and not p.disabled and exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified')))
      from public.profiles p$q$ into mfa;
    r := jsonb_set(r, '{access}', (r->'access') || mfa);
  else
    r := jsonb_set(r, '{access}', (r->'access') || jsonb_build_object('with_mfa', null, 'privileged_with_mfa', null, 'mfa_factors', 'not readable in this environment'));
  end if;
  if to_regclass('public.crm_caps') is not null then
    r := jsonb_set(r, '{access,authorities}', (select jsonb_build_object(
      'policy_approvers', (select count(distinct user_id) from public.crm_caps c join public.profiles p on p.id = c.user_id where c.cap = 'policy_approver' and c.revoked_at is null and not p.disabled),
      'commercial', (select count(distinct user_id) from public.crm_caps c join public.profiles p on p.id = c.user_id where c.cap in ('commercial_admin', 'proposal_approver', 'pricing_approver', 'export_commercial') and c.revoked_at is null and not p.disabled),
      'manufacturing', (select count(distinct user_id) from public.crm_caps c join public.profiles p on p.id = c.user_id where c.cap = any (public.mfg_cap_names()) and c.revoked_at is null and not p.disabled))));
    -- separation-of-duty conflicts (SYSTEM DEFAULT rule set): one person both prepares and approves the same thing,
    -- or a System Administrator holds a business approval capability
    r := jsonb_set(r, '{access,conflicts}', (select coalesce(jsonb_agg(jsonb_build_object('rule', rule, 'accounts', n)) filter (where n > 0), '[]') from (
      select 'BOM Editor and BOM Approver' rule, count(*) n from (select user_id from public.crm_caps where revoked_at is null and cap in ('bom_editor', 'bom_approver') group by user_id having count(distinct cap) = 2) a
      union all select 'Quality Inspector and Quality Approver', count(*) from (select user_id from public.crm_caps where revoked_at is null and cap in ('quality_inspector', 'quality_approver') group by user_id having count(distinct cap) = 2) b
      union all select 'Test Operator and Test Approver', count(*) from (select user_id from public.crm_caps where revoked_at is null and cap in ('test_operator', 'test_approver') group by user_id having count(distinct cap) = 2) c
      union all select 'System Administrator holding a business approval capability', count(distinct c.user_id) from public.crm_caps c join public.profiles p on p.id = c.user_id
        where c.revoked_at is null and p.role = 'admin' and c.cap in ('policy_approver', 'proposal_approver', 'pricing_approver', 'bom_approver', 'quality_approver', 'test_approver', 'engineering_change_approver', 'unit_acceptance_approver', 'shipment_release_approver')) x));
  end if;
  r := r || jsonb_build_object('backup', jsonb_build_object(
      'state', (select value - 'counts' from public.ops_state where key = 'backup'),
      'last_job', (select jsonb_build_object('status', status, 'started_at', started_at, 'finished_at', finished_at, 'error', left(coalesce(error, ''), 200)) from public.job_runs where job = 'backup' order by started_at desc limit 1),
      'last_success', (select max(finished_at) from public.job_runs where job = 'backup' and status = 'completed')));
  r := r || jsonb_build_object('integrity', public.acceptance_integrity());
  return r;
end $$;
revoke all on function public.acceptance_live() from public, anon, authenticated;
grant execute on function public.acceptance_live() to service_role;

-- 10. the P9 check catalog ------------------------------------------------------------------------------------------
insert into public.acceptance_checks(id, phase, name, kind, freshness, envs, gates, mandatory, params, attestable, sort, description) values
  ('P9.REG.FULL', 'P9', 'Full clean regression (P1–P9 + R2)', 'regression', 'release', '{}', '{development,staging,production}', true,
     '{"scope": ["P1","P2","P3","P4","P5","P6","P7","P8","P9","P9-R2"]}', false, 10, 'One complete run in a freshly created isolated environment, no isolated reruns.'),
  ('P9.UNIT', 'P9', 'Unit tests', 'unit', 'release', '{}', '{development,staging,production}', true, '{}', false, 11, null),
  ('P9.BUILD', 'P9', 'Production build', 'build', 'release', '{}', '{development,staging,production}', true, '{}', false, 12, null),
  ('P9.TYPECHECK', 'P9', 'TypeScript', 'typecheck', 'release', '{}', '{development,staging,production}', true, '{}', false, 13, null),
  ('P9.AUDIT', 'P9', 'Dependency audit', 'audit', 'release', '{}', '{development,staging,production}', true, '{}', false, 14, null),
  ('P9.SEC.RLS', 'P9', 'Row-level security suite', 'suite', 'release', '{}', '{development,staging,production}', true, '{"from": "P9.REG.FULL", "suites": ["rls"]}', false, 20, null),
  ('P9.SEC.RESTRICTED', 'P9', 'Restricted-data leakage suite (known ID, non-US, external, disabled)', 'suite', 'release', '{}', '{development,staging,production}', true, '{"from": "P9.REG.FULL", "suites": ["p9", "p8", "p7"]}', false, 21, null),
  ('P9.SEC.CAPS', 'P9', 'Capability separation suite', 'suite', 'release', '{}', '{development,staging,production}', true, '{"from": "P9.REG.FULL", "suites": ["p7", "p8", "p9"]}', false, 22, null),
  ('P9.SEC.ENV', 'P9', 'Environment isolation (routing fails closed)', 'suite', 'release', '{}', '{development,staging,production}', true, '{"from": "P9.UNIT", "suites": ["p9"]}', false, 23, null),
  ('P9.REG.APP', 'P9', 'Application refuses uninvited accounts', 'suite', 'release', '{}', '{development,staging,production}', true, '{"from": "P9.REG.FULL", "suites": ["p9"]}', false, 24, null),
  ('P9.ENV.PREVIEW', 'P9', 'Preview → production isolation (live)', 'probe_isolation', 'environment', '{preview,staging}', '{staging,production}', true, '{}', false, 25, 'A preview build that inherits production settings refuses them (health 503).'),
  ('P9.SEC.STAGING', 'P9', 'Staging security suite (direct ID, aggregates, files, exports)', 'security_suite', 'environment', '{staging}', '{staging,production}', true, '{}', false, 30, null),
  ('P9.STAGING.DEPLOYED', 'P9', 'Staging deployed and healthy', 'staging_deployed', 'environment', '{staging}', '{staging,production}', true, '{}', false, 31, null),
  ('P9.PERSONAS.STAGING', 'P9', 'Synthetic test personas on staging', 'personas', 'environment', '{staging}', '{staging}', true, '{"min": 13}', false, 32, null),
  ('P9.SIGNUP.STAGING', 'P9', 'Public sign-up disabled — staging', 'signup', 'operational', '{staging}', '{staging,production}', true, '{}', false, 33, null),
  ('P9.SIGNUP.PRODUCTION', 'P9', 'Public sign-up disabled — production', 'signup', 'operational', '{production}', '{production}', true, '{}', false, 34, null),
  ('P9.MFA.LIVE.STAGING', 'P9', 'MFA live verification — staging (8 steps)', 'mfa_live', 'validation', '{staging}', '{staging,production}', true, '{}', true, 35, null),
  ('P9.MFA.LIVE.PRODUCTION', 'P9', 'MFA live verification — production (8 steps)', 'mfa_live', 'validation', '{production}', '{production}', true, '{}', true, 36, null),
  ('P9.MFA.COVERAGE.PRODUCTION', 'P9', 'MFA required and every owner/admin enrolled — production', 'mfa_coverage', 'live', '{production}', '{production}', true, '{}', false, 37, null),
  ('P9.PERF.STAGING', 'P9', 'Production-grade performance on staging', 'performance', 'environment', '{staging,production}', '{staging,production}', true, '{}', false, 40, null),
  ('P9.ENDURANCE', 'P9', '24-hour endurance on staging', 'endurance', 'environment', '{staging}', '{staging,production}', true, '{"min_minutes": 1440}', false, 41, null),
  ('P9.USERS', 'P9', 'Real-user validation', 'real_users', 'validation', '{staging,production}', '{staging,production}', true, '{}', true, 42, null),
  ('P9.DEVICES', 'P9', 'Real-device validation', 'real_devices', 'validation', '{staging,production}', '{staging,production}', true, '{"classes": ["phone", "tablet", "desktop"]}', true, 43, null),
  ('P9.BACKUP.STAGING', 'P9', 'Backup artifact — staging', 'backup_artifact', 'operational', '{staging}', '{staging}', true, '{}', false, 50, null),
  ('P9.RESTORE.LOCAL', 'P9', 'Restore drill — local stack', 'restore_drill', 'release', '{local}', '{}', false, '{}', false, 51, 'Informational: a local drill never certifies a hosted restore.'),
  ('P9.RESTORE.STAGING', 'P9', 'Restore drill — hosted (staging backup into a fresh project)', 'restore_drill', 'environment', '{staging}', '{staging,production}', true, '{}', false, 52, null),
  ('P9.BACKUP.PRODUCTION', 'P9', 'Backup artifact — production (encrypted, verified, off-project)', 'backup_artifact', 'operational', '{production}', '{production}', true, '{"offsite": true}', false, 53, null),
  ('P9.MIGRATION.SYNTHETIC', 'P9', 'Migration rehearsal — synthetic', 'migration', 'release', '{}', '{staging}', true, '{"source": "synthetic"}', false, 60, null),
  ('P9.PRODCOPY.AUTHORIZATION', 'P9', 'Written authorisation of a protected production copy', 'owner_attestation', 'validation', '{production}', '{production}', true, '{}', true, 61, null),
  ('P9.MIGRATION.PRODCOPY', 'P9', 'Migration rehearsal — protected production copy', 'migration', 'release', '{production-copy}', '{production}', true, '{"source": "production_copy"}', false, 62, null),
  ('P9.POLICIES.REVIEWED', 'P9', 'Business policies reviewed by the owner', 'owner_attestation', 'validation', '{production}', '{production}', true, '{}', true, 70, null),
  ('P9.POLICIES.PRODUCTION', 'P9', 'Business policies owner-approved — production', 'policies', 'live', '{production}', '{production}', true, '{}', false, 71, null),
  ('P9.ACCESS.PRODUCTION', 'P9', 'Access matrix complete, no unresolved conflicts — production', 'access_matrix', 'validation', '{production}', '{production}', true, '{}', true, 72, null),
  ('P9.STAGING.RESOURCES', 'P9', 'Staging resources decided', 'owner_attestation', 'validation', '{staging}', '{staging}', true, '{}', true, 80, null),
  ('P9.PLAN.VERCEL', 'P9', 'Vercel plan suitable for production', 'owner_attestation', 'validation', '{production}', '{production}', true, '{}', true, 81, null),
  ('P9.PLAN.SUPABASE', 'P9', 'Supabase production plan with backups', 'owner_attestation', 'validation', '{production}', '{production}', true, '{}', true, 82, null),
  ('P9.REPO.PRIVATE', 'P9', 'Repository private', 'owner_attestation', 'validation', '{production}', '{production}', true, '{}', true, 83, null),
  ('P9.READINESS.REVIEWED', 'P9', 'Production readiness reviewed by the owner', 'owner_attestation', 'validation', '{production}', '{production}', true, '{}', true, 84, null),
  ('P9.PROD.TOUCH', 'P9', 'Production touch probe (deployment, database version)', 'production_touch', 'operational', '{production}', '{}', false, '{}', false, 90, null),
  ('P9.LIVE.AUTHORIZATION', 'P9', 'Owner authorisation of the production deployment', 'owner_authorization', 'release', '{production}', '{live}', true, '{}', true, 95, null),
  ('P9.LIVE.DEPLOYED', 'P9', 'Production deployment completed', 'production_deploy', 'release', '{production}', '{live}', true, '{}', false, 96, null),
  ('P9.LIVE.SMOKE', 'P9', 'Production smoke test', 'production_smoke', 'release', '{production}', '{live}', true, '{}', false, 97, null),
  ('P9.LIVE.PILOT', 'P9', 'Pilot acceptance', 'pilot', 'validation', '{production}', '{live}', false, '{}', true, 98, 'Mandatory only when the gates setting requires a pilot.')
on conflict (id) do update set phase = excluded.phase, name = excluded.name, kind = excluded.kind, freshness = excluded.freshness, envs = excluded.envs, gates = excluded.gates,
  mandatory = excluded.mandatory, params = excluded.params, attestable = excluded.attestable, sort = excluded.sort, description = excluded.description;

-- 11. the 22 owner actions of P9-R1 ------------------------------------------------------------------------------------
insert into public.acceptance_owner_actions(id, category, title, action, where_, why, blocks_staging, blocks_production, closure_evidence, closes_with) values
  (1, 'Critical now', 'Upgrade Vercel', 'Move the team to a plan suitable for commercial production use', 'Vercel → Settings → Billing', 'Hobby is for non-commercial use and keeps runtime logs 1 hour', false, true, 'Owner attestation of the plan', '{P9.PLAN.VERCEL}'),
  (2, 'Critical now', 'Upgrade Supabase production', 'Move the production project to a plan with daily backups', 'Supabase → Organization → Billing', 'Production has no backup', false, true, 'Owner attestation of the plan', '{P9.PLAN.SUPABASE}'),
  (3, 'Critical now', 'Decide staging resources', 'Keep the staging project on its plan or upgrade it', 'Supabase → staging project', 'Staging must stay awake for the 24-hour run', true, true, 'Owner attestation of the decision', '{P9.STAGING.RESOURCES}'),
  (4, 'Critical now', 'Close public registration', 'Switch off "Allow new users to sign up" in staging and production', 'Supabase → Authentication → Sign In / Providers', 'Anyone can create an account today', true, true, 'System probe: sign-up disabled in both projects', '{P9.SIGNUP.STAGING,P9.SIGNUP.PRODUCTION}'),
  (5, 'Critical now', 'Make the repository private', 'Clear the blockers, then change visibility', 'GitHub → Settings → Danger zone', 'The code is public', false, true, 'Owner attestation of the visibility', '{P9.REPO.PRIVATE}'),
  (6, 'Critical now', 'Activate production backup', 'Configure the encrypted off-project backup and let it run', 'Vercel environment variables; off-site store', 'Losing data without a backup is permanent', false, true, 'Backup job evidence: verified off-project artifact', '{P9.BACKUP.PRODUCTION}'),
  (7, 'Staging', 'Enter staging secrets', 'Enter the staging keys and secrets (names in Appendix A)', 'Vercel → Environment Variables → Preview (branch)', 'Staging refuses the inherited production key', true, true, 'Staging deployed and healthy', '{P9.STAGING.DEPLOYED}'),
  (8, 'Staging', 'Deploy staging', 'Redeploy the staging preview', 'Vercel → Deployments', 'Variables apply to a new build only', true, true, 'Staging deployed and healthy', '{P9.STAGING.DEPLOYED}'),
  (9, 'Staging', 'Create test accounts', 'Run scripts/p9/staging-personas.mjs against staging', 'Your computer, staging keys', 'The staging suites sign in as these personas', true, true, 'Personas evidence on staging', '{P9.PERSONAS.STAGING}'),
  (10, 'Staging', 'Enroll MFA', 'Run the 8-step MFA checklist on staging, then for every production owner', 'My profile → Sign-in protection', 'Owner accounts without a second factor', true, true, 'MFA live attestations for staging and production', '{P9.MFA.LIVE.STAGING,P9.MFA.LIVE.PRODUCTION}'),
  (11, 'Business', 'Review nine policies', 'Review the seeded approval policies', 'Business policy review document', 'The seeded values are not AGRON policy', false, true, 'Owner attestation of the review', '{P9.POLICIES.REVIEWED}'),
  (12, 'Business', 'Approve or edit policies', 'Approve each policy (or edit, then approve)', 'Operations → Process builder → Approval authority', 'Real requests must follow approved rules', false, true, 'System state: every policy owner-approved', '{P9.POLICIES.PRODUCTION}'),
  (13, 'Business', 'Assign capabilities', 'Fill the access matrix and enter it', 'Admin → Users', 'Nobody has a capability from a job title', false, true, 'Access matrix attestation', '{P9.ACCESS.PRODUCTION}'),
  (14, 'Validation', 'Real-user test', 'Three people do the task set on staging', 'Staging', 'Only people show whether the work is clear', true, true, 'Real-user attestation', '{P9.USERS}'),
  (15, 'Validation', 'Real-device test', 'iPhone, tablet and desktop checks on real hardware', 'Staging', 'Emulation does not count', true, true, 'Real-device attestation', '{P9.DEVICES}'),
  (16, 'Validation', 'Staging performance', 'Run scripts/p9/staging-perf.mjs against staging', 'Staging', 'Times from the hosted database', true, true, 'Performance evidence on staging', '{P9.PERF.STAGING}'),
  (17, 'Validation', '24-hour endurance', 'Run scripts/p9/endurance.mjs HOURS=24 against staging', 'Staging', 'Leaks and slowdowns need a long run', true, true, 'Endurance evidence of at least 24 hours', '{P9.ENDURANCE}'),
  (18, 'Validation', 'Backup and restore drill', 'Back up staging and restore it into a fresh project', 'Staging + a fresh project', 'An untested backup is not a backup', true, true, 'Hosted restore drill evidence', '{P9.RESTORE.STAGING}'),
  (19, 'Production rehearsal', 'Authorize protected production copy', 'Authorize in writing a private copy of production', 'Supabase → Database → Backups → Restore to new project', 'The migration must run on real data first', false, true, 'Owner attestation of the authorisation', '{P9.PRODCOPY.AUTHORIZATION}'),
  (20, 'Production rehearsal', 'Migration/rollback rehearsal', 'Run scripts/p9/rehearse-copy.sh on the copy', 'The copy project', 'Proves the upgrade keeps every record and can be undone', false, true, 'Production-copy rehearsal evidence', '{P9.MIGRATION.PRODCOPY}'),
  (21, 'Final', 'Review Production Readiness report', 'Review the acceptance package', 'System → Acceptance Evidence', 'Decide on the evidence', false, true, 'Owner attestation of the review', '{P9.READINESS.REVIEWED}'),
  (22, 'Final', 'Authorize or refuse production deployment', 'Explicit written decision', 'System → Acceptance Evidence', 'Production changes only on the owner''s word', false, false, 'Owner authorisation for the exact release', '{P9.LIVE.AUTHORIZATION}')
on conflict (id) do update set category = excluded.category, title = excluded.title, action = excluded.action, where_ = excluded.where_, why = excluded.why,
  blocks_staging = excluded.blocks_staging, blocks_production = excluded.blocks_production, closure_evidence = excluded.closure_evidence, closes_with = excluded.closes_with;

-- 12. operations statistics report the new version ------------------------------------------------------------------
create or replace function public.ops_db_stats() returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare r jsonb := jsonb_build_object('at', now(), 'db_version', public.workspace_db_version(),
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

-- this migration is itself an environment change
insert into public.acceptance_env_changes(environment, category, what, source)
  select public.acceptance_env(), 'db_migration', 'database migrated to v27 (acceptance evidence)', 'migration'
   where not exists (select 1 from public.acceptance_env_changes where category = 'db_migration' and what like 'database migrated to v27%');

commit;
