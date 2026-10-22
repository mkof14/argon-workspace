-- AGRON Workspace — v24 (Phase 7: commercial operations — organisations, contacts, leads, opportunities, proposals,
-- follow-up, events, forecast, Assistant). Builds on v18–v23. One transaction; safe to run again; nothing is deleted.
--
-- No second CRM: the existing sections are the commercial records —
--   company.parties     the organisation (one per company, several relationship types)
--   company.contacts    people at those organisations (business records, never Workspace accounts)
--   marketing.leads     leads (event capture, business cards, QR, CSV, mail intake)
--   sales.pipeline      opportunities (configurable pipeline; numbered by the existing atomic numbering)
--   sales.proposals     proposals, one record per version; approval of the exact version through the v23 engine
--   sales.activities    calls, notes and emails;  sales.introductions  who introduced whom
--   company.meetings, company.tasks, company.decisions, legal.contracts (NDA) — linked by deal_ref
-- New tables hold only what records cannot: settings (+history), capabilities, the value and stage history
-- (append-only), import batches, export audit, e-mail link suggestions, merges and the commercial audit log.
-- Visibility is the v23 reading rule plus: a restricted opportunity (and what follows it) is seen by its owner,
-- team, the people added to it and management only. Every engine reads the records the viewer may open.
begin;

do $$ begin
  if to_regprocedure('public._ops_base(uuid,text[],boolean,boolean)') is null then raise exception 'Apply update-v23.sql first'; end if;
end $$;

/* ---------------------------------------------------------------------------------------------
   1. Access: the new section (introductions) and the generated rows; existing custom access is never overwritten
   --------------------------------------------------------------------------------------------- */
insert into public.section_access(section, role, can_write, external) values
  ('sales.introductions', 'management', true, false),
  ('sales.introductions', 'sales', true, false),
  ('sales.introductions', 'finance', false, false),
  ('sales.introductions', 'legal', false, false),
  ('sales.introductions', 'operations', false, false),
  ('marketing.leads', 'management', true, false)
on conflict do nothing;
-- management converts and assigns leads (the generated access.sql says so); remembered so the rollback can undo it
create temp table if not exists v24_flags (k text primary key) on commit drop;
do $$ begin
  if exists (select 1 from public.section_access where section = 'marketing.leads' and role = 'management' and not can_write) then
    update public.section_access set can_write = true where section = 'marketing.leads' and role = 'management';
    insert into pg_temp.v24_flags values ('leads_mgmt_write') on conflict do nothing;
  end if;
end $$;

/* ---------------------------------------------------------------------------------------------
   2. Commercial settings: one document (pipeline, catalogs, follow-up rules, health, capabilities policy),
      changed only with the Commercial Admin capability, every change kept
   --------------------------------------------------------------------------------------------- */
create table if not exists public.crm_settings (
  id boolean primary key default true check (id), value jsonb not null default '{}'::jsonb, version integer not null default 1,
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.crm_settings_history (
  id bigserial primary key, changed_at timestamptz not null default now(), changed_by uuid, before jsonb, after jsonb
);
alter table public.crm_settings enable row level security;
alter table public.crm_settings_history enable row level security;
revoke all on public.crm_settings, public.crm_settings_history from anon, authenticated;

-- starting values: every value is configurable (Commercial → Settings); names are catalog values, not logic
insert into public.crm_settings(id, value) values (true, $j${
  "pipeline": [
    {"stage": "New", "probability": 10, "kind": "open"},
    {"stage": "Qualified", "probability": 25, "kind": "open"},
    {"stage": "Discovery", "probability": 30, "kind": "open"},
    {"stage": "Technical", "probability": 35, "kind": "open"},
    {"stage": "NDA / Information Exchange", "probability": 40, "kind": "open"},
    {"stage": "Proposal", "probability": 50, "kind": "open", "required": ["party_ref", "owner_id", "product"], "requires_proposal": true},
    {"stage": "Negotiation", "probability": 75, "kind": "open"},
    {"stage": "Decision", "probability": 85, "kind": "open"},
    {"stage": "Won", "probability": 100, "kind": "won", "required": ["decision_evidence"]},
    {"stage": "Lost", "probability": 0, "kind": "lost", "required": ["lost_reason"]},
    {"stage": "On Hold", "kind": "hold", "required": ["hold_reason"]}
  ],
  "lost_reasons": ["No Budget", "No Decision", "Timing", "Product Fit", "Price", "Competitor", "Regulatory / Procurement", "Internal Decision", "Other"],
  "waiting_kinds": ["NDA", "Technical data", "Meeting confirmation", "Proposal response", "Procurement", "Customer decision", "Partner introduction", "Contract comments"],
  "geographies": ["USA", "UAE", "Middle East", "Europe", "Monaco", "Other"],
  "products": ["C20", "C40", "Sprinter", "StarDome", "AGRON 1", "Integrated Solution", "Other"],
  "use_cases": ["Superyacht", "Commercial Vessel", "Port", "Marina", "Private Island", "Critical Facility", "Mobile", "Other"],
  "relationship_types": ["Prospect", "Customer", "Partner", "Agent", "Distributor", "Integrator", "Vendor", "Contractor", "Advisor", "Government", "Authority", "Other"],
  "lead_sources": ["IDEX", "Monaco", "Website", "Referral", "Partner", "Agent", "Existing Relationship", "Direct Outreach", "Other"],
  "followup": {"no_interaction_days": 14, "proposal_no_response_days": 10, "nda_waiting_days": 14, "negotiation_stalled_days": 21,
               "meeting_no_next_step_days": 3, "waiting_long_days": 10, "due_soon_days": 2, "stage_age_days": 60, "meeting_soon_hours": 24, "proposal_expiry_days": 7},
  "management_caps": ["workflow_admin", "commercial_admin", "pricing_approver", "proposal_approver", "export_commercial"],
  "export_excluded_fields": ["access", "access_ids", "stage_exception", "decision_evidence", "lost_note", "value_reason"],
  "export_controlled": false,
  "active_event_ref": null,
  "config_status": "Draft"
}$j$::jsonb) on conflict (id) do nothing;
do $$ begin
  if exists (select 1 from pg_temp.v24_flags where k = 'leads_mgmt_write') then
    update public.crm_settings set value = value || '{"leads_mgmt_write_changed": true}'::jsonb where id;
  end if;
end $$;

create or replace function public.crm_cfg() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.crm_settings where id), '{}'::jsonb)
$$;
revoke execute on function public.crm_cfg() from public, anon, authenticated;

-- the v23 settings learn the proposal fields that make an approval stale, and the numbering of the new types
update public.ops_settings set value = jsonb_set(jsonb_set(value,
    '{material,sales.proposals}', coalesce(value->'material'->'sales.proposals', '["value", "currency", "discount", "qty", "unit_price", "valid_until", "payment_terms", "delivery", "config", "document_version_id"]'::jsonb), true),
    '{numbering}', coalesce(value->'numbering', '{}'::jsonb) || jsonb_build_object('sales.pipeline', coalesce(value->'numbering'->>'sales.pipeline', 'OPP'), 'sales.proposals', coalesce(value->'numbering'->>'sales.proposals', 'PRP')), true)
where id;
insert into public.doc_number_formats(scope, doc_type, pattern, company)
select 'ops', t, '{CO}-{TYPE}-{YEAR}-{SEQ:4}', 'AGR' from unnest(array['OPP', 'PRP']) t
where not exists (select 1 from public.doc_number_formats f where f.scope = 'ops' and f.doc_type = t);
create unique index if not exists records_opp_number_uq on public.records ((data->>'number')) where section = 'sales.pipeline' and data ? 'number';
-- a proposal keeps its number across versions; one record per (number, version)
create unique index if not exists records_prp_version_uq on public.records ((data->>'number'), ((data->>'version'))) where section = 'sales.proposals' and data ? 'number' and data ? 'version';

-- lookups the commercial engines make
create index if not exists records_deal_ref_idx on public.records ((data->>'deal_ref')) where data ? 'deal_ref';
create index if not exists records_contact_ref_idx on public.records ((data->>'contact_ref')) where data ? 'contact_ref';
create index if not exists records_crm_section_idx on public.records (section, status) where section in ('sales.pipeline', 'sales.proposals', 'sales.activities', 'sales.introductions', 'marketing.leads', 'company.contacts', 'company.parties');
create index if not exists records_crm_email_idx on public.records ((lower(data->>'email'))) where section in ('company.contacts', 'marketing.leads') and data ? 'email';
create index if not exists records_crm_event_idx on public.records ((data->>'event_ref')) where data ? 'event_ref';
create index if not exists records_crm_owner_idx on public.records ((data->>'owner_id')) where section in ('sales.pipeline', 'marketing.leads') and data ? 'owner_id';
create index if not exists records_crm_name_idx on public.records ((lower(regexp_replace(title, '[^[:alnum:]]+', '', 'g')))) where section in ('company.parties', 'company.contacts');

/* ---------------------------------------------------------------------------------------------
   3. Capabilities: business authority is given explicitly (System Administrator ≠ Commercial Admin)
      Owner: every capability. Management: the capabilities the policy names (settings → management_caps).
      Anyone else: only what an owner granted, one capability at a time; every grant and revoke is kept.
   --------------------------------------------------------------------------------------------- */
create table if not exists public.crm_caps (
  user_id uuid not null references public.profiles(id) on delete cascade,
  cap text not null check (cap in ('commercial_admin', 'workflow_admin', 'pricing_approver', 'proposal_approver', 'export_commercial')),
  granted_by uuid, granted_at timestamptz not null default now(), revoked_by uuid, revoked_at timestamptz,
  primary key (user_id, cap)
);
alter table public.crm_caps enable row level security;
revoke all on public.crm_caps from anon, authenticated;

-- one audit log for commercial actions that are not record changes (records keep their own history)
create table if not exists public.crm_audit (
  id bigserial primary key, at timestamptz not null default now(), actor uuid, kind text not null, record_id uuid, detail jsonb not null default '{}'::jsonb
);
create index if not exists crm_audit_kind_idx on public.crm_audit(kind, at desc);
create index if not exists crm_audit_record_idx on public.crm_audit(record_id, at desc);
alter table public.crm_audit enable row level security;
revoke all on public.crm_audit from anon, authenticated;
create or replace function public.crm_append_only() returns trigger language plpgsql as $$
begin raise exception 'This history cannot be changed or deleted' using errcode = '42501'; end $$;
drop trigger if exists crm_audit_guard on public.crm_audit;
create trigger crm_audit_guard before update or delete on public.crm_audit for each row execute function public.crm_append_only();

create or replace function public.has_cap(p_uid uuid, p_cap text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.role = 'owner' then true
      when exists (select 1 from public.crm_caps c where c.user_id = p.id and c.cap = p_cap and c.revoked_at is null) then true
      when p.role = 'management' and coalesce(public.crm_cfg()->'management_caps', '[]'::jsonb) ? p_cap then true
      else false end
    from public.profiles p where p.id = p_uid and not p.disabled), false)
$$;
revoke execute on function public.has_cap(uuid, text) from public, anon, authenticated;

create or replace function public.crm_viewer() returns uuid language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and public.session_ok() and public.is_active_employee(auth.uid()) then auth.uid() end
$$;
revoke execute on function public.crm_viewer() from public, anon, authenticated;

-- what the signed-in person may do (the screens show and hide their controls with this; the functions check again)
create or replace function public.crm_my_caps() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(c, public.has_cap(auth.uid(), c)), '{}'::jsonb)
  from unnest(array['commercial_admin', 'workflow_admin', 'pricing_approver', 'proposal_approver', 'export_commercial']) c
  where public.crm_viewer() is not null
$$;
revoke execute on function public.crm_my_caps() from public, anon;
grant execute on function public.crm_my_caps() to authenticated;

create or replace function public.crm_caps_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.crm_viewer();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'owner') and not public.has_cap(me, 'commercial_admin') then
    raise exception 'Only an owner or a Commercial Admin sees who holds business capabilities' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'grants', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', coalesce(nullif(p.full_name, ''), p.email), 'role', p.role, 'cap', c.cap,
        'granted_at', c.granted_at, 'granted_by', c.granted_by, 'revoked_at', c.revoked_at) order by p.full_name, c.cap)
      from public.crm_caps c join public.profiles p on p.id = c.user_id), '[]'::jsonb),
    'management_caps', coalesce(public.crm_cfg()->'management_caps', '[]'::jsonb),
    'note', 'Owners hold every capability. Management holds the capabilities the policy names. A System Administrator holds none unless an owner grants it.');
end $$;
revoke execute on function public.crm_caps_list() from public, anon;
grant execute on function public.crm_caps_list() to authenticated;

create or replace function public.crm_cap_set(p_user uuid, p_cap text, p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'owner') then raise exception 'Only an owner grants or removes business capabilities' using errcode = '42501'; end if;
  if p_cap not in ('commercial_admin', 'workflow_admin', 'pricing_approver', 'proposal_approver', 'export_commercial') then raise exception 'Unknown capability %', p_cap using errcode = '22023'; end if;
  if p_on and not public.is_active_employee(p_user) then raise exception 'Capabilities go to active employees only' using errcode = '23514'; end if;
  if p_on then
    insert into public.crm_caps(user_id, cap, granted_by) values (p_user, p_cap, me)
      on conflict (user_id, cap) do update set granted_by = me, granted_at = now(), revoked_at = null, revoked_by = null;
  else
    update public.crm_caps set revoked_at = now(), revoked_by = me where user_id = p_user and cap = p_cap and revoked_at is null;
  end if;
  insert into public.crm_audit(actor, kind, detail) values (me, case when p_on then 'cap_granted' else 'cap_revoked' end, jsonb_build_object('user', p_user, 'cap', p_cap));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.crm_cap_set(uuid, text, boolean) from public, anon;
grant execute on function public.crm_cap_set(uuid, text, boolean) to authenticated;

-- Phase 6 remediation: process definitions, process management and approval authority follow the Workflow Admin
-- capability (owners; management by policy; anyone an owner grants it) — no longer the System Administrator role.
create or replace function public._ops_admin(p_uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.has_cap(p_uid, 'workflow_admin')
$$;
revoke execute on function public._ops_admin(uuid) from public, anon, authenticated;

create or replace function public.crm_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); s public.crm_settings;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into s from public.crm_settings where id;
  return jsonb_build_object('value', s.value, 'version', s.version, 'updated_at', s.updated_at, 'can_edit', public.has_cap(me, 'commercial_admin'),
    'caps', public.crm_my_caps(),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.changed_at, 'by', coalesce(nullif(p.full_name, ''), p.email)) order by h.id desc)
      from (select * from public.crm_settings_history order by id desc limit 20) h left join public.profiles p on p.id = h.changed_by), '[]'::jsonb));
end $$;
revoke execute on function public.crm_settings_get() from public, anon;
grant execute on function public.crm_settings_get() to authenticated;

-- catalogs only (names for the forms): any active employee
create or replace function public.crm_catalogs() returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.crm_viewer() is null then null else jsonb_build_object(
    'pipeline', public.crm_cfg()->'pipeline', 'lost_reasons', public.crm_cfg()->'lost_reasons', 'waiting_kinds', public.crm_cfg()->'waiting_kinds',
    'geographies', public.crm_cfg()->'geographies', 'products', public.crm_cfg()->'products', 'use_cases', public.crm_cfg()->'use_cases',
    'relationship_types', public.crm_cfg()->'relationship_types', 'lead_sources', public.crm_cfg()->'lead_sources',
    'active_event_ref', public.crm_cfg()->'active_event_ref') end
$$;
revoke execute on function public.crm_catalogs() from public, anon;
grant execute on function public.crm_catalogs() to authenticated;

create or replace function public._crm_settings_error(v jsonb) returns text language plpgsql immutable as $$
declare st jsonb; seen text[] := '{}'; k text; n int := 0;
begin
  if jsonb_typeof(v->'pipeline') <> 'array' or jsonb_array_length(v->'pipeline') < 2 then return 'The pipeline needs at least two stages'; end if;
  for st in select * from jsonb_array_elements(v->'pipeline') loop
    if coalesce(trim(st->>'stage'), '') = '' or length(st->>'stage') > 60 then return 'Every stage needs a name (up to 60 characters)'; end if;
    if st->>'stage' = any(seen) then return 'Stage names must be different: ' || (st->>'stage'); end if;
    seen := seen || (st->>'stage');
    if coalesce(st->>'kind', 'open') not in ('open', 'won', 'lost', 'hold') then return 'A stage is open, won, lost or hold: ' || (st->>'stage'); end if;
    if st ? 'probability' and st->>'probability' is not null and not ((st->>'probability') ~ '^\d+(\.\d+)?$' and (st->>'probability')::numeric between 0 and 100) then return 'Probability is 0–100: ' || (st->>'stage'); end if;
    if st ? 'required' and jsonb_typeof(st->'required') <> 'array' then return 'Required fields are a list: ' || (st->>'stage'); end if;
    if coalesce(st->>'kind', 'open') = 'open' then n := n + 1; end if;
  end loop;
  if n = 0 then return 'At least one open stage is needed'; end if;
  if not exists (select 1 from jsonb_array_elements(v->'pipeline') s where s->>'kind' = 'won') then return 'One stage must be the Won stage'; end if;
  if not exists (select 1 from jsonb_array_elements(v->'pipeline') s where s->>'kind' = 'lost') then return 'One stage must be the Lost stage'; end if;
  foreach k in array array['lost_reasons', 'waiting_kinds', 'geographies', 'products', 'use_cases', 'relationship_types', 'lead_sources', 'management_caps', 'export_excluded_fields'] loop
    if v ? k and jsonb_typeof(v->k) <> 'array' then return k || ' must be a list'; end if;
  end loop;
  if v ? 'management_caps' and exists (select 1 from jsonb_array_elements_text(v->'management_caps') c where c not in ('commercial_admin', 'workflow_admin', 'pricing_approver', 'proposal_approver', 'export_commercial')) then
    return 'Unknown capability in management_caps';
  end if;
  if v ? 'followup' and (jsonb_typeof(v->'followup') <> 'object' or exists (select 1 from jsonb_each(v->'followup') e where jsonb_typeof(e.value) <> 'number' or (e.value)::text::numeric < 0 or (e.value)::text::numeric > 3650)) then
    return 'Follow-up periods are numbers of days or hours (0–3650)';
  end if;
  return null;
end $$;

create or replace function public.crm_settings_save(p_value jsonb, p_version integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); cur public.crm_settings; k text; nv jsonb; e text;
begin
  if me is null or not public.has_cap(me, 'commercial_admin') then raise exception 'Only a Commercial Admin changes the commercial settings' using errcode = '42501'; end if;
  select * into cur from public.crm_settings where id for update;
  if cur.version <> p_version then raise exception 'The settings were changed by someone else; reload' using errcode = '40001'; end if;
  for k in select jsonb_object_keys(p_value) loop
    if k not in ('pipeline', 'lost_reasons', 'waiting_kinds', 'geographies', 'products', 'use_cases', 'relationship_types', 'lead_sources', 'followup',
                 'management_caps', 'export_excluded_fields', 'export_controlled', 'active_event_ref') then raise exception 'Unknown setting %', k using errcode = '22023'; end if;
  end loop;
  -- the capability policy is the owners' decision
  if p_value ? 'management_caps' and (p_value->'management_caps') is distinct from (cur.value->'management_caps')
     and not exists (select 1 from public.profiles where id = me and role = 'owner') then
    raise exception 'Only an owner changes which capabilities management holds' using errcode = '42501';
  end if;
  if p_value ? 'active_event_ref' and p_value->>'active_event_ref' is not null
     and not exists (select 1 from public.records r where r.id = public.as_uuid(p_value->>'active_event_ref') and r.section = 'marketing.events') then
    raise exception 'The active event must be an event record (Marketing → Events)' using errcode = '22023';
  end if;
  nv := cur.value || p_value;
  e := public._crm_settings_error(nv); if e is not null then raise exception '%', e using errcode = '22023'; end if;
  update public.crm_settings set value = nv, version = version + 1, updated_at = now(), updated_by = me where id;
  insert into public.crm_settings_history(changed_by, before, after) values (me, cur.value, nv);
  return jsonb_build_object('ok', true, 'version', cur.version + 1);
end $$;
revoke execute on function public.crm_settings_save(jsonb, integer) from public, anon;
grant execute on function public.crm_settings_save(jsonb, integer) to authenticated;

/* ---------------------------------------------------------------------------------------------
   4. Approval policy hardening: seeded thresholds are UNAPPROVED DEFAULT CONFIGURATION until an owner or
      management (with the admin capability for that area) confirms them; every edit makes a new Draft version
   --------------------------------------------------------------------------------------------- */
alter table public.approval_policies add column if not exists config_status text not null default 'Draft';
alter table public.approval_policies add column if not exists seeded boolean not null default false;
alter table public.approval_policies add column if not exists approved_by uuid;
alter table public.approval_policies add column if not exists approved_at timestamptz;
alter table public.approval_policies add column if not exists approved_version integer;
alter table public.approval_policies drop constraint if exists approval_policies_config_status_check;
alter table public.approval_policies add constraint approval_policies_config_status_check check (config_status in ('Draft', 'Approved', 'Superseded'));
alter table public.approval_policies_history add column if not exists config_status text;
alter table public.approval_policies_history add column if not exists version integer;
-- the policies a migration created (v23 seeds, never confirmed) are marked as such, once
update public.approval_policies set seeded = true where updated_by is null and approved_by is null and not seeded and code in ('PURCHASE', 'PAYMENT', 'CONTRACT', 'ECR', 'TRAVEL');

-- which capability confirms a policy: the commercial ones by Commercial Admin, the operations ones by Workflow Admin
create or replace function public._policy_cap(p_code text, p_section text) returns text language sql immutable as $$
  select case when p_code like 'PROPOSAL%' or coalesce(p_section, '') like 'sales.%' then 'commercial_admin' else 'workflow_admin' end
$$;

create or replace function public.ops_policy_approve(p_code text, p_version integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); pol public.approval_policies; rl text;
begin
  select * into pol from public.approval_policies where code = p_code for update;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  select role into rl from public.profiles where id = me;
  if me is null or not (rl = 'owner' or (rl = 'management' and public.has_cap(me, public._policy_cap(pol.code, pol.section)))) then
    raise exception 'Only an owner or management confirms approval authority as AGRON policy' using errcode = '42501';
  end if;
  if pol.version <> p_version then raise exception 'The policy changed since you opened it (version %); review it again', pol.version using errcode = '40001'; end if;
  if pol.config_status = 'Approved' then return jsonb_build_object('ok', true, 'status', 'Approved', 'note', 'Already approved'); end if;
  insert into public.approval_policies_history(policy_code, changed_by, before, after, config_status, version)
    values (pol.code, me, to_jsonb(pol), jsonb_build_object('config_status', 'Approved', 'version', pol.version), 'Approved', pol.version);
  -- the version approved before (if any) is now superseded in the history
  insert into public.approval_policies_history(policy_code, changed_by, before, after, config_status, version)
    select pol.code, me, null, jsonb_build_object('superseded_by_version', pol.version), 'Superseded', pol.approved_version where pol.approved_version is not null and pol.approved_version <> pol.version;
  update public.approval_policies set config_status = 'Approved', approved_by = me, approved_at = now(), approved_version = version where code = p_code;
  insert into public.crm_audit(actor, kind, detail) values (me, 'policy_approved', jsonb_build_object('code', pol.code, 'version', pol.version));
  return jsonb_build_object('ok', true, 'status', 'Approved', 'version', pol.version);
end $$;
revoke execute on function public.ops_policy_approve(text, integer) from public, anon;
grant execute on function public.ops_policy_approve(text, integer) to authenticated;

-- v23 settings and policies: the Workflow Admin capability (not the administrator role) changes them
create or replace function public.ops_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); s public.ops_settings;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into s from public.ops_settings where id;
  return jsonb_build_object('value', s.value - 'parties_backfilled', 'version', s.version, 'updated_at', s.updated_at,
    'policies', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'section', p.section, 'active', p.active, 'tiers', p.tiers, 'version', p.version,
        'config_status', p.config_status, 'seeded', p.seeded, 'approved_at', p.approved_at, 'approved_by', (select coalesce(nullif(x.full_name, ''), x.email) from public.profiles x where x.id = p.approved_by),
        'label', case when p.config_status = 'Approved' then 'AGRON policy (approved)' else 'UNAPPROVED DEFAULT CONFIGURATION' end,
        'can_edit', public.has_cap(me, public._policy_cap(p.code, p.section)),
        'can_approve', (select x.role = 'owner' or (x.role = 'management' and public.has_cap(me, public._policy_cap(p.code, p.section))) from public.profiles x where x.id = me)) order by p.code)
      from public.approval_policies p), '[]'::jsonb),
    'can_edit', public.has_cap(me, 'workflow_admin'));
end $$;
revoke execute on function public.ops_settings_get() from public, anon;
grant execute on function public.ops_settings_get() to authenticated;

create or replace function public.ops_settings_save(p_value jsonb, p_version integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); cur public.ops_settings; k text;
begin
  if me is null or not public.has_cap(me, 'workflow_admin') then raise exception 'Only a Workflow Admin changes these settings (owners; management by policy; others when an owner grants it)' using errcode = '42501'; end if;
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

-- an edited policy is a new Draft version: it applies, but it is shown as unapproved until confirmed again
create or replace function public.ops_policy_save(p_code text, p_name text, p_tiers jsonb, p_active boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); cur public.approval_policies; t jsonb; ap jsonb; e text; sec text;
begin
  select * into cur from public.approval_policies where code = p_code for update;
  sec := coalesce(cur.section, case when p_code like 'PROPOSAL%' then 'sales.proposals' end);
  if me is null or not public.has_cap(me, public._policy_cap(p_code, sec)) then
    raise exception 'Only a % changes this approval authority', case when public._policy_cap(p_code, sec) = 'commercial_admin' then 'Commercial Admin' else 'Workflow Admin' end using errcode = '42501';
  end if;
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
  if found then
    update public.approval_policies set name = coalesce(nullif(p_name, ''), name), tiers = p_tiers, active = p_active, version = version + 1, updated_at = now(), updated_by = me,
      config_status = 'Draft', seeded = false where code = p_code;
  else
    insert into public.approval_policies(code, name, section, tiers, active, updated_by, config_status) values (p_code, coalesce(nullif(p_name, ''), p_code), sec, p_tiers, p_active, me, 'Draft');
  end if;
  insert into public.approval_policies_history(policy_code, changed_by, before, after, config_status, version)
    values (p_code, me, to_jsonb(cur), jsonb_build_object('name', p_name, 'tiers', p_tiers, 'active', p_active), 'Draft', coalesce(cur.version, 0) + 1);
  insert into public.wf_events(actor, kind, to_state, detail) values (me, 'policy_changed', case when p_active then 'active' else 'off' end, jsonb_build_object('policy', p_code, 'config_status', 'Draft'));
  return jsonb_build_object('ok', true, 'config_status', 'Draft');
end $$;
revoke execute on function public.ops_policy_save(text, text, jsonb, boolean) from public, anon;
grant execute on function public.ops_policy_save(text, text, jsonb, boolean) to authenticated;

-- an approver may also be "everyone holding a capability" (Proposal Approver, Pricing Approver)
create or replace function public._wf_resp_error(sp jsonb, what text) returns text language plpgsql stable security definer set search_path = public as $$
begin
  if sp is null or jsonb_typeof(sp) <> 'object' then return what || ': who is responsible is missing'; end if;
  if sp->>'kind' not in ('requester', 'role', 'department_lead', 'project_manager', 'workflow_owner', 'field', 'capability') then return what || ': unknown kind of responsible «' || coalesce(sp->>'kind', '') || '»'; end if;
  if sp->>'kind' = 'role' and not (sp->>'role' = any(public.wf_known_roles())) then return what || ': unknown role «' || coalesce(sp->>'role', '') || '»'; end if;
  if sp->>'kind' = 'capability' and coalesce(sp->>'cap', '') not in ('pricing_approver', 'proposal_approver', 'commercial_admin', 'workflow_admin') then return what || ': unknown capability «' || coalesce(sp->>'cap', '') || '»'; end if;
  if sp->>'kind' = 'department_lead' and sp ? 'dept' and not exists (select 1 from public.departments d where d.key = sp->>'dept') then return what || ': unknown department «' || coalesce(sp->>'dept', '') || '»'; end if;
  if sp->>'kind' = 'field' and coalesce(sp->>'field', '') !~ '^[a-z][a-z0-9_]{0,40}_id$' then return what || ': the person field must end in _id'; end if;
  if sp ? 'fallback' then return public._wf_resp_error(sp->'fallback', what || ' (fallback)'); end if;
  return null;
