-- v18 — Phase 1: production reliability and security.
-- Safe to run more than once. Keeps every existing record. Rollback: supabase/rollback-v18.sql.
-- New tables are server-only (row-level security on, no policies for signed-in users); the server reaches them
-- with the service key. All new functions run only for the service role unless stated otherwise.
set client_min_messages = warning;
begin;

/* ---------------------------------------------------------------------------------------------
   0. Drift: protect_profile as it runs in production (protected owner), plus the new protected columns
   --------------------------------------------------------------------------------------------- */
alter table public.profiles add column if not exists disabled boolean not null default false;
alter table public.profiles add column if not exists sessions_revoked_at timestamptz;

create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- server (service key) and SQL editor
  if new.super is distinct from old.super then
    raise exception 'The protected-owner flag can only be changed in the database';
  end if;
  if old.super and auth.uid() <> old.id and (new.role is distinct from old.role or new.us_person is distinct from old.us_person
     or new.company is distinct from old.company or new.ai_monthly_tokens is distinct from old.ai_monthly_tokens or new.email is distinct from old.email
     or new.disabled is distinct from old.disabled or new.sessions_revoked_at is distinct from old.sessions_revoked_at) then
    raise exception 'This owner account is protected and cannot be changed by other users';
  end if;
  if not public.is_admin() and (new.role is distinct from old.role or new.us_person is distinct from old.us_person
     or new.company is distinct from old.company or new.ai_monthly_tokens is distinct from old.ai_monthly_tokens
     or new.email is distinct from old.email or new.id is distinct from old.id
     or new.disabled is distinct from old.disabled or new.sessions_revoked_at is distinct from old.sessions_revoked_at) then
    raise exception 'Only administrators can change roles and access';
  end if;
  if old.role = 'owner' and new.role <> 'owner' and (select count(*) from public.profiles where role = 'owner') <= 1 then
    raise exception 'The workspace must keep at least one owner';
  end if;
  if new.role = 'owner' and old.role <> 'owner' and coalesce((select role from public.profiles where id = auth.uid()), '') <> 'owner' then
    raise exception 'Only an owner can appoint another owner';
  end if;
  return new;
end $$;
revoke execute on function public.protect_profile() from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   1. Operational state (replaces the JSON files kept in Storage) and idempotency keys
   --------------------------------------------------------------------------------------------- */
create table if not exists public.ops_state (
  key text primary key, value jsonb not null, version integer not null default 1, updated_at timestamptz not null default now()
);
-- "already done" keys: a notice, a rule run, a digest — claimed atomically so nothing happens twice
create table if not exists public.automation_fired (
  key text primary key, fired_on date not null default current_date, times integer not null default 1, updated_at timestamptz not null default now()
);
create index if not exists automation_fired_on_idx on public.automation_fired(fired_on);

/* ---------------------------------------------------------------------------------------------
   2. Automation: settings, rules, queue, log, outbound e-mail delivery
   --------------------------------------------------------------------------------------------- */
create table if not exists public.automation_settings (
  id boolean primary key default true check (id), value jsonb not null default '{}'::jsonb, version integer not null default 1,
  updated_at timestamptz not null default now(), updated_by text
);
create table if not exists public.automation_rules (
  id text primary key, position integer not null default 0, rule jsonb not null, updated_at timestamptz not null default now(), updated_by text
);
create table if not exists public.automation_queue (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent text not null, title text not null, detail text, record_id uuid, section text,
  action jsonb not null, controlled boolean not null default false,
  dedupe_key text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'retrying', 'dead', 'rejected')),
  decided_by text, decided_at timestamptz,
  exec_id uuid, attempts integer not null default 0, max_attempts integer not null default 5,
  next_attempt_at timestamptz, claimed_at timestamptz, finished_at timestamptz,
  result text, last_error text, updated_at timestamptz not null default now()
);
-- a proposal waiting or already rejected is never proposed twice
create unique index if not exists automation_queue_dedupe on public.automation_queue(dedupe_key) where dedupe_key is not null and status in ('pending', 'rejected');
create index if not exists automation_queue_status_idx on public.automation_queue(status, next_attempt_at);
create index if not exists automation_queue_created_idx on public.automation_queue(created_at desc);
create index if not exists automation_queue_record_idx on public.automation_queue(record_id);

