-- AGRON Workspace — v23 (Phase 6: business operations and one reusable workflow mechanism)
-- Builds on v18–v22. One transaction; safe to run again. Nothing existing is deleted or rewritten.
--
-- One engine coordinates the existing objects; it never copies them:
--   wf_definitions      versioned process definitions (steps, transitions, SLA, approvals, completion) — data only,
--                       conditions use an allow-listed rule model (no code, no SQL, no scripts)
--   wf_instances        one running process on one existing record (a purchase request, a contract, a change…);
--                       it keeps the definition version it started on
--   wf_step_runs        the step a process is in, who must act, its SLA; work steps are ordinary tasks
--   wf_links            the records a process created or uses (tasks, purchase records, issues) — idempotency keys
--   wf_events           append-only history of every material event (actor, time, old and new state, record)
--   approval_policies   who approves what (roles, department leads, project managers — never named people)
--   ops_settings        numbering types, material fields, SLA calendar, request types (+ history)
--   ops_proposals       extracted values waiting for a person to confirm them (never applied silently)
-- Business objects are records (existing sections, extended, and new sections), so access, history, discussion,
-- search, notifications and backup come with them. Access follows the v21 reading rule plus one addition:
-- requests and payment requests are seen by the people involved and by the desks that handle them.
begin;

do $$ begin
  if to_regprocedure('public._mgmt_base(uuid)') is null then raise exception 'Apply update-v22.sql first'; end if;
end $$;

/* ---------------------------------------------------------------------------------------------
   1. Access for the new sections and the procurement role (same values as the generated access.sql;
      existing custom access is never overwritten)
   --------------------------------------------------------------------------------------------- */
insert into public.section_access(section, role, can_write, external)
select s, r, w, false from (values
  -- purchase requests and payment requests: every internal role may raise one; who sees which is decided per record
  ('operations.requests', array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement'], array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement']),
  ('operations.quotations', array['management','engineering','operations','finance','procurement'], array['management','operations','procurement']),
  ('operations.receipts', array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement'], array['management','operations','procurement']),
  ('finance.payments', array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement'], array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement']),
  ('legal.contract_obligations', array['management','legal','finance','operations','sales','procurement'], array['management','legal']),
  ('company.issues', array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement'], array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement']),
  ('company.travel', array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement'], array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement']),
  ('company.requests', array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement'], array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement']),
  ('company.parties', array['management','engineering','operations','finance','sales','marketing','hr','legal','security','procurement'], array['management','operations','finance','sales','legal','procurement'])
) v(s, rs, ws), unnest(rs) r, lateral (select r = any(ws) w) x
on conflict (section, role) do nothing;

-- the procurement role reads and writes what the operations desk handles, and reads what it needs around it
insert into public.section_access(section, role, can_write, external)
select a.section, 'procurement', a.section in ('operations.procurement', 'operations.vendors', 'operations.logistics', 'operations.inventory'), false
from public.section_access a
where a.role = 'operations' and a.section not like 'operations.metrics%'
on conflict (section, role) do nothing;
insert into public.section_access(section, role, can_write, external)
select s, 'procurement', false, false from unnest(array['legal.contracts', 'finance.budget', 'company.projects', 'company.tasks', 'company.milestones', 'company.documents', 'company.meetings', 'company.decisions', 'company.wiki', 'company.contacts', 'company.portfolios']) s
where exists (select 1 from public.section_access a where a.section = s)
on conflict (section, role) do nothing;
update public.section_access set can_write = true where role = 'procurement' and section = 'company.tasks';

/* ---------------------------------------------------------------------------------------------
   2. Operations settings: one document, changed only by owners and administrators, every change kept
   --------------------------------------------------------------------------------------------- */
create table if not exists public.ops_settings (
  id boolean primary key default true check (id), value jsonb not null default '{}'::jsonb, version integer not null default 1,
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.ops_settings_history (
  id bigserial primary key, changed_at timestamptz not null default now(), changed_by uuid, before jsonb, after jsonb
);
alter table public.ops_settings enable row level security;
alter table public.ops_settings_history enable row level security;
revoke all on public.ops_settings, public.ops_settings_history from anon, authenticated;

-- the starting values (formats are examples: every value can be changed in Administration)
insert into public.ops_settings(id, value) values (true, jsonb_build_object(
  'due_soon_hours', 24,
  'weekend', jsonb_build_array(6, 7),
  'sla_pause_states', jsonb_build_array('waiting'),
  'numbering', jsonb_build_object('operations.requests', 'PR', 'operations.procurement', 'PO', 'finance.payments', 'PAY', 'legal.contracts', 'CTR',
    'technical.changes', 'ECR', 'company.issues', 'ISS', 'company.travel', 'TRV', 'company.requests', 'REQ'),
  -- a change to one of these fields makes an approval given on the old values stale
  'material', jsonb_build_object(
    'operations.requests', jsonb_build_array('est_amount', 'currency', 'qty', 'item', 'selected_quote_ref', 'selected_amount', 'selected_currency', 'vendor_ref', 'project_ref'),
    'finance.payments', jsonb_build_array('amount', 'currency', 'payee_ref', 'purchase_ref', 'invoice_ref', 'due'),
    'legal.contracts', jsonb_build_array('document_ref', 'counterparty', 'value', 'currency'),
    'technical.changes', jsonb_build_array('config', 'reason', 'impact_cost', 'impact_schedule_days', 'impact_configs', 'impact_documents', 'impact_bom', 'impact_confirmed_at'),
    'company.travel', jsonb_build_array('est_cost', 'currency', 'destination', 'starts', 'ends', 'travellers'),
    'company.requests', jsonb_build_array('amount', 'currency')),
  -- desks that see every record of a per-record section (everyone else sees the records they are part of)
  'desks', jsonb_build_object(
    'operations.requests', jsonb_build_array('management', 'operations', 'procurement', 'finance'),
    'finance.payments', jsonb_build_array('management', 'finance'),
    'company.travel', jsonb_build_array('management', 'finance', 'hr'),
    'company.requests', jsonb_build_array('management')),
  -- the Request Center: what can be requested, by whom (empty = every role that may write the section)
  'request_types', jsonb_build_array(
    jsonb_build_object('key', 'purchase', 'section', 'operations.requests', 'definition', 'PURCHASE', 'roles', jsonb_build_array()),
    jsonb_build_object('key', 'payment', 'section', 'finance.payments', 'definition', 'PAYMENT', 'roles', jsonb_build_array()),
    jsonb_build_object('key', 'contract', 'section', 'legal.contracts', 'definition', 'CONTRACT', 'roles', jsonb_build_array('management', 'legal', 'sales', 'finance', 'operations', 'procurement', 'engineering')),
    jsonb_build_object('key', 'change', 'section', 'technical.changes', 'definition', 'ECR', 'roles', jsonb_build_array('management', 'engineering', 'operations', 'procurement')),
    jsonb_build_object('key', 'travel', 'section', 'company.travel', 'definition', 'TRAVEL', 'roles', jsonb_build_array()),
    jsonb_build_object('key', 'general', 'section', 'company.requests', 'definition', 'GENERAL', 'roles', jsonb_build_array()))
)) on conflict (id) do nothing;

create or replace function public.ops_cfg() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.ops_settings where id), '{}'::jsonb)
$$;
revoke execute on function public.ops_cfg() from public, anon, authenticated;

-- numbering: the Phase 4 numbering (doc_number_formats / doc_counters, atomic), one format per business type
alter table public.doc_number_formats drop constraint if exists doc_number_formats_scope_check;
alter table public.doc_number_formats add constraint doc_number_formats_scope_check check (scope in ('document', 'decision', 'knowledge', 'ops'));
insert into public.doc_number_formats(scope, doc_type, pattern, company)
select 'ops', t, '{CO}-{TYPE}-{YEAR}-{SEQ:4}', 'AGR' from unnest(array['PR', 'PO', 'PAY', 'CTR', 'ECR', 'ISS', 'TRV', 'REQ']) t
where not exists (select 1 from public.doc_number_formats f where f.scope = 'ops' and f.doc_type = t);
create unique index if not exists records_ops_number_uq on public.records (section, (data->>'number'))
  where section in ('operations.requests', 'operations.procurement', 'finance.payments', 'legal.contracts', 'technical.changes', 'company.issues', 'company.travel', 'company.requests') and data ? 'number';

-- lookups the engine makes
create index if not exists records_request_ref_idx on public.records ((data->>'request_ref')) where data ? 'request_ref';
create index if not exists records_purchase_ref_idx on public.records ((data->>'purchase_ref')) where data ? 'purchase_ref';
create index if not exists records_party_ref_idx on public.records ((data->>'party_ref')) where data ? 'party_ref';
create index if not exists records_contract_ref_idx on public.records ((data->>'contract_ref')) where data ? 'contract_ref';
create index if not exists records_ops_project_idx on public.records ((data->>'project_ref'))
  where section in ('operations.requests', 'operations.procurement', 'finance.payments', 'finance.budget', 'legal.contracts', 'technical.changes', 'company.issues', 'company.travel', 'company.requests');
create index if not exists records_ops_section_idx on public.records (section, status)
  where section in ('operations.requests', 'operations.quotations', 'operations.procurement', 'operations.receipts', 'finance.payments', 'legal.contracts', 'legal.contract_obligations', 'technical.changes', 'company.issues', 'company.travel', 'company.requests', 'company.parties');

/* ---------------------------------------------------------------------------------------------
   3. Workflow storage
   --------------------------------------------------------------------------------------------- */
create table if not exists public.wf_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z][A-Z0-9_-]{1,39}$'),
  version integer not null default 1 check (version >= 1),
  name text not null check (length(name) between 1 and 200),
  description text check (description is null or length(description) <= 4000),
  category text not null default 'general' check (category ~ '^[a-z][a-z0-9_]{0,39}$'),
  source_section text not null check (source_section ~ '^[a-z]+\.[a-z_]+$'),
  owner_department text,
  owner_role text,
  workflow_owner uuid references public.profiles(id) on delete set null,
  state text not null default 'draft' check (state in ('draft', 'published', 'retired', 'disabled')),
  start_rule jsonb,
  required_roles text[] not null default '{}',
  required_documents jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 40),
  sla jsonb,
  notifications jsonb not null default '{}'::jsonb,
  completion jsonb not null default '{}'::jsonb,
  template boolean not null default false,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  published_by uuid, published_at timestamptz, disabled_at timestamptz,
  unique (code, version)
);
-- at most one version of a process takes new requests
create unique index if not exists wf_definitions_one_published on public.wf_definitions(code) where state = 'published';

create table if not exists public.wf_instances (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.wf_definitions(id) on delete restrict,
  def_code text not null, def_version integer not null,
  record_id uuid not null references public.records(id) on delete cascade,
  section text not null,
  project_id uuid,
  requester uuid references public.profiles(id) on delete set null,
  owner uuid references public.profiles(id) on delete set null,
  current_step text, current_run uuid,
  status text not null default 'active' check (status in ('draft', 'active', 'waiting', 'blocked', 'completed', 'cancelled')),
  outcome text check (outcome is null or outcome in ('completed', 'rejected', 'cancelled')),
  priority text not null default 'Normal' check (priority in ('Low', 'Normal', 'High', 'Critical')),
  blocker text check (blocker is null or length(blocker) <= 500),
  started_at timestamptz not null default now(), due_at timestamptz, completed_at timestamptz,
  paused_since timestamptz, paused_total interval not null default '0',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create unique index if not exists wf_instances_one_open on public.wf_instances(record_id, def_code) where status in ('draft', 'active', 'waiting', 'blocked');
create index if not exists wf_instances_record_idx on public.wf_instances(record_id);
create index if not exists wf_instances_requester_idx on public.wf_instances(requester, status);
create index if not exists wf_instances_status_idx on public.wf_instances(status, def_code);

create table if not exists public.wf_step_runs (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.wf_instances(id) on delete cascade,
  seq integer not null,
  step_id text not null, step_type text not null, step_name text not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled', 'superseded')),
  outcome text,
  assignee uuid references public.profiles(id) on delete set null,
  assignee_role text,
  started_at timestamptz not null default now(), due_at timestamptz,
  paused boolean not null default false,
  completed_at timestamptz, completed_by uuid,
  note text check (note is null or length(note) <= 2000),
  blocked_reason text check (blocked_reason is null or length(blocked_reason) <= 500),
  soon_at timestamptz, overdue_at timestamptz, escalation_level integer not null default 0, escalated_at timestamptz,
  unique (instance_id, seq)
);
-- a process is in one step at a time (approvals with several approvers live inside their one step)
create unique index if not exists wf_runs_one_open on public.wf_step_runs(instance_id) where status = 'open';
create index if not exists wf_runs_assignee_idx on public.wf_step_runs(assignee) where status = 'open';
create index if not exists wf_runs_role_idx on public.wf_step_runs(assignee_role) where status = 'open';
create index if not exists wf_runs_due_idx on public.wf_step_runs(due_at) where status = 'open';

create table if not exists public.wf_links (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.wf_instances(id) on delete cascade,
  run_id uuid, kind text not null check (kind ~ '^[a-z_]{2,30}$'),
  record_id uuid not null,
  created_at timestamptz not null default now()
);
-- the key that makes every automatic action happen at most once per step run
create unique index if not exists wf_links_once on public.wf_links(run_id, kind) where run_id is not null;
create index if not exists wf_links_record_idx on public.wf_links(record_id);
create index if not exists wf_links_instance_idx on public.wf_links(instance_id);

create table if not exists public.wf_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  instance_id uuid, run_id uuid, record_id uuid, section text,
  actor uuid, kind text not null, step_id text,
  from_state text, to_state text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists wf_events_instance_idx on public.wf_events(instance_id, id);
create index if not exists wf_events_record_idx on public.wf_events(record_id, at desc);
create index if not exists wf_events_at_idx on public.wf_events(at desc);

-- the history is kept as written: no change, no deletion (rolling v23 back removes the table as a whole)
create or replace function public.wf_events_guard() returns trigger language plpgsql as $$
begin raise exception 'Process history cannot be changed or deleted' using errcode = '42501'; end $$;
drop trigger if exists wf_events_guard on public.wf_events;
create trigger wf_events_guard before update or delete on public.wf_events for each row execute function public.wf_events_guard();

create table if not exists public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_-]{1,39}$'),
  name text not null check (length(name) between 1 and 200),
  section text, active boolean not null default true,
  tiers jsonb not null default '[]'::jsonb check (jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) <= 20),
  version integer not null default 1, updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.approval_policies_history (
  id bigserial primary key, policy_code text not null, changed_at timestamptz not null default now(), changed_by uuid, before jsonb, after jsonb
);

create table if not exists public.ops_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), created_by uuid,
  source_record uuid not null references public.records(id) on delete cascade,
  target_section text not null, kind text not null check (kind in ('quotation', 'obligation', 'invoice', 'purchase', 'other')),
  method text not null check (method in ('model', 'pattern')),
  proposed jsonb not null, evidence jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected')),
  decided_by uuid, decided_at timestamptz, result_record uuid
);
create index if not exists ops_proposals_source_idx on public.ops_proposals(source_record, status);

