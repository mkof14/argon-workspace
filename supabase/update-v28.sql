-- AGRON Workspace — v28 (P10: the 1inow intelligent work layer + the business-policy model). Builds on v27.
-- One transaction; safe to run again; reversible (rollback-v28.sql).
--
-- 1inow is a layer OVER the existing records: My Day, Now, Attention, Waiting, Open Loops, Next actions, Ask and the
-- Inbox are computed from records, approvals, workflow steps, comments and the v22–v25 engines, for one person at a
-- time and only from what that person may open. No business object is copied. New storage holds only personal
-- interaction state that exists nowhere else:
--   inow_settings      feature flags and the default home (owners/administrators change them; audited)
--   inow_prefs         one person's own preferences (home view, smart notifications)
--   inow_item_state    one person's pin / snooze / dismiss / not-relevant / remind-at for an item of their My Day
--   inow_context       the last records a person worked in (convenience only — every use re-checks access)
--   inow_commitments   commitments detected in the person's own comments ("I'll send the revised proposal tomorrow"),
--                      with the evidence and a confidence; nothing becomes a task until the person confirms
--   inow_metrics       daily counters (Ask requests, failures, ambiguity, confirmations, dismissals …) — no content
-- The business-policy model (P10 B19): thresholds are stated in USD (a request in another currency goes to the
-- highest tier), ECR escalates on cost or on a safety / customer / certification impact, PROPOSAL adds a
-- Management review above the high-value threshold, the editor of a policy version cannot approve it (owners
-- excepted, recorded), and a System Administrator cannot hold the Policy Approver capability. All nine policies
-- become a new Draft version marked READY FOR OWNER APPROVAL — nothing is approved here.
begin;

create or replace function public.workspace_db_version() returns int
  language sql immutable security invoker set search_path = public
as $$ select 28 $$;
revoke all on function public.workspace_db_version() from public, anon;
grant execute on function public.workspace_db_version() to authenticated, service_role;

/* ---------------------------------------------------------------------------------------------
   1. Personal 1inow state
   --------------------------------------------------------------------------------------------- */
create table if not exists public.inow_settings (
  id boolean primary key default true check (id),
  flags jsonb not null default '{"my_day": true, "ask": true, "voice": true, "inbox": true, "suggested": true, "executive": true, "commitments": true}'::jsonb,
  home jsonb not null default '{"employee": "today", "management": "today"}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now()
);
insert into public.inow_settings(id) values (true) on conflict (id) do nothing;

create table if not exists public.inow_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  home text check (home is null or home in ('today', 'inow')),
  smart_notifications boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.inow_item_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_key text not null check (length(item_key) between 3 and 200),
  pinned boolean not null default false,
  dismissed_at timestamptz, not_relevant boolean not null default false,
  snooze_until timestamptz, remind_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key)
);
create index if not exists inow_item_state_remind_idx on public.inow_item_state (remind_at) where remind_at is not null;

create table if not exists public.inow_context (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists inow_context_user_idx on public.inow_context (user_id, at desc);

create table if not exists public.inow_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_kind text not null check (source_kind in ('comment')),
  source_id uuid not null,
  record_id uuid not null references public.records(id) on delete cascade,
  excerpt text not null check (length(excerpt) <= 300),
  phrase text not null check (length(phrase) <= 80),
  due date, confidence text not null check (confidence in ('high', 'medium', 'low')),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'dismissed', 'done')),
  task_id uuid references public.records(id) on delete set null,
  detected_at timestamptz not null default now(), decided_at timestamptz,
  unique (user_id, source_kind, source_id)
);
create index if not exists inow_commitments_user_idx on public.inow_commitments (user_id, status, detected_at desc);

create table if not exists public.inow_metrics (
  day date not null default (now() at time zone 'utc')::date,
  metric text not null check (metric ~ '^[a-z_]{2,40}$'),
  n bigint not null default 0,
  primary key (day, metric)
);

do $$ declare t text; begin
  foreach t in array array['inow_settings', 'inow_prefs', 'inow_item_state', 'inow_context', 'inow_commitments', 'inow_metrics'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t); -- table-level powers outside row-level security
  end loop;