create table if not exists public.automation_log (
  id bigserial primary key, at timestamptz not null default now(), agent text not null, kind text not null, text text not null,
  record_id uuid, section text, run_id uuid
);
create index if not exists automation_log_at_idx on public.automation_log(at desc);

-- every e-mail to an outside address has one durable delivery row; the idempotency key stops a second send
create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(), idem_key text not null unique, queue_id uuid references public.automation_queue(id) on delete set null,
  to_addr text not null, subject text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'uncertain', 'cancelled')),
  attempts integer not null default 0, provider_id text, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), sent_at timestamptz,
  resolved_by text, resolved_at timestamptz
);
create index if not exists outbound_status_idx on public.outbound_messages(status, updated_at);

/* ---------------------------------------------------------------------------------------------
   3. Scheduled jobs: one row per attempt; at most one running copy per job; a finished slot is never repeated
   --------------------------------------------------------------------------------------------- */
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(), job text not null, slot text, trigger text not null default 'cron',
  status text not null check (status in ('running', 'completed', 'failed', 'timeout', 'dead')),
  attempt integer not null default 1, started_at timestamptz not null default now(), heartbeat_at timestamptz not null default now(),
  finished_at timestamptz, duration_ms integer, error text, result jsonb
);
create unique index if not exists job_runs_one_running on public.job_runs(job) where status = 'running';
create unique index if not exists job_runs_slot_done on public.job_runs(job, slot) where status = 'completed' and slot is not null;
create index if not exists job_runs_job_idx on public.job_runs(job, started_at desc);

/* ---------------------------------------------------------------------------------------------
   4. Request limits (public links, AI and other expensive calls)
   --------------------------------------------------------------------------------------------- */
create table if not exists public.rate_limits (
  bucket text not null, window_start timestamptz not null, hits integer not null default 0, primary key (bucket, window_start)
);

/* ---------------------------------------------------------------------------------------------
   5. Records: version for conflict-safe saves; idempotency key for records made by automation
   --------------------------------------------------------------------------------------------- */
alter table public.records add column if not exists version integer not null default 1;
create unique index if not exists records_idem_key on public.records((data->>'_idem')) where data ? '_idem';

create or replace function public.log_record_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    insert into public.activity(record_id, section, actor, action, detail) values (new.id, new.section, auth.uid(), 'created', jsonb_build_object('title', new.title, 'status', new.status));
  elsif tg_op = 'UPDATE' then
    -- Only the translations changed: keep the time, the version and the log as they are
    if new.title is not distinct from old.title and new.status is not distinct from old.status
       and new.company is not distinct from old.company and new.controlled is not distinct from old.controlled
       and (new.data - '_tr') is not distinct from (old.data - '_tr') then
      new.updated_at := old.updated_at; new.version := old.version;
      return new;
    end if;
    new.updated_at := now(); new.version := old.version + 1;
    insert into public.activity(record_id, section, actor, action, detail) values (new.id, new.section, auth.uid(),
      case when new.status is distinct from old.status then 'status' else 'updated' end,
      jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status, 'version', new.version));
  elsif tg_op = 'DELETE' then
    insert into public.activity(record_id, section, actor, action, detail) values (old.id, old.section, auth.uid(), 'deleted', jsonb_build_object('title', old.title));
    return old;
  end if;
  return new;
end $$;
revoke execute on function public.log_record_change() from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   6. Sessions and multi-factor sign-in
   --------------------------------------------------------------------------------------------- */
create table if not exists public.security_settings (
  id boolean primary key default true check (id), mfa_required boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid
);
insert into public.security_settings(id) values (true) on conflict do nothing;