do $$ declare t text; begin
  foreach t in array array['wf_definitions', 'wf_instances', 'wf_step_runs', 'wf_links', 'wf_events', 'approval_policies', 'approval_policies_history', 'ops_proposals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

/* ---------------------------------------------------------------------------------------------
   4. Approvals: a workflow approval belongs to a step run and to the exact values it was given on
   --------------------------------------------------------------------------------------------- */
alter table public.approvals add column if not exists wf_run uuid;
alter table public.approvals add column if not exists basis jsonb;
alter table public.approvals add column if not exists basis_hash text;
alter table public.approvals add column if not exists invalidated_at timestamptz;
alter table public.approvals add column if not exists invalidated_reason text;
alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check
  check (status in ('queued', 'pending', 'approved', 'rejected', 'changes_requested', 'cancelled', 'expired', 'invalidated'));
create index if not exists approvals_wf_run_idx on public.approvals(wf_run) where wf_run is not null;
create index if not exists approvals_approver_pending_idx on public.approvals(approver_id) where status = 'pending';

/* ---------------------------------------------------------------------------------------------
   5. Helpers: payment secrets refused, SLA calendar, the allow-listed rule model
   --------------------------------------------------------------------------------------------- */
create or replace function public._luhn(s text) returns boolean language sql immutable parallel safe set search_path = '' as $$
  select coalesce(sum(case when (length(s) - i) % 2 = 1 then case when d * 2 > 9 then d * 2 - 9 else d * 2 end else d end) % 10 = 0, false)
  from (select i, substr(s, i, 1)::int d from generate_series(1, length(s)) i) x
$$;

-- Bank passwords, card numbers, CVV, PINs and account numbers are never stored: payment details stay in the bank
-- and in the finance system. Applied to every value and every key of an operations record (any depth).
create or replace function public.ops_secret_check(d jsonb) returns void language plpgsql immutable set search_path = public as $$
declare k text; v text; digits text;
begin
  if d is null then return; end if;
  for k in select jsonb_object_keys(o) from jsonb_path_query(d, 'strict $.**') o where jsonb_typeof(o) = 'object' loop
    if k ~* '(password|passcode|passwd|^pin$|_pin$|cvv|cvc|card_?number|card_?no|iban|account_?number|routing_?number|sort_?code|swift_?login|bank_?login|secret|api_?key|access_?token)' then
      raise exception 'Bank and card details, passwords and other secrets are not stored in Workspace (field %)', k using errcode = '23514';
    end if;
  end loop;
  for v in select x #>> '{}' from jsonb_path_query(d, 'strict $.**') x where jsonb_typeof(x) = 'string' loop
    -- any run of 13–19 digits (spaces or dashes allowed) that passes the card checksum
    for digits in select regexp_replace(m[1], '[ -]', '', 'g') from regexp_matches(v, '((?:\d[ -]?){12,18}\d)', 'g') m loop
      if length(digits) between 13 and 19 and digits ~ '^[3-6]' and public._luhn(digits) then raise exception 'A card number cannot be stored in Workspace' using errcode = '23514'; end if;
    end loop;
    if upper(v) ~ '(^|[^A-Z0-9])[A-Z]{2}\d{2}( ?[A-Z0-9]){11,30}($|[^A-Z0-9])' and regexp_replace(v, '\s', '', 'g') ~ '\d{8}' then
      raise exception 'A bank account number (IBAN) cannot be stored in Workspace; keep it in the finance system' using errcode = '23514';
    end if;
  end loop;
end $$;

-- the due time of a step: hours, calendar days or business days (weekend from the settings, ISO weekday numbers)
create or replace function public.sla_add(p_from timestamptz, p_amount numeric, p_unit text, p_weekend int[] default array[6, 7])
returns timestamptz language plpgsql immutable set search_path = public as $$
declare t timestamptz := p_from; n integer;
begin
  if p_amount is null or p_amount <= 0 or p_unit is null then return null; end if;
  if p_unit = 'hours' then return p_from + make_interval(secs => (p_amount * 3600)::double precision); end if;
  if p_unit = 'calendar_days' then return p_from + make_interval(days => ceil(p_amount)::int); end if;
  if p_unit <> 'business_days' then return null; end if;
  n := least(ceil(p_amount)::int, 400);
  while n > 0 loop
    t := t + interval '1 day';
    if not (extract(isodow from t at time zone 'utc')::int = any(coalesce(p_weekend, '{}'))) then n := n - 1; end if;
  end loop;
  return t;
end $$;

-- The rule model. A rule is data, never code:
--   {"all": [rule…]} | {"any": [rule…]} | {"not": rule} | {"field": "<path>", "op": "<op>", "value": <scalar or list>}
-- path: record.<field> | facts.<name> | instance.priority | actor.role ; op: eq ne gt gte lt lte in nin empty present
create or replace function public.wf_rule_error(r jsonb, depth integer default 0) returns text
language plpgsql immutable set search_path = public as $$
declare x jsonb; e text; f text; o text; facts text[] := array['quotations', 'selected', 'amount', 'currency', 'approval_current', 'vendor_status',
  'impact_complete', 'received_all', 'received_any', 'budget_remaining', 'documents', 'paid', 'document_version', 'days_to_need', 'obligations'];
begin
  if r is null then return null; end if;
  if depth > 6 then return 'The rule is nested too deeply'; end if;
  if jsonb_typeof(r) <> 'object' then return 'A rule must be an object'; end if;
  if r ? 'all' or r ? 'any' then
    if (select count(*) from jsonb_object_keys(r)) <> 1 then return 'all / any must be the only key'; end if;
    x := coalesce(r->'all', r->'any');
    if jsonb_typeof(x) <> 'array' or jsonb_array_length(x) = 0 or jsonb_array_length(x) > 20 then return 'all / any needs a list of 1–20 rules'; end if;
    for e in select public.wf_rule_error(y, depth + 1) from jsonb_array_elements(x) y loop if e is not null then return e; end if; end loop;
    return null;
  end if;
  if r ? 'not' then
    if (select count(*) from jsonb_object_keys(r)) <> 1 then return 'not must be the only key'; end if;
    return public.wf_rule_error(r->'not', depth + 1);
  end if;
  if exists (select 1 from jsonb_object_keys(r) k where k not in ('field', 'op', 'value')) then return 'Unknown key in a condition (allowed: field, op, value)'; end if;
  f := r->>'field'; o := r->>'op';
  if f is null or not (f ~ '^record\.[a-z_][a-z0-9_]{0,40}$' or f = 'instance.priority' or f = 'actor.role' or (f ~ '^facts\.[a-z_]+$' and substr(f, 7) = any(facts))) then
    return 'Unknown field in a condition: ' || coalesce(f, '(none)');
  end if;
  if o is null or o not in ('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'empty', 'present') then return 'Unknown operator: ' || coalesce(o, '(none)'); end if;
  if o in ('empty', 'present') then return null; end if;
  if not r ? 'value' then return 'The condition on ' || f || ' needs a value'; end if;
  if o in ('in', 'nin') then
    if jsonb_typeof(r->'value') <> 'array' or jsonb_array_length(r->'value') > 50 or exists (select 1 from jsonb_array_elements(r->'value') y where jsonb_typeof(y) not in ('string', 'number', 'boolean')) then
      return 'in / nin need a list of up to 50 plain values';
    end if;
  elsif jsonb_typeof(r->'value') not in ('string', 'number', 'boolean') then return 'The value must be a plain value';
  elsif o in ('gt', 'gte', 'lt', 'lte') and jsonb_typeof(r->'value') <> 'number' then return 'gt / gte / lt / lte need a number';
  end if;
  return null;
end $$;

create or replace function public._num(v jsonb) returns numeric language sql immutable parallel safe set search_path = '' as $$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
              when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' then trim(v #>> '{}')::numeric end
$$;

create or replace function public.wf_rule(r jsonb, ctx jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare v jsonb; w jsonb; o text; a numeric; b numeric; x jsonb;
begin
  if r is null or r = '{}'::jsonb then return true; end if;
  if r ? 'all' then
    for x in select * from jsonb_array_elements(r->'all') loop if not public.wf_rule(x, ctx) then return false; end if; end loop; return true;
  elsif r ? 'any' then
    for x in select * from jsonb_array_elements(r->'any') loop if public.wf_rule(x, ctx) then return true; end if; end loop; return false;
  elsif r ? 'not' then return not public.wf_rule(r->'not', ctx);
  end if;
  v := ctx #> string_to_array(r->>'field', '.'); o := r->>'op'; w := r->'value';
  if o = 'empty' then return v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb; end if;
  if o = 'present' then return not (v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb); end if;
  if v is null or v = 'null'::jsonb then return o in ('ne', 'nin'); end if;
  if o in ('in', 'nin') then
    return (exists (select 1 from jsonb_array_elements(w) y where y = v or (public._num(y) is not null and public._num(y) = public._num(v)) or (y #>> '{}') = (v #>> '{}'))) = (o = 'in');
  end if;
  a := public._num(v); b := public._num(w);
  if o in ('gt', 'gte', 'lt', 'lte') then
    if a is null or b is null then return false; end if;
    return case o when 'gt' then a > b when 'gte' then a >= b when 'lt' then a < b else a <= b end;
  end if;
  if a is not null and b is not null then return (a = b) = (o = 'eq'); end if;
  return ((v #>> '{}') = (w #>> '{}')) = (o = 'eq');
end $$;

/* ---------------------------------------------------------------------------------------------
   6. Who may see a record — v21 rule, plus: purchase requests, payment requests, travel and general requests
      are seen by the people involved in them and by the desks that handle them (settings → desks)
   --------------------------------------------------------------------------------------------- */
create or replace function public.ops_involved(p_uid uuid, r public.records) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare rl text; me text := p_uid::text;
begin
  if p_uid is null then return false; end if;
  select role into rl from public.profiles where id = p_uid;
  if rl in ('owner', 'admin') or coalesce(public.ops_cfg()->'desks'->r.section, '[]'::jsonb) ? coalesce(rl, '') then return true; end if;
  if r.created_by = p_uid or coalesce(r.data->>'requester_id', '') = me or coalesce(r.data->>'owner_id', '') = me or coalesce(r.data->>'assignee_id', '') = me
     or coalesce(r.data->'travellers_ids', '[]'::jsonb) ? me then return true; end if;
  if exists (select 1 from public.approvals a where a.record_id = r.id and a.approver_id = p_uid) then return true; end if;
  if exists (select 1 from public.wf_instances i join public.wf_step_runs s on s.instance_id = i.id
             where i.record_id = r.id and (s.assignee = p_uid or s.completed_by = p_uid or (s.status = 'open' and s.assignee is null and s.assignee_role = rl))) then return true; end if;
  if coalesce(r.data->>'project_ref', '') <> '' and exists (select 1 from public.records p where p.id = public.as_uuid(r.data->>'project_ref') and p.data->>'manager_id' = me) then return true; end if;
  return false;
end $$;
revoke execute on function public.ops_involved(uuid, public.records) from public, anon, authenticated;

create or replace function public.extra_visible(p_uid uuid, r public.records) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare rl text; today text;
begin
  if r.section = 'company.announcements' then
    if p_uid = r.created_by then return true; end if;
    select role into rl from public.profiles where id = p_uid;
    if rl in ('owner', 'admin', 'management') then return true; end if;
    today := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
    return coalesce(r.status = 'Published' and coalesce(r.data->>'publish_at', '') <= today
      and (coalesce(r.data->>'expires', '') = '' or r.data->>'expires' >= today)
      and exists (select 1 from public.announcement_audience(r) a where a = p_uid), false);
  elsif r.section in ('company.documents', 'company.wiki') then
    if p_uid = r.created_by or coalesce(r.data->>'owner_id', '') = p_uid::text or coalesce(r.data->>'reviewer_id', '') = p_uid::text then return true; end if;
    select role into rl from public.profiles where id = p_uid;
    if coalesce((select (t.meta->>'restricted')::boolean from public.taxonomy t where t.kind = 'classification' and t.code = r.data->>'classification'), false)
       and not coalesce(coalesce(r.data->'access_ids', '[]'::jsonb) ? p_uid::text or coalesce(r.data->'contributors_ids', '[]'::jsonb) ? p_uid::text or rl in ('owner', 'management'), false) then
      return false;
    end if;
    return coalesce(r.section <> 'company.wiki' or coalesce(r.status, 'Published') in ('Published', 'Superseded', 'Archived') or rl in ('owner', 'admin', 'management'), false);
  elsif r.section = 'company.decisions' and coalesce(r.data->>'source_ref', '') ~ '^[0-9a-f-]{36}$' then
    return not exists (select 1 from public.records s where s.id = (r.data->>'source_ref')::uuid)
      or exists (select 1 from public.records s where s.id = (r.data->>'source_ref')::uuid and public.record_visible_for(p_uid, s));
  elsif r.section in ('operations.requests', 'finance.payments', 'company.travel', 'company.requests') then
    return public.ops_involved(p_uid, r);
  end if;
  return true;
end $$;
revoke execute on function public.extra_visible(uuid, public.records) from public, anon, authenticated;

create or replace function public.record_visible(r public.records) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); p record;
begin
  select pp.role, pp.us_person, pp.company into p from public.profiles pp where pp.id = me;
  if not found then return false; end if;
  if coalesce(p.role not in ('owner', 'admin'), true) and not exists (select 1 from public.section_access a where a.role = p.role and a.section = r.section) then return false; end if;
  -- NULL-safe: an unknown flag or company counts as the stricter case, exactly as the SQL version did
  if r.controlled is distinct from false and not coalesce(p.us_person, false) then return false; end if;
  if coalesce(p.role in ('partner', 'vendor', 'investor', 'pending'), true) and not coalesce(r.company = '*' or r.company = p.company, false) then return false; end if;
  if r.section in ('company.announcements', 'company.documents', 'company.wiki', 'company.decisions', 'operations.requests', 'finance.payments', 'company.travel', 'company.requests') then return coalesce(public.extra_visible(me, r), false); end if;
  return true;
end $$;
revoke execute on function public.record_visible(public.records) from anon;

create or replace function public.record_visible_for(p_user uuid, r public.records) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare p record;
begin
  select pp.role, pp.us_person, pp.company into p from public.profiles pp where pp.id = p_user and not pp.disabled;
  if not found then return false; end if;
  if coalesce(p.role not in ('owner', 'admin'), true) and not exists (select 1 from public.section_access a where a.role = p.role and a.section = r.section) then return false; end if;
  -- NULL-safe: an unknown flag or company counts as the stricter case, exactly as the SQL version did
  if r.controlled is distinct from false and not coalesce(p.us_person, false) then return false; end if;
  if coalesce(p.role in ('partner', 'vendor', 'investor', 'pending'), true) and not coalesce(r.company = '*' or r.company = p.company, false) then return false; end if;
  if r.section in ('company.announcements', 'company.documents', 'company.wiki', 'company.decisions', 'operations.requests', 'finance.payments', 'company.travel', 'company.requests') then return coalesce(public.extra_visible(p_user, r), false); end if;
  return true;
end $$;
revoke execute on function public.record_visible_for(uuid, public.records) from public, anon, authenticated;

-- the signed-in internal person, or null (every public operations function starts here)
create or replace function public.ops_viewer() returns uuid language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and public.session_ok() and public.is_active_employee(auth.uid()) then auth.uid() end
$$;
revoke execute on function public.ops_viewer() from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   7. Definitions: validation, drafts, publishing, new versions, disabling (the ordered step editor)
   --------------------------------------------------------------------------------------------- */
create or replace function public.wf_known_roles() returns text[] language sql stable security definer set search_path = public as $$
  select array(select distinct r from (select 'owner' r union select 'admin' union select 'procurement' union select a.role from public.section_access a) x order by 1)
$$;
revoke execute on function public.wf_known_roles() from public, anon, authenticated;

-- a responsible-person specification: who acts on a step (never a named person)
create or replace function public._wf_resp_error(sp jsonb, what text) returns text language plpgsql stable security definer set search_path = public as $$
begin
  if sp is null or jsonb_typeof(sp) <> 'object' then return what || ': who is responsible is missing'; end if;
  if sp->>'kind' not in ('requester', 'role', 'department_lead', 'project_manager', 'workflow_owner', 'field') then return what || ': unknown kind of responsible «' || coalesce(sp->>'kind', '') || '»'; end if;
  if sp->>'kind' = 'role' and not (sp->>'role' = any(public.wf_known_roles())) then return what || ': unknown role «' || coalesce(sp->>'role', '') || '»'; end if;
  if sp->>'kind' = 'department_lead' and sp ? 'dept' and not exists (select 1 from public.departments d where d.key = sp->>'dept') then return what || ': unknown department «' || coalesce(sp->>'dept', '') || '»'; end if;
  if sp->>'kind' = 'field' and coalesce(sp->>'field', '') !~ '^[a-z][a-z0-9_]{0,40}_id$' then return what || ': the person field must end in _id'; end if;
  if sp ? 'fallback' then return public._wf_resp_error(sp->'fallback', what || ' (fallback)'); end if;
  return null;
end $$;
revoke execute on function public._wf_resp_error(jsonb, text) from public, anon, authenticated;

create or replace function public._wf_sla_error(s jsonb, what text) returns text language sql immutable set search_path = public as $$
  select case when s is null then null
    when jsonb_typeof(s) <> 'object' or s->>'unit' not in ('hours', 'business_days', 'calendar_days') then what || ': SLA unit must be hours, business_days or calendar_days'
    when public._num(s->'amount') is null or public._num(s->'amount') <= 0 or public._num(s->'amount') > 1000 then what || ': SLA amount must be between 0 and 1000'
    else null end
$$;

-- Every problem of a definition, in plain words. Publishing is refused while the list is not empty.
create or replace function public.wf_validate(d jsonb) returns jsonb
language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare errs jsonb := '[]'::jsonb; st jsonb; ids text[] := '{}'; id text; t text; e text; tgt text; tgts text[]; reach text[]; frontier text[]; nxt text[];
  i int; n int; k text; pol public.approval_policies; tier jsonb; ap jsonb; roles text[] := public.wf_known_roles(); cur text; seen text[]; ok boolean;
  edges jsonb := '{}'::jsonb; okc text[];
  procedure_err text;
begin
  if coalesce(d->>'name', '') = '' then errs := errs || jsonb_build_object('code', 'name', 'message', 'The process needs a name'); end if;
  if coalesce(d->>'code', '') !~ '^[A-Z][A-Z0-9_-]{1,39}$' then errs := errs || jsonb_build_object('code', 'code', 'message', 'The code must be 2–40 capital letters, digits, - or _'); end if;
  if coalesce(d->>'source_section', '') !~ '^[a-z]+\.[a-z_]+$' then errs := errs || jsonb_build_object('code', 'section', 'message', 'Choose the kind of record the process runs on'); end if;
  e := public.wf_rule_error(d->'start_rule'); if e is not null then errs := errs || jsonb_build_object('code', 'start_rule', 'message', 'Start condition: ' || e); end if;
  for t in select jsonb_array_elements_text(coalesce(d->'required_roles', '[]')) loop
    if not t = any(roles) then errs := errs || jsonb_build_object('code', 'invalid_role', 'message', 'Unknown role allowed to start: ' || t); end if;
  end loop;
  for st in select * from jsonb_array_elements(coalesce(d->'required_documents', '[]')) loop
    if coalesce(st->>'field', '') !~ '^[a-z][a-z0-9_]{0,40}$' then errs := errs || jsonb_build_object('code', 'invalid_document', 'message', 'A required document needs the field that links it');
    elsif st ? 'doc_type' and not exists (select 1 from public.taxonomy x where x.kind = 'doc_type' and x.code = st->>'doc_type') then
      errs := errs || jsonb_build_object('code', 'invalid_document', 'message', 'Unknown document type: ' || (st->>'doc_type'));
    end if;
  end loop;
  e := public._wf_sla_error(d->'sla', 'Whole process'); if e is not null then errs := errs || jsonb_build_object('code', 'sla', 'message', e); end if;
  if d ? 'owner_role' and coalesce(d->>'owner_role', '') <> '' and not (d->>'owner_role' = any(roles)) then errs := errs || jsonb_build_object('code', 'invalid_role', 'message', 'Unknown process owner role: ' || (d->>'owner_role')); end if;
  if jsonb_typeof(d->'steps') is distinct from 'array' or jsonb_array_length(d->'steps') = 0 then
    return errs || jsonb_build_object('code', 'no_steps', 'message', 'Add at least one step');
  end if;
  -- the steps one by one
  for st in select * from jsonb_array_elements(d->'steps') loop
    id := st->>'id';
    if coalesce(id, '') !~ '^[a-z][a-z0-9_]{0,39}$' then errs := errs || jsonb_build_object('code', 'step_id', 'step', id, 'message', 'Step id must be lower-case letters, digits or _'); continue; end if;
    if id = any(ids) then errs := errs || jsonb_build_object('code', 'duplicate_step', 'step', id, 'message', 'Two steps have the id ' || id); end if;
    ids := ids || id;
  end loop;
  for st in select * from jsonb_array_elements(d->'steps') loop
    id := st->>'id'; t := st->>'type';
    if coalesce(st->>'name', '') = '' then errs := errs || jsonb_build_object('code', 'step_name', 'step', id, 'message', 'Step ' || id || ' needs a name'); end if;
    if t is null or t not in ('TASK', 'REVIEW', 'APPROVAL', 'DOCUMENT', 'DECISION', 'DATA', 'WAIT', 'AUTOMATION', 'CHECK') then
      errs := errs || jsonb_build_object('code', 'step_type', 'step', id, 'message', 'Step ' || id || ': unknown type ' || coalesce(t, '(none)')); continue;
    end if;
    if exists (select 1 from jsonb_object_keys(st) x where x not in ('id', 'name', 'type', 'description', 'responsible', 'sla', 'prerequisites', 'on', 'guard', 'guard_message', 'record_status', 'escalation',
        'fields', 'documents', 'options', 'policy', 'action', 'params', 'rule', 'wait_kind', 'party_field', 'pause_sla', 'task_title', 'allow_requester', 'selects_quote', 'records_payment', 'confirms_impact', 'receives', 'instructions')) then
      errs := errs || jsonb_build_object('code', 'step_key', 'step', id, 'message', 'Step ' || id || ' has a setting that is not allowed: ' ||
        (select string_agg(x, ', ') from jsonb_object_keys(st) x where x not in ('id', 'name', 'type', 'description', 'responsible', 'sla', 'prerequisites', 'on', 'guard', 'guard_message', 'record_status', 'escalation',
        'fields', 'documents', 'options', 'policy', 'action', 'params', 'rule', 'wait_kind', 'party_field', 'pause_sla', 'task_title', 'allow_requester', 'selects_quote', 'records_payment', 'confirms_impact', 'receives', 'instructions')));
    end if;
    if t not in ('AUTOMATION', 'CHECK', 'APPROVAL') then
      e := public._wf_resp_error(st->'responsible', 'Step ' || id); if e is not null then errs := errs || jsonb_build_object('code', 'missing_owner', 'step', id, 'message', e); end if;
    end if;
    e := public._wf_sla_error(st->'sla', 'Step ' || id); if e is not null then errs := errs || jsonb_build_object('code', 'sla', 'step', id, 'message', e); end if;
    e := public.wf_rule_error(st->'guard'); if e is not null then errs := errs || jsonb_build_object('code', 'rule', 'step', id, 'message', 'Step ' || id || ' guard: ' || e); end if;
    if st ? 'escalation' then
      e := public._wf_sla_error(st->'escalation'->'after', 'Step ' || id || ' escalation'); if e is not null then errs := errs || jsonb_build_object('code', 'escalation', 'step', id, 'message', e); end if;
      e := public._wf_resp_error(st->'escalation'->'to', 'Step ' || id || ' escalation'); if e is not null then errs := errs || jsonb_build_object('code', 'escalation', 'step', id, 'message', e); end if;
    end if;
    for k in select jsonb_array_elements_text(coalesce(st->'prerequisites', '[]')) loop
      if not k = any(ids) then errs := errs || jsonb_build_object('code', 'prerequisite', 'step', id, 'message', 'Step ' || id || ' waits for an unknown step ' || k); end if;
    end loop;
    if t = 'APPROVAL' then
      select * into pol from public.approval_policies where code = st->>'policy';
      if not found then errs := errs || jsonb_build_object('code', 'approval_chain', 'step', id, 'message', 'Step ' || id || ': approval policy «' || coalesce(st->>'policy', '') || '» does not exist');
      elsif not pol.active then errs := errs || jsonb_build_object('code', 'approval_chain', 'step', id, 'message', 'Step ' || id || ': approval policy ' || pol.code || ' is switched off');
      elsif jsonb_array_length(pol.tiers) = 0 then errs := errs || jsonb_build_object('code', 'approval_chain', 'step', id, 'message', 'Step ' || id || ': approval policy ' || pol.code || ' has no levels');
      else
        for tier in select * from jsonb_array_elements(pol.tiers) loop
          if jsonb_array_length(coalesce(tier->'steps', '[]')) = 0 then errs := errs || jsonb_build_object('code', 'approval_chain', 'step', id, 'message', 'Policy ' || pol.code || ': a level has no approvers'); end if;
          for ap in select * from jsonb_array_elements(coalesce(tier->'steps', '[]')) loop
            if ap->>'kind' = 'requester' then errs := errs || jsonb_build_object('code', 'approval_chain', 'step', id, 'message', 'Policy ' || pol.code || ': the requester cannot approve their own request');
            else e := public._wf_resp_error(ap, 'Policy ' || pol.code); if e is not null then errs := errs || jsonb_build_object('code', 'approval_chain', 'step', id, 'message', e); end if; end if;
          end loop;
        end loop;
      end if;
    elsif t = 'DECISION' then
      if jsonb_typeof(st->'options') is distinct from 'array' or jsonb_array_length(st->'options') not between 2 and 8 then
        errs := errs || jsonb_build_object('code', 'decision', 'step', id, 'message', 'Step ' || id || ': a decision needs 2–8 options');
      end if;
    elsif t = 'CHECK' then
      if st->'rule' is null then errs := errs || jsonb_build_object('code', 'rule', 'step', id, 'message', 'Step ' || id || ': a check needs a rule');
      else e := public.wf_rule_error(st->'rule'); if e is not null then errs := errs || jsonb_build_object('code', 'rule', 'step', id, 'message', 'Step ' || id || ': ' || e); end if; end if;
    elsif t = 'AUTOMATION' then
      if coalesce(st->>'action', '') not in ('create_purchase', 'mark_ordered', 'set_status', 'allocate_number', 'create_task', 'notify') then
        errs := errs || jsonb_build_object('code', 'automation', 'step', id, 'message', 'Step ' || id || ': automatic action must be one of create_purchase, mark_ordered, set_status, allocate_number, create_task, notify');
      elsif st->>'action' = 'set_status' and coalesce(st->'params'->>'status', '') = '' then errs := errs || jsonb_build_object('code', 'automation', 'step', id, 'message', 'Step ' || id || ': set_status needs a status');
      elsif st->>'action' in ('create_task', 'notify') then
        e := public._wf_resp_error(st->'params'->'to', 'Step ' || id); if e is not null then errs := errs || jsonb_build_object('code', 'automation', 'step', id, 'message', e); end if;
      end if;
      if exists (select 1 from jsonb_object_keys(coalesce(st->'params', '{}')) x where x not in ('status', 'to', 'title', 'text', 'due_days')) then
        errs := errs || jsonb_build_object('code', 'automation', 'step', id, 'message', 'Step ' || id || ': unknown setting of the automatic action');
      end if;
    elsif t = 'DOCUMENT' then
      if jsonb_typeof(st->'documents') is distinct from 'array' or jsonb_array_length(st->'documents') = 0 then
        errs := errs || jsonb_build_object('code', 'invalid_document', 'step', id, 'message', 'Step ' || id || ': say which documents are required');
      else
        for ap in select * from jsonb_array_elements(st->'documents') loop
          if ap->>'kind' = 'quotations' then
            if public._num(ap->'min') is null or public._num(ap->'min') < 1 then errs := errs || jsonb_build_object('code', 'invalid_document', 'step', id, 'message', 'Step ' || id || ': how many quotations are required?'); end if;
          elsif ap->>'kind' = 'document' then
            if coalesce(ap->>'field', '') !~ '^[a-z][a-z0-9_]{0,40}$' then errs := errs || jsonb_build_object('code', 'invalid_document', 'step', id, 'message', 'Step ' || id || ': the document needs the field that links it');
            elsif ap ? 'doc_type' and not exists (select 1 from public.taxonomy x where x.kind = 'doc_type' and x.code = ap->>'doc_type') then
              errs := errs || jsonb_build_object('code', 'invalid_document', 'step', id, 'message', 'Step ' || id || ': unknown document type ' || (ap->>'doc_type'));
            end if;
          else errs := errs || jsonb_build_object('code', 'invalid_document', 'step', id, 'message', 'Step ' || id || ': document kind must be quotations or document');
          end if;
        end loop;
      end if;
    elsif t = 'WAIT' then
      if coalesce(st->>'wait_kind', '') not in ('Colleague', 'Supplier', 'Partner', 'Client', 'Contractor', 'Authority') then
        errs := errs || jsonb_build_object('code', 'wait', 'step', id, 'message', 'Step ' || id || ': say who we wait for (Supplier, Partner, Client, Contractor, Authority or Colleague)');
      end if;
    elsif t = 'DATA' then
      if st ? 'fields' and (jsonb_typeof(st->'fields') <> 'array' or exists (select 1 from jsonb_array_elements_text(st->'fields') x where x !~ '^[a-z][a-z0-9_]{0,40}$')) then
        errs := errs || jsonb_build_object('code', 'data', 'step', id, 'message', 'Step ' || id || ': required fields must be a list of field keys');
      end if;
    end if;
    -- transitions
    if st ? 'on' and jsonb_typeof(st->'on') <> 'object' then errs := errs || jsonb_build_object('code', 'transition', 'step', id, 'message', 'Step ' || id || ': transitions must be an object'); continue; end if;
    for k in select jsonb_object_keys(coalesce(st->'on', '{}')) loop
      if k not in ('success', 'rejected', 'changes_requested', 'cancelled', 'timed_out', 'conditional') then errs := errs || jsonb_build_object('code', 'transition', 'step', id, 'message', 'Step ' || id || ': unknown transition ' || k); end if;
    end loop;
    tgts := '{}';
    for k in select x from jsonb_each_text(coalesce(st->'on', '{}') - 'conditional') y(x0, x) loop tgts := tgts || k; end loop;
    for ap in select * from jsonb_array_elements(case when jsonb_typeof(st->'on'->'conditional') = 'array' then st->'on'->'conditional' else '[]' end) loop
      e := public.wf_rule_error(ap->'when'); if e is not null or ap->'when' is null then errs := errs || jsonb_build_object('code', 'rule', 'step', id, 'message', 'Step ' || id || ' conditional transition: ' || coalesce(e, 'needs a condition')); end if;
      tgts := tgts || coalesce(ap->>'to', '');
    end loop;
    for ap in select * from jsonb_array_elements(case when t = 'DECISION' and jsonb_typeof(st->'options') = 'array' then st->'options' else '[]' end) loop
      if coalesce(ap->>'key', '') !~ '^[a-z][a-z0-9_]{0,30}$' or coalesce(ap->>'label', '') = '' then errs := errs || jsonb_build_object('code', 'decision', 'step', id, 'message', 'Step ' || id || ': each option needs a key and a label'); end if;
      tgts := tgts || coalesce(ap->>'to', '');
    end loop;
    foreach tgt in array tgts loop
      if not (tgt = any(ids) or tgt in ('$complete', '$cancel', '$reject')) then errs := errs || jsonb_build_object('code', 'transition', 'step', id, 'message', 'Step ' || id || ' leads to an unknown step «' || tgt || '»'); end if;
    end loop;
    -- the default next step: success, else the next one in the list, else the end
    n := array_position(ids, id);
    if not (coalesce(st->'on', '{}') ? 'success') and t <> 'DECISION' then tgts := tgts || coalesce(ids[n + 1], '$complete'); end if;
    edges := edges || jsonb_build_object(id, to_jsonb(tgts));
  end loop;
  if jsonb_array_length(errs) > 0 then return errs; end if;
  -- reachability from the first step
  reach := array[ids[1]]; frontier := reach;
  while array_length(frontier, 1) > 0 loop
    nxt := '{}';
    foreach cur in array frontier loop
      for tgt in select jsonb_array_elements_text(coalesce(edges->cur, '[]')) loop
        if tgt = any(ids) and not tgt = any(reach) then reach := reach || tgt; nxt := nxt || tgt; end if;
      end loop;
    end loop;
    frontier := nxt;
  end loop;
  foreach id in array ids loop
    if not id = any(reach) then errs := errs || jsonb_build_object('code', 'unreachable', 'step', id, 'message', 'Step ' || id || ' can never be reached'); end if;
  end loop;
  -- every reachable step can still finish (no dead end)
  okc := '{}';
  loop
    n := coalesce(array_length(okc, 1), 0);
    foreach id in array ids loop
      if not id = any(okc) and exists (select 1 from jsonb_array_elements_text(coalesce(edges->id, '[]')) x where x in ('$complete', '$reject', '$cancel') or x = any(okc)) then okc := okc || id; end if;
    end loop;
    exit when coalesce(array_length(okc, 1), 0) = n;
  end loop;
  if not exists (select 1 from jsonb_each(edges) e2, jsonb_array_elements_text(e2.value) x where x = '$complete') then
    errs := errs || jsonb_build_object('code', 'missing_completion', 'message', 'No step completes the process');
  end if;
  foreach id in array reach loop
    if not id = any(okc) then errs := errs || jsonb_build_object('code', 'missing_completion', 'step', id, 'message', 'From step ' || id || ' the process can never finish'); end if;
  end loop;
  -- a loop that no person or condition can leave: following only the default transitions comes back to the same step
  foreach id in array ids loop
    cur := id; seen := array[id]; i := 0;
    loop
      select st2 into st from jsonb_array_elements(d->'steps') st2 where st2->>'id' = cur;
      exit when st->>'type' = 'DECISION' or (st->'on'->'conditional') is not null;
      n := array_position(ids, cur);
      cur := coalesce(st->'on'->>'success', ids[n + 1], '$complete');
      exit when cur like '$%';
      if cur = id then errs := errs || jsonb_build_object('code', 'loop', 'step', id, 'message', 'Steps from ' || id || ' go round in a loop without a decision'); exit; end if;
      exit when cur = any(seen);
      seen := seen || cur; i := i + 1; exit when i > 50;
    end loop;
  end loop;
  return errs;
end $$;
revoke execute on function public.wf_validate(jsonb) from public, anon;
grant execute on function public.wf_validate(jsonb) to authenticated;

-- a published version never changes: only its state moves on (retired when a newer one is published, or disabled)
create or replace function public.wf_definitions_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.state <> 'draft' or exists (select 1 from public.wf_instances i where i.definition_id = old.id) then raise exception 'Only an unused draft can be deleted' using errcode = '42501'; end if;
    return old;
  end if;
  if old.state <> 'draft' and (new.steps is distinct from old.steps or new.start_rule is distinct from old.start_rule or new.required_roles is distinct from old.required_roles
     or new.required_documents is distinct from old.required_documents or new.sla is distinct from old.sla or new.completion is distinct from old.completion
     or new.source_section is distinct from old.source_section or new.code is distinct from old.code or new.version is distinct from old.version
     or new.notifications is distinct from old.notifications or new.name is distinct from old.name) then
    raise exception 'A published version cannot be changed: make a new version' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists wf_definitions_guard on public.wf_definitions;
create trigger wf_definitions_guard before update or delete on public.wf_definitions for each row execute function public.wf_definitions_guard();

create or replace function public._ops_admin(p_uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_uid and not p.disabled and p.role in ('owner', 'admin', 'management'))
$$;
revoke execute on function public._ops_admin(uuid) from public, anon, authenticated;

create or replace function public._wf_event(p_inst uuid, p_run uuid, p_actor uuid, p_kind text, p_step text, p_from text, p_to text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.wf_events(instance_id, run_id, record_id, section, actor, kind, step_id, from_state, to_state, detail)
  select p_inst, p_run, i.record_id, i.section, p_actor, p_kind, p_step, p_from, p_to, coalesce(p_detail, '{}'::jsonb)
  from (select null::uuid record_id, null::text section) d left join public.wf_instances i on i.id = p_inst
$$;
revoke execute on function public._wf_event(uuid, uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.wf_definition_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); d public.wf_definitions; v int;
begin
  if me is null or not public._ops_admin(me) then raise exception 'Only owners, administrators and management edit processes' using errcode = '42501'; end if;
  if p ? 'id' and coalesce(p->>'id', '') <> '' then
    select * into d from public.wf_definitions where id = (p->>'id')::uuid for update;
    if not found then raise exception 'Process not found'; end if;
    if d.state <> 'draft' then raise exception 'A published version cannot be changed: make a new version' using errcode = '42501'; end if;
    update public.wf_definitions set name = coalesce(p->>'name', name), description = p->>'description', category = coalesce(nullif(p->>'category', ''), category),
      source_section = coalesce(nullif(p->>'source_section', ''), source_section), owner_department = nullif(p->>'owner_department', ''), owner_role = nullif(p->>'owner_role', ''),
      workflow_owner = public.as_uuid(p->>'workflow_owner'), start_rule = case when p ? 'start_rule' then nullif(p->'start_rule', 'null'::jsonb) else start_rule end,
      required_roles = coalesce(array(select jsonb_array_elements_text(p->'required_roles')), required_roles),
      required_documents = coalesce(p->'required_documents', required_documents), steps = coalesce(p->'steps', steps), sla = case when p ? 'sla' then nullif(p->'sla', 'null'::jsonb) else sla end,
      notifications = coalesce(p->'notifications', notifications), completion = coalesce(p->'completion', completion), template = coalesce((p->>'template')::boolean, template)
    where id = d.id returning * into d;
  else
    select coalesce(max(version), 0) + 1 into v from public.wf_definitions where code = p->>'code';
    insert into public.wf_definitions(code, version, name, description, category, source_section, owner_department, owner_role, workflow_owner, start_rule, required_roles, required_documents, steps, sla, notifications, completion, template, created_by)
    values (p->>'code', v, p->>'name', p->>'description', coalesce(nullif(p->>'category', ''), 'general'), p->>'source_section', nullif(p->>'owner_department', ''), nullif(p->>'owner_role', ''),
      public.as_uuid(p->>'workflow_owner'), nullif(p->'start_rule', 'null'::jsonb), coalesce(array(select jsonb_array_elements_text(coalesce(p->'required_roles', '[]'))), '{}'),
      coalesce(p->'required_documents', '[]'), coalesce(p->'steps', '[]'), nullif(p->'sla', 'null'::jsonb), coalesce(p->'notifications', '{}'), coalesce(p->'completion', '{}'), coalesce((p->>'template')::boolean, false), me)
    returning * into d;
  end if;
  perform public._wf_event(null, null, me, 'definition_saved', null, null, 'draft', jsonb_build_object('definition', d.id, 'code', d.code, 'version', d.version));
  return jsonb_build_object('id', d.id, 'code', d.code, 'version', d.version, 'state', d.state, 'errors', public.wf_validate(to_jsonb(d)));
end $$;
revoke execute on function public.wf_definition_save(jsonb) from public, anon;
grant execute on function public.wf_definition_save(jsonb) to authenticated;

create or replace function public.wf_definition_publish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); d public.wf_definitions; errs jsonb;
begin
  if me is null or not public._ops_admin(me) then raise exception 'Only owners, administrators and management publish processes' using errcode = '42501'; end if;
  select * into d from public.wf_definitions where id = p_id for update;
  if not found then raise exception 'Process not found'; end if;
  if d.state <> 'draft' then raise exception 'Only a draft can be published' using errcode = '22023'; end if;
  errs := public.wf_validate(to_jsonb(d));
  if jsonb_array_length(errs) > 0 then return jsonb_build_object('ok', false, 'errors', errs); end if;
  perform 1 from public.wf_definitions where code = d.code for update;
  update public.wf_definitions set state = 'retired' where code = d.code and state in ('published', 'disabled') and id <> d.id;
  update public.wf_definitions set state = 'published', published_by = me, published_at = now() where id = d.id;
  perform public._wf_event(null, null, me, 'definition_published', null, 'draft', 'published', jsonb_build_object('definition', d.id, 'code', d.code, 'version', d.version));
  return jsonb_build_object('ok', true, 'id', d.id, 'version', d.version, 'errors', '[]'::jsonb);
end $$;
revoke execute on function public.wf_definition_publish(uuid) from public, anon;
grant execute on function public.wf_definition_publish(uuid) to authenticated;

create or replace function public.wf_definition_new_version(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); d public.wf_definitions; n public.wf_definitions;
begin
  if me is null or not public._ops_admin(me) then raise exception 'Only owners, administrators and management edit processes' using errcode = '42501'; end if;
  if exists (select 1 from public.wf_definitions where code = p_code and state = 'draft') then raise exception 'There is already a draft of this process' using errcode = '23505'; end if;
  select * into d from public.wf_definitions where code = p_code order by version desc limit 1;
  if not found then raise exception 'Process not found'; end if;
  insert into public.wf_definitions(code, version, name, description, category, source_section, owner_department, owner_role, workflow_owner, start_rule, required_roles, required_documents, steps, sla, notifications, completion, template, created_by)
  values (d.code, d.version + 1, d.name, d.description, d.category, d.source_section, d.owner_department, d.owner_role, d.workflow_owner, d.start_rule, d.required_roles, d.required_documents, d.steps, d.sla, d.notifications, d.completion, d.template, me)
  returning * into n;
  perform public._wf_event(null, null, me, 'definition_versioned', null, null, 'draft', jsonb_build_object('definition', n.id, 'code', n.code, 'version', n.version, 'from', d.version));
  return jsonb_build_object('id', n.id, 'version', n.version);
end $$;
revoke execute on function public.wf_definition_new_version(text) from public, anon;
grant execute on function public.wf_definition_new_version(text) to authenticated;

create or replace function public.wf_definition_disable(p_code text, p_on boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); d public.wf_definitions;
begin
  if me is null or not public._ops_admin(me) then raise exception 'Only owners, administrators and management change processes' using errcode = '42501'; end if;
  select * into d from public.wf_definitions where code = p_code and state = case when p_on then 'disabled' else 'published' end for update;
  if not found then raise exception 'No % version of this process', case when p_on then 'disabled' else 'published' end; end if;
  update public.wf_definitions set state = case when p_on then 'published' else 'disabled' end, disabled_at = case when p_on then null else now() end where id = d.id;
  perform public._wf_event(null, null, me, case when p_on then 'definition_enabled' else 'definition_disabled' end, null, d.state, case when p_on then 'published' else 'disabled' end, jsonb_build_object('definition', d.id, 'code', d.code, 'version', d.version));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.wf_definition_disable(text, boolean) from public, anon;
grant execute on function public.wf_definition_disable(text, boolean) to authenticated;

create or replace function public.wf_definitions_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'version', d.version, 'name', d.name, 'description', d.description, 'category', d.category,
      'source_section', d.source_section, 'state', d.state, 'template', d.template, 'owner_role', d.owner_role, 'owner_department', d.owner_department, 'workflow_owner', d.workflow_owner,
      'steps', d.steps, 'start_rule', d.start_rule, 'required_roles', to_jsonb(d.required_roles), 'required_documents', d.required_documents, 'sla', d.sla, 'completion', d.completion,
      'published_at', d.published_at, 'running', (select count(*) from public.wf_instances i where i.definition_id = d.id and i.status in ('active', 'waiting', 'blocked')))
    order by d.code, d.version desc) from public.wf_definitions d), '[]'::jsonb);
end $$;
revoke execute on function public.wf_definitions_list() from public, anon;
grant execute on function public.wf_definitions_list() to authenticated;

/* ---------------------------------------------------------------------------------------------
   8. Engine: context, responsible people, numbering, record writes
   --------------------------------------------------------------------------------------------- */
create or replace function public._wf_step(p_def uuid, p_step text) returns jsonb language sql stable security definer set search_path = public as $$
  select s from public.wf_definitions d, jsonb_array_elements(d.steps) s where d.id = p_def and s->>'id' = p_step limit 1
$$;
revoke execute on function public._wf_step(uuid, text) from public, anon, authenticated;

-- the values an approval is given on: the material fields of the record (settings → material), and for a contract the
-- exact version of its document. A different value means a different approval.
create or replace function public._wf_basis(r public.records) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b jsonb := '{}'::jsonb; k text; dv text;
begin
  for k in select jsonb_array_elements_text(coalesce(public.ops_cfg()->'material'->r.section, '[]')) loop
    b := b || jsonb_build_object(k, case when public._num(r.data->k) is not null then to_jsonb(public._num(r.data->k)) else r.data->k end);
  end loop;
  if r.section = 'legal.contracts' and coalesce(r.data->>'document_ref', '') <> '' then
    select d.data->>'current_version_id' into dv from public.records d where d.id = public.as_uuid(r.data->>'document_ref');
    b := b || jsonb_build_object('document_version', dv);
  end if;
  return b;
end $$;
revoke execute on function public._wf_basis(public.records) from public, anon, authenticated;

-- an approval of this process is valid for the record as it is now
create or replace function public._wf_approval_current(p_inst uuid, r public.records) returns boolean language sql stable security definer set search_path = public as $$
  with last as (
    select s.id from public.wf_step_runs s where s.instance_id = p_inst and s.step_type = 'APPROVAL' and s.status = 'done' and s.outcome = 'success'
    order by s.seq desc limit 1)
  select exists (select 1 from last)
     and not exists (select 1 from public.approvals a, last where a.wf_run = last.id and a.status = 'invalidated')
     and exists (select 1 from public.approvals a, last where a.wf_run = last.id and a.status = 'approved' and a.basis_hash = md5(public._wf_basis(r)::text))
$$;
revoke execute on function public._wf_approval_current(uuid, public.records) from public, anon, authenticated;

-- facts the rules may use (computed, never guessed)
create or replace function public._wf_facts(p_inst uuid, r public.records) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := '{}'::jsonb; q int; amt numeric; rem numeric; v text; tot numeric; got numeric; anyr boolean;
begin
  f := jsonb_build_object('approval_current', case when p_inst is null then false else public._wf_approval_current(p_inst, r) end);
  if r.section = 'operations.requests' then
    select count(*) into q from public.records x where x.section = 'operations.quotations' and x.data->>'request_ref' = r.id::text and coalesce(x.status, '') not in ('Withdrawn', 'Expired');
    amt := coalesce(public._num(r.data->'selected_amount'), public._num(r.data->'est_amount'));
    select x.status into v from public.records x where x.id = public.as_uuid(r.data->>'vendor_ref');
    select sum(coalesce(public._num(x.data->'qty'), 0)), sum(coalesce(public._num(x.data->'qty_received'), 0)), bool_or(coalesce(public._num(x.data->'qty_received'), 0) > 0)
      into tot, got, anyr from public.records x where x.section = 'operations.procurement' and x.data->>'request_ref' = r.id::text and coalesce(x.status, '') <> 'Cancelled';
    f := f || jsonb_build_object('quotations', q, 'selected', coalesce(r.data->>'selected_quote_ref', '') <> '', 'amount', amt,
      'currency', coalesce(r.data->>'selected_currency', r.data->>'currency'), 'vendor_status', v,
      'received_all', coalesce(tot > 0 and got >= tot, false), 'received_any', coalesce(anyr, false),
      'days_to_need', case when coalesce(r.data->>'needed_by', '') ~ '^\d{4}-\d{2}-\d{2}' then (left(r.data->>'needed_by', 10)::date - current_date) end);
    if coalesce(r.data->>'project_ref', '') <> '' then
      select b.remaining into rem from public._ops_budget_calc(public.as_uuid(r.data->>'project_ref'), null) b where b.currency = coalesce(r.data->>'selected_currency', r.data->>'currency', 'USD');
      f := f || jsonb_build_object('budget_remaining', rem);
    end if;
  elsif r.section = 'finance.payments' then
    f := f || jsonb_build_object('amount', public._num(r.data->'amount'), 'currency', r.data->>'currency', 'paid', coalesce(r.data->>'paid_on', '') <> '');
  elsif r.section = 'legal.contracts' then
    select d.data->>'current_version_id' into v from public.records d where d.id = public.as_uuid(r.data->>'document_ref');
    select count(*) into q from public.records x where x.section = 'legal.contract_obligations' and x.data->>'contract_ref' = r.id::text;
    f := f || jsonb_build_object('documents', case when v is not null then 1 else 0 end, 'document_version', v, 'obligations', q, 'amount', public._num(r.data->'value'), 'currency', r.data->>'currency');
  elsif r.section = 'technical.changes' then
    f := f || jsonb_build_object('impact_complete', coalesce(r.data->>'impact_confirmed_at', '') <> '', 'amount', public._num(r.data->'impact_cost'));
  elsif r.section = 'company.travel' then
    f := f || jsonb_build_object('amount', public._num(r.data->'est_cost'), 'currency', r.data->>'currency');
  else
    f := f || jsonb_build_object('amount', public._num(r.data->'amount'), 'currency', r.data->>'currency');
  end if;
  return f;
end $$;
revoke execute on function public._wf_facts(uuid, public.records) from public, anon, authenticated;

create or replace function public._wf_ctx(p_inst uuid, r public.records, p_actor uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('record', r.data || jsonb_build_object('status', r.status, 'title', r.title),
    'instance', jsonb_build_object('priority', (select i.priority from public.wf_instances i where i.id = p_inst)),
    'facts', public._wf_facts(p_inst, r),
    'actor', jsonb_build_object('role', (select p.role from public.profiles p where p.id = p_actor)))
$$;
revoke execute on function public._wf_ctx(uuid, public.records, uuid) from public, anon, authenticated;

-- may this person be given a step on this record? The reading rule, except that on per-record sections being
-- given the step is what makes the person involved (they could not see it before)
create or replace function public._wf_could_see(p_uid uuid, r public.records) returns boolean language plpgsql stable security definer set search_path = public as $$
declare p record;
begin
  if r.section not in ('operations.requests', 'finance.payments', 'company.travel', 'company.requests') then return public.record_visible_for(p_uid, r); end if;
  select pp.role, coalesce(pp.us_person, false) us into p from public.profiles pp where pp.id = p_uid and not pp.disabled;
  if not found or p.role in ('partner', 'vendor', 'investor', 'pending') then return false; end if;
  if p.role not in ('owner', 'admin') and not exists (select 1 from public.section_access a where a.role = p.role and a.section = r.section) then return false; end if;
  return not (r.controlled is distinct from false) or p.us;
end $$;
revoke execute on function public._wf_could_see(uuid, public.records) from public, anon, authenticated;

-- one person who may act, or a role whose members may act; nobody who could not open the record
create or replace function public._wf_resolve(sp jsonb, p_inst uuid, r public.records, p_def uuid, out o_uid uuid, out o_role text)
language plpgsql stable security definer set search_path = public as $$
declare i public.wf_instances; d public.wf_definitions; k text := sp->>'kind'; dk text;
begin
  select * into i from public.wf_instances where id = p_inst;
  select * into d from public.wf_definitions where id = coalesce(p_def, i.definition_id);
  if k = 'requester' then o_uid := coalesce(i.requester, public.as_uuid(r.data->>'requester_id'), r.created_by);
  elsif k = 'role' then o_role := sp->>'role';
  elsif k = 'department_lead' then
    dk := coalesce(sp->>'dept', (select dp.key from public.profiles p join public.departments dp on dp.id = p.department_id where p.id = coalesce(i.requester, r.created_by)));
    select dp.manager_id into o_uid from public.departments dp where dp.key = dk and dp.active;
  elsif k = 'project_manager' then
    select public.as_uuid(p.data->>'manager_id') into o_uid from public.records p where p.id = public.as_uuid(r.data->>'project_ref') and p.section = 'company.projects';
  elsif k = 'workflow_owner' then
    o_uid := d.workflow_owner;
    if o_uid is null and d.owner_department is not null then select dp.manager_id into o_uid from public.departments dp where dp.key = d.owner_department and dp.active; end if;
    if o_uid is null then o_role := d.owner_role; end if;
  elsif k = 'field' then o_uid := public.as_uuid(r.data->>(sp->>'field'));
  end if;
  if o_uid is not null and not (public.is_active_employee(o_uid) and public._wf_could_see(o_uid, r)) then o_uid := null; end if;
  if o_role is not null and not exists (select 1 from public.profiles p where p.role = o_role and not p.disabled and public._wf_could_see(p.id, r)) then o_role := null; end if;
  if o_uid is null and o_role is null and sp ? 'fallback' then select x.o_uid, x.o_role into o_uid, o_role from public._wf_resolve(sp->'fallback', p_inst, r, p_def) x; end if;
end $$;
revoke execute on function public._wf_resolve(jsonb, uuid, public.records, uuid) from public, anon, authenticated;

create or replace function public.ops_number(p_section text, p_project uuid default null) returns text language plpgsql security definer set search_path = public as $$
declare t text := public.ops_cfg()->'numbering'->>p_section;
begin
  if t is null then return null; end if;
  return public.allocate_doc_number('ops', t, null, p_project);
end $$;
revoke execute on function public.ops_number(text, uuid) from public, anon, authenticated;

-- the engine's own changes to a record (status, links, numbers). Runs as the definer, so the user-facing guard
-- (records_ops_guard) does not apply; every change is still logged by the existing record triggers.
-- the engine marks its own writes with a key nobody else can read, so the task rule of v19 lets the step move
-- a task on even when the person acting is a member of the step's role rather than the task's assignee
create table if not exists public.wf_engine_key (id boolean primary key default true check (id), key text not null);
alter table public.wf_engine_key enable row level security;
revoke all on public.wf_engine_key from anon, authenticated;
insert into public.wf_engine_key(id, key) values (true, encode(extensions.gen_random_bytes(24), 'hex')) on conflict (id) do nothing;
create or replace function public._wf_engine() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('agron.wf_engine', true) = (select key from public.wf_engine_key where id), false)
$$;
revoke execute on function public._wf_engine() from public, anon, authenticated;

create or replace function public._wf_rec_patch(p_id uuid, p_status text, p_patch jsonb) returns public.records language plpgsql security definer set search_path = public as $$
declare r public.records; prev text := coalesce(current_setting('agron.wf_engine', true), '');
begin
  perform set_config('agron.wf_engine', (select key from public.wf_engine_key where id), true);
  update public.records set status = coalesce(p_status, status), data = data || coalesce(p_patch, '{}'::jsonb) where id = p_id returning * into r;
  perform set_config('agron.wf_engine', prev, true);
  return r;
end $$;
revoke execute on function public._wf_rec_patch(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public._wf_name(p_uid uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where id = p_uid
$$;
revoke execute on function public._wf_name(uuid) from public, anon, authenticated;

-- notify the people who must act (a role: its members who can open the record, at most 25)
create or replace function public._wf_notify(p_uid uuid, p_role text, p_kind text, r public.records, p_key text, p_title text, p_body text, p_actor uuid, p_link text)
returns integer language plpgsql security definer set search_path = public as $$
declare u uuid; n int := 0;
begin
  if p_uid is not null then if public.notify_user(p_uid, p_kind, r.id, p_key, p_title, p_body, p_actor, p_link) then n := 1; end if; return n; end if;
  if p_role is null then return 0; end if;
  for u in select p.id from public.profiles p where p.role = p_role and not p.disabled order by p.created_at desc limit 200 loop
    exit when n >= 25;
    if public.record_visible_for(u, r) and public.notify_user(u, p_kind, r.id, p_key || ':' || u, p_title, p_body, p_actor, p_link) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public._wf_notify(uuid, text, text, public.records, text, text, text, uuid, text) from public, anon, authenticated;

-- "What you need to do", in plain words, from the step type
create or replace function public.wf_todo(p_type text, p_name text) returns text language sql immutable set search_path = public as $$
  select case p_type
    when 'TASK' then 'Do the task: ' || p_name
    when 'REVIEW' then 'Review and approve, ask for changes or reject: ' || p_name
    when 'APPROVAL' then 'Approve or reject: ' || p_name
    when 'DOCUMENT' then 'Attach the required documents: ' || p_name
    when 'DECISION' then 'Choose how to continue: ' || p_name
    when 'DATA' then 'Fill in the details and submit: ' || p_name
    when 'WAIT' then 'Record when it has arrived: ' || p_name
    when 'CHECK' then 'Check failed — fix the record and check again: ' || p_name
    when 'AUTOMATION' then 'Automatic step: ' || p_name
    else p_name end
$$;

-- a work step is an ordinary task in the one task system (Waiting when we wait for someone outside)
create or replace function public._wf_task(p_run uuid, st jsonb, i public.wf_instances, r public.records, p_actor uuid, p_kind text default 'task') returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.wf_step_runs; t uuid; party text; nm text;
begin
  select * into s from public.wf_step_runs where id = p_run;
  select record_id into t from public.wf_links where run_id = p_run and kind = p_kind;
  if t is not null then return t; end if;
  party := case when st ? 'party_field' then coalesce(r.data->>(st->>'party_field' || '_title'), r.data->>(st->>'party_field')) end;
  party := coalesce(party, r.data->>'vendor', r.data->>'counterparty');
  nm := coalesce(nullif(st->>'task_title', ''), st->>'name') || ' — ' || coalesce(r.data->>'number', r.title);
  insert into public.records(section, title, status, controlled, created_by, data)
  values ('company.tasks', left(nm, 300), case when st->>'type' = 'WAIT' then 'Waiting' else 'New' end, r.controlled, coalesce(p_actor, i.requester, r.created_by),
    jsonb_strip_nulls(jsonb_build_object(
      'assignee_id', s.assignee, 'assignee', public._wf_name(s.assignee),
      'due', to_char(s.due_at at time zone 'utc', 'YYYY-MM-DD'),
      'priority', i.priority,
      'project_ref', coalesce(r.data->>'project_ref', case when r.section = 'company.projects' then r.id::text end),
      'project_ref_title', r.data->>'project_ref_title',
      'description', coalesce(st->>'instructions', public.wf_todo(st->>'type', st->>'name')),
      'related', '/ops?i=' || i.id,
      'requested_by_id', i.requester, 'requested_by', public._wf_name(i.requester),
      'waiting_kind', case when st->>'type' = 'WAIT' then st->>'wait_kind' end,
      'waiting_on', case when st->>'type' = 'WAIT' then party end,
      'wf_instance', i.id, 'wf_run', p_run, 'wf_record', r.id)))
  returning id into t;
  insert into public.wf_links(instance_id, run_id, kind, record_id) values (i.id, p_run, p_kind, t);
  return t;
end $$;
revoke execute on function public._wf_task(uuid, jsonb, public.wf_instances, public.records, uuid, text) from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   9. Engine: entering a step, finishing it, closing the process
   --------------------------------------------------------------------------------------------- */
create or replace function public._wf_block(p_inst uuid, p_run uuid, p_reason text, p_actor uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wf_instances set status = 'blocked', blocker = left(p_reason, 500), updated_at = now(), version = version + 1 where id = p_inst;
  if p_run is not null then update public.wf_step_runs set blocked_reason = left(p_reason, 500) where id = p_run; end if;
  perform public._wf_event(p_inst, p_run, p_actor, 'blocked', null, null, 'blocked', jsonb_build_object('reason', left(p_reason, 500)));
end $$;
revoke execute on function public._wf_block(uuid, uuid, text, uuid) from public, anon, authenticated;

-- tasks of steps that are no longer current are closed as Cancelled (the task list stays the truth)
create or replace function public._wf_cancel_tasks(p_inst uuid) returns integer language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in select l.record_id from public.wf_links l join public.wf_step_runs s on s.id = l.run_id join public.records x on x.id = l.record_id
           where l.instance_id = p_inst and l.kind in ('task', 'task_auto') and s.status <> 'open' and x.status not in ('Completed', 'Cancelled') loop
    perform public._wf_rec_patch(t.record_id, 'Cancelled', jsonb_build_object('blocker', 'The process moved on'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._wf_cancel_tasks(uuid) from public, anon, authenticated;

create or replace function public._wf_enter(p_inst uuid, p_step text, p_actor uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.wf_instances; r public.records; st jsonb; s public.wf_step_runs; res record; v_uid uuid; v_role text; sq int; due timestamptz; wk int[]; depth int; pre text; err text; ctx jsonb; was_waiting boolean;
begin
  depth := coalesce(nullif(current_setting('agron.wf_depth', true), '')::int, 0) + 1;
  if depth > 40 then raise exception 'The process passed too many automatic steps at once (stopped at step %)', p_step; end if;
  perform set_config('agron.wf_depth', depth::text, true);
  select * into i from public.wf_instances where id = p_inst for update;
  select * into r from public.records where id = i.record_id;
  st := public._wf_step(i.definition_id, p_step);
  if st is null then raise exception 'Step % is not part of this process', p_step; end if;
  update public.wf_step_runs set status = 'superseded', completed_at = now() where instance_id = i.id and status = 'open';
  perform public._wf_cancel_tasks(i.id);
  select coalesce(max(x.seq), 0) + 1 into sq from public.wf_step_runs x where x.instance_id = i.id;
  if st->>'type' not in ('AUTOMATION', 'CHECK', 'APPROVAL') then select x.o_uid, x.o_role into v_uid, v_role from public._wf_resolve(st->'responsible', i.id, r, null) x; end if;
  wk := array(select x::int from jsonb_array_elements_text(coalesce(public.ops_cfg()->'weekend', '[6,7]')) x);
  due := public.sla_add(now(), public._num(st->'sla'->'amount'), st->'sla'->>'unit', wk);
  insert into public.wf_step_runs(instance_id, seq, step_id, step_type, step_name, assignee, assignee_role, due_at, paused)
  values (i.id, sq, st->>'id', st->>'type', st->>'name', v_uid, v_role, due, st->>'type' = 'WAIT' and coalesce((st->>'pause_sla')::boolean, true))
  returning * into s;
  -- the process-level SLA stops while we wait for someone outside (settings → sla_pause_states)
  was_waiting := i.status = 'waiting' and i.paused_since is not null;
  update public.wf_instances set current_step = s.step_id, current_run = s.id, blocker = null, updated_at = now(), version = version + 1,
    status = case when s.paused and coalesce(public.ops_cfg()->'sla_pause_states', '["waiting"]') ? 'waiting' then 'waiting' else 'active' end,
    paused_since = case when s.paused then coalesce(paused_since, now()) else null end,
    paused_total = case when not s.paused and was_waiting then paused_total + (now() - paused_since) else paused_total end,
    due_at = case when not s.paused and was_waiting and due_at is not null then due_at + (now() - paused_since) else due_at end
  where id = i.id returning * into i;
  perform public._wf_event(i.id, s.id, p_actor, 'step_entered', s.step_id, null, 'open',
    jsonb_strip_nulls(jsonb_build_object('seq', sq, 'type', s.step_type, 'assignee', s.assignee, 'role', s.assignee_role, 'due', s.due_at, 'reason', p_reason)));
  if coalesce(st->>'record_status', '') <> '' and r.status is distinct from st->>'record_status' then r := public._wf_rec_patch(r.id, st->>'record_status', null); end if;
  -- a step waits for earlier steps that must be done first
  for pre in select jsonb_array_elements_text(coalesce(st->'prerequisites', '[]')) loop
    if not exists (select 1 from public.wf_step_runs x where x.instance_id = i.id and x.step_id = pre and x.status = 'done') then
      perform public._wf_block(i.id, s.id, 'Waits for step «' || pre || '» to be done first', p_actor);
      perform set_config('agron.wf_depth', (depth - 1)::text, true); return s.id;
    end if;
  end loop;
  if st->>'type' not in ('AUTOMATION', 'CHECK', 'APPROVAL') and s.assignee is null and s.assignee_role is null then
    perform public._wf_block(i.id, s.id, 'Nobody can be found to do step «' || s.step_name || '» — reassign it', p_actor);
  elsif st->>'type' in ('TASK', 'WAIT') then
    perform public._wf_task(s.id, st, i, r, p_actor);
  elsif st->>'type' = 'APPROVAL' then
    err := public._wf_approval_open(s.id, st, i, r, p_actor);
    if err is not null then perform public._wf_block(i.id, s.id, err, p_actor); end if;
  elsif st->>'type' = 'AUTOMATION' then
    perform public._wf_automate(s.id, st, i, r, p_actor);
  elsif st->>'type' = 'CHECK' then
    ctx := public._wf_ctx(i.id, r, p_actor);
    if public.wf_rule(st->'rule', ctx) then perform public._wf_finish(s.id, p_actor, 'success', 'Check passed');
    elsif st->'on' ? 'rejected' then perform public._wf_finish(s.id, p_actor, 'rejected', coalesce(st->>'guard_message', 'Check not met'));
    else perform public._wf_block(i.id, s.id, coalesce(st->>'guard_message', 'Check not met: ' || s.step_name), p_actor);
    end if;
  end if;
  if st->>'type' in ('REVIEW', 'DOCUMENT', 'DECISION', 'DATA', 'TASK', 'WAIT') and (s.assignee is not null or s.assignee_role is not null) then
    perform public._wf_notify(s.assignee, s.assignee_role, 'wf_action', r, 'wf:' || s.id, 'Action needed: ' || s.step_name || ' — ' || coalesce(r.data->>'number', r.title),
      public.wf_todo(s.step_type, s.step_name), p_actor, '/ops?i=' || i.id);
  end if;
  perform set_config('agron.wf_depth', (depth - 1)::text, true);
  return s.id;
end $$;
revoke execute on function public._wf_enter(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function public._wf_close(p_inst uuid, p_outcome text, p_actor uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.wf_instances; d public.wf_definitions; st text;
begin
  select * into i from public.wf_instances where id = p_inst for update;
  select * into d from public.wf_definitions where id = i.definition_id;
  update public.wf_step_runs set status = 'cancelled', completed_at = now(), note = coalesce(note, left(p_note, 2000)) where instance_id = i.id and status = 'open';
  update public.approvals set status = 'cancelled', comment = coalesce(comment, 'Process closed') where wf_run in (select id from public.wf_step_runs where instance_id = i.id) and status in ('pending', 'queued');
  update public.wf_instances set status = case when p_outcome = 'cancelled' then 'cancelled' else 'completed' end, outcome = p_outcome, completed_at = now(),
    current_step = null, current_run = null, blocker = null, updated_at = now(), version = version + 1,
    paused_total = case when paused_since is not null then paused_total + (now() - paused_since) else paused_total end, paused_since = null
  where id = i.id;
  perform public._wf_cancel_tasks(i.id);
  st := d.completion->>p_outcome;
  if coalesce(st, '') <> '' then perform public._wf_rec_patch(i.record_id, st, null); end if;
  perform public._wf_event(i.id, null, p_actor, p_outcome, null, i.status, case when p_outcome = 'cancelled' then 'cancelled' else 'completed' end, jsonb_strip_nulls(jsonb_build_object('note', left(p_note, 500))));
  perform public._wf_notify(i.requester, null, 'wf_done', (select x from public.records x where x.id = i.record_id), 'wf-done:' || i.id,
    initcap(p_outcome) || ': ' || d.name, p_note, p_actor, '/ops?i=' || i.id);
end $$;
revoke execute on function public._wf_close(uuid, text, uuid, text) from public, anon, authenticated;

-- finish the current step with an outcome and follow the transition
create or replace function public._wf_finish(p_run uuid, p_actor uuid, p_outcome text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.wf_step_runs; i public.wf_instances; r public.records; d public.wf_definitions; st jsonb; tgt text; c jsonb; ctx jsonb; pos int;
begin
  select * into s from public.wf_step_runs where id = p_run;
  if not found then raise exception 'Step not found'; end if;
  select * into i from public.wf_instances where id = s.instance_id for update;
  select * into s from public.wf_step_runs where id = p_run for update;
  if s.status <> 'open' or i.current_run is distinct from s.id then raise exception 'This step is already done' using errcode = '55000'; end if;
  select * into d from public.wf_definitions where id = i.definition_id;
  select * into r from public.records where id = i.record_id;
  st := public._wf_step(d.id, s.step_id);
  update public.wf_step_runs set status = 'done', outcome = p_outcome, completed_at = now(), completed_by = p_actor, note = left(p_note, 2000), blocked_reason = null where id = s.id;
  perform public._wf_event(i.id, s.id, p_actor, 'step_completed', s.step_id, 'open', p_outcome, jsonb_strip_nulls(jsonb_build_object('note', left(p_note, 500))));
  if s.step_type = 'APPROVAL' and p_outcome = 'success' then
    -- what was approved, on the record itself (read by budgets and lists; the binding check stays on the approvals)
    ctx := public._wf_facts(i.id, r);
    r := public._wf_rec_patch(r.id, null, jsonb_strip_nulls(jsonb_build_object('approved_amount', ctx->'amount', 'approved_currency', ctx->>'currency', 'approved_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
    ctx := null;
  end if;
  if p_outcome = 'success' then
    ctx := public._wf_ctx(i.id, r, p_actor);
    for c in select * from jsonb_array_elements(case when jsonb_typeof(st->'on'->'conditional') = 'array' then st->'on'->'conditional' else '[]' end) loop
      if public.wf_rule(c->'when', ctx) then tgt := c->>'to'; exit; end if;
    end loop;
    if tgt is null then tgt := st->'on'->>'success'; end if;
    if tgt is null then
      select o into pos from jsonb_array_elements(d.steps) with ordinality x(v, o) where v->>'id' = s.step_id;
      tgt := coalesce(d.steps->pos->>'id', '$complete');
    end if;
  elsif p_outcome = 'rejected' then tgt := coalesce(st->'on'->>'rejected', '$reject');
  elsif p_outcome = 'changes_requested' then tgt := coalesce(st->'on'->>'changes_requested', d.steps->0->>'id');
  elsif p_outcome = 'cancelled' then tgt := coalesce(st->'on'->>'cancelled', '$cancel');
  elsif p_outcome = 'timed_out' then tgt := st->'on'->>'timed_out';
  elsif st->>'type' = 'DECISION' then
    select o->>'to' into tgt from jsonb_array_elements(st->'options') o where o->>'key' = p_outcome;
  end if;
  if tgt is null then raise exception 'Step % has no way forward for «%»', s.step_id, p_outcome; end if;
  if tgt = '$complete' then perform public._wf_close(i.id, 'completed', p_actor, p_note);
  elsif tgt = '$reject' then perform public._wf_close(i.id, 'rejected', p_actor, p_note);
  elsif tgt = '$cancel' then perform public._wf_close(i.id, 'cancelled', p_actor, p_note);
  else perform public._wf_enter(i.id, tgt, p_actor, p_outcome);
  end if;
end $$;
revoke execute on function public._wf_finish(uuid, uuid, text, text) from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   10. Starting a process
   --------------------------------------------------------------------------------------------- */
create or replace function public._wf_start(p_actor uuid, p_code text, p_record uuid, p_priority text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.records; d public.wf_definitions; rl text; e jsonb; doc public.records; i public.wf_instances; num text; first text; req uuid; wk int[];
begin
  select role into rl from public.profiles where id = p_actor and not disabled;
  if rl is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into r from public.records where id = p_record for update;
  if not found or not public.record_visible_for(p_actor, r) then raise exception 'Record not found' using errcode = 'P0002'; end if;
  select * into d from public.wf_definitions where code = p_code and state = 'published';
  if not found then raise exception 'The process % is not available (not published or switched off)', p_code using errcode = '55000'; end if;
  if r.section <> d.source_section then raise exception 'This process runs on % records', d.source_section using errcode = '22023'; end if;
  if cardinality(d.required_roles) > 0 and not (rl = any(d.required_roles) or rl in ('owner', 'admin')) then
    raise exception 'Your role cannot start this process' using errcode = '42501';
  end if;
  if not (rl in ('owner', 'admin') or r.created_by = p_actor or coalesce(r.data->>'requester_id', '') = p_actor::text
          or exists (select 1 from public.section_access a where a.role = rl and a.section = r.section and a.can_write)) then
    raise exception 'You cannot start a process on this record' using errcode = '42501';
  end if;
  if not public.wf_rule(d.start_rule, public._wf_ctx(null, r, p_actor)) then raise exception 'The record does not meet the start condition of this process' using errcode = '23514'; end if;
  for e in select * from jsonb_array_elements(d.required_documents) loop
    select * into doc from public.records x where x.id = public.as_uuid(r.data->>(e->>'field')) and x.section = 'company.documents';
    if not found or not public.record_visible_for(p_actor, doc) or (e ? 'doc_type' and doc.data->>'doc_type' is distinct from e->>'doc_type') then
      raise exception 'Link the required document first (%)', coalesce(e->>'doc_type', e->>'field') using errcode = '23514';
    end if;
  end loop;
  if exists (select 1 from public.wf_instances x where x.record_id = r.id and x.def_code = d.code and x.status in ('draft', 'active', 'waiting', 'blocked')) then
    raise exception 'This record already has an open process «%»', d.name using errcode = '23505';
  end if;
  req := coalesce(public.as_uuid(r.data->>'requester_id'), r.created_by, p_actor);
  if not public.is_active_employee(req) then req := p_actor; end if;
  num := r.data->>'number';
  if num is null then num := public.ops_number(r.section, public.as_uuid(r.data->>'project_ref')); end if;
  r := public._wf_rec_patch(r.id, null, jsonb_strip_nulls(jsonb_build_object('number', num, 'requester_id', req, 'requester', public._wf_name(req))));
  wk := array(select x::int from jsonb_array_elements_text(coalesce(public.ops_cfg()->'weekend', '[6,7]')) x);
  insert into public.wf_instances(definition_id, def_code, def_version, record_id, section, project_id, requester, owner, status, priority, due_at)
  values (d.id, d.code, d.version, r.id, r.section, public.as_uuid(r.data->>'project_ref'), req, d.workflow_owner, 'active',
    case when p_priority in ('Low', 'Normal', 'High', 'Critical') then p_priority when r.data->>'priority' in ('Low', 'Normal', 'High', 'Critical') then r.data->>'priority' else 'Normal' end,
    public.sla_add(now(), public._num(d.sla->'amount'), d.sla->>'unit', wk))
  returning * into i;
  perform public._wf_event(i.id, null, p_actor, 'started', null, null, 'active', jsonb_build_object('code', d.code, 'version', d.version, 'number', num));
  first := d.steps->0->>'id';
  perform public._wf_enter(i.id, first, p_actor, 'start');
  return i.id;
end $$;
revoke execute on function public._wf_start(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function public.wf_start(p_code text, p_record uuid, p_priority text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return public._wf_start(me, p_code, p_record, p_priority);
end $$;
revoke execute on function public.wf_start(text, uuid, text) from public, anon;
grant execute on function public.wf_start(text, uuid, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   11. Approvals inside a process: policy → levels → approvers; bound to the exact values (basis)
   --------------------------------------------------------------------------------------------- */
create or replace function public._wf_approval_open(p_run uuid, st jsonb, i public.wf_instances, r public.records, p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
declare pol public.approval_policies; tier jsonb; t jsonb; ctx jsonb; ap jsonb; k int := 0; cand uuid[]; lv jsonb := '[]'::jsonb; res record;
  basis jsonb := public._wf_basis(r); h text; chain uuid := gen_random_uuid(); mode text; x jsonb; u uuid; nrows int := 0;
begin
  h := md5(basis::text);
  select * into pol from public.approval_policies where code = st->>'policy' and active;
  if not found then return 'The approval policy «' || coalesce(st->>'policy', '') || '» is missing or switched off'; end if;
  ctx := public._wf_ctx(i.id, r, p_actor);
  for t in select * from jsonb_array_elements(pol.tiers) loop
    if t->'when' is null or public.wf_rule(t->'when', ctx) then tier := t; exit; end if;
  end loop;
  if tier is null then return 'No approval level of policy ' || pol.code || ' matches this request'; end if;
  mode := case when tier->>'mode' = 'parallel' then 'all' else 'sequential' end;
  for ap in select * from jsonb_array_elements(tier->'steps') loop
    k := k + 1;
    if ap->>'kind' = 'role' then
      cand := array(select p.id from public.profiles p where p.role = ap->>'role' and not p.disabled and p.id is distinct from i.requester and public._wf_could_see(p.id, r) order by p.created_at desc limit 25);
    else
      select * into res from public._wf_resolve(ap, i.id, r, null);
      -- the requester never approves their own request: their lead's place is taken by the fallback
      if res.o_uid is not null and res.o_uid = i.requester and ap ? 'fallback' then select * into res from public._wf_resolve(ap->'fallback', i.id, r, null); end if;
      if res.o_uid is not null then cand := array_remove(array[res.o_uid], i.requester);
      elsif res.o_role is not null then cand := array(select p.id from public.profiles p where p.role = res.o_role and not p.disabled and p.id is distinct from i.requester and public._wf_could_see(p.id, r) order by p.created_at desc limit 25);
      else cand := '{}'; end if;
    end if;
    if coalesce(cardinality(cand), 0) = 0 then
      return 'No one can approve level ' || k || ' (' || coalesce(ap->>'label', ap->>'role', ap->>'kind') || ') — the requester cannot approve their own request';
    end if;
    lv := lv || jsonb_build_object('k', k, 'label', coalesce(ap->>'label', ap->>'role', ap->>'kind'), 'ids', to_jsonb(cand));
  end loop;
  for x in select * from jsonb_array_elements(lv) loop
    for u in select (jsonb_array_elements_text(x->'ids'))::uuid loop
      insert into public.approvals(record_id, section, requested_by, approver_id, note, status, step, chain_id, chain_mode, wf_run, basis, basis_hash, version_id, expires_at)
      values (r.id, r.section, coalesce(i.requester, p_actor), u, left(pol.name || ' — ' || (x->>'label'), 2000),
        case when mode = 'all' or (x->>'k')::int = 1 then 'pending' else 'queued' end, (x->>'k')::int, chain, mode, p_run, basis, h,
        (select dv.id from public.document_versions dv where dv.id = public.as_uuid(basis->>'document_version')), now() + interval '30 days');
      nrows := nrows + 1;
    end loop;
  end loop;
  perform public._wf_event(i.id, p_run, p_actor, 'approval_requested', st->>'id', null, 'pending',
    jsonb_build_object('policy', pol.code, 'policy_version', pol.version, 'level', tier->>'label', 'mode', mode, 'levels', k, 'approvers', nrows, 'basis', basis, 'basis_hash', h));
  return null;
end $$;
revoke execute on function public._wf_approval_open(uuid, jsonb, public.wf_instances, public.records, uuid) from public, anon, authenticated;

-- An approval given on other values no longer counts: it is marked invalidated and the approval step runs again.
create or replace function public._wf_invalidate(p_record uuid, p_reason text, p_actor uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare i public.wf_instances; r public.records; h text; n int; total int := 0; ap_step text;
begin
  select * into r from public.records where id = p_record;
  h := md5(public._wf_basis(r)::text);
  for i in select * from public.wf_instances x where x.record_id = p_record and x.status in ('active', 'waiting', 'blocked') order by x.created_at for update loop
    update public.approvals a set status = 'invalidated', invalidated_at = now(), invalidated_reason = left(p_reason, 300)
     where a.wf_run in (select s.id from public.wf_step_runs s where s.instance_id = i.id) and a.status in ('pending', 'queued', 'approved') and a.basis_hash is distinct from h;
    get diagnostics n = row_count;
    if n > 0 then
      total := total + n;
      update public.records set data = data - array['approved_amount', 'approved_currency', 'approved_at'] where id = p_record and data ?| array['approved_amount', 'approved_currency', 'approved_at'];
      select s.step_id into ap_step from public.wf_step_runs s join public.approvals a on a.wf_run = s.id
       where s.instance_id = i.id and a.status = 'invalidated' and a.invalidated_at >= now() - interval '1 second' order by s.seq desc limit 1;
      perform public._wf_event(i.id, i.current_run, p_actor, 'approval_invalidated', ap_step, 'approved', 'invalidated', jsonb_build_object('approvals', n, 'reason', left(p_reason, 300), 'basis_hash', h));
      if ap_step is not null then perform public._wf_enter(i.id, ap_step, p_actor, 'reapproval: ' || left(p_reason, 200)); end if;
    end if;
  end loop;
  return total;
end $$;
revoke execute on function public._wf_invalidate(uuid, text, uuid) from public, anon, authenticated;

create or replace function public._wf_approval_decide(p_actor uuid, p_id uuid, p_decision text, p_comment text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.approvals; s public.wf_step_runs; i public.wf_instances; r public.records; nxt int; remaining int;
begin
  if p_decision not in ('approved', 'rejected', 'changes_requested') then raise exception 'Choose approve, request changes or reject' using errcode = '22023'; end if;
  select * into a from public.approvals where id = p_id;
  if not found or a.wf_run is null then raise exception 'Approval not found' using errcode = 'P0002'; end if;
  select * into s from public.wf_step_runs where id = a.wf_run;
  select * into i from public.wf_instances where id = s.instance_id for update;
  select * into a from public.approvals where id = p_id for update;
  if a.approver_id is distinct from p_actor then raise exception 'This approval is not yours to decide' using errcode = '42501'; end if;
  if a.status = 'invalidated' then raise exception 'This approval no longer applies: the request changed after it was asked (%)', coalesce(a.invalidated_reason, 'changed') using errcode = '55000'; end if;
  if a.status <> 'pending' then raise exception 'Already %', a.status using errcode = '55000'; end if;
  if a.expires_at < now() then update public.approvals set status = 'expired' where id = a.id; return jsonb_build_object('ok', false, 'error', 'This approval request expired'); end if;
  select * into r from public.records where id = a.record_id;
  if not public.is_active_employee(p_actor) or not public.record_visible_for(p_actor, r) then raise exception 'You can no longer open this request' using errcode = '42501'; end if;
  if p_actor = i.requester then raise exception 'The requester cannot approve their own request' using errcode = '42501'; end if;
  if p_decision in ('rejected', 'changes_requested') and coalesce(trim(p_comment), '') = '' then raise exception 'Say why' using errcode = '22023'; end if;
  select * into s from public.wf_step_runs where id = a.wf_run for update;
  if s.status <> 'open' or i.current_run is distinct from s.id then raise exception 'This approval step is no longer open' using errcode = '55000'; end if;
  if md5(public._wf_basis(r)::text) is distinct from a.basis_hash then
    perform public._wf_invalidate(r.id, 'Changed after the approval was requested', p_actor);
    return jsonb_build_object('ok', false, 'error', 'The request changed after approval was asked; a new approval was requested on the current values');
  end if;
  if exists (select 1 from public.approvals x where x.chain_id = a.chain_id and x.approver_id = p_actor and x.status = 'approved' and x.step <> a.step) then
    raise exception 'You already approved another level of this request' using errcode = '42501';
  end if;
  update public.approvals set status = p_decision, comment = left(nullif(trim(p_comment), ''), 2000), decided_at = now(), decided_by = p_actor where id = a.id;
  perform public._wf_event(i.id, s.id, p_actor, 'approval_decided', s.step_id, 'pending', p_decision,
    jsonb_build_object('approval', a.id, 'level', a.step, 'basis_hash', a.basis_hash, 'comment', left(p_comment, 300)));
  if p_decision = 'approved' then
    update public.approvals set status = 'cancelled', comment = 'Decided by another approver' where chain_id = a.chain_id and step = a.step and status = 'pending' and id <> a.id;
    select count(distinct x.step) into remaining from public.approvals x where x.chain_id = a.chain_id
      and not exists (select 1 from public.approvals y where y.chain_id = a.chain_id and y.step = x.step and y.status = 'approved');
    if remaining = 0 then
      perform public._wf_finish(s.id, p_actor, 'success', 'Approved');
    elsif a.chain_mode = 'sequential' then
      select min(x.step) into nxt from public.approvals x where x.chain_id = a.chain_id and x.status = 'queued';
      update public.approvals set status = 'pending' where chain_id = a.chain_id and step = nxt and status = 'queued';
    end if;
  else
    update public.approvals set status = 'cancelled', comment = 'Stopped: level ' || a.step || ' ' || replace(p_decision, '_', ' ') where chain_id = a.chain_id and status in ('pending', 'queued');
    perform public._wf_finish(s.id, p_actor, p_decision, p_comment);
  end if;
  return jsonb_build_object('ok', true, 'status', p_decision);
end $$;
revoke execute on function public._wf_approval_decide(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public._wf_approval_decide(uuid, uuid, text, text) to service_role;

create or replace function public.wf_approval_decide(p_id uuid, p_decision text, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return public._wf_approval_decide(me, p_id, p_decision, p_comment);
end $$;
revoke execute on function public.wf_approval_decide(uuid, text, text) from public, anon;
grant execute on function public.wf_approval_decide(uuid, text, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   12. Automatic steps — allow-listed actions only, through the Phase 1 queue (idempotent, retried, dead-lettered)
   --------------------------------------------------------------------------------------------- */
create or replace function public._wf_auto_exec(p_run uuid, st jsonb, p_inst uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
declare i public.wf_instances; r public.records; q public.records; v public.records; num text; t uuid; res record; existing uuid; n int;
begin
  select * into i from public.wf_instances where id = p_inst;
  select * into r from public.records where id = i.record_id;
  case st->>'action'
  when 'allocate_number' then
    if r.data ? 'number' then return 'number ' || (r.data->>'number'); end if;
    num := public.ops_number(r.section, public.as_uuid(r.data->>'project_ref'));
    if num is null then raise exception 'No number format for %', r.section; end if;
    perform public._wf_rec_patch(r.id, null, jsonb_build_object('number', num)); return 'number ' || num;
  when 'set_status' then
    perform public._wf_rec_patch(r.id, st->'params'->>'status', null); return 'status ' || (st->'params'->>'status');
  when 'notify' then
    select * into res from public._wf_resolve(st->'params'->'to', i.id, r, null);
    n := public._wf_notify(res.o_uid, res.o_role, 'wf_action', r, 'wf-auto:' || p_run, coalesce(st->'params'->>'title', st->>'name'), st->'params'->>'text', p_actor, '/ops?i=' || i.id);
    return 'notified ' || n;
  when 'create_task' then
    select * into res from public._wf_resolve(st->'params'->'to', i.id, r, null);
    if res.o_uid is null then raise exception 'Nobody can be found for the task'; end if;
    update public.wf_step_runs set assignee = res.o_uid where id = p_run;
    t := public._wf_task(p_run, jsonb_build_object('type', 'TASK', 'name', coalesce(st->'params'->>'title', st->>'name')), i, r, p_actor, 'task_auto');
    return 'task ' || t;
  when 'mark_ordered' then
    -- the order itself is placed by a person (Workspace sends nothing to the vendor); this records that it was
    n := 0;
    for t in select l.record_id from public.wf_links l join public.records x on x.id = l.record_id where l.instance_id = i.id and l.kind = 'purchase' and x.status = 'Approved' loop
      perform public._wf_rec_patch(t, 'Ordered', jsonb_build_object('ordered_on', to_char(current_date, 'YYYY-MM-DD'))); n := n + 1;
    end loop;
    return 'ordered ' || n;
  when 'create_purchase' then
    if r.section <> 'operations.requests' then raise exception 'A purchase record is created from a purchase request'; end if;
    select record_id into existing from public.wf_links where run_id = p_run and kind = 'purchase';
    if existing is not null then return 'purchase ' || existing; end if;
    if not public._wf_approval_current(i.id, r) then raise exception 'No valid approval for the current values of the request'; end if;
    -- approved again after a change: the purchase record already exists and is never duplicated; a person amends the order
    select l.record_id into existing from public.wf_links l join public.records x on x.id = l.record_id where l.instance_id = i.id and l.kind = 'purchase' and x.status <> 'Cancelled' limit 1;
    if existing is not null then
      select * into q from public.records where id = existing;
      if public._num(q.data->'amount') is distinct from public._num(r.data->'selected_amount') or (q.data->>'currency') is distinct from coalesce(r.data->>'selected_currency', r.data->>'currency') then
        update public.wf_step_runs set assignee = coalesce((select s2.assignee from public.wf_step_runs s2 join public.wf_links l2 on l2.run_id = s2.id where l2.instance_id = i.id and l2.kind = 'task' order by s2.seq desc limit 1), i.requester) where id = p_run;
        t := public._wf_task(p_run, jsonb_build_object('type', 'TASK', 'name', 'Amend the purchase order to the newly approved amount (' || coalesce(r.data->>'selected_amount', '?') || ' ' || coalesce(r.data->>'selected_currency', '') || ')',
          'instructions', 'The approval was given again on changed values. Agree the change with the vendor and update the purchase record; Workspace changes no order by itself.'), i, r, p_actor, 'task_auto');
        perform public._wf_event(i.id, p_run, p_actor, 'purchase_amend_needed', st->>'id', null, null, jsonb_build_object('purchase', existing, 'approved', public._num(r.data->'selected_amount'), 'ordered', public._num(q.data->'amount')));
      end if;
      perform public._wf_rec_patch(r.id, null, jsonb_build_object('purchase_ref', existing));
      return 'purchase exists ' || existing;
    end if;
    select * into q from public.records where id = public.as_uuid(r.data->>'selected_quote_ref') and section = 'operations.quotations';
    if not found then raise exception 'No quotation is selected'; end if;
    select * into v from public.records where id = public.as_uuid(q.data->>'vendor_ref');
    num := public.ops_number('operations.procurement', public.as_uuid(r.data->>'project_ref'));
    insert into public.records(section, title, status, controlled, created_by, data)
    values ('operations.procurement', left(coalesce(r.data->>'item', r.title), 300), 'Approved', r.controlled, coalesce(p_actor, i.requester),
      jsonb_strip_nulls(jsonb_build_object('number', num, 'request_ref', r.id, 'request_ref_title', coalesce(r.data->>'number', r.title),
        'quote_ref', q.id, 'quote_ref_title', q.title, 'vendor_ref', q.data->>'vendor_ref', 'vendor_ref_title', coalesce(v.title, q.data->>'vendor_ref_title'), 'vendor', coalesce(v.title, q.data->>'vendor_ref_title', r.data->>'vendor'),
        'party_ref', coalesce(v.data->>'party_ref', q.data->>'party_ref'), 'item', coalesce(r.data->>'item', r.title), 'qty', public._num(r.data->'qty'),
        'amount', public._num(r.data->'selected_amount'), 'currency', coalesce(r.data->>'selected_currency', r.data->>'currency'),
        'eta', q.data->>'delivery_date', 'project_ref', r.data->>'project_ref', 'project_ref_title', r.data->>'project_ref_title', 'qty_received', 0, 'wf_instance', i.id)))
    returning id into t;
    insert into public.wf_links(instance_id, run_id, kind, record_id) values (i.id, p_run, 'purchase', t);
    perform public._wf_rec_patch(r.id, null, jsonb_build_object('purchase_ref', t, 'purchase_ref_title', num));
    perform public._wf_event(i.id, p_run, p_actor, 'purchase_created', st->>'id', null, 'Approved', jsonb_build_object('purchase', t, 'number', num, 'amount', public._num(r.data->'selected_amount'), 'currency', coalesce(r.data->>'selected_currency', r.data->>'currency')));
    return 'purchase ' || num;
  else
    raise exception 'Automatic action % is not allowed', st->>'action';
  end case;
end $$;
revoke execute on function public._wf_auto_exec(uuid, jsonb, uuid, uuid) from public, anon, authenticated;

create or replace function public._wf_automate(p_run uuid, st jsonb, i public.wf_instances, r public.records, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q uuid; res text; err text; ok boolean := false;
begin
  select id into q from public.automation_queue where dedupe_key = 'wf:' || p_run and agent = 'workflow' limit 1;
  if q is null then
    insert into public.automation_queue(agent, title, detail, record_id, section, action, controlled, dedupe_key, status, attempts, claimed_at, exec_id, max_attempts)
    values ('workflow', left('Process ' || i.def_code || ': ' || (st->>'name'), 300), st->>'action', r.id, r.section,
      jsonb_build_object('type', 'workflow', 'run', p_run, 'step', st->>'id', 'action', st->>'action'), r.controlled, 'wf:' || p_run, 'processing', 1, now(), gen_random_uuid(), 5)
    returning id into q;
  else
    update public.automation_queue set status = 'processing', attempts = attempts + 1, claimed_at = now(), updated_at = now() where id = q;
  end if;
  begin
    res := public._wf_auto_exec(p_run, st, i.id, p_actor); ok := true;
  exception when others then err := sqlerrm;
  end;
  if ok then
    update public.automation_queue set status = 'completed', result = left(res, 1000), last_error = null, finished_at = now(), next_attempt_at = null, updated_at = now() where id = q;
    perform public._wf_event(i.id, p_run, p_actor, 'automation_done', st->>'id', null, 'completed', jsonb_build_object('action', st->>'action', 'result', left(res, 300), 'queue', q));
    perform public._wf_finish(p_run, p_actor, 'success', res);
  else
    update public.automation_queue set
      status = case when attempts >= max_attempts then 'dead' else 'retrying' end,
      next_attempt_at = case when attempts >= max_attempts then null else now() + least(interval '6 hours', make_interval(secs => 60 * power(4, greatest(attempts - 1, 0)))) end,
      finished_at = case when attempts >= max_attempts then now() end,
      last_error = left(err, 1000), updated_at = now() where id = q;
    perform public._wf_event(i.id, p_run, p_actor, 'automation_failed', st->>'id', null, 'retrying', jsonb_build_object('action', st->>'action', 'error', left(err, 300), 'queue', q));
    perform public._wf_block(i.id, p_run, 'Automatic step «' || (st->>'name') || '» failed: ' || left(err, 300) || ' — it will be tried again', p_actor);
  end if;
end $$;
revoke execute on function public._wf_automate(uuid, jsonb, public.wf_instances, public.records, uuid) from public, anon, authenticated;

-- a queued retry (the Phase 1 scheduler, or the hourly workflow job): runs the action again for the same step run
create or replace function public.wf_automation_execute(p_queue uuid) returns text
language plpgsql security definer set search_path = public as $$
declare q public.automation_queue; s public.wf_step_runs; i public.wf_instances; r public.records; st jsonb;
begin
  select * into q from public.automation_queue where id = p_queue and agent = 'workflow';
  if not found then raise exception 'Not a process action'; end if;
  select * into s from public.wf_step_runs where id = public.as_uuid(q.action->>'run');
  select * into i from public.wf_instances where id = s.instance_id for update;
  if s.status <> 'open' or i.current_run is distinct from s.id then return 'skipped: the step is no longer open'; end if;
  select * into r from public.records where id = i.record_id;
  st := public._wf_step(i.definition_id, s.step_id);
  perform public._wf_automate(s.id, st, i, r, null);
  select * into s from public.wf_step_runs where id = s.id;
  if s.status = 'open' then raise exception '%', coalesce(s.blocked_reason, 'failed'); end if;
  return 'done';
end $$;
revoke execute on function public.wf_automation_execute(uuid) from public, anon, authenticated;
grant execute on function public.wf_automation_execute(uuid) to service_role;

create or replace function public.wf_retry_due(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.automation_queue; done int := 0; failed int := 0; dead int := 0; s public.wf_step_runs; i public.wf_instances; r public.records; st jsonb; qs text;
begin
  if auth.uid() is not null then raise exception 'Not allowed' using errcode = '42501'; end if;
  for q in select * from public.automation_queue where agent = 'workflow' and status = 'retrying' and next_attempt_at <= now() order by created_at limit p_limit for update skip locked loop
    select * into s from public.wf_step_runs where id = public.as_uuid(q.action->>'run');
    select * into i from public.wf_instances where id = s.instance_id for update;
    if s.status <> 'open' or i.current_run is distinct from s.id then
      update public.automation_queue set status = 'completed', result = 'skipped: the step is no longer open', finished_at = now(), updated_at = now() where id = q.id; continue;
    end if;
    select * into r from public.records where id = i.record_id;
    st := public._wf_step(i.definition_id, s.step_id);
    perform public._wf_automate(s.id, st, i, r, null);
    select status into qs from public.automation_queue where id = q.id;
    if qs = 'completed' then done := done + 1; elsif qs = 'dead' then dead := dead + 1;
      perform public._wf_block(i.id, s.id, 'Automatic step «' || s.step_name || '» gave up after ' || q.max_attempts || ' attempts — an administrator can retry it', null);
    else failed := failed + 1; end if;
  end loop;
  return jsonb_build_object('completed', done, 'retrying', failed, 'dead', dead);
end $$;
revoke execute on function public.wf_retry_due(integer) from public, anon, authenticated;
grant execute on function public.wf_retry_due(integer) to service_role;

/* ---------------------------------------------------------------------------------------------
   13. Acting on a step: the responsible person (or a member of the responsible role) only
   --------------------------------------------------------------------------------------------- */
create or replace function public._wf_can_act(p_actor uuid, s public.wf_step_runs, r public.records) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_employee(p_actor) and public.record_visible_for(p_actor, r)
    and (s.assignee = p_actor or (s.assignee is null and s.assignee_role is not null and exists (select 1 from public.profiles p where p.id = p_actor and p.role = s.assignee_role)))
$$;
revoke execute on function public._wf_can_act(uuid, public.wf_step_runs, public.records) from public, anon, authenticated;

create or replace function public._wf_missing(st jsonb, r public.records) returns text language sql stable security definer set search_path = public as $$
  select string_agg(f, ', ') from jsonb_array_elements_text(coalesce(st->'fields', '[]')) f
  where coalesce(r.data->>f, '') = '' or r.data->f = '[]'::jsonb
$$;
revoke execute on function public._wf_missing(jsonb, public.records) from public, anon, authenticated;

create or replace function public.wf_act(p_run uuid, p_outcome text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); s public.wf_step_runs; i public.wf_instances; r public.records; st jsonb; ctx jsonb; t uuid; outcome text; miss text; doc jsonb; q public.automation_queue;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into s from public.wf_step_runs where id = p_run;
  if not found then raise exception 'Step not found' using errcode = 'P0002'; end if;
  select * into i from public.wf_instances where id = s.instance_id for update;
  select * into s from public.wf_step_runs where id = p_run;
  select * into r from public.records where id = i.record_id;
  if not public.record_visible_for(me, r) then raise exception 'Step not found' using errcode = 'P0002'; end if;
  if s.status <> 'open' or i.current_run is distinct from s.id then raise exception 'This step is already done' using errcode = '55000'; end if;
  st := public._wf_step(i.definition_id, s.step_id);
  -- retries of a step nobody owns (an automatic action, an approval chain that could not start, a cancelled task)
  if p_outcome = 'retry' then
    if not (public._ops_admin(me) or i.owner = me or public._wf_can_act(me, s, r)) then raise exception 'Only the process owner or management can retry this step' using errcode = '42501'; end if;
    perform public._wf_event(i.id, s.id, me, 'retried', s.step_id, 'blocked', 'open', jsonb_build_object('note', left(p_note, 300)));
    if s.step_type = 'AUTOMATION' then
      update public.automation_queue set attempts = 0, status = 'retrying' where dedupe_key = 'wf:' || s.id and agent = 'workflow';
      perform public._wf_automate(s.id, st, i, r, me);
    else perform public._wf_enter(i.id, s.step_id, me, 'retry');
    end if;
    return jsonb_build_object('ok', true);
  end if;
  if not public._wf_can_act(me, s, r) then raise exception 'This step is assigned to someone else' using errcode = '42501'; end if;
  if s.step_type in ('REVIEW', 'DECISION') and me = i.requester and not coalesce((st->>'allow_requester')::boolean, false) then
    raise exception 'You cannot review your own request' using errcode = '42501';
  end if;
  outcome := case
    when s.step_type in ('TASK', 'WAIT') and p_outcome in ('done', 'received', 'success') then 'success'
    when s.step_type = 'REVIEW' and p_outcome in ('approved', 'success') then 'success'
    when s.step_type = 'REVIEW' and p_outcome in ('changes_requested', 'rejected') then p_outcome
    when s.step_type in ('DATA', 'DOCUMENT') and p_outcome in ('submit', 'success') then 'success'
    when s.step_type = 'DATA' and p_outcome = 'accept_partial' and coalesce((st->>'receives')::boolean, false) then 'success'
    when s.step_type in ('DATA', 'DOCUMENT') and p_outcome = 'rejected' and st->'on' ? 'rejected' then 'rejected'
    when s.step_type = 'DECISION' and exists (select 1 from jsonb_array_elements(st->'options') o where o->>'key' = p_outcome) then p_outcome
    when s.step_type = 'CHECK' and p_outcome = 'recheck' then 'recheck'
    when p_outcome = 'cancelled' and st->'on' ? 'cancelled' then 'cancelled'
  end;
  if outcome is null then raise exception 'This step cannot be completed with «%»', p_outcome using errcode = '22023'; end if;
  if outcome in ('changes_requested', 'rejected', 'cancelled') and coalesce(trim(p_note), '') = '' then raise exception 'Say why' using errcode = '22023'; end if;
  if p_outcome = 'accept_partial' and coalesce(trim(p_note), '') = '' then raise exception 'Say why a partial delivery is accepted' using errcode = '22023'; end if;
  if outcome = 'success' or s.step_type = 'DECISION' then
    if s.step_type = 'DATA' then
      miss := public._wf_missing(st, r);
      if miss is not null then raise exception 'Fill in first: %', miss using errcode = '23514'; end if;
      if coalesce((st->>'selects_quote')::boolean, false) and coalesce(r.data->>'selected_quote_ref', '') = '' then raise exception 'Select a quotation first (with the reason)' using errcode = '23514'; end if;
      if coalesce((st->>'records_payment')::boolean, false) and coalesce(r.data->>'paid_on', '') = '' then raise exception 'Record the payment first (date, amount, reference)' using errcode = '23514'; end if;
      if coalesce((st->>'confirms_impact')::boolean, false) and coalesce(r.data->>'impact_confirmed_at', '') = '' then raise exception 'Confirm the impact record first' using errcode = '23514'; end if;
      if coalesce((st->>'receives')::boolean, false) and p_outcome <> 'accept_partial' and not coalesce((public._wf_facts(i.id, r)->>'received_all')::boolean, false) then
        raise exception 'Not everything has been received yet — record receiving, or accept the partial delivery with a reason' using errcode = '23514';
      end if;
    elsif s.step_type = 'DOCUMENT' then
      for doc in select * from jsonb_array_elements(st->'documents') loop
        if doc->>'kind' = 'quotations' and coalesce((public._wf_facts(i.id, r)->>'quotations')::int, 0) < public._num(doc->'min') then
          raise exception 'At least % quotation(s) are required', doc->>'min' using errcode = '23514';
        elsif doc->>'kind' = 'document' and not exists (select 1 from public.records x where x.id = public.as_uuid(r.data->>(doc->>'field')) and x.section = 'company.documents'
              and (not doc ? 'doc_type' or x.data->>'doc_type' = doc->>'doc_type')) then
          raise exception 'Link the document first (%)', coalesce(doc->>'doc_type', doc->>'field') using errcode = '23514';
        end if;
      end loop;
    end if;
    if st ? 'guard' then
      ctx := public._wf_ctx(i.id, r, me);
      if not public.wf_rule(st->'guard', ctx) then raise exception '%', coalesce(st->>'guard_message', 'The conditions of this step are not met') using errcode = '23514'; end if;
    end if;
  end if;
  if outcome = 'recheck' then
    ctx := public._wf_ctx(i.id, r, me);
    if not public.wf_rule(st->'rule', ctx) then raise exception '%', coalesce(st->>'guard_message', 'The check is still not met') using errcode = '23514'; end if;
    outcome := 'success';
  end if;
  if s.step_type in ('TASK', 'WAIT') and outcome = 'success' then
    -- the task stays the one source of truth: completing the step completes its task (the task trigger moves on)
    select l.record_id into t from public.wf_links l where l.run_id = s.id and l.kind = 'task';
    if t is not null and exists (select 1 from public.records x where x.id = t and x.status not in ('Completed', 'Cancelled')) then
      perform public._wf_rec_patch(t, 'Completed', null);
      select * into s from public.wf_step_runs where id = s.id;
      if s.status = 'open' then perform public._wf_finish(s.id, me, 'success', p_note); end if;
      return jsonb_build_object('ok', true);
    end if;
  end if;
  perform public._wf_finish(s.id, me, outcome, p_note);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.wf_act(uuid, text, text) from public, anon;
grant execute on function public.wf_act(uuid, text, text) to authenticated;

create or replace function public.wf_reassign(p_run uuid, p_user uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); s public.wf_step_runs; i public.wf_instances; r public.records; t uuid;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into s from public.wf_step_runs where id = p_run;
  if not found then raise exception 'Step not found' using errcode = 'P0002'; end if;
  select * into i from public.wf_instances where id = s.instance_id for update;
  select * into s from public.wf_step_runs where id = p_run;
  select * into r from public.records where id = i.record_id;
  if s.status <> 'open' then raise exception 'This step is already done' using errcode = '55000'; end if;
  if not (public._ops_admin(me) or i.owner = me or s.assignee = me) or not public.record_visible_for(me, r) then raise exception 'Only the person responsible, the process owner or management can hand a step over' using errcode = '42501'; end if;
  if s.step_type in ('APPROVAL', 'AUTOMATION', 'CHECK') then raise exception 'This step has no person to hand over' using errcode = '22023'; end if;
  if not public.is_active_employee(p_user) or not public._wf_could_see(p_user, r) then raise exception 'That person cannot open this record' using errcode = '42501'; end if;
  if p_user = i.requester and s.step_type in ('REVIEW', 'DECISION') then raise exception 'The requester cannot review their own request' using errcode = '42501'; end if;
  update public.wf_step_runs set assignee = p_user, assignee_role = null, blocked_reason = null where id = s.id;
  select l.record_id into t from public.wf_links l where l.run_id = s.id and l.kind = 'task';
  if t is not null then perform public._wf_rec_patch(t, null, jsonb_build_object('assignee_id', p_user, 'assignee', public._wf_name(p_user))); end if;
  if i.status = 'blocked' then update public.wf_instances set status = case when s.paused then 'waiting' else 'active' end, blocker = null, updated_at = now() where id = i.id; end if;
  if s.step_type in ('TASK', 'WAIT') and t is null then perform public._wf_task(s.id, public._wf_step(i.definition_id, s.step_id), i, r, me); end if;
  perform public._wf_event(i.id, s.id, me, 'reassigned', s.step_id, coalesce(s.assignee::text, s.assignee_role), p_user::text, jsonb_build_object('note', left(p_note, 300)));
  perform public._wf_notify(p_user, null, 'wf_action', r, 'wf:' || s.id || ':' || p_user, 'Action needed: ' || s.step_name || ' — ' || coalesce(r.data->>'number', r.title), public.wf_todo(s.step_type, s.step_name), me, '/ops?i=' || i.id);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.wf_reassign(uuid, uuid, text) from public, anon;
grant execute on function public.wf_reassign(uuid, uuid, text) to authenticated;

create or replace function public.wf_cancel(p_inst uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); i public.wf_instances; r public.records;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into i from public.wf_instances where id = p_inst for update;
  if not found then raise exception 'Process not found' using errcode = 'P0002'; end if;
  select * into r from public.records where id = i.record_id;
  if not public.record_visible_for(me, r) then raise exception 'Process not found' using errcode = 'P0002'; end if;
  if i.status not in ('active', 'waiting', 'blocked', 'draft') then raise exception 'This process is already closed' using errcode = '55000'; end if;
  if not (me = i.requester or i.owner = me or public._ops_admin(me)) then raise exception 'Only the requester, the process owner or management can cancel' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why' using errcode = '22023'; end if;
  perform public._wf_close(i.id, 'cancelled', me, p_note);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.wf_cancel(uuid, text) from public, anon;
grant execute on function public.wf_cancel(uuid, text) to authenticated;

-- running processes stay on their version; an administrator may move one explicitly (same step must exist)
create or replace function public.wf_migrate(p_inst uuid, p_definition uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); i public.wf_instances; d public.wf_definitions; rl text;
begin
  select role into rl from public.profiles where id = me;
  if me is null or rl not in ('owner', 'admin') then raise exception 'Only owners and administrators move a running process to another version' using errcode = '42501'; end if;
  select * into i from public.wf_instances where id = p_inst for update;
  select * into d from public.wf_definitions where id = p_definition;
  if not found or d.code <> i.def_code or d.state not in ('published', 'retired') then raise exception 'Choose a published version of the same process' using errcode = '22023'; end if;
  if i.current_step is not null and public._wf_step(d.id, i.current_step) is null then raise exception 'Version % has no step %: it cannot take over this process', d.version, i.current_step using errcode = '22023'; end if;
  update public.wf_instances set definition_id = d.id, def_version = d.version, updated_at = now(), version = version + 1 where id = i.id;
  perform public._wf_event(i.id, i.current_run, me, 'migrated', i.current_step, i.def_version::text, d.version::text, jsonb_build_object('note', left(p_note, 300)));
  return jsonb_build_object('ok', true, 'version', d.version);
end $$;
revoke execute on function public.wf_migrate(uuid, uuid, text) from public, anon;
grant execute on function public.wf_migrate(uuid, uuid, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   14. Record triggers: tasks move their step on, material changes make approvals stale, the user-facing guard
   --------------------------------------------------------------------------------------------- */
create or replace function public._wf_task_closed(t public.records) returns void language plpgsql security definer set search_path = public as $$
declare s public.wf_step_runs; i public.wf_instances; r public.records; st jsonb;
begin
  select x.* into s from public.wf_links l join public.wf_step_runs x on x.id = l.run_id where l.record_id = t.id and l.kind in ('task', 'task_auto') and x.status = 'open' limit 1;
  if not found then return; end if;
  select * into i from public.wf_instances where id = s.instance_id for update;
  if i.current_run is distinct from s.id then return; end if;
  select * into r from public.records where id = i.record_id;
  st := public._wf_step(i.definition_id, s.step_id);
  if t.status = 'Completed' then
    if st ? 'guard' and not public.wf_rule(st->'guard', public._wf_ctx(i.id, r, auth.uid())) then
      raise exception '%', coalesce(st->>'guard_message', 'The conditions of this process step are not met yet') using errcode = '23514';
    end if;
    if s.step_type in ('TASK', 'WAIT') then perform public._wf_finish(s.id, auth.uid(), 'success', 'Task completed'); end if;
  elsif st->'on' ? 'cancelled' then perform public._wf_finish(s.id, auth.uid(), 'cancelled', 'The task was cancelled');
  else perform public._wf_block(i.id, s.id, 'The task «' || t.title || '» was cancelled — retry the step or hand it over', auth.uid());
  end if;
end $$;
revoke execute on function public._wf_task_closed(public.records) from public, anon, authenticated;

-- the task of a role step can be completed by any member of that role (v19 rule otherwise unchanged)
create or replace function public._wf_task_actor(p_uid uuid, p_run uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.wf_step_runs s join public.wf_instances i on i.id = s.instance_id join public.records r on r.id = i.record_id
                 where s.id = p_run and s.status = 'open' and public._wf_can_act(p_uid, s, r))
$$;
revoke execute on function public._wf_task_actor(uuid, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); my_role text; d jsonb; od jsonb; pm text; m text;
begin
  if tg_op = 'DELETE' then d := old.data; else d := coalesce(new.data, '{}'::jsonb); end if;
  od := case when tg_op = 'INSERT' then '{}'::jsonb else coalesce(old.data, '{}'::jsonb) end;
  if me is not null then select role into my_role from public.profiles where id = me; end if;
  -- the author is whoever signed in, never what the client sends; it does not change later
  if me is not null and tg_op = 'INSERT' then new.created_by := me; end if;
  if me is not null and tg_op = 'UPDATE' then new.created_by := old.created_by; end if;

  if coalesce(new.section, old.section) = 'company.tasks' then
    -- who may change or delete a task: the person who created it, the person it is assigned to,
    -- the manager of its project, management, owners and administrators
    if me is not null and tg_op in ('UPDATE', 'DELETE') and coalesce(my_role, '') not in ('owner', 'admin', 'management')
       and old.created_by is distinct from me and coalesce(od->>'assignee_id', '') <> me::text
       -- v23: the task of a process step may also be done by whoever may act on that step (a member of its role)
       and not (od ? 'wf_run' and (public._wf_engine() or public._wf_task_actor(me, public.as_uuid(od->>'wf_run')))) then
      select r.data->>'manager_id' into pm from public.records r where r.id::text = od->>'project_ref';
      if coalesce(pm, '') <> me::text then
        raise exception 'Only the author, the person responsible, the project manager or management can change this task' using errcode = '42501';
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    -- a task goes only to an active employee (an old assignment stays as it was when the person leaves)
    if d->>'assignee_id' is not null and d->>'assignee_id' <> '' and d->>'assignee_id' is distinct from od->>'assignee_id'
       and not public.is_active_employee((d->>'assignee_id')::uuid) then
      raise exception 'A task can be assigned only to an active employee' using errcode = '23514';
    end if;
    -- completion date is set and cleared by the status
    if new.status = 'Completed' and (tg_op = 'INSERT' or old.status is distinct from 'Completed') then
      new.data := d || jsonb_build_object('completed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD'));
    elsif new.status is distinct from 'Completed' and d ? 'completed_at' then
      new.data := d - 'completed_at';
    end if;
  elsif coalesce(new.section, old.section) = 'company.projects' then
    if tg_op = 'DELETE' then return old; end if;
    if d->>'manager_id' is not null and d->>'manager_id' <> '' and d->>'manager_id' is distinct from od->>'manager_id'
       and not public.is_active_employee((d->>'manager_id')::uuid) then
      raise exception 'The project manager must be an active employee' using errcode = '23514';
    end if;
    if jsonb_typeof(d->'members_ids') = 'array' and d->'members_ids' is distinct from od->'members_ids' then
      for m in select jsonb_array_elements_text(d->'members_ids') loop
        if not (coalesce(od->'members_ids', '[]'::jsonb) ? m) and not public.is_active_employee(m::uuid) then
          raise exception 'Project members must be active employees' using errcode = '23514';
        end if;
      end loop;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$;

create or replace function public.ops_sections() returns text[] language sql immutable set search_path = public as $$
  select array['operations.requests', 'operations.quotations', 'operations.procurement', 'operations.receipts', 'operations.vendors', 'finance.payments', 'finance.budget',
    'legal.contracts', 'legal.contract_obligations', 'technical.changes', 'company.issues', 'company.travel', 'company.requests', 'company.parties', 'marketing.events']
$$;

-- before a write: links to a US-persons-only record make the new record US-persons-only too; secrets are refused
create or replace function public.records_ops_before() returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not (new.section = any(public.ops_sections()) or new.section = 'company.tasks') then return new; end if;
  if tg_op = 'UPDATE' and new.data is not distinct from old.data and new.controlled is not distinct from old.controlled then return new; end if;
  if not coalesce(new.controlled, false) then
    foreach k in array array['project_ref', 'request_ref', 'purchase_ref', 'contract_ref', 'source_ref', 'wf_record', 'payment_ref', 'issue_ref'] loop
      if coalesce(new.data->>k, '') <> '' and exists (select 1 from public.records x where x.id = public.as_uuid(new.data->>k) and x.controlled) then
        new.controlled := true; exit;
      end if;
    end loop;
  end if;
  if new.section <> 'company.tasks' then perform public.ops_secret_check(new.data); end if;
  return new;
end $$;
drop trigger if exists records_ops_before on public.records;
create trigger records_ops_before before insert or update on public.records for each row execute function public.records_ops_before();

-- what a signed-in person may not change by editing a record directly (the process steps change it)
create or replace function public.ops_guard(p_op text, o public.records, n public.records) returns void language plpgsql stable security definer set search_path = public as $$
declare k text; nm text; stp text;
  protected text[] := array['number', 'paid_on', 'paid_amount', 'payment_reference', 'paid_recorded_by_id', 'selected_quote_ref', 'selected_amount', 'selected_currency', 'selection_reason',
    'selection_alternatives', 'selection_date', 'selected_by_id', 'impact_confirmed_at', 'impact_confirmed_by_id', 'qty_received', 'purchase_ref', 'wf_instance', 'requester_id', 'extracted', 'confirmed_by_id', 'approved_amount', 'approved_currency', 'approved_at'];
begin
  if not (n.section = any(public.ops_sections())) then return; end if;
  if p_op = 'INSERT' then
    foreach k in array protected loop
      if n.data ? k and k <> 'requester_id' then raise exception 'The field % is set by Workspace, not entered by hand', k using errcode = '42501'; end if;
    end loop;
    if coalesce(n.data->>'requester_id', auth.uid()::text) <> auth.uid()::text then raise exception 'A request is raised in your own name' using errcode = '42501'; end if;
    if n.section = 'finance.payments' and coalesce(n.status, 'Requested') not in ('Draft', 'Requested') then raise exception 'A payment request starts as Requested; it is marked paid only when Finance records the payment' using errcode = '42501'; end if;
    if n.section = 'operations.procurement' and n.data ? 'request_ref' then raise exception 'Purchase records for a purchase request are created by the purchase process after approval' using errcode = '42501'; end if;
    if n.section = 'operations.receipts' then raise exception 'Use «Receive goods» on the purchase record to record receiving' using errcode = '42501'; end if;
    return;
  end if;
  foreach k in array protected loop
    if (o.data->k) is distinct from (n.data->k) and (o.data ? k or k <> 'requester_id') then raise exception 'The field % is set by the process, not edited by hand', k using errcode = '42501'; end if;
  end loop;
  if n.status is distinct from o.status then
    select d.name, i.current_step into nm, stp from public.wf_instances i join public.wf_definitions d on d.id = i.definition_id
     where i.record_id = n.id and i.status in ('active', 'waiting', 'blocked', 'draft') limit 1;
    if nm is not null then raise exception 'This record follows the process «%» (step: %): change it with the process actions', nm, coalesce(stp, '—') using errcode = '42501'; end if;
    if n.section = 'finance.payments' and n.status in ('Paid', 'Partially paid', 'Reconciled') then raise exception 'A payment is marked paid only when Finance records it' using errcode = '42501'; end if;
    if n.section = 'operations.procurement' and o.data ? 'request_ref' and n.status in ('Partially delivered', 'Delivered', 'Received') then raise exception 'Record deliveries with «Receive goods»' using errcode = '42501'; end if;
  end if;
end $$;
revoke execute on function public.ops_guard(text, public.records, public.records) from public, anon;
grant execute on function public.ops_guard(text, public.records, public.records) to authenticated;

-- invoker on purpose: inside the engine (definer) the current user is the owner and the guard does not apply
create or replace function public.records_ops_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then perform public.ops_guard(tg_op, case when tg_op = 'UPDATE' then old end, new); end if;
  return new;
end $$;
drop trigger if exists records_ops_guard on public.records;
create trigger records_ops_guard before insert or update on public.records for each row execute function public.records_ops_guard();

create or replace function public.records_ops_after() returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.section = 'company.tasks' then
    if new.status is distinct from old.status and new.status in ('Completed', 'Cancelled') and new.data ? 'wf_run' then perform public._wf_task_closed(new); end if;
    return null;
  end if;
  if new.data is not distinct from old.data then return null; end if;
  -- the vendor revised the selected quotation: the request follows, so its approval becomes stale
  if new.section = 'operations.quotations' then
    if (public._num(new.data->'amount') is distinct from public._num(old.data->'amount') or (new.data->>'currency') is distinct from (old.data->>'currency')) then
      for c in select x.id from public.records x where x.section = 'operations.requests' and x.id = public.as_uuid(new.data->>'request_ref') and x.data->>'selected_quote_ref' = new.id::text loop
        perform public._wf_rec_patch(c.id, null, jsonb_build_object('selected_amount', public._num(new.data->'amount'), 'selected_currency', new.data->>'currency'));
        insert into public.wf_events(instance_id, record_id, section, actor, kind, from_state, to_state, detail)
        select i.id, c.id, 'operations.requests', auth.uid(), 'quote_revised', old.data->>'amount', new.data->>'amount', jsonb_build_object('quote', new.id, 'currency', new.data->>'currency')
        from public.wf_instances i where i.record_id = c.id and i.status in ('active', 'waiting', 'blocked');
      end loop;
    end if;
    return null;
  end if;
  if public.ops_cfg()->'material' ? new.section and exists (select 1 from public.wf_instances i where i.record_id = new.id and i.status in ('active', 'waiting', 'blocked'))
     and public._wf_basis(old) is distinct from public._wf_basis(new) then
    perform public._wf_invalidate(new.id, 'Changed: ' || coalesce((select string_agg(k, ', ') from jsonb_array_elements_text(public.ops_cfg()->'material'->new.section) k where (old.data->k) is distinct from (new.data->k)), 'linked document'), auth.uid());
  end if;
  if new.section = 'company.documents' and (new.data->>'current_version_id') is distinct from (old.data->>'current_version_id') then
    for c in select x.id from public.records x where x.section = 'legal.contracts' and x.data->>'document_ref' = new.id::text
               and exists (select 1 from public.wf_instances i where i.record_id = x.id and i.status in ('active', 'waiting', 'blocked')) loop
      perform public._wf_invalidate(c.id, 'A new version of the contract document was uploaded', auth.uid());
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists records_ops_after on public.records;
create trigger records_ops_after after update on public.records for each row
  when (new.section in ('company.tasks', 'company.documents', 'operations.requests', 'operations.quotations', 'finance.payments', 'legal.contracts', 'technical.changes', 'company.travel', 'company.requests'))
  execute function public.records_ops_after();

/* ---------------------------------------------------------------------------------------------
   15. Request Center, vendor selection, receiving, payments, engineering impact, extraction proposals
   --------------------------------------------------------------------------------------------- */
create or replace function public._ops_clean(p jsonb) returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(p, '{}'::jsonb)) x(k, v)
  where k ~ '^[a-z][a-z0-9_]{0,40}$' and not (k = any(array['number', 'paid_on', 'paid_amount', 'payment_reference', 'paid_recorded_by_id', 'selected_quote_ref', 'selected_amount',
    'selected_currency', 'selection_reason', 'selection_alternatives', 'selection_date', 'selected_by_id', 'impact_confirmed_at', 'impact_confirmed_by_id', 'qty_received', 'purchase_ref',
    'wf_instance', 'wf_run', 'wf_record', 'requester_id', 'requester', 'extracted', 'confirmed_by_id', 'approved_amount', 'approved_currency', 'approved_at']))
$$;

create or replace function public.ops_request_types() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); rl text;
begin
  if me is null then return '[]'::jsonb; end if;
  select role into rl from public.profiles where id = me;
  return coalesce((select jsonb_agg(t || jsonb_build_object('available', d.id is not null, 'definition_name', d.name, 'definition_version', d.version))
    from jsonb_array_elements(public.ops_cfg()->'request_types') t
    left join public.wf_definitions d on d.code = t->>'definition' and d.state = 'published'
    where rl in ('owner', 'admin')
       or (jsonb_array_length(coalesce(t->'roles', '[]')) = 0 and exists (select 1 from public.section_access a where a.role = rl and a.section = t->>'section' and a.can_write))
       or (coalesce(t->'roles', '[]') ? rl and exists (select 1 from public.section_access a where a.role = rl and a.section = t->>'section'))), '[]'::jsonb);
end $$;
revoke execute on function public.ops_request_types() from public, anon;
grant execute on function public.ops_request_types() to authenticated;

create or replace function public.ops_request_create(p_type text, p_title text, p_data jsonb, p_priority text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); t jsonb; d jsonb; k text; v text; ref public.records; r public.records; inst uuid; def public.wf_definitions;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select x into t from jsonb_array_elements(public.ops_request_types()) x where x->>'key' = p_type;
  if t is null then raise exception 'You cannot raise this kind of request' using errcode = '42501'; end if;
  select * into def from public.wf_definitions where code = t->>'definition' and state = 'published';
  if not found then raise exception 'This kind of request is switched off' using errcode = '55000'; end if;
  if coalesce(trim(p_title), '') = '' or length(p_title) > 300 then raise exception 'Give the request a short title' using errcode = '22023'; end if;
  if length(coalesce(p_data, '{}')::text) > 20000 then raise exception 'The request is too long' using errcode = '22023'; end if;
  d := public._ops_clean(p_data);
  -- every linked record must be one the requester can open (its title is stored next to it, as the forms do)
  for k, v in select x.key, x.value #>> '{}' from jsonb_each(d) x where x.key like '%\_ref' escape '\' loop
    if coalesce(v, '') = '' then continue; end if;
    select * into ref from public.records where id = public.as_uuid(v);
    if not found or not public.record_visible_for(me, ref) then raise exception 'Linked record not found (%)', k using errcode = '42501'; end if;
    d := d || jsonb_build_object(k || '_title', coalesce(ref.data->>'number', ref.title));
  end loop;
  d := d || jsonb_build_object('requester_id', me, 'requester', public._wf_name(me), 'priority', coalesce(p_priority, d->>'priority', 'Normal'));
  insert into public.records(section, title, status, data, created_by)
  values (t->>'section', trim(p_title), coalesce(nullif(def.steps->0->>'record_status', ''), 'Requested'), d, me)
  returning * into r;
  if not public.record_visible_for(me, r) then raise exception 'You cannot link this request to a US-persons-only record' using errcode = '42501'; end if;
  inst := public._wf_start(me, def.code, r.id, p_priority);
  select * into r from public.records where id = r.id;
  return jsonb_build_object('record', r.id, 'instance', inst, 'number', r.data->>'number', 'section', r.section);
end $$;
revoke execute on function public.ops_request_create(text, text, jsonb, text) from public, anon;
grant execute on function public.ops_request_create(text, text, jsonb, text) to authenticated;

-- Quotations side by side. Workspace never says which one is "best": it lists the facts, people decide and say why.
create or replace function public.ops_compare_quotes(p_request uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); r public.records; rows jsonb;
begin
  select * into r from public.records where id = p_request and section = 'operations.requests';
  if me is null or not found or not public.record_visible_for(me, r) then raise exception 'Request not found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'status', q.status, 'vendor_ref', q.data->>'vendor_ref', 'vendor', coalesce(v.title, q.data->>'vendor_ref_title', q.data->>'vendor'),
      'vendor_status', v.status, 'amount', public._num(q.data->'amount'), 'currency', q.data->>'currency', 'lead_time_days', public._num(q.data->'lead_time_days'),
      'delivery_date', q.data->>'delivery_date', 'valid_until', q.data->>'valid_until', 'expired', coalesce(q.data->>'valid_until', '9999') < to_char(current_date, 'YYYY-MM-DD'),
      'terms', q.data->>'payment_terms', 'incoterms', q.data->>'incoterms', 'notes', q.data->>'notes', 'selected', q.id::text = r.data->>'selected_quote_ref',
      'lowest_in_currency', public._num(q.data->'amount') = min(public._num(q.data->'amount')) over (partition by q.data->>'currency'),
      'shortest_lead_time', public._num(q.data->'lead_time_days') = min(public._num(q.data->'lead_time_days')) over ())
    order by q.data->>'currency', public._num(q.data->'amount') nulls last), '[]'::jsonb) into rows
  from public.records q left join public.records v on v.id = public.as_uuid(q.data->>'vendor_ref')
  where q.section = 'operations.quotations' and q.data->>'request_ref' = r.id::text and public.record_visible_for(me, q);
  return jsonb_build_object('request', r.id, 'quotes', rows, 'selected', r.data->>'selected_quote_ref', 'reason', r.data->>'selection_reason',
    'note', 'Lowest price and shortest lead time are facts per currency, not a recommendation. Record why you choose a quotation.');
end $$;
revoke execute on function public.ops_compare_quotes(uuid) from public, anon;
grant execute on function public.ops_compare_quotes(uuid) to authenticated;

create or replace function public.ops_select_quote(p_request uuid, p_quote uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); r public.records; q public.records; v public.records; i public.wf_instances; s public.wf_step_runs; st jsonb; alt jsonb;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into i from public.wf_instances where record_id = p_request and status in ('active', 'waiting', 'blocked') for update;
  select * into r from public.records where id = p_request and section = 'operations.requests' for update;
  if not found or not public.record_visible_for(me, r) then raise exception 'Request not found' using errcode = 'P0002'; end if;
  select * into q from public.records where id = p_quote and section = 'operations.quotations' and data->>'request_ref' = r.id::text;
  if not found or not public.record_visible_for(me, q) then raise exception 'Quotation not found for this request' using errcode = 'P0002'; end if;
  if i.id is null then raise exception 'This request has no open purchase process' using errcode = '55000'; end if;
  select * into s from public.wf_step_runs where id = i.current_run;
  st := public._wf_step(i.definition_id, s.step_id);
  if s.id is null or not coalesce((st->>'selects_quote')::boolean, false) then raise exception 'The vendor is chosen at the vendor-selection step' using errcode = '55000'; end if;
  if not public._wf_can_act(me, s, r) then raise exception 'The vendor selection is assigned to someone else' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 10 then raise exception 'Say why this quotation is chosen (at least a sentence)' using errcode = '22023'; end if;
  if coalesce(q.data->>'valid_until', '9999') < to_char(current_date, 'YYYY-MM-DD') then raise exception 'This quotation has expired: ask the vendor to confirm it first' using errcode = '23514'; end if;
  select * into v from public.records where id = public.as_uuid(q.data->>'vendor_ref');
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'vendor', coalesce(x.data->>'vendor_ref_title', x.data->>'vendor'), 'amount', public._num(x.data->'amount'), 'currency', x.data->>'currency',
      'lead_time_days', public._num(x.data->'lead_time_days'))), '[]'::jsonb) into alt
  from public.records x where x.section = 'operations.quotations' and x.data->>'request_ref' = r.id::text and x.id <> q.id;
  perform public._wf_rec_patch(r.id, null, jsonb_strip_nulls(jsonb_build_object('selected_quote_ref', q.id, 'selected_quote_ref_title', q.title,
    'selected_amount', public._num(q.data->'amount'), 'selected_currency', q.data->>'currency', 'vendor_ref', q.data->>'vendor_ref', 'vendor_ref_title', coalesce(v.title, q.data->>'vendor_ref_title'),
    'vendor', coalesce(v.title, q.data->>'vendor_ref_title', q.data->>'vendor'), 'selection_reason', left(trim(p_reason), 2000), 'selection_alternatives', alt,
    'selection_date', to_char(current_date, 'YYYY-MM-DD'), 'selected_by_id', me)));
  if st ? 'guard' then
    select * into r from public.records where id = r.id;
    if not public.wf_rule(st->'guard', public._wf_ctx(i.id, r, me)) then raise exception '%', coalesce(st->>'guard_message', 'The conditions of this step are not met') using errcode = '23514'; end if;
  end if;
  perform public._wf_rec_patch(q.id, 'Selected', null);
  update public.records set status = 'Not selected' where section = 'operations.quotations' and data->>'request_ref' = r.id::text and id <> q.id and coalesce(status, '') in ('Received', 'Under review', 'Selected', '');
  perform public._wf_event(i.id, s.id, me, 'vendor_selected', s.step_id, null, 'selected', jsonb_build_object('quote', q.id, 'vendor', q.data->>'vendor_ref', 'amount', public._num(q.data->'amount'),
    'currency', q.data->>'currency', 'reason', left(p_reason, 500), 'alternatives', jsonb_array_length(alt)));
  if s.step_type in ('DATA', 'DECISION') then perform public._wf_finish(s.id, me, case when s.step_type = 'DECISION' then coalesce(st->'options'->0->>'key', 'success') else 'success' end, 'Vendor selected'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.ops_select_quote(uuid, uuid, text) from public, anon;
grant execute on function public.ops_select_quote(uuid, uuid, text) to authenticated;

-- Receiving is an explicit event: what arrived, what was refused, in what condition. A discrepancy opens an issue
-- and a follow-up task with the vendor (never a message to the vendor by itself).
create or replace function public.ops_receive(p_purchase uuid, p_qty numeric, p_rejected numeric default 0, p_condition text default 'Good', p_note text default null, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); rl text; pu public.records; pr public.records; i public.wf_instances; s public.wf_step_runs; st jsonb; rc uuid; iss uuid; tk uuid;
  acc numeric; tot numeric; qty numeric; v_status text; bad boolean; t uuid; inum text; isnum text;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select role into rl from public.profiles where id = me;
  select * into pu from public.records where id = p_purchase and section = 'operations.procurement' for update;
  if not found or not public.record_visible_for(me, pu) then raise exception 'Purchase record not found' using errcode = 'P0002'; end if;
  select * into pr from public.records where id = public.as_uuid(pu.data->>'request_ref');
  if pr.id is not null then select * into i from public.wf_instances where record_id = pr.id and status in ('active', 'waiting', 'blocked') for update; end if;
  if i.id is not null then select * into s from public.wf_step_runs where id = i.current_run; end if;
  if not (rl in ('owner', 'admin', 'management', 'operations', 'procurement') or (s.id is not null and public._wf_can_act(me, s, pr))) then
    raise exception 'Receiving is recorded by Operations or Procurement' using errcode = '42501';
  end if;
  if pu.status in ('Cancelled', 'Closed') then raise exception 'This purchase is %', lower(pu.status) using errcode = '55000'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'How many units arrived?' using errcode = '22023'; end if;
  if coalesce(p_rejected, 0) < 0 or coalesce(p_rejected, 0) > p_qty then raise exception 'Refused units must be between 0 and the number that arrived' using errcode = '22023'; end if;
  if coalesce(p_condition, 'Good') not in ('Good', 'Damaged', 'Wrong item', 'Short', 'Other') then raise exception 'Unknown condition' using errcode = '22023'; end if;
  acc := p_qty - coalesce(p_rejected, 0); qty := public._num(pu.data->'qty');
  tot := coalesce(public._num(pu.data->'qty_received'), 0) + acc;
  v_status := case when qty is not null and tot >= qty then 'Received' when tot > 0 then 'Partially delivered' else coalesce(pu.status, 'Ordered') end;
  bad := coalesce(p_rejected, 0) > 0 or coalesce(p_condition, 'Good') <> 'Good';
  insert into public.records(section, title, status, controlled, created_by, data)
  values ('operations.receipts', left('Receipt — ' || coalesce(pu.data->>'number', pu.title), 300), case when bad then 'Discrepancy' else 'Recorded' end, pu.controlled, me,
    jsonb_strip_nulls(jsonb_build_object('purchase_ref', pu.id, 'purchase_ref_title', coalesce(pu.data->>'number', pu.title), 'request_ref', pu.data->>'request_ref', 'request_ref_title', pu.data->>'request_ref_title',
      'vendor_ref', pu.data->>'vendor_ref', 'vendor_ref_title', pu.data->>'vendor_ref_title', 'project_ref', pu.data->>'project_ref', 'project_ref_title', pu.data->>'project_ref_title',
      'qty_arrived', p_qty, 'qty_rejected', coalesce(p_rejected, 0), 'qty_accepted', acc, 'condition', coalesce(p_condition, 'Good'), 'notes', left(p_note, 2000),
      'received_on', to_char(coalesce(p_date, current_date), 'YYYY-MM-DD'), 'received_by_id', me, 'received_by', public._wf_name(me))))
  returning id into rc;
  perform public._wf_rec_patch(pu.id, v_status, jsonb_build_object('qty_received', tot, 'defects', coalesce(public._num(pu.data->'defects'), 0) + coalesce(p_rejected, 0),
    'last_received', to_char(coalesce(p_date, current_date), 'YYYY-MM-DD')));
  if bad then
    isnum := public.ops_number('company.issues', public.as_uuid(pu.data->>'project_ref'));
    insert into public.records(section, title, status, controlled, created_by, data)
    values ('company.issues', left((case when p_condition = 'Damaged' then 'Damaged delivery' when p_condition = 'Wrong item' then 'Wrong item delivered' when p_condition = 'Short' then 'Short delivery' else 'Delivery discrepancy' end)
        || ' — ' || coalesce(pu.data->>'number', pu.title), 300), 'Open', pu.controlled, me,
      jsonb_strip_nulls(jsonb_build_object('number', isnum, 'type', 'Delivery', 'severity', case when coalesce(p_rejected, 0) > 0 then 'High' else 'Medium' end,
        'source_ref', rc, 'source_ref_title', 'Receipt — ' || coalesce(pu.data->>'number', pu.title), 'purchase_ref', pu.id, 'purchase_ref_title', coalesce(pu.data->>'number', pu.title),
        'request_ref', pu.data->>'request_ref', 'vendor_ref', pu.data->>'vendor_ref', 'vendor_ref_title', pu.data->>'vendor_ref_title', 'party_ref', pu.data->>'party_ref',
        'project_ref', pu.data->>'project_ref', 'project_ref_title', pu.data->>'project_ref_title', 'owner_id', me, 'owner', public._wf_name(me),
        'description', coalesce(p_rejected, 0) || ' of ' || p_qty || ' unit(s) refused; condition: ' || coalesce(p_condition, 'Good') || coalesce('. ' || p_note, ''))))
    returning id into iss;
    insert into public.records(section, title, status, controlled, created_by, data)
    values ('company.tasks', left('Follow up with the vendor: ' || coalesce(pu.data->>'vendor_ref_title', pu.data->>'vendor', 'vendor') || ' — ' || coalesce(pu.data->>'number', pu.title), 300), 'New', pu.controlled, me,
      jsonb_strip_nulls(jsonb_build_object('assignee_id', me, 'assignee', public._wf_name(me), 'due', to_char(current_date + 2, 'YYYY-MM-DD'), 'priority', 'High',
        'project_ref', pu.data->>'project_ref', 'project_ref_title', pu.data->>'project_ref_title', 'related', '/company/issues?r=' || iss,
        'description', 'Agree replacement, credit or return for the refused or damaged goods. Workspace sends nothing to the vendor by itself.', 'issue_ref', iss)))
    returning id into tk;
    begin perform public._wf_start(me, 'ISSUE', iss, 'High'); exception when others then null; end;
  end if;
  insert into public.wf_events(instance_id, run_id, record_id, section, actor, kind, step_id, from_state, to_state, detail)
  values (i.id, s.id, pu.id, pu.section, me, 'received', s.step_id, pu.status, v_status,
    jsonb_strip_nulls(jsonb_build_object('receipt', rc, 'arrived', p_qty, 'accepted', acc, 'refused', coalesce(p_rejected, 0), 'condition', coalesce(p_condition, 'Good'), 'issue', iss, 'task', tk)));
  -- the purchase process moves on: the delivery wait ends with the first arrival, receiving ends when all is accepted
  if i.id is not null and s.id is not null and s.status = 'open' then
    st := public._wf_step(i.definition_id, s.step_id);
    if s.step_type = 'WAIT' then
      select l.record_id into t from public.wf_links l where l.run_id = s.id and l.kind = 'task';
      if t is not null then perform public._wf_rec_patch(t, 'Completed', null); end if;
      select * into s from public.wf_step_runs where id = s.id;
      if s.status = 'open' then perform public._wf_finish(s.id, me, 'success', 'Goods arrived'); end if;
      select * into i from public.wf_instances where id = i.id;
      select * into s from public.wf_step_runs where id = i.current_run;
      st := public._wf_step(i.definition_id, s.step_id);
    end if;
    if s.id is not null and s.status = 'open' and coalesce((st->>'receives')::boolean, false) then
      select * into pr from public.records where id = pr.id;
      if coalesce((public._wf_facts(i.id, pr)->>'received_all')::boolean, false) then perform public._wf_finish(s.id, me, 'success', 'Everything received'); end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'receipt', rc, 'status', v_status, 'issue', iss, 'task', tk);
end $$;
revoke execute on function public.ops_receive(uuid, numeric, numeric, text, text, date) from public, anon;
grant execute on function public.ops_receive(uuid, numeric, numeric, text, text, date) to authenticated;

-- A payment is "paid" only when Finance records it (date, amount, the bank's reference). Workspace moves no money.
create or replace function public.ops_record_payment(p_payment uuid, p_paid_on date, p_amount numeric, p_reference text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); rl text; p public.records; i public.wf_instances; s public.wf_step_runs; st jsonb; tot numeric; amt numeric; v_status text;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select role into rl from public.profiles where id = me;
  if rl not in ('finance', 'owner') then raise exception 'Payments are recorded by Finance' using errcode = '42501'; end if;
  select * into i from public.wf_instances where record_id = p_payment and status in ('active', 'waiting', 'blocked') for update;
  select * into p from public.records where id = p_payment and section = 'finance.payments' for update;
  if not found or not public.record_visible_for(me, p) then raise exception 'Payment request not found' using errcode = 'P0002'; end if;
  if i.id is null then raise exception 'This payment request has no open process' using errcode = '55000'; end if;
  if me = i.requester then raise exception 'The requester cannot record the payment of their own request' using errcode = '42501'; end if;
  if not public._wf_approval_current(i.id, p) then raise exception 'The payment request is not approved for its current values' using errcode = '23514'; end if;
  if exists (select 1 from public.approvals a join public.wf_step_runs x on x.id = a.wf_run where x.instance_id = i.id and a.status = 'approved' and a.approver_id = me) then
    raise exception 'The person who approved a payment does not also record it (separation of duties)' using errcode = '42501';
  end if;
  if p_paid_on is null or p_paid_on > current_date then raise exception 'Give the date the bank paid (not in the future)' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Give the amount paid' using errcode = '22023'; end if;
  if coalesce(trim(p_reference), '') = '' or length(p_reference) > 120 then raise exception 'Give the bank or finance-system reference (up to 120 characters)' using errcode = '22023'; end if;
  perform public.ops_secret_check(jsonb_build_object('payment_reference', p_reference, 'note', p_note));
  amt := public._num(p.data->'amount');
  tot := coalesce(public._num(p.data->'paid_amount'), 0) + p_amount;
  if amt is not null and tot > amt then raise exception 'That is more than the approved amount (% %)', amt, coalesce(p.data->>'currency', '') using errcode = '23514'; end if;
  v_status := case when amt is null or tot >= amt then 'Paid' else 'Partially paid' end;
  perform public._wf_rec_patch(p.id, v_status, jsonb_build_object('paid_on', to_char(p_paid_on, 'YYYY-MM-DD'), 'paid_amount', tot, 'payment_reference', left(trim(p_reference), 120), 'paid_recorded_by_id', me));
  select * into s from public.wf_step_runs where id = i.current_run;
  perform public._wf_event(i.id, s.id, me, 'payment_recorded', s.step_id, p.status, v_status, jsonb_build_object('amount', p_amount, 'total_paid', tot, 'currency', p.data->>'currency', 'paid_on', p_paid_on, 'reference', left(trim(p_reference), 120)));
  st := public._wf_step(i.definition_id, s.step_id);
  if v_status = 'Paid' and coalesce((st->>'records_payment')::boolean, false) then perform public._wf_finish(s.id, me, 'success', 'Payment recorded'); end if;
  return jsonb_build_object('ok', true, 'status', v_status, 'paid', tot);
end $$;
revoke execute on function public.ops_record_payment(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.ops_record_payment(uuid, date, numeric, text, text) to authenticated;

-- The impact record of an engineering change: entered and confirmed by a person; links are chosen, never inferred.
create or replace function public.ops_ecr_confirm_impact(p_ecr uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); rl text; r public.records; i public.wf_instances; s public.wf_step_runs; st jsonb; miss text;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select role into rl from public.profiles where id = me;
  select * into i from public.wf_instances where record_id = p_ecr and status in ('active', 'waiting', 'blocked') for update;
  select * into r from public.records where id = p_ecr and section = 'technical.changes' for update;
  if not found or not public.record_visible_for(me, r) then raise exception 'Change request not found' using errcode = 'P0002'; end if;
  if i.id is not null then select * into s from public.wf_step_runs where id = i.current_run; end if;
  if not (rl in ('owner', 'engineering', 'management') or (s.id is not null and public._wf_can_act(me, s, r))) then raise exception 'The impact is confirmed by Engineering' using errcode = '42501'; end if;
  select string_agg(f, ', ') into miss from unnest(array['impact_summary', 'impact_cost', 'impact_schedule_days']) f where coalesce(r.data->>f, '') = '';
  if miss is not null then raise exception 'Fill in the impact first: %', miss using errcode = '23514'; end if;
  perform public._wf_rec_patch(r.id, null, jsonb_build_object('impact_confirmed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'impact_confirmed_by_id', me, 'impact_confirmed_by', public._wf_name(me)));
  insert into public.wf_events(instance_id, run_id, record_id, section, actor, kind, step_id, from_state, to_state, detail)
  values (i.id, s.id, r.id, r.section, me, 'impact_confirmed', s.step_id, null, 'confirmed', jsonb_strip_nulls(jsonb_build_object('note', left(p_note, 300), 'cost', public._num(r.data->'impact_cost'), 'schedule_days', public._num(r.data->'impact_schedule_days'))));
  if s.id is not null then
    st := public._wf_step(i.definition_id, s.step_id);
    if coalesce((st->>'confirms_impact')::boolean, false) and public._wf_can_act(me, s, r) then perform public._wf_finish(s.id, me, 'success', 'Impact confirmed'); end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.ops_ecr_confirm_impact(uuid, text) from public, anon;
grant execute on function public.ops_ecr_confirm_impact(uuid, text) to authenticated;

-- records that share the configuration or the project of a change — listed with the exact reason, for a person to judge
create or replace function public.ops_ecr_candidates(p_ecr uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); r public.records;
begin
  select * into r from public.records where id = p_ecr and section = 'technical.changes';
  if me is null or not found or not public.record_visible_for(me, r) then raise exception 'Change request not found' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'section', x.section, 'title', x.title, 'status', x.status, 'reason', x.reason) order by x.section, x.title) from (
    select c.id, c.section, c.title, c.status, 'Same configuration: ' || (r.data->>'config') reason from public.records c
     where coalesce(r.data->>'config', '') <> '' and c.section in ('technical.bom', 'operations.builds', 'technical.equipment', 'technical.testing') and c.data->>'config' = r.data->>'config' and public.record_visible_for(me, c)
    union all
    select c.id, c.section, c.title, c.status, 'Same project' from public.records c
     where coalesce(r.data->>'project_ref', '') <> '' and c.id <> r.id and c.section in ('company.documents', 'operations.requests', 'operations.procurement', 'technical.testing')
       and c.data->>'project_ref' = r.data->>'project_ref' and public.record_visible_for(me, c)
    limit 200) x), '[]'::jsonb);
end $$;
revoke execute on function public.ops_ecr_candidates(uuid) from public, anon;
grant execute on function public.ops_ecr_candidates(uuid) to authenticated;

-- Extraction: the model (or a pattern match) only proposes; nothing becomes a record until a person confirms it
create or replace function public.ops_proposal_add(p_actor uuid, p_source uuid, p_kind text, p_target text, p_proposed jsonb, p_method text, p_evidence jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare src public.records; id uuid;
begin
  select * into src from public.records where id = p_source;
  if not found or not public.record_visible_for(p_actor, src) then raise exception 'Source not found' using errcode = 'P0002'; end if;
  if p_target not in ('operations.quotations', 'legal.contract_obligations', 'finance.payments') then raise exception 'Proposals can create quotations, contract obligations or payment requests' using errcode = '22023'; end if;
  perform public.ops_secret_check(p_proposed);
  insert into public.ops_proposals(created_by, source_record, target_section, kind, method, proposed, evidence)
  values (p_actor, p_source, p_target, p_kind, p_method, public._ops_clean(p_proposed) || jsonb_build_object('title', left(coalesce(p_proposed->>'title', p_kind), 300)), p_evidence)
  returning ops_proposals.id into id;
  insert into public.wf_events(record_id, section, actor, kind, to_state, detail) values (p_source, src.section, p_actor, 'proposal_created', 'proposed', jsonb_build_object('proposal', id, 'kind', p_kind, 'method', p_method));
  return id;
end $$;
revoke execute on function public.ops_proposal_add(uuid, uuid, text, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.ops_proposal_add(uuid, uuid, text, text, jsonb, text, jsonb) to service_role;

create or replace function public.ops_proposals(p_source uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); src public.records;
begin
  select * into src from public.records where id = p_source;
  if me is null or not found or not public.record_visible_for(me, src) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'target_section', p.target_section, 'method', p.method, 'proposed', p.proposed, 'evidence', p.evidence,
    'status', p.status, 'created_at', p.created_at, 'result_record', p.result_record) order by p.created_at desc) from public.ops_proposals p where p.source_record = p_source), '[]'::jsonb);
end $$;
revoke execute on function public.ops_proposals(uuid) from public, anon;
grant execute on function public.ops_proposals(uuid) to authenticated;

create or replace function public.ops_proposal_decide(p_id uuid, p_accept boolean, p_values jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); rl text; p public.ops_proposals; src public.records; v jsonb; rid uuid; ref public.records; changed jsonb;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select role into rl from public.profiles where id = me;
  select * into p from public.ops_proposals where id = p_id for update;
  if not found then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  select * into src from public.records where id = p.source_record;
  if not public.record_visible_for(me, src) then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  if p.status <> 'proposed' then raise exception 'Already %', p.status using errcode = '55000'; end if;
  if not (rl in ('owner', 'admin') or exists (select 1 from public.section_access a where a.role = rl and a.section = p.target_section and a.can_write)) then
    raise exception 'You cannot create records in that section' using errcode = '42501';
  end if;
  if not p_accept then
    update public.ops_proposals set status = 'rejected', decided_by = me, decided_at = now() where id = p.id;
    insert into public.wf_events(record_id, section, actor, kind, from_state, to_state, detail) values (src.id, src.section, me, 'proposal_rejected', 'proposed', 'rejected', jsonb_build_object('proposal', p.id, 'note', left(p_note, 300)));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  v := p.proposed || public._ops_clean(coalesce(p_values, '{}'::jsonb));
  perform public.ops_secret_check(v);
  select coalesce(jsonb_agg(k), '[]'::jsonb) into changed from jsonb_object_keys(public._ops_clean(coalesce(p_values, '{}'::jsonb))) k where (p.proposed->k) is distinct from (p_values->k);
  if p.target_section = 'operations.quotations' then
    v := v || jsonb_build_object('request_ref', coalesce(v->>'request_ref', src.data->>'request_ref', case when src.section = 'operations.requests' then src.id::text end));
    select * into ref from public.records where id = public.as_uuid(v->>'request_ref') and section = 'operations.requests';
    if not found or not public.record_visible_for(me, ref) then raise exception 'Say which purchase request the quotation is for' using errcode = '23514'; end if;
    v := v || jsonb_build_object('request_ref_title', coalesce(ref.data->>'number', ref.title));
  elsif p.target_section = 'legal.contract_obligations' then
    v := v || jsonb_build_object('contract_ref', coalesce(v->>'contract_ref', case when src.section = 'legal.contracts' then src.id::text end, src.data->>'contract_ref'));
    if coalesce(v->>'contract_ref', '') = '' then raise exception 'Say which contract the obligation belongs to' using errcode = '23514'; end if;
    if coalesce(v->>'description', '') = '' then raise exception 'Describe the obligation in your words' using errcode = '23514'; end if;
  end if;
  insert into public.records(section, title, status, controlled, created_by, data)
  values (p.target_section, left(coalesce(nullif(v->>'title', ''), p.kind), 300), case p.target_section when 'operations.quotations' then 'Received' when 'legal.contract_obligations' then 'Open' else 'Requested' end,
    src.controlled, me, (v - 'title') || jsonb_build_object('extracted', jsonb_build_object('proposal', p.id, 'method', p.method, 'from', src.id), 'confirmed_by_id', me, 'source_ref', src.id, 'source_ref_title', coalesce(src.data->>'number', src.title)))
  returning id into rid;
  update public.ops_proposals set status = 'accepted', decided_by = me, decided_at = now(), result_record = rid where id = p.id;
  insert into public.wf_events(record_id, section, actor, kind, from_state, to_state, detail)
  values (src.id, src.section, me, 'proposal_accepted', 'proposed', 'accepted', jsonb_build_object('proposal', p.id, 'record', rid, 'method', p.method, 'changed', changed));
  return jsonb_build_object('ok', true, 'status', 'accepted', 'record', rid);
end $$;
revoke execute on function public.ops_proposal_decide(uuid, boolean, jsonb, text) from public, anon;
grant execute on function public.ops_proposal_decide(uuid, boolean, jsonb, text) to authenticated;

-- one organisation, several relationships: only the relationships the viewer may open are shown
create or replace function public.ops_party(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); p public.records;
begin
  select * into p from public.records where id = p_id and section = 'company.parties';
  if me is null or not found or not public.record_visible_for(me, p) then raise exception 'Not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', p.id, 'title', p.title, 'status', p.status, 'data', p.data,
    'relationships', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'section', x.section, 'title', x.title, 'status', x.status, 'type',
        case x.section when 'operations.vendors' then 'Vendor' when 'sales.clients' then 'Client' when 'sales.partners' then 'Partner' when 'marketing.agencies' then 'Contractor'
          when 'operations.quotations' then 'Quotation' when 'operations.procurement' then 'Purchase' when 'finance.payments' then 'Payee' when 'legal.contracts' then 'Contract'
          when 'company.contacts' then 'Contact' when 'company.issues' then 'Issue' else x.section end) order by x.section, x.updated_at desc)
      from (select r.* from public.records r where r.data->>'party_ref' = p.id::text and public.record_visible_for(me, r) limit 300) x), '[]'::jsonb));
end $$;
revoke execute on function public.ops_party(uuid) from public, anon;
grant execute on function public.ops_party(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   16. Read models for one viewer. The working set is built once per statement (as in v22): every number, list,
       budget, attention item, weekly line and Assistant answer comes only from records this viewer may open.
   --------------------------------------------------------------------------------------------- */
create or replace function public._ops_base(p_viewer uuid) returns void
language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare p record; secs text[]; desks jsonb := coalesce(public.ops_cfg()->'desks', '{}'::jsonb); pid text;
begin
  if to_regclass('pg_temp.ops_meta') is null then
    create temp table ops_meta (viewer uuid, at timestamptz) on commit drop;
    create temp table ops_v (id uuid primary key, section text, title text, status text, data jsonb, controlled boolean, created_by uuid, created_at timestamptz, updated_at timestamptz,
      m_project uuid, m_amount numeric, m_currency text, m_due date, m_number text) on commit drop;
    create temp table ops_iv (id uuid primary key, record_id uuid, section text, def_code text, def_name text, status text, priority text, requester uuid, owner uuid,
      started_at timestamptz, due_at timestamptz, completed_at timestamptz, blocker text, run_id uuid, step_id text, step_name text, step_type text, assignee uuid, assignee_role text,
      run_due timestamptz, run_paused boolean, run_started timestamptz, escalation_level int) on commit drop;
  end if;
  if exists (select 1 from pg_temp.ops_meta m where m.viewer is not distinct from p_viewer and m.at = statement_timestamp()) then return; end if;
  truncate pg_temp.ops_v; truncate pg_temp.ops_iv; delete from pg_temp.ops_meta;
  select pp.id, pp.role, coalesce(pp.us_person, false) us into p from public.profiles pp where pp.id = p_viewer and not pp.disabled;
  if found and p.role is not null and p.role not in ('partner', 'vendor', 'investor', 'pending') then
    pid := p.id::text;
    select coalesce(array_agg(a.section), '{}') into secs from public.section_access a where a.role = p.role;
    -- exactly the rule of record_visible_for (tested to be equal), set-based
    insert into pg_temp.ops_v
    select r.id, r.section, r.title, r.status, r.data, r.controlled, r.created_by, r.created_at, r.updated_at,
      public.as_uuid(r.data->>'project_ref'),
      coalesce(public._num(r.data->'amount'), public._num(r.data->'selected_amount'), public._num(r.data->'est_amount'), public._num(r.data->'est_cost'), public._num(r.data->'value'), public._num(r.data->'planned')),
      coalesce(r.data->>'selected_currency', r.data->>'currency'),
      case when coalesce(r.data->>'due', r.data->>'eta', r.data->>'end_date', r.data->>'needed_by') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(r.data->>'due', r.data->>'eta', r.data->>'end_date', r.data->>'needed_by'), 10)::date end,
      r.data->>'number'
    from public.records r
    where r.section = any(public.ops_sections())
      and (p.role in ('owner', 'admin') or r.section = any(secs))
      and (coalesce(r.controlled, true) = false or p.us)
      and (r.section not in ('operations.requests', 'finance.payments', 'company.travel', 'company.requests')
        or p.role in ('owner', 'admin') or coalesce(desks->r.section, '[]'::jsonb) ? p.role
        or r.created_by = p.id or coalesce(r.data->>'requester_id', '') = pid or coalesce(r.data->>'owner_id', '') = pid or coalesce(r.data->>'assignee_id', '') = pid
        or coalesce(r.data->'travellers_ids', '[]'::jsonb) ? pid
        or exists (select 1 from public.approvals a where a.record_id = r.id and a.approver_id = p.id)
        or exists (select 1 from public.wf_instances i join public.wf_step_runs s on s.instance_id = i.id
                   where i.record_id = r.id and (s.assignee = p.id or s.completed_by = p.id or (s.status = 'open' and s.assignee is null and s.assignee_role = p.role)))
        or exists (select 1 from public.records pj where pj.id = public.as_uuid(r.data->>'project_ref') and pj.data->>'manager_id' = pid));
    insert into pg_temp.ops_iv
    select i.id, i.record_id, i.section, i.def_code, d.name, i.status, i.priority, i.requester, i.owner, i.started_at, i.due_at, i.completed_at, i.blocker,
      s.id, s.step_id, s.step_name, s.step_type, s.assignee, s.assignee_role, s.due_at, s.paused, s.started_at, s.escalation_level
    from public.wf_instances i join pg_temp.ops_v v on v.id = i.record_id join public.wf_definitions d on d.id = i.definition_id
    left join public.wf_step_runs s on s.id = i.current_run;
  end if;
  analyze pg_temp.ops_v; analyze pg_temp.ops_iv;
  insert into pg_temp.ops_meta(viewer, at) values (p_viewer, statement_timestamp());
end $$;
revoke execute on function public._ops_base(uuid) from public, anon, authenticated;

-- the visible set itself (used by the tests to prove it equals row-level security)
create or replace function public.ops_visible_ids() returns setof uuid language plpgsql volatile security definer set search_path = public as $$
declare me uuid := public.ops_viewer();
begin
  if me is null then return; end if;
  perform public._ops_base(me);
  return query select id from pg_temp.ops_v;
end $$;
revoke execute on function public.ops_visible_ids() from public, anon;
grant execute on function public.ops_visible_ids() to authenticated;

-- every operations item of one viewer, by kind (one definition for the dashboard, the drill-down, attention and the Assistant)
create or replace function public._ops_items(p_viewer uuid) returns void
language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare today date := (now() at time zone 'utc')::date; soon interval := make_interval(hours => coalesce((public.ops_cfg()->>'due_soon_hours')::int, 24)); rl text;
begin
  perform public._ops_base(p_viewer);
  if to_regclass('pg_temp.ops_items') is null then
    create temp table ops_items (kind text, record_id uuid, section text, title text, number text, status text, step text, due timestamptz, amount numeric, currency text,
      run_id uuid, instance_id uuid, reason text) on commit drop;
    create temp table ops_items_meta (viewer uuid, at timestamptz) on commit drop;
  end if;
  if exists (select 1 from pg_temp.ops_items_meta m where m.viewer is not distinct from p_viewer and m.at = statement_timestamp()) then return; end if;
  truncate pg_temp.ops_items; delete from pg_temp.ops_items_meta;
  select role into rl from public.profiles where id = p_viewer;
  insert into pg_temp.ops_items
  -- what I must do: my open steps (not approvals: those are listed from the approvals themselves)
  select 'needs_action', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, v.m_amount, v.m_currency, i.run_id, i.id, public.wf_todo(i.step_type, i.step_name)
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id
   where i.status in ('active', 'waiting', 'blocked') and i.step_type not in ('APPROVAL', 'AUTOMATION') and (i.assignee = p_viewer or (i.assignee is null and i.assignee_role = rl))
  union all
  select 'needs_action', v.id, v.section, v.title, v.m_number, v.status, coalesce(i.step_name, 'Approval'), a.created_at + interval '3 days', v.m_amount, v.m_currency, i.run_id, i.id, 'Approve or reject: ' || coalesce(a.note, v.title)
    from public.approvals a join pg_temp.ops_v v on v.id = a.record_id left join pg_temp.ops_iv i on i.run_id = a.wf_run
   where a.approver_id = p_viewer and a.status = 'pending'
  union all
  -- purchases
  select 'pr_open', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, v.m_amount, v.m_currency, i.run_id, i.id, null
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.section = 'operations.requests' and i.status in ('active', 'waiting', 'blocked')
  union all
  select 'pr_approval', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, v.m_amount, v.m_currency, i.run_id, i.id, null
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.section = 'operations.requests' and i.status in ('active', 'blocked') and i.step_type = 'APPROVAL'
  union all
  select 'po_awaiting_delivery', v.id, v.section, v.title, v.m_number, v.status, null, v.m_due::timestamptz, v.m_amount, v.m_currency, null, null, null
    from pg_temp.ops_v v where v.section = 'operations.procurement' and v.status in ('Approved', 'Ordered', 'Partially delivered')
  union all
  select 'po_overdue', v.id, v.section, v.title, v.m_number, v.status, null, v.m_due::timestamptz, v.m_amount, v.m_currency, null, null, 'Expected ' || to_char(v.m_due, 'YYYY-MM-DD')
    from pg_temp.ops_v v where v.section = 'operations.procurement' and v.status in ('Approved', 'Ordered', 'Partially delivered') and v.m_due < today
  union all
  select 'received_30d', v.id, v.section, v.title, v.m_number, v.status, null, null, v.m_amount, v.m_currency, null, null, null
    from pg_temp.ops_v v where v.section = 'operations.procurement' and v.status = 'Received' and coalesce(v.data->>'last_received', '') >= to_char(today - 30, 'YYYY-MM-DD')
  union all
  -- payments
  select 'pay_approval', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, v.m_amount, v.m_currency, i.run_id, i.id, null
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.section = 'finance.payments' and i.status in ('active', 'blocked') and i.step_type = 'APPROVAL'
  union all
  select 'pay_unpaid', v.id, v.section, v.title, v.m_number, v.status, null, v.m_due::timestamptz, public._num(v.data->'approved_amount') - coalesce(public._num(v.data->'paid_amount'), 0), coalesce(v.data->>'approved_currency', v.m_currency), null, null, 'Approved, not yet recorded as paid'
    from pg_temp.ops_v v where v.section = 'finance.payments' and v.data ? 'approved_amount' and v.status not in ('Paid', 'Reconciled', 'Closed', 'Cancelled', 'Rejected')
  union all
  select 'pay_ready', v.id, v.section, v.title, v.m_number, v.status, null, v.m_due::timestamptz, v.m_amount, v.m_currency, null, null, null
    from pg_temp.ops_v v where v.section = 'finance.payments' and v.status = 'Ready for payment'
  union all
  select 'paid_30d', v.id, v.section, v.title, v.m_number, v.status, null, null, public._num(v.data->'paid_amount'), v.m_currency, null, null, 'Paid ' || (v.data->>'paid_on')
    from pg_temp.ops_v v where v.section = 'finance.payments' and coalesce(v.data->>'paid_on', '') >= to_char(today - 30, 'YYYY-MM-DD')
  union all
  -- contracts and obligations
  select 'ctr_review', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, v.m_amount, v.m_currency, i.run_id, i.id, null
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.section = 'legal.contracts' and i.status in ('active', 'waiting', 'blocked') and coalesce(i.step_id, '') <> 'signature'
  union all
  select 'ctr_signature', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, v.m_amount, v.m_currency, i.run_id, i.id, null
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.section = 'legal.contracts' and i.status in ('active', 'blocked') and i.step_id = 'signature'
  union all
  select 'ctr_expiring', v.id, v.section, v.title, v.m_number, v.status, null, (v.data->>'end_date')::date::timestamptz, v.m_amount, v.m_currency, null, null, 'Ends ' || (v.data->>'end_date')
    from pg_temp.ops_v v where v.section = 'legal.contracts' and coalesce(v.data->>'end_date', '') ~ '^\d{4}-\d{2}-\d{2}$' and v.status in ('Active', 'Signed', 'Renewal')
      and (v.data->>'end_date')::date between today and today + 60
  union all
  select case when v.m_due < today then 'obl_overdue' else 'obl_due_soon' end, v.id, v.section, v.title, null, v.status, null, v.m_due::timestamptz, null, null, null, null,
         case when v.m_due < today then 'Overdue since ' else 'Due ' end || to_char(v.m_due, 'YYYY-MM-DD')
    from pg_temp.ops_v v where v.section = 'legal.contract_obligations' and coalesce(v.status, 'Open') = 'Open' and v.m_due <= today + 14
  union all
  -- engineering changes
  select 'ecr_open', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, null, null, i.run_id, i.id, null
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.section = 'technical.changes' and i.status in ('active', 'waiting', 'blocked')
  union all
  select 'ecr_approval', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, null, null, i.run_id, i.id, null
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.section = 'technical.changes' and i.status in ('active', 'blocked') and i.step_type = 'APPROVAL'
  union all
  select 'ecr_impact_missing', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, null, null, i.run_id, i.id, 'Impact record not confirmed'
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.section = 'technical.changes' and i.status in ('active', 'waiting', 'blocked') and coalesce(v.data->>'impact_confirmed_at', '') = ''
  union all
  -- issues
  select 'iss_open', v.id, v.section, v.title, v.m_number, v.status, null, v.m_due::timestamptz, null, null, null, null, v.data->>'type'
    from pg_temp.ops_v v where v.section = 'company.issues' and coalesce(v.status, 'Open') not in ('Closed', 'Cancelled')
  union all
  select 'iss_overdue', v.id, v.section, v.title, v.m_number, v.status, null, v.m_due::timestamptz, null, null, null, null, 'Due ' || to_char(v.m_due, 'YYYY-MM-DD')
    from pg_temp.ops_v v where v.section = 'company.issues' and coalesce(v.status, 'Open') not in ('Closed', 'Cancelled') and v.m_due < today
  union all
  -- waiting for someone outside, and process SLA
  select case when i.run_due < now() then 'wait_overdue' else 'wait_open' end, v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, null, null, i.run_id, i.id, 'Waiting for ' || i.step_name
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.status = 'waiting' and i.step_type = 'WAIT'
  union all
  select 'sla_due_soon', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, null, null, i.run_id, i.id, 'Due ' || to_char(i.run_due at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC'
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.status in ('active', 'blocked') and not coalesce(i.run_paused, false) and i.run_due between now() and now() + soon
  union all
  select 'sla_overdue', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, null, null, i.run_id, i.id, 'Step overdue since ' || to_char(i.run_due at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC'
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.status in ('active', 'blocked') and not coalesce(i.run_paused, false) and i.run_due < now()
  union all
  select 'sla_escalated', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, null, null, i.run_id, i.id, 'Escalated'
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.status in ('active', 'waiting', 'blocked') and i.escalation_level > 0
  union all
  select 'blocked', v.id, v.section, v.title, v.m_number, v.status, i.step_name, i.run_due, null, null, i.run_id, i.id, i.blocker
    from pg_temp.ops_iv i join pg_temp.ops_v v on v.id = i.record_id where i.status = 'blocked';
  insert into pg_temp.ops_items_meta values (p_viewer, statement_timestamp());
end $$;
revoke execute on function public._ops_items(uuid) from public, anon, authenticated;

create or replace function public.ops_overview() returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare me uuid := public.ops_viewer(); out jsonb;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._ops_items(me);
  select coalesce(jsonb_object_agg(kind, jsonb_build_object('count', n, 'ids', ids, 'amounts', amounts)), '{}'::jsonb) into out from (
    select k.kind, count(*) n, (array_agg(k.record_id order by k.due nulls last))[1:200] ids,
      (select coalesce(jsonb_object_agg(c, s), '{}'::jsonb) from (select coalesce(x.currency, '—') c, sum(x.amount) s from pg_temp.ops_items x where x.kind = k.kind and x.amount is not null group by 1) z) amounts
    from pg_temp.ops_items k group by k.kind) t;
  return jsonb_build_object('at', now(), 'items', out,
    'by_step', (select coalesce(jsonb_object_agg(def_code, steps), '{}'::jsonb) from (select def_code, jsonb_object_agg(coalesce(step_name, status), n) steps from (
      select i.def_code, i.step_name, i.status, count(*) n from pg_temp.ops_iv i where i.status in ('active', 'waiting', 'blocked') group by 1, 2, 3) a group by def_code) b),
    'issues_by_type', (select coalesce(jsonb_object_agg(coalesce(reason, 'Other'), n), '{}'::jsonb) from (select reason, count(*) n from pg_temp.ops_items where kind = 'iss_open' group by 1) c));
end $$;
revoke execute on function public.ops_overview() from public, anon;
grant execute on function public.ops_overview() to authenticated;

create or replace function public.ops_list(p_kind text, p_limit integer default 200) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare me uuid := public.ops_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._ops_items(me);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.due nulls last, x.title) from (select * from pg_temp.ops_items where kind = p_kind order by due nulls last, title limit least(greatest(p_limit, 1), 500)) x), '[]'::jsonb);
end $$;
revoke execute on function public.ops_list(text, integer) from public, anon;
grant execute on function public.ops_list(text, integer) to authenticated;

-- Phase 5 Attention: deterministic operations items with their reason
create or replace function public.ops_attention() returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare me uuid := public.ops_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._ops_items(me);
  return coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'record_id', record_id, 'section', section, 'title', title, 'number', number, 'step', step, 'due', due, 'reason', reason,
      'instance_id', instance_id, 'rank', case kind when 'sla_escalated' then 1 when 'blocked' then 2 when 'sla_overdue' then 3 when 'po_overdue' then 4 when 'obl_overdue' then 5 when 'wait_overdue' then 6 else 7 end)
      order by case kind when 'sla_escalated' then 1 when 'blocked' then 2 when 'sla_overdue' then 3 when 'po_overdue' then 4 when 'obl_overdue' then 5 when 'wait_overdue' then 6 else 7 end, due nulls last)
    from (select distinct on (kind, record_id) * from pg_temp.ops_items where kind in ('sla_escalated', 'blocked', 'sla_overdue', 'po_overdue', 'obl_overdue', 'wait_overdue', 'ctr_expiring') order by kind, record_id, due) x), '[]'::jsonb);
end $$;
revoke execute on function public.ops_attention() from public, anon;
grant execute on function public.ops_attention() to authenticated;

create or replace function public.ops_my_processes() returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare me uuid := public.ops_viewer(); row_ jsonb;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._ops_items(me);
  return jsonb_build_object(
    'needs_action', coalesce((select jsonb_agg(to_jsonb(x) order by x.due nulls last) from (select * from pg_temp.ops_items where kind = 'needs_action' order by due nulls last limit 300) x), '[]'::jsonb),
    'requested', coalesce((select jsonb_agg(jsonb_build_object('instance_id', i.id, 'record_id', i.record_id, 'section', i.section, 'title', v.title, 'number', v.m_number, 'process', i.def_name, 'status', i.status,
        'step', i.step_name, 'step_type', i.step_type, 'due', i.run_due, 'started_at', i.started_at, 'blocker', i.blocker) order by i.started_at desc)
      from (select * from pg_temp.ops_iv where requester = me and status in ('active', 'waiting', 'blocked') order by started_at desc limit 300) i join pg_temp.ops_v v on v.id = i.record_id), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('instance_id', i.id, 'record_id', i.record_id, 'section', i.section, 'title', v.title, 'number', v.m_number, 'process', i.def_name, 'status', i.status,
        'step', i.step_name, 'due', i.run_due, 'started_at', i.run_started) order by i.run_started)
      from (select * from pg_temp.ops_iv where status = 'waiting' and (requester = me or assignee = me or owner = me) limit 300) i join pg_temp.ops_v v on v.id = i.record_id), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('instance_id', i.id, 'record_id', i.record_id, 'section', i.section, 'title', v.title, 'number', v.m_number, 'process', i.def_name,
        'step', i.step_name, 'blocker', i.blocker, 'run_id', i.run_id) order by i.started_at)
      from (select * from pg_temp.ops_iv where status = 'blocked' and (requester = me or assignee = me or owner = me or public._ops_admin(me)) limit 300) i join pg_temp.ops_v v on v.id = i.record_id), '[]'::jsonb),
    'completed', coalesce((select jsonb_agg(jsonb_build_object('instance_id', i.id, 'record_id', i.record_id, 'section', i.section, 'title', v.title, 'number', v.m_number, 'process', i.def_name, 'status', i.status,
        'completed_at', i.completed_at) order by i.completed_at desc)
      from (select * from pg_temp.ops_iv where status in ('completed', 'cancelled') and (requester = me or exists (select 1 from public.wf_step_runs s where s.instance_id = ops_iv.id and s.completed_by = me))
            order by completed_at desc limit 100) i join pg_temp.ops_v v on v.id = i.record_id), '[]'::jsonb));
end $$;
revoke execute on function public.ops_my_processes() from public, anon;
grant execute on function public.ops_my_processes() to authenticated;

create or replace function public.ops_instance(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); i public.wf_instances; r public.records; d public.wf_definitions; s public.wf_step_runs; can boolean; rl text;
begin
  select * into i from public.wf_instances where id = p_id;
  if not found then select * into i from public.wf_instances where record_id = p_id order by created_at desc limit 1; end if;
  select * into r from public.records where id = i.record_id;
  if me is null or i.id is null or not public.record_visible_for(me, r) then raise exception 'Process not found' using errcode = 'P0002'; end if;
  select * into d from public.wf_definitions where id = i.definition_id;
  select * into s from public.wf_step_runs where id = i.current_run;
  select role into rl from public.profiles where id = me;
  can := s.id is not null and public._wf_can_act(me, s, r);
  return jsonb_build_object(
    'id', i.id, 'status', i.status, 'outcome', i.outcome, 'priority', i.priority, 'blocker', i.blocker, 'started_at', i.started_at, 'due_at', i.due_at, 'completed_at', i.completed_at,
    'requester', i.requester, 'requester_name', public._wf_name(i.requester), 'owner', i.owner,
    'definition', jsonb_build_object('id', d.id, 'code', d.code, 'version', d.version, 'name', d.name, 'state', d.state, 'steps', d.steps),
    'record', jsonb_build_object('id', r.id, 'section', r.section, 'title', r.title, 'status', r.status, 'number', r.data->>'number', 'controlled', r.controlled, 'data', r.data),
    'current', case when s.id is null then null else jsonb_build_object('run_id', s.id, 'step_id', s.step_id, 'name', s.step_name, 'type', s.step_type, 'assignee', s.assignee, 'assignee_name', public._wf_name(s.assignee),
      'assignee_role', s.assignee_role, 'due_at', s.due_at, 'paused', s.paused, 'blocked_reason', s.blocked_reason, 'todo', public.wf_todo(s.step_type, s.step_name),
      'step', public._wf_step(d.id, s.step_id), 'can_act', can, 'is_requester', me = i.requester,
      'can_manage', public._ops_admin(me) or i.owner = me, 'can_retry', public._ops_admin(me) or i.owner = me or can) end,
    'can_cancel', i.status in ('active', 'waiting', 'blocked') and (me = i.requester or i.owner = me or public._ops_admin(me)),
    'facts', public._wf_facts(i.id, r),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'seq', x.seq, 'step_id', x.step_id, 'name', x.step_name, 'type', x.step_type, 'status', x.status, 'outcome', x.outcome,
        'assignee_name', public._wf_name(x.assignee), 'assignee_role', x.assignee_role, 'started_at', x.started_at, 'due_at', x.due_at, 'completed_at', x.completed_at,
        'completed_by_name', public._wf_name(x.completed_by), 'note', x.note, 'escalation_level', x.escalation_level) order by x.seq) from public.wf_step_runs x where x.instance_id = i.id), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'level', a.step, 'status', a.status, 'approver', a.approver_id, 'approver_name', public._wf_name(a.approver_id), 'note', a.note,
        'comment', a.comment, 'decided_at', a.decided_at, 'mine', a.approver_id = me, 'mode', a.chain_mode, 'basis', a.basis, 'invalidated_reason', a.invalidated_reason, 'run', a.wf_run) order by a.created_at, a.step)
      from public.approvals a where a.wf_run in (select x.id from public.wf_step_runs x where x.instance_id = i.id)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'step', e.step_id, 'from', e.from_state, 'to', e.to_state, 'actor_name', public._wf_name(e.actor), 'detail', e.detail) order by e.id)
      from public.wf_events e where e.instance_id = i.id), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'record_id', x.id, 'section', x.section, 'title', x.title, 'status', x.status, 'number', x.data->>'number'))
      from public.wf_links l join public.records x on x.id = l.record_id where l.instance_id = i.id and public.record_visible_for(me, x)), '[]'::jsonb));