end $$;
revoke execute on function public._wf_resp_error(jsonb, text) from public, anon, authenticated;

-- the active employees holding a capability (owners, management by policy, explicit grants)
create or replace function public.crm_cap_holders(p_cap text) returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
  where not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending') and public.has_cap(p.id, p_cap)
  order by p.created_at desc limit 200
$$;
revoke execute on function public.crm_cap_holders(text) from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   5. History the records cannot hold: every commercial value and every stage change (append-only), import
      batches, e-mail link suggestions
   --------------------------------------------------------------------------------------------- */
create table if not exists public.crm_values (
  id bigserial primary key, record_id uuid not null, -- no foreign key: the history outlives a deleted record (trash restore)
  kind text not null check (kind in ('estimate', 'quoted', 'approved', 'negotiated', 'final')),
  amount numeric, currency text, prev_amount numeric, prev_currency text,
  actor uuid, at timestamptz not null default now(), reason text check (reason is null or length(reason) <= 500), source text, source_ref uuid
);
create index if not exists crm_values_record_idx on public.crm_values(record_id, at);
create table if not exists public.crm_stage_history (
  id bigserial primary key, record_id uuid not null,
  from_stage text, to_stage text, actor uuid, at timestamptz not null default now(), reason text, exception boolean not null default false
);
create index if not exists crm_stage_history_record_idx on public.crm_stage_history(record_id, at);
create table if not exists public.crm_imports (
  id uuid primary key default gen_random_uuid(), kind text not null check (kind in ('organizations', 'contacts', 'leads')),
  created_by uuid, created_at timestamptz not null default now(), file_name text, rows_total int, created int, linked int, skipped int,
  status text not null default 'imported' check (status in ('imported', 'rolled_back', 'partly_rolled_back')), rolled_back_at timestamptz, rolled_back_by uuid, report jsonb
);
create table if not exists public.crm_email_links (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  source_kind text not null check (source_kind in ('record', 'outbound', 'inbound')), source_id text not null,
  from_addr text, subject text, target_id uuid not null references public.records(id) on delete cascade, target_section text,
  why text, strength text check (strength in ('strong', 'likely')), status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  decided_by uuid, decided_at timestamptz, unique (source_kind, source_id, target_id)
);
create index if not exists crm_email_links_target_idx on public.crm_email_links(target_id, status);
do $$ declare t text; begin
  foreach t in array array['crm_values', 'crm_stage_history', 'crm_imports', 'crm_email_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
drop trigger if exists crm_values_guard on public.crm_values;
create trigger crm_values_guard before update or delete on public.crm_values for each row execute function public.crm_append_only();
drop trigger if exists crm_stage_history_guard on public.crm_stage_history;
create trigger crm_stage_history_guard before update or delete on public.crm_stage_history for each row execute function public.crm_append_only();

/* ---------------------------------------------------------------------------------------------
   6. Who may see a record — the v23 rule, plus: a restricted opportunity is seen by its owner, team, the people
      added to it, its next-action owner, owners and management; what follows an opportunity (proposals, calls and
      notes, introductions, meetings, decisions) is seen only by people who may see that opportunity or who are
      part of the record themselves. US-persons-only follows the links (the column, set at write time).
   --------------------------------------------------------------------------------------------- */
create or replace function public.crm_follow_sections() returns text[] language sql immutable as $$
  select array['sales.proposals', 'sales.activities', 'sales.introductions', 'company.meetings', 'company.decisions']
$$;

create or replace function public._crm_opp_ok(p_uid uuid, o public.records) returns boolean language plpgsql stable security definer set search_path = public as $$
declare rl text; me text := p_uid::text;
begin
  if not coalesce((o.data->>'restricted')::boolean, false) then return true; end if;
  if o.created_by = p_uid or coalesce(o.data->>'owner_id', '') = me or coalesce(o.data->>'next_action_owner_id', '') = me
     or coalesce(o.data->'team_ids', '[]'::jsonb) ? me or coalesce(o.data->'access_ids', '[]'::jsonb) ? me then return true; end if;
  select role into rl from public.profiles where id = p_uid;
  return coalesce(rl in ('owner', 'management'), false);
end $$;
revoke execute on function public._crm_opp_ok(uuid, public.records) from public, anon, authenticated;

create or replace function public._crm_follow_ok(p_uid uuid, r public.records) returns boolean language plpgsql stable security definer set search_path = public as $$
declare o public.records; me text := p_uid::text;
begin
  if coalesce(r.data->>'deal_ref', '') = '' then return true; end if;
  select * into o from public.records where id = public.as_uuid(r.data->>'deal_ref') and section = 'sales.pipeline';
  if not found or not coalesce((o.data->>'restricted')::boolean, false) then return true; end if;
  -- the people of this record itself
  if r.created_by = p_uid or coalesce(r.data->>'owner_id', '') = me or coalesce(r.data->>'organizer_id', '') = me
     or coalesce(r.data->'participants_ids', '[]'::jsonb) ? me then return true; end if;
  return public._crm_opp_ok(p_uid, o);
end $$;
revoke execute on function public._crm_follow_ok(uuid, public.records) from public, anon, authenticated;

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
  elsif r.section = 'company.decisions' then
    if not public._crm_follow_ok(p_uid, r) then return false; end if;
    if coalesce(r.data->>'source_ref', '') ~ '^[0-9a-f-]{36}$' then
      return not exists (select 1 from public.records s where s.id = (r.data->>'source_ref')::uuid)
        or exists (select 1 from public.records s where s.id = (r.data->>'source_ref')::uuid and public.record_visible_for(p_uid, s));
    end if;
    return true;
  elsif r.section in ('operations.requests', 'finance.payments', 'company.travel', 'company.requests') then
    return public.ops_involved(p_uid, r);
  elsif r.section = 'sales.pipeline' then
    return public._crm_opp_ok(p_uid, r);
  elsif r.section in ('sales.proposals', 'sales.activities', 'sales.introductions', 'company.meetings') then
    return public._crm_follow_ok(p_uid, r);
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
  if r.section in ('company.announcements', 'company.documents', 'company.wiki', 'company.decisions', 'operations.requests', 'finance.payments', 'company.travel', 'company.requests',
                   'sales.pipeline', 'sales.proposals', 'sales.activities', 'sales.introductions', 'company.meetings') then return coalesce(public.extra_visible(me, r), false); end if;
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
  if r.section in ('company.announcements', 'company.documents', 'company.wiki', 'company.decisions', 'operations.requests', 'finance.payments', 'company.travel', 'company.requests',
                   'sales.pipeline', 'sales.proposals', 'sales.activities', 'sales.introductions', 'company.meetings') then return coalesce(public.extra_visible(p_user, r), false); end if;
  return true;
end $$;
revoke execute on function public.record_visible_for(uuid, public.records) from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   7. Earlier functions with the Phase 7 additions (generated from v21–v23; only the marked parts differ)
   --------------------------------------------------------------------------------------------- */
-- v22 working-set rule + v24: meetings and decisions of a restricted opportunity follow it
create or replace function public.mgmt_visible(p_viewer uuid) returns setof public.records
language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off rows 20000 as $$
declare p record; secs text[]; restricted text[];
begin
  select pp.id, pp.role, coalesce(pp.us_person, false) us into p from public.profiles pp where pp.id = p_viewer and not pp.disabled;
  if not found or p.role is null or p.role in ('partner', 'vendor', 'investor', 'pending') then return; end if;
  select coalesce(array_agg(a.section), '{}') into secs from public.section_access a where a.role = p.role;
  select coalesce(array_agg(t.code), '{}') into restricted from public.taxonomy t where t.kind = 'classification' and coalesce((t.meta->>'restricted')::boolean, false);
  return query
  select r.* from public.records r
  where r.section in ('company.projects', 'company.tasks', 'company.milestones', 'company.decisions', 'company.documents', 'company.meetings', 'company.portfolios')
    and (p.role in ('owner', 'admin') or r.section = any(secs))
    and (coalesce(r.controlled, true) = false or p.us)
    and case
      when r.section = 'company.documents' then
        p.id = r.created_by or coalesce(r.data->>'owner_id', '') = p.id::text or coalesce(r.data->>'reviewer_id', '') = p.id::text
        or not coalesce(r.data->>'classification' = any(restricted), false)
        or coalesce(r.data->'access_ids', '[]'::jsonb) ? p.id::text or coalesce(r.data->'contributors_ids', '[]'::jsonb) ? p.id::text
        or p.role in ('owner', 'management')
      when r.section in ('company.meetings', 'company.decisions') and coalesce(r.data->>'deal_ref', '') <> '' then coalesce(public.extra_visible(p.id, r), false)
      when r.section = 'company.decisions' and coalesce(r.data->>'source_ref', '') ~ '^[0-9a-f-]{36}$' then coalesce(public.extra_visible(p.id, r), false)
      else true end;
end $$;

-- same rule in the per-statement working set
create or replace function public._mgmt_base(p_viewer uuid) returns void
language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off set default_statistics_target = 25 as $$
declare p record; secs text[]; restricted text[];
begin
  if to_regclass('pg_temp.mgmt_meta') is null then
    create temp table mgmt_meta (viewer uuid, at timestamptz, health boolean not null default false, loops boolean not null default false) on commit drop;
    create temp table mgmt_v (like public.records) on commit drop;
    alter table pg_temp.mgmt_v add column m_project uuid, add column m_assignee uuid, add column m_owner uuid, add column m_responsible uuid, add column m_manager uuid, add column m_reviewer uuid, add column m_requested_by uuid, add column m_organizer uuid, add column m_blocked_by uuid, add column m_portfolio uuid, add column m_made_by uuid, add column m_due date, add column m_date date, add column m_target date, add column m_review_due date, add column m_review_date date, add column m_reconsider date, add column m_expiration_date date, add column m_start date;
  end if;
  if exists (select 1 from pg_temp.mgmt_meta m where m.viewer is not distinct from p_viewer and m.at = statement_timestamp()) then return; end if;
  truncate pg_temp.mgmt_v; delete from pg_temp.mgmt_meta;
  -- the fields the engines join and filter on, read from the record once (as_uuid / mgmt_date semantics, inline)
  select pp.id, pp.role, coalesce(pp.us_person, false) us into p from public.profiles pp where pp.id = p_viewer and not pp.disabled;
  if found and p.role is not null and p.role not in ('partner', 'vendor', 'investor', 'pending') then
    select coalesce(array_agg(a.section), '{}') into secs from public.section_access a where a.role = p.role;
    select coalesce(array_agg(t.code), '{}') into restricted from public.taxonomy t where t.kind = 'classification' and coalesce((t.meta->>'restricted')::boolean, false);
    -- exactly the rule of mgmt_visible (tested to equal row-level security), written inline so no row is copied twice
    insert into pg_temp.mgmt_v select r.*,
      case when r.data->>'project_ref' like '________-____-____-____-____________' and length(replace(r.data->>'project_ref', '-', '')) = 32 and r.data->>'project_ref' ~ '^[-0-9a-fA-F]+$' then (r.data->>'project_ref')::uuid end,
      case when r.data->>'assignee_id' like '________-____-____-____-____________' and length(replace(r.data->>'assignee_id', '-', '')) = 32 and r.data->>'assignee_id' ~ '^[-0-9a-fA-F]+$' then (r.data->>'assignee_id')::uuid end,
      case when r.data->>'owner_id' like '________-____-____-____-____________' and length(replace(r.data->>'owner_id', '-', '')) = 32 and r.data->>'owner_id' ~ '^[-0-9a-fA-F]+$' then (r.data->>'owner_id')::uuid end,
      case when r.data->>'responsible_id' like '________-____-____-____-____________' and length(replace(r.data->>'responsible_id', '-', '')) = 32 and r.data->>'responsible_id' ~ '^[-0-9a-fA-F]+$' then (r.data->>'responsible_id')::uuid end,
      case when r.data->>'manager_id' like '________-____-____-____-____________' and length(replace(r.data->>'manager_id', '-', '')) = 32 and r.data->>'manager_id' ~ '^[-0-9a-fA-F]+$' then (r.data->>'manager_id')::uuid end,
      case when r.data->>'reviewer_id' like '________-____-____-____-____________' and length(replace(r.data->>'reviewer_id', '-', '')) = 32 and r.data->>'reviewer_id' ~ '^[-0-9a-fA-F]+$' then (r.data->>'reviewer_id')::uuid end,
      case when r.data->>'requested_by' like '________-____-____-____-____________' and length(replace(r.data->>'requested_by', '-', '')) = 32 and r.data->>'requested_by' ~ '^[-0-9a-fA-F]+$' then (r.data->>'requested_by')::uuid end,
      case when r.data->>'organizer_id' like '________-____-____-____-____________' and length(replace(r.data->>'organizer_id', '-', '')) = 32 and r.data->>'organizer_id' ~ '^[-0-9a-fA-F]+$' then (r.data->>'organizer_id')::uuid end,
      case when r.data->>'blocked_by' like '________-____-____-____-____________' and length(replace(r.data->>'blocked_by', '-', '')) = 32 and r.data->>'blocked_by' ~ '^[-0-9a-fA-F]+$' then (r.data->>'blocked_by')::uuid end,
      case when r.data->>'portfolio_ref' like '________-____-____-____-____________' and length(replace(r.data->>'portfolio_ref', '-', '')) = 32 and r.data->>'portfolio_ref' ~ '^[-0-9a-fA-F]+$' then (r.data->>'portfolio_ref')::uuid end,
      case when r.data->>'made_by_id' like '________-____-____-____-____________' and length(replace(r.data->>'made_by_id', '-', '')) = 32 and r.data->>'made_by_id' ~ '^[-0-9a-fA-F]+$' then (r.data->>'made_by_id')::uuid end,
      case when r.data->>'due' ~ '^\d{4}-\d{2}-\d{2}' then left(r.data->>'due', 10)::date end,
      case when r.data->>'date' ~ '^\d{4}-\d{2}-\d{2}' then left(r.data->>'date', 10)::date end,
      case when r.data->>'target' ~ '^\d{4}-\d{2}-\d{2}' then left(r.data->>'target', 10)::date end,
      case when r.data->>'review_due' ~ '^\d{4}-\d{2}-\d{2}' then left(r.data->>'review_due', 10)::date end,
      case when r.data->>'review_date' ~ '^\d{4}-\d{2}-\d{2}' then left(r.data->>'review_date', 10)::date end,
      case when r.data->>'reconsider' ~ '^\d{4}-\d{2}-\d{2}' then left(r.data->>'reconsider', 10)::date end,
      case when r.data->>'expiration_date' ~ '^\d{4}-\d{2}-\d{2}' then left(r.data->>'expiration_date', 10)::date end,
      case when r.data->>'start' ~ '^\d{4}-\d{2}-\d{2}' then left(r.data->>'start', 10)::date end
    from public.records r
    where r.section in ('company.projects', 'company.tasks', 'company.milestones', 'company.decisions', 'company.documents', 'company.meetings', 'company.portfolios')
      and (p.role in ('owner', 'admin') or r.section = any(secs))
      and (coalesce(r.controlled, true) = false or p.us)
      and case
        when r.section = 'company.documents' then
          p.id = r.created_by or coalesce(r.data->>'owner_id', '') = p.id::text or coalesce(r.data->>'reviewer_id', '') = p.id::text
          or not coalesce(r.data->>'classification' = any(restricted), false)
          or coalesce(r.data->'access_ids', '[]'::jsonb) ? p.id::text or coalesce(r.data->'contributors_ids', '[]'::jsonb) ? p.id::text
          or p.role in ('owner', 'management')
        when r.section in ('company.meetings', 'company.decisions') and coalesce(r.data->>'deal_ref', '') <> '' then coalesce(public.extra_visible(p.id, r), false)
        when r.section = 'company.decisions' and coalesce(r.data->>'source_ref', '') ~ '^[0-9a-f-]{36}$' then coalesce(public.extra_visible(p.id, r), false)
        else true end
      -- a draft or archived document with no date and no open approval takes part in no engine: not copied
      and not (r.section = 'company.documents' and r.status in ('Draft', 'Archived')
               and coalesce(r.data->>'expiration_date', r.data->>'review_date', r.data->>'review_due', '') = ''
               and not exists (select 1 from public.approvals a where a.record_id = r.id and a.status in ('pending', 'queued')));
  end if;
  analyze pg_temp.mgmt_v (id, section, status, created_by, controlled, m_project, m_assignee, m_manager, m_owner, m_blocked_by, m_portfolio, m_due, m_target);
  insert into pg_temp.mgmt_meta(viewer, at) values (p_viewer, statement_timestamp());
end $$;

-- v23 approval levels + v24: an approver can be the holders of a capability
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
    elsif ap->>'kind' = 'capability' then
      -- v24: the active holders of a business capability who may open the record, never the requester
      cand := array(select h from public.crm_cap_holders(ap->>'cap') h where h is distinct from i.requester and public._wf_could_see(h, r) limit 25);
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

-- v23 facts + v24: proposals
create or replace function public._wf_facts(p_inst uuid, r public.records) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := '{}'::jsonb; q int; amt numeric; rem numeric; v text; tot numeric; got numeric; anyr boolean; q2 text; q3 text;
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
    f := f || jsonb_build_object('documents', case when v is not null then 1 else 0 end, 'document_version', v, 'obligations', q, 'amount', public._num(r.data->'amount'), 'currency', r.data->>'currency');
  elsif r.section = 'technical.changes' then
    f := f || jsonb_build_object('impact_complete', coalesce(r.data->>'impact_confirmed_at', '') <> '', 'amount', public._num(r.data->'impact_cost'));
  elsif r.section = 'sales.proposals' then
    select o.data->>'product', o.data->>'geography', o.data->>'use_case' into v, q2, q3 from public.records o where o.id = public.as_uuid(r.data->>'deal_ref');
    f := f || jsonb_build_object('amount', public._num(r.data->'value'), 'currency', r.data->>'currency', 'discount', coalesce(public._num(r.data->'discount'), 0),
      'product', v, 'geography', q2, 'use_case', q3, 'margin', public._num(r.data->'margin'), 'terms', r.data->>'payment_terms');
  elsif r.section = 'company.travel' then
    f := f || jsonb_build_object('amount', public._num(r.data->'est_cost'), 'currency', r.data->>'currency');
  else
    f := f || jsonb_build_object('amount', public._num(r.data->'amount'), 'currency', r.data->>'currency');
  end if;
  return f;
end $$;

-- v23 definitions + v24: the Workflow Admin capability (through _ops_admin), not the administrator role
create or replace function public.wf_definition_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); d public.wf_definitions; v int;
begin
  if me is null or not public._ops_admin(me) then raise exception 'Only a Workflow Admin edit processes (owners; management by policy; others when an owner grants it)' using errcode = '42501'; end if;
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

-- v23 definitions + v24: the Workflow Admin capability (through _ops_admin), not the administrator role
create or replace function public.wf_definition_publish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); d public.wf_definitions; errs jsonb;
begin
  if me is null or not public._ops_admin(me) then raise exception 'Only a Workflow Admin publish processes (owners; management by policy; others when an owner grants it)' using errcode = '42501'; end if;
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

-- v23 definitions + v24: the Workflow Admin capability (through _ops_admin), not the administrator role
create or replace function public.wf_definition_new_version(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); d public.wf_definitions; n public.wf_definitions;
begin
  if me is null or not public._ops_admin(me) then raise exception 'Only a Workflow Admin edit processes (owners; management by policy; others when an owner grants it)' using errcode = '42501'; end if;
  if exists (select 1 from public.wf_definitions where code = p_code and state = 'draft') then raise exception 'There is already a draft of this process' using errcode = '23505'; end if;
  select * into d from public.wf_definitions where code = p_code order by version desc limit 1;
  if not found then raise exception 'Process not found'; end if;
  insert into public.wf_definitions(code, version, name, description, category, source_section, owner_department, owner_role, workflow_owner, start_rule, required_roles, required_documents, steps, sla, notifications, completion, template, created_by)
  values (d.code, d.version + 1, d.name, d.description, d.category, d.source_section, d.owner_department, d.owner_role, d.workflow_owner, d.start_rule, d.required_roles, d.required_documents, d.steps, d.sla, d.notifications, d.completion, d.template, me)
  returning * into n;
  perform public._wf_event(null, null, me, 'definition_versioned', null, null, 'draft', jsonb_build_object('definition', n.id, 'code', n.code, 'version', n.version, 'from', d.version));
  return jsonb_build_object('id', n.id, 'version', n.version);
end $$;