end $$;
-- the flags are readable by every active employee; changed only through inow_settings_save
drop policy if exists p_inow_settings_read on public.inow_settings;
create policy p_inow_settings_read on public.inow_settings for select to authenticated using ((select public.is_active_employee(auth.uid())));
revoke insert, update, delete on public.inow_settings from authenticated;
-- a person's own state: only their own rows, only while they are an active employee
do $$ declare t text; begin
  foreach t in array array['inow_prefs', 'inow_item_state', 'inow_context', 'inow_commitments'] loop
    execute format('drop policy if exists p_%1$s_own on public.%1$I', t);
    execute format('create policy p_%1$s_own on public.%1$I for all to authenticated using (user_id = (select auth.uid()) and (select public.is_active_employee(auth.uid()))) with check (user_id = (select auth.uid()) and (select public.is_active_employee(auth.uid())))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- commitments are written by the detector (below); the person only changes their status
revoke insert on public.inow_commitments from authenticated;
-- a person only decides (status, decided_at), once: a handled commitment never becomes a suggestion again
revoke update on public.inow_commitments from authenticated;
grant update (status, decided_at) on public.inow_commitments to authenticated;
create or replace function public.inow_commitments_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'suggested' and new.status is distinct from old.status and current_user = 'authenticated' then
    raise exception 'This commitment was already handled' using errcode = '55000'; -- not 40001: that one is retried by the API layer
  end if;
  return new;
end $$;
drop trigger if exists inow_commitments_guard on public.inow_commitments;
create trigger inow_commitments_guard before update on public.inow_commitments for each row execute function public.inow_commitments_guard();
revoke all on public.inow_metrics from authenticated;
grant usage on all sequences in schema public to authenticated;

create or replace function public.inow_settings_save(p_flags jsonb, p_home jsonb) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); before jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role in ('owner', 'admin') and not disabled) or not public.session_ok() then
    raise exception 'Only an owner or administrator changes 1inow settings' using errcode = '42501'; end if;
  select to_jsonb(s) into before from public.inow_settings s;
  update public.inow_settings set flags = coalesce(p_flags, flags), home = coalesce(p_home, home), updated_by = me, updated_at = now() where id;
  insert into public.activity(section, action, actor, detail) values ('security.log', 'inow_settings_changed', me, jsonb_build_object('before', before, 'flags', p_flags, 'home', p_home));
  if to_regclass('public.acceptance_env_changes') is not null then
    insert into public.acceptance_env_changes(environment, category, what, actor, source) values (public.acceptance_env(), 'config', '1inow feature flags / home changed', me::text, 'system');
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.inow_settings_save(jsonb, jsonb) from public, anon;
grant execute on function public.inow_settings_save(jsonb, jsonb) to authenticated;

-- counters only (no content, no user id): a fixed list of names
create or replace function public.inow_metric(p_name text, p_n integer default 1) returns void
  language sql security definer set search_path = public
as $$
  insert into public.inow_metrics(day, metric, n)
  select (now() at time zone 'utc')::date, p_name, greatest(1, least(coalesce(p_n, 1), 1000))
   where p_name in ('ask', 'ask_deterministic', 'ask_ai', 'ask_ai_unavailable', 'retrieval_failure', 'model_failure', 'command', 'command_failure', 'entity_ambiguous',
                    'action_proposed', 'action_confirmed', 'action_executed', 'action_duplicate_blocked', 'action_undone', 'inbox_capture', 'inbox_unresolved',
                    'suggestion_dismissed', 'item_snoozed', 'item_pinned', 'my_day', 'my_day_slow', 'executive', 'brief', 'commitment_confirmed', 'commitment_dismissed')
     and auth.uid() is not null
  on conflict (day, metric) do update set n = public.inow_metrics.n + excluded.n
$$;
revoke all on function public.inow_metric(text, integer) from public, anon;
grant execute on function public.inow_metric(text, integer) to authenticated, service_role;

-- the last records a person worked in (convenience; at most 20 kept; only records the person may open)
create or replace function public.inow_touch(p_record uuid) returns void
  language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); r public.records;
begin
  if me is null or not public.is_active_employee(me) then return; end if;
  select * into r from public.records where id = p_record;
  if not found or not public.record_visible_for(me, r) then return; end if;
  delete from public.inow_context where user_id = me and record_id = p_record;
  insert into public.inow_context(user_id, record_id) values (me, p_record);
  delete from public.inow_context where user_id = me and id not in (select id from public.inow_context where user_id = me order by at desc limit 20);
end $$;
revoke all on function public.inow_touch(uuid) from public, anon;
grant execute on function public.inow_touch(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   2. Commitments in the person's own words (deterministic phrase rules; evidence kept; nothing authoritative)
   --------------------------------------------------------------------------------------------- */
create or replace function public.inow_detect_commitments(p_days integer default 14) returns integer
  language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); n integer := 0; c record; ph text; due date; conf text; body text; today date := (now() at time zone 'utc')::date;