end $$;
revoke execute on function public.ops_instance(uuid) from public, anon;
grant execute on function public.ops_instance(uuid) to authenticated;

-- the processes of one record (shown on the record), newest first
create or replace function public.ops_record_processes(p_record uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); r public.records;
begin
  select * into r from public.records where id = p_record;
  if me is null or not found or not public.record_visible_for(me, r) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'code', i.def_code, 'version', i.def_version, 'name', d.name, 'status', i.status, 'step', s.step_name, 'started_at', i.started_at) order by i.created_at desc)
    from public.wf_instances i join public.wf_definitions d on d.id = i.definition_id left join public.wf_step_runs s on s.id = i.current_run where i.record_id = p_record), '[]'::jsonb);
end $$;
revoke execute on function public.ops_record_processes(uuid) from public, anon;
grant execute on function public.ops_record_processes(uuid) to authenticated;

-- Phase 5 Deadlines: operations dates (obligations, contract ends, needed-by dates, deliveries, payments due, issues)
create or replace function public.ops_deadlines(p_days integer default 30) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare me uuid := public.ops_viewer(); today date := (now() at time zone 'utc')::date;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._ops_base(me);
  return coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'record_id', x.id, 'section', x.section, 'title', x.title, 'number', x.m_number, 'due', x.d, 'days', x.d - today, 'status', x.status) order by x.d, x.title) from (
    select case v.section when 'legal.contract_obligations' then 'obligation' when 'operations.requests' then 'needed_by' when 'operations.procurement' then 'delivery'
      when 'finance.payments' then 'payment_due' when 'company.issues' then 'issue_due' else 'date' end kind, v.id, v.section, v.title, v.m_number, v.m_due d, v.status
    from pg_temp.ops_v v
    where v.m_due is not null and v.m_due <= today + greatest(1, least(p_days, 366))
      and ((v.section = 'legal.contract_obligations' and coalesce(v.status, 'Open') = 'Open')
        or (v.section = 'operations.requests' and coalesce(v.status, '') not in ('Closed', 'Rejected', 'Cancelled'))
        or (v.section = 'operations.procurement' and v.status in ('Approved', 'Ordered', 'Partially delivered'))
        or (v.section = 'finance.payments' and coalesce(v.status, '') not in ('Paid', 'Reconciled', 'Closed', 'Rejected', 'Cancelled'))
        or (v.section = 'company.issues' and coalesce(v.status, '') not in ('Closed', 'Cancelled')))
    union all
    select 'contract_end', v.id, v.section, v.title, v.m_number, (v.data->>'end_date')::date, v.status from pg_temp.ops_v v
    where v.section = 'legal.contracts' and coalesce(v.data->>'end_date', '') ~ '^\d{4}-\d{2}-\d{2}$' and v.status in ('Active', 'Signed', 'Renewal')
      and (v.data->>'end_date')::date between today and today + greatest(1, least(p_days, 366))) x), '[]'::jsonb);