-- v23 definitions + v24: the Workflow Admin capability (through _ops_admin), not the administrator role
create or replace function public.wf_definition_disable(p_code text, p_on boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ops_viewer(); d public.wf_definitions;
begin
  if me is null or not public._ops_admin(me) then raise exception 'Only a Workflow Admin change processes (owners; management by policy; others when an owner grants it)' using errcode = '42501'; end if;
  select * into d from public.wf_definitions where code = p_code and state = case when p_on then 'disabled' else 'published' end for update;
  if not found then raise exception 'No % version of this process', case when p_on then 'disabled' else 'published' end; end if;
  update public.wf_definitions set state = case when p_on then 'published' else 'disabled' end, disabled_at = case when p_on then null else now() end where id = d.id;
  perform public._wf_event(null, null, me, case when p_on then 'definition_enabled' else 'definition_disabled' end, null, d.state, case when p_on then 'published' else 'disabled' end, jsonb_build_object('definition', d.id, 'code', d.code, 'version', d.version));
  return jsonb_build_object('ok', true);
end $$;

-- v21 search + v24: commercial records
create or replace function public.corp_search(p_q text, p_types text[] default null, p_project uuid default null, p_department text default null, p_person uuid default null,
  p_doc_type text default null, p_from date default null, p_to date default null, p_classification text default null, p_status text default null, p_limit integer default 40)
returns table (kind text, id uuid, record_id uuid, section text, title text, excerpt text, project_ref text, version text, owner_id text, updated_at timestamptz, link text, rank real)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := auth.uid(); pr public.profiles; q text := lower(trim(coalesce(p_q, ''))); w1 text; tsq tsquery; lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  sec_kind jsonb := '{"company.documents":"document","company.wiki":"knowledge","company.projects":"project","company.tasks":"task","company.meetings":"meeting","company.decisions":"decision","company.announcements":"announcement","company.milestones":"milestone","company.parties":"organization","company.contacts":"contact","sales.pipeline":"opportunity","sales.proposals":"proposal","marketing.leads":"lead","sales.introductions":"introduction","sales.partners":"partner"}';
begin
  if me is null or not public.session_ok() or length(q) < 2 then return; end if;
  select * into pr from public.profiles where id = me and not disabled; if not found then return; end if;
  w1 := replace(replace(replace(split_part(q, ' ', 1), '\', '\\'), '%', '\%'), '_', '\_');
  begin tsq := plainto_tsquery('simple', q); exception when others then tsq := null; end;
  return query
  with rec as (
    select r.*, sec_kind->>r.section k from public.records r
    where lower(r.title || ' ' || coalesce(r.data->>'doc_number', '') || ' ' || coalesce(r.data->>'description', '') || ' ' || coalesce(r.data->>'summary', '') || ' ' || coalesce(r.data->>'body', '') || ' ' || coalesce(r.data->>'decision', '') || ' ' || coalesce(r.data->>'notes', '') || ' ' || coalesce(r.data->>'tags', '')) like '%' || w1 || '%'
      and (p_types is null or (sec_kind->>r.section) = any(p_types) or (r.section not in (select jsonb_object_keys(sec_kind)) and 'record' = any(p_types)))
      and (p_project is null or r.id = p_project or r.data->>'project_ref' = p_project::text)
      and (p_department is null or r.data->>'department' = p_department)
      and (p_person is null or r.created_by = p_person or p_person::text in (r.data->>'owner_id', r.data->>'assignee_id', r.data->>'organizer_id', r.data->>'manager_id', r.data->>'made_by_id', r.data->>'responsible_id'))
      and (p_doc_type is null or r.data->>'doc_type' = p_doc_type)
      and (p_classification is null or r.data->>'classification' = p_classification)
      and (p_status is null or r.status = p_status)
      and (p_from is null or r.updated_at >= p_from) and (p_to is null or r.updated_at < p_to + 1)
      -- knowledge: the current article, not the one it replaced (unless asked for that status)
      and (r.section <> 'company.wiki' or p_status is not null or coalesce(r.status, 'Published') not in ('Superseded', 'Archived'))
      and r.section not in ('company.parties', 'company.contacts', 'sales.pipeline', 'sales.proposals', 'marketing.leads', 'sales.introductions', 'sales.partners')
    order by (lower(r.title) like '%' || q || '%') desc, r.updated_at desc
    limit 400
  ), crm as (
    -- v24: commercial records by name, e-mail, phone, number, organisation, aliases and tags (own trigram index)
    select r.*, sec_kind->>r.section k from public.records r
    where r.section in ('company.parties', 'company.contacts', 'sales.pipeline', 'sales.proposals', 'marketing.leads', 'sales.introductions', 'sales.partners')
      and public.crm_search_text(r.title, r.data) like '%' || w1 || '%'
      and (p_types is null or (sec_kind->>r.section) = any(p_types) or ('partner' = any(p_types) and r.section = 'company.parties' and coalesce(r.data->'relationship_types', '[]'::jsonb) ?| array['Partner', 'Agent', 'Distributor', 'Integrator']))
      and (p_status is null or r.status = p_status) and (p_from is null or r.updated_at >= p_from) and (p_to is null or r.updated_at < p_to + 1)
      and (p_person is null or r.created_by = p_person or p_person::text = r.data->>'owner_id')
      and p_project is null and p_department is null and p_doc_type is null and p_classification is null
    order by (lower(r.title) like '%' || q || '%') desc, r.updated_at desc
    limit 400
  ), recv as (select x.* from rec x join public.records rr on rr.id = x.id where public.record_visible(rr)
      and not exists (select 1 from unnest(string_to_array(q, ' ')) w where w <> '' and position(w in lower(x.title || ' ' || coalesce(x.data::text, ''))) = 0)
    limit lim),
  crmv as (select x.* from crm x join public.records rr on rr.id = x.id where public.record_visible(rr)
      and not exists (select 1 from unnest(string_to_array(q, ' ')) w where w <> '' and position(w in public.crm_search_text(x.title, x.data)) = 0)
    limit lim),
  pcand as materialized (
    -- the best-ranked matching pages first (full-text index), the reading rules only for those
    select p.record_id, p.path, p.page, p.content, ts_rank(p.tsv, tsq) rk
    from public.doc_pages p
    where tsq is not null and (p_types is null or 'document_text' = any(p_types) or 'document' = any(p_types)) and p.tsv @@ tsq
    order by rk desc limit 1000
  ), pages as (
    select p.record_id, p.path, p.page, p.content, p.rk, r2.title rtitle, r2.section rsection, r2.data rdata, r2.updated_at rupd
    from pcand p join public.records r2 on r2.id = p.record_id
    where (p_project is null or r2.data->>'project_ref' = p_project::text) and (p_doc_type is null or r2.data->>'doc_type' = p_doc_type)
      and (p_classification is null or r2.data->>'classification' = p_classification)
      -- the other filters apply to text found inside files too (the record's own status, department, people, dates)
      and (p_status is null or r2.status = p_status) and (p_department is null or r2.data->>'department' = p_department)
      and (p_person is null or r2.created_by = p_person or p_person::text in (r2.data->>'owner_id', r2.data->>'assignee_id', r2.data->>'organizer_id'))
      and (p_from is null or r2.updated_at >= p_from) and (p_to is null or r2.updated_at < p_to + 1)
      and public.record_visible(r2)
    order by p.rk desc limit lim
  )
  select coalesce(x.k, 'record'), x.id, x.id, x.section, x.title,
         left(coalesce(nullif(x.data->>'summary', ''), nullif(x.data->>'description', ''), nullif(left(regexp_replace(coalesce(x.data->>'body', x.data->>'decision', x.data->>'notes', ''), '[#*_>`]', '', 'g'), 220), ''), x.data->>'doc_type', x.status, ''), 220),
         coalesce(case when x.section = 'company.projects' then x.id::text end, x.data->>'project_ref'), x.data->>'version',
         coalesce(x.data->>'owner_id', x.data->>'assignee_id', x.data->>'organizer_id', x.data->>'manager_id', x.created_by::text), x.updated_at,
         case when x.section = 'company.projects' then '/projects/' || x.id when x.section = 'company.documents' then '/documents?d=' || x.id when x.section = 'company.wiki' then '/knowledge?a=' || x.id
              else '/' || replace(x.section, '.', '/') || '?r=' || x.id end,
         (case when lower(x.title) like '%' || q || '%' then 2 else 1 end)::real
  from recv x
  union all
  select x.k, x.id, x.id, x.section, x.title,
         left(concat_ws(' · ', x.status, x.data->>'number', nullif(x.data->>'party_ref_title', ''), nullif(x.data->>'organization', ''), nullif(x.data->>'email', ''), nullif(x.data->>'phone', ''), nullif(x.data->>'country', '')), 220),
         x.data->>'project_ref', x.data->>'version', coalesce(x.data->>'owner_id', x.created_by::text), x.updated_at,
         case x.section when 'company.parties' then '/crm?org=' || x.id when 'company.contacts' then '/crm?contact=' || x.id when 'sales.pipeline' then '/crm?opp=' || x.id
              when 'marketing.leads' then '/crm?lead=' || x.id else '/' || replace(x.section, '.', '/') || '?r=' || x.id end,
         (case when lower(x.title) like '%' || q || '%' or lower(coalesce(x.data->>'number', '')) = q or lower(coalesce(x.data->>'email', '')) = q then 2 else 1 end)::real
  from crmv x
  union all
  select 'document_text', pg.record_id, pg.record_id, pg.rsection, pg.rtitle,
         left(ts_headline('simple', pg.content, tsq, 'MaxWords=30, MinWords=12, StartSel=«, StopSel=», MaxFragments=1'), 260),
         pg.rdata->>'project_ref', pg.rdata->>'version', pg.rdata->>'owner_id', pg.rupd,
         case when pg.rsection = 'company.documents' then '/documents?d=' || pg.record_id else '/' || replace(pg.rsection, '.', '/') || '?r=' || pg.record_id end || '&page=' || pg.page, pg.rk
  from pages pg
  union all
  select 'discussion', m.id, m.record_id, m.section, m.title, m.excerpt, m.project_ref, null, m.author::text, m.created_at,
         case when m.section = 'company.projects' then '/projects/' || m.record_id || '?tab=discussion#c-' || m.id else '/' || replace(m.section, '.', '/') || '?r=' || m.record_id || '#c-' || m.id end, 0.5::real
  from public.search_messages(p_q, p_project, p_person, p_from, p_to, null, false, false, lim) m
  where p_types is null or 'discussion' = any(p_types)
  union all
  select 'person', p.id, null, null, coalesce(nullif(p.full_name, ''), p.email), concat_ws(' · ', p.title, d.name), null, null, null, null, '/people?q=' || coalesce(nullif(p.full_name, ''), p.email), 0.8::real
  from public.profiles p left join public.departments d on d.id = p.department_id
  where (p_types is null or 'person' = any(p_types)) and pr.role not in ('partner', 'vendor', 'investor', 'pending')
    and not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending')
    and lower(coalesce(p.full_name, '') || ' ' || p.email || ' ' || coalesce(p.title, '') || ' ' || coalesce(d.name, '')) like '%' || w1 || '%'
    and (p_department is null or p.department = p_department)
  order by 12 desc
  limit lim * 3;
end $$;

-- v23 rule model + v24: proposal facts (value, discount, product, geography, use case, margin, terms)
create or replace function public.wf_rule_error(r jsonb, depth integer default 0) returns text
language plpgsql immutable set search_path = public as $$
declare x jsonb; e text; f text; o text; facts text[] := array['quotations', 'selected', 'amount', 'currency', 'approval_current', 'vendor_status',
  'impact_complete', 'received_all', 'received_any', 'budget_remaining', 'documents', 'paid', 'document_version', 'days_to_need', 'obligations',
  'discount', 'product', 'geography', 'use_case', 'margin', 'terms'];
begin
  if r is null or r = 'null'::jsonb then return null; end if;
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

/* ---------------------------------------------------------------------------------------------
   8. Record rules for the commercial sections: numbers, US-persons-only links, stage rules, proposal versions,
      value and stage history, assignment notices
   --------------------------------------------------------------------------------------------- */
create or replace function public.crm_sections() returns text[] language sql immutable as $$
  select array['sales.pipeline', 'sales.proposals', 'sales.activities', 'sales.introductions', 'marketing.leads', 'company.contacts', 'company.parties',
               'company.meetings', 'company.decisions', 'company.tasks', 'legal.contracts']
$$;

-- the text the commercial search reads (names, number, e-mail, phone also as digits, organisation, aliases, tags)
create or replace function public.crm_search_text(t text, d jsonb) returns text language sql immutable parallel safe as $$
  select lower(concat_ws(' ', t, d->>'number', d->>'email', d->>'phone', d->>'mobile', regexp_replace(coalesce(d->>'phone', '') || ' ' || coalesce(d->>'mobile', ''), '[^0-9 ]', '', 'g'),
    d->>'trading_name', d->>'legal_name', d->>'aliases', d->>'tags', d->>'organization', d->>'contact', d->>'first_name', d->>'last_name', d->>'party_ref_title',
    d->>'domain', d->>'website', d->>'title', d->>'country'))
$$;
create index if not exists records_crm_search_trgm_idx on public.records using gin (public.crm_search_text(title, data) extensions.gin_trgm_ops)
  where section in ('company.parties', 'company.contacts', 'sales.pipeline', 'sales.proposals', 'marketing.leads', 'sales.introductions', 'sales.partners');

-- a stage of the configured pipeline (null when the name is not a stage)
create or replace function public._crm_stage(p_stage text) returns jsonb language sql stable security definer set search_path = public as $$
  select s from jsonb_array_elements(coalesce(public.crm_cfg()->'pipeline', '[]'::jsonb)) s where s->>'stage' = p_stage limit 1
$$;
revoke execute on function public._crm_stage(text) from public, anon, authenticated;
create or replace function public.crm_stage_kind(p_stage text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(public._crm_stage(p_stage)->>'kind', 'open')
$$;
revoke execute on function public.crm_stage_kind(text) from public, anon;
grant execute on function public.crm_stage_kind(text) to authenticated;

create or replace function public._crm_blank(v jsonb) returns boolean language sql immutable as $$
  select v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '')
$$;

-- the stage rules (configurable): the fields a stage needs, a proposal where asked, an authorized exception with a reason
create or replace function public._crm_stage_check(p_op text, o public.records, n public.records, p_actor uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare st jsonb := public._crm_stage(n.status); k text; miss text[] := '{}'; kind text; rl text; exc text;
begin
  if n.status is null then return null; end if;
  if st is null then
    return 'Unknown stage «' || n.status || '» — choose one of the pipeline stages (Commercial → Settings)';
  end if;
  if p_op = 'UPDATE' and n.status is not distinct from o.status then return null; end if;
  kind := coalesce(st->>'kind', 'open');
  for k in select jsonb_array_elements_text(coalesce(st->'required', '[]'::jsonb)) loop
    if k = 'owner_id' then
      if public._crm_blank(n.data->'owner_id') and public._crm_blank(n.data->'owner') then miss := miss || 'the AGRON owner'; end if;
    elsif public._crm_blank(n.data->k) then miss := miss || replace(k, '_', ' ');
    end if;
  end loop;
  if kind = 'lost' and not public._crm_blank(n.data->'lost_reason') and not (coalesce(public.crm_cfg()->'lost_reasons', '[]'::jsonb) ? (n.data->>'lost_reason')) then
    return 'Choose a loss reason from the list (' || (select string_agg(x, ', ') from jsonb_array_elements_text(public.crm_cfg()->'lost_reasons') x) || ')';
  end if;
  if coalesce((st->>'requires_proposal')::boolean, false)
     and not exists (select 1 from public.records p where p.section = 'sales.proposals' and p.data->>'deal_ref' = n.id::text and coalesce(p.status, '') <> 'Superseded') then
    miss := miss || 'a proposal';
  end if;
  if cardinality(miss) = 0 then return null; end if;
  -- a loss or a hold always says why: no exception replaces the reason
  if kind not in ('lost', 'hold') then
    exc := trim(coalesce(n.data->>'stage_exception', ''));
    if length(exc) >= 10 and (p_op = 'INSERT' or exc is distinct from trim(coalesce(o.data->>'stage_exception', ''))) then
      select role into rl from public.profiles where id = p_actor;
      if coalesce(n.data->>'owner_id', '') = p_actor::text or n.created_by = p_actor or rl in ('owner', 'management') or public.has_cap(p_actor, 'commercial_admin') then
        return null;
      end if;
      return 'Only the opportunity owner, management or a Commercial Admin may make an exception to the stage rules';
    end if;
  end if;
  return 'To move to «' || n.status || '», add: ' || array_to_string(miss, ', ')
    || case when kind not in ('lost', 'hold') then ' — or give the reason for an exception (at least 10 characters) in «Exception to the stage rules»' else '' end;
end $$;
revoke execute on function public._crm_stage_check(text, public.records, public.records, uuid) from public, anon, authenticated;

-- the last completed approval process of a proposal is valid for the proposal exactly as it is now
create or replace function public._crm_proposal_approved(r public.records) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public._wf_approval_current(i.id, r) from public.wf_instances i
    where i.record_id = r.id and i.def_code = 'PROPOSAL' and i.status = 'completed' and i.outcome = 'completed' order by i.completed_at desc nulls last limit 1), false)
$$;
revoke execute on function public._crm_proposal_approved(public.records) from public, anon, authenticated;

create or replace function public._crm_proposal_check(p_op text, o public.records, n public.records) returns text
language plpgsql stable security definer set search_path = public as $$
declare k text; nm text;
begin
  if p_op = 'INSERT' then
    if coalesce(n.status, 'Draft') <> 'Draft' then return 'A proposal starts as Draft; it becomes Approved only through its approval'; end if;
    return null;
  end if;
  -- the values of a proposal that left Draft never change: a new version is made instead
  if coalesce(o.status, 'Draft') <> 'Draft' then
    for k in select jsonb_array_elements_text(coalesce(public.ops_cfg()->'material'->'sales.proposals', '[]'::jsonb) || '["deal_ref", "document_ref"]'::jsonb) loop
      if k <> 'document_version_id' and (o.data->k) is distinct from (n.data->k) then
        return 'This proposal is ' || o.status || ': its values cannot change (' || k || '). Create a new version.';
      end if;
    end loop;
  end if;
  if n.status is distinct from o.status then
    select d.name into nm from public.wf_instances i join public.wf_definitions d on d.id = i.definition_id
     where i.record_id = n.id and i.status in ('active', 'waiting', 'blocked', 'draft') limit 1;
    if nm is not null then return 'This proposal is in «' || nm || '»: it changes with the approval actions'; end if;
    if n.status in ('Internal Review', 'Approved') then return 'A proposal is approved only through «Send for approval» (its author cannot approve it)'; end if;
    if n.status in ('Revised', 'Superseded') then return 'Create a new version: the earlier one is kept as it was'; end if;
    if n.status = 'Draft' then return 'A proposal that left Draft is not edited again — create a new version'; end if;
    if n.status = 'Sent' then
      if o.status <> 'Approved' then return 'Only an approved proposal can be sent'; end if;
      if not public._crm_proposal_approved(n) then return 'The approval was given to other values — send this version for approval again'; end if;
    end if;
    if n.status in ('Accepted', 'Rejected') and coalesce(o.status, '') <> 'Sent' then return 'Only a sent proposal is accepted or rejected'; end if;
    if n.status = 'Expired' and coalesce(o.status, '') not in ('Sent', 'Approved') then return 'Only an approved or sent proposal expires'; end if;
  end if;
  return null;
end $$;
revoke execute on function public._crm_proposal_check(text, public.records, public.records) from public, anon, authenticated;

-- what a signed-in person may not enter or change by hand (Workspace sets it); invoker on purpose, like v23:
-- inside the commercial functions (definer) the current user is the owner and these checks do not apply
create or replace function public.records_crm_guard() returns trigger language plpgsql set search_path = public as $$
declare prot text[]; k text; e text;
begin
  if current_user <> 'authenticated' then return new; end if;
  prot := case new.section
    when 'sales.pipeline' then array['number', 'quoted_value', 'approved_value', 'lost_at', 'lost_by', 'handoff_at', 'handoff_by', 'converted_from']
    when 'sales.proposals' then array['number', 'version', 'supersedes_ref', 'sent_at', 'approved_at', 'document_version_id', 'superseded_by']
    when 'marketing.leads' then array['party_ref', 'contact_ref', 'opportunity_ref', 'converted_at', 'converted_by', 'import_batch']
    when 'legal.contracts' then array['signed_version_id']
    when 'company.parties' then array['merged_into', 'import_batch']
    when 'company.contacts' then array['merged_into', 'import_batch']
    else array[]::text[] end;
  if tg_op = 'INSERT' then
    -- copied records arrive with these: they are given again by Workspace
    new.data := coalesce(new.data, '{}'::jsonb) - prot;
    if new.section = 'marketing.leads' and new.status = 'Converted' then raise exception 'A lead is converted with «Convert», which creates or links the organization, contact and opportunity' using errcode = '42501'; end if;
  else
    foreach k in array prot loop
      if (old.data->k) is distinct from (new.data->k) then raise exception 'The field % is set by Workspace, not edited by hand', k using errcode = '42501'; end if;
    end loop;
    if new.section = 'marketing.leads' and new.status is distinct from old.status and (new.status = 'Converted' or old.status = 'Converted') then
      raise exception 'A lead is converted with «Convert»; a converted lead stays converted' using errcode = '42501';
    end if;
  end if;
  if new.section = 'sales.pipeline' then
    e := public._crm_stage_check(tg_op, case when tg_op = 'UPDATE' then old end, new, auth.uid());
    if e is not null then raise exception '%', e using errcode = '23514'; end if;
  elsif new.section = 'sales.proposals' then
    e := public._crm_proposal_check(tg_op, case when tg_op = 'UPDATE' then old end, new);
    if e is not null then raise exception '%', e using errcode = '42501'; end if;
  end if;
  return new;
end $$;
-- named to run before records_crm_before (triggers of one kind fire in name order): what a person typed into a
-- Workspace field is removed first, then Workspace gives the value
drop trigger if exists records_crm_a_guard on public.records;
create trigger records_crm_a_guard before insert or update on public.records for each row
  when (new.section in ('sales.pipeline', 'sales.proposals', 'marketing.leads', 'legal.contracts', 'company.parties', 'company.contacts'))
  execute function public.records_crm_guard();

-- for every writer: links to a US-persons-only record make the record US-persons-only; numbers; dates stamped
create or replace function public.records_crm_before() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; dv text; fam text; nm text;
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data and new.controlled is not distinct from old.controlled and new.status is not distinct from old.status then return new; end if;
  new.data := coalesce(new.data, '{}'::jsonb);
  if not coalesce(new.controlled, false) then
    foreach k in array array['deal_ref', 'party_ref', 'project_ref', 'introduced_party_ref', 'opportunity_ref'] loop
      if coalesce(new.data->>k, '') <> '' and exists (select 1 from public.records x where x.id = public.as_uuid(new.data->>k) and x.controlled
                                                      and x.section in ('sales.pipeline', 'company.parties', 'company.projects')) then
        new.controlled := true; exit;
      end if;
    end loop;
  end if;
  if new.section = 'sales.pipeline' then
    if coalesce(new.data->>'number', '') = '' then new.data := new.data || jsonb_build_object('number', public.ops_number('sales.pipeline', public.as_uuid(new.data->>'project_ref'))); end if;
    if new.status is null then new.status := coalesce((public.crm_cfg()->'pipeline'->0->>'stage'), 'New'); end if;
    if (tg_op = 'INSERT' or new.status is distinct from old.status) and public.crm_stage_kind(new.status) = 'lost' then
      new.data := new.data || jsonb_build_object('lost_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
        'lost_by', coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()), 'Workspace'));
    end if;
  elsif new.section = 'sales.proposals' then
    if new.status is null then new.status := 'Draft'; end if;
    if coalesce(new.data->>'version', '') = '' then new.data := new.data || '{"version": 1}'::jsonb; end if;
    if coalesce(new.data->>'number', '') = '' then new.data := new.data || jsonb_build_object('number', public.ops_number('sales.proposals', null)); end if;
    -- the document version this proposal is: followed while Draft, fixed when it goes for approval
    if coalesce(new.data->>'document_ref', '') <> '' and (new.status = 'Draft' or (tg_op = 'UPDATE' and old.status = 'Draft' and new.status = 'Internal Review')) then
      select d.data->>'current_version_id' into dv from public.records d where d.id = public.as_uuid(new.data->>'document_ref');
      new.data := new.data || jsonb_build_object('document_version_id', dv);
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.status = 'Sent' and coalesce(new.data->>'sent_at', '') = '' then new.data := new.data || jsonb_build_object('sent_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD')); end if;
      if new.status = 'Approved' then new.data := new.data || jsonb_build_object('approved_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD')); end if;
    end if;
  elsif new.section in ('company.contacts', 'marketing.leads') then
    if new.data ? 'email' then new.data := new.data || jsonb_build_object('email', lower(trim(new.data->>'email'))); end if;
    if new.section = 'company.contacts' and coalesce(trim(new.title), '') = '' then
      nm := trim(concat_ws(' ', new.data->>'first_name', new.data->>'last_name')); if nm <> '' then new.title := nm; end if;
    end if;
  elsif new.section = 'company.parties' then
    if new.data ? 'domain' then new.data := new.data || jsonb_build_object('domain', lower(regexp_replace(trim(new.data->>'domain'), '^(https?://)?(www\.)?|/.*$', '', 'g'))); end if;
  elsif new.section = 'legal.contracts' then
    -- the exact document version that was signed
    if coalesce(new.data->>'signed_on', '') <> '' and coalesce(new.data->>'signed_version_id', '') = '' and coalesce(new.data->>'document_ref', '') <> '' then
      select d.data->>'current_version_id' into dv from public.records d where d.id = public.as_uuid(new.data->>'document_ref');
      if dv is not null then new.data := new.data || jsonb_build_object('signed_version_id', dv); end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists records_crm_before on public.records;
create trigger records_crm_before before insert or update on public.records for each row
  when (new.section in ('sales.pipeline', 'sales.proposals', 'sales.activities', 'sales.introductions', 'marketing.leads', 'company.contacts', 'company.parties',
                        'company.meetings', 'company.decisions', 'company.tasks', 'legal.contracts'))
  execute function public.records_crm_before();

-- one patch of an opportunity made by Workspace (a sent or approved proposal), with the reason kept in the history
create or replace function public._crm_patch(p_id uuid, p_patch jsonb, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('agron.crm_reason', true), '');
begin
  perform set_config('agron.crm_reason', left(coalesce(p_reason, ''), 300), true);
  perform public._wf_rec_patch(p_id, null, p_patch);
  perform set_config('agron.crm_reason', prev, true);
end $$;
revoke execute on function public._crm_patch(uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.records_crm_after() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; kind text; reason text; ov jsonb; nv jsonb; oc text; nc text; o public.records; who text;
  vals jsonb := '{"value": "estimate", "quoted_value": "quoted", "approved_value": "approved", "negotiated_value": "negotiated", "final_value": "final"}';
begin
  who := coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()), 'Workspace');
  if new.section = 'sales.pipeline' then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      insert into public.crm_stage_history(record_id, from_stage, to_stage, actor, reason, exception)
      values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid(),
        nullif(concat_ws(' · ', case when public.crm_stage_kind(new.status) = 'lost' then concat_ws(': ', new.data->>'lost_reason', nullif(new.data->>'lost_note', '')) end,
          case when public.crm_stage_kind(new.status) = 'hold' then new.data->>'hold_reason' end, nullif(current_setting('agron.crm_reason', true), '')), ''),
        coalesce(trim(new.data->>'stage_exception'), '') <> '' and (tg_op = 'INSERT' or (new.data->>'stage_exception') is distinct from (old.data->>'stage_exception')));
    end if;
    -- every commercial value keeps its history (never overwritten): who, when, why, from what
    for k, kind in select * from jsonb_each_text(vals) loop
      nv := new.data->k; ov := case when tg_op = 'UPDATE' then old.data->k end;
      nc := new.data->>'currency'; oc := case when tg_op = 'UPDATE' then old.data->>'currency' end;
      if (public._num(nv) is distinct from public._num(ov) or (public._num(nv) is not null and nc is distinct from oc)) and not (public._num(nv) is null and public._num(ov) is null) then
        reason := coalesce(nullif(current_setting('agron.crm_reason', true), ''),
          case when tg_op = 'INSERT' or (new.data->>'value_reason') is distinct from (old.data->>'value_reason') then nullif(trim(new.data->>'value_reason'), '') end,
          case when tg_op = 'INSERT' then 'Entered when the opportunity was created' else 'Changed in the record (no reason given)' end);
        insert into public.crm_values(record_id, kind, amount, currency, prev_amount, prev_currency, actor, reason, source)
        values (new.id, kind, public._num(nv), nc, public._num(ov), oc, auth.uid(), left(reason, 500), case when nullif(current_setting('agron.crm_reason', true), '') is not null then 'workspace' else 'record' end);
      end if;
    end loop;
    if coalesce(new.data->>'owner_id', '') <> '' and (tg_op = 'INSERT' or (new.data->>'owner_id') is distinct from (old.data->>'owner_id')) and new.data->>'owner_id' <> coalesce(auth.uid()::text, '') then
      perform public.notify_user((new.data->>'owner_id')::uuid, 'crm_opp_assigned', new.id, 'crm-own:' || new.id || ':' || (new.data->>'owner_id'),
        'Opportunity assigned to you: ' || coalesce(new.data->>'number', '') || ' ' || new.title, 'From ' || who, auth.uid(), '/crm?opp=' || new.id);
    end if;
  elsif new.section = 'sales.proposals' and tg_op = 'UPDATE' and new.status is distinct from old.status then
    select * into o from public.records where id = public.as_uuid(new.data->>'deal_ref') and section = 'sales.pipeline';
    if found and new.status = 'Sent' then
      perform public._crm_patch(o.id, jsonb_build_object('quoted_value', public._num(new.data->'value'), 'currency', coalesce(new.data->>'currency', o.data->>'currency')),
        'Proposal ' || coalesce(new.data->>'number', '') || ' v' || coalesce(new.data->>'version', '1') || ' sent');
    elsif found and new.status = 'Approved' then
      perform public._crm_patch(o.id, jsonb_build_object('approved_value', public._num(new.data->'value'), 'currency', coalesce(new.data->>'currency', o.data->>'currency')),
        'Proposal ' || coalesce(new.data->>'number', '') || ' v' || coalesce(new.data->>'version', '1') || ' approved');
    end if;
  elsif new.section = 'marketing.leads' then
    if coalesce(new.data->>'owner_id', '') <> '' and (tg_op = 'INSERT' or (new.data->>'owner_id') is distinct from (old.data->>'owner_id')) and new.data->>'owner_id' <> coalesce(auth.uid()::text, '') then
      perform public.notify_user((new.data->>'owner_id')::uuid, 'crm_lead_assigned', new.id, 'crm-lead:' || new.id || ':' || (new.data->>'owner_id'),
        'Lead assigned to you: ' || new.title, concat_ws(' · ', new.data->>'organization', 'from ' || who), auth.uid(), '/crm?lead=' || new.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists records_crm_after on public.records;
create trigger records_crm_after after insert or update on public.records for each row
  when (new.section in ('sales.pipeline', 'sales.proposals', 'marketing.leads'))
  execute function public.records_crm_after();

/* ---------------------------------------------------------------------------------------------
   9. Commercial actions: duplicates, event capture, lead conversion (one transaction), proposal versions and
      approval, won → project handoff, merges (audited, history kept), bulk assignment
   --------------------------------------------------------------------------------------------- */
-- a company name without punctuation, spaces and legal suffixes ("Harbor Marine LLC" = "harbor marine")
create or replace function public.crm_norm(t text) returns text language sql immutable parallel safe as $$
  select regexp_replace(regexp_replace(lower(coalesce(t, '')),
    '\m(the|llc|l\.l\.c|ltd|limited|inc|incorporated|corp|corporation|co|company|fze|fzco|fzc|fz|llp|plc|gmbh|ag|sa|sas|srl|bv|nv|spa|pjsc|psc|jsc|wll|est|group|holding|holdings)\M\.?', '', 'g'),
    '[^[:alnum:]]+', '', 'g')
$$;
create or replace function public.crm_digits(t text) returns text language sql immutable parallel safe as $$
  select right(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), 9)
$$;
create index if not exists records_crm_norm_idx on public.records ((public.crm_norm(title))) where section in ('company.parties', 'company.contacts');
create index if not exists records_crm_domain_idx on public.records ((lower(data->>'domain'))) where section = 'company.parties' and data ? 'domain';
create index if not exists records_crm_phone_idx on public.records ((public.crm_digits(data->>'phone'))) where section in ('company.contacts', 'marketing.leads') and data ? 'phone';

create or replace function public._crm_free_mail(d text) returns boolean language sql immutable as $$
  select coalesce(d ~* '^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|proton|protonmail|pm|mail|yandex|aol|gmx|zoho|qq|163|126|rocketmail)\.', true)
$$;