begin
  if me is null or not public.is_active_employee(me) or not public.session_ok() then return 0; end if;
  for c in
    select x.id, x.record_id, x.body, x.created_at from public.comments x join public.records r on r.id = x.record_id
     where x.author = me and x.created_at > now() - make_interval(days => least(greatest(p_days, 1), 60))
       and not exists (select 1 from public.inow_commitments k where k.user_id = me and k.source_kind = 'comment' and k.source_id = x.id)
       and public.record_visible_for(me, r)
     order by x.created_at desc limit 200
  loop
    body := lower(c.body);
    ph := substring(body from '(i''ll|i will|i am going to|will send|will prepare|will share|will call|will follow up|i''ll get back|let me (?:send|check|prepare)|пришлю|отправлю|подготовлю|сделаю|напишу|позвоню|вернусь с|проверю и|надішлю|підготую|зроблю|напишу|зателефоную|перевірю)');
    if ph is null then continue; end if;
    due := case
      when body ~ '(today|сегодня|сьогодні)' then today
      when body ~ '(tomorrow|завтра)' then today + 1
      when body ~ '(next week|на следующей неделе|наступного тижня)' then today + 7
      when body ~ '(by friday|до пятницы|в пятницу|до п.ятниці|у п.ятницю)' then today + ((5 - extract(isodow from today)::int + 7) % 7)
      when body ~ '(by monday|в понедельник|до понедельника|у понеділок|до понеділка)' then today + ((1 - extract(isodow from today)::int + 7) % 7)
      else null end;
    if due = today and body ~ '(friday|monday|пятниц|понедельник|п.ятниц|понеділ)' then due := due + 7; end if;
    conf := case when due is not null then 'high' when ph ~ '(will|пришлю|отправлю|подготовлю|надішлю|підготую)' then 'medium' else 'low' end;
    insert into public.inow_commitments(user_id, source_kind, source_id, record_id, excerpt, phrase, due, confidence, detected_at)
      values (me, 'comment', c.id, c.record_id, left(regexp_replace(c.body, '\s+', ' ', 'g'), 300), left(ph, 80), due, conf, now())
      on conflict (user_id, source_kind, source_id) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.inow_detect_commitments(integer) from public, anon;
grant execute on function public.inow_detect_commitments(integer) to authenticated;

/* ---------------------------------------------------------------------------------------------
   3. Business-policy model (B19) — new Draft versions, READY FOR OWNER APPROVAL, nothing approved
   --------------------------------------------------------------------------------------------- */
alter table public.approval_policies add column if not exists currency text not null default 'USD' check (currency in ('USD'));
alter table public.approval_policies add column if not exists ready_for_approval boolean not null default false;
alter table public.approval_policies add column if not exists model_version integer not null default 1;
alter table public.approval_policies add column if not exists self_approved boolean not null default false;

do $$
declare
  usd jsonb := '{"any": [{"field": "facts.currency", "op": "empty"}, {"field": "facts.currency", "op": "eq", "value": "USD"}]}';
  lead jsonb := '{"kind": "department_lead", "label": "Department lead", "fallback": {"kind": "role", "role": "management"}}';
  fin jsonb := '{"kind": "role", "role": "finance", "label": "Finance"}';
  mgmt jsonb := '{"kind": "role", "role": "management", "label": "Management"}';
  englead jsonb := '{"kind": "department_lead", "dept": "engineering", "label": "Engineering lead", "fallback": {"kind": "role", "role": "engineering"}}';
  model jsonb; p record; t jsonb;