-- true when this signed-in session may use data: account active, session not revoked, and for owner/admin a
-- two-factor session once the owner switches enforcement on (Administration → Users → Security)
create or replace function public.session_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then true else coalesce((
    select not p.disabled
       and (p.sessions_revoked_at is null or coalesce((auth.jwt()->>'iat')::bigint, 0) > floor(extract(epoch from p.sessions_revoked_at))::bigint)
       and (p.role not in ('owner', 'admin')
            or not coalesce((select s.mfa_required from public.security_settings s where s.id), false)
            or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2')
    from public.profiles p where p.id = auth.uid()), true) end
$$;
revoke execute on function public.session_ok() from public, anon;
grant execute on function public.session_ok() to authenticated, service_role;

-- restrictive policies: every user-facing table also requires an allowed session
do $$ declare t text; begin
  foreach t in array array['records', 'comments', 'activity', 'approvals', 'doc_pages', 'faq', 'section_access', 'records_trash', 'ai_usage', 'push_subs', 'calendar_feeds', 'gcal_links', 'app_errors'] loop
    execute format('drop policy if exists p_session_%1$s on public.%1$I', t);
    execute format('create policy p_session_%1$s on public.%1$I as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()))', t);
  end loop;
end $$;
-- a person can always read their own profile (to see that the session needs a second factor or was ended)
drop policy if exists p_session_profiles on public.profiles;
create policy p_session_profiles on public.profiles as restrictive for all to authenticated
  using (id = (select auth.uid()) or (select public.session_ok())) with check ((select public.session_ok()));
drop policy if exists p_session_files on storage.objects;
create policy p_session_files on storage.objects as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));

alter table public.security_settings enable row level security;
drop policy if exists p_security_read on public.security_settings;
create policy p_security_read on public.security_settings for select to authenticated using (true);