-- may this person write records of a section (the same rule as row-level security for writing)
create or replace function public._crm_can_write(p_uid uuid, p_section text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role in ('owner', 'admin') or exists (select 1 from public.section_access a where a.role = p.role and a.section = p_section and a.can_write)
    from public.profiles p where p.id = p_uid and not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending')), false)
$$;
revoke execute on function public._crm_can_write(uuid, text) from public, anon, authenticated;

/** Likely existing records before a new organisation or contact is made. Nothing is merged or chosen here. */
create or replace function public.crm_dupes(p_kind text, p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); nm text; dom text; em text; ph text; party uuid; out jsonb := '[]'::jsonb; r record; why jsonb; strong boolean;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_kind in ('organization', 'party') then
    nm := public.crm_norm(coalesce(p->>'name', p->>'title', p->>'organization', p->>'trading_name', p->>'legal_name'));
    dom := lower(regexp_replace(trim(coalesce(p->>'domain', p->>'website', split_part(coalesce(p->>'email', ''), '@', 2), '')), '^(https?://)?(www\.)?|/.*$', '', 'g'));
    if public._crm_free_mail(dom) then dom := ''; end if;
    for r in select x.id, x.title, x.status, x.data from public.records x
             where x.section = 'company.parties' and coalesce(x.data->>'merged_into', '') = ''
               and ((length(nm) >= 3 and (public.crm_norm(x.title) = nm or public.crm_norm(x.data->>'legal_name') = nm or public.crm_norm(x.data->>'trading_name') = nm
                     or exists (select 1 from unnest(string_to_array(coalesce(x.data->>'aliases', ''), ',')) a where public.crm_norm(a) = nm)
                     or (length(nm) >= 5 and public.crm_norm(x.title) like '%' || nm || '%') or (length(public.crm_norm(x.title)) >= 5 and nm like '%' || public.crm_norm(x.title) || '%')))
                 or (dom <> '' and (lower(x.data->>'domain') = dom or lower(regexp_replace(coalesce(x.data->>'website', ''), '^(https?://)?(www\.)?|/.*$', '', 'g')) = dom)))
             order by x.updated_at desc limit 40 loop
      exit when jsonb_array_length(out) >= 8;
      if not public.record_visible_for(me, (select y from public.records y where y.id = r.id)) then continue; end if;
      why := '[]'::jsonb; strong := false;
      if length(nm) >= 3 and (public.crm_norm(r.title) = nm or public.crm_norm(r.data->>'legal_name') = nm or public.crm_norm(r.data->>'trading_name') = nm) then why := why || '"same name"'; strong := true; end if;
      if length(nm) >= 3 and exists (select 1 from unnest(string_to_array(coalesce(r.data->>'aliases', ''), ',')) a where public.crm_norm(a) = nm) then why := why || '"same as one of its other names"'; strong := true; end if;
      if dom <> '' and (lower(r.data->>'domain') = dom or lower(regexp_replace(coalesce(r.data->>'website', ''), '^(https?://)?(www\.)?|/.*$', '', 'g')) = dom) then why := why || to_jsonb('same domain ' || dom); strong := true; end if;
      if jsonb_array_length(why) = 0 then why := why || '"similar name"'; end if;
      if coalesce(p->>'country', '') <> '' and lower(r.data->>'country') = lower(p->>'country') then why := why || '"same country"'; end if;
      out := out || jsonb_build_object('id', r.id, 'section', 'company.parties', 'title', r.title, 'status', r.status, 'country', r.data->>'country', 'website', r.data->>'website',
        'relationship_types', r.data->'relationship_types', 'why', why, 'strength', case when strong then 'strong' else 'possible' end);
    end loop;
  elsif p_kind = 'contact' then
    em := lower(trim(coalesce(p->>'email', ''))); ph := public.crm_digits(coalesce(p->>'phone', p->>'mobile'));
    nm := public.crm_norm(coalesce(nullif(trim(p->>'name'), ''), nullif(trim(concat_ws(' ', p->>'first_name', p->>'last_name')), ''), p->>'contact'));
    party := public.as_uuid(p->>'party_ref');
    for r in select x.id, x.title, x.status, x.data from public.records x
             where x.section = 'company.contacts' and coalesce(x.data->>'merged_into', '') = ''
               and ((em <> '' and lower(x.data->>'email') = em) or (length(ph) >= 7 and (public.crm_digits(x.data->>'phone') = ph or public.crm_digits(x.data->>'mobile') = ph))
                 or (length(nm) >= 4 and public.crm_norm(x.title) = nm))
             order by x.updated_at desc limit 40 loop
      exit when jsonb_array_length(out) >= 8;
      if not public.record_visible_for(me, (select y from public.records y where y.id = r.id)) then continue; end if;
      why := '[]'::jsonb; strong := false;
      if em <> '' and lower(r.data->>'email') = em then why := why || '"same e-mail"'; strong := true; end if;
      if length(ph) >= 7 and (public.crm_digits(r.data->>'phone') = ph or public.crm_digits(r.data->>'mobile') = ph) then why := why || '"same phone"'; strong := true; end if;
      if length(nm) >= 4 and public.crm_norm(r.title) = nm then
        if party is not null and r.data->>'party_ref' = party::text then why := why || '"same name at the same organization"'; strong := true;
        else why := why || '"same name"'; end if;
      end if;
      out := out || jsonb_build_object('id', r.id, 'section', 'company.contacts', 'title', r.title, 'status', r.status, 'email', r.data->>'email', 'phone', r.data->>'phone',
        'organization', coalesce(r.data->>'party_ref_title', r.data->>'organization'), 'party_ref', r.data->>'party_ref', 'why', why, 'strength', case when strong then 'strong' else 'possible' end);
    end loop;
  else raise exception 'Unknown kind: organization or contact' using errcode = '22023';
  end if;
  return out;
end $$;
revoke execute on function public.crm_dupes(text, jsonb) from public, anon;
grant execute on function public.crm_dupes(text, jsonb) to authenticated;

create or replace function public._crm_name(p_uid uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where id = p_uid
$$;
revoke execute on function public._crm_name(uuid) from public, anon, authenticated;

/**
 * Event lead mode: one lead in 30–60 seconds (phone or tablet). Any active employee may capture a lead at an event;
 * the lead belongs to its AGRON owner. Duplicates are shown with the result; nothing is merged.
 */
create or replace function public.crm_lead_capture(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); d jsonb; nm text; owner uuid; ev uuid; id uuid; t text; fu text;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  d := jsonb_strip_nulls(jsonb_build_object(
    'first_name', nullif(trim(p->>'first_name'), ''), 'last_name', nullif(trim(p->>'last_name'), ''), 'title', nullif(trim(p->>'title'), ''),
    'organization', nullif(trim(p->>'organization'), ''), 'email', nullif(lower(trim(p->>'email')), ''), 'phone', nullif(trim(p->>'phone'), ''),
    'country', nullif(trim(p->>'country'), ''), 'interest', nullif(trim(p->>'interest'), ''), 'product', nullif(trim(p->>'product'), ''), 'use_case', nullif(trim(p->>'use_case'), ''),
    'importance', nullif(p->>'importance', ''), 'notes', nullif(left(trim(p->>'notes'), 4000), ''), 'source', nullif(p->>'source', ''), 'geography', nullif(p->>'geography', ''),
    'introducer', nullif(trim(p->>'introducer'), ''), 'introducer_ref', public.as_uuid(p->>'introducer_ref'), 'meeting_ref', public.as_uuid(p->>'meeting_ref'), 'tags', nullif(trim(p->>'tags'), ''),
    'website', nullif(trim(p->>'website'), ''), 'captured_via', coalesce(nullif(p->>'captured_via', ''), 'form')));
  nm := trim(concat_ws(' ', d->>'first_name', d->>'last_name'));
  if nm = '' and coalesce(d->>'organization', '') = '' then raise exception 'Add at least a name or an organization' using errcode = '23514'; end if;
  if coalesce(d->>'email', '') = '' and coalesce(d->>'phone', '') = '' and coalesce(d->>'organization', '') = '' then raise exception 'Add an e-mail, a phone or the organization, so the lead can be followed up' using errcode = '23514'; end if;
  if coalesce(d->>'email', '') <> '' and d->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'The e-mail address does not look right' using errcode = '23514'; end if;
  if d ? 'importance' and d->>'importance' not in ('Hot', 'Warm', 'Cold') then raise exception 'Importance is Hot, Warm or Cold' using errcode = '22023'; end if;
  owner := coalesce(public.as_uuid(p->>'owner_id'), me);
  if not public.is_active_employee(owner) then raise exception 'The AGRON owner must be an active employee' using errcode = '23514'; end if;
  fu := p->>'follow_up';
  if coalesce(fu, '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Set the follow-up date' using errcode = '23514'; end if;
  ev := coalesce(public.as_uuid(p->>'event_ref'), public.as_uuid(public.crm_cfg()->>'active_event_ref'));
  if ev is not null and not exists (select 1 from public.records where id = ev and section = 'marketing.events') then ev := null; end if;
  if d ? 'introducer_ref' and not exists (select 1 from public.records where id = (d->>'introducer_ref')::uuid and section = 'company.parties') then d := d - 'introducer_ref'; end if;
  d := d || jsonb_build_object('owner_id', owner, 'owner', public._crm_name(owner), 'follow_up', fu, 'contact', nullif(nm, ''))
         || case when ev is not null then jsonb_build_object('event_ref', ev, 'event_ref_title', (select title from public.records where id = ev)) else '{}'::jsonb end
         || case when d ? 'introducer_ref' then jsonb_build_object('introducer_ref_title', (select title from public.records where id = (d->>'introducer_ref')::uuid)) else '{}'::jsonb end;
  t := left(coalesce(nullif(nm, ''), d->>'organization') || case when nm <> '' and coalesce(d->>'organization', '') <> '' then ' — ' || (d->>'organization') else '' end, 300);
  insert into public.records(section, title, status, data) values ('marketing.leads', t, 'New', d) returning records.id into id;
  insert into public.crm_audit(actor, kind, record_id, detail) values (me, 'lead_captured', id, jsonb_build_object('via', d->>'captured_via', 'event', ev));
  return jsonb_build_object('id', id, 'title', t, 'owner', public._crm_name(owner), 'follow_up', fu,
    'dupes', jsonb_build_object('organization', case when coalesce(d->>'organization', '') <> '' then public.crm_dupes('organization', d) else '[]'::jsonb end,
                                'contact', case when nm <> '' or d ? 'email' or d ? 'phone' then public.crm_dupes('contact', (d - 'title') || jsonb_build_object('name', nm)) else '[]'::jsonb end));
end $$;
revoke execute on function public.crm_lead_capture(jsonb) from public, anon;
grant execute on function public.crm_lead_capture(jsonb) to authenticated;

-- a choice of an existing record or a new one ({"use": id} | {"new": {...}}); a strong duplicate needs a reason
create or replace function public._crm_pick(p_kind text, p_choice jsonb, p_me uuid, p_seed jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare id uuid; v jsonb; dup jsonb; sec text := case when p_kind = 'organization' then 'company.parties' else 'company.contacts' end; t text;
begin
  if p_choice ? 'use' then
    id := public.as_uuid(p_choice->>'use');
    if id is null or not exists (select 1 from public.records x where x.id = id and x.section = sec) then raise exception 'The chosen % was not found', p_kind using errcode = 'P0002'; end if;
    if not public.record_visible_for(p_me, (select x from public.records x where x.id = id)) then raise exception 'The chosen % was not found', p_kind using errcode = 'P0002'; end if;
    return id;
  end if;
  v := coalesce(p_choice->'new', p_seed);
  -- the display name is «name» (for an organisation also «title»); a contact's «title» is the job title
  t := trim(coalesce(nullif(v->>'name', ''), case when p_kind = 'organization' then v->>'title' else nullif(trim(concat_ws(' ', v->>'first_name', v->>'last_name')), '') end, ''));
  if t = '' then raise exception 'The new % needs a name', p_kind using errcode = '23514'; end if;
  if not public._crm_can_write(p_me, sec) then raise exception 'You cannot add records to %', sec using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into dup from jsonb_array_elements(public.crm_dupes(p_kind, (case when p_kind = 'contact' then v - 'title' else v end) || jsonb_build_object('name', t))) x where x->>'strength' = 'strong';
  if jsonb_array_length(dup) > 0 and length(trim(coalesce(p_choice->>'new_reason', ''))) < 5 then
    raise exception 'Possible existing record: % (%). Choose it, or confirm a new one and say why', dup->0->>'title', (select string_agg(w, ', ') from jsonb_array_elements_text(dup->0->'why') w) using errcode = '23505';
  end if;
  v := (case when p_kind = 'organization' then v - 'title' else v end - 'name' - 'merged_into' - 'import_batch') || jsonb_build_object('owner_id', coalesce(v->>'owner_id', p_me::text), 'owner', coalesce(v->>'owner', public._crm_name(coalesce(public.as_uuid(v->>'owner_id'), p_me))))
       || case when p_choice ? 'new_reason' then jsonb_build_object('created_despite', jsonb_build_object('similar', dup, 'reason', left(p_choice->>'new_reason', 300))) else '{}'::jsonb end;
  insert into public.records(section, title, status, data) values (sec, left(t, 300), case when p_kind = 'contact' then 'Active' else 'Active' end, jsonb_strip_nulls(v)) returning records.id into id;
  return id;
end $$;
revoke execute on function public._crm_pick(text, jsonb, uuid, jsonb) from public, anon, authenticated;

/**
 * Convert a lead: organisation + contact + opportunity in one transaction. An existing organisation or contact is
 * reused (chosen by the person, or the single exact match); the introduction travels to the opportunity.
 */
create or replace function public.crm_lead_convert(p_lead uuid, p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); l public.records; d jsonb; party uuid; contact uuid; opp uuid; o jsonb; intro uuid; dup jsonb; pt text; ct text; stage text; owner uuid;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into l from public.records where id = p_lead and section = 'marketing.leads' for update;
  if not found or not public.record_visible_for(me, l) then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  if not public._crm_can_write(me, 'marketing.leads') then raise exception 'You cannot change leads' using errcode = '42501'; end if;
  if l.status = 'Converted' then raise exception 'This lead was already converted' using errcode = '55000'; end if;
  if l.status = 'Disqualified' then raise exception 'A disqualified lead is not converted; set it back to Reviewing first' using errcode = '55000'; end if;
  d := l.data;
  -- 1. organisation: the chosen one, a new one, or (no choice) the single exact match, else a new one
  if p ? 'party' then party := public._crm_pick('organization', p->'party', me, jsonb_build_object('name', d->>'organization', 'country', d->>'country', 'website', d->>'website'));
  elsif coalesce(d->>'organization', '') <> '' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into dup from jsonb_array_elements(public.crm_dupes('organization', jsonb_build_object('name', d->>'organization', 'email', d->>'email', 'country', d->>'country'))) x where x->>'strength' = 'strong';
    if jsonb_array_length(dup) = 1 then party := (dup->0->>'id')::uuid;
    elsif jsonb_array_length(dup) > 1 then raise exception 'Several organizations match «%» — choose one', d->>'organization' using errcode = '23505';
    else party := public._crm_pick('organization', jsonb_build_object('new', jsonb_strip_nulls(jsonb_build_object('name', d->>'organization', 'country', d->>'country', 'website', d->>'website',
           'relationship_types', '["Prospect"]'::jsonb, 'source', d->>'source', 'geography', d->>'geography'))), me, null);
    end if;
  end if;
  pt := (select title from public.records where id = party);
  -- 2. contact
  if p ? 'contact' and p->'contact' = 'null'::jsonb then contact := null;
  elsif p ? 'contact' then contact := public._crm_pick('contact', p->'contact', me, null);
  elsif coalesce(d->>'contact', d->>'first_name', d->>'last_name', d->>'email', '') <> '' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into dup from jsonb_array_elements(public.crm_dupes('contact', jsonb_build_object('name', coalesce(d->>'contact', concat_ws(' ', d->>'first_name', d->>'last_name')),
      'first_name', d->>'first_name', 'last_name', d->>'last_name', 'email', d->>'email', 'phone', d->>'phone', 'party_ref', party))) x where x->>'strength' = 'strong';
    if jsonb_array_length(dup) = 1 then contact := (dup->0->>'id')::uuid;
    elsif jsonb_array_length(dup) > 1 then raise exception 'Several contacts match — choose one' using errcode = '23505';
    else contact := public._crm_pick('contact', jsonb_build_object('new', jsonb_strip_nulls(jsonb_build_object('name', coalesce(nullif(d->>'contact', ''), trim(concat_ws(' ', d->>'first_name', d->>'last_name')), d->>'email'),
           'first_name', d->>'first_name', 'last_name', d->>'last_name', 'title', d->>'title', 'email', d->>'email', 'phone', d->>'phone', 'country', d->>'country',
           'party_ref', party, 'party_ref_title', pt, 'organization', d->>'organization', 'source', d->>'source'))), me, null);
    end if;
  end if;
  if contact is not null and party is not null and coalesce((select data->>'party_ref' from public.records where id = contact), '') = '' then
    perform public._wf_rec_patch(contact, null, jsonb_build_object('party_ref', party, 'party_ref_title', pt));
  end if;
  ct := (select title from public.records where id = contact);
  -- 3. opportunity (new or existing)
  o := coalesce(p->'opportunity', '{"new": {}}'::jsonb);
  if o ? 'use' then
    opp := public.as_uuid(o->>'use');
    if opp is null or not exists (select 1 from public.records x where x.id = opp and x.section = 'sales.pipeline') or not public.record_visible_for(me, (select x from public.records x where x.id = opp)) then
      raise exception 'The chosen opportunity was not found' using errcode = 'P0002';
    end if;
  elsif o ? 'new' then
    if not public._crm_can_write(me, 'sales.pipeline') then raise exception 'You cannot create opportunities' using errcode = '42501'; end if;
    owner := coalesce(public.as_uuid(o->'new'->>'owner_id'), public.as_uuid(d->>'owner_id'), me);
    stage := coalesce(nullif(o->'new'->>'stage', ''), case when l.status = 'Qualified' then 'Qualified' else public.crm_cfg()->'pipeline'->0->>'stage' end);
    if public._crm_stage(stage) is null or public.crm_stage_kind(stage) <> 'open' then raise exception 'A converted lead starts in an open stage' using errcode = '22023'; end if;
    insert into public.records(section, title, status, controlled, data)
    values ('sales.pipeline', left(coalesce(nullif(o->'new'->>'title', ''), coalesce(pt, ct, l.title) || coalesce(' — ' || nullif(coalesce(o->'new'->>'product', d->>'product'), ''), '')), 300), stage, l.controlled,
      jsonb_strip_nulls(jsonb_build_object('party_ref', party, 'party_ref_title', pt, 'contact_ref', contact, 'contact_ref_title', ct, 'lead_ref', l.id, 'lead_ref_title', l.title,
        'owner_id', owner, 'owner', public._crm_name(owner), 'source', d->>'source', 'geography', coalesce(o->'new'->>'geography', d->>'geography'),
        'product', coalesce(o->'new'->>'product', d->>'product'), 'use_case', coalesce(o->'new'->>'use_case', d->>'use_case'),
        'value', public._num(o->'new'->'value'), 'currency', o->'new'->>'currency', 'expected_decision', o->'new'->>'expected_decision',
        'next_action', coalesce(o->'new'->>'next_action', d->>'next_action'), 'next_action_due', coalesce(o->'new'->>'next_action_due', d->>'follow_up'),
        'next_action_owner_id', owner, 'next_action_owner', public._crm_name(owner), 'country', d->>'country', 'client', pt,
        'introduced_by_ref', d->>'introducer_ref', 'introduced_by_ref_title', d->>'introducer_ref_title', 'converted_from', l.id,
        'notes', d->>'notes', 'value_reason', case when o->'new' ? 'value' then 'Estimate given at lead conversion' end)))
    returning records.id into opp;
  end if;
  -- 4. the introduction stays attached through conversion
  if coalesce(d->>'introducer_ref', '') <> '' or coalesce(d->>'introducer', '') <> '' then
    select x.id into intro from public.records x where x.section = 'sales.introductions' and x.data->>'lead_ref' = l.id::text limit 1;
    if intro is null then
      insert into public.records(section, title, status, controlled, data)
      values ('sales.introductions', left('Introduction: ' || coalesce(pt, ct, l.title) || coalesce(' by ' || coalesce(d->>'introducer_ref_title', d->>'introducer'), ''), 300), 'Recorded', l.controlled,
        jsonb_strip_nulls(jsonb_build_object('introduced_party_ref', party, 'introduced_party_ref_title', pt, 'introduced_contact_ref', contact, 'introduced_contact_ref_title', ct,
          'introducer_party_ref', d->>'introducer_ref', 'introducer_party_ref_title', d->>'introducer_ref_title', 'context', coalesce(d->>'introducer', 'Recorded on the lead'),
          'introducer_kind', case when coalesce(d->>'introducer_ref', '') <> '' then coalesce((select case when x.data->'relationship_types' ? 'Agent' then 'Agent' when x.data->'relationship_types' ? 'Partner' then 'Partner'
             when x.data->'relationship_types' ? 'Advisor' then 'Advisor' when x.data->'relationship_types' ? 'Customer' then 'Customer' else 'Other external contact' end from public.records x where x.id = public.as_uuid(d->>'introducer_ref')), 'Other external contact') end,
          'date', coalesce(left(l.created_at::text, 10), to_char(now(), 'YYYY-MM-DD')), 'deal_ref', opp, 'deal_ref_title', (select title from public.records where id = opp),
          'lead_ref', l.id, 'owner_id', d->>'owner_id', 'owner', d->>'owner')))
      returning records.id into intro;
    elsif opp is not null then perform public._wf_rec_patch(intro, null, jsonb_build_object('deal_ref', opp));
    end if;
  end if;
  perform public._wf_rec_patch(l.id, 'Converted', jsonb_strip_nulls(jsonb_build_object('party_ref', party, 'party_ref_title', pt, 'contact_ref', contact, 'contact_ref_title', ct,
    'opportunity_ref', opp, 'opportunity_ref_title', (select title from public.records where id = opp), 'converted_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 'converted_by', public._crm_name(me))));
  insert into public.crm_audit(actor, kind, record_id, detail) values (me, 'lead_converted', l.id, jsonb_build_object('party', party, 'contact', contact, 'opportunity', opp, 'introduction', intro));
  return jsonb_build_object('ok', true, 'party', party, 'contact', contact, 'opportunity', opp, 'introduction', intro,
    'number', (select data->>'number' from public.records where id = opp));
end $$;
revoke execute on function public.crm_lead_convert(uuid, jsonb) from public, anon;
grant execute on function public.crm_lead_convert(uuid, jsonb) to authenticated;

-- give many leads one owner (after an event); each new owner is told once
create or replace function public.crm_bulk_assign(p_leads uuid[], p_owner uuid, p_follow_up date default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); n int := 0; x public.records;
begin
  if me is null or not public._crm_can_write(me, 'marketing.leads') then raise exception 'You cannot change leads' using errcode = '42501'; end if;
  if not public.is_active_employee(p_owner) then raise exception 'The owner must be an active employee' using errcode = '23514'; end if;
  if coalesce(cardinality(p_leads), 0) > 500 then raise exception 'At most 500 leads at once' using errcode = '22023'; end if;
  for x in select * from public.records where id = any(p_leads) and section = 'marketing.leads' and coalesce(status, '') not in ('Converted', 'Disqualified') for update loop
    if not public.record_visible_for(me, x) then continue; end if;
    perform public._wf_rec_patch(x.id, null, jsonb_build_object('owner_id', p_owner, 'owner', public._crm_name(p_owner))
      || case when p_follow_up is not null and coalesce(x.data->>'follow_up', '') = '' then jsonb_build_object('follow_up', to_char(p_follow_up, 'YYYY-MM-DD')) else '{}'::jsonb end);
    n := n + 1;
  end loop;
  insert into public.crm_audit(actor, kind, detail) values (me, 'leads_assigned', jsonb_build_object('owner', p_owner, 'count', n));
  return jsonb_build_object('ok', true, 'assigned', n);
end $$;
revoke execute on function public.crm_bulk_assign(uuid[], uuid, date) from public, anon;
grant execute on function public.crm_bulk_assign(uuid[], uuid, date) to authenticated;

/** Send a Draft proposal for approval of its exact values (the v23 engine, policy PROPOSAL). */
create or replace function public.crm_proposal_submit(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); r public.records; inst uuid;
begin
  select * into r from public.records where id = p_id and section = 'sales.proposals' for update;
  if me is null or not found or not public.record_visible_for(me, r) then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  if not public._crm_can_write(me, 'sales.proposals') then raise exception 'You cannot change proposals' using errcode = '42501'; end if;
  if r.status <> 'Draft' then raise exception 'Only a Draft proposal goes for approval (this one is %)', r.status using errcode = '55000'; end if;
  if public._num(r.data->'value') is null or coalesce(r.data->>'currency', '') = '' then raise exception 'Enter the value and the currency first' using errcode = '23514'; end if;
  if coalesce(r.data->>'deal_ref', '') = '' then raise exception 'Link the proposal to its opportunity first' using errcode = '23514'; end if;
  inst := public.wf_start('PROPOSAL', p_id, null);
  return jsonb_build_object('ok', true, 'instance', inst, 'status', (select status from public.records where id = p_id));
end $$;
revoke execute on function public.crm_proposal_submit(uuid) from public, anon;
grant execute on function public.crm_proposal_submit(uuid) to authenticated;

/** A new version of a proposal that left Draft. The earlier version is kept exactly as it was (Revised if it was sent). */
create or replace function public.crm_proposal_new_version(p_id uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); r public.records; nid uuid; v int;
begin
  select * into r from public.records where id = p_id and section = 'sales.proposals' for update;
  if me is null or not found or not public.record_visible_for(me, r) then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  if not public._crm_can_write(me, 'sales.proposals') then raise exception 'You cannot change proposals' using errcode = '42501'; end if;
  if r.status = 'Draft' then raise exception 'This version is still a Draft: edit it directly' using errcode = '55000'; end if;
  if r.status = 'Internal Review' then raise exception 'This version is being approved: ask for changes in the approval, or wait for the decision' using errcode = '55000'; end if;
  if r.status in ('Accepted', 'Revised', 'Superseded') then raise exception 'A % version is final; make the new version from the latest one', lower(r.status) using errcode = '55000'; end if;
  if exists (select 1 from public.records x where x.section = 'sales.proposals' and x.data->>'number' = r.data->>'number' and public._num(x.data->'version') > public._num(r.data->'version')) then
    raise exception 'A newer version of this proposal exists' using errcode = '55000';
  end if;
  v := coalesce(public._num(r.data->'version'), 1)::int + 1;
  insert into public.records(section, title, status, controlled, company, data)
  values ('sales.proposals', left(regexp_replace(r.title, '\s*·\s*v\d+$', '') || ' · v' || v, 300), 'Draft', r.controlled, r.company,
    (r.data - array['sent_at', 'approved_at', 'superseded_by', 'document_version_id']) || jsonb_build_object('version', v, 'supersedes_ref', r.id, 'supersedes_ref_title', r.title,
      'revision_reason', nullif(left(trim(coalesce(p_reason, '')), 300), '')))
  returning records.id into nid;
  -- a sent version becomes Revised (it was in the customer's hands); an approved or expired one Superseded; a rejected one stays Rejected
  perform public._wf_rec_patch(r.id, case r.status when 'Sent' then 'Revised' when 'Approved' then 'Superseded' when 'Expired' then 'Superseded' else r.status end,
    jsonb_build_object('superseded_by', nid));
  insert into public.crm_audit(actor, kind, record_id, detail) values (me, 'proposal_new_version', nid, jsonb_build_object('from', r.id, 'version', v, 'previous_status', r.status, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'id', nid, 'version', v);
end $$;
revoke execute on function public.crm_proposal_new_version(uuid, text) from public, anon;
grant execute on function public.crm_proposal_new_version(uuid, text) to authenticated;

/** The handoff package of a won opportunity (what the project team receives). Nothing is created here. */
create or replace function public.crm_handoff(p_opp uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); o public.records; pk jsonb; prop public.records; vis boolean;
begin
  select * into o from public.records where id = p_opp and section = 'sales.pipeline';
  if me is null or not found or not public.record_visible_for(me, o) then raise exception 'Opportunity not found' using errcode = 'P0002'; end if;
  select * into prop from public.records p where p.section = 'sales.proposals' and p.data->>'deal_ref' = o.id::text and p.status in ('Accepted', 'Sent', 'Approved', 'Revised')
    and public.record_visible_for(me, p)
    order by case p.status when 'Accepted' then 0 when 'Sent' then 1 when 'Approved' then 2 else 3 end, public._num(p.data->'version') desc nulls last, p.updated_at desc limit 1;
  pk := jsonb_build_object(
    'opportunity', jsonb_build_object('id', o.id, 'number', o.data->>'number', 'title', o.title, 'stage', o.status, 'owner', o.data->>'owner', 'product', o.data->>'product', 'use_case', o.data->>'use_case',
       'geography', o.data->>'geography', 'expected_close', o.data->>'expected_close', 'decision_evidence', o.data->>'decision_evidence'),
    'organization', (select jsonb_build_object('id', x.id, 'title', x.title, 'country', x.data->>'country', 'website', x.data->>'website') from public.records x where x.id = public.as_uuid(o.data->>'party_ref') and public.record_visible_for(me, x)),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'job', x.data->>'title', 'email', x.data->>'email', 'phone', x.data->>'phone', 'primary', x.id::text = o.data->>'contact_ref') order by (x.id::text = o.data->>'contact_ref') desc, x.title)
       from public.records x where x.section = 'company.contacts' and (x.id::text = o.data->>'contact_ref' or (coalesce(o.data->>'party_ref', '') <> '' and x.data->>'party_ref' = o.data->>'party_ref'))
       and coalesce(x.status, '') not in ('Inactive', 'Do Not Contact') and public.record_visible_for(me, x)), '[]'::jsonb),
    'final_proposal', case when prop.id is not null then jsonb_build_object('id', prop.id, 'number', prop.data->>'number', 'version', prop.data->>'version', 'status', prop.status,
       'value', public._num(prop.data->'value'), 'currency', prop.data->>'currency', 'config', prop.data->>'config', 'qty', prop.data->>'qty', 'delivery', prop.data->>'delivery',
       'payment_terms', prop.data->>'payment_terms', 'document_ref', prop.data->>'document_ref', 'document_version_id', prop.data->>'document_version_id') end,
    'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.data->>'number', 'title', x.title, 'type', x.data->>'type', 'status', x.status, 'signed_on', x.data->>'signed_on',
       'start_date', x.data->>'start_date', 'end_date', x.data->>'end_date', 'signed_version_id', x.data->>'signed_version_id', 'document_ref', x.data->>'document_ref') order by x.updated_at desc)
       from public.records x where x.section = 'legal.contracts' and x.data->>'deal_ref' = o.id::text and public.record_visible_for(me, x)), '[]'::jsonb),
    'values', jsonb_build_object('currency', o.data->>'currency', 'estimate', public._num(o.data->'value'), 'quoted', public._num(o.data->'quoted_value'), 'approved', public._num(o.data->'approved_value'),
       'negotiated', public._num(o.data->'negotiated_value'), 'final', public._num(o.data->'final_value'),
       'note', 'Each value is shown with its own label; the final agreed value is the one to use where it is known.'),
    'scope', concat_ws(' · ', nullif(o.data->>'product', ''), nullif(o.data->>'use_case', ''), case when prop.id is not null then concat_ws(' ', prop.data->>'qty', '×', prop.data->>'config') end,
       nullif(prop.data->>'delivery', '')),
    'commitments', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'description', b.data->>'description', 'due', b.data->>'due', 'owner', b.data->>'owner', 'status', b.status) order by b.data->>'due')
       from public.records b join public.records c on c.id = public.as_uuid(b.data->>'contract_ref')
       where b.section = 'legal.contract_obligations' and c.data->>'deal_ref' = o.id::text and public.record_visible_for(me, b)), '[]'::jsonb),
    'key_dates', jsonb_strip_nulls(jsonb_build_object('expected_close', o.data->>'expected_close', 'expected_decision', o.data->>'expected_decision', 'won_on', (select left(h.at::text, 10) from public.crm_stage_history h where h.record_id = o.id and public.crm_stage_kind(h.to_stage) = 'won' order by h.at desc limit 1))),
    'outstanding', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due', t.data->>'due', 'assignee', t.data->>'assignee', 'status', t.status) order by t.data->>'due')
       from public.records t where t.section = 'company.tasks' and t.data->>'deal_ref' = o.id::text and coalesce(t.status, '') not in ('Completed', 'Cancelled') and public.record_visible_for(me, t)), '[]'::jsonb)
       || case when coalesce(o.data->>'next_action', '') <> '' then jsonb_build_array(jsonb_build_object('title', o.data->>'next_action', 'due', o.data->>'next_action_due', 'assignee', o.data->>'next_action_owner', 'status', 'next action')) else '[]'::jsonb end,
    'documents', coalesce((select jsonb_agg(distinct jsonb_build_object('id', x.id, 'title', x.title, 'number', x.data->>'doc_number'))
       from public.records x where x.section = 'company.documents' and x.id in (select public.as_uuid(y.data->>'document_ref') from public.records y where y.data->>'deal_ref' = o.id::text and y.section in ('sales.proposals', 'legal.contracts'))
       and public.record_visible_for(me, x)), '[]'::jsonb),
    'project', (select jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status) from public.records x where x.id = public.as_uuid(o.data->>'project_ref') and public.record_visible_for(me, x)),
    'can_handoff', public.crm_stage_kind(o.status) = 'won' and coalesce(o.data->>'project_ref', '') = '' and public._crm_can_write(me, 'company.projects'),
    'note', 'Workspace creates no project by itself: choose «Create project» or «Link existing project».');
  return pk;