end $$;
revoke execute on function public.ops_deadlines(integer) from public, anon;
grant execute on function public.ops_deadlines(integer) to authenticated;

/* ---------------------------------------------------------------------------------------------
   17. Project budgets without accounting: what is planned, requested (estimates), approved, committed, paid, left.
       Remaining = budget − committed − approved but not yet ordered. Estimates are shown apart and never subtracted.
       Amounts stay in their currency (nothing is converted).
   --------------------------------------------------------------------------------------------- */
create or replace function public._ops_budget_calc(p_project uuid, p_viewer uuid)
returns table (project_id uuid, currency text, budget numeric, requested numeric, approved numeric, committed numeric, paid numeric, remaining numeric, refs jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with src as (
    select r.* from public.records r
    where r.data->>'project_ref' = p_project::text
      and r.section in ('finance.budget', 'operations.requests', 'operations.procurement', 'finance.payments')
      and (p_viewer is null or public.record_visible_for(p_viewer, r))),
  lines as (
    select 'budget' k, coalesce(s.data->>'currency', 'USD') cur, public._num(s.data->'planned') amt, s.id from src s where s.section = 'finance.budget' and coalesce(s.status, '') <> 'Closed'
    union all
    select 'requested', coalesce(s.data->>'currency', 'USD'), public._num(s.data->'est_amount'), s.id from src s
     where s.section = 'operations.requests' and not s.data ? 'approved_amount' and not s.data ? 'purchase_ref' and coalesce(s.status, '') not in ('Closed', 'Rejected', 'Cancelled')
    union all
    select 'approved', coalesce(s.data->>'approved_currency', s.data->>'currency', 'USD'), public._num(s.data->'approved_amount'), s.id from src s
     where s.section = 'operations.requests' and s.data ? 'approved_amount' and not s.data ? 'purchase_ref' and coalesce(s.status, '') not in ('Closed', 'Rejected', 'Cancelled')
    union all
    select 'approved', coalesce(s.data->>'approved_currency', s.data->>'currency', 'USD'), public._num(s.data->'approved_amount') - coalesce(public._num(s.data->'paid_amount'), 0), s.id from src s
     where s.section = 'finance.payments' and s.data ? 'approved_amount' and coalesce(s.data->>'purchase_ref', '') = '' and coalesce(s.status, '') not in ('Paid', 'Reconciled', 'Closed', 'Rejected', 'Cancelled')
    union all
    select 'committed', coalesce(s.data->>'currency', 'USD'), public._num(s.data->'amount'), s.id from src s
     where s.section = 'operations.procurement' and coalesce(s.status, '') not in ('Cancelled', 'Draft')
    union all
    select 'paid', coalesce(s.data->>'currency', 'USD'), public._num(s.data->'paid_amount'), s.id from src s
     where s.section = 'finance.payments' and coalesce(s.data->>'paid_on', '') <> '')
  select p_project, c.cur, x.b, x.rq, x.ap, x.cm, x.pd, x.b - x.cm - x.ap,
    (select jsonb_object_agg(q.k, q.ids) from (select l2.k, jsonb_agg(l2.id) ids from lines l2 where l2.cur = c.cur and l2.amt is not null group by l2.k) q)
  from (select distinct l.cur from lines l where l.amt is not null) c
  cross join lateral (select coalesce(sum(l.amt) filter (where l.k = 'budget'), 0) b, coalesce(sum(l.amt) filter (where l.k = 'requested'), 0) rq,
      coalesce(sum(l.amt) filter (where l.k = 'approved'), 0) ap, coalesce(sum(l.amt) filter (where l.k = 'committed'), 0) cm, coalesce(sum(l.amt) filter (where l.k = 'paid'), 0) pd
    from lines l where l.cur = c.cur and l.amt is not null) x;
end $$;
revoke execute on function public._ops_budget_calc(uuid, uuid) from public, anon, authenticated;

create or replace function public.ops_budget(p_project uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare me uuid := public.ops_viewer(); pj public.records;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_project is not null then
    select * into pj from public.records where id = p_project and section = 'company.projects';
    if not found or not public.record_visible_for(me, pj) then raise exception 'Project not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('project', jsonb_build_object('id', pj.id, 'title', pj.title), 'rows', coalesce((select jsonb_agg(to_jsonb(b)) from public._ops_budget_calc(p_project, me) b), '[]'::jsonb),
      'formula', 'Remaining = Budget − Committed − Approved (not yet ordered). Requested amounts are estimates and are not subtracted.');
  end if;
  perform public._ops_base(me);
  return jsonb_build_object('formula', 'Remaining = Budget − Committed − Approved (not yet ordered). Requested amounts are estimates and are not subtracted.',
    'rows', coalesce((select jsonb_agg(jsonb_build_object('project_id', x.pid, 'project', x.ptitle, 'currency', x.cur, 'budget', x.budget, 'requested', x.requested, 'approved', x.approved, 'committed', x.committed,
      'paid', x.paid, 'remaining', x.budget - x.committed - x.approved) order by x.ptitle, x.cur) from (
    select v.m_project pid, max(coalesce(v.data->>'project_ref_title', '')) ptitle,
      coalesce(case when v.section = 'operations.requests' and v.data ? 'approved_amount' then v.data->>'approved_currency' end, v.data->>'currency', 'USD') cur,
      coalesce(sum(public._num(v.data->'planned')) filter (where v.section = 'finance.budget' and coalesce(v.status, '') <> 'Closed'), 0) budget,
      coalesce(sum(public._num(v.data->'est_amount')) filter (where v.section = 'operations.requests' and not v.data ? 'approved_amount' and not v.data ? 'purchase_ref' and coalesce(v.status, '') not in ('Closed', 'Rejected', 'Cancelled')), 0) requested,
      coalesce(sum(public._num(v.data->'approved_amount')) filter (where v.section = 'operations.requests' and v.data ? 'approved_amount' and not v.data ? 'purchase_ref' and coalesce(v.status, '') not in ('Closed', 'Rejected', 'Cancelled')), 0)
        + coalesce(sum(public._num(v.data->'approved_amount') - coalesce(public._num(v.data->'paid_amount'), 0)) filter (where v.section = 'finance.payments' and v.data ? 'approved_amount' and coalesce(v.data->>'purchase_ref', '') = '' and coalesce(v.status, '') not in ('Paid', 'Reconciled', 'Closed', 'Rejected', 'Cancelled')), 0) approved,
      coalesce(sum(public._num(v.data->'amount')) filter (where v.section = 'operations.procurement' and coalesce(v.status, '') not in ('Cancelled', 'Draft')), 0) committed,
      coalesce(sum(public._num(v.data->'paid_amount')) filter (where v.section = 'finance.payments' and coalesce(v.data->>'paid_on', '') <> ''), 0) paid
    from pg_temp.ops_v v
    where v.m_project is not null and v.section in ('finance.budget', 'operations.requests', 'operations.procurement', 'finance.payments')
      and exists (select 1 from public.records pj2 where pj2.id = v.m_project and public.record_visible_for(me, pj2))
    group by 1, 3) x), '[]'::jsonb));
end $$;
revoke execute on function public.ops_budget(uuid) from public, anon;
grant execute on function public.ops_budget(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   18. Weekly review (OPERATIONS section) and the Assistant's operations questions
   --------------------------------------------------------------------------------------------- */
create or replace function public.ops_weekly(p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare me uuid := public.ops_viewer(); f timestamptz := coalesce(p_from, now() - interval '7 days'); t timestamptz := coalesce(p_to, now());
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._ops_items(me);
  return jsonb_build_object('from', f, 'to', t,
    'started', (select count(*) from public.wf_events e join pg_temp.ops_v v on v.id = e.record_id where e.kind = 'started' and e.at between f and t),
    'completed', (select count(*) from public.wf_events e join pg_temp.ops_v v on v.id = e.record_id where e.kind = 'completed' and e.at between f and t),
    'rejected', (select count(*) from public.wf_events e join pg_temp.ops_v v on v.id = e.record_id where e.kind = 'rejected' and e.at between f and t),
    'approvals_decided', (select count(*) from public.wf_events e join pg_temp.ops_v v on v.id = e.record_id where e.kind = 'approval_decided' and e.at between f and t),
    'approvals_invalidated', (select count(*) from public.wf_events e join pg_temp.ops_v v on v.id = e.record_id where e.kind = 'approval_invalidated' and e.at between f and t),
    'purchases_created', (select count(*) from public.wf_events e join pg_temp.ops_v v on v.id = e.record_id where e.kind = 'purchase_created' and e.at between f and t),
    'receipts', (select count(*) from public.wf_events e join pg_temp.ops_v v on v.id = e.record_id where e.kind = 'received' and e.at between f and t),
    'payments_recorded', (select coalesce(jsonb_object_agg(c, s), '{}'::jsonb) from (select coalesce(e.detail->>'currency', '—') c, sum((e.detail->>'amount')::numeric) s
       from public.wf_events e join pg_temp.ops_v v on v.id = e.record_id where e.kind = 'payment_recorded' and e.at between f and t group by 1) z),
    'issues_opened', (select count(*) from pg_temp.ops_v v where v.section = 'company.issues' and v.created_at between f and t),
    'escalations', (select count(*) from public.wf_events e join pg_temp.ops_v v on v.id = e.record_id where e.kind = 'escalated' and e.at between f and t),
    'now', jsonb_build_object('overdue_steps', (select count(*) from pg_temp.ops_items where kind = 'sla_overdue'), 'blocked', (select count(*) from pg_temp.ops_items where kind = 'blocked'),
      'overdue_deliveries', (select count(*) from pg_temp.ops_items where kind = 'po_overdue'), 'waiting_external', (select count(*) from pg_temp.ops_items where kind in ('wait_open', 'wait_overdue')),
      'unpaid_approved', (select count(*) from pg_temp.ops_items where kind = 'pay_unpaid'), 'obligations_overdue', (select count(*) from pg_temp.ops_items where kind = 'obl_overdue')));
end $$;
revoke execute on function public.ops_weekly(timestamptz, timestamptz) from public, anon;
grant execute on function public.ops_weekly(timestamptz, timestamptz) to authenticated;

-- facts and calculations with their sources; "unavailable" when the viewer can open nothing that answers
create or replace function public.ops_assistant(p_intent text, p_arg text default null) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare me uuid := public.ops_viewer(); kinds text[]; items jsonb; pj public.records; b jsonb; i public.wf_instances; r public.records;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._ops_items(me);
  if p_intent = 'my_approvals' then
    items := coalesce((select jsonb_agg(jsonb_build_object('record_id', v.id, 'section', v.section, 'title', v.title, 'number', v.m_number, 'amount', public._num(a.basis->'selected_amount'),
        'estimate', public._num(a.basis->'est_amount'), 'currency', coalesce(a.basis->>'selected_currency', a.basis->>'currency', v.m_currency), 'level', a.step, 'requested_at', a.created_at,
        'requester', public._wf_name(a.requested_by)) order by a.created_at)
      from public.approvals a join pg_temp.ops_v v on v.id = a.record_id
      where a.approver_id = me and a.status = 'pending' and (p_arg is null or v.section = p_arg)), '[]'::jsonb);
    return jsonb_build_object('intent', p_intent, 'kind', case when jsonb_array_length(items) = 0 then 'unavailable' else 'fact' end, 'items', items,
      'note', case when jsonb_array_length(items) = 0 then 'Nothing is waiting for your approval among the records you can open.' end);
  elsif p_intent = 'budget' then
    select * into pj from public.records x where x.section = 'company.projects' and (x.id = public.as_uuid(p_arg) or lower(x.title) like '%' || lower(coalesce(p_arg, '')) || '%')
      and public.record_visible_for(me, x) order by (x.id = public.as_uuid(p_arg)) desc nulls last, length(x.title) limit 1;
    if not found then return jsonb_build_object('intent', p_intent, 'kind', 'unavailable', 'items', '[]'::jsonb, 'note', 'No project you can open matches.'); end if;
    b := coalesce((select jsonb_agg(to_jsonb(x)) from public._ops_budget_calc(pj.id, me) x), '[]'::jsonb);
    return jsonb_build_object('intent', p_intent, 'kind', case when jsonb_array_length(b) = 0 then 'unavailable' else 'calculation' end, 'project', jsonb_build_object('id', pj.id, 'title', pj.title), 'items', b,
      'formula', 'Remaining = Budget − Committed − Approved (not yet ordered). Requested amounts are estimates and are not subtracted.');
  elsif p_intent = 'process' then
    select x.* into r from pg_temp.ops_v v join public.records x on x.id = v.id where upper(v.m_number) = upper(trim(coalesce(p_arg, ''))) limit 1;
    if not found then return jsonb_build_object('intent', p_intent, 'kind', 'unavailable', 'items', '[]'::jsonb, 'note', 'No record with that number among those you can open.'); end if;
    return jsonb_build_object('intent', p_intent, 'kind', 'fact', 'items', jsonb_build_array(jsonb_build_object('record_id', r.id, 'section', r.section, 'title', r.title, 'number', r.data->>'number', 'status', r.status,
      'processes', public.ops_record_processes(r.id))));
  end if;
  kinds := case p_intent
    when 'my_actions' then array['needs_action'] when 'purchases_open' then array['pr_open'] when 'purchases_approval' then array['pr_approval']
    when 'deliveries_overdue' then array['po_overdue'] when 'deliveries_open' then array['po_awaiting_delivery'] when 'payments_unpaid' then array['pay_unpaid']
    when 'payments_approval' then array['pay_approval'] when 'contracts_expiring' then array['ctr_expiring'] when 'contracts_open' then array['ctr_review', 'ctr_signature']
    when 'obligations_due' then array['obl_due_soon', 'obl_overdue'] when 'changes_open' then array['ecr_open'] when 'issues_open' then array['iss_open']
    when 'waiting_external' then array['wait_open', 'wait_overdue'] when 'sla_overdue' then array['sla_overdue', 'sla_escalated'] when 'blocked' then array['blocked'] end;
  if kinds is null then return jsonb_build_object('intent', p_intent, 'kind', 'unavailable', 'items', '[]'::jsonb, 'note', 'This question is not one Workspace can answer from its records.'); end if;
  items := coalesce((select jsonb_agg(to_jsonb(x) order by x.due nulls last) from (select * from pg_temp.ops_items where kind = any(kinds) order by due nulls last limit 50) x), '[]'::jsonb);
  return jsonb_build_object('intent', p_intent, 'kind', case when jsonb_array_length(items) = 0 then 'unavailable' else 'fact' end, 'items', items,
    'total', (select count(*) from pg_temp.ops_items where kind = any(kinds)),
    'note', case when jsonb_array_length(items) = 0 then 'None among the records you can open.' end);
end $$;
revoke execute on function public.ops_assistant(text, text) from public, anon;
grant execute on function public.ops_assistant(text, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   19. SLA: due soon, overdue, escalation — each notice once per step (no repeats), service role only
   --------------------------------------------------------------------------------------------- */
create or replace function public.wf_sla_tick() returns jsonb
language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare x record; st jsonb; r public.records; res record; soon interval := make_interval(hours => coalesce((public.ops_cfg()->>'due_soon_hours')::int, 24)); wk int[];
  n_soon int := 0; n_over int := 0; n_esc int := 0; n_to int := 0; esc_at timestamptz;
begin
  if auth.uid() is not null then raise exception 'Not allowed' using errcode = '42501'; end if;
  wk := array(select v::int from jsonb_array_elements_text(coalesce(public.ops_cfg()->'weekend', '[6,7]')) v);
  for x in select s.*, i.definition_id, i.record_id, i.status ist from public.wf_step_runs s join public.wf_instances i on i.id = s.instance_id and i.current_run = s.id
           where s.status = 'open' and s.due_at is not null and not s.paused and s.due_at - soon <= now() and i.status in ('active', 'blocked')
           order by s.due_at limit 2000 loop
    select * into r from public.records where id = x.record_id;
    st := public._wf_step(x.definition_id, x.step_id);
    if x.step_type = 'APPROVAL' and x.soon_at is null then
      perform public.notify_user(a.approver_id, case when x.due_at > now() then 'wf_due_soon' else 'wf_overdue' end, r.id, 'wf-ap:' || a.id, 'Approval ' || case when x.due_at > now() then 'due soon' else 'overdue' end || ': ' || coalesce(r.data->>'number', r.title),
        'Due ' || to_char(x.due_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC', null, '/ops?i=' || x.instance_id)
      from public.approvals a where a.wf_run = x.id and a.status = 'pending';
    end if;
    if x.due_at > now() and x.soon_at is null then
      perform public._wf_notify(x.assignee, x.assignee_role, 'wf_due_soon', r, 'wf-soon:' || x.id, 'Due soon: ' || x.step_name || ' — ' || coalesce(r.data->>'number', r.title),
        'Due ' || to_char(x.due_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC', null, '/ops?i=' || x.instance_id);
      update public.wf_step_runs set soon_at = now() where id = x.id; n_soon := n_soon + 1;
    end if;
    if x.due_at <= now() and x.overdue_at is null then
      perform public._wf_notify(x.assignee, x.assignee_role, 'wf_overdue', r, 'wf-over:' || x.id, 'Overdue: ' || x.step_name || ' — ' || coalesce(r.data->>'number', r.title),
        'Was due ' || to_char(x.due_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC', null, '/ops?i=' || x.instance_id);
      update public.wf_step_runs set overdue_at = now() where id = x.id;
      perform public._wf_event(x.instance_id, x.id, null, 'overdue', x.step_id, null, 'overdue', jsonb_build_object('due', x.due_at));
      n_over := n_over + 1;
    end if;
    if st ? 'escalation' and x.escalation_level = 0 then
      esc_at := public.sla_add(x.due_at, public._num(st->'escalation'->'after'->'amount'), st->'escalation'->'after'->>'unit', wk);
      if esc_at is not null and esc_at <= now() then
        select * into res from public._wf_resolve(st->'escalation'->'to', x.instance_id, r, null);
        perform public._wf_notify(res.o_uid, res.o_role, 'wf_escalated', r, 'wf-esc:' || x.id || ':1', 'Escalated: ' || x.step_name || ' — ' || coalesce(r.data->>'number', r.title),
          'Overdue since ' || to_char(x.due_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC; responsible: ' || coalesce(public._wf_name(x.assignee), x.assignee_role, '—'), null, '/ops?i=' || x.instance_id);
        update public.wf_step_runs set escalation_level = 1, escalated_at = now() where id = x.id;
        perform public._wf_event(x.instance_id, x.id, null, 'escalated', x.step_id, 'overdue', 'escalated', jsonb_build_object('to', res.o_uid, 'role', res.o_role, 'level', 1));
        n_esc := n_esc + 1;
      end if;
    end if;
    if x.due_at <= now() and st->'on' ? 'timed_out' then
      perform public._wf_finish(x.id, null, 'timed_out', 'The time for this step ran out'); n_to := n_to + 1;
    end if;
  end loop;
  return jsonb_build_object('due_soon', n_soon, 'overdue', n_over, 'escalated', n_esc, 'timed_out', n_to, 'retries', public.wf_retry_due(20));
end $$;
revoke execute on function public.wf_sla_tick() from public, anon, authenticated;
grant execute on function public.wf_sla_tick() to service_role;

/* ---------------------------------------------------------------------------------------------
   20. Starting configuration: approval policies (roles and leads only, never named people) and the first
       published version of each process. Every value can be changed: a change makes a new version.
   --------------------------------------------------------------------------------------------- */
insert into public.approval_policies(code, name, section, tiers) values
('PURCHASE', 'Purchase approval', 'operations.requests', $j$[
  {"label": "Up to 5,000", "when": {"field": "facts.amount", "op": "lte", "value": 5000}, "mode": "sequential",
   "steps": [{"kind": "department_lead", "label": "Department lead", "fallback": {"kind": "role", "role": "management"}}]},
  {"label": "Up to 25,000", "when": {"field": "facts.amount", "op": "lte", "value": 25000}, "mode": "sequential",
   "steps": [{"kind": "department_lead", "label": "Department lead", "fallback": {"kind": "role", "role": "management"}}, {"kind": "role", "role": "finance", "label": "Finance"}]},
  {"label": "Above 25,000", "mode": "sequential",
   "steps": [{"kind": "department_lead", "label": "Department lead", "fallback": {"kind": "role", "role": "management"}}, {"kind": "role", "role": "finance", "label": "Finance"}, {"kind": "role", "role": "management", "label": "Management"}]}
]$j$::jsonb),
('PAYMENT', 'Payment approval', 'finance.payments', $j$[
  {"label": "Up to 10,000", "when": {"field": "facts.amount", "op": "lte", "value": 10000}, "mode": "sequential", "steps": [{"kind": "role", "role": "finance", "label": "Finance"}]},
  {"label": "Above 10,000", "mode": "sequential", "steps": [{"kind": "role", "role": "finance", "label": "Finance"}, {"kind": "role", "role": "management", "label": "Management"}]}
]$j$::jsonb),
('CONTRACT', 'Contract approval', 'legal.contracts', $j$[
  {"label": "Legal and management", "mode": "sequential", "steps": [{"kind": "role", "role": "legal", "label": "Legal"}, {"kind": "role", "role": "management", "label": "Management"}]}
]$j$::jsonb),
('ECR', 'Engineering change approval', 'technical.changes', $j$[
  {"label": "Cost impact above 10,000", "when": {"field": "facts.amount", "op": "gt", "value": 10000}, "mode": "parallel",
   "steps": [{"kind": "department_lead", "dept": "engineering", "label": "Engineering lead", "fallback": {"kind": "role", "role": "engineering"}}, {"kind": "role", "role": "management", "label": "Management"}]},
  {"label": "Engineering", "mode": "sequential", "steps": [{"kind": "department_lead", "dept": "engineering", "label": "Engineering lead", "fallback": {"kind": "role", "role": "engineering"}}]}
]$j$::jsonb),
('TRAVEL', 'Travel approval', 'company.travel', $j$[
  {"label": "Up to 5,000", "when": {"field": "facts.amount", "op": "lte", "value": 5000}, "mode": "sequential", "steps": [{"kind": "department_lead", "label": "Department lead", "fallback": {"kind": "role", "role": "management"}}]},
  {"label": "Above 5,000", "mode": "sequential", "steps": [{"kind": "department_lead", "label": "Department lead", "fallback": {"kind": "role", "role": "management"}}, {"kind": "role", "role": "finance", "label": "Finance"}]}
]$j$::jsonb)
on conflict (code) do nothing;

do $$
declare me uuid;
  procedure_defs jsonb := $j$[
  {"code": "PURCHASE", "name": "Purchase request", "category": "procurement", "source_section": "operations.requests", "owner_role": "procurement", "owner_department": "procurement",
   "sla": {"amount": 20, "unit": "business_days"}, "completion": {"completed": "Closed", "rejected": "Rejected", "cancelled": "Cancelled"},
   "description": "Request → technical review → quotations → vendor selection → approval → purchase record → order → delivery → receiving → close.",
   "steps": [
    {"id": "request", "name": "Purchase request", "type": "DATA", "responsible": {"kind": "requester"}, "fields": ["item", "qty", "est_amount", "currency"], "record_status": "Submitted", "sla": {"amount": 2, "unit": "business_days"}},
    {"id": "tech_review", "name": "Technical review", "type": "REVIEW", "responsible": {"kind": "field", "field": "technical_reviewer_id", "fallback": {"kind": "department_lead", "dept": "engineering", "fallback": {"kind": "role", "role": "engineering"}}},
     "record_status": "Technical review", "sla": {"amount": 3, "unit": "business_days"}, "on": {"changes_requested": "request", "rejected": "$reject"}},
    {"id": "quotations", "name": "Quotations", "type": "DOCUMENT", "responsible": {"kind": "department_lead", "dept": "procurement", "fallback": {"kind": "role", "role": "procurement", "fallback": {"kind": "role", "role": "operations"}}},
     "documents": [{"kind": "quotations", "min": 1}], "record_status": "Quotations", "sla": {"amount": 5, "unit": "business_days"},
     "instructions": "Collect quotations from vendors (add each one under Quotations, linked to this request). Ask for several where it makes sense."},
    {"id": "vendor_selection", "name": "Vendor selection", "type": "DATA", "selects_quote": true, "responsible": {"kind": "department_lead", "dept": "procurement", "fallback": {"kind": "role", "role": "procurement", "fallback": {"kind": "role", "role": "operations"}}},
     "guard": {"field": "facts.vendor_status", "op": "in", "value": ["Approved", "Active"]}, "guard_message": "The chosen vendor must be Approved or Active in the vendor directory",
     "record_status": "Vendor selection", "sla": {"amount": 2, "unit": "business_days"}},
    {"id": "approval", "name": "Approval", "type": "APPROVAL", "policy": "PURCHASE", "record_status": "Approval", "sla": {"amount": 3, "unit": "business_days"},
     "escalation": {"after": {"amount": 1, "unit": "business_days"}, "to": {"kind": "role", "role": "management"}}, "on": {"changes_requested": "request", "rejected": "$reject"}},
    {"id": "purchase", "name": "Purchase record", "type": "AUTOMATION", "action": "create_purchase", "record_status": "Approved"},
    {"id": "order", "name": "Place the order", "type": "TASK", "responsible": {"kind": "department_lead", "dept": "procurement", "fallback": {"kind": "role", "role": "procurement", "fallback": {"kind": "role", "role": "operations"}}},
     "sla": {"amount": 2, "unit": "business_days"}, "instructions": "Send the purchase order to the vendor yourself (Workspace sends nothing outside by itself), then complete this task."},
    {"id": "ordered", "name": "Mark as ordered", "type": "AUTOMATION", "action": "mark_ordered", "record_status": "Ordered"},
    {"id": "delivery", "name": "Delivery from the vendor", "type": "WAIT", "wait_kind": "Supplier", "party_field": "vendor_ref", "pause_sla": true,
     "responsible": {"kind": "department_lead", "dept": "procurement", "fallback": {"kind": "role", "role": "procurement", "fallback": {"kind": "role", "role": "operations"}}}, "sla": {"amount": 10, "unit": "business_days"}},
    {"id": "receiving", "name": "Receiving", "type": "DATA", "receives": true, "responsible": {"kind": "department_lead", "dept": "operations", "fallback": {"kind": "role", "role": "operations", "fallback": {"kind": "role", "role": "procurement"}}},
     "record_status": "Receiving", "sla": {"amount": 3, "unit": "business_days"}, "on": {"success": "$complete"}}
   ]},
  {"code": "PAYMENT", "name": "Payment request", "category": "finance", "source_section": "finance.payments", "owner_role": "finance", "owner_department": "finance",
   "completion": {"completed": "Reconciled", "rejected": "Rejected", "cancelled": "Cancelled"},
   "description": "Request → review → approval → ready for payment → paid (recorded by Finance) → reconciled. Workspace moves no money.",
   "steps": [
    {"id": "request", "name": "Payment request", "type": "DATA", "responsible": {"kind": "requester"}, "fields": ["payee", "amount", "currency"], "record_status": "Requested", "sla": {"amount": 2, "unit": "business_days"}},
    {"id": "review", "name": "Finance review", "type": "REVIEW", "responsible": {"kind": "role", "role": "finance"}, "record_status": "Review", "sla": {"amount": 2, "unit": "business_days"}, "on": {"changes_requested": "request", "rejected": "$reject"}},
    {"id": "approval", "name": "Approval", "type": "APPROVAL", "policy": "PAYMENT", "record_status": "Approval", "sla": {"amount": 3, "unit": "business_days"}, "on": {"changes_requested": "request", "rejected": "$reject"}},
    {"id": "ready", "name": "Ready for payment", "type": "DATA", "responsible": {"kind": "role", "role": "finance"}, "record_status": "Ready for payment", "sla": {"amount": 3, "unit": "business_days"},
     "instructions": "Prepare the payment in the bank. Workspace moves no money and keeps no bank details."},
    {"id": "paid", "name": "Record the payment", "type": "DATA", "records_payment": true, "responsible": {"kind": "role", "role": "finance"}, "sla": {"amount": 5, "unit": "business_days"}},
    {"id": "reconcile", "name": "Reconcile with the bank statement", "type": "REVIEW", "responsible": {"kind": "role", "role": "finance"}, "sla": {"amount": 10, "unit": "business_days"}, "on": {"success": "$complete", "changes_requested": "paid"}}
   ]},
  {"code": "CONTRACT", "name": "Contract", "category": "legal", "source_section": "legal.contracts", "owner_role": "legal", "owner_department": "legal",
   "completion": {"completed": "Active", "rejected": "Rejected", "cancelled": "Cancelled"},
   "description": "Request → draft → internal review → counterparty review → approval of the exact version → signature (by people) → active.",
   "steps": [
    {"id": "request", "name": "Contract request", "type": "DATA", "responsible": {"kind": "requester"}, "fields": ["counterparty", "type"], "record_status": "Request"},
    {"id": "draft", "name": "Draft and link the document", "type": "TASK", "responsible": {"kind": "department_lead", "dept": "legal", "fallback": {"kind": "role", "role": "legal"}},
     "guard": {"field": "record.document_ref", "op": "present"}, "guard_message": "Link the contract document (Document Center) to the contract first", "record_status": "Drafting", "sla": {"amount": 5, "unit": "business_days"}},
    {"id": "internal_review", "name": "Internal review", "type": "REVIEW", "responsible": {"kind": "role", "role": "legal", "fallback": {"kind": "role", "role": "management"}}, "record_status": "Internal review", "sla": {"amount": 3, "unit": "business_days"},
     "on": {"changes_requested": "draft", "rejected": "$reject"}},
    {"id": "counterparty", "name": "Counterparty review", "type": "WAIT", "wait_kind": "Partner", "party_field": "counterparty", "pause_sla": true,
     "responsible": {"kind": "department_lead", "dept": "legal", "fallback": {"kind": "role", "role": "legal"}}, "record_status": "Counterparty review", "sla": {"amount": 10, "unit": "business_days"}},
    {"id": "approval", "name": "Approval of this version", "type": "APPROVAL", "policy": "CONTRACT", "record_status": "Approval", "sla": {"amount": 3, "unit": "business_days"}, "on": {"changes_requested": "draft", "rejected": "$reject"}},
    {"id": "signature", "name": "Signature", "type": "DATA", "fields": ["signed_on"], "responsible": {"kind": "department_lead", "dept": "legal", "fallback": {"kind": "role", "role": "legal"}},
     "guard": {"field": "facts.approval_current", "op": "eq", "value": true}, "guard_message": "The approval was given to another version of the document: approve the current version first",
     "record_status": "Signature", "sla": {"amount": 5, "unit": "business_days"}, "instructions": "Sign outside Workspace (Workspace signs nothing), then enter the signature date."},
    {"id": "obligations", "name": "Register the obligations", "type": "DATA", "responsible": {"kind": "department_lead", "dept": "legal", "fallback": {"kind": "role", "role": "legal"}},
     "sla": {"amount": 5, "unit": "business_days"}, "instructions": "Add the contract's obligations (or confirm the proposed ones). Each one is confirmed by a person.", "on": {"success": "$complete"}}
   ]},
  {"code": "ECR", "name": "Engineering change", "category": "engineering", "source_section": "technical.changes", "owner_role": "engineering", "owner_department": "engineering",
   "completion": {"completed": "Closed", "rejected": "Rejected", "cancelled": "Cancelled"},
   "description": "Request → impact review → technical review → approval → implementation → verification → documentation update → close.",
   "steps": [
    {"id": "request", "name": "Change request", "type": "DATA", "responsible": {"kind": "requester"}, "fields": ["reason"], "record_status": "Requested"},
    {"id": "impact", "name": "Impact review", "type": "DATA", "confirms_impact": true, "responsible": {"kind": "department_lead", "dept": "engineering", "fallback": {"kind": "role", "role": "engineering"}},
     "record_status": "Impact review", "sla": {"amount": 5, "unit": "business_days"}, "instructions": "Fill in the impact record (cost, schedule, configurations, documents, BOM, purchases, tests, certification notes) and confirm it."},
    {"id": "technical_review", "name": "Technical review", "type": "REVIEW", "responsible": {"kind": "role", "role": "engineering"}, "record_status": "Technical review", "sla": {"amount": 3, "unit": "business_days"},
     "on": {"changes_requested": "impact", "rejected": "$reject"}},
    {"id": "impact_check", "name": "Impact record confirmed", "type": "CHECK", "rule": {"field": "facts.impact_complete", "op": "eq", "value": true}, "guard_message": "Confirm the impact record before approval"},
    {"id": "approval", "name": "Approval", "type": "APPROVAL", "policy": "ECR", "record_status": "Approval", "sla": {"amount": 3, "unit": "business_days"}, "on": {"changes_requested": "impact", "rejected": "$reject"}},
    {"id": "implementation", "name": "Implementation", "type": "TASK", "responsible": {"kind": "department_lead", "dept": "engineering", "fallback": {"kind": "role", "role": "engineering"}}, "record_status": "Implementation",
     "sla": {"amount": 10, "unit": "business_days"}, "instructions": "Implement the approved change. Workspace changes no controlled baseline by itself."},
    {"id": "verification", "name": "Verification", "type": "REVIEW", "responsible": {"kind": "role", "role": "engineering"}, "record_status": "Verification", "sla": {"amount": 3, "unit": "business_days"},
     "on": {"changes_requested": "implementation", "rejected": "implementation"}},
    {"id": "doc_update", "name": "Update the controlled documents", "type": "TASK", "responsible": {"kind": "department_lead", "dept": "engineering", "fallback": {"kind": "role", "role": "engineering"}},
     "record_status": "Documentation update", "sla": {"amount": 5, "unit": "business_days"}, "on": {"success": "$complete"}}
   ]},
  {"code": "ISSUE", "name": "Issue", "category": "quality", "source_section": "company.issues", "owner_role": "management",
   "completion": {"completed": "Closed", "cancelled": "Cancelled"},
   "description": "Open → investigating → action required → verification → closed.",
   "steps": [
    {"id": "investigate", "name": "Investigate", "type": "TASK", "responsible": {"kind": "field", "field": "owner_id", "fallback": {"kind": "role", "role": "management"}}, "record_status": "Investigating", "sla": {"amount": 3, "unit": "business_days"}},
    {"id": "action", "name": "Corrective action", "type": "TASK", "responsible": {"kind": "field", "field": "owner_id", "fallback": {"kind": "role", "role": "management"}}, "record_status": "Action required", "sla": {"amount": 5, "unit": "business_days"}},
    {"id": "verify", "name": "Verify the fix", "type": "REVIEW", "responsible": {"kind": "department_lead", "fallback": {"kind": "role", "role": "management"}}, "record_status": "Verification", "sla": {"amount": 3, "unit": "business_days"},
     "allow_requester": true, "on": {"changes_requested": "action", "success": "$complete"}}
   ]},
  {"code": "TRAVEL", "name": "Travel or event request", "category": "travel", "source_section": "company.travel", "owner_role": "management",
   "completion": {"completed": "Closed", "rejected": "Rejected", "cancelled": "Cancelled"},
   "description": "Request → approval → planning → booked → ready → completed → expense. Bookings are made outside Workspace and recorded here.",
   "steps": [
    {"id": "request", "name": "Travel request", "type": "DATA", "responsible": {"kind": "requester"}, "fields": ["destination", "starts", "ends", "purpose", "est_cost", "currency"], "record_status": "Request"},
    {"id": "approval", "name": "Approval", "type": "APPROVAL", "policy": "TRAVEL", "record_status": "Approval", "sla": {"amount": 2, "unit": "business_days"}, "on": {"changes_requested": "request", "rejected": "$reject"}},
    {"id": "planning", "name": "Plan the trip", "type": "TASK", "responsible": {"kind": "requester"}, "record_status": "Planning"},
    {"id": "booked", "name": "Record the bookings", "type": "DATA", "fields": ["booking_refs"], "responsible": {"kind": "requester"}, "record_status": "Booked",
     "instructions": "Book through the usual channels, then record the booking references (no card details)."},
    {"id": "ready", "name": "Ready to travel", "type": "TASK", "responsible": {"kind": "requester"}, "record_status": "Ready", "instructions": "Check documents, visas and insurance."},
    {"id": "completed", "name": "Trip completed", "type": "DATA", "responsible": {"kind": "requester"}, "record_status": "Completed"},
    {"id": "expense", "name": "Submit the expense claim", "type": "TASK", "responsible": {"kind": "requester"}, "record_status": "Expense", "instructions": "Submit the costs under Finance → Expenses.", "on": {"success": "$complete"}}
   ]},
  {"code": "GENERAL", "name": "General request", "category": "general", "source_section": "company.requests", "owner_role": "management",
   "completion": {"completed": "Closed", "rejected": "Rejected", "cancelled": "Cancelled"},
   "description": "Triage → work → close.",
   "steps": [
    {"id": "triage", "name": "Triage", "type": "REVIEW", "responsible": {"kind": "field", "field": "handler_id", "fallback": {"kind": "role", "role": "management"}}, "record_status": "Triage", "sla": {"amount": 2, "unit": "business_days"},
     "on": {"rejected": "$reject"}},
    {"id": "work", "name": "Do the work", "type": "TASK", "responsible": {"kind": "field", "field": "handler_id", "fallback": {"kind": "role", "role": "management"}}, "record_status": "In progress", "on": {"success": "$complete"}}
   ]},
  {"code": "EXH-IDEX", "name": "Exhibition checklist — IDEX template", "category": "exhibition", "source_section": "marketing.events", "owner_role": "marketing", "template": true,
   "completion": {"completed": "Done", "cancelled": "Cancelled"},
   "description": "A checklist template for exhibiting (first template: IDEX). Copy it as a new version or a new process for another show.",
   "steps": [
    {"id": "booth", "name": "Booth space and contract", "type": "TASK", "responsible": {"kind": "field", "field": "owner_id", "fallback": {"kind": "role", "role": "marketing"}}, "record_status": "Preparing"},
    {"id": "shipping", "name": "Demo equipment shipping", "type": "TASK", "responsible": {"kind": "field", "field": "owner_id", "fallback": {"kind": "role", "role": "operations"}},
     "instructions": "Shipping of any equipment follows the export and end-user check of the build; nothing ships before it is Cleared."},
    {"id": "travel", "name": "Team travel requests", "type": "TASK", "responsible": {"kind": "field", "field": "owner_id", "fallback": {"kind": "role", "role": "marketing"}}},
    {"id": "materials", "name": "Approved booth materials", "type": "TASK", "responsible": {"kind": "field", "field": "owner_id", "fallback": {"kind": "role", "role": "marketing"}},
     "instructions": "Use materials that passed the compliance check."},
    {"id": "leads", "name": "Lead capture ready", "type": "TASK", "responsible": {"kind": "field", "field": "owner_id", "fallback": {"kind": "role", "role": "marketing"}}},
    {"id": "follow_up", "name": "Follow-up after the show", "type": "TASK", "responsible": {"kind": "field", "field": "owner_id", "fallback": {"kind": "role", "role": "sales"}}, "sla": {"amount": 5, "unit": "business_days"}, "on": {"success": "$complete"}}
   ]}
  ]$j$::jsonb;
  d jsonb; errs jsonb; nid uuid;
begin
  for d in select * from jsonb_array_elements(procedure_defs) loop
    if exists (select 1 from public.wf_definitions w where w.code = d->>'code') then continue; end if;
    errs := public.wf_validate(d);
    if jsonb_array_length(errs) > 0 then raise exception 'Starting definition % is not valid: %', d->>'code', errs; end if;
    insert into public.wf_definitions(code, version, name, description, category, source_section, owner_department, owner_role, steps, sla, completion, template, state, published_at)
    values (d->>'code', 1, d->>'name', d->>'description', d->>'category', d->>'source_section', d->>'owner_department', d->>'owner_role', d->'steps', d->'sla', d->'completion',
      coalesce((d->>'template')::boolean, false), 'published', now())
    returning id into nid;
    insert into public.wf_events(kind, to_state, detail) values ('definition_published', 'published', jsonb_build_object('definition', nid, 'code', d->>'code', 'version', 1, 'by', 'v23 starting configuration'));
  end loop;
end $$;

/* ---------------------------------------------------------------------------------------------
   21. Party directory: one organisation per name across vendors, clients, partners and agencies; each of those
       records gets party_ref. Nothing is moved or merged: the original records stay where they are.
   --------------------------------------------------------------------------------------------- */
insert into public.records(section, title, status, controlled, data)
select 'company.parties', min(r.title), 'Active', bool_or(r.controlled),
  jsonb_strip_nulls(jsonb_build_object('country', max(r.data->>'country'), 'backfilled', true, 'key', lower(regexp_replace(r.title, '\s+', ' ', 'g'))))
from public.records r
where r.section in ('operations.vendors', 'sales.clients', 'sales.partners', 'marketing.agencies') and coalesce(r.data->>'party_ref', '') = '' and trim(coalesce(r.title, '')) <> ''
  and not exists (select 1 from public.records p where p.section = 'company.parties' and p.data->>'key' = lower(regexp_replace(r.title, '\s+', ' ', 'g')))
group by lower(regexp_replace(r.title, '\s+', ' ', 'g'));
update public.records r set data = r.data || jsonb_build_object('party_ref', p.id, 'party_ref_title', p.title)
from public.records p
where r.section in ('operations.vendors', 'sales.clients', 'sales.partners', 'marketing.agencies') and coalesce(r.data->>'party_ref', '') = ''
  and p.section = 'company.parties' and p.data->>'key' = lower(regexp_replace(r.title, '\s+', ' ', 'g'));

/* ---------------------------------------------------------------------------------------------
   22. Settings changes (owners and administrators), approval policies (same), job grants
   --------------------------------------------------------------------------------------------- */
create or replace function public.ops_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return jsonb_build_object('value', public.ops_cfg(), 'version', (select version from public.ops_settings where id),
    'policies', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'section', p.section, 'active', p.active, 'tiers', p.tiers, 'version', p.version) order by p.code) from public.approval_policies p), '[]'::jsonb),
    'can_edit', exists (select 1 from public.profiles x where x.id = me and x.role in ('owner', 'admin')));
end $$;
revoke execute on function public.ops_settings_get() from public, anon;
grant execute on function public.ops_settings_get() to authenticated;

create or replace function public.ops_settings_save(p_value jsonb, p_version integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); cur public.ops_settings; k text;
begin
  if me is null or not exists (select 1 from public.profiles x where x.id = me and x.role in ('owner', 'admin')) then raise exception 'Only owners and administrators change these settings' using errcode = '42501'; end if;
  select * into cur from public.ops_settings where id for update;
  if cur.version <> p_version then raise exception 'The settings were changed by someone else; reload' using errcode = '40001'; end if;
  for k in select jsonb_object_keys(p_value) loop
    if k not in ('due_soon_hours', 'weekend', 'sla_pause_states', 'numbering', 'material', 'desks', 'request_types') then raise exception 'Unknown setting %', k using errcode = '22023'; end if;
  end loop;
  if p_value ? 'due_soon_hours' and (public._num(p_value->'due_soon_hours') is null or public._num(p_value->'due_soon_hours') not between 1 and 720) then raise exception 'Due soon must be 1–720 hours' using errcode = '22023'; end if;
  if p_value ? 'weekend' and exists (select 1 from jsonb_array_elements_text(p_value->'weekend') w where w !~ '^[1-7]$') then raise exception 'Weekend days are 1 (Monday) to 7 (Sunday)' using errcode = '22023'; end if;
  update public.ops_settings set value = value || p_value, version = version + 1, updated_at = now(), updated_by = me where id;
  insert into public.ops_settings_history(changed_by, before, after) values (me, cur.value, cur.value || p_value);
  return jsonb_build_object('ok', true, 'version', cur.version + 1);
end $$;
revoke execute on function public.ops_settings_save(jsonb, integer) from public, anon;
grant execute on function public.ops_settings_save(jsonb, integer) to authenticated;

create or replace function public.ops_policy_save(p_code text, p_name text, p_tiers jsonb, p_active boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); cur public.approval_policies; t jsonb; ap jsonb; e text;
begin
  if me is null or not exists (select 1 from public.profiles x where x.id = me and x.role in ('owner', 'admin')) then raise exception 'Only owners and administrators change approval authority' using errcode = '42501'; end if;
  if jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then raise exception 'Add at least one level' using errcode = '22023'; end if;
  for t in select * from jsonb_array_elements(p_tiers) loop
    e := public.wf_rule_error(t->'when'); if e is not null then raise exception 'Level condition: %', e using errcode = '22023'; end if;
    if coalesce(t->>'mode', 'sequential') not in ('sequential', 'parallel') then raise exception 'Mode is sequential or parallel' using errcode = '22023'; end if;
    if jsonb_array_length(coalesce(t->'steps', '[]')) = 0 then raise exception 'Each level needs approvers' using errcode = '22023'; end if;
    for ap in select * from jsonb_array_elements(t->'steps') loop
      if ap->>'kind' = 'requester' then raise exception 'The requester cannot approve their own request' using errcode = '22023'; end if;
      e := public._wf_resp_error(ap, 'Approver'); if e is not null then raise exception '%', e using errcode = '22023'; end if;
    end loop;
  end loop;
  select * into cur from public.approval_policies where code = p_code for update;
  if found then
    update public.approval_policies set name = coalesce(nullif(p_name, ''), name), tiers = p_tiers, active = p_active, version = version + 1, updated_at = now(), updated_by = me where code = p_code;
  else
    insert into public.approval_policies(code, name, tiers, active, updated_by) values (p_code, coalesce(nullif(p_name, ''), p_code), p_tiers, p_active, me);
  end if;
  insert into public.approval_policies_history(policy_code, changed_by, before, after) values (p_code, me, to_jsonb(cur), jsonb_build_object('name', p_name, 'tiers', p_tiers, 'active', p_active));
  insert into public.wf_events(actor, kind, to_state, detail) values (me, 'policy_changed', case when p_active then 'active' else 'off' end, jsonb_build_object('policy', p_code));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.ops_policy_save(text, text, jsonb, boolean) from public, anon;
grant execute on function public.ops_policy_save(text, text, jsonb, boolean) to authenticated;

-- the API re-reads the functions (the read models run read-write: they build temporary working sets)
notify pgrst, 'reload schema';

commit;