begin
  model := jsonb_build_object(
    'PURCHASE', jsonb_build_array(
      jsonb_build_object('label', 'Up to 5,000 USD', 'currency', 'USD', 'when', jsonb_build_object('all', jsonb_build_array(usd, '{"field": "facts.amount", "op": "lte", "value": 5000}'::jsonb)), 'mode', 'sequential', 'steps', jsonb_build_array(lead)),
      jsonb_build_object('label', 'Up to 25,000 USD', 'currency', 'USD', 'when', jsonb_build_object('all', jsonb_build_array(usd, '{"field": "facts.amount", "op": "lte", "value": 25000}'::jsonb)), 'mode', 'sequential', 'steps', jsonb_build_array(lead, fin)),
      jsonb_build_object('label', 'Above 25,000 USD, or another currency', 'currency', 'USD', 'mode', 'sequential', 'steps', jsonb_build_array(lead, fin, mgmt))),
    'PAYMENT', jsonb_build_array(
      jsonb_build_object('label', 'Up to 10,000 USD', 'currency', 'USD', 'when', jsonb_build_object('all', jsonb_build_array(usd, '{"field": "facts.amount", "op": "lte", "value": 10000}'::jsonb)), 'mode', 'sequential', 'steps', jsonb_build_array(fin)),
      jsonb_build_object('label', 'Above 10,000 USD, or another currency', 'currency', 'USD', 'mode', 'sequential', 'steps', jsonb_build_array(fin, mgmt))),
    'TRAVEL', jsonb_build_array(
      jsonb_build_object('label', 'Up to 5,000 USD', 'currency', 'USD', 'when', jsonb_build_object('all', jsonb_build_array(usd, '{"field": "facts.amount", "op": "lte", "value": 5000}'::jsonb)), 'mode', 'sequential', 'steps', jsonb_build_array(lead)),
      jsonb_build_object('label', 'Above 5,000 USD, or another currency', 'currency', 'USD', 'mode', 'sequential', 'steps', jsonb_build_array(lead, fin))),
    -- ECR (owner's definition, P9-S1 §15): Engineering always; Management in parallel as well when the financial
    -- effect is above 10,000 USD (or in another currency — no conversion), or the change affects safety, an approved
    -- BOM or configuration, a customer commitment, a controlled interface, acceptance criteria or a released build unit
    'ECR', jsonb_build_array(
      jsonb_build_object('label', 'Above 10,000 USD, another currency, or safety / approved BOM-configuration / customer commitment / controlled interface / acceptance criteria / released build unit affected', 'currency', 'USD',
        'when', jsonb_build_object('any', jsonb_build_array('{"field": "facts.amount", "op": "gt", "value": 10000}'::jsonb, jsonb_build_object('not', usd),
          '{"field": "facts.safety_impact", "op": "eq", "value": true}'::jsonb, '{"field": "facts.bom_config_affected", "op": "eq", "value": true}'::jsonb,
          '{"field": "facts.customer_commitment_affected", "op": "eq", "value": true}'::jsonb, '{"field": "facts.controlled_interface_affected", "op": "eq", "value": true}'::jsonb,
          '{"field": "facts.acceptance_criteria_affected", "op": "eq", "value": true}'::jsonb, '{"field": "facts.build_unit_affected", "op": "eq", "value": true}'::jsonb)),
        'mode', 'parallel', 'steps', jsonb_build_array(englead, mgmt)),
      jsonb_build_object('label', 'Engineering', 'currency', 'USD', 'mode', 'sequential', 'steps', jsonb_build_array(englead))),
    -- PROPOSAL (owner's definition, P9-S1 §15): up to 250,000 USD with a discount up to 10% — Proposal Approver; above
    -- 250,000 USD or a discount above 10% — plus Pricing Approver; above 1,000,000 USD (or another currency) — plus Management
    'PROPOSAL', jsonb_build_array(
      jsonb_build_object('label', 'Up to 250,000 USD and a discount up to 10%', 'currency', 'USD',
        'when', jsonb_build_object('all', jsonb_build_array(usd, '{"field": "facts.amount", "op": "lte", "value": 250000}'::jsonb, '{"field": "facts.discount", "op": "lte", "value": 10}'::jsonb)),
        'mode', 'sequential', 'steps', '[{"kind": "capability", "cap": "proposal_approver", "label": "Proposal approver"}]'::jsonb),
      jsonb_build_object('label', 'Above 250,000 USD or a discount above 10% (up to 1,000,000 USD)', 'currency', 'USD',
        'when', jsonb_build_object('all', jsonb_build_array(usd, '{"field": "facts.amount", "op": "lte", "value": 1000000}'::jsonb)),
        'mode', 'sequential', 'steps', '[{"kind": "capability", "cap": "proposal_approver", "label": "Proposal approver"}, {"kind": "capability", "cap": "pricing_approver", "label": "Pricing approver"}]'::jsonb),
      jsonb_build_object('label', 'Above 1,000,000 USD, or another currency — Management', 'currency', 'USD', 'mode', 'sequential',
        'steps', '[{"kind": "capability", "cap": "proposal_approver", "label": "Proposal approver"}, {"kind": "capability", "cap": "pricing_approver", "label": "Pricing approver"}, {"kind": "role", "role": "management", "label": "Management"}]'::jsonb)));
  -- an approved policy (none today) keeps its approval and its tiers; a new model reaches it only through an edit
  for p in select * from public.approval_policies where model_version < 2 and config_status <> 'Approved' loop
    t := coalesce(model->p.code, p.tiers);
    insert into public.approval_policies_history(policy_code, changed_by, before, after, config_status, version)
      values (p.code, null, to_jsonb(p), jsonb_build_object('tiers', t, 'note', 'policy model v2 (USD thresholds, ECR / PROPOSAL escalation, separation of duty) — READY FOR OWNER APPROVAL'), 'Draft', p.version + 1);
    update public.approval_policies set tiers = t, version = version + 1, config_status = 'Draft', ready_for_approval = true, model_version = 2, updated_at = now(), updated_by = null,
      approved_by = null, approved_at = null, approved_version = null, self_approved = false
     where code = p.code;
  end loop;
end $$;

-- separation of duty in policy approval: the editor of the current version does not approve it (an owner may, and
-- that is recorded as a self-approval); the rest is the v24/v25 rule (owner, or management with the area's capability,
-- or a Policy Approver)
create or replace function public.ops_policy_approve(p_code text, p_version integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); pol public.approval_policies; rl text; self boolean;
begin
  select * into pol from public.approval_policies where code = p_code for update;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  select role into rl from public.profiles where id = me;
  if me is null or not public._policy_approver(me) then
    raise exception 'Only the Owner or a Policy Approver confirms a business authority policy as AGRON policy (a Workflow Admin builds processes but does not approve authority)' using errcode = '42501';
  end if;
  -- a System Administrator never approves business authority, even with a capability granted before the role changed
  if rl = 'admin' then raise exception 'A System Administrator does not approve business policies (separation of duty)' using errcode = '42501'; end if;
  if pol.version <> p_version then raise exception 'The policy changed since you opened it (version %); review it again', pol.version using errcode = '55000'; end if;
  if pol.config_status = 'Approved' then return jsonb_build_object('ok', true, 'status', 'Approved', 'note', 'Already approved'); end if;
  self := pol.updated_by is not null and pol.updated_by = me;
  if self and rl <> 'owner' then raise exception 'Separation of duty: the person who edited this version cannot approve it' using errcode = '42501'; end if;
  insert into public.approval_policies_history(policy_code, changed_by, before, after, config_status, version)
    values (pol.code, me, to_jsonb(pol), jsonb_build_object('config_status', 'Approved', 'version', pol.version, 'self_approved', self), 'Approved', pol.version);
  insert into public.approval_policies_history(policy_code, changed_by, before, after, config_status, version)
    select pol.code, me, null, jsonb_build_object('superseded_by_version', pol.version), 'Superseded', pol.approved_version where pol.approved_version is not null and pol.approved_version <> pol.version;
  update public.approval_policies set config_status = 'Approved', approved_by = me, approved_at = now(), approved_version = version, ready_for_approval = false, self_approved = self where code = p_code;
  insert into public.crm_audit(actor, kind, detail) values (me, 'policy_approved', jsonb_build_object('code', pol.code, 'version', pol.version, 'self_approved', self));
  if public._policy_cap(pol.code, pol.section) = 'manufacturing_admin' then
    insert into public.mfg_audit(actor, kind, detail) values (me, 'policy_approved', jsonb_build_object('code', pol.code, 'version', pol.version, 'self_approved', self));
  end if;
  return jsonb_build_object('ok', true, 'status', 'Approved', 'version', pol.version, 'self_approved', self);
end $$;
revoke execute on function public.ops_policy_approve(text, integer) from public, anon;
grant execute on function public.ops_policy_approve(text, integer) to authenticated;

-- a System Administrator never holds the Policy Approver capability (nor any business approval capability: that was
-- already the rule for granting; here it is enforced in the table itself)
create or replace function public.crm_caps_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.revoked_at is null and new.cap in ('policy_approver') and exists (select 1 from public.profiles where id = new.user_id and role = 'admin') then
    raise exception 'A System Administrator cannot be a Policy Approver (separation of duty)' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.crm_caps_guard() from public, anon, authenticated;
drop trigger if exists crm_caps_guard on public.crm_caps;
create trigger crm_caps_guard before insert or update on public.crm_caps for each row execute function public.crm_caps_guard();

/* ---------------------------------------------------------------------------------------------
   4. Acceptance scope P10-1INOW (registered in the v27 catalog; nothing here decides a status)
   --------------------------------------------------------------------------------------------- */
insert into public.acceptance_checks(id, phase, name, kind, freshness, envs, gates, mandatory, params, attestable, sort, description) values
  ('P10.SUITE', 'P10-1INOW', '1inow functional suite (My Day, Now, Attention, Waiting, Open Loops, Next, Inbox, Ask, Act, reminders, changes, executive, briefs)', 'suite', 'release', '{}', '{development,staging,production}', true, '{"from": "P9.REG.FULL", "suites": ["p10"]}', false, 110, null),
  ('P10.SEC', 'P10-1INOW', '1inow permission isolation (restricted and US-persons-only records contribute nothing)', 'suite', 'release', '{}', '{development,staging,production}', true, '{"from": "P9.REG.FULL", "suites": ["p10sec"]}', false, 111, null),
  ('P10.ACT', 'P10-1INOW', '1inow action safety (ambiguity, stale, duplicate, hallucinated id, controlled, undo)', 'suite', 'release', '{}', '{development,staging,production}', true, '{"from": "P9.REG.FULL", "suites": ["p10act"]}', false, 112, null),
  ('P10.PERF', 'P10-1INOW', '1inow performance on the larger dataset (local)', 'suite', 'release', '{}', '{development}', true, '{"from": "P9.REG.FULL", "suites": ["p10perf"]}', false, 113, 'Local timings; a staging-grade run is P10.PERF.STAGING.'),
  ('P10.ENGINE', 'P10-1INOW', '1inow deterministic engine (unit)', 'suite', 'release', '{}', '{development,staging,production}', true, '{"from": "P9.UNIT", "suites": ["inow"]}', false, 114, null),
  ('P10.PERF.STAGING', 'P10-1INOW', '1inow performance on staging', 'performance', 'environment', '{staging,production}', '{staging,production}', true, '{}', false, 115, null),
  ('P10.USERS', 'P10-1INOW', '1inow usability with non-technical users', 'real_users', 'validation', '{staging,production}', '{staging,production}', true, '{}', true, 116, null),
  ('P10.DEVICES', 'P10-1INOW', '1inow on real devices (iPhone, desktop, tablet)', 'real_devices', 'validation', '{staging,production}', '{staging,production}', true, '{"classes": ["phone", "desktop"]}', true, 117, null),
  ('P10.POLICY.MODEL', 'P10-1INOW', 'Policy model v2 in place and not owner-approved by the system', 'suite', 'release', '{}', '{development}', true, '{"from": "P9.REG.FULL", "suites": ["p10"]}', false, 118, null)
on conflict (id) do update set phase = excluded.phase, name = excluded.name, kind = excluded.kind, freshness = excluded.freshness, envs = excluded.envs, gates = excluded.gates,
  mandatory = excluded.mandatory, params = excluded.params, attestable = excluded.attestable, sort = excluded.sort, description = excluded.description;
-- the full regression now includes the 1inow scope
update public.acceptance_checks set params = jsonb_set(params, '{scope}', '["P1","P2","P3","P4","P5","P6","P7","P8","P9","P9-R2","P10-1INOW"]'::jsonb), name = 'Full clean regression (P1–P9, P9-R2, P10-1INOW)' where id = 'P9.REG.FULL';

-- the policy list in the acceptance live state carries the new state
create or replace function public.acceptance_live() returns jsonb
  language plpgsql stable security definer set search_path = public
as $fn$
declare r jsonb; mfa jsonb; mfa_req boolean := coalesce((select mfa_required from public.security_settings limit 1), false);
begin
  r := jsonb_build_object('at', now(), 'db_version', public.workspace_db_version(), 'environment', public.acceptance_env());
  r := r || jsonb_build_object('policies', (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'version', p.version, 'status', p.config_status,
      'active', p.active, 'seeded', p.seeded, 'approved_by', (select full_name from public.profiles where id = p.approved_by), 'approved_at', p.approved_at,
      'approved_version', p.approved_version, 'owner_approved', p.config_status = 'Approved' and exists (select 1 from public.profiles where id = p.approved_by and role = 'owner'),
      'ready_for_approval', p.ready_for_approval, 'model_version', p.model_version, 'self_approved', p.self_approved,
      'currency', coalesce(p.currency, (select string_agg(distinct coalesce(x->>'currency', x->'when'->>'currency'), ',') from jsonb_array_elements(p.tiers) x where coalesce(x->>'currency', x->'when'->>'currency') is not null)),
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
end $fn$;
revoke all on function public.acceptance_live() from public, anon, authenticated;
grant execute on function public.acceptance_live() to service_role;

insert into public.acceptance_env_changes(environment, category, what, source)
  select public.acceptance_env(), 'db_migration', 'database migrated to v28 (1inow layer, policy model v2 — READY FOR OWNER APPROVAL)', 'migration'
   where not exists (select 1 from public.acceptance_env_changes where category = 'db_migration' and what like 'database migrated to v28%');


/* ---------------------------------------------------------------------------------------------
   "Changed by someone else" errors: 55000 instead of 40001. The API layer treats 40001 (serialization failure) as
   retryable and repeats the call, so a stale-version save or approval never returned (found by the P10 tests).
   The message and the rule stay the same; only the code changes. Reversed by the rollback.
   --------------------------------------------------------------------------------------------- */
do $$ declare f text; d text; begin
  foreach f in array array['public.crm_settings_save(jsonb, integer)', 'public.ops_settings_save(jsonb, integer)', 'public.mfg_settings_save(jsonb, integer)'] loop
    if to_regprocedure(f) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(f));
    if position('errcode = ''40001''' in d) > 0 then execute replace(d, 'errcode = ''40001''', 'errcode = ''55000'''); end if;
  end loop;
end $$;


/* ---------------------------------------------------------------------------------------------
   4. One read for My Day: the existing engines in ONE transaction (the visibility base each of them builds is
      built once instead of six times), each isolated — a failing engine reports itself and the rest still answer.
      Open loops are the person's own (owner) and those of projects they own or manage; company-wide loops stay on
      the management pages. Every engine keeps its own reading rule: this function adds no access.
   --------------------------------------------------------------------------------------------- */
-- the dependents of my open tasks, from my visible working set (pg_temp.mgmt_v, built by _mgmt_base for this viewer and
-- statement — tested equal to row-level security); only counts, keyed by my own task ids
create or replace function public.inow_dependents(p_limit integer default 400) returns jsonb
  language plpgsql security definer set search_path = public set jit = off
as $$
declare me uuid := auth.uid(); v jsonb;
begin
  if me is null or not public.is_active_employee(me) or not public.session_ok() then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._mgmt_base(me);
  select coalesce(jsonb_object_agg(b::text, n), '{}') into v from (
    select d.m_blocked_by b, count(*)::int n from pg_temp.mgmt_v d
     where d.section = 'company.tasks' and coalesce(d.status, '') not in ('Completed', 'Cancelled', 'Done') and d.m_assignee is distinct from me
       and d.m_blocked_by in (select m.id from pg_temp.mgmt_v m where m.section = 'company.tasks' and m.m_assignee = me and coalesce(m.status, '') not in ('Completed', 'Cancelled', 'Done')
                              order by m.m_due nulls last limit least(greatest(p_limit, 1), 1000))
     group by 1) x;
  return v;
end $$;
revoke all on function public.inow_dependents(integer) from public, anon;
grant execute on function public.inow_dependents(integer) to authenticated;

create or replace function public.inow_engines(p_attention integer default 40, p_loops integer default 150) returns jsonb
  language plpgsql volatile security invoker set search_path = public set jit = off
as $$
declare me uuid := auth.uid(); r jsonb := '{}'::jsonb; st jsonb := '{}'::jsonb; t timestamptz; v jsonb;
begin
  if me is null or not public.is_active_employee(me) then raise exception 'Not signed in' using errcode = '42501'; end if;
  t := clock_timestamp();
  begin v := (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.attention_items(least(greatest(p_attention, 1), 100)) a); r := r || jsonb_build_object('attention', v); st := st || jsonb_build_object('attention', jsonb_build_object('ok', true, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int));
  exception when others then st := st || jsonb_build_object('attention', jsonb_build_object('ok', false, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int)); end;
  t := clock_timestamp();
  -- at most 300 waiting items: what others wait for from me first, then what I wait for, then the team's
  begin v := (select coalesce(jsonb_agg(to_jsonb(w) || jsonb_build_object('waiting_kind', case when w.party_type = 'external' then (select x.data->>'waiting_kind' from public.records x where x.id = w.record_id) end)), '[]')
              from (select * from public.waiting_for() w order by case w.bucket when 'me' then 0 when 'others' then 1 when 'external' then 2 else 3 end, w.due nulls last, w.requested_at limit 300) w); r := r || jsonb_build_object('waiting', v); st := st || jsonb_build_object('waiting', jsonb_build_object('ok', true, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int));
  exception when others then st := st || jsonb_build_object('waiting', jsonb_build_object('ok', false, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int)); end;
  t := clock_timestamp();
  begin
    v := (select coalesce(jsonb_agg(to_jsonb(l) order by case l.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, l.since), '[]') from (
      select * from public.open_loops(null) l
       where l.owner_id = me
          or l.project_id in (select p.id from public.records p where p.section = 'company.projects' and (p.data->>'owner_id' = me::text or p.data->>'manager_id' = me::text))
       order by case l.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, l.since
       limit least(greatest(p_loops, 1), 500)) l);
    r := r || jsonb_build_object('open_loops', v); st := st || jsonb_build_object('open_loops', jsonb_build_object('ok', true, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int));
  exception when others then st := st || jsonb_build_object('open_loops', jsonb_build_object('ok', false, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int)); end;
  t := clock_timestamp();
  begin r := r || jsonb_build_object('processes', public.ops_my_processes()); st := st || jsonb_build_object('processes', jsonb_build_object('ok', true, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int));
  exception when others then st := st || jsonb_build_object('processes', jsonb_build_object('ok', false, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int)); end;
  t := clock_timestamp();
  begin r := r || jsonb_build_object('commercial', public.crm_followups('mine')); st := st || jsonb_build_object('commercial', jsonb_build_object('ok', true, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int));
  exception when others then st := st || jsonb_build_object('commercial', jsonb_build_object('ok', false, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int)); end;
  t := clock_timestamp();
  begin r := r || jsonb_build_object('manufacturing', public.mfg_today()); st := st || jsonb_build_object('manufacturing', jsonb_build_object('ok', true, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int));
  exception when others then st := st || jsonb_build_object('manufacturing', jsonb_build_object('ok', false, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int)); end;
  -- who is blocked by my open tasks (open tasks of other people that name mine in "Blocked by"), counted in the visible
  -- working set the engines above already built for me (the same rule as row-level security, without re-checking every row)
  t := clock_timestamp();
  begin
    r := r || jsonb_build_object('dependents', public.inow_dependents(400)); st := st || jsonb_build_object('dependencies', jsonb_build_object('ok', true, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int));
  exception when others then st := st || jsonb_build_object('dependencies', jsonb_build_object('ok', false, 'ms', (extract(epoch from clock_timestamp() - t) * 1000)::int)); end;
  return r || jsonb_build_object('status', st);
end $$;
revoke all on function public.inow_engines(integer, integer) from public, anon;
grant execute on function public.inow_engines(integer, integer) to authenticated;


/* ---------------------------------------------------------------------------------------------
   5. The facts an engineering change gives its approval policy (defect found in P9-S1: the ECR policy named facts the
      workflow never supplied, so its escalation could not fire). From the ECR itself and from its CONFIRMED impact
      objects: safety (Impact = Safety), an approved BOM / configuration affected, a customer commitment, a controlled
      interface, acceptance criteria (or a test procedure) affected, a released build unit affected, the currency.
   --------------------------------------------------------------------------------------------- */
do $$ declare d text; old text := $o$f := f || jsonb_build_object('impact_complete', coalesce(r.data->>'impact_confirmed_at', '') <> '', 'amount', public._num(r.data->'impact_cost'));$o$;
  new text := $n$f := f || jsonb_build_object('impact_complete', coalesce(r.data->>'impact_confirmed_at', '') <> '', 'amount', public._num(r.data->'impact_cost'), 'currency', r.data->>'currency',
      'safety_impact', coalesce(r.data->>'impact', '') = 'Safety' or coalesce(r.data->>'safety_impact', '') = 'true',
      'bom_config_affected', coalesce(r.data->>'impact_bom', '') <> '' or coalesce(r.data->>'impact_configs', '') <> ''
        or exists (select 1 from public.mfg_ecr_objects o join public.records x on x.id = o.object_id where o.ecr_id = r.id and o.confirmed_at is not null and o.kind in ('bom', 'configuration') and coalesce(x.status, '') in ('Approved', 'Released', 'Active', 'Effective', 'Current')),
      'customer_commitment_affected', coalesce(r.data->>'customer_commitment_affected', '') = 'true',
      'controlled_interface_affected', coalesce(r.data->>'controlled_interface_affected', '') = 'true'
        or exists (select 1 from public.mfg_ecr_objects o join public.records x on x.id = o.object_id where o.ecr_id = r.id and o.confirmed_at is not null and x.controlled),
      'acceptance_criteria_affected', coalesce(r.data->>'acceptance_criteria_affected', '') = 'true'
        or exists (select 1 from public.mfg_ecr_objects o where o.ecr_id = r.id and o.confirmed_at is not null and o.kind = 'test_procedure'),
      'build_unit_affected', exists (select 1 from public.mfg_ecr_objects o join public.records x on x.id = o.object_id where o.ecr_id = r.id and o.confirmed_at is not null and o.kind = 'unit' and coalesce(x.status, '') not in ('Planned', 'Delivered', 'Cancelled', 'Scrapped')));$n$;
begin
  if to_regclass('public.mfg_ecr_objects') is null then return; end if;
  d := pg_get_functiondef('public._wf_facts(uuid, public.records)'::regprocedure);
  if position(old in d) > 0 then execute replace(d, old, new); end if;
end $$;

commit;