end $$;
revoke execute on function public.crm_handoff(uuid) from public, anon;
grant execute on function public.crm_handoff(uuid) to authenticated;

/** Won → project: create a project with the existing project mechanism, or link one; the commercial history stays. */
create or replace function public.crm_handoff_project(p_opp uuid, p_mode text, p_project uuid default null, p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); o public.records; pr public.records; pid uuid; pk jsonb; mgr uuid; summary text;
begin
  select * into o from public.records where id = p_opp and section = 'sales.pipeline' for update;
  if me is null or not found or not public.record_visible_for(me, o) then raise exception 'Opportunity not found' using errcode = 'P0002'; end if;
  if public.crm_stage_kind(o.status) <> 'won' then raise exception 'Only a won opportunity is handed over to a project' using errcode = '55000'; end if;
  if coalesce(o.data->>'project_ref', '') <> '' then raise exception 'This opportunity is already linked to a project' using errcode = '55000'; end if;
  pk := public.crm_handoff(p_opp);
  if p_mode = 'create' then
    if not public._crm_can_write(me, 'company.projects') then raise exception 'You cannot create projects' using errcode = '42501'; end if;
    mgr := public.as_uuid(p->>'manager_id');
    if mgr is not null and not public.is_active_employee(mgr) then raise exception 'The project manager must be an active employee' using errcode = '23514'; end if;
    summary := concat_ws(E'\n\n', '**Handed over from opportunity ' || coalesce(o.data->>'number', '') || ' — ' || o.title || '**',
      case when pk->'organization' is not null then 'Organization: ' || (pk->'organization'->>'title') end,
      case when coalesce(pk->>'scope', '') <> '' then 'Scope: ' || (pk->>'scope') end,
      case when pk->'final_proposal' is not null then 'Final proposal: ' || coalesce(pk->'final_proposal'->>'number', '') || ' v' || coalesce(pk->'final_proposal'->>'version', '') || ' (' || (pk->'final_proposal'->>'status') || ')' end,
      'Commercial value: ' || coalesce(case when pk->'values'->>'final' is not null then (pk->'values'->>'final') || ' ' || coalesce(pk->'values'->>'currency', '') || ' (final agreed)'
        when pk->'values'->>'negotiated' is not null then (pk->'values'->>'negotiated') || ' ' || coalesce(pk->'values'->>'currency', '') || ' (negotiated)'
        when pk->'values'->>'quoted' is not null then (pk->'values'->>'quoted') || ' ' || coalesce(pk->'values'->>'currency', '') || ' (quoted)' end, 'not known'),
      case when jsonb_array_length(pk->'contracts') > 0 then 'Contracts: ' || (select string_agg(coalesce(c->>'number', c->>'title') || ' (' || (c->>'status') || ')', ', ') from jsonb_array_elements(pk->'contracts') c) end,
      case when jsonb_array_length(pk->'outstanding') > 0 then 'Outstanding: ' || (select string_agg(c->>'title', '; ') from jsonb_array_elements(pk->'outstanding') c) end);
    insert into public.records(section, title, status, controlled, data)
    values ('company.projects', left(coalesce(nullif(trim(p->>'title'), ''), o.title), 300), 'Planned', o.controlled,
      jsonb_strip_nulls(jsonb_build_object('manager_id', mgr, 'manager', public._crm_name(mgr), 'start', p->>'start', 'target', p->>'target', 'deal_ref', o.id, 'deal_ref_title', o.title,
        'party_ref', o.data->>'party_ref', 'party_ref_title', o.data->>'party_ref_title', 'description', summary, 'department', coalesce(p->>'department', 'operations'))))
    returning records.id into pid;
  elsif p_mode = 'link' then
    select * into pr from public.records where id = p_project and section = 'company.projects' for update;
    if not found or not public.record_visible_for(me, pr) then raise exception 'Project not found' using errcode = 'P0002'; end if;
    if not public._crm_can_write(me, 'company.projects') then raise exception 'You cannot change projects' using errcode = '42501'; end if;
    if coalesce(pr.data->>'deal_ref', '') not in ('', o.id::text) then raise exception 'That project already belongs to another opportunity' using errcode = '55000'; end if;
    perform public._wf_rec_patch(pr.id, null, jsonb_build_object('deal_ref', o.id, 'deal_ref_title', o.title));
    pid := pr.id;
  else raise exception 'Choose «create» or «link»' using errcode = '22023';
  end if;
  perform public._crm_patch(o.id, jsonb_build_object('project_ref', pid, 'project_ref_title', (select title from public.records where id = pid),
    'handoff_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 'handoff_by', public._crm_name(me)), 'Handed over to a project');
  insert into public.crm_audit(actor, kind, record_id, detail) values (me, 'handoff', o.id, jsonb_build_object('mode', p_mode, 'project', pid, 'package', pk));
  return jsonb_build_object('ok', true, 'project', pid, 'mode', p_mode);
end $$;
revoke execute on function public.crm_handoff_project(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.crm_handoff_project(uuid, text, uuid, jsonb) to authenticated;

/** Merge two organisations (or two contacts): references move to the kept one; the merged record stays, marked. */
create or replace function public.crm_merge(p_kind text, p_keep uuid, p_merge uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); sec text := case when p_kind = 'organization' then 'company.parties' when p_kind = 'contact' then 'company.contacts' end;
  k public.records; m public.records; keys text[]; key text; moved jsonb := '[]'::jsonb; x record; n int;
begin
  if me is null or not public.has_cap(me, 'commercial_admin') then raise exception 'Only a Commercial Admin merges records' using errcode = '42501'; end if;
  if sec is null then raise exception 'Merge organizations or contacts' using errcode = '22023'; end if;
  if p_keep = p_merge then raise exception 'Choose two different records' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Say why these are the same' using errcode = '23514'; end if;
  select * into k from public.records where id = p_keep and section = sec for update;
  select * into m from public.records where id = p_merge and section = sec for update;
  if k.id is null or m.id is null or not public.record_visible_for(me, k) or not public.record_visible_for(me, m) then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if coalesce(m.data->>'merged_into', '') <> '' then raise exception 'That record was already merged' using errcode = '55000'; end if;
  keys := case when sec = 'company.parties' then array['party_ref', 'introduced_by_ref', 'introducer_party_ref', 'introduced_party_ref', 'technical_support_ref', 'local_support_ref',
            'commercial_support_ref', 'relationship_support_ref', 'introducer_ref', 'payee_ref']
          else array['contact_ref', 'introduced_by_contact_ref', 'introducer_contact_ref', 'introduced_contact_ref'] end;
  foreach key in array keys loop
    for x in select r.id from public.records r where r.data->>key = m.id::text for update loop
      perform public._wf_rec_patch(x.id, null, jsonb_build_object(key, k.id, key || '_title', k.title));
      moved := moved || jsonb_build_object('record', x.id, 'field', key);
    end loop;
  end loop;
  perform public._wf_rec_patch(m.id, 'Inactive', jsonb_build_object('merged_into', k.id, 'merged_into_title', k.title));
  if sec = 'company.parties' then
    perform public._wf_rec_patch(k.id, null, jsonb_build_object('aliases', trim(both ', ' from concat_ws(', ', nullif(k.data->>'aliases', ''), m.title)),
      'relationship_types', (select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from jsonb_array_elements(coalesce(k.data->'relationship_types', '[]'::jsonb) || coalesce(m.data->'relationship_types', '[]'::jsonb)) v)));
  end if;
  insert into public.crm_audit(actor, kind, record_id, detail) values (me, 'merge', k.id, jsonb_build_object('kind', p_kind, 'kept', k.id, 'merged', m.id, 'reason', left(p_reason, 300),
    'merged_snapshot', jsonb_build_object('title', m.title, 'status', m.status, 'data', m.data), 'moved', moved));
  return jsonb_build_object('ok', true, 'moved', jsonb_array_length(moved));
end $$;
revoke execute on function public.crm_merge(text, uuid, uuid, text) from public, anon;
grant execute on function public.crm_merge(text, uuid, uuid, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   10. Read models for one viewer. The opportunities the viewer may open are copied once per statement into a
       transaction-local table with what the engines need (stage age, last interaction, sent proposal, NDA,
       follow-up reasons, health). A record the viewer cannot open takes part in no number, list or reason.
   --------------------------------------------------------------------------------------------- */
create or replace function public._crm_date(t text) returns date language sql immutable parallel safe as $$
  select case when t ~ '^\d{4}-\d{2}-\d{2}' then left(t, 10)::date end
$$;

-- NDA status of an opportunity from its NDA contract (the contract is the source); the field is used only without one
create or replace function public._crm_nda(o jsonb, c_status text, c_end text) returns text language sql immutable as $$
  select case
    when c_status is not null then case
      when c_status in ('Signed', 'Active', 'Renewal') then case when public._crm_date(c_end) < current_date then 'Expired' else 'Signed' end
      when c_status in ('Expired', 'Closed') then 'Expired'
      when c_status in ('Counterparty review') then 'Sent'
      when c_status in ('Negotiation', 'Counsel review', 'Signature', 'Approval') then 'Under review'
      when c_status in ('Rejected', 'Cancelled') then coalesce(nullif(o->>'nda_status', ''), 'Required')
      else 'Requested' end
    when coalesce(o->>'nda_status', '') <> '' then o->>'nda_status'
    when o->>'q_nda' = 'Yes' then 'Required'
    else null end
$$;

-- the row of the working set (a type, so that the list helpers can take a whole row)
drop type if exists public.crm_vrow cascade;
create type public.crm_vrow as (id uuid, title text, stage text, kind text, data jsonb, controlled boolean, created_by uuid, created_at timestamptz, updated_at timestamptz,
      number text, party_id uuid, party_title text, contact_id uuid, owner_id uuid, owner text, value numeric, quoted numeric, approved numeric, negotiated numeric, final numeric, currency text,
      prob numeric, prob_source text, decision_on date, close_on date, next_action text, next_due date, next_owner uuid, waiting_for text, waiting_since date,
      stage_since timestamptz, last_at timestamptz, last_kind text, last_title text, last_ref uuid, sent_at date, sent_ref uuid, sent_title text, meeting_on date, meeting_ref uuid,
      nda text, nda_since timestamptz, hold_review date, geography text, product text, use_case text, source text, introduced_by uuid, lead_ref uuid, event_ref uuid, restricted boolean,
      health text, reasons jsonb);

create or replace function public._crm_base(p_viewer uuid) returns void
language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare p record; secs text[]; fu jsonb := coalesce(public.crm_cfg()->'followup', '{}'::jsonb); pid text; today date := (now() at time zone 'utc')::date;
  st jsonb := coalesce(public.crm_cfg()->'pipeline', '[]'::jsonb);
begin
  if to_regclass('pg_temp.crm_meta') is null then
    create temp table crm_meta (viewer uuid, at timestamptz) on commit drop;
    create temp table crm_v of public.crm_vrow (id with options primary key, health with options not null default 'Healthy', reasons with options not null default '[]'::jsonb) on commit drop;
  end if;
  if exists (select 1 from pg_temp.crm_meta m where m.viewer is not distinct from p_viewer and m.at = statement_timestamp()) then return; end if;
  truncate pg_temp.crm_v; delete from pg_temp.crm_meta;
  select pp.id, pp.role, coalesce(pp.us_person, false) us into p from public.profiles pp where pp.id = p_viewer and not pp.disabled;
  if found and p.role is not null and p.role not in ('partner', 'vendor', 'investor', 'pending') then
    pid := p.id::text;
    select coalesce(array_agg(a.section), '{}') into secs from public.section_access a where a.role = p.role;
    if p.role in ('owner', 'admin') or 'sales.pipeline' = any(secs) then
      -- exactly the reading rule (record_visible_for; tested to be equal): section, US persons only, restricted opportunities
      insert into pg_temp.crm_v (id, title, stage, kind, data, controlled, created_by, created_at, updated_at, number, party_id, party_title, contact_id, owner_id, owner,
        value, quoted, approved, negotiated, final, currency, prob, prob_source, decision_on, close_on, next_action, next_due, next_owner, waiting_for, waiting_since, hold_review,
        geography, product, use_case, source, introduced_by, lead_ref, restricted)
      select r.id, r.title, r.status, coalesce(s->>'kind', 'open'), r.data, r.controlled, r.created_by, r.created_at, r.updated_at, r.data->>'number',
        public.as_uuid(r.data->>'party_ref'), coalesce(r.data->>'party_ref_title', r.data->>'client'), public.as_uuid(r.data->>'contact_ref'), public.as_uuid(r.data->>'owner_id'), r.data->>'owner',
        public._num(r.data->'value'), public._num(r.data->'quoted_value'), public._num(r.data->'approved_value'), public._num(r.data->'negotiated_value'), public._num(r.data->'final_value'),
        nullif(r.data->>'currency', ''),
        coalesce(public._num(r.data->'probability'), public._num(s->'probability')), case when public._num(r.data->'probability') is not null then 'manual' when public._num(s->'probability') is not null then 'stage default' end,
        public._crm_date(r.data->>'expected_decision'), public._crm_date(r.data->>'expected_close'), nullif(trim(r.data->>'next_action'), ''), public._crm_date(r.data->>'next_action_due'),
        public.as_uuid(r.data->>'next_action_owner_id'), nullif(r.data->>'waiting_for', ''), public._crm_date(r.data->>'waiting_since'), public._crm_date(r.data->>'hold_review'),
        nullif(r.data->>'geography', ''), nullif(r.data->>'product', ''), nullif(r.data->>'use_case', ''), nullif(r.data->>'source', ''), public.as_uuid(r.data->>'introduced_by_ref'),
        public.as_uuid(r.data->>'lead_ref'), coalesce((r.data->>'restricted')::boolean, false)
      from public.records r left join lateral (select x from jsonb_array_elements(st) x where x->>'stage' = r.status limit 1) ss(s) on true
      where r.section = 'sales.pipeline'
        and (coalesce(r.controlled, true) = false or p.us)
        and (not coalesce((r.data->>'restricted')::boolean, false) or p.role in ('owner', 'management') or r.created_by = p.id
             or coalesce(r.data->>'owner_id', '') = pid or coalesce(r.data->>'next_action_owner_id', '') = pid
             or coalesce(r.data->'team_ids', '[]'::jsonb) ? pid or coalesce(r.data->'access_ids', '[]'::jsonb) ? pid);
      -- when the current stage began (stage history; the record's creation before v24 history existed)
      update pg_temp.crm_v v set stage_since = h.at from (
        select distinct on (h.record_id) h.record_id, h.at from public.crm_stage_history h join pg_temp.crm_v x on x.id = h.record_id and h.to_stage = x.stage order by h.record_id, h.at desc) h
      where h.record_id = v.id;
      update pg_temp.crm_v set stage_since = created_at where stage_since is null;
      -- the last interaction: a call, note or e-mail done, a meeting held, a proposal sent, a confirmed e-mail link
      update pg_temp.crm_v v set last_at = t.at, last_kind = t.k, last_title = t.title, last_ref = t.id from (
        select distinct on (oid) oid, at, k, title, id from (
          select public.as_uuid(a.data->>'deal_ref') oid, coalesce(public._crm_date(a.data->>'date')::timestamptz, a.created_at) at, coalesce(a.data->>'type', 'Note') k, a.title, a.id
          from public.records a join pg_temp.crm_v x on a.data->>'deal_ref' = x.id::text
          where a.section = 'sales.activities' and a.status = 'Done' and (coalesce(a.controlled, true) = false or p.us)
          union all
          select public.as_uuid(m.data->>'deal_ref'), coalesce(public._crm_date(m.data->>'date')::timestamptz, m.created_at), 'Meeting', m.title, m.id
          from public.records m join pg_temp.crm_v x on m.data->>'deal_ref' = x.id::text
          where m.section = 'company.meetings' and coalesce(m.status, '') <> 'Cancelled' and (m.status = 'Done' or public._crm_date(m.data->>'date') <= today) and (coalesce(m.controlled, true) = false or p.us)
          union all
          select public.as_uuid(q.data->>'deal_ref'), public._crm_date(q.data->>'sent_at')::timestamptz, 'Proposal sent', q.title, q.id
          from public.records q join pg_temp.crm_v x on q.data->>'deal_ref' = x.id::text
          where q.section = 'sales.proposals' and coalesce(q.data->>'sent_at', '') <> '' and (coalesce(q.controlled, true) = false or p.us)
          union all
          select l.target_id, l.decided_at, 'E-mail', l.subject, null from public.crm_email_links l join pg_temp.crm_v x on x.id = l.target_id where l.status = 'confirmed'
        ) u where at is not null order by oid, at desc) t
      where t.oid = v.id;
      -- the proposal waiting for an answer (the latest version sent and not yet accepted, rejected or replaced)
      update pg_temp.crm_v v set sent_at = q.sent, sent_ref = q.id, sent_title = q.title from (
        select distinct on (q.data->>'deal_ref') q.data->>'deal_ref' oid, public._crm_date(q.data->>'sent_at') sent, q.id, q.title
        from public.records q join pg_temp.crm_v x on q.data->>'deal_ref' = x.id::text
        where q.section = 'sales.proposals' and q.status = 'Sent' and (coalesce(q.controlled, true) = false or p.us)
        order by q.data->>'deal_ref', public._crm_date(q.data->>'sent_at') desc nulls last) q
      where q.oid = v.id::text;
      update pg_temp.crm_v v set meeting_on = m.d, meeting_ref = m.id from (
        select distinct on (m.data->>'deal_ref') m.data->>'deal_ref' oid, public._crm_date(m.data->>'date') d, m.id
        from public.records m join pg_temp.crm_v x on m.data->>'deal_ref' = x.id::text
        where m.section = 'company.meetings' and coalesce(m.status, '') <> 'Cancelled' and (m.status = 'Done' or public._crm_date(m.data->>'date') <= today) and (coalesce(m.controlled, true) = false or p.us)
        order by m.data->>'deal_ref', public._crm_date(m.data->>'date') desc nulls last) m
      where m.oid = v.id::text;
      -- NDA: the linked NDA contract when the viewer may open it; otherwise the field on the opportunity
      update pg_temp.crm_v v set nda = public._crm_nda(v.data, c.status, c.end_date), nda_since = c.updated_at from (
        select distinct on (x.id) x.id oid, c.status, c.data->>'end_date' end_date, c.updated_at
        from pg_temp.crm_v x join public.records c on c.section = 'legal.contracts' and (c.id::text = x.data->>'nda_ref' or (c.data->>'deal_ref' = x.id::text and c.data->>'type' = 'NDA'))
        where public.record_visible_for(p.id, c)
        order by x.id, (c.id::text = x.data->>'nda_ref') desc, c.updated_at desc) c
      where c.oid = v.id;
      update pg_temp.crm_v v set nda = public._crm_nda(v.data, null, null) where v.nda is null;
      update pg_temp.crm_v v set event_ref = public.as_uuid(l.data->>'event_ref') from public.records l where l.id = v.lead_ref and l.section = 'marketing.leads';
      -- follow-up and stall reasons: deterministic rules (Commercial → Settings), each with its date
      update pg_temp.crm_v v set reasons = z.r from (
        select x.id, coalesce(jsonb_agg(e) filter (where e is not null), '[]'::jsonb) r from pg_temp.crm_v x, lateral (values
          (case when x.kind = 'open' and x.owner_id is null and coalesce(x.owner, '') = '' then jsonb_build_object('code', 'no_owner', 'severity', 'attention', 'text', 'No AGRON owner') end),
          (case when x.kind = 'open' and (x.next_action is null or x.next_due is null) then jsonb_build_object('code', 'no_next_action', 'severity', 'attention', 'text', 'No next action with a date') end),
          (case when x.kind = 'open' and x.next_due < today then jsonb_build_object('code', 'overdue_follow_up', 'severity', 'risk', 'text', 'Next action overdue since ' || x.next_due, 'since', x.next_due) end),
          (case when x.kind = 'open' and coalesce(x.last_at, x.created_at) < now() - make_interval(days => coalesce((fu->>'no_interaction_days')::int, 14))
                then jsonb_build_object('code', 'no_interaction', 'severity', 'stalled', 'text', case when x.last_at is null then 'No interaction recorded since it was created ' || left(x.created_at::text, 10)
                     else 'No interaction for ' || (today - x.last_at::date) || ' days (last: ' || x.last_kind || ', ' || left(x.last_at::text, 10) || ')' end, 'since', coalesce(x.last_at, x.created_at)::date) end),
          (case when x.kind = 'open' and x.sent_at is not null and x.sent_at < today - coalesce((fu->>'proposal_no_response_days')::int, 10) and coalesce(x.last_at::date, x.sent_at) <= x.sent_at
                then jsonb_build_object('code', 'proposal_no_response', 'severity', 'stalled', 'text', 'Proposal sent ' || x.sent_at || ' without a response or follow-up', 'since', x.sent_at, 'ref', x.sent_ref) end),
          (case when x.kind = 'open' and x.meeting_on is not null and x.meeting_on <= today - coalesce((fu->>'meeting_no_next_step_days')::int, 3) and (x.next_due is null or x.next_action is null or x.next_due < x.meeting_on)
                then jsonb_build_object('code', 'meeting_no_next_step', 'severity', 'attention', 'text', 'Meeting held ' || x.meeting_on || ' but no next step after it', 'since', x.meeting_on, 'ref', x.meeting_ref) end),
          (case when x.kind = 'open' and x.nda in ('Sent', 'Under review') and coalesce(x.nda_since, x.waiting_since::timestamptz, x.updated_at) < now() - make_interval(days => coalesce((fu->>'nda_waiting_days')::int, 14))
                then jsonb_build_object('code', 'nda_waiting', 'severity', 'attention', 'text', 'NDA ' || lower(x.nda) || ' since ' || left(coalesce(x.nda_since, x.waiting_since::timestamptz, x.updated_at)::text, 10)) end),
          (case when x.kind = 'open' and x.stage = 'Negotiation' and x.stage_since < now() - make_interval(days => coalesce((fu->>'negotiation_stalled_days')::int, 21))
                then jsonb_build_object('code', 'negotiation_stalled', 'severity', 'stalled', 'text', 'In negotiation unchanged since ' || left(x.stage_since::text, 10), 'since', x.stage_since::date) end),
          (case when x.kind = 'open' and x.decision_on < today then jsonb_build_object('code', 'decision_passed', 'severity', 'risk', 'text', 'Expected decision date passed (' || x.decision_on || ')', 'since', x.decision_on) end),
          (case when x.kind = 'open' and x.waiting_for is not null and coalesce(x.waiting_since, x.updated_at::date) < today - coalesce((fu->>'waiting_long_days')::int, 10)
                then jsonb_build_object('code', 'waiting_long', 'severity', 'attention', 'text', 'Waiting for ' || lower(x.waiting_for) || ' since ' || coalesce(x.waiting_since, x.updated_at::date), 'since', coalesce(x.waiting_since, x.updated_at::date)) end),
          (case when x.kind = 'open' and x.stage <> 'Negotiation' and x.stage_since < now() - make_interval(days => coalesce((fu->>'stage_age_days')::int, 60))
                then jsonb_build_object('code', 'stage_age', 'severity', 'attention', 'text', 'In «' || x.stage || '» since ' || left(x.stage_since::text, 10), 'since', x.stage_since::date) end),
          (case when x.kind = 'hold' and x.hold_review <= today then jsonb_build_object('code', 'hold_review', 'severity', 'attention', 'text', 'On hold — review date reached (' || x.hold_review || ')', 'since', x.hold_review) end)
        ) e(e) group by x.id) z
      where z.id = v.id;
      update pg_temp.crm_v set health = case
        when reasons @> '[{"severity": "stalled"}]' then 'Stalled' when reasons @> '[{"severity": "risk"}]' then 'Risk'
        when jsonb_array_length(reasons) > 0 then 'Attention' else 'Healthy' end;
    end if;
  end if;
  analyze pg_temp.crm_v;
  insert into pg_temp.crm_meta(viewer, at) values (p_viewer, statement_timestamp());
end $$;
revoke execute on function public._crm_base(uuid) from public, anon, authenticated;

-- one opportunity as a list row
create or replace function public._crm_row(v public.crm_vrow) returns jsonb language sql stable as $$
  select jsonb_build_object('id', v.id, 'number', v.number, 'title', v.title, 'stage', v.stage, 'kind', v.kind, 'party_id', v.party_id, 'party', v.party_title, 'owner_id', v.owner_id, 'owner', v.owner,
    'value', v.value, 'quoted', v.quoted, 'negotiated', v.negotiated, 'final', v.final, 'currency', v.currency, 'probability', v.prob, 'probability_source', v.prob_source,
    'expected_decision', v.decision_on, 'expected_close', v.close_on, 'next_action', v.next_action, 'next_action_due', v.next_due, 'waiting_for', v.waiting_for,
    'last_at', v.last_at, 'last_kind', v.last_kind, 'health', v.health, 'reasons', v.reasons, 'nda', v.nda, 'geography', v.geography, 'product', v.product, 'source', v.source,
    'restricted', v.restricted, 'controlled', v.controlled, 'sent_at', v.sent_at, 'stage_since', v.stage_since)
$$;

-- the filters a list may use (all optional): geography, product, owner, source, stage, event, currency, minimum value, text
create or replace function public._crm_match(v public.crm_vrow, f jsonb, q text) returns boolean language sql stable as $$
  select (coalesce(f->>'geography', '') = '' or v.geography = f->>'geography')
     and (coalesce(f->>'product', '') = '' or v.product = f->>'product')
     and (coalesce(f->>'owner_id', '') = '' or v.owner_id::text = f->>'owner_id')
     and (coalesce(f->>'source', '') = '' or v.source = f->>'source')
     and (coalesce(f->>'stage', '') = '' or v.stage = f->>'stage')
     and (coalesce(f->>'event_ref', '') = '' or v.event_ref::text = f->>'event_ref')
     and (coalesce(f->>'currency', '') = '' or v.currency = f->>'currency')
     and (public._num(f->'min_value') is null or greatest(coalesce(v.final, 0), coalesce(v.negotiated, 0), coalesce(v.quoted, 0), coalesce(v.value, 0)) >= public._num(f->'min_value'))
     and (coalesce(q, '') = '' or lower(concat_ws(' ', v.title, v.number, v.party_title, v.owner)) like '%' || lower(q) || '%')
$$;

create or replace function public._crm_kind_ok(v public.crm_vrow, p_kind text, p_me uuid) returns boolean language sql stable as $$
  select case
    when p_kind = 'all' then true
    when p_kind = 'active' then v.kind = 'open'
    when p_kind = 'mine' then v.kind in ('open', 'hold') and (v.owner_id = p_me or v.next_owner = p_me)
    when p_kind = 'needs_action' then (v.owner_id = p_me or v.next_owner = p_me or (v.owner_id is null and v.created_by = p_me)) and jsonb_array_length(v.reasons) > 0
    when p_kind = 'attention_all' then jsonb_array_length(v.reasons) > 0
    when p_kind like 'stage:%' then v.stage = substr(p_kind, 7)
    when p_kind = 'proposals_waiting' then v.kind = 'open' and v.sent_ref is not null
    when p_kind = 'responses' then v.kind = 'open' and v.waiting_for is not null
    when p_kind = 'upcoming_decisions' then v.kind = 'open' and v.decision_on between current_date and current_date + 30
    when p_kind = 'stalled' then v.health = 'Stalled'
    when p_kind = 'risk' then v.health = 'Risk'
    when p_kind = 'no_next_action' then v.reasons @> '[{"code": "no_next_action"}]'
    when p_kind = 'overdue' then v.reasons @> '[{"code": "overdue_follow_up"}]'
    when p_kind = 'decision_passed' then v.reasons @> '[{"code": "decision_passed"}]'
    when p_kind = 'hold_review' then v.reasons @> '[{"code": "hold_review"}]'
    when p_kind = 'nda_unsigned' then v.kind = 'open' and v.nda in ('Required', 'Requested', 'Sent', 'Under review', 'Expired')
    when p_kind = 'wins' then v.kind = 'won' and v.stage_since >= now() - interval '30 days'
    when p_kind = 'losses' then v.kind = 'lost' and v.stage_since >= now() - interval '30 days'
    when p_kind = 'won' then v.kind = 'won'
    when p_kind = 'lost' then v.kind = 'lost'
    when p_kind = 'hold' then v.kind = 'hold'
    else false end
$$;

create or replace function public.crm_list(p_kind text, p_q text default null, p_limit integer default 200, p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._crm_base(me);
  return coalesce((select jsonb_agg(public._crm_row(v) order by
      case v.health when 'Stalled' then 0 when 'Risk' then 1 when 'Attention' then 2 else 3 end, coalesce(v.next_due, v.decision_on, v.close_on, '9999-12-31'), v.number)
    from (select * from pg_temp.crm_v v where public._crm_kind_ok(v, p_kind, me) and public._crm_match(v, coalesce(p_filter, '{}'::jsonb), p_q)
          order by case v.health when 'Stalled' then 0 when 'Risk' then 1 when 'Attention' then 2 else 3 end, coalesce(v.next_due, v.decision_on, v.close_on, '9999-12-31'), v.number
          limit least(greatest(coalesce(p_limit, 200), 1), 1000)) v), '[]'::jsonb);
end $$;
revoke execute on function public.crm_list(text, text, integer, jsonb) from public, anon;
grant execute on function public.crm_list(text, text, integer, jsonb) to authenticated;

-- money per currency, never added across currencies
create or replace function public._crm_sums(p_rows jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(c, s), '{}'::jsonb) from (select coalesce(x->>'currency', '(no currency)') c, sum(public._num(x->'amount')) s from jsonb_array_elements(p_rows) x where public._num(x->'amount') is not null group by 1) z
$$;

/** The Commercial dashboard: every number is a list the viewer can open (crm_list with the same kind). */
create or replace function public.crm_overview(p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); out jsonb := '{}'::jsonb; k text; f jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._crm_base(me);
  foreach k in array array['needs_action', 'active', 'proposals_waiting', 'responses', 'upcoming_decisions', 'stalled', 'wins', 'losses', 'attention_all', 'risk', 'no_next_action', 'overdue', 'hold_review', 'nda_unsigned'] loop
    out := out || jsonb_build_object(k, (select jsonb_build_object('count', count(*),
      'value', public._crm_sums(coalesce(jsonb_agg(jsonb_build_object('currency', v.currency, 'amount', coalesce(v.final, v.negotiated, v.quoted, v.value))), '[]'::jsonb)))
      from pg_temp.crm_v v where public._crm_kind_ok(v, k, me) and public._crm_match(v, f, null)));
  end loop;
  return jsonb_build_object('at', now(), 'blocks', out,
    'pipeline', coalesce((select jsonb_agg(z order by z.ord) from (
      select s.ord, s.stage, s.kind, count(v.id) n,
        public._crm_sums(coalesce(jsonb_agg(jsonb_build_object('currency', v.currency, 'amount', v.value)) filter (where v.id is not null), '[]'::jsonb)) estimated,
        public._crm_sums(coalesce(jsonb_agg(jsonb_build_object('currency', v.currency, 'amount', v.quoted)) filter (where v.id is not null), '[]'::jsonb)) quoted,
        public._crm_sums(coalesce(jsonb_agg(jsonb_build_object('currency', v.currency, 'amount', v.negotiated)) filter (where v.id is not null), '[]'::jsonb)) negotiated
      from (select x->>'stage' stage, coalesce(x->>'kind', 'open') kind, o ord from jsonb_array_elements(public.crm_cfg()->'pipeline') with ordinality t(x, o)) s
      left join pg_temp.crm_v v on v.stage = s.stage and public._crm_match(v, f, null)
      group by s.ord, s.stage, s.kind) z), '[]'::jsonb),
    'leads_due', (select count(*) from public.records l where l.section = 'marketing.leads' and l.data->>'owner_id' = me::text and coalesce(l.status, 'New') in ('New', 'Reviewing', 'Qualified')
      and public._crm_date(l.data->>'follow_up') <= current_date),
    'note', 'Every number opens the opportunities behind it. Values are per currency and never added across currencies.');
end $$;
revoke execute on function public.crm_overview(jsonb) from public, anon;
grant execute on function public.crm_overview(jsonb) to authenticated;

/** Pipeline value: estimated, quoted, negotiated and won kept apart; raw and weighted (a management estimate). */
create or replace function public.crm_pipeline_value(p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); f jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._crm_base(me);
  return jsonb_build_object('currencies', coalesce((select jsonb_agg(z order by z.currency) from (
      select coalesce(v.currency, '(no currency)') currency,
        count(*) filter (where v.kind = 'open') open_count,
        sum(v.value) filter (where v.kind = 'open') estimated, sum(v.value * v.prob / 100) filter (where v.kind = 'open') estimated_weighted,
        sum(v.quoted) filter (where v.kind = 'open') quoted, sum(v.quoted * v.prob / 100) filter (where v.kind = 'open') quoted_weighted,
        sum(v.negotiated) filter (where v.kind = 'open') negotiated, sum(v.negotiated * v.prob / 100) filter (where v.kind = 'open') negotiated_weighted,
        count(*) filter (where v.kind = 'open' and v.prob is null) no_probability,
        count(*) filter (where v.kind = 'open' and v.prob_source = 'manual') probability_manual,
        count(*) filter (where v.kind = 'won') won_count, sum(v.final) filter (where v.kind = 'won') won_final,
        count(*) filter (where v.kind = 'won' and v.final is null) won_without_final
      from pg_temp.crm_v v where public._crm_match(v, f, null) and v.kind in ('open', 'won') group by 1) z), '[]'::jsonb),
    'labels', jsonb_build_object('raw', 'Raw pipeline: the values as entered, per currency', 'weighted', 'Weighted pipeline = value × probability. A management estimate, not revenue.',
      'probability', 'Probability is the manual estimate on the opportunity, otherwise the stage default (Commercial → Settings).',
      'won', 'Won value is the final agreed value where it is known; won opportunities without it are counted, not guessed.'));
end $$;
revoke execute on function public.crm_pipeline_value(jsonb) from public, anon;
grant execute on function public.crm_pipeline_value(jsonb) to authenticated;

/** Forecast by expected decision / close date: each row says which value it uses; totals per currency and value type. */
create or replace function public.crm_forecast(p_from date default null, p_to date default null, p_bucket text default 'month', p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); a date := coalesce(p_from, date_trunc('month', current_date)::date); b date := coalesce(p_to, (date_trunc('quarter', current_date) + interval '3 months' - interval '1 day')::date);
  bk text := case when p_bucket in ('month', 'quarter', 'custom') then p_bucket else 'month' end;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if b < a or b - a > 800 then raise exception 'Choose a period of up to about two years' using errcode = '22023'; end if;
  perform public._crm_base(me);
  return (with rows as (
      select v.*, coalesce(v.decision_on, v.close_on) at_date,
        case when v.negotiated is not null then 'negotiated' when v.quoted is not null then 'quoted' when v.value is not null then 'estimate' end basis,
        coalesce(v.negotiated, v.quoted, v.value) amount
      from pg_temp.crm_v v where v.kind = 'open' and coalesce(v.decision_on, v.close_on) between a and b and public._crm_match(v, coalesce(p_filter, '{}'::jsonb), null)),
    bucketed as (select r.*, case bk when 'quarter' then to_char(r.at_date, 'YYYY-"Q"Q') when 'custom' then a::text || '…' || b::text else to_char(r.at_date, 'YYYY-MM') end bucket from rows r)
    select jsonb_build_object('from', a, 'to', b, 'bucket', bk,
      'totals', coalesce((select jsonb_agg(t order by t.bucket, t.currency, t.basis) from (
        select bucket, coalesce(currency, '(no currency)') currency, basis, count(*) n, sum(amount) amount, sum(amount * prob / 100) weighted, count(*) filter (where prob is null) no_probability
        from bucketed where amount is not null group by bucket, currency, basis) t), '[]'::jsonb),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.number, 'title', x.title, 'stage', x.stage, 'owner', x.owner, 'party', x.party_title, 'bucket', x.bucket,
          'expected', x.at_date, 'value', x.amount, 'basis', x.basis, 'currency', x.currency, 'probability', x.prob, 'probability_source', x.prob_source,
          'weighted', x.amount * x.prob / 100, 'next_action', x.next_action, 'next_action_due', x.next_due) order by x.at_date, x.number) from bucketed x), '[]'::jsonb),
      'note', 'A forecast of open opportunities by their expected decision (or close) date. Weighted values are management estimates, not revenue. Currencies are never added together.'));
end $$;
revoke execute on function public.crm_forecast(date, date, text, jsonb) from public, anon;
grant execute on function public.crm_forecast(date, date, text, jsonb) to authenticated;

/** Commercial Waiting For: what AGRON waits for from customers and partners (the opportunity field and Waiting tasks). */
create or replace function public.crm_waiting() returns jsonb language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._crm_base(me);
  return coalesce((select jsonb_agg(z order by z.age desc nulls last) from (
    select 'opportunity' kind, v.id, v.id opp_id, v.number, v.title opp, v.party_title party, (select c.title from public.records c where c.id = v.contact_id) contact, v.waiting_for,
      (current_date - coalesce(v.waiting_since, v.updated_at::date)) age, v.last_at last_contact, v.owner responsible, v.next_due next_follow_up, '/crm?opp=' || v.id link
    from pg_temp.crm_v v where v.kind in ('open', 'hold') and v.waiting_for is not null
    union all
    select 'task', t.id, v.id, v.number, v.title, v.party_title, t.data->>'waiting_on', coalesce(t.data->>'waiting_kind', 'Waiting') || ': ' || t.title,
      (current_date - coalesce(public._crm_date(t.data->>'waiting_since'), t.updated_at::date)), v.last_at, t.data->>'assignee', public._crm_date(t.data->>'due'), '/company/tasks?r=' || t.id
    from pg_temp.crm_v v join public.records t on t.section = 'company.tasks' and t.data->>'deal_ref' = v.id::text and t.status = 'Waiting'
    where public.record_visible_for(me, t)) z), '[]'::jsonb);
end $$;
revoke execute on function public.crm_waiting() from public, anon;
grant execute on function public.crm_waiting() to authenticated;

/** Who to follow up with: my overdue and due opportunities (with the reasons) and my leads due. */
create or replace function public.crm_followups(p_scope text default 'mine') returns jsonb language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); all_ boolean := p_scope = 'all';
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._crm_base(me);
  return jsonb_build_object(
    'opportunities', coalesce((select jsonb_agg(public._crm_row(v) order by coalesce(v.next_due, '9999-12-31'), v.number) from pg_temp.crm_v v
       where v.kind in ('open', 'hold') and (all_ or v.owner_id = me or v.next_owner = me)
         and (v.next_due <= current_date + coalesce((public.crm_cfg()->'followup'->>'due_soon_days')::int, 2) or jsonb_array_length(v.reasons) > 0)), '[]'::jsonb),
    'leads', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'organization', l.data->>'organization', 'follow_up', l.data->>'follow_up', 'owner', l.data->>'owner',
         'importance', l.data->>'importance', 'status', l.status, 'event', l.data->>'event_ref_title', 'overdue', public._crm_date(l.data->>'follow_up') < current_date) order by l.data->>'follow_up')
       from public.records l where l.section = 'marketing.leads' and coalesce(l.status, 'New') in ('New', 'Reviewing', 'Qualified')
         and (all_ or l.data->>'owner_id' = me::text) and public._crm_date(l.data->>'follow_up') <= current_date + 1 and public.record_visible_for(me, l)), '[]'::jsonb));