-- end every session of a person now (server only): tokens issued before this moment stop working
create or replace function public.revoke_sessions(p_user uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  update public.profiles set sessions_revoked_at = t where id = p_user;
  begin
    delete from auth.refresh_tokens where user_id::text = p_user::text;
    delete from auth.sessions where user_id = p_user;
  exception when others then null; -- without rights on the auth schema the timestamp alone still cuts the access
  end;
  return t;
end $$;

/* ---------------------------------------------------------------------------------------------
   7. Links: hashed tokens, revocation, expiry
   --------------------------------------------------------------------------------------------- */
alter table public.approvals add column if not exists token_hash text;
alter table public.approvals alter column token drop not null;
update public.approvals set token_hash = encode(extensions.digest(token, 'sha256'), 'hex'), token = null where token is not null and token_hash is null;
create unique index if not exists approvals_token_hash_idx on public.approvals(token_hash) where token_hash is not null;

alter table public.calendar_feeds add column if not exists token_hash text;
alter table public.calendar_feeds add column if not exists expires_at timestamptz default (now() + interval '365 days');
alter table public.calendar_feeds add column if not exists revoked_at timestamptz;
alter table public.calendar_feeds alter column token drop not null;
update public.calendar_feeds set token_hash = encode(extensions.digest(token, 'sha256'), 'hex'), token = null where token is not null and token_hash is null;
create unique index if not exists calendar_feeds_token_hash_idx on public.calendar_feeds(token_hash) where token_hash is not null;

/* ---------------------------------------------------------------------------------------------
   8. Server functions (service role only)
   --------------------------------------------------------------------------------------------- */
-- claim "already done" keys: returns the keys this call may act on (new, or older than its repeat interval)
create or replace function public.automation_claim_keys(p_keys text[], p_repeat integer[]) returns setof text
language plpgsql security definer set search_path = public as $$
declare i integer;
begin
  for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
    return query
      insert into public.automation_fired as f(key, fired_on) values (p_keys[i], current_date)
      on conflict (key) do update set fired_on = current_date, times = f.times + 1, updated_at = now()
        where p_repeat[i] is not null and f.fired_on <= current_date - p_repeat[i]
      returning f.key;
  end loop;
end $$;

-- new proposals; a waiting or rejected twin is skipped. Returns the ids actually added.
create or replace function public.automation_enqueue(p_items jsonb) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    return query
      insert into public.automation_queue(agent, title, detail, record_id, section, action, controlled, dedupe_key)
      values (it->>'agent', it->>'title', it->>'detail', nullif(it->>'record_id', '')::uuid, it->>'section', it->'action', coalesce((it->>'controlled')::boolean, false), it->>'dedupe_key')
      on conflict (dedupe_key) where dedupe_key is not null and status in ('pending', 'rejected') do nothing
      returning id;
  end loop;
end $$;

-- a decision: only a waiting proposal can be claimed, and only once. Returns the claimed row or nothing.
create or replace function public.automation_decide(p_id uuid, p_approve boolean, p_by text, p_us_person boolean, p_action jsonb default null)
returns setof public.automation_queue
language sql security definer set search_path = public as $$
  update public.automation_queue set
    status = case when p_approve then 'processing' else 'rejected' end,
    decided_by = p_by, decided_at = now(), updated_at = now(),
    action = coalesce(p_action, action),
    exec_id = case when p_approve then gen_random_uuid() else exec_id end,
    attempts = case when p_approve then attempts + 1 else attempts end,
    claimed_at = case when p_approve then now() else claimed_at end
  where id = p_id and status = 'pending' and (not controlled or p_us_person)
  returning *
$$;

-- work due again: retries whose time has come, and executions left half-way by a stopped worker
create or replace function public.automation_claim_due(p_limit integer default 20, p_stale_minutes integer default 15)
returns setof public.automation_queue
language sql security definer set search_path = public as $$
  update public.automation_queue q set status = 'processing', exec_id = gen_random_uuid(), attempts = q.attempts + 1, claimed_at = now(), updated_at = now()
  where q.id in (
    select id from public.automation_queue
    where (status = 'retrying' and next_attempt_at <= now())
       or (status = 'processing' and claimed_at < now() - make_interval(mins => p_stale_minutes))
    order by created_at limit p_limit for update skip locked)
  returning q.*
$$;

-- finish an execution; a worker whose claim was taken over cannot overwrite the newer one
create or replace function public.automation_finish(p_id uuid, p_exec uuid, p_ok boolean, p_result text, p_error text, p_retry boolean)
returns setof public.automation_queue
language sql security definer set search_path = public as $$
  update public.automation_queue set
    status = case when p_ok then 'completed' when p_retry and attempts < max_attempts then 'retrying' when p_retry then 'dead' else 'failed' end,
    result = case when p_ok then p_result else result end,
    last_error = case when p_ok then null else p_error end,
    next_attempt_at = case when not p_ok and p_retry and attempts < max_attempts
      then now() + least(interval '6 hours', make_interval(secs => 60 * power(4, greatest(attempts - 1, 0)))) else null end,
    finished_at = case when p_ok or not p_retry or attempts >= max_attempts then now() else null end,
    updated_at = now()
  where id = p_id and exec_id = p_exec and status = 'processing'
  returning *
$$;

-- an administrator sends a dead or failed item round again, or closes it
create or replace function public.automation_requeue(p_id uuid, p_by text) returns setof public.automation_queue
language sql security definer set search_path = public as $$
  update public.automation_queue set status = 'retrying', next_attempt_at = now(), attempts = 0, last_error = null, decided_by = coalesce(decided_by, p_by), updated_at = now()
  where id = p_id and status in ('dead', 'failed') returning *
$$;

-- outbound e-mail: create the delivery row once, then claim it for sending. claimed=false means "do not send now".
create or replace function public.outbound_claim(p_idem text, p_to text, p_subject text, p_queue uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.outbound_messages;
begin
  insert into public.outbound_messages(idem_key, to_addr, subject, queue_id) values (p_idem, p_to, p_subject, p_queue) on conflict (idem_key) do nothing;
  update public.outbound_messages set status = 'sending', attempts = attempts + 1, updated_at = now()
    where idem_key = p_idem and status in ('queued', 'failed') returning * into m;
  if found then return jsonb_build_object('claimed', true, 'id', m.id, 'status', m.status, 'attempts', m.attempts); end if;
  select * into m from public.outbound_messages where idem_key = p_idem;
  return jsonb_build_object('claimed', false, 'id', m.id, 'status', m.status, 'attempts', m.attempts, 'provider_id', m.provider_id);
end $$;
create or replace function public.outbound_done(p_id uuid, p_status text, p_provider text, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.outbound_messages set status = p_status, provider_id = coalesce(p_provider, provider_id), last_error = p_error,
    sent_at = case when p_status = 'sent' then now() else sent_at end, updated_at = now()
  where id = p_id and status = 'sending'
$$;
-- a send that never reported back (the function stopped mid-way): nobody knows if it left — a person decides
create or replace function public.outbound_mark_stuck(p_minutes integer default 10) returns integer
language sql security definer set search_path = public as $$
  with u as (update public.outbound_messages set status = 'uncertain', last_error = coalesce(last_error, 'No answer from the mail server — check the Sent folder before sending again'), updated_at = now()
    where status = 'sending' and updated_at < now() - make_interval(mins => p_minutes) returning 1)
  select count(*)::integer from u
$$;

-- scheduled jobs
create or replace function public.job_start(p_job text, p_slot text, p_trigger text, p_stale_seconds integer default 600, p_max_attempts integer default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.job_runs; n integer;
begin
  update public.job_runs set status = 'timeout', finished_at = now(), error = coalesce(error, 'Stopped without finishing (time limit or crash)'),
    duration_ms = (extract(epoch from (now() - started_at)) * 1000)::integer
    where job = p_job and status = 'running' and heartbeat_at < now() - make_interval(secs => p_stale_seconds);
  if p_slot is not null and exists (select 1 from public.job_runs where job = p_job and slot = p_slot and status = 'completed') then
    return jsonb_build_object('started', false, 'reason', 'done');
  end if;
  if p_slot is not null and exists (select 1 from public.job_runs where job = p_job and slot = p_slot and status = 'dead') then
    return jsonb_build_object('started', false, 'reason', 'dead');
  end if;
  select count(*) into n from public.job_runs where job = p_job and slot is not distinct from p_slot and status in ('failed', 'timeout');
  if p_slot is not null and n >= p_max_attempts then
    insert into public.job_runs(job, slot, trigger, status, attempt, finished_at, duration_ms, error)
      values (p_job, p_slot, p_trigger, 'dead', n, now(), 0, 'Gave up after ' || n || ' attempts — run it by hand after fixing the cause');
    return jsonb_build_object('started', false, 'reason', 'dead', 'new_dead', true);
  end if;
  begin
    insert into public.job_runs(job, slot, trigger, status, attempt) values (p_job, p_slot, p_trigger, 'running', n + 1) returning * into r;
  exception when unique_violation then
    return jsonb_build_object('started', false, 'reason', 'running');
  end;
  return jsonb_build_object('started', true, 'id', r.id, 'attempt', r.attempt);
end $$;
create or replace function public.job_heartbeat(p_id uuid) returns void language sql security definer set search_path = public as $$
  update public.job_runs set heartbeat_at = now() where id = p_id and status = 'running'
$$;
create or replace function public.job_finish(p_id uuid, p_status text, p_error text, p_result jsonb) returns void
language sql security definer set search_path = public as $$
  update public.job_runs set status = p_status, error = p_error, result = p_result, finished_at = now(),
    duration_ms = (extract(epoch from (now() - started_at)) * 1000)::integer
  where id = p_id and status = 'running'
$$;
-- an administrator clears a dead slot so the scheduler tries again
create or replace function public.job_revive(p_job text, p_slot text) returns integer
language sql security definer set search_path = public as $$
  with d as (delete from public.job_runs where job = p_job and slot is not distinct from p_slot and status in ('dead', 'failed', 'timeout') returning 1) select count(*)::integer from d
$$;

-- request limits: true while the bucket stays within p_limit hits per window
create or replace function public.rate_hit(p_bucket text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); h integer;
begin
  insert into public.rate_limits as r(bucket, window_start, hits) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1 returning hits into h;
  return h <= p_limit;
end $$;

-- several record changes as one step (change order → invoices, acceptance → milestone invoices, service → unit).
-- ops: [{"op":"insert","row":{…}} | {"op":"update","id":"…","set":{"status"?,"data"?,"title"?},"if_version"?:n}]
-- A version that moved stops the whole step; nothing is half-written.
create or replace function public.records_apply(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb; n integer; out jsonb := '[]'::jsonb; rid uuid;
begin
  for o in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    if o->>'op' = 'insert' then
      insert into public.records(section, title, status, data, company, controlled, created_by)
        values (o->'row'->>'section', o->'row'->>'title', o->'row'->>'status', coalesce(o->'row'->'data', '{}'::jsonb), o->'row'->>'company',
                coalesce((o->'row'->>'controlled')::boolean, false), nullif(o->'row'->>'created_by', '')::uuid)
        returning id into rid;
      out := out || jsonb_build_array(jsonb_build_object('op', 'insert', 'id', rid));
    elsif o->>'op' = 'update' then
      update public.records set
        status = case when (o->'set') ? 'status' then o->'set'->>'status' else status end,
        title = case when (o->'set') ? 'title' then o->'set'->>'title' else title end,
        data = case when (o->'set') ? 'data' then o->'set'->'data' else data end
        where id = (o->>'id')::uuid and (not (o ? 'if_version') or version = (o->>'if_version')::integer);
      get diagnostics n = row_count;
      if n = 0 then raise exception 'conflict: record % changed or no longer exists', o->>'id'; end if;
      out := out || jsonb_build_array(jsonb_build_object('op', 'update', 'id', o->>'id'));
    end if;
  end loop;
  return out;
end $$;

-- rules are replaced as one set: nobody sees a half-saved list
create or replace function public.automation_save_rules(p_rules jsonb, p_by text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.automation_rules;
  insert into public.automation_rules(id, position, rule, updated_by)
    select r->>'id', (o - 1)::integer, r, p_by from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) with ordinality as t(r, o);
  get diagnostics n = row_count;
  insert into public.ops_state(key, value) values ('rules_saved', to_jsonb(now())) on conflict (key) do update set value = excluded.value, updated_at = now();
  return n;
end $$;

-- restore drill / disaster recovery into an EMPTY project: rows go back as they were (ids, versions, times, history);
-- nothing already there is overwritten except the profile a new sign-in account creates for itself
create or replace function public.restore_load(p_table text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; cols text; sets text;
begin
  if p_table not in ('section_access', 'profiles', 'records', 'comments', 'activity', 'approvals', 'faq') then raise exception 'table % cannot be restored', p_table; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then return 0; end if;
  select string_agg(quote_ident(c.column_name), ', '), string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ') filter (where c.column_name <> 'id')
    into cols, sets
    from information_schema.columns c where c.table_schema = 'public' and c.table_name = p_table and c.column_name in (select jsonb_object_keys(p_rows->0));
  if p_table = 'records' then alter table public.records disable trigger records_log; end if;
  execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) %3$s', p_table, cols,
    case when p_table = 'profiles' then 'on conflict (id) do update set ' || sets else 'on conflict do nothing' end) using p_rows;
  get diagnostics n = row_count;
  if p_table = 'records' then alter table public.records enable trigger records_log; end if;
  if p_table = 'activity' then perform setval(pg_get_serial_sequence('public.activity', 'id'), greatest(1, (select coalesce(max(id), 1) from public.activity))); end if;
  return n;
end $$;

-- RLS check for any user, used by the server instead of repeating the access rules in code
create or replace function public.can_read_as(p_user uuid, p_section text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.role in ('owner', 'admin') from public.profiles p where p.id = p_user), false)
      or exists (select 1 from public.section_access a join public.profiles p on p.role = a.role where p.id = p_user and a.section = p_section)
$$;

/* ---------------------------------------------------------------------------------------------
   9. Rights: new tables and functions are for the server only
   --------------------------------------------------------------------------------------------- */
do $$ declare t text; f text; begin
  foreach t in array array['ops_state', 'automation_fired', 'automation_settings', 'automation_rules', 'automation_queue', 'automation_log', 'outbound_messages', 'job_runs', 'rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach f in array array['automation_claim_keys(text[],integer[])', 'automation_save_rules(jsonb,text)', 'automation_enqueue(jsonb)', 'automation_decide(uuid,boolean,text,boolean,jsonb)', 'automation_claim_due(integer,integer)',
    'automation_finish(uuid,uuid,boolean,text,text,boolean)', 'automation_requeue(uuid,text)', 'outbound_claim(text,text,text,uuid)', 'outbound_done(uuid,text,text,text)', 'outbound_mark_stuck(integer)',
    'job_start(text,text,text,integer,integer)', 'job_heartbeat(uuid)', 'job_finish(uuid,text,text,jsonb)', 'job_revive(text,text)', 'rate_hit(text,integer,integer)', 'records_apply(jsonb)',
    'can_read_as(uuid,text)', 'restore_load(text,jsonb)', 'revoke_sessions(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
grant usage on sequence public.automation_log_id_seq to service_role;
-- helpers used inside policies stay callable by signed-in users, but never by anonymous callers
revoke execute on function public.record_visible(public.records) from anon;
revoke execute on function public.can_read(text) from anon;
revoke execute on function public.can_write(text) from anon;
revoke execute on function public.file_visible(text) from anon;
revoke execute on function public.file_writable(text) from anon;

commit;