end $$;
revoke execute on function public.crm_followups(text) from public, anon;
grant execute on function public.crm_followups(text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   11. One opportunity, organisation or contact: detail, one timeline (links to the underlying records, no copies),
       relationships; leads and event views
   --------------------------------------------------------------------------------------------- */
create or replace function public.crm_opp(p_id uuid) returns jsonb language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); r public.records; v public.crm_vrow;
begin
  select * into r from public.records where id = p_id and section = 'sales.pipeline';
  if me is null or not found or not public.record_visible_for(me, r) then raise exception 'Opportunity not found' using errcode = 'P0002'; end if;
  perform public._crm_base(me);
  select * into v from pg_temp.crm_v where id = p_id;
  return jsonb_build_object('record', jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'data', r.data, 'version', r.version, 'controlled', r.controlled, 'updated_at', r.updated_at),
    'row', public._crm_row(v),
    'stages', public.crm_cfg()->'pipeline',
    'qualification', (select jsonb_object_agg(k, coalesce(r.data->>k, 'Unknown')) from unnest(array['q_requirement', 'q_fit', 'q_decision_maker', 'q_budget', 'q_timeline', 'q_technical', 'q_nda', 'q_procurement', 'q_next_step']) k),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'number', p.data->>'number', 'version', p.data->>'version', 'status', p.status, 'value', public._num(p.data->'value'),
        'currency', p.data->>'currency', 'discount', p.data->>'discount', 'valid_until', p.data->>'valid_until', 'sent_at', p.data->>'sent_at', 'approved_at', p.data->>'approved_at',
        'document_version_id', p.data->>'document_version_id', 'supersedes_ref', p.data->>'supersedes_ref',
        'process', (select jsonb_build_object('id', i.id, 'status', i.status, 'step', i.current_step) from public.wf_instances i where i.record_id = p.id and i.def_code = 'PROPOSAL' order by i.created_at desc limit 1),
        'approved_current', case when p.status in ('Approved', 'Sent', 'Accepted') then public._crm_proposal_approved(p) end)
        order by p.data->>'number', public._num(p.data->'version') desc)
      from public.records p where p.section = 'sales.proposals' and p.data->>'deal_ref' = r.id::text and public.record_visible_for(me, p)), '[]'::jsonb),
    'nda', jsonb_build_object('status', v.nda, 'contract', (select jsonb_build_object('id', c.id, 'number', c.data->>'number', 'title', c.title, 'status', c.status, 'signed_on', c.data->>'signed_on',
        'start_date', c.data->>'start_date', 'end_date', c.data->>'end_date', 'document_ref', c.data->>'document_ref', 'signed_version_id', c.data->>'signed_version_id',
        'signed_version', (select jsonb_build_object('version', dv.version, 'file_name', dv.file_name, 'created_at', dv.created_at) from public.document_versions dv where dv.id = public.as_uuid(c.data->>'signed_version_id')))
      from public.records c where c.section = 'legal.contracts' and (c.id::text = r.data->>'nda_ref' or (c.data->>'deal_ref' = r.id::text and c.data->>'type' = 'NDA')) and public.record_visible_for(me, c)
      order by (c.id::text = r.data->>'nda_ref') desc, c.updated_at desc limit 1),
      'note', 'An NDA does not by itself permit sharing any particular information: the access rules decide what each person may see.'),
    'values', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'amount', x.amount, 'currency', x.currency, 'prev_amount', x.prev_amount, 'prev_currency', x.prev_currency,
        'at', x.at, 'by', public._crm_name(x.actor), 'reason', x.reason, 'source', x.source) order by x.at desc, x.id desc) from public.crm_values x where x.record_id = r.id), '[]'::jsonb),
    'stage_history', coalesce((select jsonb_agg(jsonb_build_object('from', h.from_stage, 'to', h.to_stage, 'at', h.at, 'by', public._crm_name(h.actor), 'reason', h.reason, 'exception', h.exception) order by h.at desc, h.id desc)
      from public.crm_stage_history h where h.record_id = r.id), '[]'::jsonb),
    'can_edit', public._crm_can_write(me, 'sales.pipeline'),
    'can_handoff', public.crm_stage_kind(r.status) = 'won' and coalesce(r.data->>'project_ref', '') = '' and public._crm_can_write(me, 'company.projects'));
end $$;
revoke execute on function public.crm_opp(uuid) from public, anon;
grant execute on function public.crm_opp(uuid) to authenticated;

/** One timeline for an opportunity, an organisation or a contact: each item links to its own record (no copies). */
create or replace function public.crm_timeline(p_id uuid, p_limit integer default 200) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); r public.records; opps uuid[]; key text; lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  select * into r from public.records where id = p_id and section in ('sales.pipeline', 'company.parties', 'company.contacts');
  if me is null or not found or not public.record_visible_for(me, r) then raise exception 'Record not found' using errcode = 'P0002'; end if;
  key := case r.section when 'sales.pipeline' then 'deal_ref' when 'company.parties' then 'party_ref' else 'contact_ref' end;
  -- an organisation's and a contact's timeline also include their opportunities' events (the ones the viewer may open)
  opps := case when r.section = 'sales.pipeline' then array[r.id] else array(select o.id from public.records o where o.section = 'sales.pipeline' and o.data->>key = r.id::text and public.record_visible_for(me, o) limit 300) end;
  return coalesce((select jsonb_agg(t order by t.at desc) from (
    select * from (
      select coalesce(public._crm_date(x.data->>'date')::timestamptz, x.created_at) at,
        case x.section when 'sales.activities' then lower(coalesce(x.data->>'type', 'note')) when 'company.meetings' then 'meeting' when 'sales.proposals' then 'proposal'
          when 'legal.contracts' then case when x.data->>'type' = 'NDA' then 'nda' else 'contract' end when 'company.tasks' then 'task' when 'company.decisions' then 'decision'
          when 'sales.introductions' then 'introduction' when 'marketing.leads' then 'lead' when 'sales.pipeline' then 'opportunity' else 'record' end kind,
        x.title, concat_ws(' · ', x.status, nullif(x.data->>'number', ''), case when x.section = 'sales.proposals' then 'v' || coalesce(x.data->>'version', '1') end,
          left(coalesce(nullif(x.data->>'outcome', ''), nullif(x.data->>'decision', ''), nullif(regexp_replace(coalesce(x.data->>'notes', ''), '<[^>]+>', '', 'g'), ''), x.data->>'next_step', ''), 200)) excerpt,
        x.id record_id, x.section, '/' || replace(x.section, '.', '/') || '?r=' || x.id link
      from public.records x
      where (x.data->>'deal_ref' = any(opps::text[]) or x.data->>key = r.id::text or (x.section = 'marketing.leads' and x.data->>'opportunity_ref' = any(opps::text[])))
        and x.section in ('sales.activities', 'company.meetings', 'sales.proposals', 'legal.contracts', 'company.tasks', 'company.decisions', 'sales.introductions', 'marketing.leads', 'sales.pipeline')
        and x.id <> r.id and public.record_visible_for(me, x)
      union all
      select h.at, 'stage', 'Stage: ' || coalesce(h.from_stage || ' → ', '') || h.to_stage, concat_ws(' · ', public._crm_name(h.actor), h.reason, case when h.exception then 'exception to the stage rules' end), h.record_id, 'sales.pipeline', '/crm?opp=' || h.record_id
      from public.crm_stage_history h where h.record_id = any(opps)
      union all
      select x.at, 'value', initcap(x.kind) || ' value: ' || coalesce(x.amount::text, '—') || ' ' || coalesce(x.currency, ''), concat_ws(' · ', 'was ' || coalesce(x.prev_amount::text, '—'), public._crm_name(x.actor), x.reason), x.record_id, 'sales.pipeline', '/crm?opp=' || x.record_id
      from public.crm_values x where x.record_id = any(opps)
      union all
      select l.decided_at, 'email', coalesce(l.subject, 'E-mail'), concat_ws(' · ', l.from_addr, 'linked by ' || public._crm_name(l.decided_by)), l.target_id, l.target_section, null
      from public.crm_email_links l where l.status = 'confirmed' and (l.target_id = r.id or l.target_id = any(opps))
      union all
      select c.created_at, 'message', 'Message', left(regexp_replace(c.body, '@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)', '@\1', 'g'), 200), c.record_id, 'sales.pipeline', '/crm?opp=' || c.record_id || '#c-' || c.id
      from public.comments c where c.record_id = any(opps || r.id) and c.deleted_at is null
    ) u order by at desc nulls last limit lim) t), '[]'::jsonb);
end $$;
revoke execute on function public.crm_timeline(uuid, integer) from public, anon;
grant execute on function public.crm_timeline(uuid, integer) to authenticated;

/** Relationships around one organisation, contact or opportunity (only what the viewer may open). */
create or replace function public.crm_relations(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); r public.records; out jsonb := '{}'::jsonb; sid text := p_id::text;
begin
  select * into r from public.records where id = p_id and section in ('sales.pipeline', 'company.parties', 'company.contacts');
  if me is null or not found or not public.record_visible_for(me, r) then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if r.section = 'company.parties' then
    out := jsonb_build_object(
      'organization', jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'data', r.data),
      'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'job', x.data->>'title', 'email', x.data->>'email', 'phone', x.data->>'phone') order by x.title)
         from public.records x where x.section = 'company.contacts' and x.data->>'party_ref' = sid and public.record_visible_for(me, x)), '[]'::jsonb),
      'opportunities', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.data->>'number', 'title', x.title, 'stage', x.status, 'owner', x.data->>'owner', 'value', public._num(x.data->'value'), 'currency', x.data->>'currency') order by x.updated_at desc)
         from public.records x where x.section = 'sales.pipeline' and x.data->>'party_ref' = sid and public.record_visible_for(me, x)), '[]'::jsonb),
      'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.data->>'number', 'title', x.title, 'type', x.data->>'type', 'status', x.status) order by x.updated_at desc)
         from public.records x where x.section = 'legal.contracts' and x.data->>'party_ref' = sid and public.record_visible_for(me, x)), '[]'::jsonb),
      'projects', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status) order by x.updated_at desc)
         from public.records x where x.section = 'company.projects' and (x.data->>'party_ref' = sid or x.data->>'deal_ref' in (select o.id::text from public.records o where o.section = 'sales.pipeline' and o.data->>'party_ref' = sid))
         and public.record_visible_for(me, x)), '[]'::jsonb),
      'introduced_by_them', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'date', x.data->>'date', 'introduced', coalesce(x.data->>'introduced_party_ref_title', x.data->>'introduced_contact_ref_title'), 'opportunity', x.data->>'deal_ref_title') order by x.data->>'date' desc)
         from public.records x where x.section = 'sales.introductions' and x.data->>'introducer_party_ref' = sid and public.record_visible_for(me, x)), '[]'::jsonb),
      'introduced_to_us_by', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'date', x.data->>'date', 'introducer', coalesce(x.data->>'introducer_party_ref_title', x.data->>'introducer_contact_ref_title', x.data->>'introducer_employee'), 'kind', x.data->>'introducer_kind', 'context', x.data->>'context') order by x.data->>'date' desc)
         from public.records x where x.section = 'sales.introductions' and x.data->>'introduced_party_ref' = sid and public.record_visible_for(me, x)), '[]'::jsonb),
      'supports', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.data->>'number', 'title', x.title, 'stage', x.status,
           'roles', (select jsonb_agg(z) from (values (case when x.data->>'introduced_by_ref' = sid then 'introduced' end), (case when x.data->>'technical_support_ref' = sid then 'technical support' end),
             (case when x.data->>'local_support_ref' = sid then 'local support' end), (case when x.data->>'commercial_support_ref' = sid then 'commercial support' end), (case when x.data->>'relationship_support_ref' = sid then 'relationship support' end)) v(z) where z is not null)))
         from public.records x where x.section = 'sales.pipeline' and sid in (x.data->>'introduced_by_ref', x.data->>'technical_support_ref', x.data->>'local_support_ref', x.data->>'commercial_support_ref', x.data->>'relationship_support_ref')
         and public.record_visible_for(me, x)), '[]'::jsonb),
      'note', 'A partner or agent relationship gives that organisation no access to any opportunity; sharing is a separate, explicit step.');
  elsif r.section = 'company.contacts' then
    out := jsonb_build_object('contact', jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'data', r.data),
      'organization', (select jsonb_build_object('id', x.id, 'title', x.title, 'relationship_types', x.data->'relationship_types') from public.records x where x.id = public.as_uuid(r.data->>'party_ref') and public.record_visible_for(me, x)),
      'opportunities', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.data->>'number', 'title', x.title, 'stage', x.status, 'primary', true) order by x.updated_at desc)
         from public.records x where x.section = 'sales.pipeline' and x.data->>'contact_ref' = sid and public.record_visible_for(me, x)), '[]'::jsonb),
      'introductions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'date', x.data->>'date', 'as', case when x.data->>'introducer_contact_ref' = sid then 'introducer' else 'introduced' end) order by x.data->>'date' desc)
         from public.records x where x.section = 'sales.introductions' and sid in (x.data->>'introducer_contact_ref', x.data->>'introduced_contact_ref') and public.record_visible_for(me, x)), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'event', x.data->>'event_ref_title') order by x.created_at desc)
         from public.records x where x.section = 'marketing.leads' and x.data->>'contact_ref' = sid and public.record_visible_for(me, x)), '[]'::jsonb));
  else
    out := jsonb_build_object('opportunity', jsonb_build_object('id', r.id, 'number', r.data->>'number', 'title', r.title, 'stage', r.status),
      'organization', (select jsonb_build_object('id', x.id, 'title', x.title) from public.records x where x.id = public.as_uuid(r.data->>'party_ref') and public.record_visible_for(me, x)),
      'contact', (select jsonb_build_object('id', x.id, 'title', x.title, 'email', x.data->>'email') from public.records x where x.id = public.as_uuid(r.data->>'contact_ref') and public.record_visible_for(me, x)),
      'introduced_by', (select jsonb_build_object('id', x.id, 'title', x.title, 'relationship_types', x.data->'relationship_types') from public.records x where x.id = public.as_uuid(r.data->>'introduced_by_ref') and public.record_visible_for(me, x)),
      'introduced_by_person', (select jsonb_build_object('id', x.id, 'title', x.title) from public.records x where x.id = public.as_uuid(r.data->>'introduced_by_contact_ref') and public.record_visible_for(me, x)),
      'introductions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'date', x.data->>'date', 'kind', x.data->>'introducer_kind', 'introducer', coalesce(x.data->>'introducer_party_ref_title', x.data->>'introducer_contact_ref_title', x.data->>'introducer_employee'), 'context', x.data->>'context'))
         from public.records x where x.section = 'sales.introductions' and x.data->>'deal_ref' = sid and public.record_visible_for(me, x)), '[]'::jsonb),
      'support', coalesce((select jsonb_agg(jsonb_build_object('role', z.role, 'id', x.id, 'title', x.title)) from (values ('technical support', r.data->>'technical_support_ref'), ('local support', r.data->>'local_support_ref'),
           ('commercial support', r.data->>'commercial_support_ref'), ('relationship support', r.data->>'relationship_support_ref')) z(role, ref) join public.records x on x.id = public.as_uuid(z.ref) where public.record_visible_for(me, x)), '[]'::jsonb),
      'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.data->>'number', 'title', x.title, 'type', x.data->>'type', 'status', x.status))
         from public.records x where x.section = 'legal.contracts' and x.data->>'deal_ref' = sid and public.record_visible_for(me, x)), '[]'::jsonb),
      'project', (select jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status) from public.records x where x.id = public.as_uuid(r.data->>'project_ref') and public.record_visible_for(me, x)),
      'lead', (select jsonb_build_object('id', x.id, 'title', x.title, 'event', x.data->>'event_ref_title', 'source', x.data->>'source') from public.records x where x.id = public.as_uuid(r.data->>'lead_ref') and public.record_visible_for(me, x)),
      'note', 'Attribution is recorded as fact; Workspace calculates no commission and creates no financial obligation.');
  end if;
  return out;
end $$;
revoke execute on function public.crm_relations(uuid) from public, anon;
grant execute on function public.crm_relations(uuid) to authenticated;

-- one lead as a list row
create or replace function public._crm_lead_row(l public.records) returns jsonb language sql stable as $$
  select jsonb_build_object('id', l.id, 'title', l.title, 'status', l.status, 'organization', l.data->>'organization', 'email', l.data->>'email', 'phone', l.data->>'phone',
    'country', l.data->>'country', 'importance', l.data->>'importance', 'owner_id', l.data->>'owner_id', 'owner', l.data->>'owner', 'follow_up', l.data->>'follow_up',
    'source', l.data->>'source', 'event', l.data->>'event_ref_title', 'event_ref', l.data->>'event_ref', 'interest', coalesce(l.data->>'interest', l.data->>'product'),
    'opportunity_ref', l.data->>'opportunity_ref', 'opportunity', l.data->>'opportunity_ref_title', 'meeting_ref', l.data->>'meeting_ref', 'created_at', l.created_at, 'created_by', l.created_by)
$$;

/** Leads (filtered): status, event, owner, importance, text. */
create or replace function public.crm_leads(p_filter jsonb default '{}'::jsonb, p_limit integer default 300) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); f jsonb := coalesce(p_filter, '{}'::jsonb); q text := lower(trim(coalesce(f->>'q', '')));
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(public._crm_lead_row(l) order by l.created_at desc) from (
    select * from public.records l where l.section = 'marketing.leads'
      and (coalesce(f->>'status', '') = '' or l.status = f->>'status') and (coalesce(f->>'event_ref', '') = '' or l.data->>'event_ref' = f->>'event_ref')
      and (coalesce(f->>'owner_id', '') = '' or l.data->>'owner_id' = f->>'owner_id') and (coalesce(f->>'importance', '') = '' or l.data->>'importance' = f->>'importance')
      and (q = '' or public.crm_search_text(l.title, l.data) like '%' || q || '%')
      and public.record_visible_for(me, l)
    order by l.created_at desc limit least(greatest(coalesce(p_limit, 300), 1), 2000)) l), '[]'::jsonb);
end $$;
revoke execute on function public.crm_leads(jsonb, integer) from public, anon;
grant execute on function public.crm_leads(jsonb, integer) to authenticated;

/** The day view of an event (IDEX or any other): today, the team, the pipeline from the event. */
create or replace function public.crm_event_day(p_event uuid default null, p_day date default null) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); ev public.records; d date := coalesce(p_day, current_date); evid uuid := coalesce(p_event, public.as_uuid(public.crm_cfg()->>'active_event_ref'));
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into ev from public.records where id = evid and section = 'marketing.events';
  if not found then return jsonb_build_object('event', null, 'note', 'No event is active: choose one (Commercial → Event mode) or set the active event in Commercial → Settings.'); end if;
  return (with leads as materialized (
      select l.* from public.records l where l.section = 'marketing.leads' and l.data->>'event_ref' = ev.id::text and public.record_visible_for(me, l)),
    meets as materialized (
      select m.* from public.records m where m.section = 'company.meetings' and m.data->>'event_ref' = ev.id::text and public.record_visible_for(me, m))
    select jsonb_build_object('event', jsonb_build_object('id', ev.id, 'title', ev.title, 'starts', ev.data->>'starts', 'city', ev.data->>'city', 'country', ev.data->>'country'), 'day', d,
      'today', jsonb_build_object(
        'meetings', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'time', m.data->>'time', 'place', m.data->>'place', 'status', m.status,
             'organizer', m.data->>'organizer', 'participants', m.data->'participants', 'external', concat_ws(', ', m.data->>'contact_ref_title', nullif(m.data->>'external_attendees', '')),
             'organization', m.data->>'party_ref_title') order by m.data->>'time') from meets m where public._crm_date(m.data->>'date') = d), '[]'::jsonb),
        'expected_visitors', coalesce((select jsonb_agg(jsonb_build_object('meeting', m.id, 'time', m.data->>'time', 'who', concat_ws(', ', m.data->>'contact_ref_title', nullif(m.data->>'external_attendees', '')), 'organization', m.data->>'party_ref_title') order by m.data->>'time')
             from meets m where public._crm_date(m.data->>'date') = d and coalesce(m.status, '') <> 'Cancelled' and (coalesce(m.data->>'contact_ref', '') <> '' or coalesce(m.data->>'external_attendees', '') <> '')), '[]'::jsonb),
        'new_leads', coalesce((select jsonb_agg(public._crm_lead_row(l) order by l.created_at desc) from leads l where (l.created_at at time zone 'utc')::date = d), '[]'::jsonb),
        'hot_leads', coalesce((select jsonb_agg(public._crm_lead_row(l) order by l.created_at desc) from leads l where l.data->>'importance' = 'Hot' and coalesce(l.status, 'New') not in ('Disqualified', 'Converted')), '[]'::jsonb),
        'follow_ups_due', coalesce((select jsonb_agg(public._crm_lead_row(l) order by l.data->>'follow_up') from leads l where public._crm_date(l.data->>'follow_up') <= d and coalesce(l.status, 'New') in ('New', 'Reviewing', 'Qualified')), '[]'::jsonb),
        'waiting_for_response', coalesce((select jsonb_agg(public._crm_lead_row(l) order by l.created_at) from leads l where coalesce(l.status, 'New') = 'New' and l.created_at < now() - interval '24 hours'), '[]'::jsonb)),
      'team', coalesce((select jsonb_agg(z order by z.name) from (
          select coalesce(nullif(p.full_name, ''), p.email) name, p.id,
            (select count(*) from leads l where l.data->>'owner_id' = p.id::text) leads_owned,
            (select count(*) from leads l where l.data->>'owner_id' = p.id::text and public._crm_date(l.data->>'follow_up') <= d and coalesce(l.status, 'New') in ('New', 'Reviewing', 'Qualified')) follow_ups,
            coalesce((select jsonb_agg(jsonb_build_object('meeting', m.id, 'time', m.data->>'time', 'with', concat_ws(', ', m.data->>'party_ref_title', m.data->>'contact_ref_title', nullif(m.data->>'external_attendees', ''))) order by m.data->>'time')
              from meets m where public._crm_date(m.data->>'date') = d and (m.data->>'organizer_id' = p.id::text or coalesce(m.data->'participants_ids', '[]'::jsonb) ? p.id::text)), '[]'::jsonb) meetings
          from public.profiles p where not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending')
            and (exists (select 1 from leads l where l.data->>'owner_id' = p.id::text) or exists (select 1 from meets m where public._crm_date(m.data->>'date') = d and (m.data->>'organizer_id' = p.id::text or coalesce(m.data->'participants_ids', '[]'::jsonb) ? p.id::text)))) z), '[]'::jsonb),
      'pipeline', jsonb_build_object(
        'New', (select count(*) from leads l where coalesce(l.status, 'New') = 'New' and coalesce(l.data->>'meeting_ref', '') = ''),
        'Qualified', (select count(*) from leads l where l.status = 'Qualified'),
        'Meeting', (select count(*) from leads l where coalesce(l.data->>'meeting_ref', '') <> '' and coalesce(l.status, 'New') not in ('Converted', 'Disqualified')),
        'Follow-up', (select count(*) from leads l where l.status = 'Reviewing' and coalesce(l.data->>'meeting_ref', '') = ''),
        'Opportunity', (select count(*) from leads l where l.status = 'Converted'),
        'Disqualified', (select count(*) from leads l where l.status = 'Disqualified')),
      'total_leads', (select count(*) from leads)));
end $$;
revoke execute on function public.crm_event_day(uuid, date) from public, anon;
grant execute on function public.crm_event_day(uuid, date) to authenticated;

/** After the event: who has no owner, no follow-up, what is hot, which meetings have no notes, what became an opportunity. */
create or replace function public.crm_event_followup(p_event uuid default null) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); ev public.records; evid uuid := coalesce(p_event, public.as_uuid(public.crm_cfg()->>'active_event_ref'));
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into ev from public.records where id = evid and section = 'marketing.events';
  if not found then return jsonb_build_object('event', null); end if;
  return (with leads as materialized (select l.* from public.records l where l.section = 'marketing.leads' and l.data->>'event_ref' = ev.id::text and public.record_visible_for(me, l)),
    meets as materialized (select m.* from public.records m where m.section = 'company.meetings' and m.data->>'event_ref' = ev.id::text and public.record_visible_for(me, m))
    select jsonb_build_object('event', jsonb_build_object('id', ev.id, 'title', ev.title), 'total', (select count(*) from leads),
      'no_owner', coalesce((select jsonb_agg(public._crm_lead_row(l)) from leads l where coalesce(l.data->>'owner_id', '') = '' and coalesce(l.status, 'New') not in ('Converted', 'Disqualified')), '[]'::jsonb),
      'no_follow_up', coalesce((select jsonb_agg(public._crm_lead_row(l)) from leads l where coalesce(l.data->>'follow_up', '') = '' and coalesce(l.status, 'New') not in ('Converted', 'Disqualified')), '[]'::jsonb),
      'hot', coalesce((select jsonb_agg(public._crm_lead_row(l)) from leads l where l.data->>'importance' = 'Hot' and coalesce(l.status, 'New') not in ('Converted', 'Disqualified')), '[]'::jsonb),
      'meetings_without_notes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'date', m.data->>'date', 'organizer', m.data->>'organizer'))
         from meets m where coalesce(m.status, '') <> 'Cancelled' and public._crm_date(m.data->>'date') <= current_date and coalesce(trim(regexp_replace(coalesce(m.data->>'notes', ''), '<[^>]+>', '', 'g')), '') = ''), '[]'::jsonb),
      'not_qualified', coalesce((select jsonb_agg(public._crm_lead_row(l)) from leads l where coalesce(l.status, 'New') in ('New', 'Reviewing')), '[]'::jsonb),
      'converted', coalesce((select jsonb_agg(public._crm_lead_row(l)) from leads l where l.status = 'Converted'), '[]'::jsonb),
      'unanswered', coalesce((select jsonb_agg(public._crm_lead_row(l)) from leads l where coalesce(l.status, 'New') in ('New', 'Reviewing') and public._crm_date(l.data->>'follow_up') < current_date), '[]'::jsonb),
      'note', 'Workspace sends no e-mail by itself: follow-ups are written and sent by the people who own them.'));
end $$;
revoke execute on function public.crm_event_followup(uuid) from public, anon;
grant execute on function public.crm_event_followup(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   12. Weekly Commercial Review (also a section of the Phase 5 executive review) and the Assistant's commercial
       questions — allow-listed intents answered from the records the person may open, each with its source
   --------------------------------------------------------------------------------------------- */
create or replace function public.crm_weekly(p_from date default null, p_to date default null) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); a date := coalesce(p_from, current_date - 7); b date := coalesce(p_to, current_date); pv jsonb; big numeric := 1000000;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._crm_base(me);
  pv := public.crm_pipeline_value('{}'::jsonb);
  return jsonb_build_object('from', a, 'to', b,
    'summary', jsonb_build_object('active', (select count(*) from pg_temp.crm_v where kind = 'open'), 'new', (select count(*) from pg_temp.crm_v where created_at::date between a and b),
      'won', (select count(*) from public.crm_stage_history h join pg_temp.crm_v v on v.id = h.record_id where public.crm_stage_kind(h.to_stage) = 'won' and h.at::date between a and b),
      'lost', (select count(*) from public.crm_stage_history h join pg_temp.crm_v v on v.id = h.record_id where public.crm_stage_kind(h.to_stage) = 'lost' and h.at::date between a and b),
      'stalled', (select count(*) from pg_temp.crm_v where health = 'Stalled'), 'risk', (select count(*) from pg_temp.crm_v where health = 'Risk'),
      'proposals_outstanding', (select count(*) from pg_temp.crm_v where kind = 'open' and sent_ref is not null)),
    'pipeline', pv,
    'attention', coalesce((select jsonb_agg(public._crm_row(v)) from (select * from pg_temp.crm_v where health in ('Stalled', 'Risk') order by case health when 'Stalled' then 0 else 1 end, number limit 30) v), '[]'::jsonb),
    'new_opportunities', coalesce((select jsonb_agg(public._crm_row(v)) from (select * from pg_temp.crm_v where created_at::date between a and b order by created_at desc limit 30) v), '[]'::jsonb),
    'major', coalesce((select jsonb_agg(public._crm_row(v)) from (select * from pg_temp.crm_v where kind = 'open' and greatest(coalesce(final, 0), coalesce(negotiated, 0), coalesce(quoted, 0), coalesce(value, 0)) >= big
      order by greatest(coalesce(final, 0), coalesce(negotiated, 0), coalesce(quoted, 0), coalesce(value, 0)) desc limit 20) v), '[]'::jsonb),
    'major_threshold', big,
    'proposals_outstanding', coalesce((select jsonb_agg(jsonb_build_object('opp', v.id, 'number', v.number, 'title', v.title, 'proposal', v.sent_ref, 'proposal_title', v.sent_title, 'sent_at', v.sent_at, 'days', current_date - v.sent_at))
      from pg_temp.crm_v v where v.kind = 'open' and v.sent_ref is not null), '[]'::jsonb),
    'waiting', public.crm_waiting(),
    'decisions_expected', coalesce((select jsonb_agg(public._crm_row(v)) from (select * from pg_temp.crm_v where kind = 'open' and decision_on between current_date - 7 and current_date + 30 order by decision_on limit 30) v), '[]'::jsonb),
    'stalled', coalesce((select jsonb_agg(public._crm_row(v)) from (select * from pg_temp.crm_v where health = 'Stalled' order by number limit 30) v), '[]'::jsonb),
    'wins', coalesce((select jsonb_agg(public._crm_row(v)) from (select v.* from pg_temp.crm_v v where v.kind = 'won' and v.stage_since::date between a and b order by v.stage_since desc) v), '[]'::jsonb),
    'losses', coalesce((select jsonb_agg(public._crm_row(v) || jsonb_build_object('lost_reason', v.data->>'lost_reason')) from (select v.* from pg_temp.crm_v v where v.kind = 'lost' and v.stage_since::date between a and b order by v.stage_since desc) v), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'leads', (select count(*) from public.records l where l.section = 'marketing.leads' and l.data->>'event_ref' = e.id::text and l.created_at::date between a and b and public.record_visible_for(me, l)),
         'converted', (select count(*) from public.records l where l.section = 'marketing.leads' and l.data->>'event_ref' = e.id::text and l.status = 'Converted' and public.record_visible_for(me, l))))
      from public.records e where e.section = 'marketing.events' and exists (select 1 from public.records l where l.section = 'marketing.leads' and l.data->>'event_ref' = e.id::text and l.created_at::date between a and b)
        and public.record_visible_for(me, e)), '[]'::jsonb),
    'next_actions', coalesce((select jsonb_agg(public._crm_row(v)) from (select * from pg_temp.crm_v where kind = 'open' and next_due between current_date and current_date + 7 order by next_due limit 40) v), '[]'::jsonb),
    'note', 'Weighted values are management estimates, not revenue. Every line names its record.');
end $$;
revoke execute on function public.crm_weekly(date, date) from public, anon;
grant execute on function public.crm_weekly(date, date) to authenticated;

/** The Assistant's commercial questions. Facts come from the records the person may open; nothing is invented. */
create or replace function public.crm_assistant(p_intent text, p_arg text default null) returns jsonb
language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); arg text := nullif(trim(coalesce(p_arg, '')), ''); r public.records; items jsonb; amt numeric; cur text; ev uuid;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._crm_base(me);
  if p_intent = 'followup_today' then
    return jsonb_build_object('kind', 'list', 'intent', p_intent, 'items', public.crm_followups('mine'));
  elsif p_intent in ('attention', 'stalled', 'no_next_action', 'proposals_waiting', 'nda_unsigned') then
    return jsonb_build_object('kind', 'list', 'intent', p_intent, 'items', public.crm_list(case p_intent when 'attention' then 'needs_action' else p_intent end, null, 50));
  elsif p_intent = 'geography' then
    if arg is null then return jsonb_build_object('kind', 'unavailable', 'note', 'Say which geography'); end if;
    return jsonb_build_object('kind', 'list', 'intent', p_intent, 'arg', arg, 'items', public.crm_list('active', null, 50,
      jsonb_build_object('geography', coalesce((select x from jsonb_array_elements_text(public.crm_cfg()->'geographies') x where lower(x) = lower(arg) limit 1), arg))),
      'note', 'Opportunities whose geography is ' || arg || ' (the field on the opportunity)');
  elsif p_intent = 'event' then
    select e.id into ev from public.records e where e.section = 'marketing.events' and (arg is null and e.id = public.as_uuid(public.crm_cfg()->>'active_event_ref') or (arg is not null and lower(e.title) like '%' || lower(arg) || '%'))
      and public.record_visible_for(me, e) order by e.updated_at desc limit 1;
    if ev is null then return jsonb_build_object('kind', 'unavailable', 'note', 'No event record matches'); end if;
    return jsonb_build_object('kind', 'event', 'intent', p_intent, 'followup', public.crm_event_followup(ev));
  elsif p_intent in ('introduced_by', 'last_contact', 'last_meeting') then
    if arg is null then return jsonb_build_object('kind', 'unavailable', 'note', 'Say which organization or person'); end if;
    select x.* into r from public.records x where x.section in ('company.parties', 'company.contacts', 'sales.pipeline')
      and public.crm_search_text(x.title, x.data) like '%' || lower(arg) || '%' and public.record_visible_for(me, x)
      order by (lower(x.title) = lower(arg)) desc, case x.section when 'company.parties' then 0 when 'company.contacts' then 1 else 2 end, x.updated_at desc limit 1;
    if r.id is null then return jsonb_build_object('kind', 'unavailable', 'note', 'No organization, contact or opportunity you can open matches «' || arg || '»'); end if;
    if p_intent = 'introduced_by' then
      return jsonb_build_object('kind', 'relations', 'intent', p_intent, 'record', jsonb_build_object('id', r.id, 'title', r.title, 'section', r.section),
        'relations', case when r.section = 'company.contacts' then public.crm_relations(r.id) - 'contact' else public.crm_relations(r.id) end);
    elsif p_intent = 'last_contact' then
      return jsonb_build_object('kind', 'timeline', 'intent', p_intent, 'record', jsonb_build_object('id', r.id, 'title', r.title, 'section', r.section),
        'items', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select t from jsonb_array_elements(public.crm_timeline(r.id, 60)) t
          where t->>'kind' in ('call', 'video call', 'meeting', 'email', 'demo', 'site visit', 'message', 'note', 'proposal') limit 5) z));
    else
      return jsonb_build_object('kind', 'meeting', 'intent', p_intent, 'record', jsonb_build_object('id', r.id, 'title', r.title, 'section', r.section),
        'meeting', (select jsonb_build_object('id', m.id, 'title', m.title, 'date', m.data->>'date', 'decisions', m.data->>'decisions', 'notes', left(regexp_replace(coalesce(m.data->>'notes', ''), '<[^>]+>', '', 'g'), 1500),
            'linked_decisions', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'decision', d.data->>'decision', 'status', d.status)), '[]'::jsonb) from public.records d
               where d.section = 'company.decisions' and d.data->>'source_ref' = m.id::text and public.record_visible_for(me, d)),
            'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'assignee', t.data->>'assignee', 'due', t.data->>'due', 'status', t.status)), '[]'::jsonb) from public.records t
               where t.section = 'company.tasks' and t.data->>'source_ref' = m.id::text and public.record_visible_for(me, t)))
          from public.records m where m.section = 'company.meetings' and coalesce(m.status, '') <> 'Cancelled' and public._crm_date(m.data->>'date') <= current_date
            and (m.data->>'deal_ref' = r.id::text or m.data->>'party_ref' = r.id::text or m.data->>'contact_ref' = r.id::text
                 or (r.section <> 'sales.pipeline' and m.data->>'deal_ref' in (select o.id::text from public.records o where o.section = 'sales.pipeline' and o.data->>(case when r.section = 'company.parties' then 'party_ref' else 'contact_ref' end) = r.id::text)))
            and public.record_visible_for(me, m)
          order by public._crm_date(m.data->>'date') desc, m.data->>'time' desc nulls last limit 1));
    end if;
  elsif p_intent = 'above_value' then
    amt := coalesce(public._num(to_jsonb(regexp_replace(coalesce(arg, ''), '[^0-9.]', '', 'g'))), 1000000);
    cur := coalesce(substring(upper(coalesce(arg, '')) from '(USD|AED|EUR)'), case when coalesce(arg, '') ~ '\$' then 'USD' when coalesce(arg, '') ~ '€' then 'EUR' end);
    return jsonb_build_object('kind', 'list', 'intent', p_intent, 'amount', amt, 'currency', cur,
      'items', public.crm_list('active', null, 100, jsonb_strip_nulls(jsonb_build_object('min_value', amt, 'currency', cur))),
      'note', 'Open opportunities whose largest known value (final, negotiated, quoted or estimate) is at least ' || amt || coalesce(' ' || cur, ' in its own currency') || '. Currencies are not converted.');
  elsif p_intent = 'review' then
    return jsonb_build_object('kind', 'review', 'intent', p_intent, 'review', public.crm_weekly(null, null));
  end if;
  return jsonb_build_object('kind', 'unavailable', 'note', 'Unknown commercial question');
end $$;
revoke execute on function public.crm_assistant(text, text) from public, anon;
grant execute on function public.crm_assistant(text, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   13. CSV import (preview → mapping → validation → duplicates → confirmation → import → report → safe
       rollback), export (permission, policy, audit), e-mail link suggestions (never linked by themselves)
   --------------------------------------------------------------------------------------------- */
create or replace function public._crm_import_section(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'organizations' then 'company.parties' when 'contacts' then 'company.contacts' when 'leads' then 'marketing.leads' end
$$;

-- the fields an import may fill, per kind (anything else in the file is ignored, never stored)
create or replace function public._crm_import_fields(p_kind text) returns text[] language sql immutable as $$
  select case p_kind
    when 'organizations' then array['name', 'legal_name', 'trading_name', 'org_type', 'relationship_types', 'country', 'city', 'address', 'website', 'domain', 'industry', 'size', 'geography', 'source', 'aliases', 'tags', 'notes']
    when 'contacts' then array['name', 'first_name', 'last_name', 'title', 'organization', 'department', 'email', 'phone', 'mobile', 'country', 'timezone', 'language', 'source', 'tags', 'notes']
    when 'leads' then array['name', 'first_name', 'last_name', 'title', 'organization', 'email', 'phone', 'country', 'geography', 'interest', 'product', 'use_case', 'importance', 'source', 'follow_up', 'next_action', 'tags', 'notes'] end
$$;

create or replace function public.crm_import_preview(p_kind text, p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); sec text := public._crm_import_section(p_kind); out jsonb := '[]'::jsonb; x jsonb; i int := 0; errs jsonb; warn jsonb; dup jsonb; nm text; seen jsonb := '{}'::jsonb; key text; fields text[] := public._crm_import_fields(p_kind); k text;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if sec is null then raise exception 'Import organizations, contacts or leads' using errcode = '22023'; end if;
  if not public._crm_can_write(me, sec) then raise exception 'You cannot add records to %', sec using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The file has no rows' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'At most 2,000 rows per import' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; errs := '[]'::jsonb; warn := '[]'::jsonb;
    for k in select jsonb_object_keys(x) loop if not (k = any(fields)) then warn := warn || to_jsonb('column «' || k || '» is not imported'); end if; end loop;
    nm := trim(coalesce(nullif(x->>'name', ''), concat_ws(' ', x->>'first_name', x->>'last_name')));
    if nm = '' and not (p_kind = 'leads' and coalesce(x->>'organization', '') <> '') then errs := errs || '"name is missing"'; end if;
    if coalesce(x->>'email', '') <> '' and x->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then errs := errs || '"e-mail does not look right"'; end if;
    if p_kind = 'leads' and coalesce(x->>'follow_up', '') <> '' and x->>'follow_up' !~ '^\d{4}-\d{2}-\d{2}$' then errs := errs || '"follow-up date must be YYYY-MM-DD"'; end if;
    if p_kind = 'leads' and coalesce(x->>'importance', '') <> '' and x->>'importance' not in ('Hot', 'Warm', 'Cold') then errs := errs || '"importance is Hot, Warm or Cold"'; end if;
    if p_kind = 'organizations' and coalesce(x->>'relationship_types', '') <> '' and exists (select 1 from unnest(string_to_array(x->>'relationship_types', ';')) t where not (coalesce(public.crm_cfg()->'relationship_types', '[]'::jsonb) ? trim(t))) then
      errs := errs || '"unknown relationship type (separate several with ;)"';
    end if;
    -- duplicates in the file itself, and against Workspace
    key := case when p_kind = 'organizations' then public.crm_norm(nm) else coalesce(nullif(lower(x->>'email'), ''), public.crm_norm(nm) || '|' || public.crm_norm(x->>'organization')) end;
    if seen ? key and key <> '' then warn := warn || to_jsonb('same as row ' || (seen->>key) || ' of this file'); else seen := seen || jsonb_build_object(key, i); end if;
    dup := case when p_kind = 'organizations' then public.crm_dupes('organization', x || jsonb_build_object('name', nm))
                when p_kind = 'contacts' then public.crm_dupes('contact', (x - 'title') || jsonb_build_object('name', nm))
                else (select coalesce(jsonb_agg(l), '[]'::jsonb) from (select jsonb_build_object('id', y.id, 'section', 'marketing.leads', 'title', y.title, 'status', y.status, 'why', '["same e-mail"]'::jsonb, 'strength', 'strong') l
                   from public.records y where y.section = 'marketing.leads' and coalesce(x->>'email', '') <> '' and lower(y.data->>'email') = lower(x->>'email') and public.record_visible_for(me, y) limit 5) z)
                   || case when coalesce(x->>'email', '') <> '' then public.crm_dupes('contact', jsonb_build_object('email', x->>'email')) else '[]'::jsonb end end;
    out := out || jsonb_build_object('row', i, 'name', nm, 'errors', errs, 'warnings', warn, 'duplicates', dup,
      'action', case when jsonb_array_length(errs) > 0 then 'fix' when exists (select 1 from jsonb_array_elements(dup) d where d->>'strength' = 'strong') then 'decide' else 'create' end);
  end loop;
  return jsonb_build_object('kind', p_kind, 'rows', out, 'total', i,
    'ready', (select count(*) from jsonb_array_elements(out) r where r->>'action' = 'create'), 'decide', (select count(*) from jsonb_array_elements(out) r where r->>'action' = 'decide'),
    'errors', (select count(*) from jsonb_array_elements(out) r where r->>'action' = 'fix'),
    'note', 'Nothing is imported yet. Rows that look like existing records need your decision; nothing existing is overwritten.');
end $$;
revoke execute on function public.crm_import_preview(text, jsonb) from public, anon;
grant execute on function public.crm_import_preview(text, jsonb) to authenticated;

/** Import the confirmed rows. Decisions per row: create | skip | use:<id> (an existing record is never changed). */
create or replace function public.crm_import_commit(p_kind text, p_rows jsonb, p_decisions jsonb, p_file text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); sec text := public._crm_import_section(p_kind); pv jsonb; r jsonb; x jsonb; dec text; batch uuid := gen_random_uuid(); n_new int := 0; n_link int := 0; n_skip int := 0;
  rep jsonb := '[]'::jsonb; d jsonb; nm text; id uuid; party uuid; fields text[] := public._crm_import_fields(p_kind); k text;
begin
  pv := public.crm_import_preview(p_kind, p_rows); -- the same checks again, on the server, at the moment of import
  for r in select * from jsonb_array_elements(pv->'rows') loop
    x := p_rows->((r->>'row')::int - 1); dec := coalesce(p_decisions->>(r->>'row'), case when r->>'action' = 'create' then 'create' end);
    if r->>'action' = 'fix' then n_skip := n_skip + 1; rep := rep || jsonb_build_object('row', r->'row', 'result', 'skipped', 'why', r->'errors'); continue; end if;
    if dec is null then raise exception 'Row % looks like an existing record: choose create, skip or use the existing one', r->>'row' using errcode = '23505'; end if;
    if dec = 'skip' then n_skip := n_skip + 1; rep := rep || jsonb_build_object('row', r->'row', 'result', 'skipped'); continue; end if;
    if dec like 'use:%' then
      id := public.as_uuid(substr(dec, 5));
      if id is null or not exists (select 1 from jsonb_array_elements(r->'duplicates') q where q->>'id' = id::text) then raise exception 'Row %: the chosen existing record is not one of its matches', r->>'row' using errcode = '22023'; end if;
      n_link := n_link + 1; rep := rep || jsonb_build_object('row', r->'row', 'result', 'existing used (not changed)', 'id', id); continue;
    end if;
    if dec <> 'create' then raise exception 'Row %: unknown decision %', r->>'row', dec using errcode = '22023'; end if;
    d := '{}'::jsonb;
    foreach k in array fields loop if k <> 'name' and coalesce(trim(x->>k), '') <> '' then d := d || jsonb_build_object(k, left(trim(x->>k), 2000)); end if; end loop;
    if p_kind = 'organizations' and d ? 'relationship_types' then d := d || jsonb_build_object('relationship_types', (select jsonb_agg(trim(t)) from unnest(string_to_array(d->>'relationship_types', ';')) t)); end if;
    nm := coalesce(nullif(r->>'name', ''), x->>'organization');
    if p_kind = 'contacts' and coalesce(x->>'organization', '') <> '' then
      select (q->>'id')::uuid into party from jsonb_array_elements(public.crm_dupes('organization', jsonb_build_object('name', x->>'organization'))) q where q->>'strength' = 'strong' limit 1;
      if party is not null then d := d || jsonb_build_object('party_ref', party, 'party_ref_title', (select title from public.records where id = party)); end if;
    end if;
    d := d || jsonb_build_object('import_batch', batch, 'owner_id', me, 'owner', public._crm_name(me)) || case when p_kind = 'leads' and nm is not null then jsonb_build_object('contact', nullif(r->>'name', '')) else '{}'::jsonb end;
    insert into public.records(section, title, status, data) values (sec, left(case when p_kind = 'leads' and coalesce(x->>'organization', '') <> '' and coalesce(r->>'name', '') <> '' then (r->>'name') || ' — ' || (x->>'organization') else nm end, 300),
      case p_kind when 'leads' then 'New' when 'contacts' then 'New' else 'Active' end, d) returning records.id into id;
    n_new := n_new + 1; rep := rep || jsonb_build_object('row', r->'row', 'result', 'created', 'id', id);
  end loop;
  insert into public.crm_imports(id, kind, created_by, file_name, rows_total, created, linked, skipped, report) values (batch, p_kind, me, left(p_file, 200), (pv->>'total')::int, n_new, n_link, n_skip, rep);
  insert into public.crm_audit(actor, kind, detail) values (me, 'import', jsonb_build_object('batch', batch, 'kind', p_kind, 'created', n_new, 'linked', n_link, 'skipped', n_skip));
  return jsonb_build_object('ok', true, 'batch', batch, 'created', n_new, 'existing_used', n_link, 'skipped', n_skip, 'report', rep);
end $$;
revoke execute on function public.crm_import_commit(text, jsonb, jsonb, text) from public, anon;
grant execute on function public.crm_import_commit(text, jsonb, jsonb, text) to authenticated;

/** Undo an import where it is safe: the records nobody changed since and nothing links to (they go to the recycle bin). */
create or replace function public.crm_import_rollback(p_batch uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); b public.crm_imports; x public.records; gone int := 0; kept jsonb := '[]'::jsonb;
begin
  select * into b from public.crm_imports where id = p_batch for update;
  if me is null or not found then raise exception 'Import not found' using errcode = 'P0002'; end if;
  if b.created_by is distinct from me and not public.has_cap(me, 'commercial_admin') then raise exception 'Only the person who imported, or a Commercial Admin, undoes an import' using errcode = '42501'; end if;
  if b.status = 'rolled_back' then raise exception 'Already undone' using errcode = '55000'; end if;
  for x in select * from public.records r where r.data->>'import_batch' = p_batch::text for update loop
    if x.version > 1 or exists (select 1 from public.records y where y.id <> x.id and (y.data->>'party_ref' = x.id::text or y.data->>'contact_ref' = x.id::text or y.data->>'lead_ref' = x.id::text))
       or exists (select 1 from public.comments c where c.record_id = x.id) then
      kept := kept || jsonb_build_object('id', x.id, 'title', x.title, 'why', 'changed or linked since the import');
    else
      delete from public.records where id = x.id; gone := gone + 1;
    end if;
  end loop;
  update public.crm_imports set status = case when jsonb_array_length(kept) = 0 then 'rolled_back' else 'partly_rolled_back' end, rolled_back_at = now(), rolled_back_by = me where id = p_batch;
  insert into public.crm_audit(actor, kind, detail) values (me, 'import_rollback', jsonb_build_object('batch', p_batch, 'removed', gone, 'kept', kept));
  return jsonb_build_object('ok', true, 'removed', gone, 'kept', kept, 'note', 'Removed records are in the recycle bin for 30 days.');
end $$;
revoke execute on function public.crm_import_rollback(uuid) from public, anon;
grant execute on function public.crm_import_rollback(uuid) to authenticated;

create or replace function public.crm_imports_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'at', b.created_at, 'by', public._crm_name(b.created_by), 'file', b.file_name, 'rows', b.rows_total,
    'created', b.created, 'existing_used', b.linked, 'skipped', b.skipped, 'status', b.status) order by b.created_at desc), '[]'::jsonb)
  from (select * from public.crm_imports b where public.crm_viewer() is not null and (b.created_by = auth.uid() or public.has_cap(auth.uid(), 'commercial_admin')) order by b.created_at desc limit 50) b
$$;
revoke execute on function public.crm_imports_list() from public, anon;
grant execute on function public.crm_imports_list() to authenticated;

/** Export what the person may open, without the fields the policy excludes; every export is recorded. */
create or replace function public.crm_export(p_kind text, p_filter jsonb default '{}'::jsonb) returns jsonb language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.crm_viewer(); excl text[]; withc boolean := coalesce((public.crm_cfg()->>'export_controlled')::boolean, false); rows jsonb; f jsonb := coalesce(p_filter, '{}'::jsonb); n int;
begin
  if me is null or not public.has_cap(me, 'export_commercial') then raise exception 'Exporting commercial data needs the Export Commercial Data capability' using errcode = '42501'; end if;
  excl := array(select jsonb_array_elements_text(coalesce(public.crm_cfg()->'export_excluded_fields', '[]'::jsonb)));
  if p_kind in ('organizations', 'contacts', 'leads', 'event_leads') then
    rows := coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'updated_at', r.updated_at) || ((r.data - excl) - array['import_batch', 'merged_into', 'created_despite'])) from (
      select * from public.records r where r.section = case p_kind when 'organizations' then 'company.parties' when 'contacts' then 'company.contacts' else 'marketing.leads' end
        and (p_kind <> 'event_leads' or r.data->>'event_ref' = f->>'event_ref') and (withc or not coalesce(r.controlled, true))
        and (coalesce(f->>'status', '') = '' or r.status = f->>'status') and (coalesce(f->>'country', '') = '' or lower(r.data->>'country') = lower(f->>'country'))
        and public.record_visible_for(me, r) order by r.title limit 20000) r), '[]'::jsonb);
  elsif p_kind in ('opportunities', 'pipeline') then
    perform public._crm_base(me);
    rows := coalesce((select jsonb_agg(case when p_kind = 'pipeline' then public._crm_row(v) - array['reasons', 'restricted', 'controlled'] || jsonb_build_object('reasons', (select string_agg(x->>'text', '; ') from jsonb_array_elements(v.reasons) x))
                                      else jsonb_build_object('id', v.id, 'title', v.title, 'stage', v.stage) || (v.data - excl) end)
      from pg_temp.crm_v v where (withc or not coalesce(v.controlled, true)) and public._crm_match(v, f, null)), '[]'::jsonb);
  else raise exception 'Export organizations, contacts, opportunities, leads, event_leads or pipeline' using errcode = '22023';
  end if;
  n := jsonb_array_length(rows);
  insert into public.crm_audit(actor, kind, detail) values (me, 'export', jsonb_build_object('kind', p_kind, 'filter', f, 'rows', n, 'excluded_fields', excl, 'controlled_included', withc));
  return jsonb_build_object('kind', p_kind, 'rows', rows, 'count', n, 'excluded_fields', excl, 'controlled_included', withc);
end $$;
revoke execute on function public.crm_export(text, jsonb) from public, anon;
grant execute on function public.crm_export(text, jsonb) to authenticated;

/** E-mail → which contact, organisation or opportunity it most likely belongs to (suggestions; nothing is linked). */
create or replace function public.crm_email_suggest(p_from text, p_subject text, p_source_kind text default null, p_source_id text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); addr text := lower(substring(coalesce(p_from, '') from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')); dom text; out jsonb := '[]'::jsonb; x record; num text;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  dom := split_part(coalesce(addr, ''), '@', 2);
  -- the exact address of a contact (strong), then that contact's organisation and open opportunities
  for x in select r.* from public.records r where r.section = 'company.contacts' and addr is not null and lower(r.data->>'email') = addr and coalesce(r.data->>'merged_into', '') = '' limit 5 loop
    if not public.record_visible_for(me, x::public.records) then continue; end if;
    out := out || jsonb_build_object('target', x.id, 'section', 'company.contacts', 'title', x.title, 'why', 'the sender''s address is this contact''s e-mail', 'strength', 'strong');
    out := out || coalesce((select jsonb_agg(jsonb_build_object('target', o.id, 'section', 'sales.pipeline', 'title', coalesce(o.data->>'number', '') || ' ' || o.title, 'why', 'open opportunity of this contact', 'strength', 'likely'))
      from public.records o where o.section = 'sales.pipeline' and o.data->>'contact_ref' = x.id::text and public.crm_stage_kind(o.status) = 'open' and public.record_visible_for(me, o)), '[]'::jsonb);
  end loop;
  -- an opportunity number in the subject (strong)
  num := substring(coalesce(p_subject, '') from '[A-Z]{2,5}-OPP-\d{4}-\d{3,}');
  if num is not null then
    for x in select r.* from public.records r where r.section = 'sales.pipeline' and r.data->>'number' = num limit 1 loop
      if public.record_visible_for(me, x::public.records) then out := out || jsonb_build_object('target', x.id, 'section', 'sales.pipeline', 'title', num || ' ' || x.title, 'why', 'opportunity number in the subject', 'strength', 'strong'); end if;
    end loop;
  end if;
  -- the company's own domain (not a free mailbox): its organisation (likely)
  if dom <> '' and not public._crm_free_mail(dom) then
    for x in select r.* from public.records r where r.section = 'company.parties' and lower(r.data->>'domain') = dom and coalesce(r.data->>'merged_into', '') = '' limit 3 loop
      if public.record_visible_for(me, x::public.records) and not out @> jsonb_build_array(jsonb_build_object('target', x.id)) then
        out := out || jsonb_build_object('target', x.id, 'section', 'company.parties', 'title', x.title, 'why', 'sender domain ' || dom, 'strength', 'likely');
      end if;
    end loop;
  end if;
  if p_source_kind in ('record', 'outbound', 'inbound') and coalesce(p_source_id, '') <> '' then
    insert into public.crm_email_links(source_kind, source_id, from_addr, subject, target_id, target_section, why, strength)
    select p_source_kind, left(p_source_id, 200), addr, left(p_subject, 300), (s->>'target')::uuid, s->>'section', s->>'why', s->>'strength' from jsonb_array_elements(out) s
    on conflict (source_kind, source_id, target_id) do nothing;
  end if;
  return jsonb_build_object('from', addr, 'suggestions', out, 'note', 'Suggestions only: a person confirms each link.');
end $$;
revoke execute on function public.crm_email_suggest(text, text, text, text) from public, anon;
grant execute on function public.crm_email_suggest(text, text, text, text) to authenticated;

/** Confirm (or reject) one suggested e-mail link; a confirmed link appears in the timeline as an e-mail. */
create or replace function public.crm_email_link(p_source_kind text, p_source_id text, p_target uuid, p_accept boolean, p_subject text default null, p_from text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); t public.records;
begin
  select * into t from public.records where id = p_target and section in ('company.contacts', 'company.parties', 'sales.pipeline');
  if me is null or not found or not public.record_visible_for(me, t) then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if not public._crm_can_write(me, t.section) then raise exception 'You cannot change this record' using errcode = '42501'; end if;
  insert into public.crm_email_links(source_kind, source_id, from_addr, subject, target_id, target_section, why, strength, status, decided_by, decided_at)
  values (p_source_kind, left(p_source_id, 200), lower(p_from), left(p_subject, 300), t.id, t.section, 'linked by a person', 'strong', case when p_accept then 'confirmed' else 'rejected' end, me, now())
  on conflict (source_kind, source_id, target_id) do update set status = excluded.status, decided_by = me, decided_at = now(), subject = coalesce(public.crm_email_links.subject, excluded.subject);
  insert into public.crm_audit(actor, kind, record_id, detail) values (me, case when p_accept then 'email_linked' else 'email_link_rejected' end, t.id, jsonb_build_object('source', p_source_kind || ':' || p_source_id));
  return jsonb_build_object('ok', true, 'status', case when p_accept then 'confirmed' else 'rejected' end);
end $$;
revoke execute on function public.crm_email_link(text, text, uuid, boolean, text, text) from public, anon;
grant execute on function public.crm_email_link(text, text, uuid, boolean, text, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   14. Commercial notices (service role, every hour): follow-up due or overdue, meeting approaching, proposal
       expiring, expected decision, stalled, lead follow-up, on-hold review — each once per occasion (keys)
   --------------------------------------------------------------------------------------------- */
create or replace function public.crm_tick() returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare fu jsonb := coalesce(public.crm_cfg()->'followup', '{}'::jsonb); x record; n int := 0; t0 timestamptz := clock_timestamp(); more boolean := false; who uuid; today date := current_date;
  soon int := coalesce((fu->>'due_soon_days')::int, 2); u uuid;
begin
  if auth.uid() is not null then raise exception 'Not allowed' using errcode = '42501'; end if;
  -- opportunities: the next action, the expected decision, the review date of a hold
  for x in select r.* from public.records r where r.section = 'sales.pipeline' and public.crm_stage_kind(r.status) in ('open', 'hold')
             and (public._crm_date(r.data->>'next_action_due') <= today + soon or public._crm_date(r.data->>'expected_decision') <= today or public._crm_date(r.data->>'hold_review') <= today)
           order by r.updated_at limit 2000 loop
    if clock_timestamp() - t0 > interval '2 seconds' then more := true; exit; end if;
    who := coalesce(public.as_uuid(x.data->>'next_action_owner_id'), public.as_uuid(x.data->>'owner_id'));
    continue when who is null;
    if public.crm_stage_kind(x.status) = 'open' and public._crm_date(x.data->>'next_action_due') between today and today + soon then
      if public.notify_user(who, 'crm_follow_up_due', x.id, 'crm-fu:' || x.id || ':' || (x.data->>'next_action_due'), 'Follow-up due ' || (x.data->>'next_action_due') || ': ' || coalesce(x.data->>'number', '') || ' ' || x.title,
        coalesce(x.data->>'next_action', ''), null, '/crm?opp=' || x.id) then n := n + 1; end if;
    elsif public.crm_stage_kind(x.status) = 'open' and public._crm_date(x.data->>'next_action_due') < today then
      if public.notify_user(who, 'crm_follow_up_overdue', x.id, 'crm-od:' || x.id || ':' || (x.data->>'next_action_due'), 'Follow-up overdue: ' || coalesce(x.data->>'number', '') || ' ' || x.title,
        'Was due ' || (x.data->>'next_action_due') || ' — ' || coalesce(x.data->>'next_action', ''), null, '/crm?opp=' || x.id) then n := n + 1; end if;
    end if;
    if public.crm_stage_kind(x.status) = 'open' and public._crm_date(x.data->>'expected_decision') <= today then
      if public.notify_user(who, 'crm_decision_due', x.id, 'crm-dec:' || x.id || ':' || (x.data->>'expected_decision'), 'Expected decision ' || (x.data->>'expected_decision') || ': ' || coalesce(x.data->>'number', '') || ' ' || x.title,
        'Update the expected decision date or record the decision', null, '/crm?opp=' || x.id) then n := n + 1; end if;
    end if;
    if public.crm_stage_kind(x.status) = 'hold' and public._crm_date(x.data->>'hold_review') <= today then
      if public.notify_user(who, 'crm_hold_review', x.id, 'crm-hold:' || x.id || ':' || (x.data->>'hold_review'), 'On hold — review today: ' || coalesce(x.data->>'number', '') || ' ' || x.title,
        coalesce(x.data->>'hold_reason', ''), null, '/crm?opp=' || x.id) then n := n + 1; end if;
    end if;
  end loop;
  -- stalled (no interaction, a proposal without answer, negotiation unchanged): one notice per situation
  if not more then
    for x in select r.id, r.title, r.data, coalesce((select max(coalesce(public._crm_date(a.data->>'date')::timestamptz, a.created_at)) from public.records a
               where a.data->>'deal_ref' = r.id::text and a.section in ('sales.activities', 'company.meetings', 'sales.proposals') and coalesce(a.status, '') not in ('Cancelled', 'Planned')), r.created_at) last_at
             from public.records r where r.section = 'sales.pipeline' and public.crm_stage_kind(r.status) = 'open' and coalesce(r.data->>'owner_id', '') <> ''
               and r.updated_at < now() - make_interval(days => coalesce((fu->>'no_interaction_days')::int, 14)) order by r.updated_at limit 1000 loop
      if clock_timestamp() - t0 > interval '2 seconds' then more := true; exit; end if;
      continue when x.last_at >= now() - make_interval(days => coalesce((fu->>'no_interaction_days')::int, 14));
      if public.notify_user((x.data->>'owner_id')::uuid, 'crm_stalled', x.id, 'crm-st:' || x.id || ':' || left(x.last_at::text, 10), 'Stalled: ' || coalesce(x.data->>'number', '') || ' ' || x.title,
        'No interaction since ' || left(x.last_at::text, 10), null, '/crm?opp=' || x.id) then n := n + 1; end if;
    end loop;
  end if;
  -- sent proposals about to expire
  if not more then
    for x in select r.* from public.records r where r.section = 'sales.proposals' and r.status = 'Sent' and public._crm_date(r.data->>'valid_until') between today and today + coalesce((fu->>'proposal_expiry_days')::int, 7) limit 1000 loop
      u := coalesce(public.as_uuid(x.data->>'owner_id'), x.created_by); continue when u is null;
      if public.notify_user(u, 'crm_proposal_expiring', x.id, 'crm-px:' || x.id || ':' || (x.data->>'valid_until'), 'Proposal valid until ' || (x.data->>'valid_until') || ': ' || x.title,
        'Follow up before it expires, or make a new version', null, '/sales/proposals?r=' || x.id) then n := n + 1; end if;
    end loop;
  end if;
  -- commercial meetings in the next hours (organizer and participants)
  if not more then
    for x in select r.* from public.records r where r.section = 'company.meetings' and coalesce(r.status, 'Scheduled') = 'Scheduled'
               and (coalesce(r.data->>'deal_ref', '') <> '' or coalesce(r.data->>'party_ref', '') <> '' or coalesce(r.data->>'event_ref', '') <> '')
               and public._crm_date(r.data->>'date') between today and today + 1 limit 1000 loop
      continue when (public._crm_date(x.data->>'date') + coalesce(nullif(x.data->>'time', ''), '09:00')::time) > (now() at time zone 'utc') + make_interval(hours => coalesce((fu->>'meeting_soon_hours')::int, 24));
      for u in select distinct z::uuid from (select x.data->>'organizer_id' z union all select jsonb_array_elements_text(coalesce(x.data->'participants_ids', '[]'::jsonb))) q where z ~ '^[0-9a-f-]{36}$' loop
        if public.notify_user(u, 'crm_meeting_soon', x.id, 'crm-mt:' || x.id || ':' || (x.data->>'date') || ':' || u, 'Meeting ' || (x.data->>'date') || ' ' || coalesce(x.data->>'time', '') || ': ' || x.title,
          concat_ws(' · ', x.data->>'party_ref_title', x.data->>'deal_ref_title', x.data->>'place'), null, '/company/meetings?r=' || x.id) then n := n + 1; end if;
      end loop;
    end loop;
  end if;
  -- leads (and event leads) to follow up
  if not more then
    for x in select r.* from public.records r where r.section = 'marketing.leads' and coalesce(r.status, 'New') in ('New', 'Reviewing', 'Qualified')
               and public._crm_date(r.data->>'follow_up') <= today and coalesce(r.data->>'owner_id', '') <> '' limit 2000 loop
      if clock_timestamp() - t0 > interval '2 seconds' then more := true; exit; end if;
      if public.notify_user((x.data->>'owner_id')::uuid, case when coalesce(x.data->>'event_ref', '') <> '' then 'crm_event_follow_up' else 'crm_lead_follow_up' end, x.id,
        'crm-lf:' || x.id || ':' || (x.data->>'follow_up'), 'Follow up ' || x.title, concat_ws(' · ', x.data->>'organization', x.data->>'event_ref_title', 'due ' || (x.data->>'follow_up')), null, '/crm?lead=' || x.id) then n := n + 1; end if;
    end loop;
  end if;
  return jsonb_build_object('notices', n, 'more', more);
end $$;
revoke execute on function public.crm_tick() from public, anon, authenticated;
grant execute on function public.crm_tick() to service_role;

/* ---------------------------------------------------------------------------------------------
   15. Starting configuration: the proposal approval policy (UNAPPROVED DEFAULT CONFIGURATION: capability holders,
       never named people) and the proposal approval process; existing data moved onto the new statuses once
   --------------------------------------------------------------------------------------------- */
insert into public.approval_policies(code, name, section, tiers, seeded, config_status) values
('PROPOSAL', 'Commercial proposal approval', 'sales.proposals', $j$[
  {"label": "Up to 250,000 and a discount up to 10%", "when": {"all": [{"field": "facts.amount", "op": "lte", "value": 250000}, {"field": "facts.discount", "op": "lte", "value": 10}]}, "mode": "sequential",
   "steps": [{"kind": "capability", "cap": "proposal_approver", "label": "Proposal approver"}]},
  {"label": "Above 250,000 or a discount above 10%", "mode": "sequential",
   "steps": [{"kind": "capability", "cap": "proposal_approver", "label": "Proposal approver"}, {"kind": "capability", "cap": "pricing_approver", "label": "Pricing approver"}]}
]$j$::jsonb, true, 'Draft')
on conflict (code) do nothing;

do $$
declare d jsonb := $j${"code": "PROPOSAL", "name": "Proposal approval", "category": "sales", "source_section": "sales.proposals", "owner_role": "sales", "owner_department": "sales",
   "completion": {"completed": "Approved", "rejected": "Draft", "cancelled": "Draft"},
   "description": "The exact version of a proposal is approved before it is sent. A changed value is a new version with a new approval.",
   "steps": [
    {"id": "approval", "name": "Approval of this version", "type": "APPROVAL", "policy": "PROPOSAL", "record_status": "Internal Review", "sla": {"amount": 2, "unit": "business_days"},
     "on": {"success": "$complete", "changes_requested": "revise", "rejected": "$reject"}},
    {"id": "revise", "name": "Revise the proposal", "type": "DATA", "responsible": {"kind": "requester"}, "record_status": "Draft",
     "instructions": "Change what the approver asked for, then submit: the approval is asked again on the new values.", "on": {"success": "approval"}}
   ]}$j$::jsonb; errs jsonb; nid uuid;
begin
  if exists (select 1 from public.wf_definitions w where w.code = 'PROPOSAL') then return; end if;
  errs := public.wf_validate(d);
  if jsonb_array_length(errs) > 0 then raise exception 'Starting definition PROPOSAL is not valid: %', errs; end if;
  insert into public.wf_definitions(code, version, name, description, category, source_section, owner_department, owner_role, steps, sla, completion, template, state, published_at)
  values (d->>'code', 1, d->>'name', d->>'description', d->>'category', d->>'source_section', d->>'owner_department', d->>'owner_role', d->'steps', d->'sla', d->'completion', false, 'published', now())
  returning id into nid;
  insert into public.wf_events(kind, to_state, detail) values ('definition_published', 'published', jsonb_build_object('definition', nid, 'code', 'PROPOSAL', 'version', 1, 'by', 'v24 starting configuration'));
end $$;

-- once (the first time v24 is applied): statuses onto the new lists (the previous value is kept for the rollback),
-- numbers for existing opportunities, relationship types from where an organisation already appears, the
-- organisation of an opportunity from its client card, and the start of the value and stage history
do $$
declare x record;
begin
  if coalesce((public.crm_cfg()->>'migrated')::boolean, false) then return; end if;
  perform set_config('agron.crm_reason', 'Moved to the Phase 7 pipeline (v24)', true);
  update public.records set status = 'New', data = data || '{"p7_prev_status": "Lead"}'::jsonb where section = 'sales.pipeline' and status = 'Lead';
  update public.records set status = case status when 'Contacted' then 'Reviewing' when 'To pipeline' then 'Converted' when 'Dropped' then 'Disqualified' end,
    data = data || jsonb_build_object('p7_prev_status', status) where section = 'marketing.leads' and status in ('Contacted', 'To pipeline', 'Dropped');
  update public.records set status = 'Inactive', data = data || '{"p7_prev_status": "Archived"}'::jsonb where section = 'company.contacts' and status = 'Archived';
  for x in select id from public.records where section = 'sales.pipeline' and coalesce(data->>'number', '') = '' order by created_at loop
    update public.records set data = data || jsonb_build_object('number', public.ops_number('sales.pipeline', null), 'p7_numbered', true) where id = x.id;
  end loop;
  update public.records set data = data || jsonb_build_object('version', 1, 'p7_versioned', true) where section = 'sales.proposals' and coalesce(data->>'version', '') = '';
  update public.records o set data = o.data || jsonb_build_object('party_ref', c.data->>'party_ref', 'party_ref_title', c.data->>'party_ref_title', 'p7_party_linked', true)
    from public.records c where o.section = 'sales.pipeline' and coalesce(o.data->>'party_ref', '') = '' and c.id = public.as_uuid(o.data->>'client_ref') and c.section = 'sales.clients' and coalesce(c.data->>'party_ref', '') <> '';
  update public.records p set data = p.data || jsonb_build_object('relationship_types', t.types, 'p7_types_backfilled', true)
    from (select public.as_uuid(r.data->>'party_ref') pid, jsonb_agg(distinct case r.section when 'sales.clients' then case when r.status = 'Prospect' then 'Prospect' else 'Customer' end
            when 'sales.partners' then 'Partner' when 'operations.vendors' then 'Vendor' when 'marketing.agencies' then 'Contractor' end) types
          from public.records r where r.section in ('sales.clients', 'sales.partners', 'operations.vendors', 'marketing.agencies') and coalesce(r.data->>'party_ref', '') <> '' group by 1) t
    where p.id = t.pid and p.section = 'company.parties' and coalesce(jsonb_array_length(p.data->'relationship_types'), 0) = 0;
  insert into public.crm_stage_history(record_id, from_stage, to_stage, actor, at, reason)
    select r.id, null, r.status, null, r.updated_at, 'Stage when the commercial history began (v24)' from public.records r where r.section = 'sales.pipeline'
      and not exists (select 1 from public.crm_stage_history h where h.record_id = r.id);
  insert into public.crm_values(record_id, kind, amount, currency, actor, at, reason, source)
    select r.id, 'estimate', public._num(r.data->'value'), r.data->>'currency', null, r.updated_at, 'Value when the commercial history began (v24)', 'migration'
    from public.records r where r.section = 'sales.pipeline' and public._num(r.data->'value') is not null and not exists (select 1 from public.crm_values v where v.record_id = r.id);
  update public.crm_settings set value = value || '{"migrated": true}'::jsonb where id;
  perform set_config('agron.crm_reason', '', true);
end $$;

/* ---------------------------------------------------------------------------------------------
   16. The scheduled job (service role) and the API reload
   --------------------------------------------------------------------------------------------- */
grant execute on function public.crm_tick() to service_role;
-- the API re-reads the functions (the read models run read-write: they build temporary working sets)
notify pgrst, 'reload schema';

commit;
