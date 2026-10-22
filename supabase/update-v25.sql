-- AGRON Workspace — v25 (Phase 8: manufacturing, BOM, inventory and build control). Builds on v18–v24.
-- One transaction; safe to run again; nothing is deleted.
--
-- No second ERP: the existing record model carries the manufacturing objects people open and discuss —
--   technical.products        product master (C20, C40, Sprinter are starting data, never logic)
--   technical.configurations  product configurations (versioned; approved = immutable)
--   technical.items           the one item master (AGRON item number from the atomic numbering)
--   technical.boms            BOM revisions (one record per revision; approval of the exact line set)
--   technical.test_procedures controlled test procedure references with their structured fields
--   operations.builds         the Build Unit (the existing container builds, on the Phase 8 lifecycle)
--   operations.work_orders    manufacturing work orders (routing steps, rework)
--   operations.quality        inspections (receiving, in-process, final)
--   technical.testing         test runs;   company.issues  nonconformance (P6 issues)
--   operations.requests / procurement / receipts  P6 purchasing and receiving, unchanged
--   technical.changes         P6 engineering change (ECR) with effectivity and confirmed impact
-- New tables hold only what records cannot: BOM lines, alternates, locations, the inventory ledger and balances,
-- lots, serials, installations, allocations, software history, test values, As-Built revisions, acceptance and
-- shipment release, change impact, settings (+history), imports and the manufacturing audit (append-only).
-- Every reading function shows only what the viewer may open; every writing function checks the capability.
begin;

do $$ begin
  if to_regprocedure('public.has_cap(uuid,text)') is null or to_regprocedure('public._crm_base(uuid,uuid)') is null then raise exception 'Apply update-v24.sql first'; end if;
end $$;

/* ---------------------------------------------------------------------------------------------
   1. Access to the new sections (the generated access.sql says the same; custom access is never overwritten)
   --------------------------------------------------------------------------------------------- */
insert into public.section_access(section, role, can_write, external)
select s, r, w, false from (values
  ('technical.products', 'management', false), ('technical.products', 'engineering', true), ('technical.products', 'operations', false), ('technical.products', 'procurement', false),
  ('technical.products', 'sales', false), ('technical.products', 'finance', false), ('technical.products', 'security', false), ('technical.products', 'legal', false),
  ('technical.configurations', 'management', false), ('technical.configurations', 'engineering', true), ('technical.configurations', 'operations', false),
  ('technical.items', 'management', false), ('technical.items', 'engineering', true), ('technical.items', 'operations', true), ('technical.items', 'procurement', true), ('technical.items', 'finance', false),
  ('technical.boms', 'management', false), ('technical.boms', 'engineering', true), ('technical.boms', 'operations', false),
  ('technical.test_procedures', 'management', false), ('technical.test_procedures', 'engineering', true), ('technical.test_procedures', 'operations', false),
  ('operations.work_orders', 'management', true), ('operations.work_orders', 'engineering', true), ('operations.work_orders', 'operations', true)
) v(s, r, w)
on conflict do nothing;

/* ---------------------------------------------------------------------------------------------
   2. Manufacturing settings: one document (build lifecycle and its prerequisites, catalogs, numbering, readiness
      rules, who sees costs, the capabilities management holds by policy), every change kept
   --------------------------------------------------------------------------------------------- */
create table if not exists public.mfg_settings (
  id boolean primary key default true check (id), value jsonb not null default '{}'::jsonb, version integer not null default 1,
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.mfg_settings_history (
  id bigserial primary key, changed_at timestamptz not null default now(), changed_by uuid, before jsonb, after jsonb
);
alter table public.mfg_settings enable row level security;
alter table public.mfg_settings_history enable row level security;
revoke all on public.mfg_settings, public.mfg_settings_history from anon, authenticated;

-- starting values: every value is configurable (Manufacturing → Settings); names are catalog values, not logic
insert into public.mfg_settings(id, value) values (true, $j${
  "build_statuses": [
    {"status": "Planned", "kind": "open"},
    {"status": "Engineering", "kind": "open"},
    {"status": "Material Planning", "kind": "open"},
    {"status": "Procurement", "kind": "open"},
    {"status": "Ready for Build", "kind": "open", "requires": ["released"]},
    {"status": "Assembly", "kind": "build", "requires": ["released", "build_ready"]},
    {"status": "Integration", "kind": "build", "requires": ["released"]},
    {"status": "Inspection", "kind": "build", "requires": ["released"]},
    {"status": "Testing", "kind": "build", "requires": ["released"]},
    {"status": "Rework", "kind": "build", "requires": ["released"]},
    {"status": "Acceptance", "kind": "build", "requires": ["released"]},
    {"status": "Ready for Shipment", "kind": "done", "requires": ["accepted"]},
    {"status": "Shipped", "kind": "done", "requires": ["accepted", "shipment_released"]},
    {"status": "Delivered", "kind": "done", "requires": ["accepted", "shipment_released"]},
    {"status": "Hold", "kind": "hold", "requires_reason": true},
    {"status": "Cancelled", "kind": "cancelled", "requires_reason": true}
  ],
  "legacy_status_map": {"Design": "Engineering", "Procurement": "Procurement", "Assembly": "Assembly", "Integration": "Integration", "Testing": "Testing", "Shipping": "Shipped", "Installed": "Delivered"},
  "item_types": ["Purchased Part", "Manufactured Part", "Assembly", "Subassembly", "Equipment", "Material", "Consumable", "Tool", "Software License", "Service", "Documentation Item", "Customer-Supplied Item", "Other"],
  "item_categories": ["Structure", "Electrical", "Power", "Cooling / HVAC", "Racks", "Communications", "Sensors", "Computing", "Software", "Cabling", "Fasteners", "Consumables", "Tools", "Services", "Other"],
  "uoms": ["ea", "set", "m", "kg", "l", "lot", "h", "license"],
  "classifications": ["Unrestricted", "Internal", "Controlled — entered", "US Persons Only"],
  "inspection_kinds": ["Receiving Inspection", "In-Process Inspection", "Final Inspection"],
  "test_categories": ["Power", "UPS / battery", "Generator", "HVAC", "Networking", "Communications", "Sensors", "Software", "Integration", "Failover", "Environmental", "Other"],
  "software_components": ["AGRON 1 release", "Edge Runtime release", "Configuration profile", "Adapter", "Firmware", "Operating system image", "Other"],
  "dispositions": ["Rework", "Replace", "Return to Vendor", "Use As Is", "Scrap", "Investigate"],
  "receive_default_state": "Inspection",
  "required_inspections_default": ["Final Inspection"],
  "test_approval_required": true,
  "shipping_documents_default": ["Packing list", "Commercial invoice", "As-Built configuration"],
  "late_purchase_grace_days": 0,
  "cost_roles": ["owner", "management", "finance"],
  "cost_caps": ["manufacturing_admin", "build_manager"],
  "management_caps": [],
  "export_excluded_fields": [],
  "numbering": {"technical.items": "ITM", "technical.boms": "BOM", "operations.work_orders": "WO", "operations.quality": "INS", "technical.testing": "TST", "technical.configurations": "CFG", "technical.test_procedures": "TP"}
}$j$::jsonb)
on conflict (id) do nothing;

create or replace function public.mfg_cfg() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.mfg_settings where id), '{}'::jsonb)
$$;
revoke execute on function public.mfg_cfg() from public, anon, authenticated;

-- the numbering formats (examples; every format can be changed in Administration → Numbering); no year in item numbers
insert into public.doc_number_formats(scope, doc_type, pattern, company)
select 'ops', t, p, 'AGR' from (values ('ITM', '{CO}-{TYPE}-{SEQ:6}'), ('BOM', '{CO}-{TYPE}-{SEQ:4}'), ('WO', '{CO}-{TYPE}-{YEAR}-{SEQ:5}'), ('INS', '{CO}-{TYPE}-{YEAR}-{SEQ:5}'),
  ('TST', '{CO}-{TYPE}-{YEAR}-{SEQ:5}'), ('CFG', '{CO}-{TYPE}-{SEQ:4}'), ('TP', '{CO}-{TYPE}-{SEQ:4}')) v(t, p)
where not exists (select 1 from public.doc_number_formats f where f.scope = 'ops' and f.doc_type = v.t);
-- the numbering setting of v23 learns the manufacturing types (kept as they are when already set)
update public.ops_settings set value = jsonb_set(value, '{numbering}', coalesce(value->'numbering', '{}'::jsonb) || jsonb_build_object(
    'technical.items', coalesce(value->'numbering'->>'technical.items', 'ITM'), 'technical.boms', coalesce(value->'numbering'->>'technical.boms', 'BOM'),
    'operations.work_orders', coalesce(value->'numbering'->>'operations.work_orders', 'WO'), 'operations.quality', coalesce(value->'numbering'->>'operations.quality', 'INS'),
    'technical.testing', coalesce(value->'numbering'->>'technical.testing', 'TST')))
  where id;
-- an approval of a BOM revision or a configuration is for its exact content (the line set is a hash kept on the record)
update public.ops_settings set value = jsonb_set(value, '{material}', coalesce(value->'material', '{}'::jsonb) || jsonb_build_object(
    'technical.boms', '["lines_hash", "config_ref", "revision", "effectivity", "ecr_ref"]'::jsonb,
    'technical.configurations', '["product_ref", "version", "routing", "required_tests", "required_inspections", "required_documents", "documents"]'::jsonb))
  where id and not (coalesce(value->'material', '{}'::jsonb) ? 'technical.boms');

/* ---------------------------------------------------------------------------------------------
   3. Capabilities: the business authorities of manufacturing and the Policy Approver. Owner: every capability.
      Management: only those the manufacturing policy names (none by default). A System Administrator: none by role.
   --------------------------------------------------------------------------------------------- */
create or replace function public.mfg_cap_names() returns text[] language sql immutable as $$
  select array['manufacturing_admin', 'bom_editor', 'bom_approver', 'inventory_manager', 'build_manager', 'work_order_manager', 'quality_inspector', 'quality_approver',
               'test_operator', 'test_approver', 'engineering_change_approver', 'unit_acceptance_approver', 'shipment_release_approver']
$$;
create or replace function public.business_cap_names() returns text[] language sql immutable as $$
  select array['commercial_admin', 'workflow_admin', 'pricing_approver', 'proposal_approver', 'export_commercial', 'policy_approver'] || public.mfg_cap_names()
$$;
alter table public.crm_caps drop constraint if exists crm_caps_cap_check;
alter table public.crm_caps add constraint crm_caps_cap_check check (cap = any (public.business_cap_names()));

create or replace function public.has_cap(p_uid uuid, p_cap text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.role = 'owner' then true
      when exists (select 1 from public.crm_caps c where c.user_id = p.id and c.cap = p_cap and c.revoked_at is null) then true
      -- management by policy: the commercial policy for commercial capabilities, the manufacturing policy for manufacturing ones
      when p.role = 'management' and p_cap = any (public.mfg_cap_names()) then coalesce(public.mfg_cfg()->'management_caps', '[]'::jsonb) ? p_cap
      when p.role = 'management' and coalesce(public.crm_cfg()->'management_caps', '[]'::jsonb) ? p_cap then true
      else false end
    from public.profiles p where p.id = p_uid and not p.disabled), false)
$$;
revoke execute on function public.has_cap(uuid, text) from public, anon, authenticated;

create or replace function public.crm_cap_set(p_user uuid, p_cap text, p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'owner') then raise exception 'Only an owner grants or removes business capabilities' using errcode = '42501'; end if;
  if not (p_cap = any (public.business_cap_names())) then raise exception 'Unknown capability %', p_cap using errcode = '22023'; end if;
  if p_on and not public.is_active_employee(p_user) then raise exception 'Capabilities go to active employees only' using errcode = '23514'; end if;
  if p_on then
    insert into public.crm_caps(user_id, cap, granted_by) values (p_user, p_cap, me)
      on conflict (user_id, cap) do update set granted_by = me, granted_at = now(), revoked_at = null, revoked_by = null;
  else
    update public.crm_caps set revoked_at = now(), revoked_by = me where user_id = p_user and cap = p_cap and revoked_at is null;
  end if;
  insert into public.crm_audit(actor, kind, detail) values (me, case when p_on then 'cap_granted' else 'cap_revoked' end, jsonb_build_object('user', p_user, 'cap', p_cap));
  if p_cap = any (public.mfg_cap_names()) or p_cap = 'policy_approver' then
    insert into public.mfg_audit(actor, kind, detail) values (me, case when p_on then 'cap_granted' else 'cap_revoked' end, jsonb_build_object('user', p_user, 'cap', p_cap));
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.crm_cap_set(uuid, text, boolean) from public, anon;
grant execute on function public.crm_cap_set(uuid, text, boolean) to authenticated;

create or replace function public.crm_caps_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.crm_viewer();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'owner') and not public.has_cap(me, 'commercial_admin') and not public.has_cap(me, 'manufacturing_admin') then
    raise exception 'Only an owner, a Commercial Admin or a Manufacturing Admin sees who holds business capabilities' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'grants', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', coalesce(nullif(p.full_name, ''), p.email), 'role', p.role, 'cap', c.cap,
        'granted_at', c.granted_at, 'granted_by', c.granted_by, 'revoked_at', c.revoked_at) order by p.full_name, c.cap)
      from public.crm_caps c join public.profiles p on p.id = c.user_id), '[]'::jsonb),
    'management_caps', coalesce(public.crm_cfg()->'management_caps', '[]'::jsonb),
    'mfg_management_caps', coalesce(public.mfg_cfg()->'management_caps', '[]'::jsonb),
    'caps', to_jsonb(public.business_cap_names()),
    'can_grant', exists (select 1 from public.profiles where id = me and role = 'owner'));
end $$;
revoke execute on function public.crm_caps_list() from public, anon;
grant execute on function public.crm_caps_list() to authenticated;

create or replace function public.mfg_my_caps() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(c, public.has_cap(auth.uid(), c)), '{}'::jsonb)
  from unnest(public.mfg_cap_names() || array['policy_approver', 'workflow_admin']) c
  where public.crm_viewer() is not null
$$;
revoke execute on function public.mfg_my_caps() from public, anon;
grant execute on function public.mfg_my_caps() to authenticated;

/* ---------------------------------------------------------------------------------------------
   4. Policy Approver (P7 remediation). A Workflow Admin builds, validates and publishes processes; confirming a
      business authority policy (purchase, payment, contract, ECR, travel, proposal, manufacturing) as AGRON policy
      needs the Owner or the Policy Approver capability. Editing a policy stays with its admin capability.
   --------------------------------------------------------------------------------------------- */
create or replace function public._policy_cap(p_code text, p_section text) returns text language sql immutable as $$
  select case when p_code like 'PROPOSAL%' or coalesce(p_section, '') like 'sales.%' then 'commercial_admin'
              when p_code in ('BOM', 'CONFIG', 'MFG') or p_code like 'MFG%' or coalesce(p_section, '') in ('technical.boms', 'technical.configurations', 'operations.builds', 'operations.work_orders') then 'manufacturing_admin'
              else 'workflow_admin' end
$$;

create or replace function public._policy_approver(p_uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'owner' from public.profiles p where p.id = p_uid and not p.disabled), false) or public.has_cap(p_uid, 'policy_approver')
$$;
revoke execute on function public._policy_approver(uuid) from public, anon, authenticated;

create or replace function public.ops_policy_approve(p_code text, p_version integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.crm_viewer(); pol public.approval_policies;
begin
  select * into pol from public.approval_policies where code = p_code for update;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if me is null or not public._policy_approver(me) then
    raise exception 'Only the Owner or a Policy Approver confirms a business authority policy as AGRON policy (a Workflow Admin builds processes but does not approve authority)' using errcode = '42501';
  end if;
  if pol.version <> p_version then raise exception 'The policy changed since you opened it (version %); review it again', pol.version using errcode = '40001'; end if;
  if pol.config_status = 'Approved' then return jsonb_build_object('ok', true, 'status', 'Approved', 'note', 'Already approved'); end if;
  insert into public.approval_policies_history(policy_code, changed_by, before, after, config_status, version)
    values (pol.code, me, to_jsonb(pol), jsonb_build_object('config_status', 'Approved', 'version', pol.version), 'Approved', pol.version);
  insert into public.approval_policies_history(policy_code, changed_by, before, after, config_status, version)
    select pol.code, me, null, jsonb_build_object('superseded_by_version', pol.version), 'Superseded', pol.approved_version where pol.approved_version is not null and pol.approved_version <> pol.version;
  update public.approval_policies set config_status = 'Approved', approved_by = me, approved_at = now(), approved_version = version where code = p_code;
  insert into public.crm_audit(actor, kind, detail) values (me, 'policy_approved', jsonb_build_object('code', pol.code, 'version', pol.version));
  if public._policy_cap(pol.code, pol.section) = 'manufacturing_admin' then
    insert into public.mfg_audit(actor, kind, detail) values (me, 'policy_approved', jsonb_build_object('code', pol.code, 'version', pol.version));
  end if;
  return jsonb_build_object('ok', true, 'status', 'Approved', 'version', pol.version);
end $$;
revoke execute on function public.ops_policy_approve(text, integer) from public, anon;
grant execute on function public.ops_policy_approve(text, integer) to authenticated;

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
        'can_approve', public._policy_approver(me)) order by p.code)
      from public.approval_policies p), '[]'::jsonb),
    'can_edit', public.has_cap(me, 'workflow_admin'),
    'can_approve_policies', public._policy_approver(me));
end $$;
revoke execute on function public.ops_settings_get() from public, anon;
grant execute on function public.ops_settings_get() to authenticated;

-- an approver may also be "everyone holding a capability" — now including the manufacturing authorities
create or replace function public._wf_resp_error(sp jsonb, what text) returns text language plpgsql stable security definer set search_path = public as $$
begin
  if sp is null or jsonb_typeof(sp) <> 'object' then return what || ': who is responsible is missing'; end if;
  if sp->>'kind' not in ('requester', 'role', 'department_lead', 'project_manager', 'workflow_owner', 'field', 'capability') then return what || ': unknown kind of responsible «' || coalesce(sp->>'kind', '') || '»'; end if;
  if sp->>'kind' = 'role' and not (sp->>'role' = any(public.wf_known_roles())) then return what || ': unknown role «' || coalesce(sp->>'role', '') || '»'; end if;
  if sp->>'kind' = 'capability' and not (coalesce(sp->>'cap', '') = any (array['pricing_approver', 'proposal_approver', 'commercial_admin', 'workflow_admin'] || public.mfg_cap_names())) then return what || ': unknown capability «' || coalesce(sp->>'cap', '') || '»'; end if;
  if sp->>'kind' = 'department_lead' and sp ? 'dept' and not exists (select 1 from public.departments d where d.key = sp->>'dept') then return what || ': unknown department «' || coalesce(sp->>'dept', '') || '»'; end if;
  if sp->>'kind' = 'field' and coalesce(sp->>'field', '') !~ '^[a-z][a-z0-9_]{0,40}_id$' then return what || ': the person field must end in _id'; end if;
  if sp ? 'fallback' then return public._wf_resp_error(sp->'fallback', what || ' (fallback)'); end if;
  return null;
end $$;
revoke execute on function public._wf_resp_error(jsonb, text) from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   5. The manufacturing audit (append-only) and small helpers
   --------------------------------------------------------------------------------------------- */
create table if not exists public.mfg_audit (
  id bigserial primary key, at timestamptz not null default now(), actor uuid, kind text not null, record_id uuid, unit_id uuid, detail jsonb not null default '{}'::jsonb
);
create index if not exists mfg_audit_record_idx on public.mfg_audit(record_id, at);
create index if not exists mfg_audit_unit_idx on public.mfg_audit(unit_id, at);
alter table public.mfg_audit enable row level security;
revoke all on public.mfg_audit from anon, authenticated;
drop trigger if exists mfg_audit_guard on public.mfg_audit;
create trigger mfg_audit_guard before update or delete on public.mfg_audit for each row execute function public.crm_append_only();

-- who is acting (an active, signed-in employee whose session is valid), as everywhere in Workspace
create or replace function public.mfg_viewer() returns uuid language sql stable security definer set search_path = public as $$
  select public.crm_viewer()
$$;
revoke execute on function public.mfg_viewer() from public, anon, authenticated;

create or replace function public._mfg_can_write(p_uid uuid, p_section text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role in ('owner', 'admin') or exists (select 1 from public.section_access a where a.role = p.role and a.section = p_section and a.can_write)
    from public.profiles p where p.id = p_uid and not p.disabled), false)
$$;
revoke execute on function public._mfg_can_write(uuid, text) from public, anon, authenticated;

create or replace function public._mfg_can_read(p_uid uuid, p_section text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role in ('owner', 'admin') or exists (select 1 from public.section_access a where a.role = p.role and a.section = p_section)
    from public.profiles p where p.id = p_uid and not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending')), false)
$$;
revoke execute on function public._mfg_can_read(uuid, text) from public, anon, authenticated;

-- a capability check that answers with the reason (the functions raise it)
create or replace function public.mfg_cap_label(p_cap text) returns text language sql immutable as $$
  select case p_cap when 'bom_editor' then 'BOM Editor' when 'bom_approver' then 'BOM Approver' when 'manufacturing_admin' then 'Manufacturing Admin' when 'inventory_manager' then 'Inventory Manager'
    when 'build_manager' then 'Build Manager' when 'work_order_manager' then 'Work Order Manager' when 'quality_inspector' then 'Quality Inspector' when 'quality_approver' then 'Quality Approver'
    when 'test_operator' then 'Test Operator' when 'test_approver' then 'Test Approver' when 'engineering_change_approver' then 'Engineering Change Approver'
    when 'unit_acceptance_approver' then 'Unit Acceptance Approver' when 'shipment_release_approver' then 'Shipment Release Approver' when 'policy_approver' then 'Policy Approver'
    else initcap(replace(p_cap, '_', ' ')) end
$$;
create or replace function public._mfg_need(p_uid uuid, p_cap text, p_what text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not public.has_cap(p_uid, p_cap) then
    raise exception '% needs the % capability (an owner grants it; a System Administrator does not hold it by role)', p_what, public.mfg_cap_label(p_cap) using errcode = '42501';
  end if;
end $$;
revoke execute on function public._mfg_need(uuid, text, text) from public, anon, authenticated;

create or replace function public._mfg_audit(p_actor uuid, p_kind text, p_record uuid, p_unit uuid, p_detail jsonb) returns void language sql security definer set search_path = public as $$
  insert into public.mfg_audit(actor, kind, record_id, unit_id, detail) values (p_actor, p_kind, p_record, p_unit, coalesce(p_detail, '{}'::jsonb))
$$;
revoke execute on function public._mfg_audit(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public._mfg_date(t text) returns date language sql immutable parallel safe as $$
  select case when t ~ '^\d{4}-\d{2}-\d{2}' then left(t, 10)::date end
$$;

/* ---------------------------------------------------------------------------------------------
   6. What records cannot hold. No table is open to the API: the manufacturing functions read and write them,
      each answering only with what the viewer may open. The ledger, As-Built revisions, acceptance and shipment
      release are append-only.
   --------------------------------------------------------------------------------------------- */
-- inventory locations: facility → area → rack / bin (configurable, never a hard-coded layout)
create table if not exists public.mfg_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  name text not null check (length(name) between 1 and 120),
  kind text not null default 'Area' check (kind in ('Facility', 'Area', 'Rack', 'Bin', 'Virtual')),
  purpose text not null default 'Storage' check (purpose in ('Storage', 'Receiving', 'Inspection', 'Quarantine', 'Production', 'Finished Goods', 'Shipping', 'Other')),
  parent_id uuid references public.mfg_locations(id) on delete restrict,
  active boolean not null default true, notes text check (notes is null or length(notes) <= 1000),
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- BOM lines of one revision (a record of technical.boms). Multi-level by parent line; no depth limit.
create table if not exists public.mfg_bom_lines (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null, -- the revision record (kept with its revision even if the record goes to the recycle bin)
  line_no integer not null check (line_no between 1 and 1000000),
  parent_id uuid references public.mfg_bom_lines(id) on delete cascade,
  item_id uuid not null,
  qty numeric not null check (qty > 0 and qty < 1e9),
  uom text not null default 'ea' check (length(uom) between 1 and 20),
  position text check (position is null or length(position) <= 120),
  required boolean not null default true,
  alt_group text check (alt_group is null or alt_group ~ '^[A-Za-z0-9_-]{1,20}$'),
  notes text check (notes is null or length(notes) <= 1000),
  source_doc_id uuid, source_version_id uuid,
  unique (bom_id, line_no)
);
create index if not exists mfg_bom_lines_bom_idx on public.mfg_bom_lines(bom_id, parent_id);
create index if not exists mfg_bom_lines_item_idx on public.mfg_bom_lines(item_id);

-- approved alternates and substitutions (procurement proposes, engineering authority decides)
create table if not exists public.mfg_alternates (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null, substitute_id uuid not null check (substitute_id <> item_id),
  scope text not null default 'all' check (scope in ('all', 'configuration', 'bom', 'units')),
  config_id uuid, bom_id uuid, unit_ids uuid[] not null default '{}',
  reason text not null check (length(reason) between 5 and 1000),
  status text not null default 'Proposed' check (status in ('Proposed', 'Approved', 'Rejected', 'Expired')),
  ecr_id uuid, expires date,
  proposed_by uuid, proposed_at timestamptz not null default now(), decided_by uuid, decided_at timestamptz, decision_note text check (decision_note is null or length(decision_note) <= 1000)
);
create index if not exists mfg_alternates_item_idx on public.mfg_alternates(item_id, status);

create table if not exists public.mfg_lots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null, lot_no text not null check (length(lot_no) between 1 and 80),
  vendor_id uuid, manufacturer text, manufactured date, received date, expires date,
  qty_received numeric not null default 0 check (qty_received >= 0), receipt_id uuid, created_by uuid, created_at timestamptz not null default now(),
  unique (item_id, lot_no)
);

-- on-hand balances per item, location, lot and state; never negative (the check is the last line of defence,
-- every function checks first and answers with the reason)
create table if not exists public.mfg_stock (
  id bigserial primary key,
  item_id uuid not null, location_id uuid not null references public.mfg_locations(id) on delete restrict, lot_id uuid references public.mfg_lots(id) on delete restrict,
  state text not null check (state in ('Available', 'Allocated', 'Quarantine', 'Inspection', 'Rejected')),
  qty numeric not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (item_id, location_id, lot_id, state)
);
create index if not exists mfg_stock_item_idx on public.mfg_stock(item_id, state);
create index if not exists mfg_stock_location_idx on public.mfg_stock(location_id);

create table if not exists public.mfg_serials (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null, serial text not null check (length(serial) between 1 and 120), agron_serial text unique check (agron_serial is null or length(agron_serial) <= 60),
  vendor_id uuid, purchase_id uuid, receipt_id uuid, lot_id uuid references public.mfg_lots(id) on delete restrict,
  location_id uuid references public.mfg_locations(id) on delete restrict,
  state text not null default 'Inspection' check (state in ('Available', 'Allocated', 'Quarantine', 'Inspection', 'Rejected', 'Installed', 'Consumed', 'Returned', 'Scrap')),
  unit_id uuid, alloc_id uuid, condition text, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (item_id, serial)
);
create index if not exists mfg_serials_unit_idx on public.mfg_serials(unit_id);
create index if not exists mfg_serials_text_idx on public.mfg_serials using gin (lower(serial || ' ' || coalesce(agron_serial, '')) extensions.gin_trgm_ops);

-- allocations to a build unit, a project or a work order (the allocated quantity sits in the Allocated state)
create table if not exists public.mfg_allocs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null, qty numeric not null check (qty > 0), qty_consumed numeric not null default 0 check (qty_consumed >= 0),
  location_id uuid not null references public.mfg_locations(id) on delete restrict, lot_id uuid references public.mfg_lots(id) on delete restrict, serial_id uuid references public.mfg_serials(id) on delete restrict,
  unit_id uuid, wo_id uuid, project_id uuid,
  status text not null default 'active' check (status in ('active', 'released', 'consumed')),
  reason text check (reason is null or length(reason) <= 500),
  created_by uuid, created_at timestamptz not null default now(), closed_by uuid, closed_at timestamptz, close_reason text,
  check (qty_consumed <= qty), check (unit_id is not null or wo_id is not null or project_id is not null)
);
create index if not exists mfg_allocs_unit_idx on public.mfg_allocs(unit_id, item_id) where status = 'active';
create index if not exists mfg_allocs_item_idx on public.mfg_allocs(item_id) where status = 'active';

-- the inventory ledger: every movement, append-only; the idempotency key makes a repeated call a no-op
create table if not exists public.mfg_txns (
  id bigserial primary key, at timestamptz not null default now(),
  kind text not null check (kind in ('receive', 'inspect', 'move', 'adjust', 'allocate', 'release', 'consume', 'install', 'remove', 'scrap', 'return', 'state', 'opening')),
  item_id uuid not null, qty numeric not null check (qty >= 0),
  from_location uuid, to_location uuid, from_state text, to_state text, lot_id uuid, serial_id uuid,
  unit_id uuid, wo_id uuid, receipt_id uuid, alloc_id uuid, purchase_id uuid,
  actor uuid, reason text check (reason is null or length(reason) <= 500), idem_key text unique, detail jsonb not null default '{}'::jsonb
);
create index if not exists mfg_txns_item_idx on public.mfg_txns(item_id, at);
create index if not exists mfg_txns_unit_idx on public.mfg_txns(unit_id, at) where unit_id is not null;
create index if not exists mfg_txns_receipt_idx on public.mfg_txns(receipt_id) where receipt_id is not null;
create index if not exists mfg_txns_wo_idx on public.mfg_txns(wo_id) where wo_id is not null;

-- what is installed in a unit (serialized or significant equipment); a serial is installed in one unit at a time
create table if not exists public.mfg_installs (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null, item_id uuid not null, serial_id uuid references public.mfg_serials(id) on delete restrict, qty numeric not null default 1 check (qty > 0),
  position text check (position is null or length(position) <= 120), wo_id uuid, bom_line_id uuid,
  installed_by uuid, installed_at timestamptz not null default now(), doc_version_id uuid, config_data jsonb,
  removed_at timestamptz, removed_by uuid, removal_reason text, replaced_by uuid
);
create unique index if not exists mfg_installs_serial_active_uq on public.mfg_installs(serial_id) where serial_id is not null and removed_at is null;
create index if not exists mfg_installs_unit_idx on public.mfg_installs(unit_id) where removed_at is null;

-- software on a unit: the full history (a newer version supersedes, nothing is overwritten); never a secret
create table if not exists public.mfg_software (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null, component text not null check (length(component) between 1 and 120), version text not null check (length(version) between 1 and 80),
  installed_at timestamptz not null default now(), installer uuid, checksum text check (checksum is null or checksum ~ '^[A-Za-z0-9:+/=_-]{8,200}$'),
  config_ref text check (config_ref is null or length(config_ref) <= 300), notes text check (notes is null or length(notes) <= 1000), wo_id uuid,
  superseded_at timestamptz, superseded_by uuid
);
create index if not exists mfg_software_unit_idx on public.mfg_software(unit_id, component, installed_at);

-- measured values of a test run (structured fields from the procedure version the run used)
create table if not exists public.mfg_test_values (
  id bigserial primary key, run_id uuid not null, key text not null check (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  name text not null, type text not null check (type in ('number', 'boolean', 'text', 'choice')), unit text,
  expected text, min numeric, max numeric, actual_text text, actual_num numeric, pass boolean, rule text,
  recorded_by uuid, recorded_at timestamptz not null default now(),
  unique (run_id, key)
);

-- As-Built: one factual revision per generation, append-only
create table if not exists public.mfg_asbuilt (
  id uuid primary key default gen_random_uuid(), unit_id uuid not null, revision integer not null check (revision >= 1),
  generated_at timestamptz not null default now(), generated_by uuid, snapshot jsonb not null, hash text not null, basis_at timestamptz,
  unique (unit_id, revision)
);
create table if not exists public.mfg_acceptance (
  id uuid primary key default gen_random_uuid(), unit_id uuid not null, accepted_at timestamptz not null default now(), accepted_by uuid not null,
  status text not null check (status in ('Accepted', 'Accepted with exceptions', 'Rejected')),
  checklist jsonb not null default '[]'::jsonb, exceptions jsonb not null default '[]'::jsonb, documents jsonb not null default '[]'::jsonb,
  asbuilt_id uuid references public.mfg_asbuilt(id) on delete restrict, readiness jsonb not null default '{}'::jsonb, note text
);
create index if not exists mfg_acceptance_unit_idx on public.mfg_acceptance(unit_id, accepted_at);
create table if not exists public.mfg_releases (
  id uuid primary key default gen_random_uuid(), unit_id uuid not null, released_at timestamptz not null default now(), released_by uuid not null,
  shipment_id uuid, destination text, ship_date date, carrier text, reference text, checks jsonb not null default '{}'::jsonb, acceptance_id uuid references public.mfg_acceptance(id) on delete restrict
);
create index if not exists mfg_releases_unit_idx on public.mfg_releases(unit_id);

-- engineering change: the objects a person confirmed as affected, and the decision for each affected build
create table if not exists public.mfg_ecr_objects (
  id uuid primary key default gen_random_uuid(), ecr_id uuid not null,
  kind text not null check (kind in ('configuration', 'bom', 'item', 'document', 'test_procedure', 'unit', 'work_order', 'inventory', 'purchase')),
  object_id uuid not null, suggested boolean not null default false, confirmed_by uuid, confirmed_at timestamptz, note text,
  unique (ecr_id, kind, object_id)
);
create table if not exists public.mfg_unit_dispositions (
  id uuid primary key default gen_random_uuid(), ecr_id uuid, bom_id uuid, unit_id uuid not null,
  decision text not null check (decision in ('Incorporate', 'Keep current', 'Not applicable')),
  from_bom uuid, to_bom uuid, decided_by uuid, decided_at timestamptz not null default now(), note text check (note is null or length(note) <= 1000),
  unique (bom_id, unit_id)
);

create table if not exists public.mfg_imports (
  id uuid primary key default gen_random_uuid(), kind text not null check (kind in ('items', 'inventory', 'supplier_parts', 'bom')),
  created_by uuid, created_at timestamptz not null default now(), file_name text, rows_total int, created int, linked int, skipped int,
  status text not null default 'imported' check (status in ('imported', 'rolled_back')), rolled_back_at timestamptz, rolled_back_by uuid, report jsonb
);

do $$ declare t text; begin
  foreach t in array array['mfg_locations', 'mfg_bom_lines', 'mfg_alternates', 'mfg_lots', 'mfg_stock', 'mfg_serials', 'mfg_allocs', 'mfg_txns', 'mfg_installs', 'mfg_software',
                           'mfg_test_values', 'mfg_asbuilt', 'mfg_acceptance', 'mfg_releases', 'mfg_ecr_objects', 'mfg_unit_dispositions', 'mfg_imports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
do $$ declare t text; begin
  foreach t in array array['mfg_txns', 'mfg_asbuilt', 'mfg_acceptance', 'mfg_releases'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_guard', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.crm_append_only()', t || '_guard', t);
  end loop;
end $$;

-- record lookups the manufacturing engines make (each an index probe)
create index if not exists records_mfg_section_idx on public.records (section, status)
  where section in ('technical.products', 'technical.configurations', 'technical.items', 'technical.boms', 'technical.test_procedures', 'operations.builds', 'operations.work_orders', 'operations.quality', 'technical.testing');
create index if not exists records_build_ref_idx on public.records ((data->>'build_ref')) where data ? 'build_ref';
create index if not exists records_item_ref_idx on public.records ((data->>'item_ref')) where data ? 'item_ref';
create index if not exists records_product_ref_idx on public.records ((data->>'product_ref')) where data ? 'product_ref';
create index if not exists records_config_ref_idx on public.records ((data->>'config_ref')) where data ? 'config_ref';
create index if not exists records_wo_ref_idx on public.records ((data->>'work_order_ref')) where data ? 'work_order_ref';
create index if not exists records_bom_number_idx on public.records ((data->>'number'), (data->>'revision')) where section = 'technical.boms';
create unique index if not exists records_mfg_number_uq on public.records (section, (data->>'number'))
  where section in ('technical.items', 'operations.builds', 'operations.work_orders', 'operations.quality', 'technical.testing') and data ? 'number' and coalesce(data->>'number', '') <> '';
create unique index if not exists records_bom_revision_uq on public.records ((data->>'number'), (data->>'revision')) where section = 'technical.boms' and data ? 'number' and data ? 'revision';
create unique index if not exists records_config_version_uq on public.records (section, (data->>'code'), (data->>'version')) where section in ('technical.configurations', 'technical.test_procedures') and data ? 'code' and data ? 'version';
create unique index if not exists records_product_code_uq on public.records (upper(data->>'code')) where section = 'technical.products' and coalesce(data->>'code', '') <> '';
create index if not exists records_item_mpn_idx on public.records (lower(data->>'mpn')) where section = 'technical.items' and data ? 'mpn';
-- the text the manufacturing search reads (numbers, manufacturer part numbers, names)
create or replace function public.mfg_search_text(t text, d jsonb) returns text language sql immutable parallel safe as $$
  select lower(concat_ws(' ', t, d->>'number', d->>'mpn', d->>'manufacturer', d->>'code', d->>'description', d->>'category', d->>'revision', d->>'product_ref_title', d->>'config_ref_title', d->>'operation', d->>'tags'))
$$;
create index if not exists records_mfg_search_trgm_idx on public.records using gin (public.mfg_search_text(title, data) extensions.gin_trgm_ops)
  where section in ('technical.products', 'technical.configurations', 'technical.items', 'technical.boms', 'technical.test_procedures', 'operations.builds', 'operations.work_orders', 'operations.quality', 'technical.testing');

/* ---------------------------------------------------------------------------------------------
   7. Who may see a record — the v24 rule, plus: a restricted build unit is seen by its manufacturing owner, its
      team, the people added to it, owners and management; what follows a build (work orders, inspections, test
      runs, nonconformance issues, shipments) is seen only by people who may see that build or who are part of
      that record themselves (the person it is assigned to, its inspector or operator). US-persons-only follows
      the links (the column, set at write time from the build and the item).
   --------------------------------------------------------------------------------------------- */
create or replace function public.mfg_follow_sections() returns text[] language sql immutable as $$
  select array['operations.work_orders', 'operations.quality', 'technical.testing', 'company.issues', 'operations.logistics']
$$;

create or replace function public._mfg_unit_ok(p_uid uuid, u public.records) returns boolean language plpgsql stable security definer set search_path = public as $$
declare rl text; me text := p_uid::text;
begin
  if not coalesce((u.data->>'restricted')::boolean, false) then return true; end if;
  if u.created_by = p_uid or coalesce(u.data->>'owner_id', '') = me or coalesce(u.data->>'manufacturing_owner_id', '') = me
     or coalesce(u.data->'team_ids', '[]'::jsonb) ? me or coalesce(u.data->'access_ids', '[]'::jsonb) ? me then return true; end if;
  select role into rl from public.profiles where id = p_uid;
  return coalesce(rl in ('owner', 'management'), false);
end $$;
revoke execute on function public._mfg_unit_ok(uuid, public.records) from public, anon, authenticated;

create or replace function public._mfg_follow_ok(p_uid uuid, r public.records) returns boolean language plpgsql stable security definer set search_path = public as $$
declare u public.records; me text := p_uid::text;
begin
  if coalesce(r.data->>'build_ref', '') = '' then return true; end if;
  select * into u from public.records where id = public.as_uuid(r.data->>'build_ref') and section = 'operations.builds';
  if not found or not coalesce((u.data->>'restricted')::boolean, false) then return true; end if;
  -- the people of this record itself
  if r.created_by = p_uid or coalesce(r.data->>'owner_id', '') = me or coalesce(r.data->>'assignee_id', '') = me or coalesce(r.data->>'inspector_id', '') = me
     or coalesce(r.data->>'operator_id', '') = me or coalesce(r.data->'team_ids', '[]'::jsonb) ? me then return true; end if;
  return public._mfg_unit_ok(p_uid, u);
end $$;
revoke execute on function public._mfg_follow_ok(uuid, public.records) from public, anon, authenticated;

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
  elsif r.section = 'operations.builds' then
    return public._mfg_unit_ok(p_uid, r);
  elsif r.section in ('operations.work_orders', 'operations.quality', 'technical.testing', 'company.issues', 'operations.logistics') then
    return public._mfg_follow_ok(p_uid, r);
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
                   'sales.pipeline', 'sales.proposals', 'sales.activities', 'sales.introductions', 'company.meetings',
                   'operations.builds', 'operations.work_orders', 'operations.quality', 'technical.testing', 'company.issues', 'operations.logistics') then return coalesce(public.extra_visible(me, r), false); end if;
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
                   'sales.pipeline', 'sales.proposals', 'sales.activities', 'sales.introductions', 'company.meetings',
                   'operations.builds', 'operations.work_orders', 'operations.quality', 'technical.testing', 'company.issues', 'operations.logistics') then return coalesce(public.extra_visible(p_user, r), false); end if;
  return true;
end $$;
revoke execute on function public.record_visible_for(uuid, public.records) from public, anon, authenticated;

-- may this person see the costs of manufacturing (operational values, never accounting)?
create or replace function public._mfg_cost_ok(p_uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = any (array(select jsonb_array_elements_text(coalesce(public.mfg_cfg()->'cost_roles', '[]'::jsonb))))
      or exists (select 1 from jsonb_array_elements_text(coalesce(public.mfg_cfg()->'cost_caps', '[]'::jsonb)) c where public.has_cap(p.id, c))
    from public.profiles p where p.id = p_uid and not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending')), false)
$$;
revoke execute on function public._mfg_cost_ok(uuid) from public, anon, authenticated;

-- an item (a record of the item master) as this person may see it, or null
create or replace function public._mfg_item(p_uid uuid, p_item uuid) returns public.records language plpgsql stable security definer set search_path = public as $$
declare r public.records;
begin
  select * into r from public.records where id = p_item and section = 'technical.items';
  if not found or not public.record_visible_for(p_uid, r) then return null; end if;
  return r;
end $$;
revoke execute on function public._mfg_item(uuid, uuid) from public, anon, authenticated;

-- a build unit as this person may see it, or an error
create or replace function public._mfg_unit(p_uid uuid, p_unit uuid, p_lock boolean default false) returns public.records language plpgsql security definer set search_path = public as $$
declare r public.records;
begin
  if p_lock then select * into r from public.records where id = p_unit and section = 'operations.builds' for update;
  else select * into r from public.records where id = p_unit and section = 'operations.builds'; end if;
  if not found or p_uid is null or not public.record_visible_for(p_uid, r) then raise exception 'Build unit not found' using errcode = 'P0002'; end if;
  return r;
end $$;
revoke execute on function public._mfg_unit(uuid, uuid, boolean) from public, anon, authenticated;

-- one record of a section as this person may see it, or an error
create or replace function public._mfg_rec(p_uid uuid, p_id uuid, p_section text, p_what text, p_lock boolean default false) returns public.records language plpgsql security definer set search_path = public as $$
declare r public.records;
begin
  if p_lock then select * into r from public.records where id = p_id and section = p_section for update;
  else select * into r from public.records where id = p_id and section = p_section; end if;
  if not found or p_uid is null or not public.record_visible_for(p_uid, r) then raise exception '% not found', p_what using errcode = 'P0002'; end if;
  return r;
end $$;
revoke execute on function public._mfg_rec(uuid, uuid, text, text, boolean) from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   8. Record rules for the manufacturing sections: numbers, US-persons-only links, approved = immutable,
      build lifecycle prerequisites, results that stay as recorded, the audit
   --------------------------------------------------------------------------------------------- */
create or replace function public.mfg_sections() returns text[] language sql immutable as $$
  select array['technical.products', 'technical.configurations', 'technical.items', 'technical.boms', 'technical.test_procedures', 'operations.builds', 'operations.work_orders',
               'operations.quality', 'technical.testing', 'company.issues', 'operations.logistics']
$$;

-- a status of the configured build lifecycle (null when the name is not one)
create or replace function public._mfg_status(p_status text) returns jsonb language sql stable security definer set search_path = public as $$
  select s from jsonb_array_elements(coalesce(public.mfg_cfg()->'build_statuses', '[]'::jsonb)) s where s->>'status' = p_status limit 1
$$;
revoke execute on function public._mfg_status(text) from public, anon, authenticated;
create or replace function public.mfg_status_kind(p_status text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(public._mfg_status(p_status)->>'kind', 'open')
$$;
revoke execute on function public.mfg_status_kind(text) from public, anon;
grant execute on function public.mfg_status_kind(text) to authenticated;

-- the unit counts as completed (no automatic retrofit, no change to its pinned configuration)
create or replace function public._mfg_unit_done(u public.records) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mfg_status_kind(u.status) in ('done', 'cancelled'), false) or exists (select 1 from public.mfg_acceptance a where a.unit_id = u.id and a.status <> 'Rejected')
$$;
revoke execute on function public._mfg_unit_done(public.records) from public, anon, authenticated;

-- a build unit may enter a status: the configured prerequisites, or an authorized exception with a reason.
-- Acceptance and shipment release are records made with their capability: no exception replaces them.
create or replace function public._mfg_status_check(p_op text, o public.records, n public.records, p_actor uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare st jsonb := public._mfg_status(n.status); k text; miss text[] := '{}'; hard text[] := '{}'; exc text; rd jsonb;
begin
  if n.status is null then return null; end if;
  if st is null then return 'Unknown build status «' || n.status || '» — choose one of the build lifecycle (Manufacturing → Settings)'; end if;
  if p_op = 'UPDATE' and n.status is not distinct from o.status then return null; end if;
  if coalesce((st->>'requires_reason')::boolean, false) then
    if length(trim(coalesce(n.data->>'status_reason', ''))) < 5 or (p_op = 'UPDATE' and trim(coalesce(n.data->>'status_reason', '')) is not distinct from trim(coalesce(o.data->>'status_reason', ''))) then
      return 'Give the reason for «' || n.status || '» (at least 5 characters) in «Reason for the status»';
    end if;
  end if;
  for k in select jsonb_array_elements_text(coalesce(st->'requires', '[]'::jsonb)) loop
    if k = 'released' and coalesce(n.data->>'released_at', '') = '' then miss := array_append(miss, 'the release (configuration and BOM revision pinned)'::text);
    elsif k = 'build_ready' then
      rd := public._mfg_build_readiness(n);
      if rd->>'status' <> 'Ready' then miss := array_append(miss, ('build readiness: ' || coalesce((select string_agg(x->>'text', '; ') from jsonb_array_elements(rd->'reasons') x where x->>'level' = 'block'), rd->>'status'))::text); end if;
    elsif k = 'accepted' and not exists (select 1 from public.mfg_acceptance a where a.unit_id = n.id and a.status in ('Accepted', 'Accepted with exceptions')) then
      hard := array_append(hard, 'the unit acceptance (recorded by a Unit Acceptance Approver)'::text);
    elsif k = 'shipment_released' and not exists (select 1 from public.mfg_releases x where x.unit_id = n.id) then
      hard := array_append(hard, 'the shipment release (recorded by a Shipment Release Approver)'::text);
    end if;
  end loop;
  if cardinality(hard) > 0 then return 'To move to «' || n.status || '», Workspace needs ' || array_to_string(hard, ' and ') || ' — no exception replaces it'; end if;
  if cardinality(miss) = 0 then return null; end if;
  exc := trim(coalesce(n.data->>'status_exception', ''));
  if length(exc) >= 10 and (p_op = 'INSERT' or exc is distinct from trim(coalesce(o.data->>'status_exception', ''))) then
    if public.has_cap(p_actor, 'build_manager') then return null; end if;
    return 'Only a Build Manager may make an exception to the build prerequisites';
  end if;
  return 'To move to «' || n.status || '», first: ' || array_to_string(miss, '; ') || ' — or a Build Manager gives the reason for an exception (at least 10 characters)';
end $$;
revoke execute on function public._mfg_status_check(text, public.records, public.records, uuid) from public, anon;
grant execute on function public._mfg_status_check(text, public.records, public.records, uuid) to authenticated;

-- is a definition record (configuration, BOM revision, test procedure) locked: approved, superseded, retired or in approval?
create or replace function public._mfg_locked(r public.records) returns text language sql stable security definer set search_path = public as $$
  select case when coalesce(r.status, 'Draft') in ('Approved', 'Superseded', 'Retired') then r.status
              when exists (select 1 from public.wf_instances i where i.record_id = r.id and i.status in ('active', 'waiting', 'blocked', 'draft')) then 'in approval' end
$$;
revoke execute on function public._mfg_locked(public.records) from public, anon;
grant execute on function public._mfg_locked(public.records) to authenticated;

-- what a signed-in person may not enter or change by hand (Workspace sets it); invoker on purpose, like v23/v24:
-- inside the manufacturing functions (definer) the current user is the owner and these checks do not apply
create or replace function public.records_mfg_guard() returns trigger language plpgsql set search_path = public as $$
declare prot text[]; k text; e text; lk text; kind text;
begin
  if current_user <> 'authenticated' then return new; end if;
  if not (new.section = any (public.mfg_sections())) then return new; end if;
  prot := case new.section
    when 'technical.items' then array['number', 'import_batch']
    when 'technical.products' then array['current_config_ref']
    when 'technical.configurations' then array['approved_at', 'approved_by', 'supersedes_ref', 'superseded_by']
    when 'technical.boms' then array['number', 'revision', 'lines_hash', 'line_count', 'approved_at', 'approved_by', 'supersedes_ref', 'superseded_by', 'effectivity', 'ecr_ref', 'import_batch']
    when 'technical.test_procedures' then array['approved_at', 'approved_by', 'supersedes_ref', 'superseded_by']
    when 'operations.builds' then array['number', 'unit_seq', 'released_at', 'released_by', 'accepted_at', 'acceptance_ref', 'released_shipment_at', 'asbuilt_revision', 'pin_history']
    when 'operations.work_orders' then array['number', 'started_at', 'started_by', 'started_by_id', 'completed_at', 'completed_by', 'completed_by_id', 'result', 'consumed', 'installed', 'checklist_result', 'doc_version_id', 'rework_of', 'reinspection_ref']
    when 'operations.quality' then array['number', 'recorded_at', 'recorded_by_id', 'issue_ref', 'reinspection_of']
    when 'technical.testing' then array['number', 'procedure_version', 'recorded_at', 'recorded_by_id', 'approved_at', 'approved_by_id', 'issue_ref', 'deterministic']
    when 'company.issues' then array['disposition', 'disposition_by_id', 'disposition_at', 'use_as_is_approved_by', 'rework_ref']
    else array[]::text[] end;
  if tg_op = 'INSERT' then
    -- copied records arrive with these: they are given again by Workspace
    new.data := coalesce(new.data, '{}'::jsonb) - prot;
    if new.section in ('technical.configurations', 'technical.boms', 'technical.test_procedures') and coalesce(new.status, 'Draft') <> 'Draft' then
      raise exception 'A new % starts as Draft; it becomes Approved only through its approval', case new.section when 'technical.boms' then 'BOM revision' when 'technical.configurations' then 'configuration' else 'test procedure' end using errcode = '42501';
    end if;
    if new.section = 'operations.work_orders' and coalesce(new.status, 'Planned') in ('In Progress', 'Completed') then raise exception 'A work order is started and completed with «Start» and «Complete»' using errcode = '42501'; end if;
    if new.section = 'operations.quality' and new.data ? 'inspection_kind' and coalesce(new.data->>'result', '') <> '' then raise exception 'An inspection result is recorded with «Record result»' using errcode = '42501'; end if;
    if new.section = 'technical.testing' and new.data ? 'procedure_ref' and coalesce(new.data->>'outcome', '') <> '' then raise exception 'A test result is recorded with «Record test»' using errcode = '42501'; end if;
  else
    foreach k in array prot loop
      if (old.data->k) is distinct from (new.data->k) then raise exception 'The field % is set by Workspace, not edited by hand', k using errcode = '42501'; end if;
    end loop;
    -- approved definitions never change: a new revision (or an engineering change) is made instead
    if new.section in ('technical.configurations', 'technical.boms', 'technical.test_procedures') then
      lk := public._mfg_locked(old);
      kind := case new.section when 'technical.boms' then 'BOM revision' when 'technical.configurations' then 'configuration' else 'test procedure' end;
      if lk is not null and (new.data is distinct from old.data or new.title is distinct from old.title or new.controlled is distinct from old.controlled) then
        raise exception 'This % is % and cannot be edited: create a new revision (or raise an engineering change)', kind, lk using errcode = '42501';
      end if;
      if new.status is distinct from old.status then
        raise exception 'The status of a % changes through «Submit for approval», «New revision» or «Retire»', kind using errcode = '42501';
      end if;
    end if;
    if new.section = 'operations.builds' and coalesce(old.data->>'released_at', '') <> '' then
      foreach k in array array['product_ref', 'config_ref', 'bom_ref'] loop
        if (old.data->k) is distinct from (new.data->k) then raise exception 'This unit is released: its product, configuration and BOM revision are pinned (an approved engineering change re-pins it with a recorded decision)' using errcode = '42501'; end if;
      end loop;
    end if;
    if new.section = 'operations.work_orders' and new.status is distinct from old.status then
      if new.status in ('In Progress', 'Completed') then raise exception 'A work order is started and completed with «Start» and «Complete»' using errcode = '42501'; end if;
      if old.status = 'Completed' then raise exception 'A completed work order stays completed: open a rework work order instead' using errcode = '42501'; end if;
      if new.status = 'Cancelled' and length(trim(coalesce(new.data->>'status_reason', ''))) < 5 then raise exception 'Give the reason for cancelling (at least 5 characters)' using errcode = '23514'; end if;
    end if;
    if new.section = 'operations.work_orders' and old.status = 'Completed' and new.data is distinct from old.data then
      raise exception 'A completed work order is a record of what was done: it is not edited' using errcode = '42501';
    end if;
    if new.section = 'operations.quality' and old.data ? 'inspection_kind' then
      foreach k in array array['result', 'inspection_kind', 'build_ref', 'work_order_ref', 'item_ref', 'serial', 'lot', 'checklist_result', 'inspector_id'] loop
        if coalesce(old.data->>'recorded_at', '') <> '' and (old.data->k) is distinct from (new.data->k) then raise exception 'A recorded inspection stays as recorded (%): a reinspection is a new record', k using errcode = '42501'; end if;
      end loop;
      if coalesce(old.data->>'recorded_at', '') = '' and (old.data->'result') is distinct from (new.data->'result') then raise exception 'An inspection result is recorded with «Record result»' using errcode = '42501'; end if;
    end if;
    if new.section = 'technical.testing' and old.data ? 'procedure_ref' then
      foreach k in array array['outcome', 'procedure_ref', 'build_ref', 'operator_id', 'environment', 'measured'] loop
        if coalesce(old.data->>'recorded_at', '') <> '' and (old.data->k) is distinct from (new.data->k) then raise exception 'A recorded test run stays as recorded (%): a retest is a new run', k using errcode = '42501'; end if;
      end loop;
      if coalesce(old.data->>'recorded_at', '') = '' and (old.data->'outcome') is distinct from (new.data->'outcome') then raise exception 'A test result is recorded with «Record test»' using errcode = '42501'; end if;
      if coalesce(old.data->>'recorded_at', '') <> '' and new.status is distinct from old.status then raise exception 'The status of a recorded test run follows its result' using errcode = '42501'; end if;
    end if;
  end if;
  if new.section = 'operations.builds' then
    e := public._mfg_status_check(tg_op, old, new, auth.uid());
    if e is not null then raise exception '%', e using errcode = '23514'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.records_mfg_guard() from public, anon;

-- the record rules Workspace applies to every write (definer: numbers, links, US-persons-only, approvals)
create or replace function public.records_mfg_before() returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb; ref public.records; t text; nn text; code text; pre text; fmt int; legacy jsonb; mapped text; cnt int; v int;
begin
  if not (new.section = any (public.mfg_sections())) then return new; end if;
  d := coalesce(new.data, '{}'::jsonb);
  if tg_op = 'INSERT' then
    -- numbers from the atomic, configurable numbering
    if new.section in ('technical.items', 'operations.work_orders', 'operations.quality', 'technical.testing') and coalesce(d->>'number', '') = '' then
      nn := public.ops_number(new.section, public.as_uuid(d->>'project_ref'));
      if nn is not null then d := d || jsonb_build_object('number', nn); end if;
    elsif new.section = 'technical.boms' and coalesce(d->>'number', '') = '' then
      nn := public.ops_number('technical.boms', null);
      d := d || jsonb_build_object('number', nn, 'revision', 'A');
    elsif new.section in ('technical.configurations', 'technical.test_procedures') then
      -- the code of a configuration or procedure (shared by its versions) from its own numbering format
      if coalesce(d->>'code', '') = '' then d := d || jsonb_build_object('code', public.allocate_doc_number('ops', case when new.section = 'technical.configurations' then 'CFG' else 'TP' end, null, null)); end if;
      if coalesce(d->>'version', '') = '' then d := d || jsonb_build_object('version', 1); end if;
    elsif new.section = 'operations.builds' and coalesce(d->>'number', '') = '' and coalesce(d->>'product_ref', '') <> '' then
      select * into ref from public.records where id = public.as_uuid(d->>'product_ref') and section = 'technical.products';
      if found then
        code := upper(regexp_replace(coalesce(nullif(ref.data->>'unit_code', ''), ref.data->>'code', 'BLD'), '[^A-Za-z0-9]', '', 'g'));
        code := left(coalesce(nullif(code, ''), 'BLD'), 10);
        -- each product numbers its units in its own sequence (format configurable; created once per unit code)
        insert into public.doc_number_formats(scope, doc_type, pattern, company)
          select 'ops', 'UNIT-' || code, '{CO}-' || code || '-{SEQ:4}', 'AGR' where not exists (select 1 from public.doc_number_formats f where f.scope = 'ops' and f.doc_type = 'UNIT-' || code);
        nn := public.allocate_doc_number('ops', 'UNIT-' || code, null, null);
        d := d || jsonb_build_object('number', nn, 'unit_seq', nullif(substring(nn from '(\d+)$'), '')::int, 'product_ref_title', coalesce(ref.data->>'code', ref.title));
      end if;
    end if;
  end if;
  -- US-persons-only follows the build and the item the record belongs to (set at write time, never cleared by a link)
  if new.section in ('operations.work_orders', 'operations.quality', 'technical.testing', 'company.issues', 'operations.logistics') and coalesce(d->>'build_ref', '') <> '' then
    select * into ref from public.records where id = public.as_uuid(d->>'build_ref') and section = 'operations.builds';
    if found and ref.controlled then new.controlled := true; end if;
  end if;
  if new.section in ('operations.quality', 'technical.testing', 'company.issues', 'operations.work_orders') and coalesce(d->>'item_ref', '') <> '' then
    select * into ref from public.records where id = public.as_uuid(d->>'item_ref') and section = 'technical.items';
    if found and ref.controlled then new.controlled := true; end if;
  end if;
  if new.section in ('technical.boms', 'operations.builds') and coalesce(d->>'config_ref', '') <> '' then
    select * into ref from public.records where id = public.as_uuid(d->>'config_ref') and section = 'technical.configurations';
    if found and ref.controlled then new.controlled := true; end if;
  end if;
  if new.section = 'technical.items' and coalesce(d->>'classification', '') = 'US Persons Only' then new.controlled := true; end if;
  -- approval outcomes (the engine sets the status): who and when, and the earlier revision is superseded
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'Approved' and new.section in ('technical.configurations', 'technical.boms', 'technical.test_procedures') then
    d := d || jsonb_build_object('approved_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  end if;
  new.data := d;
  return new;
end $$;
revoke execute on function public.records_mfg_before() from public, anon, authenticated;

create or replace function public.records_mfg_after() returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); eff text; prod public.records;
begin
  if not (new.section = any (public.mfg_sections())) then return null; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.section = 'technical.boms' and new.status = 'Approved' then
      eff := coalesce(new.data->'effectivity'->>'kind', 'all_future');
      -- an earlier approved revision of this BOM is superseded unless the change applies only to listed units
      if eff <> 'units' then
        perform public._mfg_sys_patch(r.id, 'Superseded', jsonb_build_object('superseded_by', new.id))
          from public.records r where r.section = 'technical.boms' and r.data->>'number' = new.data->>'number' and r.id <> new.id and r.status = 'Approved';
      end if;
      perform public._mfg_audit(me, 'bom_approved', new.id, null, jsonb_build_object('number', new.data->>'number', 'revision', new.data->>'revision', 'lines_hash', new.data->>'lines_hash', 'effectivity', new.data->'effectivity'));
    elsif new.section = 'technical.configurations' and new.status = 'Approved' then
      perform public._mfg_sys_patch(r.id, 'Superseded', jsonb_build_object('superseded_by', new.id))
        from public.records r where r.section = 'technical.configurations' and r.data->>'code' = new.data->>'code' and r.id <> new.id and r.status = 'Approved';
      select * into prod from public.records where id = public.as_uuid(new.data->>'product_ref') and section = 'technical.products';
      if found and (coalesce(prod.data->>'current_config_ref', '') = '' or exists (select 1 from public.records c where c.id = public.as_uuid(prod.data->>'current_config_ref') and c.data->>'code' = new.data->>'code')) then
        perform public._mfg_sys_patch(prod.id, null, jsonb_build_object('current_config_ref', new.id, 'current_config_ref_title', new.title));
      end if;
      perform public._mfg_audit(me, 'configuration_approved', new.id, null, jsonb_build_object('code', new.data->>'code', 'version', new.data->>'version'));
    elsif new.section = 'technical.test_procedures' and new.status = 'Approved' then
      perform public._mfg_sys_patch(r.id, 'Superseded', jsonb_build_object('superseded_by', new.id))
        from public.records r where r.section = 'technical.test_procedures' and r.data->>'code' = new.data->>'code' and r.id <> new.id and r.status = 'Approved';
      perform public._mfg_audit(me, 'test_procedure_approved', new.id, null, jsonb_build_object('code', new.data->>'code', 'version', new.data->>'version'));
    elsif new.section = 'operations.builds' then
      perform public._mfg_audit(me, 'build_status', new.id, new.id, jsonb_strip_nulls(jsonb_build_object('from', old.status, 'to', new.status, 'exception', nullif(new.data->>'status_exception', ''), 'reason', nullif(new.data->>'status_reason', ''))));
    elsif new.section = 'operations.work_orders' then
      perform public._mfg_audit(me, 'work_order_status', new.id, public.as_uuid(new.data->>'build_ref'), jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  -- a work order given to someone tells them once
  if new.section = 'operations.work_orders' and coalesce(new.data->>'assignee_id', '') <> '' and (tg_op = 'INSERT' or new.data->>'assignee_id' is distinct from old.data->>'assignee_id')
     and new.data->>'assignee_id' <> coalesce(me::text, '') and public.as_uuid(new.data->>'assignee_id') is not null then
    begin
      perform public.notify_user(public.as_uuid(new.data->>'assignee_id'), 'mfg_work_assigned', new.id, 'mfg_wo_assigned:' || new.id || ':' || (new.data->>'assignee_id'),
        'Work order assigned: ' || coalesce(new.data->>'number', '') || ' ' || new.title, coalesce(new.data->>'build_ref_title', ''), me, '/build?wo=' || new.id);
    exception when others then null; end;
  end if;
  return null;
end $$;
revoke execute on function public.records_mfg_after() from public, anon, authenticated;


-- the earlier container-build statuses arrive as the lifecycle names (automations, old screens); runs first
create or replace function public.records_mfg_map() returns trigger language plpgsql security definer set search_path = public as $$
declare mapped text;
begin
  if new.section = 'operations.builds' and new.status is not null and public._mfg_status(new.status) is null then
    mapped := public.mfg_cfg()->'legacy_status_map'->>new.status;
    if mapped is not null then new.status := mapped; end if;
  end if;
  return new;
end $$;
revoke execute on function public.records_mfg_map() from public, anon, authenticated;

-- Workspace's own change to a record (status and fields): runs as the definer, so the user-facing guard does not
-- apply; every change is still kept by the record history trigger
create or replace function public._mfg_sys_patch(p_id uuid, p_status text, p_patch jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.records set status = coalesce(p_status, status), data = coalesce(data, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb), updated_at = now() where id = p_id;
end $$;
revoke execute on function public._mfg_sys_patch(uuid, text, jsonb) from public, anon, authenticated;

drop trigger if exists records_bmfg_0_map on public.records;
create trigger records_bmfg_0_map before insert or update on public.records for each row execute function public.records_mfg_map();
drop trigger if exists records_bmfg_a_guard on public.records;
create trigger records_bmfg_a_guard before insert or update on public.records for each row execute function public.records_mfg_guard();
drop trigger if exists records_bmfg_before on public.records;
create trigger records_bmfg_before before insert or update on public.records for each row execute function public.records_mfg_before();
drop trigger if exists records_mfg_after on public.records;
create trigger records_mfg_after after insert or update on public.records for each row execute function public.records_mfg_after();

/* ---------------------------------------------------------------------------------------------
   9. Definitions: BOM revisions and their lines, configurations, test procedures — Draft → approval of the exact
      content → Approved (immutable) → a new revision; alternates proposed by anyone, decided by engineering authority
   --------------------------------------------------------------------------------------------- */
-- the hash an approval is bound to: every line exactly as it is (order, parent, item, quantity, unit, position,
-- required, alternate group)
create or replace function public._mfg_lines_hash(p_bom uuid) returns text language sql stable security definer set search_path = public as $$
  select md5(coalesce(string_agg(concat_ws('|', l.line_no, p.line_no, l.item_id, trim_scale(l.qty), l.uom, l.position, l.required, l.alt_group), E'\n' order by l.line_no), ''))
  from public.mfg_bom_lines l left join public.mfg_bom_lines p on p.id = l.parent_id where l.bom_id = p_bom
$$;
revoke execute on function public._mfg_lines_hash(uuid) from public, anon, authenticated;

create or replace function public._mfg_next_revision(p_rev text) returns text language sql immutable as $$
  -- A … Z, then AA, AB … (deterministic, no gaps)
  select case when p_rev is null or p_rev = '' then 'A'
              when p_rev ~ '^[A-Y]$' then chr(ascii(p_rev) + 1)
              when p_rev = 'Z' then 'AA'
              when p_rev ~ '^[A-Z]+$' and right(p_rev, 1) <> 'Z' then left(p_rev, -1) || chr(ascii(right(p_rev, 1)) + 1)
              else p_rev || 'A' end
$$;

-- a BOM revision for a configuration (Draft, revision A of a new BOM number)
create or replace function public.mfg_bom_create(p_config uuid, p_title text default null, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); c public.records; r public.records;
begin
  perform public._mfg_need(me, 'bom_editor', 'Creating a BOM');
  c := public._mfg_rec(me, p_config, 'technical.configurations', 'Configuration');
  if not public._mfg_can_write(me, 'technical.boms') then raise exception 'You cannot write BOMs' using errcode = '42501'; end if;
  insert into public.records(section, title, status, controlled, created_by, data)
  values ('technical.boms', left(coalesce(nullif(trim(p_title), ''), 'BOM — ' || c.title), 300), 'Draft', c.controlled, me,
    jsonb_strip_nulls(jsonb_build_object('config_ref', c.id, 'config_ref_title', c.title, 'config_code', c.data->>'code', 'product_ref', c.data->>'product_ref', 'product_ref_title', c.data->>'product_ref_title',
      'owner_id', me, 'owner', public._wf_name(me), 'change_reason', 'First revision', 'notes', left(p_notes, 2000), 'line_count', 0, 'lines_hash', public._mfg_lines_hash(null))))
  returning * into r;
  perform public._mfg_audit(me, 'bom_created', r.id, null, jsonb_build_object('number', r.data->>'number', 'revision', r.data->>'revision'));
  return jsonb_build_object('id', r.id, 'number', r.data->>'number', 'revision', r.data->>'revision');
end $$;
revoke execute on function public.mfg_bom_create(uuid, text, text) from public, anon;
grant execute on function public.mfg_bom_create(uuid, text, text) to authenticated;

-- the lines of a Draft revision (all of them, in order): multi-level by parent key, no depth limit, no cycles
create or replace function public.mfg_bom_lines_save(p_bom uuid, p_lines jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); b public.records; x jsonb; k int := 0; keys jsonb := '{}'::jsonb; pid uuid; it public.records; nid uuid; lk text;
  anc uuid; path uuid[]; h text; q numeric;
begin
  perform public._mfg_need(me, 'bom_editor', 'Editing BOM lines');
  b := public._mfg_rec(me, p_bom, 'technical.boms', 'BOM revision', true);
  lk := public._mfg_locked(b);
  if lk is not null or coalesce(b.status, 'Draft') <> 'Draft' then raise exception 'This BOM revision is % — its lines cannot change: create a new revision', coalesce(lk, b.status) using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Lines must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_lines) > 20000 then raise exception 'A BOM revision holds at most 20,000 lines' using errcode = '22023'; end if;
  delete from public.mfg_bom_lines where bom_id = b.id;
  for x in select * from jsonb_array_elements(p_lines) loop
    k := k + 1;
    if coalesce(x->>'key', '') = '' then x := x || jsonb_build_object('key', k::text); end if;
    if keys ? (x->>'key') then raise exception 'Line %: the key % is used twice', k, x->>'key' using errcode = '22023'; end if;
    select * into it from public.records where id = public.as_uuid(x->>'item') and section = 'technical.items';
    if not found or not public.record_visible_for(me, it) then raise exception 'Line %: item not found in the item master', k using errcode = '22023'; end if;
    if coalesce(it.status, 'Active') in ('Obsolete', 'Retired') then raise exception 'Line %: item % is %', k, it.data->>'number', it.status using errcode = '22023'; end if;
    q := public._num(x->'qty');
    if q is null or q <= 0 then raise exception 'Line %: quantity must be above zero', k using errcode = '22023'; end if;
    pid := null;
    if coalesce(x->>'parent', '') <> '' then
      if not keys ? (x->>'parent') then raise exception 'Line %: its parent line must come before it', k using errcode = '22023'; end if;
      pid := (keys->>(x->>'parent'))::uuid;
      -- no item may contain itself (directly or through its assemblies)
      anc := pid; path := '{}';
      while anc is not null loop
        select item_id, parent_id into nid, anc from (select l.item_id, l.parent_id from public.mfg_bom_lines l where l.id = anc) z;
        path := path || nid;
      end loop;
      if it.id = any (path) then raise exception 'Line %: item % would contain itself', k, it.data->>'number' using errcode = '22023'; end if;
    end if;
    insert into public.mfg_bom_lines(bom_id, line_no, parent_id, item_id, qty, uom, position, required, alt_group, notes, source_doc_id, source_version_id)
    values (b.id, k, pid, it.id, q, coalesce(nullif(x->>'uom', ''), it.data->>'uom', 'ea'), nullif(left(x->>'position', 120), ''), coalesce((x->>'required')::boolean, true),
      nullif(x->>'alt_group', ''), nullif(left(x->>'notes', 1000), ''), public.as_uuid(x->>'source_doc'), public.as_uuid(x->>'source_version'))
    returning id into nid;
    keys := keys || jsonb_build_object(x->>'key', nid);
  end loop;
  h := public._mfg_lines_hash(b.id);
  perform public._mfg_sys_patch(b.id, null, jsonb_build_object('lines_hash', h, 'line_count', k));
  perform public._mfg_audit(me, 'bom_lines_saved', b.id, null, jsonb_build_object('lines', k, 'hash', h));
  return jsonb_build_object('ok', true, 'lines', k, 'lines_hash', h);
end $$;
revoke execute on function public.mfg_bom_lines_save(uuid, jsonb) from public, anon;
grant execute on function public.mfg_bom_lines_save(uuid, jsonb) to authenticated;

-- a BOM revision as a tree with each line's level, item and the quantity per unit through its assemblies
create or replace function public.mfg_bom_get(p_bom uuid) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); b public.records;
begin
  b := public._mfg_rec(me, p_bom, 'technical.boms', 'BOM revision');
  return jsonb_build_object('id', b.id, 'number', b.data->>'number', 'revision', b.data->>'revision', 'status', b.status, 'title', b.title,
    'config_ref', b.data->>'config_ref', 'config', b.data->>'config_ref_title', 'product', b.data->>'product_ref_title', 'lines_hash', b.data->>'lines_hash',
    'effectivity', b.data->'effectivity', 'ecr_ref', b.data->>'ecr_ref', 'change_reason', b.data->>'change_reason', 'approved_at', b.data->>'approved_at', 'locked', public._mfg_locked(b),
    'can_edit', public._mfg_locked(b) is null and coalesce(b.status, 'Draft') = 'Draft' and public.has_cap(me, 'bom_editor'),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'revision', r.data->>'revision', 'status', r.status, 'approved_at', r.data->>'approved_at') order by r.created_at)
       from public.records r where r.section = 'technical.boms' and r.data->>'number' = b.data->>'number' and public.record_visible_for(me, r)), '[]'::jsonb),
    'lines', coalesce((
      with recursive t as (
        select l.id, l.line_no, l.parent_id, l.item_id, l.qty, l.uom, l.position, l.required, l.alt_group, l.notes, 1 as level, l.qty as ext_qty, array[l.line_no] as sort
        from public.mfg_bom_lines l where l.bom_id = b.id and l.parent_id is null
        union all
        select l.id, l.line_no, l.parent_id, l.item_id, l.qty, l.uom, l.position, l.required, l.alt_group, l.notes, t.level + 1, t.ext_qty * l.qty, t.sort || l.line_no
        from public.mfg_bom_lines l join t on l.parent_id = t.id)
      select jsonb_agg(jsonb_build_object('id', t.id, 'line', t.line_no, 'parent', t.parent_id, 'level', t.level, 'qty', t.qty, 'ext_qty', t.ext_qty, 'uom', t.uom, 'position', t.position,
          'required', t.required, 'alt_group', t.alt_group, 'notes', t.notes,
          'has_children', exists (select 1 from public.mfg_bom_lines c where c.parent_id = t.id),
          'item', case when i.id is not null and public.record_visible_for(me, i) then jsonb_build_object('id', i.id, 'number', i.data->>'number', 'title', i.title, 'type', i.data->>'item_type',
                  'mpn', i.data->>'mpn', 'manufacturer', i.data->>'manufacturer', 'serialized', coalesce((i.data->>'serialized')::boolean, false), 'status', i.status)
                  else jsonb_build_object('hidden', true, 'title', 'An item you may not open') end) order by t.sort)
      from t left join public.records i on i.id = t.item_id), '[]'::jsonb));
end $$;
revoke execute on function public.mfg_bom_get(uuid) from public, anon;
grant execute on function public.mfg_bom_get(uuid) to authenticated;

-- effectivity of a revision made under an engineering change (all future units, from a unit number, listed units,
-- immediately for every unit not yet completed, or inventory only). Set while Draft; part of what is approved.
create or replace function public.mfg_bom_effectivity(p_bom uuid, p_eff jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); b public.records; k text := p_eff->>'kind'; e jsonb; u public.records; x text;
begin
  perform public._mfg_need(me, 'bom_editor', 'Setting the effectivity of a BOM revision');
  b := public._mfg_rec(me, p_bom, 'technical.boms', 'BOM revision', true);
  if public._mfg_locked(b) is not null or b.status <> 'Draft' then raise exception 'The effectivity is set while the revision is Draft' using errcode = '42501'; end if;
  if k not in ('all_future', 'after_unit', 'units', 'immediate', 'inventory_only') then raise exception 'Effectivity is one of: all future units, from a unit number, listed units, immediately, inventory only' using errcode = '22023'; end if;
  e := jsonb_build_object('kind', k);
  if k = 'after_unit' then
    if public._num(p_eff->'from_seq') is null and coalesce(p_eff->>'from_unit', '') = '' then raise exception 'Give the first unit (its number) the change applies from' using errcode = '22023'; end if;
    e := e || jsonb_build_object('from_seq', coalesce(public._num(p_eff->'from_seq')::int, nullif(substring(p_eff->>'from_unit' from '(\d+)$'), '')::int), 'from_unit', p_eff->>'from_unit');
  elsif k = 'units' then
    if jsonb_typeof(p_eff->'units') <> 'array' or jsonb_array_length(p_eff->'units') = 0 then raise exception 'List the units the change applies to' using errcode = '22023'; end if;
    for x in select jsonb_array_elements_text(p_eff->'units') loop
      u := public._mfg_unit(me, public.as_uuid(x));
    end loop;
    e := e || jsonb_build_object('units', p_eff->'units');
  end if;
  perform public._mfg_sys_patch(b.id, null, jsonb_build_object('effectivity', e));
  perform public._mfg_audit(me, 'ecr_effectivity', b.id, null, e);
  return jsonb_build_object('ok', true, 'effectivity', e);
end $$;
revoke execute on function public.mfg_bom_effectivity(uuid, jsonb) from public, anon;
grant execute on function public.mfg_bom_effectivity(uuid, jsonb) to authenticated;

-- submit a definition for the approval of its exact content (BOM revision, configuration, test procedure)
create or replace function public.mfg_def_submit(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records; inst uuid; code text; cap text;
begin
  select * into r from public.records where id = p_id and section in ('technical.boms', 'technical.configurations', 'technical.test_procedures') for update;
  if me is null or not found or not public.record_visible_for(me, r) then raise exception 'Not found' using errcode = 'P0002'; end if;
  code := case r.section when 'technical.boms' then 'BOM' when 'technical.configurations' then 'CONFIG' else 'TESTPROC' end;
  cap := case r.section when 'technical.test_procedures' then 'test_approver' else 'bom_editor' end;
  if not public.has_cap(me, cap) and not public.has_cap(me, 'bom_editor') then perform public._mfg_need(me, cap, 'Submitting for approval'); end if;
  if public._mfg_locked(r) is not null or r.status <> 'Draft' then raise exception 'Only a Draft goes for approval (this one is %)', coalesce(public._mfg_locked(r), r.status) using errcode = '55000'; end if;
  if r.section = 'technical.boms' then
    if coalesce(public._num(r.data->'line_count'), 0) = 0 then raise exception 'Add the lines first' using errcode = '23514'; end if;
    if r.data->>'lines_hash' is distinct from public._mfg_lines_hash(r.id) then raise exception 'The lines changed: save them again' using errcode = '23514'; end if;
  elsif r.section = 'technical.configurations' then
    if coalesce(r.data->>'product_ref', '') = '' then raise exception 'Link the configuration to its product first' using errcode = '23514'; end if;
  elsif r.section = 'technical.test_procedures' then
    if jsonb_typeof(r.data->'fields') <> 'array' or jsonb_array_length(r.data->'fields') = 0 then raise exception 'Define the fields the test records first' using errcode = '23514'; end if;
  end if;
  inst := public.wf_start(code, p_id, null);
  perform public._mfg_audit(me, 'submitted', r.id, null, jsonb_build_object('code', code));
  return jsonb_build_object('ok', true, 'instance', inst, 'status', (select status from public.records where id = p_id));
end $$;
revoke execute on function public.mfg_def_submit(uuid) from public, anon;
grant execute on function public.mfg_def_submit(uuid) to authenticated;

-- a new revision / version: a Draft copy of an approved (or superseded) definition, with the reason and the ECR;
-- the earlier one stays exactly as it was until the new one is approved
create or replace function public.mfg_def_new_version(p_id uuid, p_reason text, p_ecr uuid default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records; n public.records; e public.records; nxt text; v int; d jsonb;
begin
  select * into r from public.records where id = p_id and section in ('technical.boms', 'technical.configurations', 'technical.test_procedures');
  if me is null or not found or not public.record_visible_for(me, r) then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform public._mfg_need(me, case when r.section = 'technical.test_procedures' then 'test_approver' else 'bom_editor' end, 'Creating a new revision');
  if r.status not in ('Approved', 'Superseded') then raise exception 'A new revision is made from an approved one (this one is %)', r.status using errcode = '55000'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the change reason (at least 5 characters)' using errcode = '23514'; end if;
  if p_ecr is not null then e := public._mfg_rec(me, p_ecr, 'technical.changes', 'Engineering change'); end if;
  d := r.data - array['approved_at', 'approved_by', 'superseded_by', 'supersedes_ref', 'effectivity', 'ecr_ref', 'lines_hash', 'line_count'];
  if r.section = 'technical.boms' then
    if exists (select 1 from public.records x where x.section = 'technical.boms' and x.data->>'number' = r.data->>'number' and x.status = 'Draft') then
      raise exception 'This BOM already has a Draft revision: continue that one' using errcode = '55000';
    end if;
    select x.data->>'revision' into nxt from public.records x where x.section = 'technical.boms' and x.data->>'number' = r.data->>'number' order by length(x.data->>'revision') desc, x.data->>'revision' desc limit 1;
    d := d || jsonb_build_object('revision', public._mfg_next_revision(nxt));
  else
    if exists (select 1 from public.records x where x.section = r.section and x.data->>'code' = r.data->>'code' and x.status = 'Draft') then
      raise exception 'A Draft version exists already: continue that one' using errcode = '55000';
    end if;
    select coalesce(max(public._num(x.data->'version'))::int, 0) + 1 into v from public.records x where x.section = r.section and x.data->>'code' = r.data->>'code';
    d := d || jsonb_build_object('version', v);
  end if;
  d := d || jsonb_strip_nulls(jsonb_build_object('supersedes_ref', r.id, 'change_reason', left(trim(p_reason), 1000), 'ecr_ref', e.id, 'ecr_ref_title', coalesce(e.data->>'number', e.title)));
  insert into public.records(section, title, status, controlled, created_by, data) values (r.section, r.title, 'Draft', r.controlled, me, d) returning * into n;
  if r.section = 'technical.boms' then
    -- the lines are copied with their structure (parents re-linked), so the new revision starts identical
    with src as (select l.*, gen_random_uuid() nid from public.mfg_bom_lines l where l.bom_id = r.id)
    insert into public.mfg_bom_lines(id, bom_id, line_no, parent_id, item_id, qty, uom, position, required, alt_group, notes, source_doc_id, source_version_id)
    select s.nid, n.id, s.line_no, p.nid, s.item_id, s.qty, s.uom, s.position, s.required, s.alt_group, s.notes, s.source_doc_id, s.source_version_id
    from src s left join src p on p.id = s.parent_id order by s.line_no;
    perform public._mfg_sys_patch(n.id, null, jsonb_build_object('lines_hash', public._mfg_lines_hash(n.id), 'line_count', (select count(*) from public.mfg_bom_lines where bom_id = n.id)));
  end if;
  perform public._mfg_audit(me, case when r.section = 'technical.boms' then 'bom_revision' else 'new_version' end, n.id, null,
    jsonb_strip_nulls(jsonb_build_object('from', r.id, 'revision', n.data->>'revision', 'version', n.data->>'version', 'reason', left(trim(p_reason), 300), 'ecr', p_ecr)));
  return jsonb_build_object('id', n.id, 'revision', n.data->>'revision', 'version', n.data->>'version');
end $$;
revoke execute on function public.mfg_def_new_version(uuid, text, uuid) from public, anon;
grant execute on function public.mfg_def_new_version(uuid, text, uuid) to authenticated;

create or replace function public.mfg_def_retire(p_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records;
begin
  perform public._mfg_need(me, 'manufacturing_admin', 'Retiring a definition');
  select * into r from public.records where id = p_id and section in ('technical.boms', 'technical.configurations', 'technical.test_procedures') for update;
  if not found or not public.record_visible_for(me, r) then raise exception 'Not found' using errcode = 'P0002'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason (at least 5 characters)' using errcode = '23514'; end if;
  if r.status = 'Retired' then return jsonb_build_object('ok', true); end if;
  if exists (select 1 from public.wf_instances i where i.record_id = r.id and i.status in ('active', 'waiting', 'blocked', 'draft')) then raise exception 'It is in approval: cancel the approval first' using errcode = '55000'; end if;
  perform public._mfg_sys_patch(r.id, 'Retired', jsonb_build_object('retired_reason', left(trim(p_reason), 500), 'retired_by', public._wf_name(me)));
  perform public._mfg_audit(me, 'retired', r.id, null, jsonb_build_object('section', r.section, 'reason', left(trim(p_reason), 300)));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.mfg_def_retire(uuid, text) from public, anon;
grant execute on function public.mfg_def_retire(uuid, text) to authenticated;

-- deterministic comparison of two BOM revisions: lines are matched by where they sit (the items of their parent
-- assemblies) and their item; what does not match is a substitution (same place and position), an assembly move
-- (same item elsewhere), an addition or a removal. No model is asked.
create or replace function public._mfg_bom_rows(p_bom uuid) returns table (line_no int, parent_path text, item_id uuid, qty numeric, ext_qty numeric, uom text, pos text, required boolean, alt_group text)
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select l.id, l.line_no, ''::text as parent_path, l.item_id, l.qty, l.qty as ext_qty, l.uom, l.position, l.required, l.alt_group from public.mfg_bom_lines l where l.bom_id = p_bom and l.parent_id is null
    union all
    select l.id, l.line_no, t.parent_path || '/' || t.item_id::text, l.item_id, l.qty, t.ext_qty * l.qty, l.uom, l.position, l.required, l.alt_group
    from public.mfg_bom_lines l join t on l.parent_id = t.id)
  select line_no, parent_path, item_id, qty, ext_qty, uom, position, required, alt_group from t
$$;
revoke execute on function public._mfg_bom_rows(uuid) from public, anon, authenticated;

create or replace function public.mfg_bom_compare(p_a uuid, p_b uuid) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); a public.records; b public.records; res jsonb;
begin
  a := public._mfg_rec(me, p_a, 'technical.boms', 'BOM revision'); b := public._mfg_rec(me, p_b, 'technical.boms', 'BOM revision');
  create temp table if not exists mfg_cmp_a (line_no int, parent_path text, item_id uuid, qty numeric, ext_qty numeric, uom text, pos text, required boolean, alt_group text) on commit drop;
  create temp table if not exists mfg_cmp_b (like mfg_cmp_a) on commit drop;
  truncate mfg_cmp_a; truncate mfg_cmp_b;
  insert into mfg_cmp_a select * from public._mfg_bom_rows(a.id);
  insert into mfg_cmp_b select * from public._mfg_bom_rows(b.id);
  with
  m as (select x.line_no la, y.line_no lb, x.item_id, x.parent_path, x.qty qa, y.qty qb, x.alt_group ga, y.alt_group gb, x.required ra, y.required rb, x.pos pa, y.pos pb
        from mfg_cmp_a x join mfg_cmp_b y on y.parent_path = x.parent_path and y.item_id = x.item_id),
  ua as (select * from mfg_cmp_a x where not exists (select 1 from m where m.la = x.line_no)),
  ub as (select * from mfg_cmp_b y where not exists (select 1 from m where m.lb = y.line_no)),
  subs as (select x.line_no la, y.line_no lb, x.item_id ia, y.item_id ib, x.qty qa, y.qty qb, x.pos from ua x join ub y on y.parent_path = x.parent_path and x.pos is not null and y.pos = x.pos),
  ua2 as (select * from ua where line_no not in (select la from subs)),
  ub2 as (select * from ub where line_no not in (select lb from subs)),
  moves as (select x.line_no la, y.line_no lb, x.item_id, x.parent_path pa, y.parent_path pb, x.qty qa, y.qty qb from ua2 x join ub2 y on y.item_id = x.item_id and y.parent_path <> x.parent_path),
  ua3 as (select * from ua2 where line_no not in (select la from moves)),
  ub3 as (select * from ub2 where line_no not in (select lb from moves)),
  nm as (select i.id, i.data->>'number' num, i.title, public.record_visible_for(me, i) ok from public.records i where i.section = 'technical.items' and i.id in (select item_id from mfg_cmp_a union select item_id from mfg_cmp_b)),
  lab as (select id, case when ok then jsonb_build_object('id', id, 'number', num, 'title', title) else jsonb_build_object('hidden', true, 'title', 'An item you may not open') end j from nm)
  select jsonb_build_object(
    'a', jsonb_build_object('id', a.id, 'number', a.data->>'number', 'revision', a.data->>'revision', 'status', a.status),
    'b', jsonb_build_object('id', b.id, 'number', b.data->>'number', 'revision', b.data->>'revision', 'status', b.status),
    'added', coalesce((select jsonb_agg(jsonb_build_object('line', y.line_no, 'item', (select j from lab where lab.id = y.item_id), 'qty', y.qty, 'position', y.pos) order by y.line_no) from ub3 y), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(jsonb_build_object('line', x.line_no, 'item', (select j from lab where lab.id = x.item_id), 'qty', x.qty, 'position', x.pos) order by x.line_no) from ua3 x), '[]'::jsonb),
    'quantity', coalesce((select jsonb_agg(jsonb_build_object('line_a', m.la, 'line_b', m.lb, 'item', (select j from lab where lab.id = m.item_id), 'from', m.qa, 'to', m.qb) order by m.la) from m where m.qa <> m.qb), '[]'::jsonb),
    'substituted', coalesce((select jsonb_agg(jsonb_build_object('line_a', s.la, 'line_b', s.lb, 'position', s.pos, 'from', (select j from lab where lab.id = s.ia), 'to', (select j from lab where lab.id = s.ib), 'qty_from', s.qa, 'qty_to', s.qb) order by s.la) from subs s), '[]'::jsonb),
    'moved', coalesce((select jsonb_agg(jsonb_build_object('line_a', v.la, 'line_b', v.lb, 'item', (select j from lab where lab.id = v.item_id), 'qty_from', v.qa, 'qty_to', v.qb) order by v.la) from moves v), '[]'::jsonb),
    'alternates', coalesce((select jsonb_agg(jsonb_build_object('line_a', m.la, 'line_b', m.lb, 'item', (select j from lab where lab.id = m.item_id), 'group_from', m.ga, 'group_to', m.gb, 'required_from', m.ra, 'required_to', m.rb) order by m.la)
       from m where m.ga is distinct from m.gb or m.ra is distinct from m.rb), '[]'::jsonb),
    'unchanged', (select count(*) from m where m.qa = m.qb and m.ga is not distinct from m.gb and m.ra is not distinct from m.rb),
    'method', 'Deterministic: lines matched by their parent assemblies and item; same place and position with another item is a substitution; the same item under another assembly is a move')
  into res;
  return res;
end $$;
revoke execute on function public.mfg_bom_compare(uuid, uuid) from public, anon;
grant execute on function public.mfg_bom_compare(uuid, uuid) to authenticated;

-- alternates: anyone who works with items may propose; engineering authority decides. An alternate that touches an
-- approved configuration or BOM needs the Engineering Change Approver.
create or replace function public.mfg_alt_propose(p_item uuid, p_substitute uuid, p_scope text, p_target uuid, p_units uuid[], p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); i public.records; s public.records; t public.records; v_id uuid; u uuid;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not (public._mfg_can_write(me, 'technical.items') or public._mfg_can_write(me, 'operations.requests')) then raise exception 'You cannot propose alternates' using errcode = '42501'; end if;
  i := public._mfg_item(me, p_item); s := public._mfg_item(me, p_substitute);
  if i.id is null or s.id is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if coalesce(p_scope, 'all') not in ('all', 'configuration', 'bom', 'units') then raise exception 'Scope is all, a configuration, a BOM revision or listed units' using errcode = '22023'; end if;
  if p_scope = 'configuration' then t := public._mfg_rec(me, p_target, 'technical.configurations', 'Configuration'); end if;
  if p_scope = 'bom' then t := public._mfg_rec(me, p_target, 'technical.boms', 'BOM revision'); end if;
  if p_scope = 'units' then
    if coalesce(cardinality(p_units), 0) = 0 then raise exception 'List the units' using errcode = '22023'; end if;
    foreach u in array p_units loop perform public._mfg_unit(me, u); end loop;
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason (at least 5 characters)' using errcode = '23514'; end if;
  insert into public.mfg_alternates(item_id, substitute_id, scope, config_id, bom_id, unit_ids, reason, proposed_by)
  values (i.id, s.id, coalesce(p_scope, 'all'), case when p_scope = 'configuration' then t.id end, case when p_scope = 'bom' then t.id end, coalesce(p_units, '{}'), left(trim(p_reason), 1000), me)
  returning mfg_alternates.id into v_id;
  perform public._mfg_audit(me, 'substitution_proposed', i.id, null, jsonb_build_object('alternate', v_id, 'substitute', s.id, 'scope', coalesce(p_scope, 'all')));
  return jsonb_build_object('id', v_id, 'status', 'Proposed');
end $$;
revoke execute on function public.mfg_alt_propose(uuid, uuid, text, uuid, uuid[], text) from public, anon;
grant execute on function public.mfg_alt_propose(uuid, uuid, text, uuid, uuid[], text) to authenticated;

create or replace function public.mfg_alt_decide(p_id uuid, p_decision text, p_note text default null, p_ecr uuid default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); a public.mfg_alternates; touches boolean; e public.records;
begin
  select * into a from public.mfg_alternates where id = p_id for update;
  if not found or public._mfg_item(me, a.item_id) is null then raise exception 'Alternate not found' using errcode = 'P0002'; end if;
  if p_decision not in ('Approved', 'Rejected', 'Expired') then raise exception 'Decision is Approved, Rejected or Expired' using errcode = '22023'; end if;
  if a.status <> 'Proposed' and not (a.status = 'Approved' and p_decision = 'Expired') then raise exception 'This alternate is already %', a.status using errcode = '55000'; end if;
  -- does it touch an approved configuration or BOM? (scope all: any approved BOM using the item)
  touches := case a.scope
    when 'all' then exists (select 1 from public.mfg_bom_lines l join public.records b on b.id = l.bom_id where l.item_id = a.item_id and b.status = 'Approved')
    when 'bom' then exists (select 1 from public.records b where b.id = a.bom_id and b.status = 'Approved')
    when 'configuration' then exists (select 1 from public.records c where c.id = a.config_id and c.status = 'Approved')
    else true end;
  if p_decision = 'Approved' then
    if touches then perform public._mfg_need(me, 'engineering_change_approver', 'Approving a substitution in an approved configuration or BOM');
    elsif not public.has_cap(me, 'engineering_change_approver') then perform public._mfg_need(me, 'bom_approver', 'Approving an alternate'); end if;
    if a.proposed_by = me then raise exception 'The person who proposed an alternate does not approve it' using errcode = '42501'; end if;
  elsif not (public.has_cap(me, 'engineering_change_approver') or public.has_cap(me, 'bom_approver')) then
    perform public._mfg_need(me, 'bom_approver', 'Deciding on an alternate');
  end if;
  if p_ecr is not null then e := public._mfg_rec(me, p_ecr, 'technical.changes', 'Engineering change'); end if;
  update public.mfg_alternates set status = p_decision, decided_by = me, decided_at = now(), decision_note = left(p_note, 1000), ecr_id = coalesce(e.id, ecr_id) where id = a.id;
  perform public._mfg_audit(me, 'substitution_' || lower(p_decision), a.item_id, null, jsonb_build_object('alternate', a.id, 'substitute', a.substitute_id, 'touches_approved', touches, 'ecr', e.id));
  return jsonb_build_object('ok', true, 'status', p_decision);
end $$;
revoke execute on function public.mfg_alt_decide(uuid, text, text, uuid) from public, anon;
grant execute on function public.mfg_alt_decide(uuid, text, text, uuid) to authenticated;

-- is a substitute approved for this unit? (its scope covers the unit's configuration, BOM revision or the unit)
create or replace function public._mfg_alt_ok(p_item uuid, p_sub uuid, u public.records) returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.mfg_alternates a
  where a.item_id = p_item and a.substitute_id = p_sub and a.status = 'Approved' and (a.expires is null or a.expires >= current_date)
    and (a.scope = 'all' or (a.scope = 'configuration' and a.config_id::text = u.data->>'config_ref') or (a.scope = 'bom' and a.bom_id::text = u.data->>'bom_ref') or (a.scope = 'units' and u.id = any (a.unit_ids)))
  order by a.decided_at desc limit 1
$$;
revoke execute on function public._mfg_alt_ok(uuid, uuid, public.records) from public, anon, authenticated;

create or replace function public.mfg_alternates(p_item uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'item', jsonb_build_object('id', i.id, 'number', i.data->>'number', 'title', i.title),
      'substitute', jsonb_build_object('id', s.id, 'number', s.data->>'number', 'title', s.title), 'scope', a.scope, 'config_id', a.config_id, 'bom_id', a.bom_id, 'units', to_jsonb(a.unit_ids),
      'reason', a.reason, 'status', a.status, 'proposed_by', public._wf_name(a.proposed_by), 'proposed_at', a.proposed_at, 'decided_by', public._wf_name(a.decided_by), 'decided_at', a.decided_at,
      'note', a.decision_note, 'ecr', a.ecr_id,
      'affected_units', (select count(distinct x.unit_id) from public.mfg_installs x where x.item_id = a.substitute_id and x.removed_at is null)) order by a.proposed_at desc)
    from public.mfg_alternates a join public.records i on i.id = a.item_id join public.records s on s.id = a.substitute_id
    where (p_item is null or a.item_id = p_item or a.substitute_id = p_item) and public.record_visible_for(me, i) and public.record_visible_for(me, s)), '[]'::jsonb);
end $$;
revoke execute on function public.mfg_alternates(uuid) from public, anon;
grant execute on function public.mfg_alternates(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   10. Build units: created and released with the exact configuration and BOM revision pinned; the lifecycle with
       its prerequisites; material requirements and the material plan; a purchase request from a shortage
   --------------------------------------------------------------------------------------------- */
-- the BOM revision that applies to a unit of a configuration: approved, and its effectivity covers the unit
-- (a BOM belongs to the configuration code: every approved version of the configuration builds with it)
create or replace function public._mfg_applicable_bom(p_config uuid, p_seq int, p_unit uuid) returns uuid language sql stable security definer set search_path = public as $$
  select b.id from public.records b, public.records c
  where c.id = p_config and b.section = 'technical.boms' and (b.data->>'config_code' = c.data->>'code' or b.data->>'config_ref' = p_config::text) and b.status = 'Approved'
    and case coalesce(b.data->'effectivity'->>'kind', 'all_future')
          when 'after_unit' then p_seq is null or p_seq >= coalesce((b.data->'effectivity'->>'from_seq')::int, 0)
          when 'units' then p_unit is not null and coalesce(b.data->'effectivity'->'units', '[]'::jsonb) ? p_unit::text
          when 'inventory_only' then false
          else true end
  order by b.data->>'approved_at' desc nulls last, b.created_at desc limit 1
$$;
revoke execute on function public._mfg_applicable_bom(uuid, int, uuid) from public, anon, authenticated;

create or replace function public._mfg_pin(p_unit uuid, p_actor uuid, p_config public.records, p_bom public.records, p_why text) returns void language plpgsql security definer set search_path = public as $$
declare u public.records;
begin
  select * into u from public.records where id = p_unit;
  perform public._mfg_sys_patch(p_unit, null, jsonb_build_object('config_ref', p_config.id, 'config_ref_title', p_config.title, 'config_code', p_config.data->>'code', 'config_version', p_config.data->>'version',
    'bom_ref', p_bom.id, 'bom_ref_title', coalesce(p_bom.data->>'number', '') || ' rev ' || coalesce(p_bom.data->>'revision', ''), 'bom_number', p_bom.data->>'number', 'bom_revision', p_bom.data->>'revision',
    'bom_lines_hash', p_bom.data->>'lines_hash',
    'pin_history', coalesce(u.data->'pin_history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_actor, 'config', p_config.id, 'bom', p_bom.id, 'revision', p_bom.data->>'revision', 'why', p_why))));
end $$;
revoke execute on function public._mfg_pin(uuid, uuid, public.records, public.records, text) from public, anon, authenticated;

-- release: pins the approved configuration and the BOM revision that applies to this unit
create or replace function public.mfg_unit_release(p_unit uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; c public.records; b public.records; bid uuid;
begin
  perform public._mfg_need(me, 'build_manager', 'Releasing a build unit');
  u := public._mfg_unit(me, p_unit, true);
  if coalesce(u.data->>'released_at', '') <> '' then raise exception 'This unit is released already (% rev %)', u.data->>'bom_number', u.data->>'bom_revision' using errcode = '55000'; end if;
  select * into c from public.records where id = public.as_uuid(u.data->>'config_ref') and section = 'technical.configurations';
  if not found then raise exception 'Choose the configuration first' using errcode = '23514'; end if;
  if c.status <> 'Approved' then raise exception 'The configuration % v% is % — only an approved configuration is built', c.data->>'code', c.data->>'version', c.status using errcode = '23514'; end if;
  bid := public._mfg_applicable_bom(c.id, (u.data->>'unit_seq')::int, u.id);
  if bid is null then raise exception 'No approved BOM revision applies to this unit of %', c.title using errcode = '23514'; end if;
  select * into b from public.records where id = bid;
  perform public._mfg_pin(u.id, me, c, b, 'release');
  perform public._mfg_sys_patch(u.id, null, jsonb_build_object('released_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'released_by', public._wf_name(me), 'released_by_id', me));
  perform public._mfg_audit(me, 'unit_released', u.id, u.id, jsonb_build_object('config', c.id, 'bom', b.id, 'revision', b.data->>'revision', 'lines_hash', b.data->>'lines_hash'));
  return jsonb_build_object('ok', true, 'config', c.id, 'bom', b.id, 'bom_number', b.data->>'number', 'revision', b.data->>'revision');
end $$;
revoke execute on function public.mfg_unit_release(uuid) from public, anon;
grant execute on function public.mfg_unit_release(uuid) to authenticated;

create or replace function public.mfg_unit_create(p jsonb, p_release boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); pr public.records; c public.records; prj public.records; pa public.records; dl public.records; u public.records; d jsonb; rel jsonb;
begin
  perform public._mfg_need(me, 'build_manager', 'Creating a build unit');
  pr := public._mfg_rec(me, public.as_uuid(p->>'product'), 'technical.products', 'Product');
  if coalesce(pr.status, 'Active') in ('Retired', 'Hold') then raise exception 'The product % is %', pr.data->>'code', pr.status using errcode = '55000'; end if;
  if coalesce(p->>'config', '') <> '' then c := public._mfg_rec(me, public.as_uuid(p->>'config'), 'technical.configurations', 'Configuration');
  else select * into c from public.records where id = public.as_uuid(pr.data->>'current_config_ref') and section = 'technical.configurations'; end if;
  if c.id is not null and c.data->>'product_ref' is distinct from pr.id::text then raise exception 'The configuration belongs to another product' using errcode = '22023'; end if;
  if coalesce(p->>'project', '') <> '' then prj := public._mfg_rec(me, public.as_uuid(p->>'project'), 'company.projects', 'Project'); end if;
  if coalesce(p->>'party', '') <> '' then pa := public._mfg_rec(me, public.as_uuid(p->>'party'), 'company.parties', 'Organization'); end if;
  if coalesce(p->>'deal', '') <> '' then dl := public._mfg_rec(me, public.as_uuid(p->>'deal'), 'sales.pipeline', 'Opportunity'); end if;
  if coalesce(p->>'owner_id', '') <> '' and not public.is_active_employee(public.as_uuid(p->>'owner_id')) then raise exception 'The manufacturing owner must be an active employee' using errcode = '23514'; end if;
  d := jsonb_strip_nulls(jsonb_build_object('product_ref', pr.id, 'product_ref_title', coalesce(pr.data->>'code', pr.title),
    'config_ref', c.id, 'config_ref_title', c.title, 'project_ref', prj.id, 'project_ref_title', prj.title, 'party_ref', pa.id, 'party_ref_title', pa.title, 'client', pa.title,
    'deal_ref', dl.id, 'deal_ref_title', coalesce(dl.data->>'number', dl.title),
    'owner_id', coalesce(public.as_uuid(p->>'owner_id'), me), 'owner', public._wf_name(coalesce(public.as_uuid(p->>'owner_id'), me)),
    'manufacturing_owner_id', coalesce(public.as_uuid(p->>'owner_id'), me),
    'planned_start', public._mfg_date(p->>'planned_start')::text, 'due', public._mfg_date(p->>'target')::text, 'target', public._mfg_date(p->>'target')::text,
    'location', left(p->>'location', 120), 'destination', left(p->>'destination', 300), 'site', left(p->>'destination', 300), 'priority', coalesce(p->>'priority', 'Medium'), 'notes', left(p->>'notes', 4000),
    'config', coalesce(c.data->>'legacy_config', null), 'export_check', 'Not started',
    'restricted', case when coalesce((p->>'restricted')::boolean, false) then true end, 'team_ids', case when jsonb_typeof(p->'team_ids') = 'array' then p->'team_ids' end));
  insert into public.records(section, title, status, controlled, created_by, data)
  values ('operations.builds', left(coalesce(nullif(trim(p->>'title'), ''), coalesce(pr.data->>'code', pr.title) || coalesce(' ' || (c.data->>'name'), '') || ' unit'), 300), 'Planned',
    coalesce((p->>'controlled')::boolean, false) or coalesce(c.controlled, false) or coalesce(prj.controlled, false), me, d)
  returning * into u;
  update public.records set title = left(coalesce(u.data->>'number', '') || ' · ' || u.title, 300) where id = u.id and coalesce(u.data->>'number', '') <> '' and position(u.data->>'number' in u.title) = 0;
  perform public._mfg_audit(me, 'unit_created', u.id, u.id, jsonb_build_object('number', u.data->>'number', 'product', pr.id, 'config', c.id));
  if p_release and c.id is not null and c.status = 'Approved' and public._mfg_applicable_bom(c.id, (u.data->>'unit_seq')::int, u.id) is not null then
    rel := public.mfg_unit_release(u.id);
  end if;
  select * into u from public.records where id = u.id;
  return jsonb_build_object('id', u.id, 'number', u.data->>'number', 'status', u.status, 'released', coalesce(u.data->>'released_at', '') <> '', 'bom', u.data->>'bom_ref',
    'bom_revision', u.data->>'bom_revision', 'config', u.data->>'config_ref');
end $$;
revoke execute on function public.mfg_unit_create(jsonb, boolean) from public, anon;
grant execute on function public.mfg_unit_create(jsonb, boolean) to authenticated;

-- a lifecycle move made from the Manufacturing screen (the same prerequisites the board applies); cancelling a unit
-- releases what was allocated to it
create or replace function public.mfg_unit_status(p_unit uuid, p_status text, p_reason text default null, p_exception text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; n public.records; e text; a record; rel int := 0;
begin
  if not (public.has_cap(me, 'build_manager') or public.has_cap(me, 'work_order_manager')) then perform public._mfg_need(me, 'build_manager', 'Changing the build status'); end if;
  u := public._mfg_unit(me, p_unit, true);
  if p_status in ('Ready for Shipment', 'Shipped', 'Delivered') and not exists (select 1 from public.mfg_acceptance x where x.unit_id = u.id and x.status <> 'Rejected') then
    raise exception 'A unit reaches «%» through Unit acceptance (and the shipment release)', p_status using errcode = '23514';
  end if;
  n := u; n.status := p_status;
  n.data := u.data || jsonb_strip_nulls(jsonb_build_object('status_reason', nullif(trim(coalesce(p_reason, '')), ''), 'status_exception', nullif(trim(coalesce(p_exception, '')), '')));
  e := public._mfg_status_check('UPDATE', u, n, me);
  if e is not null then raise exception '%', e using errcode = '23514'; end if;
  perform public._mfg_sys_patch(u.id, p_status, n.data - array['pin_history'] || jsonb_build_object('pin_history', coalesce(u.data->'pin_history', '[]'::jsonb)));
  if public.mfg_status_kind(p_status) = 'cancelled' then
    for a in select * from public.mfg_allocs where unit_id = u.id and status = 'active' loop
      perform public._mfg_release_alloc(a.id, me, 'Unit cancelled'); rel := rel + 1;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'status', p_status, 'released_allocations', rel);
end $$;
revoke execute on function public.mfg_unit_status(uuid, text, text, text) from public, anon;
grant execute on function public.mfg_unit_status(uuid, text, text, text) to authenticated;

/* material requirements of one unit: the leaf lines of its pinned BOM revision (assemblies explode into their
   lines), required quantities through the assemblies, allocated / consumed / installed for this unit, free stock,
   open purchases for this unit, the shortage. Free stock is what is Available (allocated stock is not free). */
create or replace function public._mfg_req(p_unit uuid, p_viewer uuid) returns table (item_id uuid, bom_qty numeric, required numeric, allocated numeric, consumed numeric,
  free_available numeric, ordered numeric, received numeric, requested numeric, expected date, late boolean, alt_available numeric, optional boolean)
language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare u public.records; bid uuid; grace int := coalesce((public.mfg_cfg()->>'late_purchase_grace_days')::int, 0);
begin
  select * into u from public.records where id = p_unit;
  bid := public.as_uuid(u.data->>'bom_ref');
  if bid is null then return; end if;
  return query
  with recursive t as (
    select l.id, l.parent_id, l.item_id, l.qty ext, l.required, l.alt_group, l.line_no from public.mfg_bom_lines l where l.bom_id = bid and l.parent_id is null
    union all
    select l.id, l.parent_id, l.item_id, t.ext * l.qty, l.required and t.required, l.alt_group, l.line_no from public.mfg_bom_lines l join t on l.parent_id = t.id),
  leaf as (select t.* from t where not exists (select 1 from public.mfg_bom_lines c where c.parent_id = t.id)),
  -- in an alternate group the first line is the primary; the others are alternates (not required on their own)
  prim as (select lf.*, (lf.alt_group is null or lf.line_no = min(lf.line_no) over (partition by lf.parent_id, lf.alt_group)) is_primary from leaf lf),
  need as (select p.item_id, sum(p.ext) filter (where p.is_primary and p.required) bq, bool_and(not (p.is_primary and p.required)) opt from prim p group by p.item_id),
  al as (select a.item_id, sum(a.qty - a.qty_consumed) q from public.mfg_allocs a where a.unit_id = p_unit and a.status = 'active' group by a.item_id),
  co as (select x.item_id, sum(case when x.kind in ('consume', 'install') then x.qty when x.kind = 'remove' then -x.qty else 0 end) q from public.mfg_txns x where x.unit_id = p_unit and x.kind in ('consume', 'install', 'remove') group by x.item_id),
  fr as (select s.item_id, sum(s.qty) q from public.mfg_stock s where s.state = 'Available' and s.item_id in (select n.item_id from need n) group by s.item_id),
  po as (select (rq.data->>'item_ref')::uuid item_id,
                sum(case when po.id is not null and coalesce(po.status, '') not in ('Cancelled', 'Closed') then greatest(coalesce(public._num(po.data->'qty'), 0) - coalesce(public._num(po.data->'qty_received'), 0), 0) else 0 end) open_q,
                sum(coalesce(public._num(po.data->'qty_received'), 0)) rec_q,
                sum(case when po.id is null and coalesce(rq.status, '') not in ('Rejected', 'Cancelled', 'Closed') then coalesce(public._num(rq.data->'qty'), 0) else 0 end) req_q,
                min(public._mfg_date(coalesce(po.data->>'eta', rq.data->>'needed_by'))) filter (where coalesce(po.status, rq.status, '') not in ('Cancelled', 'Closed', 'Received', 'Rejected')) eta
         from public.records rq left join public.records po on po.section = 'operations.procurement' and po.data->>'request_ref' = rq.id::text
         where rq.section = 'operations.requests' and rq.data->>'build_ref' = p_unit::text and public.as_uuid(rq.data->>'item_ref') is not null group by 1),
  alt as (select n.item_id, sum(s.qty) q from need n join public.mfg_alternates a on a.item_id = n.item_id and a.status = 'Approved' and (a.expires is null or a.expires >= current_date)
            and (a.scope = 'all' or (a.scope = 'configuration' and a.config_id::text = u.data->>'config_ref') or (a.scope = 'bom' and a.bom_id = bid) or (a.scope = 'units' and p_unit = any (a.unit_ids)))
          join public.mfg_stock s on s.item_id = a.substitute_id and s.state = 'Available' group by n.item_id)
  select n.item_id, coalesce(n.bq, 0), coalesce(n.bq, 0), coalesce(al.q, 0), coalesce(co.q, 0), coalesce(fr.q, 0), coalesce(po.open_q, 0), coalesce(po.rec_q, 0), coalesce(po.req_q, 0), po.eta,
         coalesce(po.eta < current_date - grace and po.open_q > 0, false), coalesce(alt.q, 0), coalesce(n.opt, false)
  from need n left join al on al.item_id = n.item_id left join co on co.item_id = n.item_id left join fr on fr.item_id = n.item_id left join po on po.item_id = n.item_id left join alt on alt.item_id = n.item_id;
end $$;
revoke execute on function public._mfg_req(uuid, uuid) from public, anon, authenticated;

-- the material plan of one or more units (a unit, a product, a project, or a list; at most 100 units in one call —
-- larger plans are narrowed, never computed unbounded). Free stock is shared between the units in order of their
-- target date: each unit is offered only what the earlier ones did not take.
create or replace function public.mfg_material_plan(p_scope jsonb) returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); ids uuid[]; uid uuid; u public.records; rows jsonb := '[]'::jsonb; x record; taken jsonb := '{}'::jsonb; free numeric; offer numeric; short numeric; t numeric;
  tot jsonb := '{}'::jsonb; cnt int; units jsonb := '[]'::jsonb; it public.records; cost boolean;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  cost := public._mfg_cost_ok(me);
  select array_agg(r.id order by public._mfg_date(r.data->>'target') nulls last, r.data->>'number') into ids from public.records r
  where r.section = 'operations.builds' and coalesce(r.data->>'bom_ref', '') <> '' and public.mfg_status_kind(r.status) not in ('done', 'cancelled')
    and (case when p_scope ? 'unit' then r.id = public.as_uuid(p_scope->>'unit')
              when p_scope ? 'units' then r.id::text in (select jsonb_array_elements_text(p_scope->'units'))
              when p_scope ? 'product' then r.data->>'product_ref' = p_scope->>'product'
              when p_scope ? 'project' then r.data->>'project_ref' = p_scope->>'project'
              else true end)
    and public.record_visible_for(me, r);
  cnt := coalesce(cardinality(ids), 0);
  if cnt > 100 then raise exception 'The plan covers % units: narrow it to at most 100 (a product, a project or a list)', cnt using errcode = '54000'; end if;
  foreach uid in array coalesce(ids, '{}') loop
    select * into u from public.records where id = uid;
    units := units || jsonb_build_array(jsonb_build_object('id', u.id, 'number', u.data->>'number', 'title', u.title, 'status', u.status, 'target', u.data->>'target'));
    for x in select * from public._mfg_req(u.id, me) loop
      it := public._mfg_item(me, x.item_id);
      if it.id is null then continue; end if; -- an item this person may not open takes no part (no count, no shortage)
      free := greatest(x.free_available - coalesce((taken->>(x.item_id::text))::numeric, 0), 0);
      short := greatest(x.required - x.consumed - x.allocated, 0);
      offer := least(free, short);
      taken := taken || jsonb_build_object(x.item_id::text, coalesce((taken->>(x.item_id::text))::numeric, 0) + offer);
      t := greatest(short - offer, 0);
      rows := rows || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('unit', u.id, 'unit_number', u.data->>'number', 'item', x.item_id, 'item_number', it.data->>'number', 'item_title', it.title,
        'item_type', it.data->>'item_type', 'uom', it.data->>'uom', 'serialized', coalesce((it.data->>'serialized')::boolean, false), 'preferred_supplier', it.data->>'vendor_ref_title', 'vendor_ref', it.data->>'vendor_ref',
        'lead_time_days', public._num(it.data->'lead_time_days'),
        'bom_qty', x.bom_qty, 'required', x.required, 'allocated', x.allocated, 'consumed', x.consumed, 'available', free, 'allocate', offer,
        'shortage', t, 'ordered', x.ordered, 'received', x.received, 'requested', x.requested, 'purchase_required', greatest(t - x.ordered - x.requested, 0),
        'expected', x.expected, 'late', x.late, 'alternate_available', nullif(x.alt_available, 0), 'optional', case when x.optional then true end,
        'blocked', t > 0 and (x.ordered + x.requested < t or x.late),
        'ref_cost', case when cost then public._num(it.data->'ref_cost') end, 'currency', case when cost then it.data->>'currency' end)));
    end loop;
  end loop;
  return jsonb_build_object('units', units, 'rows', rows,
    'summary', jsonb_build_object('units', cnt, 'lines', jsonb_array_length(rows),
      'short_lines', (select count(*) from jsonb_array_elements(rows) r where (r->>'shortage')::numeric > 0),
      'purchase_lines', (select count(*) from jsonb_array_elements(rows) r where (r->>'purchase_required')::numeric > 0),
      'late_lines', (select count(*) from jsonb_array_elements(rows) r where coalesce((r->>'late')::boolean, false)),
      'blocked_lines', (select count(*) from jsonb_array_elements(rows) r where coalesce((r->>'blocked')::boolean, false))),
    'rule', 'Free stock = Available (allocated stock is not free); shared between the units in order of their target date. Shortage = required − consumed − allocated − offered free stock.');
end $$;
revoke execute on function public.mfg_material_plan(jsonb) from public, anon;
grant execute on function public.mfg_material_plan(jsonb) to authenticated;

-- a purchase request from a shortage: the normal P6 purchase process (request → quotations → selection → approval →
-- purchase → receiving). Nothing is ordered by this; the request carries the item, unit and source requirement.
create or replace function public.mfg_shortage_request(p_unit uuid, p_item uuid, p_qty numeric, p_needed_by date default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; it public.records; x record; res jsonb; restricted boolean; title text; vend public.records;
begin
  u := public._mfg_unit(me, p_unit);
  it := public._mfg_item(me, p_item);
  if it.id is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  select * into x from public._mfg_req(u.id, me) r where r.item_id = it.id;
  if not found then raise exception 'This item is not in the unit''s BOM revision' using errcode = '22023'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'How many are needed?' using errcode = '22023'; end if;
  restricted := coalesce((u.data->>'restricted')::boolean, false);
  title := 'Material: ' || coalesce(it.data->>'number', '') || ' ' || it.title || case when restricted then '' else ' — ' || coalesce(u.data->>'number', u.title) end;
  select * into vend from public.records where id = public.as_uuid(it.data->>'vendor_ref') and section = 'operations.vendors';
  res := public.ops_request_create('purchase', left(title, 300), jsonb_strip_nulls(jsonb_build_object(
    'item', coalesce(it.data->>'number', '') || ' ' || it.title || coalesce(' (' || (it.data->>'manufacturer') || ' ' || (it.data->>'mpn') || ')', ''),
    'item_ref', it.id, 'qty', p_qty, 'needed_by', coalesce(p_needed_by, public._mfg_date(u.data->>'planned_start'), current_date + coalesce(public._num(it.data->'lead_time_days')::int, 14))::text,
    'est_amount', case when public._num(it.data->'ref_cost') is not null then round(public._num(it.data->'ref_cost') * p_qty, 2) end, 'currency', coalesce(it.data->>'currency', 'USD'),
    'project_ref', u.data->>'project_ref', 'build_ref', u.id, 'vendor_ref', case when vend.id is not null and public.record_visible_for(me, vend) then vend.id end,
    'justification', 'Shortage for build unit ' || case when restricted then '(restricted)' else coalesce(u.data->>'number', u.title) end || ': required ' || x.required || ', consumed ' || x.consumed
      || ', allocated ' || x.allocated || ', free ' || x.free_available || ', ordered ' || x.ordered || coalesce('. ' || p_note, ''),
    'mfg_source', jsonb_build_object('unit', u.id, 'item', it.id, 'required', x.required, 'consumed', x.consumed, 'allocated', x.allocated, 'free', x.free_available, 'ordered', x.ordered, 'at', now()))), null);
  -- a restricted unit is not named on the request (the purchasing desk sees the request, not the unit)
  if restricted then update public.records set data = data - 'build_ref_title' where id = public.as_uuid(res->>'record'); end if;
  perform public._mfg_audit(me, 'purchase_request_from_shortage', public.as_uuid(res->>'record'), u.id, jsonb_build_object('item', it.id, 'qty', p_qty, 'number', res->>'number'));
  return res;
end $$;
revoke execute on function public.mfg_shortage_request(uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.mfg_shortage_request(uuid, uuid, numeric, date, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   11. Inventory: locations, receiving into inspection, states, moves, adjustments, allocation, consumption,
       installation of serials. Every write locks the item (one writer per item at a time), checks before it
       writes and records the movement in the ledger; balances never go negative; a serial is in one place.
   --------------------------------------------------------------------------------------------- */
create or replace function public._mfg_lock_item(p_item uuid) returns void language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('mfg-item:' || p_item::text, 0))
$$;
revoke execute on function public._mfg_lock_item(uuid) from public, anon, authenticated;

create or replace function public._mfg_stock_add(p_item uuid, p_loc uuid, p_lot uuid, p_state text, p_qty numeric) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_qty <= 0 then return; end if;
  insert into public.mfg_stock(item_id, location_id, lot_id, state, qty) values (p_item, p_loc, p_lot, p_state, p_qty)
    on conflict (item_id, location_id, lot_id, state) do update set qty = public.mfg_stock.qty + excluded.qty, updated_at = now();
end $$;
revoke execute on function public._mfg_stock_add(uuid, uuid, uuid, text, numeric) from public, anon, authenticated;

create or replace function public._mfg_stock_take(p_item uuid, p_loc uuid, p_lot uuid, p_state text, p_qty numeric) returns void language plpgsql security definer set search_path = public as $$
declare have numeric; n int;
begin
  if p_qty <= 0 then return; end if;
  update public.mfg_stock set qty = qty - p_qty, updated_at = now()
   where item_id = p_item and location_id = p_loc and lot_id is not distinct from p_lot and state = p_state and qty >= p_qty;
  get diagnostics n = row_count;
  if n = 0 then
    select coalesce(sum(qty), 0) into have from public.mfg_stock where item_id = p_item and location_id = p_loc and lot_id is not distinct from p_lot and state = p_state;
    raise exception 'Not enough stock: % % here, % asked (stock never goes negative)', have, p_state, p_qty using errcode = '23514';
  end if;
end $$;
revoke execute on function public._mfg_stock_take(uuid, uuid, uuid, text, numeric) from public, anon, authenticated;

create or replace function public._mfg_txn(p_kind text, p_item uuid, p_qty numeric, p_from uuid, p_to uuid, p_fs text, p_ts text, p_lot uuid, p_serial uuid, p_unit uuid, p_wo uuid,
  p_receipt uuid, p_alloc uuid, p_purchase uuid, p_actor uuid, p_reason text, p_key text, p_detail jsonb default '{}'::jsonb) returns bigint language sql security definer set search_path = public as $$
  insert into public.mfg_txns(kind, item_id, qty, from_location, to_location, from_state, to_state, lot_id, serial_id, unit_id, wo_id, receipt_id, alloc_id, purchase_id, actor, reason, idem_key, detail)
  values (p_kind, p_item, p_qty, p_from, p_to, p_fs, p_ts, p_lot, p_serial, p_unit, p_wo, p_receipt, p_alloc, p_purchase, p_actor, left(p_reason, 500), p_key, coalesce(p_detail, '{}'::jsonb))
  returning id
$$;
revoke execute on function public._mfg_txn(text, uuid, numeric, uuid, uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- a repeated call (same key) does nothing a second time: duplicate receipts, moves and consumptions are refused
create or replace function public._mfg_seen_key(p_key text) returns boolean language sql stable security definer set search_path = public as $$
  select p_key is not null and exists (select 1 from public.mfg_txns where idem_key = p_key or idem_key like p_key || ':%')
$$;
revoke execute on function public._mfg_seen_key(text) from public, anon, authenticated;

create or replace function public._mfg_location(p_id uuid) returns public.mfg_locations language plpgsql stable security definer set search_path = public as $$
declare l public.mfg_locations;
begin
  select * into l from public.mfg_locations where id = p_id;
  if not found then raise exception 'Location not found' using errcode = 'P0002'; end if;
  if not l.active then raise exception 'The location % is not in use', l.code using errcode = '55000'; end if;
  return l;
end $$;
revoke execute on function public._mfg_location(uuid) from public, anon, authenticated;

create or replace function public._mfg_default_location(p_purpose text) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.mfg_locations where active and purpose = p_purpose order by kind = 'Area' desc, code limit 1
$$;
revoke execute on function public._mfg_default_location(text) from public, anon, authenticated;

/* ----- locations ----- */
create or replace function public.mfg_location_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); v_id uuid := public.as_uuid(p->>'id'); par uuid := public.as_uuid(p->>'parent'); anc uuid; n int := 0;
begin
  if not (public.has_cap(me, 'inventory_manager') or public.has_cap(me, 'manufacturing_admin')) then perform public._mfg_need(me, 'inventory_manager', 'Changing locations'); end if;
  if coalesce(p->>'code', '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' then raise exception 'A location code is 1–40 letters, digits, dot, dash or underscore' using errcode = '22023'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Give the location a name' using errcode = '22023'; end if;
  if par is not null then
    anc := par;
    while anc is not null loop
      if anc = v_id then raise exception 'A location cannot be inside itself' using errcode = '22023'; end if;
      select parent_id into anc from public.mfg_locations where id = anc; n := n + 1; exit when n > 50;
    end loop;
  end if;
  if v_id is null then
    insert into public.mfg_locations(code, name, kind, purpose, parent_id, notes, created_by)
    values (upper(p->>'code'), trim(p->>'name'), coalesce(p->>'kind', 'Area'), coalesce(p->>'purpose', 'Storage'), par, left(p->>'notes', 1000), me) returning mfg_locations.id into v_id;
  else
    if coalesce((p->>'active')::boolean, true) = false and exists (select 1 from public.mfg_stock s where s.location_id = v_id and s.qty > 0) then raise exception 'There is stock in this location: move it first' using errcode = '55000'; end if;
    update public.mfg_locations set code = upper(p->>'code'), name = trim(p->>'name'), kind = coalesce(p->>'kind', kind), purpose = coalesce(p->>'purpose', purpose), parent_id = par,
      notes = left(p->>'notes', 1000), active = coalesce((p->>'active')::boolean, active), updated_at = now() where mfg_locations.id = v_id;
    if not found then raise exception 'Location not found' using errcode = 'P0002'; end if;
  end if;
  perform public._mfg_audit(me, 'location_saved', null, null, jsonb_build_object('location', v_id, 'code', upper(p->>'code')));
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.mfg_location_save(jsonb) from public, anon;
grant execute on function public.mfg_location_save(jsonb) to authenticated;

create or replace function public.mfg_locations() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer();
begin
  if me is null or not public._mfg_can_read(me, 'technical.items') then raise exception 'Not allowed' using errcode = '42501'; end if;
  return coalesce((
    with recursive t as (select l.id, l.code::text path, 1 depth from public.mfg_locations l where l.parent_id is null
                         union all select l.id, t.path || ' › ' || l.code, t.depth + 1 from public.mfg_locations l join t on l.parent_id = t.id where t.depth < 20)
    select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'name', l.name, 'kind', l.kind, 'purpose', l.purpose, 'parent', l.parent_id, 'active', l.active, 'path', t.path, 'depth', t.depth,
      'lines', (select count(*) from public.mfg_stock s where s.location_id = l.id and s.qty > 0)) order by t.path)
    from public.mfg_locations l join t on t.id = l.id), '[]'::jsonb);
end $$;
revoke execute on function public.mfg_locations() from public, anon;
grant execute on function public.mfg_locations() to authenticated;

/* ----- receiving (P6 receiving, then into stock: inspection where required) ----- */
create or replace function public.mfg_receive(p_purchase uuid, p_qty numeric, p_rejected numeric default 0, p_condition text default 'Good', p_note text default null, p_date date default null,
  p_location uuid default null, p_serials text[] default null, p_lot jsonb default null, p_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); pu public.records; rq public.records; it public.records; res jsonb; acc numeric; st text; loc uuid; lot uuid; s text; sid uuid; n int := 0; insp boolean;
  serials jsonb := '[]'::jsonb; prev record;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_key is not null and length(p_key) > 100 then raise exception 'Key too long' using errcode = '22023'; end if;
  -- a repeated submission (same key) is answered with what the first one did, nothing is received twice
  if p_key is not null then
    select x.receipt_id, x.to_state, x.qty into prev from public.mfg_txns x where x.idem_key = 'rcv:' || p_key limit 1;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'receipt', prev.receipt_id, 'state', prev.to_state, 'qty', prev.qty); end if;
  end if;
  select * into pu from public.records where id = p_purchase and section = 'operations.procurement';
  if not found or not public.record_visible_for(me, pu) then raise exception 'Purchase record not found' using errcode = 'P0002'; end if;
  select * into rq from public.records where id = public.as_uuid(pu.data->>'request_ref');
  select * into it from public.records where id = public.as_uuid(rq.data->>'item_ref') and section = 'technical.items';
  acc := coalesce(p_qty, 0) - coalesce(p_rejected, 0);
  if it.id is not null then
    perform public._mfg_lock_item(it.id);
    if coalesce((it.data->>'serialized')::boolean, false) then
      if acc <> trunc(acc) then raise exception 'A serialized item is received in whole units' using errcode = '22023'; end if;
      if coalesce(cardinality(p_serials), 0) <> acc then raise exception 'Enter one serial number for each accepted unit (% accepted, % given)', acc, coalesce(cardinality(p_serials), 0) using errcode = '22023'; end if;
      if (select count(distinct trim(x)) from unnest(p_serials) x) <> cardinality(p_serials) then raise exception 'A serial number is entered twice' using errcode = '22023'; end if;
      select string_agg(x.serial, ', ') into s from public.mfg_serials x where x.item_id = it.id and x.serial = any (array(select trim(y) from unnest(p_serials) y));
      if s is not null then raise exception 'Serial number(s) % of this item are recorded already', s using errcode = '23505'; end if;
    end if;
    if coalesce((it.data->>'lot_controlled')::boolean, false) and acc > 0 and coalesce(p_lot->>'lot_no', '') = '' then raise exception 'This item is lot-controlled: enter the lot number written on the delivery' using errcode = '22023'; end if;
  end if;
  -- the P6 receiving: the receipt, the purchase quantities, a discrepancy issue and vendor follow-up when something is refused
  res := public.ops_receive(p_purchase, p_qty, p_rejected, p_condition, p_note, p_date);
  if it.id is null or acc <= 0 then return res || jsonb_build_object('stocked', false); end if;
  -- not everything received is available: inspection where the item requires it (the default), otherwise available
  insp := coalesce((it.data->>'inspection_required')::boolean, coalesce(public.mfg_cfg()->>'receive_default_state', 'Inspection') = 'Inspection');
  st := case when insp then 'Inspection' else 'Available' end;
  loc := coalesce(p_location, public._mfg_default_location(case when insp then 'Inspection' else 'Receiving' end), public._mfg_default_location('Receiving'));
  if loc is null then raise exception 'Set up a receiving location first (Manufacturing → Inventory → Locations)' using errcode = '23514'; end if;
  perform public._mfg_location(loc);
  if coalesce(p_lot->>'lot_no', '') <> '' then
    insert into public.mfg_lots(item_id, lot_no, vendor_id, manufacturer, manufactured, received, expires, qty_received, receipt_id, created_by)
    values (it.id, trim(p_lot->>'lot_no'), public.as_uuid(pu.data->>'vendor_ref'), nullif(p_lot->>'manufacturer', ''), public._mfg_date(p_lot->>'manufactured'),
      coalesce(p_date, current_date), public._mfg_date(p_lot->>'expires'), acc, public.as_uuid(res->>'receipt'), me)
    on conflict (item_id, lot_no) do update set qty_received = public.mfg_lots.qty_received + excluded.qty_received
    returning id into lot;
  end if;
  if coalesce((it.data->>'serialized')::boolean, false) then
    foreach s in array p_serials loop
      insert into public.mfg_serials(item_id, serial, vendor_id, purchase_id, receipt_id, lot_id, location_id, state, created_by)
      values (it.id, trim(s), public.as_uuid(pu.data->>'vendor_ref'), pu.id, public.as_uuid(res->>'receipt'), lot, loc, st, me) returning id into sid;
      perform public._mfg_txn('receive', it.id, 1, null, loc, null, st, lot, sid, public.as_uuid(rq.data->>'build_ref'), null, public.as_uuid(res->>'receipt'), null, pu.id, me, 'Received', case when p_key is not null then 'rcv:' || p_key || case when n > 0 then ':' || n else '' end end);
      n := n + 1; serials := serials || jsonb_build_array(jsonb_build_object('id', sid, 'serial', trim(s)));
    end loop;
  else
    perform public._mfg_txn('receive', it.id, acc, null, loc, null, st, lot, null, public.as_uuid(rq.data->>'build_ref'), null, public.as_uuid(res->>'receipt'), null, pu.id, me, 'Received', case when p_key is not null then 'rcv:' || p_key end);
  end if;
  perform public._mfg_stock_add(it.id, loc, lot, st, acc);
  perform public._mfg_audit(me, 'received', it.id, public.as_uuid(rq.data->>'build_ref'), jsonb_build_object('receipt', res->>'receipt', 'qty', acc, 'state', st, 'location', loc, 'lot', lot, 'serials', jsonb_array_length(serials)));
  return res || jsonb_build_object('stocked', true, 'item', it.id, 'state', st, 'location', loc, 'lot', lot, 'serials', serials, 'qty', acc);
end $$;
revoke execute on function public.mfg_receive(uuid, numeric, numeric, text, text, date, uuid, text[], jsonb, text) from public, anon;
grant execute on function public.mfg_receive(uuid, numeric, numeric, text, text, date, uuid, text[], jsonb, text) to authenticated;

/* ----- state changes (inspection outcome, quarantine, rejection, return to vendor, scrap) and moves ----- */
create or replace function public._mfg_move(p_item uuid, p_from uuid, p_to uuid, p_lot uuid, p_fs text, p_ts text, p_qty numeric, p_serials uuid[], p_actor uuid, p_kind text, p_reason text, p_key text,
  p_unit uuid default null, p_wo uuid default null, p_detail jsonb default '{}'::jsonb) returns int language plpgsql security definer set search_path = public as $$
declare it public.records; sid uuid; sr public.mfg_serials; n int := 0; leaving boolean := p_ts in ('Installed', 'Consumed', 'Returned', 'Scrap');
begin
  select * into it from public.records where id = p_item and section = 'technical.items';
  if not found then raise exception 'Item not found' using errcode = 'P0002'; end if;
  perform public._mfg_lock_item(p_item);
  if p_key is not null and public._mfg_seen_key(p_key) then raise exception 'This movement was recorded already' using errcode = '23505'; end if;
  if coalesce((it.data->>'serialized')::boolean, false) then
    if coalesce(cardinality(p_serials), 0) = 0 then raise exception 'Choose the serial numbers (a serialized item moves by serial)' using errcode = '22023'; end if;
    foreach sid in array p_serials loop
      select * into sr from public.mfg_serials where id = sid and item_id = p_item for update;
      if not found then raise exception 'Serial not found' using errcode = 'P0002'; end if;
      if sr.state is distinct from p_fs or sr.location_id is distinct from p_from then raise exception 'Serial % is % at another place, not % here', sr.serial, sr.state, p_fs using errcode = '23514'; end if;
      perform public._mfg_stock_take(p_item, p_from, sr.lot_id, p_fs, 1);
      if not leaving then perform public._mfg_stock_add(p_item, coalesce(p_to, p_from), sr.lot_id, p_ts, 1); end if;
      update public.mfg_serials set state = p_ts, location_id = case when leaving then location_id else coalesce(p_to, p_from) end, updated_at = now(),
        alloc_id = case when p_ts = 'Allocated' then alloc_id else null end where id = sid;
      perform public._mfg_txn(p_kind, p_item, 1, p_from, case when leaving then null else coalesce(p_to, p_from) end, p_fs, p_ts, sr.lot_id, sid, p_unit, p_wo, null, null, null, p_actor, p_reason,
        case when p_key is not null then p_key || ':' || n end, p_detail);
      n := n + 1;
    end loop;
  else
    if p_qty is null or p_qty <= 0 then raise exception 'Give a quantity above zero' using errcode = '22023'; end if;
    perform public._mfg_stock_take(p_item, p_from, p_lot, p_fs, p_qty);
    if not leaving then perform public._mfg_stock_add(p_item, coalesce(p_to, p_from), p_lot, p_ts, p_qty); end if;
    perform public._mfg_txn(p_kind, p_item, p_qty, p_from, case when leaving then null else coalesce(p_to, p_from) end, p_fs, p_ts, p_lot, null, p_unit, p_wo, null, null, null, p_actor, p_reason, p_key, p_detail);
    n := 1;
  end if;
  return n;
end $$;
revoke execute on function public._mfg_move(uuid, uuid, uuid, uuid, text, text, numeric, uuid[], uuid, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;

-- move stock between locations (state kept)
create or replace function public.mfg_move(p_item uuid, p_from uuid, p_to uuid, p_qty numeric, p_lot uuid default null, p_serials uuid[] default null, p_state text default 'Available', p_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); n int;
begin
  perform public._mfg_need(me, 'inventory_manager', 'Moving stock');
  if public._mfg_item(me, p_item) is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if p_from = p_to then raise exception 'Choose another location' using errcode = '22023'; end if;
  perform public._mfg_location(p_to);
  if p_state not in ('Available', 'Allocated', 'Quarantine', 'Inspection', 'Rejected') then raise exception 'Unknown state' using errcode = '22023'; end if;
  n := public._mfg_move(p_item, p_from, p_to, p_lot, p_state, p_state, p_qty, p_serials, me, 'move', 'Moved', p_key);
  -- an allocation follows its stock to the new location
  if p_state = 'Allocated' then
    update public.mfg_allocs set location_id = p_to where item_id = p_item and location_id = p_from and status = 'active' and lot_id is not distinct from p_lot
      and (p_serials is null or serial_id = any (p_serials));
  end if;
  perform public._mfg_audit(me, 'movement', p_item, null, jsonb_build_object('from', p_from, 'to', p_to, 'qty', coalesce(p_qty, n), 'state', p_state));
  return jsonb_build_object('ok', true, 'moved', coalesce(p_qty, n));
end $$;
revoke execute on function public.mfg_move(uuid, uuid, uuid, numeric, uuid, uuid[], text, text) from public, anon;
grant execute on function public.mfg_move(uuid, uuid, uuid, numeric, uuid, uuid[], text, text) to authenticated;

-- change the state of stock: inspection outcome (Quality Inspector), quarantine release (Quality Approver),
-- rejection, return to vendor, scrap
create or replace function public.mfg_set_state(p_item uuid, p_location uuid, p_from text, p_to text, p_qty numeric, p_lot uuid default null, p_serials uuid[] default null, p_reason text default null,
  p_inspection uuid default null, p_key text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); n int; kind text;
begin
  if public._mfg_item(me, p_item) is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if p_from not in ('Inspection', 'Quarantine', 'Rejected', 'Available') or p_to not in ('Available', 'Quarantine', 'Rejected', 'Returned', 'Scrap', 'Inspection') or p_from = p_to then
    raise exception 'This state change is not possible (% → %)', p_from, p_to using errcode = '22023';
  end if;
  if p_from = 'Inspection' or p_to in ('Inspection', 'Rejected') then perform public._mfg_need(me, 'quality_inspector', 'Recording an inspection outcome on stock');
  elsif p_from = 'Quarantine' and p_to = 'Available' then perform public._mfg_need(me, 'quality_approver', 'Releasing stock from quarantine');
  elsif p_to = 'Scrap' then
    if not (public.has_cap(me, 'quality_approver') or public.has_cap(me, 'inventory_manager')) then perform public._mfg_need(me, 'quality_approver', 'Scrapping stock'); end if;
  else perform public._mfg_need(me, 'inventory_manager', 'Changing the state of stock'); end if;
  if p_to in ('Quarantine', 'Rejected', 'Returned', 'Scrap') and length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason (at least 5 characters)' using errcode = '23514'; end if;
  kind := case p_to when 'Returned' then 'return' when 'Scrap' then 'scrap' when 'Available' then case when p_from = 'Inspection' then 'inspect' else 'state' end else case when p_from = 'Inspection' then 'inspect' else 'state' end end;
  n := public._mfg_move(p_item, p_location, p_location, p_lot, p_from, p_to, p_qty, p_serials, me, kind, coalesce(p_reason, p_from || ' → ' || p_to), p_key, null, null,
    jsonb_strip_nulls(jsonb_build_object('inspection', p_inspection)));
  perform public._mfg_audit(me, 'inventory_state', p_item, null, jsonb_strip_nulls(jsonb_build_object('from', p_from, 'to', p_to, 'qty', coalesce(p_qty, n), 'location', p_location, 'inspection', p_inspection, 'reason', p_reason)));
  return jsonb_build_object('ok', true, 'qty', coalesce(p_qty, n), 'state', p_to);
end $$;
revoke execute on function public.mfg_set_state(uuid, uuid, text, text, numeric, uuid, uuid[], text, uuid, text) from public, anon;
grant execute on function public.mfg_set_state(uuid, uuid, text, text, numeric, uuid, uuid[], text, uuid, text) to authenticated;

-- an adjustment (counted quantity) of non-serialized stock: Inventory Manager, with the reason
create or replace function public.mfg_adjust(p_item uuid, p_location uuid, p_state text, p_counted numeric, p_reason text, p_lot uuid default null, p_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); it public.records; cur numeric; delta numeric;
begin
  perform public._mfg_need(me, 'inventory_manager', 'Adjusting inventory');
  it := public._mfg_item(me, p_item);
  if it.id is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if coalesce((it.data->>'serialized')::boolean, false) then raise exception 'Serialized stock is corrected serial by serial (receive, state, scrap), not by a count' using errcode = '22023'; end if;
  if p_state not in ('Available', 'Quarantine', 'Inspection', 'Rejected') then raise exception 'Allocated stock is changed by releasing the allocation, not by an adjustment' using errcode = '22023'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'The counted quantity cannot be negative' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason for the adjustment (at least 5 characters)' using errcode = '23514'; end if;
  perform public._mfg_location(p_location);
  perform public._mfg_lock_item(p_item);
  if p_key is not null and public._mfg_seen_key(p_key) then raise exception 'This adjustment was recorded already' using errcode = '23505'; end if;
  select coalesce(sum(qty), 0) into cur from public.mfg_stock where item_id = p_item and location_id = p_location and lot_id is not distinct from p_lot and state = p_state;
  delta := p_counted - cur;
  if delta = 0 then return jsonb_build_object('ok', true, 'delta', 0); end if;
  if delta > 0 then perform public._mfg_stock_add(p_item, p_location, p_lot, p_state, delta); else perform public._mfg_stock_take(p_item, p_location, p_lot, p_state, -delta); end if;
  perform public._mfg_txn('adjust', p_item, abs(delta), case when delta < 0 then p_location end, case when delta > 0 then p_location end, case when delta < 0 then p_state end, case when delta > 0 then p_state end,
    p_lot, null, null, null, null, null, null, me, trim(p_reason), p_key, jsonb_build_object('before', cur, 'after', p_counted));
  perform public._mfg_audit(me, 'inventory_adjustment', p_item, null, jsonb_build_object('location', p_location, 'state', p_state, 'before', cur, 'after', p_counted, 'reason', left(trim(p_reason), 300)));
  return jsonb_build_object('ok', true, 'delta', delta, 'before', cur, 'after', p_counted);
end $$;
revoke execute on function public.mfg_adjust(uuid, uuid, text, numeric, text, uuid, text) from public, anon;
grant execute on function public.mfg_adjust(uuid, uuid, text, numeric, text, uuid, text) to authenticated;

-- an opening balance (initial inventory import): Inventory Manager; a serialized item comes with its serials
create or replace function public._mfg_opening(p_actor uuid, p_item uuid, p_location uuid, p_qty numeric, p_state text, p_lot jsonb, p_serials text[], p_batch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it public.records; lot uuid; s text; sid uuid;
begin
  select * into it from public.records where id = p_item and section = 'technical.items';
  perform public._mfg_lock_item(p_item);
  if coalesce(p_lot->>'lot_no', '') <> '' then
    insert into public.mfg_lots(item_id, lot_no, manufacturer, manufactured, received, expires, qty_received, created_by)
    values (p_item, trim(p_lot->>'lot_no'), nullif(p_lot->>'manufacturer', ''), public._mfg_date(p_lot->>'manufactured'), public._mfg_date(p_lot->>'received'), public._mfg_date(p_lot->>'expires'), p_qty, p_actor)
    on conflict (item_id, lot_no) do update set qty_received = public.mfg_lots.qty_received + excluded.qty_received returning id into lot;
  end if;
  if coalesce((it.data->>'serialized')::boolean, false) then
    if coalesce(cardinality(p_serials), 0) <> p_qty then raise exception 'Item %: one serial number per unit', it.data->>'number' using errcode = '22023'; end if;
    foreach s in array p_serials loop
      insert into public.mfg_serials(item_id, serial, lot_id, location_id, state, created_by) values (p_item, trim(s), lot, p_location, p_state, p_actor) returning id into sid;
      perform public._mfg_txn('opening', p_item, 1, null, p_location, null, p_state, lot, sid, null, null, null, null, null, p_actor, 'Opening balance', null, jsonb_build_object('import', p_batch));
    end loop;
  else
    perform public._mfg_txn('opening', p_item, p_qty, null, p_location, null, p_state, lot, null, null, null, null, null, null, p_actor, 'Opening balance', null, jsonb_build_object('import', p_batch));
  end if;
  perform public._mfg_stock_add(p_item, p_location, lot, p_state, p_qty);
end $$;
revoke execute on function public._mfg_opening(uuid, uuid, uuid, numeric, text, jsonb, text[], uuid) from public, anon, authenticated;

/* ----- allocation ----- */
create or replace function public._mfg_release_alloc(p_alloc uuid, p_actor uuid, p_reason text) returns numeric language plpgsql security definer set search_path = public as $$
declare a public.mfg_allocs; rem numeric;
begin
  select * into a from public.mfg_allocs where id = p_alloc for update;
  if not found or a.status <> 'active' then return 0; end if;
  perform public._mfg_lock_item(a.item_id);
  rem := a.qty - a.qty_consumed;
  if rem > 0 then
    if a.serial_id is not null then
      perform public._mfg_move(a.item_id, a.location_id, a.location_id, a.lot_id, 'Allocated', 'Available', null, array[a.serial_id], p_actor, 'release', p_reason, null, a.unit_id, a.wo_id);
    else
      perform public._mfg_move(a.item_id, a.location_id, a.location_id, a.lot_id, 'Allocated', 'Available', rem, null, p_actor, 'release', p_reason, null, a.unit_id, a.wo_id);
    end if;
  end if;
  update public.mfg_allocs set status = case when a.qty_consumed > 0 then 'consumed' else 'released' end, closed_by = p_actor, closed_at = now(), close_reason = left(p_reason, 500) where id = a.id;
  perform public._mfg_audit(p_actor, 'allocation_released', a.item_id, a.unit_id, jsonb_build_object('allocation', a.id, 'qty', rem, 'reason', left(p_reason, 300)));
  return rem;
end $$;
revoke execute on function public._mfg_release_alloc(uuid, uuid, text) from public, anon, authenticated;

-- allocate free stock to a unit (and optionally its work order) or to a project: transactional, never twice the same
-- stock, never more than the unit still needs (unless an Inventory Manager gives the reason)
create or replace function public.mfg_allocate(p_target jsonb, p_item uuid, p_qty numeric, p_location uuid default null, p_lot uuid default null, p_serials uuid[] default null, p_reason text default null, p_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); it public.records; u public.records; wo public.records; prj public.records; need numeric; x record; left_q numeric; take numeric; aid uuid; ids jsonb := '[]'::jsonb;
  sid uuid; sr public.mfg_serials; ser boolean;
begin
  if not (public.has_cap(me, 'build_manager') or public.has_cap(me, 'inventory_manager') or public.has_cap(me, 'work_order_manager')) then perform public._mfg_need(me, 'inventory_manager', 'Allocating material'); end if;
  it := public._mfg_item(me, p_item);
  if it.id is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  ser := coalesce((it.data->>'serialized')::boolean, false);
  if p_target ? 'work_order' then
    wo := public._mfg_rec(me, public.as_uuid(p_target->>'work_order'), 'operations.work_orders', 'Work order');
    if wo.status in ('Completed', 'Cancelled') then raise exception 'The work order is %', wo.status using errcode = '55000'; end if;
    u := public._mfg_unit(me, public.as_uuid(wo.data->>'build_ref'));
  elsif p_target ? 'unit' then u := public._mfg_unit(me, public.as_uuid(p_target->>'unit'));
  elsif p_target ? 'project' then prj := public._mfg_rec(me, public.as_uuid(p_target->>'project'), 'company.projects', 'Project');
  else raise exception 'Allocate to a build unit, a work order or a project' using errcode = '22023'; end if;
  if u.id is not null and public.mfg_status_kind(u.status) in ('done', 'cancelled') then raise exception 'The unit is %', u.status using errcode = '55000'; end if;
  if ser then p_qty := coalesce(cardinality(p_serials), 0); end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Give a quantity above zero%', case when ser then ' (choose the serial numbers)' else '' end using errcode = '22023'; end if;
  perform public._mfg_lock_item(it.id);
  if p_key is not null and exists (select 1 from public.mfg_txns t where t.idem_key like 'alc:' || p_key || '%') then raise exception 'This allocation was recorded already' using errcode = '23505'; end if;
  if u.id is not null then
    select greatest(r.required - r.consumed - r.allocated, 0) into need from public._mfg_req(u.id, me) r where r.item_id = it.id;
    -- an approved alternate for this unit takes the place of the item it substitutes
    if need is null then
      select greatest(r.required - r.consumed - r.allocated, 0) into need from public._mfg_req(u.id, me) r where public._mfg_alt_ok(r.item_id, it.id, u) is not null limit 1;
    end if;
    if need is null then raise exception 'This item is not in the unit''s BOM revision (nor an approved alternate for it)' using errcode = '22023'; end if;
    if p_qty > need and (length(trim(coalesce(p_reason, ''))) < 5 or not public.has_cap(me, 'inventory_manager')) then
      raise exception 'The unit needs % more; allocating more needs an Inventory Manager and the reason', need using errcode = '23514';
    end if;
  end if;
  if ser then
    foreach sid in array p_serials loop
      select * into sr from public.mfg_serials where id = sid and item_id = it.id for update;
      if not found then raise exception 'Serial not found' using errcode = 'P0002'; end if;
      if sr.state <> 'Available' then raise exception 'Serial % is % — it cannot be allocated', sr.serial, sr.state using errcode = '23514'; end if;
      insert into public.mfg_allocs(item_id, qty, location_id, lot_id, serial_id, unit_id, wo_id, project_id, reason, created_by)
      values (it.id, 1, sr.location_id, sr.lot_id, sid, u.id, wo.id, coalesce(prj.id, public.as_uuid(u.data->>'project_ref')), left(p_reason, 500), me) returning id into aid;
      update public.mfg_serials set alloc_id = aid where id = sid;
      perform public._mfg_move(it.id, sr.location_id, sr.location_id, sr.lot_id, 'Available', 'Allocated', null, array[sid], me, 'allocate', 'Allocated', case when p_key is not null then 'alc:' || p_key || ':' || sid end, u.id, wo.id);
      update public.mfg_serials set alloc_id = aid where id = sid;
      ids := ids || to_jsonb(aid);
    end loop;
  else
    left_q := p_qty;
    for x in select s.* from public.mfg_stock s join public.mfg_locations l on l.id = s.location_id
             where s.item_id = it.id and s.state = 'Available' and s.qty > 0 and (p_location is null or s.location_id = p_location) and (p_lot is null or s.lot_id = p_lot)
             order by (select lt.expires from public.mfg_lots lt where lt.id = s.lot_id) nulls last, l.code for update of s loop
      exit when left_q <= 0;
      take := least(x.qty, left_q);
      insert into public.mfg_allocs(item_id, qty, location_id, lot_id, unit_id, wo_id, project_id, reason, created_by)
      values (it.id, take, x.location_id, x.lot_id, u.id, wo.id, coalesce(prj.id, public.as_uuid(u.data->>'project_ref')), left(p_reason, 500), me) returning id into aid;
      perform public._mfg_move(it.id, x.location_id, x.location_id, x.lot_id, 'Available', 'Allocated', take, null, me, 'allocate', 'Allocated', case when p_key is not null then 'alc:' || p_key || ':' || aid end, u.id, wo.id);
      left_q := left_q - take; ids := ids || to_jsonb(aid);
    end loop;
    if left_q > 0 then raise exception 'Only % free (Available) — % asked; stock allocated elsewhere is not free', p_qty - left_q, p_qty using errcode = '23514'; end if;
  end if;
  perform public._mfg_audit(me, 'allocation', it.id, u.id, jsonb_strip_nulls(jsonb_build_object('qty', p_qty, 'allocations', ids, 'work_order', wo.id, 'project', prj.id, 'reason', p_reason)));
  return jsonb_build_object('ok', true, 'allocations', ids, 'qty', p_qty);
end $$;
revoke execute on function public.mfg_allocate(jsonb, uuid, numeric, uuid, uuid, uuid[], text, text) from public, anon;
grant execute on function public.mfg_allocate(jsonb, uuid, numeric, uuid, uuid, uuid[], text, text) to authenticated;

create or replace function public.mfg_release(p_alloc uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); a public.mfg_allocs; q numeric;
begin
  if not (public.has_cap(me, 'build_manager') or public.has_cap(me, 'inventory_manager')) then perform public._mfg_need(me, 'inventory_manager', 'Releasing an allocation'); end if;
  select * into a from public.mfg_allocs where id = p_alloc;
  if not found or public._mfg_item(me, a.item_id) is null then raise exception 'Allocation not found' using errcode = 'P0002'; end if;
  if a.unit_id is not null then perform public._mfg_unit(me, a.unit_id); end if;
  if a.status <> 'active' then raise exception 'This allocation is %', a.status using errcode = '55000'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason (at least 5 characters)' using errcode = '23514'; end if;
  q := public._mfg_release_alloc(a.id, me, trim(p_reason));
  return jsonb_build_object('ok', true, 'released', q);
end $$;
revoke execute on function public.mfg_release(uuid, text) from public, anon;
grant execute on function public.mfg_release(uuid, text) to authenticated;

-- authorized reassignment: release from one unit and allocate to another in one transaction
create or replace function public.mfg_reassign(p_alloc uuid, p_unit uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); a public.mfg_allocs; q numeric; r jsonb;
begin
  perform public._mfg_need(me, 'build_manager', 'Reassigning material between units');
  select * into a from public.mfg_allocs where id = p_alloc;
  if not found or a.status <> 'active' then raise exception 'Allocation not found' using errcode = 'P0002'; end if;
  if a.unit_id is not null then perform public._mfg_unit(me, a.unit_id); end if;
  perform public._mfg_unit(me, p_unit);
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason (at least 5 characters)' using errcode = '23514'; end if;
  q := public._mfg_release_alloc(a.id, me, 'Reassigned: ' || trim(p_reason));
  r := public.mfg_allocate(jsonb_build_object('unit', p_unit), a.item_id, case when a.serial_id is null then q end, a.location_id, a.lot_id, case when a.serial_id is not null then array[a.serial_id] end, trim(p_reason));
  return jsonb_build_object('ok', true, 'released', q, 'allocated', r);
end $$;
revoke execute on function public.mfg_reassign(uuid, uuid, text) from public, anon;
grant execute on function public.mfg_reassign(uuid, uuid, text) to authenticated;

/* ----- consumption and installation (called by work order completion; checked as one transaction) ----- */
-- consume a quantity for a unit: from its allocations first; beyond them only with an Inventory Manager's reason
create or replace function public._mfg_consume(p_unit uuid, p_wo uuid, p_item uuid, p_qty numeric, p_actor uuid, p_reason text, p_key text, p_lot uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare a record; left_q numeric := p_qty; take numeric; s record; n int := 0;
begin
  perform public._mfg_lock_item(p_item);
  if p_key is not null and public._mfg_seen_key(p_key) then raise exception 'This consumption was recorded already' using errcode = '23505'; end if;
  for a in select * from public.mfg_allocs where unit_id = p_unit and item_id = p_item and status = 'active' and serial_id is null and (p_lot is null or lot_id = p_lot)
           order by (wo_id is not distinct from p_wo) desc, created_at for update loop
    exit when left_q <= 0;
    take := least(a.qty - a.qty_consumed, left_q);
    if take <= 0 then continue; end if;
    perform public._mfg_stock_take(p_item, a.location_id, a.lot_id, 'Allocated', take);
    update public.mfg_allocs set qty_consumed = qty_consumed + take, status = case when qty_consumed + take >= qty then 'consumed' else status end,
      closed_at = case when qty_consumed + take >= qty then now() end, closed_by = case when qty_consumed + take >= qty then p_actor end where id = a.id;
    perform public._mfg_txn('consume', p_item, take, a.location_id, null, 'Allocated', 'Consumed', a.lot_id, null, p_unit, p_wo, null, a.id, null, p_actor, coalesce(p_reason, 'Consumed'),
      case when p_key is not null then p_key || ':' || n end);
    left_q := left_q - take; n := n + 1;
  end loop;
  if left_q > 0 then
    if length(trim(coalesce(p_reason, ''))) < 5 or not public.has_cap(p_actor, 'inventory_manager') then
      raise exception 'Only % allocated to this unit — consuming % more than allocated needs an Inventory Manager and the reason', p_qty - left_q, left_q using errcode = '23514';
    end if;
    for s in select st.* from public.mfg_stock st join public.mfg_locations l on l.id = st.location_id where st.item_id = p_item and st.state = 'Available' and st.qty > 0 and (p_lot is null or st.lot_id = p_lot) order by l.code loop
      exit when left_q <= 0;
      take := least(s.qty, left_q);
      perform public._mfg_stock_take(p_item, s.location_id, s.lot_id, 'Available', take);
      perform public._mfg_txn('consume', p_item, take, s.location_id, null, 'Available', 'Consumed', s.lot_id, null, p_unit, p_wo, null, null, null, p_actor, 'Exception: ' || trim(p_reason),
        case when p_key is not null then p_key || ':' || n end, jsonb_build_object('exception', true));
      left_q := left_q - take; n := n + 1;
    end loop;
    if left_q > 0 then raise exception 'Not enough stock to consume % more (stock never goes negative)', left_q using errcode = '23514'; end if;
  end if;
  return p_qty;
end $$;
revoke execute on function public._mfg_consume(uuid, uuid, uuid, numeric, uuid, text, text, uuid) from public, anon, authenticated;

-- install a serial (or a significant non-serial item) in a unit: the exact serial; one active unit per serial
create or replace function public._mfg_install(p_unit uuid, p_wo uuid, p_item uuid, p_serial uuid, p_qty numeric, p_position text, p_actor uuid, p_doc_version uuid, p_config jsonb, p_key text, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sr public.mfg_serials; iid uuid; other text; a public.mfg_allocs;
begin
  perform public._mfg_lock_item(p_item);
  if p_serial is null then
    perform public._mfg_consume(p_unit, p_wo, p_item, coalesce(p_qty, 1), p_actor, p_reason, p_key);
    insert into public.mfg_installs(unit_id, item_id, qty, position, wo_id, installed_by, doc_version_id, config_data) values (p_unit, p_item, coalesce(p_qty, 1), left(p_position, 120), p_wo, p_actor, p_doc_version, p_config) returning id into iid;
    return iid;
  end if;
  select * into sr from public.mfg_serials where id = p_serial and item_id = p_item for update;
  if not found then raise exception 'Serial not found for this item' using errcode = 'P0002'; end if;
  if sr.state = 'Installed' or exists (select 1 from public.mfg_installs x where x.serial_id = sr.id and x.removed_at is null) then
    select coalesce(u.data->>'number', 'another unit') into other from public.mfg_installs x join public.records u on u.id = x.unit_id where x.serial_id = sr.id and x.removed_at is null;
    raise exception 'Serial % is installed in % already — one serial is installed in one unit at a time (remove it there first)', sr.serial, coalesce(other, 'another unit') using errcode = '23505';
  end if;
  if sr.state = 'Allocated' then
    select * into a from public.mfg_allocs where id = sr.alloc_id;
    if a.unit_id is distinct from p_unit then raise exception 'Serial % is allocated to another unit', sr.serial using errcode = '23514'; end if;
    perform public._mfg_stock_take(p_item, sr.location_id, sr.lot_id, 'Allocated', 1);
    update public.mfg_allocs set qty_consumed = 1, status = 'consumed', closed_at = now(), closed_by = p_actor where id = a.id;
  elsif sr.state = 'Available' then
    if length(trim(coalesce(p_reason, ''))) < 5 or not public.has_cap(p_actor, 'inventory_manager') then
      raise exception 'Serial % is not allocated to this unit — allocate it first (or an Inventory Manager gives the reason)', sr.serial using errcode = '23514';
    end if;
    perform public._mfg_stock_take(p_item, sr.location_id, sr.lot_id, 'Available', 1);
  else
    raise exception 'Serial % is % — it cannot be installed', sr.serial, sr.state using errcode = '23514';
  end if;
  update public.mfg_serials set state = 'Installed', unit_id = p_unit, alloc_id = null, updated_at = now() where id = sr.id;
  insert into public.mfg_installs(unit_id, item_id, serial_id, qty, position, wo_id, installed_by, doc_version_id, config_data)
  values (p_unit, p_item, sr.id, 1, left(p_position, 120), p_wo, p_actor, p_doc_version, p_config) returning id into iid;
  perform public._mfg_txn('install', p_item, 1, sr.location_id, null, sr.state, 'Installed', sr.lot_id, sr.id, p_unit, p_wo, null, sr.alloc_id, null, p_actor, coalesce(p_reason, 'Installed'), p_key,
    jsonb_strip_nulls(jsonb_build_object('position', p_position, 'install', iid)));
  return iid;
end $$;
revoke execute on function public._mfg_install(uuid, uuid, uuid, uuid, numeric, text, uuid, uuid, jsonb, text, text) from public, anon, authenticated;

-- take a serial out of a unit (rework, replacement): the history stays; never on an accepted unit
create or replace function public.mfg_remove(p_install uuid, p_reason text, p_to text default 'Quarantine', p_location uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); x public.mfg_installs; u public.records; sr public.mfg_serials; loc uuid;
begin
  if not (public.has_cap(me, 'work_order_manager') or public.has_cap(me, 'build_manager')) then perform public._mfg_need(me, 'work_order_manager', 'Removing an installed item'); end if;
  select * into x from public.mfg_installs where id = p_install for update;
  if not found or x.removed_at is not null then raise exception 'Installation not found' using errcode = 'P0002'; end if;
  u := public._mfg_unit(me, x.unit_id, true);
  if public._mfg_unit_done(u) then raise exception 'The unit is accepted or completed: it is not modified (record a change instead)' using errcode = '55000'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason (at least 5 characters)' using errcode = '23514'; end if;
  if p_to not in ('Quarantine', 'Available', 'Scrap', 'Rejected') then raise exception 'Unknown state' using errcode = '22023'; end if;
  perform public._mfg_lock_item(x.item_id);
  update public.mfg_installs set removed_at = now(), removed_by = me, removal_reason = left(trim(p_reason), 500) where id = x.id;
  loc := coalesce(p_location, public._mfg_default_location(case when p_to = 'Available' then 'Storage' else 'Quarantine' end), public._mfg_default_location('Storage'));
  if x.serial_id is not null then
    select * into sr from public.mfg_serials where id = x.serial_id for update;
    update public.mfg_serials set state = p_to, unit_id = null, location_id = case when p_to = 'Scrap' then location_id else loc end, updated_at = now() where id = sr.id;
    if p_to <> 'Scrap' then perform public._mfg_stock_add(x.item_id, loc, sr.lot_id, p_to, 1); end if;
    perform public._mfg_txn('remove', x.item_id, 1, null, case when p_to = 'Scrap' then null else loc end, 'Installed', p_to, sr.lot_id, sr.id, x.unit_id, x.wo_id, null, null, null, me, trim(p_reason), null, jsonb_build_object('install', x.id));
  else
    if p_to <> 'Scrap' then perform public._mfg_stock_add(x.item_id, loc, null, p_to, x.qty); end if;
    perform public._mfg_txn('remove', x.item_id, x.qty, null, case when p_to = 'Scrap' then null else loc end, 'Installed', p_to, null, null, x.unit_id, x.wo_id, null, null, null, me, trim(p_reason), null, jsonb_build_object('install', x.id));
  end if;
  perform public._mfg_audit(me, 'serial_removed', x.item_id, x.unit_id, jsonb_build_object('install', x.id, 'serial', x.serial_id, 'to', p_to, 'reason', left(trim(p_reason), 300)));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.mfg_remove(uuid, text, text, uuid) from public, anon;
grant execute on function public.mfg_remove(uuid, text, text, uuid) to authenticated;

/* ----- reading inventory (only items this person may open; allocations to units they may not open stay unnamed) ----- */
create or replace function public.mfg_inventory(p_q text default null, p_item uuid default null, p_location uuid default null, p_state text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); cost boolean; q text := lower(nullif(trim(coalesce(p_q, '')), ''));
begin
  if me is null or not public._mfg_can_read(me, 'technical.items') then raise exception 'Not allowed' using errcode = '42501'; end if;
  cost := public._mfg_cost_ok(me);
  return coalesce((select jsonb_agg(x order by x->>'item_number', x->>'location') from (
    select jsonb_strip_nulls(jsonb_build_object('item', i.id, 'item_number', i.data->>'number', 'item_title', i.title, 'mpn', i.data->>'mpn', 'uom', i.data->>'uom',
      'location_id', l.id, 'location', l.code, 'location_name', l.name, 'lot', lt.lot_no, 'lot_id', lt.id, 'expires', lt.expires, 'state', s.state, 'qty', s.qty,
      'value', case when cost and public._num(i.data->'ref_cost') is not null then round(s.qty * public._num(i.data->'ref_cost'), 2) end, 'currency', case when cost then i.data->>'currency' end)) x
    from public.mfg_stock s join public.records i on i.id = s.item_id join public.mfg_locations l on l.id = s.location_id left join public.mfg_lots lt on lt.id = s.lot_id
    where s.qty > 0 and (p_item is null or s.item_id = p_item) and (p_location is null or s.location_id = p_location) and (p_state is null or s.state = p_state)
      and (q is null or public.mfg_search_text(i.title, i.data) like '%' || q || '%' or lower(l.code) like '%' || q || '%' or lower(coalesce(lt.lot_no, '')) like '%' || q || '%')
      and public.record_visible_for(me, i)
    order by i.data->>'number', l.code limit greatest(1, least(coalesce(p_limit, 200), 1000))) z), '[]'::jsonb);
end $$;
revoke execute on function public.mfg_inventory(text, uuid, uuid, text, int) from public, anon;
grant execute on function public.mfg_inventory(text, uuid, uuid, text, int) to authenticated;

create or replace function public.mfg_item_stock(p_item uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); it public.records; cost boolean;
begin
  it := public._mfg_item(me, p_item);
  if it.id is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  cost := public._mfg_cost_ok(me);
  return jsonb_build_object('item', jsonb_build_object('id', it.id, 'number', it.data->>'number', 'title', it.title, 'mpn', it.data->>'mpn', 'manufacturer', it.data->>'manufacturer', 'type', it.data->>'item_type',
      'serialized', coalesce((it.data->>'serialized')::boolean, false), 'lot_controlled', coalesce((it.data->>'lot_controlled')::boolean, false), 'uom', it.data->>'uom',
      'ref_cost', case when cost then public._num(it.data->'ref_cost') end, 'currency', case when cost then it.data->>'currency' end),
    'by_state', coalesce((select jsonb_object_agg(state, q) from (select state, sum(qty) q from public.mfg_stock where item_id = it.id group by state) z), '{}'::jsonb),
    'stock', public.mfg_inventory(null, it.id, null, null, 500),
    'allocations', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'qty', a.qty, 'consumed', a.qty_consumed, 'location', l.code, 'serial', sr.serial, 'created_at', a.created_at,
        'unit', case when u.id is null then null when public.record_visible_for(me, u) then jsonb_build_object('id', u.id, 'number', u.data->>'number', 'title', u.title) else jsonb_build_object('hidden', true, 'title', 'A unit you may not open') end,
        'project', a.project_id) order by a.created_at)
      from public.mfg_allocs a join public.mfg_locations l on l.id = a.location_id left join public.records u on u.id = a.unit_id left join public.mfg_serials sr on sr.id = a.serial_id
      where a.item_id = it.id and a.status = 'active'), '[]'::jsonb),
    'serials', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'serial', s.serial, 'agron_serial', s.agron_serial, 'state', s.state, 'location', l.code,
        'unit', case when u.id is null then null else jsonb_build_object('id', u.id, 'number', u.data->>'number') end) order by s.serial)
      from public.mfg_serials s left join public.mfg_locations l on l.id = s.location_id left join public.records u on u.id = s.unit_id
      where s.item_id = it.id and (s.unit_id is null or public.record_visible_for(me, u))), '[]'::jsonb),
    'lots', coalesce((select jsonb_agg(jsonb_build_object('id', lt.id, 'lot', lt.lot_no, 'received', lt.received, 'expires', lt.expires, 'qty_received', lt.qty_received, 'manufacturer', lt.manufacturer,
        'remaining', (select coalesce(sum(s.qty), 0) from public.mfg_stock s where s.lot_id = lt.id),
        'units', (select count(distinct t.unit_id) from public.mfg_txns t where t.lot_id = lt.id and t.kind in ('consume', 'install'))) order by lt.received desc nulls last)
      from public.mfg_lots lt where lt.item_id = it.id), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', t.at, 'kind', t.kind, 'qty', t.qty, 'from', lf.code, 'to', lt2.code, 'from_state', t.from_state, 'to_state', t.to_state,
        'unit', case when u.id is not null and public.record_visible_for(me, u) then u.data->>'number' end, 'by', public._wf_name(t.actor), 'reason', t.reason)) order by t.at desc)
      from (select * from public.mfg_txns where item_id = it.id order by at desc limit 100) t left join public.mfg_locations lf on lf.id = t.from_location left join public.mfg_locations lt2 on lt2.id = t.to_location
      left join public.records u on u.id = t.unit_id), '[]'::jsonb));
end $$;
revoke execute on function public.mfg_item_stock(uuid) from public, anon;
grant execute on function public.mfg_item_stock(uuid) to authenticated;

-- serial search: a serial of an item this person may open, not installed in a unit they may not open
create or replace function public.mfg_serial_search(p_q text, p_limit int default 50) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); q text := lower(trim(coalesce(p_q, '')));
begin
  if me is null or not public._mfg_can_read(me, 'technical.items') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_strip_nulls(jsonb_build_object('id', s.id, 'serial', s.serial, 'agron_serial', s.agron_serial, 'state', s.state, 'item', i.id, 'item_number', i.data->>'number', 'item_title', i.title,
      'location', l.code, 'unit', u.id, 'unit_number', u.data->>'number')) x
    from public.mfg_serials s join public.records i on i.id = s.item_id left join public.mfg_locations l on l.id = s.location_id left join public.records u on u.id = s.unit_id
    where lower(s.serial || ' ' || coalesce(s.agron_serial, '')) like '%' || q || '%' and public.record_visible_for(me, i) and (s.unit_id is null or public.record_visible_for(me, u))
    order by s.serial limit greatest(1, least(coalesce(p_limit, 50), 200))) z), '[]'::jsonb);
end $$;
revoke execute on function public.mfg_serial_search(text, int) from public, anon;
grant execute on function public.mfg_serial_search(text, int) to authenticated;

create or replace function public.mfg_serial(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); s public.mfg_serials; i public.records; u public.records;
begin
  select * into s from public.mfg_serials where id = p_id;
  if not found then raise exception 'Serial not found' using errcode = 'P0002'; end if;
  i := public._mfg_item(me, s.item_id);
  select * into u from public.records where id = s.unit_id;
  if i.id is null or (u.id is not null and not public.record_visible_for(me, u)) then raise exception 'Serial not found' using errcode = 'P0002'; end if;
  return jsonb_strip_nulls(jsonb_build_object('id', s.id, 'serial', s.serial, 'agron_serial', s.agron_serial, 'state', s.state, 'condition', s.condition,
    'item', jsonb_build_object('id', i.id, 'number', i.data->>'number', 'title', i.title, 'mpn', i.data->>'mpn'),
    'location', (select code from public.mfg_locations where id = s.location_id), 'lot', (select lot_no from public.mfg_lots where id = s.lot_id),
    'supplier', (select v.title from public.records v where v.id = s.vendor_id and public.record_visible_for(me, v)),
    'purchase', (select p.data->>'number' from public.records p where p.id = s.purchase_id and public.record_visible_for(me, p)), 'receipt', s.receipt_id, 'received_at', s.created_at,
    'unit', case when u.id is not null then jsonb_build_object('id', u.id, 'number', u.data->>'number', 'title', u.title) end,
    'installs', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('unit', case when public.record_visible_for(me, x) then x.data->>'number' else 'A unit you may not open' end,
        'position', ins.position, 'installed_at', ins.installed_at, 'installed_by', public._wf_name(ins.installed_by), 'removed_at', ins.removed_at, 'removal_reason', ins.removal_reason)) order by ins.installed_at)
      from public.mfg_installs ins join public.records x on x.id = ins.unit_id where ins.serial_id = s.id), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', t.at, 'kind', t.kind, 'from_state', t.from_state, 'to_state', t.to_state, 'by', public._wf_name(t.actor), 'reason', t.reason)) order by t.at)
      from public.mfg_txns t where t.serial_id = s.id), '[]'::jsonb)));
end $$;
revoke execute on function public.mfg_serial(uuid) from public, anon;
grant execute on function public.mfg_serial(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   12. Work orders from the routing of the unit's configuration; exact instruction versions pinned; start and
       complete (materials consumed, serials installed, software, checklist, evidence) in one transaction; the
       shop floor queue. Event times are operational facts, never a productivity score.
   --------------------------------------------------------------------------------------------- */
-- the approved (effective) version of a controlled document now, or null
create or replace function public._mfg_doc_current(p_doc uuid) returns uuid language sql stable security definer set search_path = public as $$
  select v.id from public.document_versions v join public.records d on d.id = v.record_id
  where v.record_id = p_doc and v.approval_state = 'approved' and v.superseded_at is null
  order by v.major desc, v.minor desc limit 1
$$;
revoke execute on function public._mfg_doc_current(uuid) from public, anon, authenticated;

create or replace function public._mfg_evidence_count(p_section text, p_id uuid) returns int language plpgsql stable security definer set search_path = public as $$
declare n int := 0;
begin
  if to_regclass('storage.objects') is null then return 0; end if;
  execute 'select count(*) from storage.objects where bucket_id = ''files'' and name like $1' into n using p_section || '/' || p_id::text || '/%';
  return n;
end $$;
revoke execute on function public._mfg_evidence_count(text, uuid) from public, anon, authenticated;

-- the routing of a unit: its configuration's, otherwise its product's (configuration data, never code)
create or replace function public._mfg_routing(u public.records) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(nullif(c.data->'routing', '[]'::jsonb), nullif(p.data->'routing', '[]'::jsonb), '[]'::jsonb)
  from (select 1) one left join public.records c on c.id = public.as_uuid(u.data->>'config_ref') left join public.records p on p.id = public.as_uuid(u.data->>'product_ref')
$$;
revoke execute on function public._mfg_routing(public.records) from public, anon, authenticated;

create or replace function public._mfg_wo_insert(u public.records, p_actor uuid, st jsonb, p_status text, p_extra jsonb) returns public.records language plpgsql security definer set search_path = public as $$
declare w public.records; doc public.records; dv uuid; docs jsonb := '[]'::jsonb; x jsonb; lbl text;
begin
  for x in select * from jsonb_array_elements(case when jsonb_typeof(st->'documents') = 'array' then st->'documents' else '[]'::jsonb end) loop
    select * into doc from public.records where id = public.as_uuid(x->>'doc_ref') and section = 'company.documents';
    if not found then continue; end if;
    dv := coalesce(public.as_uuid(x->>'doc_version'), public._mfg_doc_current(doc.id));
    select label into lbl from public.document_versions where id = dv;
    docs := docs || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('doc_ref', doc.id, 'title', doc.title, 'doc_number', doc.data->>'doc_number', 'kind', x->>'kind', 'version_id', dv, 'version', lbl)));
  end loop;
  insert into public.records(section, title, status, controlled, created_by, data)
  values ('operations.work_orders', left(coalesce(st->>'name', st->>'operation', 'Work') || ' — ' || coalesce(u.data->>'number', u.title), 300), p_status, u.controlled, p_actor,
    jsonb_strip_nulls(jsonb_build_object('build_ref', u.id, 'build_ref_title', coalesce(u.data->>'number', u.title), 'project_ref', u.data->>'project_ref', 'project_ref_title', u.data->>'project_ref_title',
      'routing_key', st->>'key', 'operation', coalesce(st->>'operation', st->>'name'), 'assembly', st->>'assembly', 'sequence', public._num(st->'seq'), 'team', st->>'team',
      'assignee_id', public.as_uuid(st->>'assignee_id'), 'assignee', case when public.as_uuid(st->>'assignee_id') is not null then public._wf_name(public.as_uuid(st->>'assignee_id')) end,
      'planned', st->>'planned', 'instructions', left(st->>'instructions', 8000), 'tools', left(st->>'tools', 2000),
      'materials', case when jsonb_typeof(st->'materials') = 'array' then st->'materials' end, 'checklist', case when jsonb_typeof(st->'checklist') = 'array' then st->'checklist' end,
      'inspection_required', case when coalesce(st->>'inspection', '') <> '' then st->>'inspection' end, 'evidence_required', case when coalesce((st->>'evidence')::boolean, false) then true end,
      'documents', case when jsonb_array_length(docs) > 0 then docs end,
      'doc_version_id', case when jsonb_array_length(docs) > 0 then docs->0->>'version_id' end)) || coalesce(p_extra, '{}'::jsonb))
  returning * into w;
  return w;
end $$;
revoke execute on function public._mfg_wo_insert(public.records, uuid, jsonb, text, jsonb) from public, anon, authenticated;

-- the work orders of a released unit, from its routing (once per routing step); prerequisites become links
create or replace function public.mfg_wo_generate(p_unit uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; rt jsonb; st jsonb; w public.records; made int := 0; keys jsonb := '{}'::jsonb; k text; pre jsonb;
begin
  if not (public.has_cap(me, 'work_order_manager') or public.has_cap(me, 'build_manager')) then perform public._mfg_need(me, 'work_order_manager', 'Creating work orders'); end if;
  u := public._mfg_unit(me, p_unit, true);
  if coalesce(u.data->>'released_at', '') = '' then raise exception 'Release the unit first (its configuration and BOM revision are pinned at release)' using errcode = '23514'; end if;
  if public._mfg_unit_done(u) then raise exception 'The unit is %', u.status using errcode = '55000'; end if;
  rt := public._mfg_routing(u);
  if jsonb_array_length(rt) = 0 then raise exception 'The configuration has no routing (Manufacturing → Products → configuration → Routing)' using errcode = '23514'; end if;
  select coalesce(jsonb_object_agg(r.data->>'routing_key', r.id), '{}'::jsonb) into keys from public.records r
   where r.section = 'operations.work_orders' and r.data->>'build_ref' = u.id::text and coalesce(r.data->>'routing_key', '') <> '' and r.status <> 'Cancelled';
  for st in select * from jsonb_array_elements(rt) order by coalesce(public._num(value->'seq'), 0) loop
    if keys ? (st->>'key') then continue; end if;
    w := public._mfg_wo_insert(u, me, st, case when jsonb_array_length(coalesce(st->'prerequisites', '[]'::jsonb)) = 0 then 'Ready' else 'Planned' end, null);
    keys := keys || jsonb_build_object(st->>'key', w.id); made := made + 1;
  end loop;
  -- the prerequisites as work order links (a step names the keys of the steps before it)
  for st in select * from jsonb_array_elements(rt) loop
    pre := '[]'::jsonb;
    for k in select jsonb_array_elements_text(coalesce(st->'prerequisites', '[]'::jsonb)) loop
      if keys ? k then pre := pre || to_jsonb(keys->>k); end if;
    end loop;
    update public.records set data = data || jsonb_build_object('prerequisites', pre) where id = (keys->>(st->>'key'))::uuid and data->'prerequisites' is distinct from pre;
  end loop;
  perform public._mfg_audit(me, 'work_orders_created', u.id, u.id, jsonb_build_object('created', made));
  return jsonb_build_object('ok', true, 'created', made);
end $$;
revoke execute on function public.mfg_wo_generate(uuid) from public, anon;
grant execute on function public.mfg_wo_generate(uuid) to authenticated;

-- a work order outside the routing (extra work, rework is made from a nonconformance)
create or replace function public.mfg_wo_create(p_unit uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; w public.records;
begin
  if not (public.has_cap(me, 'work_order_manager') or public.has_cap(me, 'build_manager')) then perform public._mfg_need(me, 'work_order_manager', 'Creating work orders'); end if;
  u := public._mfg_unit(me, p_unit, true);
  if public._mfg_unit_done(u) then raise exception 'The unit is %', u.status using errcode = '55000'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name the operation' using errcode = '22023'; end if;
  if public.as_uuid(p->>'assignee_id') is not null and not public.is_active_employee(public.as_uuid(p->>'assignee_id')) then raise exception 'Work goes to an active employee' using errcode = '23514'; end if;
  w := public._mfg_wo_insert(u, me, p, 'Ready', null);
  return jsonb_build_object('id', w.id, 'number', w.data->>'number');
end $$;
revoke execute on function public.mfg_wo_create(uuid, jsonb) from public, anon;
grant execute on function public.mfg_wo_create(uuid, jsonb) to authenticated;

create or replace function public._mfg_wo_actor_ok(p_uid uuid, w public.records) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(w.data->>'assignee_id', '') = p_uid::text or coalesce(w.data->'team_ids', '[]'::jsonb) ? p_uid::text
      or (coalesce(w.data->>'assignee_id', '') = '' and public._mfg_can_write(p_uid, 'operations.work_orders'))
      or public.has_cap(p_uid, 'work_order_manager')
$$;
revoke execute on function public._mfg_wo_actor_ok(uuid, public.records) from public, anon, authenticated;

-- the prerequisites of a work order that are not completed yet
create or replace function public._mfg_wo_open_prereqs(w public.records) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'number', p.data->>'number', 'title', p.title, 'status', p.status)), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(w.data->'prerequisites', '[]'::jsonb)) x join public.records p on p.id = public.as_uuid(x)
  where p.status not in ('Completed', 'Cancelled')
$$;
revoke execute on function public._mfg_wo_open_prereqs(public.records) from public, anon, authenticated;

create or replace function public.mfg_wo_start(p_wo uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); w public.records; u public.records; pre jsonb; k text;
begin
  w := public._mfg_rec(me, p_wo, 'operations.work_orders', 'Work order', true);
  if not public._mfg_wo_actor_ok(me, w) then raise exception 'This work order is assigned to someone else (a Work Order Manager can reassign it)' using errcode = '42501'; end if;
  if w.status <> 'Ready' then raise exception 'Only a Ready work order is started (this one is %)', w.status using errcode = '55000'; end if;
  pre := public._mfg_wo_open_prereqs(w);
  if jsonb_array_length(pre) > 0 then raise exception 'Complete the earlier work first: %', (select string_agg(coalesce(x->>'number', x->>'title') || ' (' || (x->>'status') || ')', ', ') from jsonb_array_elements(pre) x) using errcode = '23514'; end if;
  u := public._mfg_unit(me, public.as_uuid(w.data->>'build_ref'));
  if coalesce(u.data->>'released_at', '') = '' then raise exception 'The unit is not released' using errcode = '23514'; end if;
  k := public.mfg_status_kind(u.status);
  if k in ('done', 'cancelled', 'hold') or (k = 'open' and u.status <> 'Ready for Build') then raise exception 'The unit is % — work starts when it is Ready for Build or in build', u.status using errcode = '23514'; end if;
  perform public._mfg_sys_patch(w.id, 'In Progress', jsonb_build_object('started_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'started_by', public._wf_name(me), 'started_by_id', me,
    'actual_start', to_char(current_date, 'YYYY-MM-DD')));
  perform public._mfg_audit(me, 'work_started', w.id, u.id, jsonb_build_object('operation', w.data->>'operation'));
  return jsonb_build_object('ok', true, 'status', 'In Progress');
end $$;
revoke execute on function public.mfg_wo_start(uuid) from public, anon;
grant execute on function public.mfg_wo_start(uuid) to authenticated;

-- software installed on a unit (a newer version of the same component supersedes the earlier one; nothing is lost)
create or replace function public._mfg_software_add(p_unit uuid, p_actor uuid, p_wo uuid, x jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; cur uuid;
begin
  if coalesce(trim(x->>'component'), '') = '' or coalesce(trim(x->>'version'), '') = '' then raise exception 'Software: give the component and its version' using errcode = '22023'; end if;
  -- no credential or secret is stored with a configuration (the same check as process data)
  perform public.ops_secret_check(jsonb_build_object('config_ref', x->>'config_ref', 'notes', x->>'notes', 'version', x->>'version', 'checksum', x->>'checksum'));
  if concat_ws(' ', x->>'config_ref', x->>'notes', x->>'version') ~* '((password|passwd|secret|token|api[_ -]?key)\s*[:=]|BEGIN [A-Z ]*PRIVATE KEY)' then
    raise exception 'Software record: credentials and secrets are not stored in Workspace (keep them in the vault; record only the profile reference)' using errcode = '22023';
  end if;
  select s.id into cur from public.mfg_software s where s.unit_id = p_unit and s.component = trim(x->>'component') and s.superseded_at is null order by s.installed_at desc limit 1 for update;
  insert into public.mfg_software(unit_id, component, version, installer, checksum, config_ref, notes, wo_id)
  values (p_unit, trim(x->>'component'), trim(x->>'version'), p_actor, nullif(trim(x->>'checksum'), ''), nullif(left(x->>'config_ref', 300), ''), nullif(left(x->>'notes', 1000), ''), p_wo) returning mfg_software.id into v_id;
  if cur is not null then update public.mfg_software set superseded_at = now(), superseded_by = v_id where mfg_software.id = cur; end if;
  perform public._mfg_audit(p_actor, 'software_installed', p_wo, p_unit, jsonb_build_object('component', trim(x->>'component'), 'version', trim(x->>'version'), 'supersedes', cur));
  return v_id;
end $$;
revoke execute on function public._mfg_software_add(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.mfg_software_install(p_unit uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; v_id uuid;
begin
  if not (public.has_cap(me, 'work_order_manager') or public.has_cap(me, 'build_manager') or public._mfg_can_write(me, 'operations.work_orders')) then raise exception 'You cannot record software on units' using errcode = '42501'; end if;
  u := public._mfg_unit(me, p_unit, true);
  if public._mfg_unit_done(u) then raise exception 'The unit is accepted or completed: it is not modified' using errcode = '55000'; end if;
  v_id := public._mfg_software_add(u.id, me, public.as_uuid(p->>'work_order'), p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke execute on function public.mfg_software_install(uuid, jsonb) from public, anon;
grant execute on function public.mfg_software_install(uuid, jsonb) to authenticated;

-- complete a work order: checklist, materials consumed, serials installed, software, evidence — all or nothing
create or replace function public.mfg_wo_complete(p_wo uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); w public.records; u public.records; x jsonb; it public.records; sid uuid; iid uuid; done jsonb := '{}'::jsonb; c jsonb; miss text[] := '{}';
  cons jsonb := '[]'::jsonb; inst jsonb := '[]'::jsonb; soft jsonb := '[]'::jsonb; key text := nullif(p->>'key', ''); k int := 0; insp uuid; dep public.records; n int;
begin
  w := public._mfg_rec(me, p_wo, 'operations.work_orders', 'Work order', true);
  if not public._mfg_wo_actor_ok(me, w) then raise exception 'This work order is assigned to someone else' using errcode = '42501'; end if;
  if w.status = 'Completed' then raise exception 'This work order is completed already' using errcode = '23505'; end if;
  if w.status <> 'In Progress' then raise exception 'Start the work order first (it is %)', w.status using errcode = '55000'; end if;
  u := public._mfg_unit(me, public.as_uuid(w.data->>'build_ref'), true);
  -- the checklist of the step: every required item ticked (with its note)
  for x in select * from jsonb_array_elements(coalesce(p->'checklist', '[]'::jsonb)) loop
    done := done || jsonb_build_object(x->>'key', jsonb_build_object('done', coalesce((x->>'done')::boolean, false), 'note', left(x->>'note', 500)));
  end loop;
  for c in select * from jsonb_array_elements(coalesce(w.data->'checklist', '[]'::jsonb)) loop
    if coalesce((c->>'required')::boolean, true) and not coalesce((done->(c->>'key')->>'done')::boolean, false) then miss := array_append(miss, coalesce(c->>'text', c->>'key')); end if;
  end loop;
  if cardinality(miss) > 0 then raise exception 'Complete the checklist first: %', array_to_string(miss, '; ') using errcode = '23514'; end if;
  if coalesce((w.data->>'evidence_required')::boolean, false) and public._mfg_evidence_count('operations.work_orders', w.id) = 0 then
    raise exception 'This step needs evidence: attach a photo or a file to the work order first' using errcode = '23514';
  end if;
  -- materials consumed (from what is allocated to the unit)
  for x in select * from jsonb_array_elements(coalesce(p->'consumed', '[]'::jsonb)) loop
    it := public._mfg_item(me, public.as_uuid(x->>'item'));
    if it.id is null then raise exception 'Consumed item not found' using errcode = 'P0002'; end if;
    if coalesce((it.data->>'serialized')::boolean, false) then raise exception 'Item % is serialized: record it as installed with its serial number', it.data->>'number' using errcode = '22023'; end if;
    if public._num(x->'qty') is null or public._num(x->'qty') <= 0 then raise exception 'Consumed quantity must be above zero' using errcode = '22023'; end if;
    perform public._mfg_consume(u.id, w.id, it.id, public._num(x->'qty'), me, nullif(p->>'exception_reason', ''), case when key is not null then 'wo:' || key || ':c' || k end, public.as_uuid(x->>'lot'));
    cons := cons || jsonb_build_array(jsonb_build_object('item', it.id, 'number', it.data->>'number', 'qty', public._num(x->'qty')));
    k := k + 1;
  end loop;
  -- serials installed (the exact serial; one unit at a time)
  for x in select * from jsonb_array_elements(coalesce(p->'installed', '[]'::jsonb)) loop
    it := public._mfg_item(me, public.as_uuid(x->>'item'));
    if it.id is null then raise exception 'Installed item not found' using errcode = 'P0002'; end if;
    sid := null;
    if coalesce((it.data->>'serialized')::boolean, false) then
      sid := public.as_uuid(x->>'serial_id');
      if sid is null then select s.id into sid from public.mfg_serials s where s.item_id = it.id and s.serial = trim(coalesce(x->>'serial', '')); end if;
      if sid is null then raise exception 'Item % is serialized: give the exact serial number installed', it.data->>'number' using errcode = '22023'; end if;
    end if;
    iid := public._mfg_install(u.id, w.id, it.id, sid, public._num(x->'qty'), x->>'position', me, public.as_uuid(w.data->>'doc_version_id'), x->'config',
      case when key is not null then 'wo:' || key || ':i' || k end, nullif(p->>'exception_reason', ''));
    inst := inst || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('install', iid, 'item', it.id, 'number', it.data->>'number', 'serial', (select serial from public.mfg_serials where id = sid), 'position', x->>'position')));
    k := k + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'software', '[]'::jsonb)) loop
    soft := soft || to_jsonb(public._mfg_software_add(u.id, me, w.id, x));
  end loop;
  -- an inspection step leaves an inspection to be recorded (it is the inspector's, not the technician's)
  if coalesce(w.data->>'inspection_required', '') <> '' then
    insert into public.records(section, title, status, controlled, created_by, data)
    values ('operations.quality', left('Inspection — ' || coalesce(w.data->>'operation', w.title) || ' — ' || coalesce(u.data->>'number', u.title), 300), 'Planned', u.controlled, me,
      jsonb_strip_nulls(jsonb_build_object('inspection_kind', case when w.data->>'inspection_required' in ('Final Inspection', 'Final') then 'Final Inspection' else 'In-Process Inspection' end,
        'build_ref', u.id, 'build_ref_title', coalesce(u.data->>'number', u.title), 'work_order_ref', w.id, 'work_order_ref_title', coalesce(w.data->>'number', w.title),
        'build', coalesce(u.data->>'number', u.title), 'check_type', 'In-process', 'checklist', w.data->'inspection_checklist',
        'reinspection_of', w.data->>'reinspection_of', 'issue_ref', w.data->>'rework_of')))
    returning id into insp;
  end if;
  perform public._mfg_sys_patch(w.id, 'Completed', jsonb_strip_nulls(jsonb_build_object('completed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'completed_by', public._wf_name(me), 'completed_by_id', me,
    'actual_date', to_char(current_date, 'YYYY-MM-DD'), 'result', coalesce(nullif(p->>'result', ''), 'Done'), 'notes_completion', left(p->>'notes', 4000), 'checklist_result', done,
    'consumed', case when jsonb_array_length(cons) > 0 then cons end, 'installed', case when jsonb_array_length(inst) > 0 then inst end,
    'software_ids', case when jsonb_array_length(soft) > 0 then soft end, 'inspection_ref', insp, 'exception_reason', nullif(p->>'exception_reason', ''))));
  -- the next steps become Ready when all their earlier work is done
  for dep in select r.* from public.records r where r.section = 'operations.work_orders' and r.data->>'build_ref' = u.id::text and r.status = 'Planned' and coalesce(r.data->'prerequisites', '[]'::jsonb) ? w.id::text loop
    if jsonb_array_length(public._mfg_wo_open_prereqs(dep)) = 0 then perform public._mfg_sys_patch(dep.id, 'Ready', null); end if;
  end loop;
  perform public._mfg_audit(me, 'work_completed', w.id, u.id, jsonb_strip_nulls(jsonb_build_object('consumed', cons, 'installed', inst, 'software', soft, 'inspection', insp, 'exception', nullif(p->>'exception_reason', ''))));
  return jsonb_build_object('ok', true, 'status', 'Completed', 'consumed', cons, 'installed', inst, 'inspection', insp);
end $$;
revoke execute on function public.mfg_wo_complete(uuid, jsonb) from public, anon;
grant execute on function public.mfg_wo_complete(uuid, jsonb) to authenticated;

create or replace function public.mfg_wo_block(p_wo uuid, p_blocked boolean, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); w public.records; nxt text;
begin
  w := public._mfg_rec(me, p_wo, 'operations.work_orders', 'Work order', true);
  if not public._mfg_wo_actor_ok(me, w) then raise exception 'This work order is assigned to someone else' using errcode = '42501'; end if;
  if w.status in ('Completed', 'Cancelled') then raise exception 'The work order is %', w.status using errcode = '55000'; end if;
  if p_blocked then
    if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Say what blocks the work (at least 5 characters)' using errcode = '23514'; end if;
    perform public._mfg_sys_patch(w.id, 'Blocked', jsonb_build_object('blocked_reason', left(trim(p_reason), 500), 'blocked_from', w.status, 'blocked_at', now()));
  else
    if w.status <> 'Blocked' then return jsonb_build_object('ok', true); end if;
    nxt := case when w.data->>'started_at' is not null then 'In Progress' when jsonb_array_length(public._mfg_wo_open_prereqs(w)) = 0 then 'Ready' else 'Planned' end;
    perform public._mfg_sys_patch(w.id, nxt, jsonb_build_object('blocked_reason', null));
  end if;
  return jsonb_build_object('ok', true, 'status', case when p_blocked then 'Blocked' else nxt end);
end $$;
revoke execute on function public.mfg_wo_block(uuid, boolean, text) from public, anon;
grant execute on function public.mfg_wo_block(uuid, boolean, text) to authenticated;

-- move an open work order to the current approved version of its instruction (an explicit, recorded decision)
create or replace function public.mfg_wo_repin(p_wo uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); w public.records; docs jsonb := '[]'::jsonb; x jsonb; cur uuid; lbl text;
begin
  perform public._mfg_need(me, 'work_order_manager', 'Moving a work order to a new instruction version');
  w := public._mfg_rec(me, p_wo, 'operations.work_orders', 'Work order', true);
  if w.status in ('Completed', 'Cancelled') then raise exception 'A % work order keeps the instruction it used', lower(w.status) using errcode = '55000'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason (at least 5 characters)' using errcode = '23514'; end if;
  for x in select * from jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) loop
    cur := public._mfg_doc_current(public.as_uuid(x->>'doc_ref'));
    select label into lbl from public.document_versions where id = cur;
    docs := docs || jsonb_build_array(x || jsonb_strip_nulls(jsonb_build_object('version_id', cur, 'version', lbl, 'previous_version', x->>'version')));
  end loop;
  perform public._mfg_sys_patch(w.id, null, jsonb_build_object('documents', docs, 'doc_repinned_reason', left(trim(p_reason), 500)));
  update public.records set data = data || jsonb_build_object('doc_version_id', docs->0->>'version_id') where id = w.id and jsonb_array_length(docs) > 0;
  perform public._mfg_audit(me, 'instruction_repinned', w.id, public.as_uuid(w.data->>'build_ref'), jsonb_build_object('documents', docs, 'reason', left(trim(p_reason), 300)));
  return jsonb_build_object('ok', true, 'documents', docs);
end $$;
revoke execute on function public.mfg_wo_repin(uuid, text) from public, anon;
grant execute on function public.mfg_wo_repin(uuid, text) to authenticated;

-- the open work orders pinned to an older version of their instruction than the approved one now
create or replace function public._mfg_doc_stale(w public.records) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('doc', x->>'doc_ref', 'title', x->>'title', 'pinned', x->>'version', 'current', (select label from public.document_versions where id = public._mfg_doc_current(public.as_uuid(x->>'doc_ref'))))), '[]'::jsonb)
  from jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) x
  where public._mfg_doc_current(public.as_uuid(x->>'doc_ref')) is distinct from public.as_uuid(x->>'version_id')
$$;
revoke execute on function public._mfg_doc_stale(public.records) from public, anon, authenticated;

create or replace function public.mfg_doc_impact(p_doc uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); d public.records; cur uuid;
begin
  d := public._mfg_rec(me, p_doc, 'company.documents', 'Document');
  cur := public._mfg_doc_current(d.id);
  return jsonb_build_object('document', d.id, 'current_version', (select label from public.document_versions where id = cur),
    'work_orders', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'number', w.data->>'number', 'title', w.title, 'status', w.status, 'unit', w.data->>'build_ref_title',
        'pinned', (select x->>'version' from jsonb_array_elements(w.data->'documents') x where x->>'doc_ref' = d.id::text limit 1)) order by w.data->>'number')
      from public.records w where w.section = 'operations.work_orders' and w.status not in ('Completed', 'Cancelled')
        and exists (select 1 from jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) x where x->>'doc_ref' = d.id::text and public.as_uuid(x->>'version_id') is distinct from cur)
        and public.record_visible_for(me, w)), '[]'::jsonb),
    'note', 'Open work keeps the version it was given until a Work Order Manager moves it, with a reason. Completed work keeps the version it used.');
end $$;
revoke execute on function public.mfg_doc_impact(uuid) from public, anon;
grant execute on function public.mfg_doc_impact(uuid) to authenticated;

-- the shop floor: only what the person can act on (no values, no customer)
create or replace function public.mfg_queue() returns jsonb language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); insp boolean;
begin
  if me is null or not public._mfg_can_read(me, 'operations.work_orders') then raise exception 'Not allowed' using errcode = '42501'; end if;
  insp := public.has_cap(me, 'quality_inspector');
  create temp table if not exists mfg_q (id uuid, number text, title text, status text, unit text, unit_id uuid, operation text, planned text, mine boolean, done_today boolean, doc text, blocked_reason text, stale boolean) on commit drop;
  truncate mfg_q;
  insert into mfg_q
  select w.id, w.data->>'number', w.title, w.status, w.data->>'build_ref_title', public.as_uuid(w.data->>'build_ref'), w.data->>'operation', w.data->>'planned',
    coalesce(w.data->>'assignee_id', '') = me::text or coalesce(w.data->'team_ids', '[]'::jsonb) ? me::text,
    w.status = 'Completed' and left(coalesce(w.data->>'completed_at', ''), 10) = to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
    (select string_agg(coalesce(x->>'doc_number', x->>'title') || coalesce(' v' || (x->>'version'), ''), ', ') from jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) x),
    w.data->>'blocked_reason', jsonb_array_length(public._mfg_doc_stale(w)) > 0
  from public.records w
  where w.section = 'operations.work_orders' and (w.status in ('Ready', 'In Progress', 'Blocked', 'Planned') or (w.status = 'Completed' and left(coalesce(w.data->>'completed_at', ''), 10) = to_char(now() at time zone 'utc', 'YYYY-MM-DD')))
    and public.record_visible_for(me, w);
  return jsonb_build_object(
    'my_work', coalesce((select jsonb_agg(to_jsonb(q) order by q.planned nulls last, q.number) from mfg_q q where q.mine and q.status in ('Ready', 'In Progress', 'Blocked', 'Planned')), '[]'::jsonb),
    'ready', coalesce((select jsonb_agg(to_jsonb(q) order by q.planned nulls last, q.number) from mfg_q q where q.status = 'Ready'), '[]'::jsonb),
    'in_progress', coalesce((select jsonb_agg(to_jsonb(q) order by q.number) from mfg_q q where q.status = 'In Progress'), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(to_jsonb(q) order by q.number) from mfg_q q where q.status = 'Blocked'), '[]'::jsonb),
    'inspection_required', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.data->>'number', 'title', r.title, 'unit', r.data->>'build_ref_title', 'kind', r.data->>'inspection_kind', 'status', r.status) order by r.created_at)
       from public.records r where r.section = 'operations.quality' and r.data ? 'inspection_kind' and r.status in ('Planned', 'Inspection') and coalesce(r.data->>'recorded_at', '') = ''
         and (insp or coalesce(r.data->>'inspector_id', '') = me::text) and public.record_visible_for(me, r)), '[]'::jsonb),
    'completed_today', coalesce((select jsonb_agg(to_jsonb(q) order by q.number) from mfg_q q where q.done_today), '[]'::jsonb),
    'can_inspect', insp);
end $$;
revoke execute on function public.mfg_queue() from public, anon;
grant execute on function public.mfg_queue() to authenticated;

create or replace function public.mfg_wo(p_wo uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); w public.records; u public.records;
begin
  w := public._mfg_rec(me, p_wo, 'operations.work_orders', 'Work order');
  select * into u from public.records where id = public.as_uuid(w.data->>'build_ref');
  return jsonb_build_object('id', w.id, 'number', w.data->>'number', 'title', w.title, 'status', w.status, 'operation', w.data->>'operation', 'assembly', w.data->>'assembly',
    'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number', 'title', u.title, 'status', u.status),
    'assignee', w.data->>'assignee', 'assignee_id', w.data->>'assignee_id', 'planned', w.data->>'planned', 'instructions', w.data->>'instructions', 'tools', w.data->>'tools',
    'documents', coalesce(w.data->'documents', '[]'::jsonb), 'stale_documents', public._mfg_doc_stale(w), 'checklist', coalesce(w.data->'checklist', '[]'::jsonb),
    'checklist_result', w.data->'checklist_result', 'materials', coalesce(w.data->'materials', '[]'::jsonb), 'inspection_required', w.data->>'inspection_required',
    'evidence_required', coalesce((w.data->>'evidence_required')::boolean, false), 'evidence', public._mfg_evidence_count('operations.work_orders', w.id),
    'prerequisites_open', public._mfg_wo_open_prereqs(w), 'started_at', w.data->>'started_at', 'started_by', w.data->>'started_by', 'completed_at', w.data->>'completed_at', 'completed_by', w.data->>'completed_by',
    'consumed', w.data->'consumed', 'installed', w.data->'installed', 'blocked_reason', w.data->>'blocked_reason', 'rework_of', w.data->>'rework_of',
    'can_act', public._mfg_wo_actor_ok(me, w),
    -- what is allocated to this unit for the step's materials, and the serials allocated to it (to choose from)
    'allocated', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('alloc', a.id, 'item', i.id, 'number', i.data->>'number', 'title', i.title, 'qty', a.qty - a.qty_consumed, 'serial_id', a.serial_id,
        'serial', (select serial from public.mfg_serials where id = a.serial_id), 'serialized', coalesce((i.data->>'serialized')::boolean, false))) order by i.data->>'number')
      from public.mfg_allocs a join public.records i on i.id = a.item_id where a.unit_id = u.id and a.status = 'active' and public.record_visible_for(me, i)), '[]'::jsonb));
end $$;
revoke execute on function public.mfg_wo(uuid) from public, anon;
grant execute on function public.mfg_wo(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   13. Quality: inspections (receiving, in-process, final) recorded once and kept; a failure opens a P6 issue
       (nonconformance) with its links; disposition (Use As Is only with the Quality Approver); rework work orders
       and reinspection; test runs against the exact procedure version, values checked by deterministic rules,
       the result chosen by a person and approved by another.
   --------------------------------------------------------------------------------------------- */
create or replace function public._mfg_nc_create(p_actor uuid, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; u public.records; num text; v public.records;
begin
  select * into u from public.records where id = public.as_uuid(p->>'build_ref') and section = 'operations.builds';
  select * into v from public.records where id = public.as_uuid(p->>'vendor_ref') and section = 'operations.vendors';
  num := public.ops_number('company.issues', public.as_uuid(u.data->>'project_ref'));
  insert into public.records(section, title, status, controlled, created_by, data)
  values ('company.issues', left(coalesce(p->>'title', 'Nonconformance'), 300), 'Open', coalesce(u.controlled, false) or coalesce((p->>'controlled')::boolean, false), p_actor,
    jsonb_strip_nulls(jsonb_build_object('number', num, 'type', 'Nonconformance', 'severity', coalesce(p->>'severity', 'Medium'), 'description', left(p->>'description', 4000),
      'build_ref', u.id, 'build_ref_title', case when coalesce((u.data->>'restricted')::boolean, false) then null else coalesce(u.data->>'number', u.title) end,
      'work_order_ref', public.as_uuid(p->>'work_order_ref'), 'work_order_ref_title', p->>'work_order_ref_title', 'item_ref', public.as_uuid(p->>'item_ref'), 'item_ref_title', p->>'item_ref_title',
      'serial', p->>'serial', 'serial_id', public.as_uuid(p->>'serial_id'), 'lot', p->>'lot', 'inspection_ref', public.as_uuid(p->>'inspection_ref'), 'test_ref', public.as_uuid(p->>'test_ref'),
      'source_ref', coalesce(public.as_uuid(p->>'inspection_ref'), public.as_uuid(p->>'test_ref')), 'source_ref_title', p->>'source_title',
      'vendor_ref', v.id, 'vendor_ref_title', v.title, 'party_ref', v.data->>'party_ref', 'project_ref', u.data->>'project_ref', 'project_ref_title', u.data->>'project_ref_title',
      'owner_id', p_actor, 'owner', public._wf_name(p_actor), 'mfg', true)))
  returning records.id into v_id;
  begin perform public._wf_start(p_actor, 'ISSUE', v_id, case when p->>'severity' in ('High', 'Critical') then 'High' else null end); exception when others then null; end;
  perform public._mfg_audit(p_actor, 'nonconformance_opened', v_id, u.id, jsonb_strip_nulls(jsonb_build_object('number', num, 'inspection', p->>'inspection_ref', 'test', p->>'test_ref', 'severity', p->>'severity')));
  return v_id;
end $$;
revoke execute on function public._mfg_nc_create(uuid, jsonb) from public, anon, authenticated;

/* ----- inspections ----- */
create or replace function public.mfg_inspection_create(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; w public.records; it public.records; r public.records; kind text := coalesce(p->>'kind', 'In-Process Inspection');
begin
  if not (public.has_cap(me, 'quality_inspector') or public.has_cap(me, 'work_order_manager') or public.has_cap(me, 'build_manager')) then perform public._mfg_need(me, 'quality_inspector', 'Creating an inspection'); end if;
  if not (kind = any (array(select jsonb_array_elements_text(public.mfg_cfg()->'inspection_kinds')))) then raise exception 'Unknown inspection kind' using errcode = '22023'; end if;
  if coalesce(p->>'unit', '') <> '' then u := public._mfg_unit(me, public.as_uuid(p->>'unit')); end if;
  if coalesce(p->>'work_order', '') <> '' then w := public._mfg_rec(me, public.as_uuid(p->>'work_order'), 'operations.work_orders', 'Work order'); if u.id is null then u := public._mfg_unit(me, public.as_uuid(w.data->>'build_ref')); end if; end if;
  if coalesce(p->>'item', '') <> '' then it := public._mfg_item(me, public.as_uuid(p->>'item')); if it.id is null then raise exception 'Item not found' using errcode = 'P0002'; end if; end if;
  if u.id is null and it.id is null then raise exception 'An inspection is of a unit, a work order or received material' using errcode = '22023'; end if;
  if public.as_uuid(p->>'inspector_id') is not null and not public.has_cap(public.as_uuid(p->>'inspector_id'), 'quality_inspector') then raise exception 'The inspector must hold the Quality Inspector capability' using errcode = '23514'; end if;
  insert into public.records(section, title, status, controlled, created_by, data)
  values ('operations.quality', left(coalesce(nullif(trim(p->>'title'), ''), kind || ' — ' || coalesce(u.data->>'number', it.data->>'number', '')), 300), 'Planned', coalesce(u.controlled, false) or coalesce(it.controlled, false), me,
    jsonb_strip_nulls(jsonb_build_object('inspection_kind', kind, 'check_type', case kind when 'Receiving Inspection' then 'Incoming inspection' when 'Final Inspection' then 'Factory acceptance (FAT)' else 'In-process' end,
      'build_ref', u.id, 'build_ref_title', coalesce(u.data->>'number', u.title), 'build', coalesce(u.data->>'number', u.title), 'work_order_ref', w.id, 'work_order_ref_title', w.data->>'number',
      'item_ref', it.id, 'item_ref_title', it.data->>'number', 'serial_ids', p->'serial_ids', 'lot_id', public.as_uuid(p->>'lot'), 'location_id', public.as_uuid(p->>'location'), 'qty', public._num(p->'qty'),
      'receipt_ref', public.as_uuid(p->>'receipt'), 'checklist', p->'checklist', 'inspector_id', public.as_uuid(p->>'inspector_id'),
      'inspector', case when public.as_uuid(p->>'inspector_id') is not null then public._wf_name(public.as_uuid(p->>'inspector_id')) end, 'due', public._mfg_date(p->>'due')::text,
      'reinspection_of', public.as_uuid(p->>'reinspection_of'), 'issue_ref', public.as_uuid(p->>'issue_ref'))))
  returning * into r;
  return jsonb_build_object('id', r.id, 'number', r.data->>'number');
end $$;
revoke execute on function public.mfg_inspection_create(jsonb) from public, anon;
grant execute on function public.mfg_inspection_create(jsonb) to authenticated;

-- record the result once (Quality Inspector). A failure is a nonconformance issue linked to everything it concerns;
-- received material moves to Available (passed) or Quarantine / Rejected (failed or conditional).
create or replace function public.mfg_inspection_record(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records; res text := p->>'result'; iss uuid; u public.records; it public.records; w public.records; fail_state text; qp numeric; qf numeric;
  sids uuid[]; loc uuid; lot uuid; c jsonb; miss text[] := '{}'; done jsonb := '{}'::jsonb; x jsonb; orig public.records;
begin
  perform public._mfg_need(me, 'quality_inspector', 'Recording an inspection result');
  r := public._mfg_rec(me, p_id, 'operations.quality', 'Inspection', true);
  if not (r.data ? 'inspection_kind') then raise exception 'This is an earlier quality record: edit it in its section' using errcode = '55000'; end if;
  if coalesce(r.data->>'recorded_at', '') <> '' then raise exception 'This inspection is recorded already (%): a reinspection is a new record', r.data->>'result' using errcode = '23505'; end if;
  if res not in ('Pass', 'Fail', 'Conditional', 'Not Applicable') then raise exception 'The result is Pass, Fail, Conditional or Not Applicable' using errcode = '22023'; end if;
  if res in ('Fail', 'Conditional', 'Not Applicable') and length(trim(coalesce(p->>'notes', ''))) < 5 then raise exception 'Say what was found (at least 5 characters)' using errcode = '23514'; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'checklist', '[]'::jsonb)) loop
    done := done || jsonb_build_object(x->>'key', jsonb_build_object('ok', x->'ok', 'note', left(x->>'note', 500)));
  end loop;
  for c in select * from jsonb_array_elements(coalesce(r.data->'checklist', '[]'::jsonb)) loop
    if not (done ? (c->>'key')) then miss := array_append(miss, coalesce(c->>'text', c->>'key')); end if;
    if res = 'Pass' and coalesce((done->(c->>'key')->>'ok')::boolean, true) = false then raise exception 'A checklist point is not met (%): the result cannot be Pass', coalesce(c->>'text', c->>'key') using errcode = '23514'; end if;
  end loop;
  if cardinality(miss) > 0 and res <> 'Not Applicable' then raise exception 'Answer every checklist point: %', array_to_string(miss, '; ') using errcode = '23514'; end if;
  select * into u from public.records where id = public.as_uuid(r.data->>'build_ref');
  select * into it from public.records where id = public.as_uuid(r.data->>'item_ref');
  select * into w from public.records where id = public.as_uuid(r.data->>'work_order_ref');
  -- received material under inspection: passed units become available, the others go to quarantine or rejected
  if r.data->>'inspection_kind' = 'Receiving Inspection' and it.id is not null and coalesce(r.data->>'location_id', '') <> '' then
    loc := public.as_uuid(r.data->>'location_id'); lot := public.as_uuid(r.data->>'lot_id');
    fail_state := coalesce(nullif(p->>'fail_state', ''), case when res = 'Conditional' then 'Quarantine' else 'Rejected' end);
    if fail_state not in ('Quarantine', 'Rejected') then raise exception 'Failed material goes to Quarantine or Rejected' using errcode = '22023'; end if;
    if coalesce((it.data->>'serialized')::boolean, false) then
      sids := array(select public.as_uuid(v) from jsonb_array_elements_text(coalesce(r.data->'serial_ids', '[]'::jsonb)) v);
      if res in ('Pass', 'Not Applicable') then perform public._mfg_move(it.id, loc, loc, null, 'Inspection', 'Available', null, sids, me, 'inspect', 'Inspection passed', null, null, null, jsonb_build_object('inspection', r.id));
      else perform public._mfg_move(it.id, loc, loc, null, 'Inspection', fail_state, null, sids, me, 'inspect', 'Inspection: ' || res, null, null, null, jsonb_build_object('inspection', r.id)); end if;
    else
      qf := coalesce(public._num(p->'qty_fail'), case when res in ('Fail', 'Conditional') then public._num(r.data->'qty') else 0 end, 0);
      qp := coalesce(public._num(r.data->'qty'), 0) - qf;
      if qf < 0 or qp < 0 then raise exception 'Failed quantity must be between 0 and the inspected quantity' using errcode = '22023'; end if;
      if qp > 0 then perform public._mfg_move(it.id, loc, loc, lot, 'Inspection', 'Available', qp, null, me, 'inspect', 'Inspection passed', null, null, null, jsonb_build_object('inspection', r.id)); end if;
      if qf > 0 then perform public._mfg_move(it.id, loc, loc, lot, 'Inspection', fail_state, qf, null, me, 'inspect', 'Inspection: ' || res, null, null, null, jsonb_build_object('inspection', r.id)); end if;
    end if;
  end if;
  if res = 'Fail' then
    iss := public._mfg_nc_create(me, jsonb_build_object('title', 'Nonconformance — ' || r.title, 'severity', coalesce(p->>'severity', 'Medium'), 'description', trim(p->>'notes'),
      'build_ref', u.id, 'work_order_ref', w.id, 'work_order_ref_title', w.data->>'number', 'item_ref', it.id, 'item_ref_title', it.data->>'number',
      'serial', (select string_agg(s.serial, ', ') from public.mfg_serials s where s.id::text in (select jsonb_array_elements_text(coalesce(r.data->'serial_ids', '[]'::jsonb)))),
      'lot', (select lot_no from public.mfg_lots where id = public.as_uuid(r.data->>'lot_id')), 'inspection_ref', r.id, 'source_title', coalesce(r.data->>'number', r.title),
      'vendor_ref', (select p2.data->>'vendor_ref' from public.records rc join public.records p2 on p2.id = public.as_uuid(rc.data->>'purchase_ref') where rc.id = public.as_uuid(r.data->>'receipt_ref')),
      'controlled', r.controlled));
  end if;
  perform public._mfg_sys_patch(r.id, case when res = 'Fail' then 'Non-conformance' else 'Closed' end, jsonb_strip_nulls(jsonb_build_object('result', res,
    'recorded_at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'recorded_by_id', me, 'inspector_id', me, 'inspector', public._wf_name(me), 'owner', public._wf_name(me),
    'date', to_char(current_date, 'YYYY-MM-DD'), 'findings', left(p->>'notes', 4000), 'checklist_result', done, 'issue_ref', iss, 'fail_state', fail_state)));
  -- a passed reinspection closes the loop of the nonconformance it followed (the issue goes to verification)
  if r.data ? 'reinspection_of' and res = 'Pass' and coalesce(r.data->>'issue_ref', '') <> '' then
    perform public._mfg_sys_patch(public.as_uuid(r.data->>'issue_ref'), 'Verification', jsonb_build_object('reinspection_passed', true, 'reinspection_ref', r.id));
  end if;
  perform public._mfg_audit(me, 'inspection', r.id, u.id, jsonb_strip_nulls(jsonb_build_object('kind', r.data->>'inspection_kind', 'result', res, 'issue', iss)));
  return jsonb_build_object('ok', true, 'result', res, 'issue', iss);
end $$;
revoke execute on function public.mfg_inspection_record(uuid, jsonb) from public, anon;
grant execute on function public.mfg_inspection_record(uuid, jsonb) to authenticated;

/* ----- nonconformance ----- */
create or replace function public.mfg_nc_create(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; it public.records; w public.records; v_id uuid;
begin
  if not (public.has_cap(me, 'quality_inspector') or public.has_cap(me, 'work_order_manager') or public._mfg_can_write(me, 'operations.work_orders')) then perform public._mfg_need(me, 'quality_inspector', 'Raising a nonconformance'); end if;
  if coalesce(p->>'unit', '') <> '' then u := public._mfg_unit(me, public.as_uuid(p->>'unit')); end if;
  if coalesce(p->>'work_order', '') <> '' then w := public._mfg_rec(me, public.as_uuid(p->>'work_order'), 'operations.work_orders', 'Work order'); end if;
  if coalesce(p->>'item', '') <> '' then it := public._mfg_item(me, public.as_uuid(p->>'item')); end if;
  if length(trim(coalesce(p->>'description', ''))) < 5 then raise exception 'Say what is wrong (at least 5 characters)' using errcode = '23514'; end if;
  v_id := public._mfg_nc_create(me, jsonb_build_object('title', coalesce(nullif(trim(p->>'title'), ''), 'Nonconformance — ' || coalesce(u.data->>'number', it.data->>'number', '')), 'severity', p->>'severity',
    'description', p->>'description', 'build_ref', u.id, 'work_order_ref', w.id, 'work_order_ref_title', w.data->>'number', 'item_ref', it.id, 'item_ref_title', it.data->>'number', 'serial', p->>'serial', 'lot', p->>'lot',
    'vendor_ref', p->>'vendor', 'controlled', coalesce(it.controlled, false)));
  return jsonb_build_object('id', v_id, 'number', (select r.data->>'number' from public.records r where r.id = v_id));
end $$;
revoke execute on function public.mfg_nc_create(jsonb) from public, anon;
grant execute on function public.mfg_nc_create(jsonb) to authenticated;

-- the disposition of a nonconformance; Use As Is is an accepted deviation and needs the Quality Approver
create or replace function public.mfg_nc_disposition(p_issue uuid, p_disposition text, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records;
begin
  r := public._mfg_rec(me, p_issue, 'company.issues', 'Issue', true);
  if not (p_disposition = any (array(select jsonb_array_elements_text(public.mfg_cfg()->'dispositions')))) then raise exception 'Disposition is one of: %', (select string_agg(x, ', ') from jsonb_array_elements_text(public.mfg_cfg()->'dispositions') x) using errcode = '22023'; end if;
  if p_disposition = 'Use As Is' then perform public._mfg_need(me, 'quality_approver', 'Accepting a nonconformance as is');
  elsif not (public.has_cap(me, 'quality_inspector') or public.has_cap(me, 'quality_approver')) then perform public._mfg_need(me, 'quality_inspector', 'Deciding the disposition'); end if;
  if r.status in ('Closed', 'Cancelled') then raise exception 'The issue is %', r.status using errcode = '55000'; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Give the reason for the disposition (at least 5 characters)' using errcode = '23514'; end if;
  perform public._mfg_sys_patch(r.id, case when p_disposition = 'Use As Is' then 'Closed' when p_disposition = 'Investigate' then 'Investigating' else 'Action required' end,
    jsonb_strip_nulls(jsonb_build_object('disposition', p_disposition, 'disposition_note', left(trim(p_note), 2000), 'disposition_by_id', me, 'disposition_by', public._wf_name(me),
      'disposition_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'use_as_is_approved_by', case when p_disposition = 'Use As Is' then public._wf_name(me) end, 'deviation', case when p_disposition = 'Use As Is' then true end)));
  perform public._mfg_audit(me, 'nonconformance_disposition', r.id, public.as_uuid(r.data->>'build_ref'), jsonb_build_object('disposition', p_disposition, 'note', left(trim(p_note), 300)));
  return jsonb_build_object('ok', true, 'disposition', p_disposition);
end $$;
revoke execute on function public.mfg_nc_disposition(uuid, text, text) from public, anon;
grant execute on function public.mfg_nc_disposition(uuid, text, text) to authenticated;

-- a rework work order from a nonconformance: the original operation, failure and disposition stay as recorded;
-- completing the rework leaves a reinspection to be recorded
create or replace function public.mfg_rework_create(p_issue uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records; u public.records; ow public.records; insp public.records; w public.records;
begin
  if not (public.has_cap(me, 'work_order_manager') or public.has_cap(me, 'quality_inspector')) then perform public._mfg_need(me, 'work_order_manager', 'Creating a rework work order'); end if;
  r := public._mfg_rec(me, p_issue, 'company.issues', 'Issue', true);
  if coalesce(r.data->>'disposition', '') not in ('Rework', 'Replace') then raise exception 'Decide the disposition first (Rework or Replace)' using errcode = '23514'; end if;
  u := public._mfg_unit(me, public.as_uuid(r.data->>'build_ref'), true);
  select * into ow from public.records where id = public.as_uuid(r.data->>'work_order_ref');
  select * into insp from public.records where id = public.as_uuid(r.data->>'inspection_ref');
  if public.as_uuid(p->>'assignee_id') is not null and not public.is_active_employee(public.as_uuid(p->>'assignee_id')) then raise exception 'Work goes to an active employee' using errcode = '23514'; end if;
  w := public._mfg_wo_insert(u, me, jsonb_build_object('name', 'Rework: ' || coalesce(ow.data->>'operation', r.title), 'operation', 'Rework', 'assignee_id', p->>'assignee_id',
      'instructions', coalesce(p->>'instructions', r.data->>'disposition_note'), 'inspection', coalesce(insp.data->>'inspection_kind', 'In-Process Inspection'), 'documents', ow.data->'documents',
      'checklist', p->'checklist'), 'Ready',
    jsonb_strip_nulls(jsonb_build_object('rework_of', r.id, 'rework_of_title', r.data->>'number', 'original_wo', ow.id, 'original_wo_title', ow.data->>'number', 'reinspection_of', insp.id)));
  perform public._mfg_sys_patch(r.id, null, jsonb_build_object('rework_ref', w.id, 'rework_ref_title', w.data->>'number'));
  perform public._mfg_audit(me, 'rework_created', w.id, u.id, jsonb_build_object('issue', r.id, 'original_wo', ow.id, 'inspection', insp.id));
  return jsonb_build_object('id', w.id, 'number', w.data->>'number');
end $$;
revoke execute on function public.mfg_rework_create(uuid, jsonb) from public, anon;
grant execute on function public.mfg_rework_create(uuid, jsonb) to authenticated;

-- a nonconformance is closed by the Quality Approver once its rework passed reinspection (or it was accepted as is)
create or replace function public.mfg_nc_close(p_issue uuid, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records;
begin
  perform public._mfg_need(me, 'quality_approver', 'Closing a nonconformance');
  r := public._mfg_rec(me, p_issue, 'company.issues', 'Issue', true);
  if r.status = 'Closed' then return jsonb_build_object('ok', true); end if;
  if coalesce(r.data->>'disposition', '') = '' then raise exception 'Decide the disposition first' using errcode = '23514'; end if;
  if r.data->>'disposition' in ('Rework', 'Replace') and not coalesce((r.data->>'reinspection_passed')::boolean, false) then raise exception 'The rework has not passed reinspection yet' using errcode = '23514'; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Give the closing note (at least 5 characters)' using errcode = '23514'; end if;
  perform public._mfg_sys_patch(r.id, 'Closed', jsonb_build_object('closed_note', left(trim(p_note), 2000), 'closed_by', public._wf_name(me), 'closed_at', now()));
  perform public._mfg_audit(me, 'nonconformance_closed', r.id, public.as_uuid(r.data->>'build_ref'), jsonb_build_object('note', left(trim(p_note), 300)));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.mfg_nc_close(uuid, text) from public, anon;
grant execute on function public.mfg_nc_close(uuid, text) to authenticated;

/* ----- test runs ----- */
create or replace function public._mfg_field_error(f jsonb) returns text language plpgsql immutable as $$
begin
  if coalesce(f->>'key', '') !~ '^[a-z][a-z0-9_]{0,40}$' then return 'a field key is 1–40 lower-case letters, digits or _'; end if;
  if coalesce(f->>'type', '') not in ('number', 'boolean', 'text', 'choice') then return 'field ' || (f->>'key') || ': type is number, boolean, text or choice'; end if;
  if f->>'type' = 'number' and f ? 'min' and f ? 'max' and (f->>'min')::numeric > (f->>'max')::numeric then return 'field ' || (f->>'key') || ': min is above max'; end if;
  if f->>'type' = 'choice' and jsonb_typeof(f->'options') <> 'array' then return 'field ' || (f->>'key') || ': list the options'; end if;
  return null;
end $$;

create or replace function public.mfg_test_create(p_unit uuid, p_procedure uuid, p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; tp public.records; r public.records;
begin
  if not (public.has_cap(me, 'test_operator') or public.has_cap(me, 'work_order_manager')) then perform public._mfg_need(me, 'test_operator', 'Scheduling a test'); end if;
  u := public._mfg_unit(me, p_unit);
  tp := public._mfg_rec(me, p_procedure, 'technical.test_procedures', 'Test procedure');
  if tp.status <> 'Approved' then raise exception 'Only an approved test procedure version is run (% v% is %)', tp.data->>'code', tp.data->>'version', tp.status using errcode = '23514'; end if;
  insert into public.records(section, title, status, controlled, created_by, data)
  values ('technical.testing', left(coalesce(tp.data->>'code', '') || ' v' || coalesce(tp.data->>'version', '') || ' ' || tp.title || ' — ' || coalesce(u.data->>'number', u.title), 300), 'Planned', u.controlled or tp.controlled, me,
    jsonb_strip_nulls(jsonb_build_object('build_ref', u.id, 'build_ref_title', coalesce(u.data->>'number', u.title), 'procedure_ref', tp.id, 'procedure_code', tp.data->>'code', 'procedure_version', tp.data->>'version',
      'procedure_ref_title', tp.title, 'category', tp.data->>'category', 'type', 'Bench', 'equipment', coalesce(u.data->>'number', u.title), 'fields', tp.data->'fields',
      'document_ref', tp.data->>'document_ref', 'document_version_id', tp.data->>'document_version_id',
      'operator_id', public.as_uuid(p->>'operator_id'), 'owner', case when public.as_uuid(p->>'operator_id') is not null then public._wf_name(public.as_uuid(p->>'operator_id')) end, 'date', public._mfg_date(p->>'planned')::text)))
  returning * into r;
  return jsonb_build_object('id', r.id, 'number', r.data->>'number');
end $$;
revoke execute on function public.mfg_test_create(uuid, uuid, jsonb) from public, anon;
grant execute on function public.mfg_test_create(uuid, uuid, jsonb) to authenticated;

-- record the run once: each value checked by the procedure's deterministic rule; the result is the operator's
-- explicit choice (never inferred from the absence of a failure) and cannot be Pass when a rule fails
create or replace function public.mfg_test_record(p_run uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records; f jsonb; v jsonb; num numeric; ok boolean; fails text[] := '{}'; missing text[] := '{}'; outcome text := p->>'outcome'; iss uuid; u public.records;
  suggested text; vals jsonb := '[]'::jsonb;
begin
  perform public._mfg_need(me, 'test_operator', 'Recording a test');
  r := public._mfg_rec(me, p_run, 'technical.testing', 'Test run', true);
  if not (r.data ? 'procedure_ref') then raise exception 'This is an earlier test record: edit it in its section' using errcode = '55000'; end if;
  if coalesce(r.data->>'recorded_at', '') <> '' then raise exception 'This run is recorded already (%): a retest is a new run', r.data->>'outcome' using errcode = '23505'; end if;
  if coalesce(outcome, '') not in ('Pass', 'Fail', 'Conditional', 'Aborted') then raise exception 'Choose the result: Pass, Fail, Conditional or Aborted (it is never assumed)' using errcode = '22023'; end if;
  perform public.ops_secret_check(coalesce(p->'values', '{}'::jsonb));
  for f in select * from jsonb_array_elements(coalesce(r.data->'fields', '[]'::jsonb)) loop
    v := p->'values'->(f->>'key');
    ok := null; num := null;
    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '') then
      if coalesce((f->>'required')::boolean, true) then missing := array_append(missing, coalesce(f->>'name', f->>'key')); end if;
    elsif f->>'type' = 'number' then
      num := public._num(v);
      if num is null then raise exception 'Field %: a number is expected', coalesce(f->>'name', f->>'key') using errcode = '22023'; end if;
      if f ? 'min' or f ? 'max' then ok := (not (f ? 'min') or num >= (f->>'min')::numeric) and (not (f ? 'max') or num <= (f->>'max')::numeric); end if;
    elsif f->>'type' = 'boolean' then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'Field %: yes or no is expected', coalesce(f->>'name', f->>'key') using errcode = '22023'; end if;
      if f ? 'expected' then ok := (v #>> '{}') = lower(f->>'expected'); end if;
    elsif f->>'type' = 'choice' then
      if not (f->'options' ? (v #>> '{}')) then raise exception 'Field %: choose one of the options', coalesce(f->>'name', f->>'key') using errcode = '22023'; end if;
      if f ? 'pass_values' then ok := f->'pass_values' ? (v #>> '{}'); end if;
    end if;
    if ok = false then fails := array_append(fails, coalesce(f->>'name', f->>'key') || ' = ' || (v #>> '{}') || coalesce(' ' || (f->>'unit'), '')); end if;
    insert into public.mfg_test_values(run_id, key, name, type, unit, expected, min, max, actual_text, actual_num, pass, rule, recorded_by)
    values (r.id, f->>'key', coalesce(f->>'name', f->>'key'), f->>'type', f->>'unit', coalesce(f->>'expected', (f->'pass_values')::text), (f->>'min')::numeric, (f->>'max')::numeric,
      case when v is null then null else left(v #>> '{}', 500) end, num, ok,
      case when f->>'type' = 'number' and (f ? 'min' or f ? 'max') then concat_ws(' ', case when f ? 'min' then '≥ ' || (f->>'min') end, case when f ? 'max' then '≤ ' || (f->>'max') end)
           when f->>'type' = 'boolean' and f ? 'expected' then '= ' || (f->>'expected') when f ? 'pass_values' then 'in ' || (f->'pass_values')::text end, me);
    vals := vals || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('key', f->>'key', 'value', v, 'pass', ok)));
  end loop;
  suggested := case when cardinality(fails) > 0 then 'Fail' when cardinality(missing) > 0 then 'Incomplete' else 'Rules met' end;
  if outcome = 'Pass' and cardinality(fails) > 0 then raise exception 'The result cannot be Pass: % outside the limits (%)', cardinality(fails), array_to_string(fails, '; ') using errcode = '23514'; end if;
  if outcome = 'Pass' and cardinality(missing) > 0 then raise exception 'The result cannot be Pass: values missing (%)', array_to_string(missing, '; ') using errcode = '23514'; end if;
  if outcome in ('Fail', 'Conditional', 'Aborted') and length(trim(coalesce(p->>'notes', ''))) < 5 then raise exception 'Say what happened (at least 5 characters)' using errcode = '23514'; end if;
  select * into u from public.records where id = public.as_uuid(r.data->>'build_ref');
  if outcome = 'Fail' then
    iss := public._mfg_nc_create(me, jsonb_build_object('title', 'Test failed — ' || r.title, 'severity', coalesce(p->>'severity', 'High'), 'description', trim(p->>'notes') || case when cardinality(fails) > 0 then ' — ' || array_to_string(fails, '; ') else '' end,
      'build_ref', u.id, 'test_ref', r.id, 'source_title', coalesce(r.data->>'number', r.title), 'controlled', r.controlled));
  end if;
  perform public._mfg_sys_patch(r.id, case outcome when 'Pass' then 'Passed' when 'Fail' then 'Failed' when 'Conditional' then 'Conditional' else 'Aborted' end,
    jsonb_strip_nulls(jsonb_build_object('outcome', outcome, 'recorded_at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'recorded_by_id', me, 'operator_id', coalesce(public.as_uuid(r.data->>'operator_id'), me),
      'owner', public._wf_name(me), 'date', to_char(current_date, 'YYYY-MM-DD'), 'environment', left(p->>'environment', 1000), 'result', left(p->>'notes', 4000), 'measured', vals,
      'deterministic', jsonb_build_object('rule_failures', to_jsonb(fails), 'missing', to_jsonb(missing), 'check', suggested), 'issue_ref', iss)));
  perform public._mfg_audit(me, 'test', r.id, u.id, jsonb_strip_nulls(jsonb_build_object('procedure', r.data->>'procedure_code', 'version', r.data->>'procedure_version', 'outcome', outcome, 'rule_failures', cardinality(fails), 'issue', iss)));
  return jsonb_build_object('ok', true, 'outcome', outcome, 'rule_failures', to_jsonb(fails), 'missing', to_jsonb(missing), 'check', suggested, 'issue', iss);
end $$;
revoke execute on function public.mfg_test_record(uuid, jsonb) from public, anon;
grant execute on function public.mfg_test_record(uuid, jsonb) to authenticated;

-- a passed (or conditional) run is approved by a Test Approver other than the operator
create or replace function public.mfg_test_approve(p_run uuid, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records;
begin
  perform public._mfg_need(me, 'test_approver', 'Approving a test result');
  r := public._mfg_rec(me, p_run, 'technical.testing', 'Test run', true);
  if coalesce(r.data->>'recorded_at', '') = '' then raise exception 'Record the run first' using errcode = '23514'; end if;
  if r.data->>'outcome' not in ('Pass', 'Conditional') then raise exception 'Only a passed or conditional run is approved' using errcode = '55000'; end if;
  if coalesce(r.data->>'recorded_by_id', '') = me::text then raise exception 'The operator who recorded the run does not approve it' using errcode = '42501'; end if;
  if coalesce(r.data->>'approved_at', '') <> '' then return jsonb_build_object('ok', true); end if;
  perform public._mfg_sys_patch(r.id, null, jsonb_strip_nulls(jsonb_build_object('approved_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'approved_by_id', me, 'approved_by', public._wf_name(me), 'approval_note', left(p_note, 1000))));
  perform public._mfg_audit(me, 'test_approved', r.id, public.as_uuid(r.data->>'build_ref'), jsonb_build_object('outcome', r.data->>'outcome'));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.mfg_test_approve(uuid, text) from public, anon;
grant execute on function public.mfg_test_approve(uuid, text) to authenticated;

-- a test procedure's fields are valid before it goes for approval (called by the screen and by the submit)
create or replace function public.mfg_procedure_check(p_fields jsonb) returns jsonb language plpgsql immutable as $$
declare f jsonb; e text; errs jsonb := '[]'::jsonb; keys text[] := '{}';
begin
  if jsonb_typeof(p_fields) <> 'array' then return '["fields must be a list"]'::jsonb; end if;
  for f in select * from jsonb_array_elements(p_fields) loop
    e := public._mfg_field_error(f);
    if e is null and f->>'key' = any (keys) then e := 'field ' || (f->>'key') || ' is defined twice'; end if;
    if e is not null then errs := errs || to_jsonb(e); end if;
    keys := keys || (f->>'key');
  end loop;
  return errs;
end $$;
grant execute on function public.mfg_procedure_check(jsonb) to authenticated;

/* ---------------------------------------------------------------------------------------------
   14. As-Built (what is actually installed), planned vs built, engineering change impact and effectivity,
       blockers, build and acceptance readiness, unit acceptance, shipping readiness and release, operational cost,
       operational inventory value and supplier facts — every answer from records, the same rules for everyone
   --------------------------------------------------------------------------------------------- */
-- the factual As-Built of a unit as it is now (not stored by this function)
create or replace function public._mfg_asbuilt_build(p_unit uuid) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare u public.records; c public.records; b public.records; pr public.records;
begin
  select * into u from public.records where id = p_unit;
  select * into c from public.records where id = public.as_uuid(u.data->>'config_ref');
  select * into b from public.records where id = public.as_uuid(u.data->>'bom_ref');
  select * into pr from public.records where id = public.as_uuid(u.data->>'product_ref');
  return jsonb_build_object(
    'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number', 'title', u.title),
    'product', jsonb_build_object('id', pr.id, 'code', pr.data->>'code', 'name', pr.title),
    'configuration', jsonb_build_object('id', c.id, 'code', c.data->>'code', 'version', c.data->>'version', 'name', c.title, 'status', c.status),
    'bom', jsonb_build_object('id', b.id, 'number', b.data->>'number', 'revision', b.data->>'revision', 'lines_hash', b.data->>'lines_hash', 'status', b.status),
    'installed', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item', i.id, 'number', i.data->>'number', 'title', i.title, 'mpn', i.data->>'mpn', 'qty', x.qty, 'serial', s.serial, 'agron_serial', s.agron_serial,
        'position', x.position, 'work_order', w.data->>'number', 'installed_at', x.installed_at, 'installed_by', public._wf_name(x.installed_by),
        'document_version', (select label from public.document_versions where id = x.doc_version_id), 'config', x.config_data)) order by i.data->>'number', s.serial)
      from public.mfg_installs x join public.records i on i.id = x.item_id left join public.mfg_serials s on s.id = x.serial_id left join public.records w on w.id = x.wo_id
      where x.unit_id = u.id and x.removed_at is null), '[]'::jsonb),
    'consumed', coalesce((select jsonb_agg(jsonb_build_object('item', i.id, 'number', i.data->>'number', 'title', i.title, 'qty', z.q, 'lots', z.lots) order by i.data->>'number')
      from (select t.item_id, sum(t.qty) q, (select jsonb_agg(distinct l.lot_no) from public.mfg_txns t2 join public.mfg_lots l on l.id = t2.lot_id where t2.unit_id = u.id and t2.item_id = t.item_id and t2.kind = 'consume') lots
            from public.mfg_txns t where t.unit_id = u.id and t.kind = 'consume' group by t.item_id) z join public.records i on i.id = z.item_id), '[]'::jsonb),
    'substitutions', coalesce((select jsonb_agg(jsonb_build_object('alternate', a.id, 'original', o.data->>'number', 'installed', s2.data->>'number', 'reason', a.reason, 'approved_by', public._wf_name(a.decided_by), 'approved_at', a.decided_at))
      from public.mfg_alternates a join public.records o on o.id = a.item_id join public.records s2 on s2.id = a.substitute_id
      where a.status in ('Approved', 'Expired') and exists (select 1 from public.mfg_installs x where x.unit_id = u.id and x.removed_at is null and x.item_id = a.substitute_id)
        and exists (select 1 from public.mfg_bom_lines l where l.bom_id = b.id and l.item_id = a.item_id)
        and (a.scope = 'all' or (a.scope = 'configuration' and a.config_id = c.id) or (a.scope = 'bom' and a.bom_id = b.id) or (a.scope = 'units' and u.id = any (a.unit_ids)))), '[]'::jsonb),
    'software', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('component', sw.component, 'version', sw.version, 'checksum', sw.checksum, 'config_ref', sw.config_ref, 'installed_at', sw.installed_at,
        'installer', public._wf_name(sw.installer), 'previous', (select count(*) from public.mfg_software p where p.unit_id = u.id and p.component = sw.component and p.superseded_at is not null))) order by sw.component)
      from public.mfg_software sw where sw.unit_id = u.id and sw.superseded_at is null), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(distinct jsonb_build_object('document', d->>'doc_ref', 'title', d->>'title', 'number', d->>'doc_number', 'version', d->>'version'))
      from public.records w, jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) d where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status = 'Completed'), '[]'::jsonb),
    'work_orders', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('number', w.data->>'number', 'operation', w.data->>'operation', 'completed_at', w.data->>'completed_at', 'completed_by', w.data->>'completed_by',
        'rework', case when coalesce(w.data->>'rework_of', '') <> '' then true end)) order by w.data->>'completed_at')
      from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status = 'Completed'), '[]'::jsonb),
    'inspections', coalesce((select jsonb_agg(jsonb_build_object('number', q.data->>'number', 'kind', q.data->>'inspection_kind', 'result', q.data->>'result', 'date', q.data->>'date', 'inspector', q.data->>'inspector') order by q.data->>'recorded_at')
      from public.records q where q.section = 'operations.quality' and q.data->>'build_ref' = u.id::text and coalesce(q.data->>'recorded_at', '') <> ''), '[]'::jsonb),
    'tests', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('number', t.data->>'number', 'procedure', t.data->>'procedure_code', 'version', t.data->>'procedure_version', 'outcome', t.data->>'outcome',
        'date', t.data->>'date', 'approved_by', t.data->>'approved_by')) order by t.data->>'recorded_at')
      from public.records t where t.section = 'technical.testing' and t.data->>'build_ref' = u.id::text and coalesce(t.data->>'recorded_at', '') <> ''), '[]'::jsonb),
    'deviations', coalesce((select jsonb_agg(jsonb_build_object('number', s3.data->>'number', 'title', s3.title, 'disposition', s3.data->>'disposition', 'approved_by', s3.data->>'use_as_is_approved_by', 'note', s3.data->>'disposition_note'))
      from public.records s3 where s3.section = 'company.issues' and s3.data->>'build_ref' = u.id::text and s3.data->>'disposition' = 'Use As Is'), '[]'::jsonb),
    'open_issues', coalesce((select jsonb_agg(jsonb_build_object('number', s4.data->>'number', 'title', s4.title, 'status', s4.status))
      from public.records s4 where s4.section = 'company.issues' and s4.data->>'build_ref' = u.id::text and s4.status not in ('Closed', 'Cancelled')), '[]'::jsonb),
    'ecrs', coalesce((select jsonb_agg(distinct jsonb_build_object('ecr', e.id, 'number', e.data->>'number', 'title', e.title))
      from public.records e where e.section = 'technical.changes' and (e.id::text = b.data->>'ecr_ref' or e.id::text = c.data->>'ecr_ref'
        or exists (select 1 from public.mfg_unit_dispositions d where d.unit_id = u.id and d.decision = 'Incorporate' and d.ecr_id = e.id))), '[]'::jsonb),
    'note', 'As built from the installation, consumption, software, work, inspection and test records of this unit — not from what the BOM expected.');
end $$;
revoke execute on function public._mfg_asbuilt_build(uuid) from public, anon, authenticated;

create or replace function public._mfg_asbuilt_hash(j jsonb) returns text language sql immutable as $$
  -- the installation times and names are part of the facts; the generation note is not
  select md5((j - 'note')::text)
$$;

create or replace function public.mfg_asbuilt_generate(p_unit uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; j jsonb; h text; rev int; last public.mfg_asbuilt; v_id uuid;
begin
  if not (public.has_cap(me, 'build_manager') or public.has_cap(me, 'quality_approver') or public.has_cap(me, 'unit_acceptance_approver')) then perform public._mfg_need(me, 'build_manager', 'Generating the As-Built'); end if;
  u := public._mfg_unit(me, p_unit, true);
  if exists (select 1 from public.mfg_acceptance a where a.unit_id = u.id and a.status <> 'Rejected') then raise exception 'The unit is accepted: its As-Built revision stays as accepted' using errcode = '55000'; end if;
  j := public._mfg_asbuilt_build(u.id); h := public._mfg_asbuilt_hash(j);
  select * into last from public.mfg_asbuilt where unit_id = u.id order by revision desc limit 1;
  if last.id is not null and last.hash = h then return jsonb_build_object('ok', true, 'revision', last.revision, 'unchanged', true, 'id', last.id); end if;
  rev := coalesce(last.revision, 0) + 1;
  insert into public.mfg_asbuilt(unit_id, revision, generated_by, snapshot, hash, basis_at) values (u.id, rev, me, j, h, now()) returning mfg_asbuilt.id into v_id;
  perform public._mfg_sys_patch(u.id, null, jsonb_build_object('asbuilt_revision', rev));
  perform public._mfg_audit(me, 'asbuilt_generated', u.id, u.id, jsonb_build_object('revision', rev, 'hash', h));
  return jsonb_build_object('ok', true, 'revision', rev, 'id', v_id);
end $$;
revoke execute on function public.mfg_asbuilt_generate(uuid) from public, anon;
grant execute on function public.mfg_asbuilt_generate(uuid) to authenticated;

create or replace function public.mfg_asbuilt(p_unit uuid, p_revision int default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; a public.mfg_asbuilt; live jsonb;
begin
  u := public._mfg_unit(me, p_unit);
  if not public._mfg_can_read(me, 'technical.boms') and not public._mfg_can_read(me, 'operations.work_orders') then raise exception 'The As-Built is engineering detail you may not open' using errcode = '42501'; end if;
  select * into a from public.mfg_asbuilt where unit_id = u.id and (p_revision is null or revision = p_revision) order by revision desc limit 1;
  live := public._mfg_asbuilt_build(u.id);
  return jsonb_build_object('unit', u.id, 'revision', a.revision, 'generated_at', a.generated_at, 'generated_by', public._wf_name(a.generated_by), 'hash', a.hash,
    'stale', a.id is null or a.hash <> public._mfg_asbuilt_hash(live), 'snapshot', coalesce(a.snapshot, live), 'live', case when a.id is null or a.hash <> public._mfg_asbuilt_hash(live) then live end,
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('revision', x.revision, 'generated_at', x.generated_at, 'hash', x.hash) order by x.revision) from public.mfg_asbuilt x where x.unit_id = u.id), '[]'::jsonb),
    'accepted_revision', (select x.revision from public.mfg_acceptance ac join public.mfg_asbuilt x on x.id = ac.asbuilt_id where ac.unit_id = u.id and ac.status <> 'Rejected' order by ac.accepted_at desc limit 1));
end $$;
revoke execute on function public.mfg_asbuilt(uuid, int) from public, anon;
grant execute on function public.mfg_asbuilt(uuid, int) to authenticated;

-- planned (the pinned BOM revision) vs built (what is installed and consumed): deterministic, line by item
create or replace function public.mfg_planned_vs_built(p_unit uuid) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); u public.records; b public.records; latest uuid;
begin
  u := public._mfg_unit(me, p_unit);
  select * into b from public.records where id = public.as_uuid(u.data->>'bom_ref');
  if b.id is null then return jsonb_build_object('rows', '[]'::jsonb, 'note', 'The unit is not released: no BOM revision is pinned'); end if;
  latest := public._mfg_applicable_bom(public.as_uuid(u.data->>'config_ref'), (u.data->>'unit_seq')::int, u.id);
  return (
    with exp as (select r.item_id, r.required from public._mfg_req(u.id, me) r where r.required > 0),
    got as (select x.item_id, sum(x.q) q from (select item_id, qty q from public.mfg_installs where unit_id = u.id and removed_at is null
                                               union all select item_id, qty from public.mfg_txns where unit_id = u.id and kind = 'consume') x group by x.item_id),
    sub as (select a.item_id orig, a.substitute_id sub from public.mfg_alternates a where a.status in ('Approved', 'Expired')
              and (a.scope = 'all' or (a.scope = 'configuration' and a.config_id::text = u.data->>'config_ref') or (a.scope = 'bom' and a.bom_id = b.id) or (a.scope = 'units' and u.id = any (a.unit_ids)))),
    rows as (
      select e.item_id expected, e.required eq, coalesce(g.q, 0) got_q,
             (select jsonb_agg(jsonb_build_object('item', s.sub, 'qty', g2.q)) from sub s join got g2 on g2.item_id = s.sub where s.orig = e.item_id) subs,
             (select jsonb_agg(sr.serial order by sr.serial) from public.mfg_installs x join public.mfg_serials sr on sr.id = x.serial_id where x.unit_id = u.id and x.removed_at is null and x.item_id = e.item_id) serials
      from exp e left join got g on g.item_id = e.item_id),
    extra as (select g.item_id, g.q from got g where g.item_id not in (select item_id from exp) and g.item_id not in (select s.sub from sub s where s.orig in (select item_id from exp))),
    lab as (select i.id, case when public.record_visible_for(me, i) then jsonb_build_object('id', i.id, 'number', i.data->>'number', 'title', i.title) else jsonb_build_object('hidden', true, 'title', 'An item you may not open') end j
            from public.records i where i.id in (select expected from rows union select item_id from extra union select (x->>'item')::uuid from rows, jsonb_array_elements(coalesce(rows.subs, '[]'::jsonb)) x))
    select jsonb_build_object(
      'bom', jsonb_build_object('id', b.id, 'number', b.data->>'number', 'revision', b.data->>'revision', 'status', b.status),
      'configuration_difference', case when latest is not null and latest <> b.id then jsonb_build_object('note', 'A later approved BOM revision applies to new units of this configuration', 'latest', (select jsonb_build_object('id', l.id, 'revision', l.data->>'revision') from public.records l where l.id = latest)) end,
      'rows', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('expected', (select j from lab where lab.id = r.expected), 'expected_qty', r.eq, 'installed_qty', r.got_q,
          'substitutes', (select jsonb_agg(jsonb_build_object('item', (select j from lab where lab.id = (x->>'item')::uuid), 'qty', x->'qty')) from jsonb_array_elements(coalesce(r.subs, '[]'::jsonb)) x),
          'serials', r.serials,
          'status', case when r.got_q >= r.eq and r.got_q = r.eq then 'match'
                         when r.got_q > r.eq then 'more than expected'
                         when r.got_q + coalesce((select sum((x->>'qty')::numeric) from jsonb_array_elements(coalesce(r.subs, '[]'::jsonb)) x), 0) >= r.eq and r.subs is not null then 'substitute'
                         when r.got_q = 0 then 'missing' else 'quantity difference' end,
          'difference', r.got_q - r.eq)) order by (select j->>'number' from lab where lab.id = r.expected)) from rows r), '[]'::jsonb),
      'extra', coalesce((select jsonb_agg(jsonb_build_object('item', (select j from lab where lab.id = x.item_id), 'qty', x.q)) from extra x), '[]'::jsonb),
      'method', 'Deterministic: the required lines of the pinned revision against the installation and consumption records; approved alternates count as substitutes; anything else installed is extra'));
end $$;
revoke execute on function public.mfg_planned_vs_built(uuid) from public, anon;
grant execute on function public.mfg_planned_vs_built(uuid) to authenticated;

/* ----- engineering change: suggested impact, confirmed objects, affected builds, dispositions ----- */
create or replace function public.mfg_ecr_candidates(p_ecr uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); e public.records; boms uuid[]; olds uuid[]; cfgs uuid[]; items uuid[];
begin
  e := public._mfg_rec(me, p_ecr, 'technical.changes', 'Engineering change');
  boms := array(select b.id from public.records b where b.section = 'technical.boms' and b.data->>'ecr_ref' = e.id::text);
  olds := array(select public.as_uuid(b.data->>'supersedes_ref') from public.records b where b.id = any (boms));
  cfgs := array(select distinct public.as_uuid(b.data->>'config_ref') from public.records b where b.id = any (boms || olds))
       || array(select c.id from public.records c where c.section = 'technical.configurations' and (c.data->>'ecr_ref' = e.id::text or (coalesce(e.data->>'config', '') <> '' and c.data->>'legacy_config' = e.data->>'config')));
  items := array(select distinct l.item_id from public.mfg_bom_lines l where l.bom_id = any (boms || olds));
  return jsonb_build_object('ecr', e.id, 'note', 'Suggestions only: a person confirms which objects the change affects',
    'configuration', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'status', c.status)) from public.records c where c.id = any (cfgs) and public.record_visible_for(me, c)), '[]'::jsonb),
    'bom', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', coalesce(b.data->>'number', '') || ' rev ' || coalesce(b.data->>'revision', ''), 'status', b.status)) from public.records b where b.id = any (boms || olds) and public.record_visible_for(me, b)), '[]'::jsonb),
    'unit', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'title', coalesce(u.data->>'number', u.title), 'status', u.status)) from public.records u
      where u.section = 'operations.builds' and (u.data->>'bom_ref' in (select x::text from unnest(boms || olds) x) or u.data->>'config_ref' in (select x::text from unnest(cfgs) x)) and public.record_visible_for(me, u)), '[]'::jsonb),
    'work_order', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'title', coalesce(w.data->>'number', '') || ' ' || w.title, 'status', w.status)) from public.records w
      where w.section = 'operations.work_orders' and w.status not in ('Completed', 'Cancelled') and w.data->>'build_ref' in (select u.id::text from public.records u where u.section = 'operations.builds' and u.data->>'bom_ref' in (select x::text from unnest(olds) x))
        and public.record_visible_for(me, w)), '[]'::jsonb),
    'item', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', coalesce(i.data->>'number', '') || ' ' || i.title)) from public.records i where i.id = any (items) and public.record_visible_for(me, i)), '[]'::jsonb),
    'document', coalesce((select jsonb_agg(distinct jsonb_build_object('id', d.id, 'title', d.title)) from public.records c, jsonb_array_elements(coalesce(c.data->'documents', '[]'::jsonb)) x join public.records d on d.id = public.as_uuid(x->>'doc_ref')
      where c.id = any (cfgs) and public.record_visible_for(me, d)), '[]'::jsonb),
    'test_procedure', coalesce((select jsonb_agg(distinct jsonb_build_object('id', t.id, 'title', coalesce(t.data->>'code', '') || ' v' || coalesce(t.data->>'version', '') || ' ' || t.title)) from public.records c, jsonb_array_elements_text(coalesce(c.data->'required_tests', '[]'::jsonb)) code
      join public.records t on t.section = 'technical.test_procedures' and t.data->>'code' = code and t.status = 'Approved' where c.id = any (cfgs) and public.record_visible_for(me, t)), '[]'::jsonb),
    'inventory', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', coalesce(i.data->>'number', '') || ' ' || i.title, 'qty', (select sum(s.qty) from public.mfg_stock s where s.item_id = i.id)))
      from public.records i where i.id = any (items) and exists (select 1 from public.mfg_stock s where s.item_id = i.id and s.qty > 0) and public.record_visible_for(me, i)), '[]'::jsonb),
    'purchase', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', coalesce(r.data->>'number', '') || ' ' || r.title, 'status', r.status)) from public.records r
      where r.section = 'operations.requests' and public.as_uuid(r.data->>'item_ref') = any (items) and r.status not in ('Closed', 'Rejected', 'Cancelled') and public.record_visible_for(me, r)), '[]'::jsonb),
    'confirmed', coalesce((select jsonb_agg(jsonb_build_object('kind', o.kind, 'id', o.object_id, 'by', public._wf_name(o.confirmed_by), 'at', o.confirmed_at, 'note', o.note)) from public.mfg_ecr_objects o where o.ecr_id = e.id and o.confirmed_at is not null), '[]'::jsonb));
end $$;
revoke execute on function public.mfg_ecr_candidates(uuid) from public, anon;
grant execute on function public.mfg_ecr_candidates(uuid) to authenticated;

create or replace function public.mfg_ecr_confirm(p_ecr uuid, p_objects jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); e public.records; x jsonb; n int := 0; r public.records;
begin
  if not (public.has_cap(me, 'engineering_change_approver') or public.has_cap(me, 'bom_editor')) then perform public._mfg_need(me, 'engineering_change_approver', 'Confirming the impact of a change'); end if;
  e := public._mfg_rec(me, p_ecr, 'technical.changes', 'Engineering change', true);
  for x in select * from jsonb_array_elements(coalesce(p_objects, '[]'::jsonb)) loop
    if x->>'kind' not in ('configuration', 'bom', 'item', 'document', 'test_procedure', 'unit', 'work_order', 'inventory', 'purchase') then raise exception 'Unknown kind %', x->>'kind' using errcode = '22023'; end if;
    select * into r from public.records where id = public.as_uuid(x->>'id');
    if not found or not public.record_visible_for(me, r) then raise exception 'Object not found (%)', x->>'kind' using errcode = 'P0002'; end if;
    insert into public.mfg_ecr_objects(ecr_id, kind, object_id, confirmed_by, confirmed_at, note) values (e.id, x->>'kind', r.id, me, now(), left(x->>'note', 500))
      on conflict (ecr_id, kind, object_id) do update set confirmed_by = me, confirmed_at = now(), note = coalesce(excluded.note, public.mfg_ecr_objects.note);
    n := n + 1;
  end loop;
  perform public._mfg_sys_patch(e.id, null, jsonb_build_object('mfg_impact_confirmed_at', now(), 'mfg_impact_confirmed_by', public._wf_name(me), 'mfg_impact_objects', (select count(*) from public.mfg_ecr_objects where ecr_id = e.id and confirmed_at is not null)));
  perform public._mfg_audit(me, 'ecr_impact_confirmed', e.id, null, jsonb_build_object('objects', n));
  return jsonb_build_object('ok', true, 'confirmed', n);
end $$;
revoke execute on function public.mfg_ecr_confirm(uuid, jsonb) from public, anon;
grant execute on function public.mfg_ecr_confirm(uuid, jsonb) to authenticated;

-- the builds a newer approved BOM revision reaches (by its effectivity); completed units are never retrofitted
create or replace function public._mfg_affected(p_bom uuid) returns table (unit_id uuid, state text) language sql stable security definer set search_path = public as $$
  select u.id, case when public._mfg_unit_done(u) then 'completed — not changed (no automatic retrofit)'
                    when u.data->>'bom_ref' = p_bom::text then 'incorporated'
                    when exists (select 1 from public.mfg_unit_dispositions d where d.unit_id = u.id and d.bom_id = p_bom) then 'decided'
                    else 'needs a decision' end
  from public.records n join public.records u on u.section = 'operations.builds' and coalesce(u.data->>'config_code', '~') = coalesce(n.data->>'config_code', '') and coalesce(u.data->>'released_at', '') <> ''
  where n.id = p_bom and n.status = 'Approved' and u.data->>'bom_ref' is distinct from null
    and case coalesce(n.data->'effectivity'->>'kind', 'all_future')
          when 'all_future' then u.data->>'bom_ref' = p_bom::text
          when 'immediate' then true
          when 'after_unit' then coalesce((u.data->>'unit_seq')::int, 0) >= coalesce((n.data->'effectivity'->>'from_seq')::int, 0)
          when 'units' then coalesce(n.data->'effectivity'->'units', '[]'::jsonb) ? u.id::text
          else false end
$$;
revoke execute on function public._mfg_affected(uuid) from public, anon, authenticated;

create or replace function public.mfg_change_impact(p_ecr uuid) returns jsonb language plpgsql volatile security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); e public.records; boms uuid[]; cmp jsonb := '[]'::jsonb; b uuid; old uuid; removed uuid[] := '{}';
begin
  e := public._mfg_rec(me, p_ecr, 'technical.changes', 'Engineering change');
  boms := array(select x.id from public.records x where x.section = 'technical.boms' and x.data->>'ecr_ref' = e.id::text and public.record_visible_for(me, x));
  foreach b in array boms loop
    select public.as_uuid(data->>'supersedes_ref') into old from public.records where id = b;
    if old is not null then
      cmp := cmp || jsonb_build_array(public.mfg_bom_compare(old, b));
      removed := removed || array(select l.item_id from public.mfg_bom_lines l where l.bom_id = old and l.item_id not in (select item_id from public.mfg_bom_lines where bom_id = b));
    end if;
  end loop;
  return jsonb_build_object('ecr', jsonb_build_object('id', e.id, 'number', e.data->>'number', 'title', e.title, 'status', e.status),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.data->>'number', 'revision', x.data->>'revision', 'status', x.status, 'effectivity', x.data->'effectivity')) from public.records x where x.id = any (boms)), '[]'::jsonb),
    'bom_changes', cmp,
    'affected_builds', coalesce((select jsonb_agg(jsonb_build_object('unit', u.id, 'number', u.data->>'number', 'status', u.status, 'pinned', u.data->>'bom_revision', 'state', a.state, 'bom', x.id,
        'decision', (select jsonb_build_object('decision', d.decision, 'by', public._wf_name(d.decided_by), 'at', d.decided_at, 'note', d.note) from public.mfg_unit_dispositions d where d.unit_id = u.id and d.bom_id = x.id)) order by u.data->>'number')
      from public.records x cross join lateral public._mfg_affected(x.id) a join public.records u on u.id = a.unit_id where x.id = any (boms) and public.record_visible_for(me, u)), '[]'::jsonb),
    'open_work_orders', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'number', w.data->>'number', 'title', w.title, 'status', w.status, 'unit', w.data->>'build_ref_title'))
      from public.records w where w.section = 'operations.work_orders' and w.status not in ('Completed', 'Cancelled') and public.record_visible_for(me, w)
        and public.as_uuid(w.data->>'build_ref') in (select a.unit_id from public.records x cross join lateral public._mfg_affected(x.id) a where x.id = any (boms) and a.state = 'needs a decision')), '[]'::jsonb),
    'purchased_material', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.data->>'number', 'title', r.title, 'status', r.status)) from public.records r
      where r.section in ('operations.requests') and public.as_uuid(r.data->>'item_ref') = any (removed) and r.status not in ('Closed', 'Rejected', 'Cancelled') and public.record_visible_for(me, r)), '[]'::jsonb),
    'inventory', coalesce((select jsonb_agg(jsonb_build_object('item', i.id, 'number', i.data->>'number', 'title', i.title, 'qty', (select sum(s.qty) from public.mfg_stock s where s.item_id = i.id)))
      from public.records i where i.id = any (removed) and exists (select 1 from public.mfg_stock s where s.item_id = i.id and s.qty > 0) and public.record_visible_for(me, i)), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', o.object_id, 'title', d.title)) from public.mfg_ecr_objects o join public.records d on d.id = o.object_id where o.ecr_id = e.id and o.kind = 'document' and public.record_visible_for(me, d)), '[]'::jsonb),
    'tests', coalesce((select jsonb_agg(jsonb_build_object('id', o.object_id, 'title', d.title)) from public.mfg_ecr_objects o join public.records d on d.id = o.object_id where o.ecr_id = e.id and o.kind = 'test_procedure' and public.record_visible_for(me, d)), '[]'::jsonb),
    'asbuilt_impact', 'Completed units keep their As-Built; a unit that incorporates the change shows the new revision in its next As-Built. Nothing changes without a recorded decision.',
    'confirmed', coalesce((select jsonb_agg(jsonb_build_object('kind', o.kind, 'id', o.object_id)) from public.mfg_ecr_objects o where o.ecr_id = e.id and o.confirmed_at is not null), '[]'::jsonb));
end $$;
revoke execute on function public.mfg_change_impact(uuid) from public, anon;
grant execute on function public.mfg_change_impact(uuid) to authenticated;

-- the decision for one affected build: incorporate (re-pin to the new revision) or keep the current one
create or replace function public.mfg_unit_disposition(p_bom uuid, p_unit uuid, p_decision text, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); b public.records; u public.records; c public.records; st text;
begin
  perform public._mfg_need(me, 'engineering_change_approver', 'Deciding how a change applies to a build');
  b := public._mfg_rec(me, p_bom, 'technical.boms', 'BOM revision');
  u := public._mfg_unit(me, p_unit, true);
  select a.state into st from public._mfg_affected(b.id) a where a.unit_id = u.id;
  if st is null then raise exception 'This revision''s effectivity does not reach this unit' using errcode = '23514'; end if;
  if p_decision not in ('Incorporate', 'Keep current') then raise exception 'Decide Incorporate or Keep current' using errcode = '22023'; end if;
  if public._mfg_unit_done(u) then raise exception 'The unit is completed: it keeps its configuration (no automatic retrofit; a retrofit is its own change)' using errcode = '55000'; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Give the reason (at least 5 characters)' using errcode = '23514'; end if;
  insert into public.mfg_unit_dispositions(ecr_id, bom_id, unit_id, decision, from_bom, to_bom, decided_by, note)
  values (public.as_uuid(b.data->>'ecr_ref'), b.id, u.id, p_decision, public.as_uuid(u.data->>'bom_ref'), case when p_decision = 'Incorporate' then b.id end, me, left(trim(p_note), 1000))
  on conflict (bom_id, unit_id) do update set decision = excluded.decision, to_bom = excluded.to_bom, decided_by = me, decided_at = now(), note = excluded.note;
  if p_decision = 'Incorporate' and u.data->>'bom_ref' is distinct from b.id::text then
    select * into c from public.records where id = public.as_uuid(u.data->>'config_ref');
    perform public._mfg_pin(u.id, me, c, b, 'engineering change ' || coalesce((select data->>'number' from public.records where id = public.as_uuid(b.data->>'ecr_ref')), ''));
  end if;
  perform public._mfg_audit(me, 'ecr_disposition', u.id, u.id, jsonb_build_object('bom', b.id, 'decision', p_decision, 'note', left(trim(p_note), 300)));
  return jsonb_build_object('ok', true, 'decision', p_decision);
end $$;
revoke execute on function public.mfg_unit_disposition(uuid, uuid, text, text) from public, anon;
grant execute on function public.mfg_unit_disposition(uuid, uuid, text, text) to authenticated;

/* ----- blockers and readiness: deterministic rules; each reason says what and where (for the viewer's records) ----- */
create or replace function public._mfg_blockers(u public.records, p_viewer uuid) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare out jsonb := '[]'::jsonb; x record; c public.records; b public.records; rt jsonb := public._mfg_routing(u); k text; lastr text; t record;
  add_ jsonb;
begin
  select * into c from public.records where id = public.as_uuid(u.data->>'config_ref');
  select * into b from public.records where id = public.as_uuid(u.data->>'bom_ref');
  if c.id is null then out := out || jsonb_build_array(jsonb_build_object('kind', 'missing_approval', 'level', 'block', 'text', 'No configuration chosen'));
  elsif c.status not in ('Approved', 'Superseded') then out := out || jsonb_build_array(jsonb_build_object('kind', 'missing_approval', 'level', 'block', 'text', 'Configuration ' || coalesce(c.data->>'code', '') || ' v' || coalesce(c.data->>'version', '') || ' is ' || c.status)); end if;
  if coalesce(u.data->>'released_at', '') = '' then out := out || jsonb_build_array(jsonb_build_object('kind', 'missing_approval', 'level', 'block', 'text', 'Not released (configuration and BOM revision not pinned)'));
  elsif b.status not in ('Approved', 'Superseded') then out := out || jsonb_build_array(jsonb_build_object('kind', 'missing_approval', 'level', 'block', 'text', 'BOM ' || coalesce(b.data->>'number', '') || ' rev ' || coalesce(b.data->>'revision', '') || ' is ' || b.status)); end if;
  -- material: missing (no order covers it), late purchases, rejected or quarantined material received for this unit
  if b.id is not null then
    for x in select r.*, i.data->>'number' num, i.title ttl, coalesce((i.data->>'critical')::boolean, false) crit from public._mfg_req(u.id, p_viewer) r join public.records i on i.id = r.item_id
             where (p_viewer is null or public.record_visible_for(p_viewer, i)) and r.required > 0 loop
      if x.required - x.consumed - x.allocated - x.free_available > 0 and x.ordered + x.requested < x.required - x.consumed - x.allocated - x.free_available then
        out := out || jsonb_build_array(jsonb_build_object('kind', 'missing_material', 'level', 'block', 'item', x.item_id, 'critical', x.crit,
          'text', 'Missing ' || trim_scale(x.required - x.consumed - x.allocated - x.free_available - x.ordered - x.requested) || ' × ' || x.num || ' ' || x.ttl || ' (not in stock, not ordered)'));
      end if;
      if x.late then out := out || jsonb_build_array(jsonb_build_object('kind', 'late_purchase', 'level', 'block', 'item', x.item_id, 'text', 'Purchase late for ' || x.num || ' ' || x.ttl || ' (expected ' || x.expected || ')')); end if;
    end loop;
    for x in select t2.item_id, i.data->>'number' num, sum(t2.qty) q, t2.to_state from public.mfg_txns t2 join public.records i on i.id = t2.item_id
             where t2.unit_id = u.id and t2.kind in ('inspect', 'state') and t2.to_state in ('Rejected', 'Quarantine') and (p_viewer is null or public.record_visible_for(p_viewer, i)) group by t2.item_id, i.data->>'number', t2.to_state loop
      out := out || jsonb_build_array(jsonb_build_object('kind', 'rejected_material', 'level', 'attention', 'item', x.item_id, 'text', trim_scale(x.q) || ' × ' || x.num || ' ' || lower(x.to_state) || ' at inspection'));
    end loop;
  end if;
  -- quality: unresolved nonconformance, the latest result of each inspection kind, failed required tests
  for x in select s.id, s.data->>'number' num, s.title, s.status from public.records s where s.section = 'company.issues' and s.data->>'build_ref' = u.id::text and s.status not in ('Closed', 'Cancelled') and (p_viewer is null or public.record_visible_for(p_viewer, s)) loop
    out := out || jsonb_build_array(jsonb_build_object('kind', 'nonconformance', 'level', 'block', 'ref', x.id, 'text', 'Open issue ' || coalesce(x.num, '') || ': ' || x.title || ' (' || x.status || ')'));
  end loop;
  for x in select distinct on (q.data->>'inspection_kind') q.id, q.data->>'inspection_kind' kind, q.data->>'result' res, q.data->>'number' num from public.records q
           where q.section = 'operations.quality' and q.data->>'build_ref' = u.id::text and coalesce(q.data->>'recorded_at', '') <> '' and (p_viewer is null or public.record_visible_for(p_viewer, q))
           order by q.data->>'inspection_kind', q.data->>'recorded_at' desc loop
    if x.res = 'Fail' then out := out || jsonb_build_array(jsonb_build_object('kind', 'failed_inspection', 'level', 'block', 'ref', x.id, 'text', x.kind || ' failed (' || coalesce(x.num, '') || ') — no passed reinspection yet')); end if;
  end loop;
  for k in select jsonb_array_elements_text(coalesce(c.data->'required_tests', '[]'::jsonb)) loop
    select t3.id, t3.data->>'outcome' o, t3.data->>'number' num into t from public.records t3 where t3.section = 'technical.testing' and t3.data->>'build_ref' = u.id::text and t3.data->>'procedure_code' = k
      and coalesce(t3.data->>'recorded_at', '') <> '' and (p_viewer is null or public.record_visible_for(p_viewer, t3)) order by t3.data->>'recorded_at' desc limit 1;
    if t.o = 'Fail' then out := out || jsonb_build_array(jsonb_build_object('kind', 'failed_test', 'level', 'block', 'ref', t.id, 'text', 'Required test ' || k || ' failed (' || coalesce(t.num, '') || ')')); end if;
    t := null;
  end loop;
  -- work: blocked work orders, missing or changed instructions
  for x in select w.id, w.data->>'number' num, w.title, w.data->>'blocked_reason' br, w.status, w.data->'documents' docs from public.records w
           where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status not in ('Completed', 'Cancelled') and (p_viewer is null or public.record_visible_for(p_viewer, w)) loop
    if x.status = 'Blocked' then out := out || jsonb_build_array(jsonb_build_object('kind', 'blocked_work', 'level', 'block', 'ref', x.id, 'text', 'Work blocked: ' || coalesce(x.num, '') || ' — ' || coalesce(x.br, ''))); end if;
    if exists (select 1 from jsonb_array_elements(coalesce(x.docs, '[]'::jsonb)) d where coalesce(d->>'version_id', '') = '') then
      out := out || jsonb_build_array(jsonb_build_object('kind', 'missing_document', 'level', 'block', 'ref', x.id, 'text', 'No approved version of an instruction for ' || coalesce(x.num, x.title)));
    end if;
  end loop;
  for x in select w.id, w.data->>'number' num from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status not in ('Completed', 'Cancelled')
           and (p_viewer is null or public.record_visible_for(p_viewer, w)) and jsonb_array_length(public._mfg_doc_stale(w)) > 0 loop
    out := out || jsonb_build_array(jsonb_build_object('kind', 'instruction_changed', 'level', 'attention', 'ref', x.id, 'text', 'A newer approved instruction exists for ' || coalesce(x.num, '') || ' (it keeps its version until moved)'));
  end loop;
  -- engineering change: a newer revision reaches this unit and no decision is recorded
  for x in select n.id, n.data->>'number' num, n.data->>'revision' rev from public.records n where n.section = 'technical.boms' and n.status = 'Approved' and n.data->>'config_code' = u.data->>'config_code'
           and n.id::text is distinct from u.data->>'bom_ref' and coalesce(n.data->>'ecr_ref', '') <> '' and exists (select 1 from public._mfg_affected(n.id) a where a.unit_id = u.id and a.state = 'needs a decision') loop
    out := out || jsonb_build_array(jsonb_build_object('kind', 'ecr_impact', 'level', 'block', 'ref', x.id, 'text', 'Engineering change: BOM ' || coalesce(x.num, '') || ' rev ' || coalesce(x.rev, '') || ' applies to this unit — decide Incorporate or Keep current'));
  end loop;
  return out;
end $$;
revoke execute on function public._mfg_blockers(public.records, uuid) from public, anon, authenticated;

-- build readiness before assembly: approved configuration and BOM, documents, critical material, routing, work orders, team
create or replace function public._mfg_build_readiness(u public.records, p_viewer uuid default null) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare v uuid := p_viewer; r jsonb := '[]'::jsonb; bl jsonb; x jsonb; c public.records; d jsonb; n int;
begin
  bl := public._mfg_blockers(u, v);
  for x in select * from jsonb_array_elements(bl) loop
    if x->>'kind' in ('missing_approval', 'missing_document', 'ecr_impact') then r := r || jsonb_build_array(x);
    elsif x->>'kind' in ('missing_material', 'late_purchase') then r := r || jsonb_build_array(x || jsonb_build_object('level', case when coalesce((x->>'critical')::boolean, false) then 'block' else 'attention' end));
    elsif x->>'kind' in ('rejected_material', 'instruction_changed', 'nonconformance', 'blocked_work') then r := r || jsonb_build_array(x || jsonb_build_object('level', 'attention'));
    end if;
  end loop;
  select * into c from public.records where id = public.as_uuid(u.data->>'config_ref');
  for d in select * from jsonb_array_elements(coalesce(c.data->'required_documents', '[]'::jsonb)) loop
    if public._mfg_doc_current(public.as_uuid(d->>'doc_ref')) is null then r := r || jsonb_build_array(jsonb_build_object('kind', 'missing_document', 'level', 'block', 'text', 'Required document without an approved version: ' || coalesce(d->>'title', d->>'doc_ref'))); end if;
  end loop;
  if jsonb_array_length(public._mfg_routing(u)) = 0 then r := r || jsonb_build_array(jsonb_build_object('kind', 'routing', 'level', 'block', 'text', 'No routing for this configuration')); end if;
  select count(*) into n from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status <> 'Cancelled';
  if n = 0 then r := r || jsonb_build_array(jsonb_build_object('kind', 'work_orders', 'level', 'block', 'text', 'No work orders yet (create them from the routing)'));
  elsif exists (select 1 from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status not in ('Cancelled', 'Completed')
                  and coalesce(w.data->>'assignee_id', '') = '' and coalesce(w.data->>'team', '') = '' and coalesce(jsonb_array_length(w.data->'team_ids'), 0) = 0) then
    r := r || jsonb_build_array(jsonb_build_object('kind', 'team', 'level', 'attention', 'text', 'Work orders without a person or team'));
  end if;
  if coalesce(u.data->>'owner_id', u.data->>'manufacturing_owner_id', '') = '' then r := r || jsonb_build_array(jsonb_build_object('kind', 'team', 'level', 'block', 'text', 'No manufacturing owner')); end if;
  return jsonb_build_object('status', case when exists (select 1 from jsonb_array_elements(r) z where z->>'level' = 'block') then 'Not Ready' when jsonb_array_length(r) > 0 then 'Attention' else 'Ready' end, 'reasons', r);
end $$;
revoke execute on function public._mfg_build_readiness(public.records, uuid) from public, anon, authenticated;

-- acceptance readiness before Ready for Shipment
create or replace function public._mfg_acceptance_readiness(u public.records, p_viewer uuid) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare r jsonb := '[]'::jsonb; c public.records; k text; t record; q record; a public.mfg_asbuilt; live text; d jsonb; appr boolean := coalesce((public.mfg_cfg()->>'test_approval_required')::boolean, true); n int;
begin
  select * into c from public.records where id = public.as_uuid(u.data->>'config_ref');
  if coalesce(u.data->>'released_at', '') = '' then r := r || jsonb_build_array(jsonb_build_object('kind', 'release', 'level', 'block', 'text', 'The unit is not released')); end if;
  select count(*) into n from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status not in ('Completed', 'Cancelled');
  if n > 0 then r := r || jsonb_build_array(jsonb_build_object('kind', 'work', 'level', 'block', 'text', n || ' work order(s) not completed')); end if;
  if not exists (select 1 from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status = 'Completed') then
    r := r || jsonb_build_array(jsonb_build_object('kind', 'work', 'level', 'block', 'text', 'No completed work recorded'));
  end if;
  for k in select jsonb_array_elements_text(coalesce(nullif(c.data->'required_inspections', '[]'::jsonb), public.mfg_cfg()->'required_inspections_default', '[]'::jsonb)) loop
    select x.data->>'result' res, x.data->>'number' num into q from public.records x where x.section = 'operations.quality' and x.data->>'build_ref' = u.id::text and x.data->>'inspection_kind' = k
      and coalesce(x.data->>'recorded_at', '') <> '' and public.record_visible_for(p_viewer, x) order by x.data->>'recorded_at' desc limit 1;
    if q.res is null then r := r || jsonb_build_array(jsonb_build_object('kind', 'inspection', 'level', 'block', 'text', 'Required ' || k || ' not recorded'));
    elsif q.res = 'Fail' then r := r || jsonb_build_array(jsonb_build_object('kind', 'inspection', 'level', 'block', 'text', 'Required ' || k || ' failed (' || coalesce(q.num, '') || ')'));
    elsif q.res = 'Conditional' then r := r || jsonb_build_array(jsonb_build_object('kind', 'inspection', 'level', 'attention', 'text', k || ' passed with conditions (' || coalesce(q.num, '') || ')')); end if;
    q := null;
  end loop;
  for k in select jsonb_array_elements_text(coalesce(c.data->'required_tests', '[]'::jsonb)) loop
    select x.data->>'outcome' o, x.data->>'number' num, coalesce(x.data->>'approved_at', '') <> '' ap into t from public.records x where x.section = 'technical.testing' and x.data->>'build_ref' = u.id::text
      and x.data->>'procedure_code' = k and coalesce(x.data->>'recorded_at', '') <> '' and public.record_visible_for(p_viewer, x) order by x.data->>'recorded_at' desc limit 1;
    if t.o is null then r := r || jsonb_build_array(jsonb_build_object('kind', 'test', 'level', 'block', 'text', 'Required test ' || k || ' not run'));
    elsif t.o in ('Fail', 'Aborted') then r := r || jsonb_build_array(jsonb_build_object('kind', 'test', 'level', 'block', 'text', 'Required test ' || k || ' ' || lower(case when t.o = 'Fail' then 'failed' else 'aborted' end) || ' (' || coalesce(t.num, '') || ')'));
    elsif appr and not t.ap then r := r || jsonb_build_array(jsonb_build_object('kind', 'test', 'level', 'block', 'text', 'Required test ' || k || ' is not approved by a Test Approver (' || coalesce(t.num, '') || ')'));
    elsif t.o = 'Conditional' then r := r || jsonb_build_array(jsonb_build_object('kind', 'test', 'level', 'attention', 'text', 'Required test ' || k || ' passed with conditions'));
    end if;
    t := null;
  end loop;
  for q in select s.data->>'number' num, s.title, s.status from public.records s where s.section = 'company.issues' and s.data->>'build_ref' = u.id::text and s.status not in ('Closed', 'Cancelled') and public.record_visible_for(p_viewer, s) loop
    r := r || jsonb_build_array(jsonb_build_object('kind', 'nonconformance', 'level', 'block', 'text', 'Issue ' || coalesce(q.num, '') || ' is ' || q.status || ' (close it or accept it formally)'));
  end loop;
  select * into a from public.mfg_asbuilt where unit_id = u.id order by revision desc limit 1;
  if a.id is null then r := r || jsonb_build_array(jsonb_build_object('kind', 'asbuilt', 'level', 'block', 'text', 'As-Built not generated'));
  elsif a.hash <> public._mfg_asbuilt_hash(public._mfg_asbuilt_build(u.id)) then r := r || jsonb_build_array(jsonb_build_object('kind', 'asbuilt', 'level', 'block', 'text', 'As-Built revision ' || a.revision || ' is out of date (the unit changed since): generate it again')); end if;
  for d in select * from jsonb_array_elements(coalesce(c.data->'required_documents', '[]'::jsonb)) loop
    if public._mfg_doc_current(public.as_uuid(d->>'doc_ref')) is null then r := r || jsonb_build_array(jsonb_build_object('kind', 'document', 'level', 'block', 'text', 'Required document without an approved version: ' || coalesce(d->>'title', ''))); end if;
  end loop;
  if coalesce(u.data->>'destination', u.data->>'site', '') = '' then r := r || jsonb_build_array(jsonb_build_object('kind', 'shipment', 'level', 'block', 'text', 'No shipment destination')); end if;
  if coalesce(u.data->>'export_check', '') <> 'Cleared' then r := r || jsonb_build_array(jsonb_build_object('kind', 'shipment', 'level', 'block', 'text', 'Export / end-user check is not Cleared (' || coalesce(u.data->>'export_check', 'not started') || ')')); end if;
  return jsonb_build_object('status', case when exists (select 1 from jsonb_array_elements(r) z where z->>'level' = 'block') then 'Not Ready' when jsonb_array_length(r) > 0 then 'Attention' else 'Ready' end, 'reasons', r);
end $$;
revoke execute on function public._mfg_acceptance_readiness(public.records, uuid) from public, anon, authenticated;

create or replace function public.mfg_readiness(p_unit uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records;
begin
  u := public._mfg_unit(me, p_unit);
  return jsonb_build_object('build', public._mfg_build_readiness(u, me), 'acceptance', public._mfg_acceptance_readiness(u, me), 'blockers', public._mfg_blockers(u, me), 'shipping', public._mfg_shipping_readiness(u));
end $$;
revoke execute on function public.mfg_readiness(uuid) from public, anon;
grant execute on function public.mfg_readiness(uuid) to authenticated;

/* ----- unit acceptance (internal; not a certification), shipping readiness and the shipment release ----- */
create or replace function public.mfg_accept(p_unit uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; rd jsonb; a public.mfg_asbuilt; v_id uuid; st text; x jsonb; acks text[] := '{}';
begin
  perform public._mfg_need(me, 'unit_acceptance_approver', 'Accepting a unit');
  u := public._mfg_unit(me, p_unit, true);
  if exists (select 1 from public.mfg_acceptance x2 where x2.unit_id = u.id and x2.status <> 'Rejected') then raise exception 'The unit is accepted already' using errcode = '23505'; end if;
  st := coalesce(p->>'status', 'Accepted');
  if st not in ('Accepted', 'Accepted with exceptions', 'Rejected') then raise exception 'Status is Accepted, Accepted with exceptions or Rejected' using errcode = '22023'; end if;
  rd := public._mfg_acceptance_readiness(u, me);
  if st <> 'Rejected' then
    if rd->>'status' = 'Not Ready' then raise exception 'Not ready for acceptance: %', (select string_agg(z->>'text', '; ') from jsonb_array_elements(rd->'reasons') z where z->>'level' = 'block') using errcode = '23514'; end if;
    if rd->>'status' = 'Attention' then
      if st <> 'Accepted with exceptions' then raise exception 'Some points need attention: accept with exceptions and record each one (%)', (select string_agg(z->>'text', '; ') from jsonb_array_elements(rd->'reasons') z) using errcode = '23514'; end if;
      if jsonb_array_length(coalesce(p->'exceptions', '[]'::jsonb)) < jsonb_array_length(rd->'reasons') then raise exception 'Record an exception (what and why) for each point that needs attention' using errcode = '23514'; end if;
    end if;
  elsif length(trim(coalesce(p->>'note', ''))) < 5 then raise exception 'Say why the unit is not accepted (at least 5 characters)' using errcode = '23514';
  end if;
  select * into a from public.mfg_asbuilt where unit_id = u.id order by revision desc limit 1;
  insert into public.mfg_acceptance(unit_id, accepted_by, status, checklist, exceptions, documents, asbuilt_id, readiness, note)
  values (u.id, me, st, coalesce(p->'checklist', '[]'::jsonb), coalesce(p->'exceptions', '[]'::jsonb), coalesce(p->'documents', '[]'::jsonb), a.id, rd, left(p->>'note', 2000))
  returning mfg_acceptance.id into v_id;
  if st <> 'Rejected' then
    perform public._mfg_sys_patch(u.id, 'Ready for Shipment', jsonb_build_object('accepted_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'acceptance_ref', v_id, 'accepted_by', public._wf_name(me)));
  end if;
  perform public._mfg_audit(me, 'unit_acceptance', u.id, u.id, jsonb_build_object('status', st, 'asbuilt_revision', a.revision, 'exceptions', jsonb_array_length(coalesce(p->'exceptions', '[]'::jsonb))));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', st, 'asbuilt_revision', a.revision,
    'note', 'Internal unit acceptance by AGRON. It is not an external certification or a regulator''s approval unless such a record is attached and named.');
end $$;
revoke execute on function public.mfg_accept(uuid, jsonb) from public, anon;
grant execute on function public.mfg_accept(uuid, jsonb) to authenticated;

create or replace function public._mfg_shipping_readiness(u public.records) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb := coalesce(u.data->'shipping', '{}'::jsonb); r jsonb := '[]'::jsonb; d text;
begin
  if not exists (select 1 from public.mfg_acceptance a where a.unit_id = u.id and a.status <> 'Rejected') then r := r || jsonb_build_array(jsonb_build_object('level', 'block', 'text', 'The unit is not accepted')); end if;
  if coalesce(u.data->>'destination', u.data->>'site', '') = '' then r := r || jsonb_build_array(jsonb_build_object('level', 'block', 'text', 'No destination')); end if;
  if coalesce(s->>'requested_date', '') = '' then r := r || jsonb_build_array(jsonb_build_object('level', 'block', 'text', 'No requested ship date')); end if;
  if coalesce(s->>'packing', '') <> 'Packed' then r := r || jsonb_build_array(jsonb_build_object('level', 'block', 'text', 'Packing: ' || coalesce(s->>'packing', 'not started'))); end if;
  if coalesce(s->>'logistics_owner_id', '') = '' then r := r || jsonb_build_array(jsonb_build_object('level', 'block', 'text', 'No logistics owner')); end if;
  for d in select jsonb_array_elements_text(coalesce(s->'documents_required', public.mfg_cfg()->'shipping_documents_default', '[]'::jsonb)) loop
    if not coalesce((s->'documents'->>d)::boolean, false) then r := r || jsonb_build_array(jsonb_build_object('level', 'block', 'text', 'Shipping document missing: ' || d)); end if;
  end loop;
  if coalesce(u.data->>'export_check', '') <> 'Cleared' then r := r || jsonb_build_array(jsonb_build_object('level', 'block', 'text', 'Export / end-user check is not Cleared')); end if;
  return jsonb_build_object('status', case when jsonb_array_length(r) > 0 then 'Not Ready' else 'Ready' end, 'reasons', r, 'shipping', s,
    'released', (select jsonb_build_object('at', x.released_at, 'by', public._wf_name(x.released_by), 'ship_date', x.ship_date, 'reference', x.reference, 'carrier', x.carrier) from public.mfg_releases x where x.unit_id = u.id order by x.released_at desc limit 1));
end $$;
revoke execute on function public._mfg_shipping_readiness(public.records) from public, anon, authenticated;

create or replace function public.mfg_shipping_save(p_unit uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; s jsonb; k text;
begin
  if not (public.has_cap(me, 'build_manager') or public._mfg_can_write(me, 'operations.builds')) then raise exception 'You cannot change shipping details' using errcode = '42501'; end if;
  u := public._mfg_unit(me, p_unit, true);
  if exists (select 1 from public.mfg_releases x where x.unit_id = u.id) then raise exception 'The shipment is released: its record is kept as released' using errcode = '55000'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('requested_date', 'packing', 'documents', 'documents_required', 'logistics_owner_id', 'carrier', 'reference', 'destination') then raise exception 'Unknown field %', k using errcode = '22023'; end if;
  end loop;
  if p ? 'packing' and p->>'packing' not in ('Not started', 'In progress', 'Packed') then raise exception 'Packing is Not started, In progress or Packed' using errcode = '22023'; end if;
  if public.as_uuid(p->>'logistics_owner_id') is not null and not public.is_active_employee(public.as_uuid(p->>'logistics_owner_id')) then raise exception 'The logistics owner must be an active employee' using errcode = '23514'; end if;
  s := coalesce(u.data->'shipping', '{}'::jsonb) || (p - 'destination');
  if s ? 'logistics_owner_id' then s := s || jsonb_build_object('logistics_owner', public._wf_name(public.as_uuid(s->>'logistics_owner_id'))); end if;
  perform public._mfg_sys_patch(u.id, null, jsonb_build_object('shipping', s) || case when p ? 'destination' then jsonb_build_object('destination', left(p->>'destination', 300), 'site', left(p->>'destination', 300)) else '{}'::jsonb end);
  return jsonb_build_object('ok', true, 'shipping', s);
end $$;
revoke execute on function public.mfg_shipping_save(uuid, jsonb) from public, anon;
grant execute on function public.mfg_shipping_save(uuid, jsonb) to authenticated;

-- the release of a shipment needs the Shipment Release Approver and an accepted unit that is ready to ship;
-- no carrier is booked by Workspace
create or replace function public.mfg_ship_release(p_unit uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); u public.records; rd jsonb; ac public.mfg_acceptance; v_id uuid;
begin
  perform public._mfg_need(me, 'shipment_release_approver', 'Releasing a shipment');
  u := public._mfg_unit(me, p_unit, true);
  select * into ac from public.mfg_acceptance where unit_id = u.id and status <> 'Rejected' order by accepted_at desc limit 1;
  if ac.id is null then raise exception 'The unit is not accepted' using errcode = '23514'; end if;
  if exists (select 1 from public.mfg_releases x where x.unit_id = u.id) then raise exception 'The shipment is released already' using errcode = '23505'; end if;
  rd := public._mfg_shipping_readiness(u);
  if rd->>'status' <> 'Ready' then raise exception 'Not ready to ship: %', (select string_agg(z->>'text', '; ') from jsonb_array_elements(rd->'reasons') z) using errcode = '23514'; end if;
  insert into public.mfg_releases(unit_id, released_by, destination, ship_date, carrier, reference, checks, acceptance_id)
  values (u.id, me, coalesce(u.data->>'destination', u.data->>'site'), coalesce(public._mfg_date(p->>'ship_date'), current_date), coalesce(nullif(p->>'carrier', ''), u.data->'shipping'->>'carrier'),
    coalesce(nullif(p->>'reference', ''), u.data->'shipping'->>'reference'), rd, ac.id) returning mfg_releases.id into v_id;
  perform public._mfg_sys_patch(u.id, 'Shipped', jsonb_build_object('released_shipment_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'shipping', coalesce(u.data->'shipping', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('actual_date', coalesce(public._mfg_date(p->>'ship_date'), current_date)::text, 'released_by', public._wf_name(me)))));
  perform public._mfg_audit(me, 'shipment_release', u.id, u.id, jsonb_build_object('release', v_id, 'ship_date', coalesce(public._mfg_date(p->>'ship_date'), current_date)));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'Shipped');
end $$;
revoke execute on function public.mfg_ship_release(uuid, jsonb) from public, anon;
grant execute on function public.mfg_ship_release(uuid, jsonb) to authenticated;

/* ----- operational cost (never accounting), operational inventory value, supplier facts ----- */
create or replace function public.mfg_unit_cost(p_unit uuid) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); u public.records;
begin
  u := public._mfg_unit(me, p_unit);
  if not public._mfg_cost_ok(me) then raise exception 'Costs are shown to those the cost policy names (Manufacturing → Settings)' using errcode = '42501'; end if;
  return (
    with req as (select r.item_id, r.required from public._mfg_req(u.id, me) r),
    items as (select i.id, public._num(i.data->'ref_cost') c, coalesce(i.data->>'currency', 'USD') cur, coalesce(i.data->>'item_type', '') typ from public.records i where i.section = 'technical.items' and public.record_visible_for(me, i)),
    planned as (select it.cur, sum(r.required * it.c) v, count(*) filter (where it.c is null) unknown from req r join items it on it.id = r.item_id group by it.cur),
    pos as (select po.*, rq.data->>'item_ref' item_ref, (select typ from items where items.id = public.as_uuid(rq.data->>'item_ref')) typ from public.records rq join public.records po on po.section = 'operations.procurement' and po.data->>'request_ref' = rq.id::text
            where rq.section = 'operations.requests' and rq.data->>'build_ref' = u.id::text and coalesce(po.status, '') <> 'Cancelled' and public.record_visible_for(me, po)),
    committed as (select coalesce(p.data->>'currency', 'USD') cur, sum(public._num(p.data->'amount')) v from pos p where p.typ is distinct from 'Service' group by 1),
    services as (select coalesce(p.data->>'currency', 'USD') cur, sum(public._num(p.data->'amount')) v from pos p where p.typ = 'Service' group by 1),
    received as (select coalesce(p.data->>'currency', 'USD') cur, sum(case when public._num(p.data->'qty') > 0 then public._num(p.data->'amount') * least(coalesce(public._num(p.data->'qty_received'), 0), public._num(p.data->'qty')) / public._num(p.data->'qty') end) v
                 from pos p group by 1),
    used as (select t.item_id, t.wo_id, sum(case when t.kind in ('consume', 'install') then t.qty when t.kind = 'remove' then -t.qty else 0 end) q from public.mfg_txns t where t.unit_id = u.id and t.kind in ('consume', 'install', 'remove') group by 1, 2),
    consumed as (select it.cur, sum(x.q * it.c) v, count(*) filter (where it.c is null) unknown from used x join items it on it.id = x.item_id group by it.cur),
    rework as (select it.cur, sum(x.q * it.c) v from used x join items it on it.id = x.item_id join public.records w on w.id = x.wo_id where coalesce(w.data->>'rework_of', '') <> '' group by it.cur),
    other as (select coalesce(e.data->>'currency', 'USD') cur, sum(public._num(e.data->'amount')) v from public.records e where e.section = 'finance.expenses' and e.data->>'build_ref' = u.id::text and e.status in ('Approved', 'Paid') and public.record_visible_for(me, e) group by 1),
    curs as (select cur from planned union select cur from committed union select cur from services union select cur from received union select cur from consumed union select cur from other)
    select jsonb_build_object('unit', u.id, 'label', 'Operational build cost — not accounting cost (no payroll burden, depreciation or tax)',
      'by_currency', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('currency', c.cur,
          'planned', (select round(v, 2) from planned where planned.cur = c.cur), 'planned_unknown_lines', (select nullif(unknown, 0) from planned where planned.cur = c.cur),
          'committed', (select round(v, 2) from committed where committed.cur = c.cur), 'external_services', (select round(v, 2) from services where services.cur = c.cur),
          'received', (select round(v, 2) from received where received.cur = c.cur), 'consumed', (select round(v, 2) from consumed where consumed.cur = c.cur),
          'rework', (select round(v, 2) from rework where rework.cur = c.cur), 'other_approved', (select round(v, 2) from other where other.cur = c.cur),
          'variance', round(coalesce((select v from consumed where consumed.cur = c.cur), 0) + coalesce((select v from services where services.cur = c.cur), 0) + coalesce((select v from other where other.cur = c.cur), 0)
                      - coalesce((select v from planned where planned.cur = c.cur), 0), 2))) order by c.cur) from curs c), '[]'::jsonb),
      'rules', 'Planned = required × reference cost; committed = purchase records for this unit; received = their received share; consumed = consumed and installed × reference cost; variance = consumed + services + other − planned. Currencies are never added together.'));
end $$;
revoke execute on function public.mfg_unit_cost(uuid) from public, anon;
grant execute on function public.mfg_unit_cost(uuid) to authenticated;

create or replace function public.mfg_inventory_value() returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer();
begin
  if not public._mfg_cost_ok(me) then raise exception 'Values are shown to those the cost policy names' using errcode = '42501'; end if;
  return jsonb_build_object('label', 'Operational Inventory Value — not an accounting inventory valuation',
    'by_currency', coalesce((select jsonb_agg(jsonb_build_object('currency', z.cur, 'reference_value', round(z.refv, 2), 'purchase_value', round(z.purv, 2), 'quantity', z.q, 'items', z.n, 'items_without_reference_cost', z.unknown) order by z.cur) from (
      select coalesce(i.data->>'currency', 'USD') cur, sum(s.qty * public._num(i.data->'ref_cost')) refv,
        sum(s.qty * (select avg(public._num(p.data->'amount') / nullif(public._num(p.data->'qty'), 0)) from public.records rq join public.records p on p.section = 'operations.procurement' and p.data->>'request_ref' = rq.id::text
                      where rq.section = 'operations.requests' and rq.data->>'item_ref' = i.id::text and coalesce(p.data->>'currency', 'USD') = coalesce(i.data->>'currency', 'USD'))) purv,
        sum(s.qty) q, count(distinct i.id) n, count(distinct i.id) filter (where public._num(i.data->'ref_cost') is null) unknown
      from public.mfg_stock s join public.records i on i.id = s.item_id where s.qty > 0 and public.record_visible_for(me, i) group by 1) z), '[]'::jsonb),
    'by_state', coalesce((select jsonb_object_agg(z.state, z.q) from (select s.state, sum(s.qty) q from public.mfg_stock s join public.records i on i.id = s.item_id where s.qty > 0 and public.record_visible_for(me, i) group by 1) z), '{}'::jsonb));
end $$;
revoke execute on function public.mfg_inventory_value() from public, anon;
grant execute on function public.mfg_inventory_value() to authenticated;

create or replace function public.mfg_supplier_performance(p_vendor uuid default null) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer();
begin
  if me is null or not public._mfg_can_read(me, 'operations.vendors') then raise exception 'Not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(z order by z->>'vendor') from (
    select jsonb_build_object('vendor_id', v.id, 'vendor', v.title,
      'orders', count(p.id),
      'on_time', count(p.id) filter (where public._mfg_date(p.data->>'last_received') is not null and public._mfg_date(p.data->>'eta') is not null and public._mfg_date(p.data->>'last_received') <= public._mfg_date(p.data->>'eta')),
      'late', count(p.id) filter (where public._mfg_date(p.data->>'eta') is not null and (public._mfg_date(p.data->>'last_received') > public._mfg_date(p.data->>'eta')
                                    or (coalesce(public._mfg_date(p.data->>'last_received'), current_date) > public._mfg_date(p.data->>'eta') and p.status in ('Approved', 'Ordered', 'Partially delivered')))),
      'without_promised_date', count(p.id) filter (where public._mfg_date(p.data->>'eta') is null),
      'rejected_receipts', (select count(*) from public.records rc where rc.section = 'operations.receipts' and rc.data->>'vendor_ref' = v.id::text and coalesce(public._num(rc.data->'qty_rejected'), 0) > 0 and public.record_visible_for(me, rc)),
      'open_issues', (select count(*) from public.records s where s.section = 'company.issues' and s.data->>'vendor_ref' = v.id::text and s.status not in ('Closed', 'Cancelled') and public.record_visible_for(me, s)),
      'avg_lead_time_days', round(avg(public._mfg_date(p.data->>'last_received') - p.created_at::date) filter (where public._mfg_date(p.data->>'last_received') is not null), 1),
      'note', 'Facts from purchase, receipt and issue records; no score') z
    from public.records v left join public.records p on p.section = 'operations.procurement' and p.data->>'vendor_ref' = v.id::text and public.record_visible_for(me, p)
    where v.section = 'operations.vendors' and (p_vendor is null or v.id = p_vendor) and public.record_visible_for(me, v)
    group by v.id, v.title having p_vendor is not null or count(p.id) > 0) q), '[]'::jsonb);
end $$;
revoke execute on function public.mfg_supplier_performance(uuid) from public, anon;
grant execute on function public.mfg_supplier_performance(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   15. Search: the Phase 8 objects by number, manufacturer part number, revision and serial — permission safe
       (generated from v24 corp_search; only the marked parts differ)
   --------------------------------------------------------------------------------------------- */
create or replace function public.corp_search(p_q text, p_types text[] default null, p_project uuid default null, p_department text default null, p_person uuid default null,
  p_doc_type text default null, p_from date default null, p_to date default null, p_classification text default null, p_status text default null, p_limit integer default 40)
returns table (kind text, id uuid, record_id uuid, section text, title text, excerpt text, project_ref text, version text, owner_id text, updated_at timestamptz, link text, rank real)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := auth.uid(); pr public.profiles; q text := lower(trim(coalesce(p_q, ''))); w1 text; tsq tsquery; lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  sec_kind jsonb := '{"company.documents":"document","company.wiki":"knowledge","company.projects":"project","company.tasks":"task","company.meetings":"meeting","company.decisions":"decision","company.announcements":"announcement","company.milestones":"milestone","company.parties":"organization","company.contacts":"contact","sales.pipeline":"opportunity","sales.proposals":"proposal","marketing.leads":"lead","sales.introductions":"introduction","sales.partners":"partner","technical.products":"product","technical.configurations":"configuration","technical.items":"item","technical.boms":"bom","technical.test_procedures":"test_procedure","operations.builds":"build_unit","operations.work_orders":"work_order","operations.quality":"inspection","technical.testing":"test","technical.changes":"ecr","company.issues":"issue"}';
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
      and r.section not in ('company.parties', 'company.contacts', 'sales.pipeline', 'sales.proposals', 'marketing.leads', 'sales.introductions', 'sales.partners', 'technical.products', 'technical.configurations', 'technical.items', 'technical.boms', 'technical.test_procedures', 'operations.builds', 'operations.work_orders', 'operations.quality', 'technical.testing', 'technical.changes', 'company.issues')
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
  ), mfg as (
    -- v25: manufacturing records by number, manufacturer part number, code, revision, name (own trigram index)
    select r.*, sec_kind->>r.section k from public.records r
    where r.section in ('technical.products', 'technical.configurations', 'technical.items', 'technical.boms', 'technical.test_procedures', 'operations.builds', 'operations.work_orders', 'operations.quality', 'technical.testing', 'technical.changes', 'company.issues')
      and (case when r.section in ('technical.changes', 'company.issues') then lower(r.title || ' ' || coalesce(r.data->>'number', '') || ' ' || coalesce(r.data->>'description', '') || ' ' || coalesce(r.data->>'reason', '')) else public.mfg_search_text(r.title, r.data) end) like '%' || w1 || '%'
      and (p_types is null or (sec_kind->>r.section) = any(p_types))
      and (p_project is null or r.data->>'project_ref' = p_project::text)
      and (p_status is null or r.status = p_status) and (p_from is null or r.updated_at >= p_from) and (p_to is null or r.updated_at < p_to + 1)
      and (p_person is null or r.created_by = p_person or p_person::text in (r.data->>'owner_id', r.data->>'assignee_id'))
      and p_department is null and p_doc_type is null and p_classification is null
    order by (lower(coalesce(r.data->>'number', '')) = q or lower(coalesce(r.data->>'mpn', '')) = q) desc, (lower(r.title) like '%' || q || '%') desc, r.updated_at desc
    limit 400
  ), mfgv as (select x.* from mfg x join public.records rr on rr.id = x.id where public.record_visible(rr)
      and not exists (select 1 from unnest(string_to_array(q, ' ')) w where w <> '' and position(w in (case when x.section in ('technical.changes', 'company.issues') then lower(x.title || ' ' || coalesce(x.data::text, '')) else public.mfg_search_text(x.title, x.data) end)) = 0)
    limit lim),
  serv as (
    -- v25: a serial of an item the person may open, not installed in a unit they may not open
    select sr.id, sr.serial, sr.state, i.id item_id, i.title ititle, i.data->>'number' inum, u.data->>'number' unum, sr.updated_at
    from public.mfg_serials sr join public.records i on i.id = sr.item_id left join public.records u on u.id = sr.unit_id
    where (p_types is null or 'serial' = any(p_types)) and p_project is null and p_department is null and p_doc_type is null and p_classification is null
      and lower(sr.serial || ' ' || coalesce(sr.agron_serial, '')) like '%' || w1 || '%' and public.record_visible(i) and (u.id is null or public.record_visible(u))
    order by (lower(sr.serial) = q) desc, sr.serial limit lim
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
  select x.k, x.id, x.id, x.section, x.title,
         left(concat_ws(' · ', x.status, x.data->>'number', case when x.data ? 'revision' then 'rev ' || (x.data->>'revision') end, nullif(x.data->>'mpn', ''), nullif(x.data->>'manufacturer', ''), nullif(x.data->>'build_ref_title', ''), nullif(x.data->>'product_ref_title', '')), 220),
         x.data->>'project_ref', coalesce(x.data->>'revision', x.data->>'version'), coalesce(x.data->>'owner_id', x.data->>'assignee_id', x.created_by::text), x.updated_at,
         case x.section when 'technical.items' then '/mfg?item=' || x.id when 'operations.builds' then '/mfg?unit=' || x.id when 'technical.boms' then '/mfg?bom=' || x.id
              when 'operations.work_orders' then '/build?wo=' || x.id when 'technical.products' then '/mfg?product=' || x.id when 'technical.configurations' then '/mfg?config=' || x.id
              else '/' || replace(x.section, '.', '/') || '?r=' || x.id end,
         (case when lower(coalesce(x.data->>'number', '')) = q or lower(coalesce(x.data->>'mpn', '')) = q then 3 when lower(x.title) like '%' || q || '%' then 2 else 1 end)::real
  from mfgv x
  union all
  select 'serial', s.id, s.item_id, 'technical.items', s.serial || ' · ' || s.ititle, concat_ws(' · ', s.inum, s.state, case when s.unum is not null then 'in ' || s.unum end),
         null, null, null, s.updated_at, '/mfg?serial=' || s.id, (case when lower(s.serial) = q then 3 else 1.5 end)::real
  from serv s
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

revoke execute on function public.corp_search(text, text[], uuid, text, uuid, text, date, date, text, text, integer) from public, anon;
grant execute on function public.corp_search(text, text[], uuid, text, uuid, text, date, date, text, text, integer) to authenticated;

/* ---------------------------------------------------------------------------------------------
   16. Read models: the working set of units the viewer may open (blockers computed once per call), the
       Manufacturing dashboard (every number is the count of the list it opens), lists, the product view, the
       Build Unit view and its tabs, Executive Control, the weekly review section, Today and the Assistant
   --------------------------------------------------------------------------------------------- */
create or replace function public._mfg_base(p_viewer uuid, p_only uuid default null, p_with_acceptance boolean default true) returns void
language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare x public.records; bl jsonb; ac jsonb;
begin
  if to_regclass('pg_temp.mfg_uv') is null then
    create temp table mfg_uv (id uuid primary key, number text, title text, status text, kind text, product text, product_ref uuid, config text, project_ref uuid, owner_id text, owner text,
      target date, released boolean, accepted boolean, shipped boolean, restricted boolean, blockers jsonb, blocks int, missing int, late_po int, acceptance text, acc_reasons jsonb, priority text) on commit drop;
    create temp table mfg_meta (viewer uuid, only_unit uuid, at timestamptz) on commit drop;
  end if;
  if exists (select 1 from pg_temp.mfg_meta m where m.viewer is not distinct from p_viewer and m.only_unit is not distinct from p_only and m.at = statement_timestamp()) then return; end if;
  truncate pg_temp.mfg_uv; delete from pg_temp.mfg_meta;
  for x in select r.* from public.records r where r.section = 'operations.builds' and (p_only is null or r.id = p_only) and public.record_visible_for(p_viewer, r) loop
    bl := case when public.mfg_status_kind(x.status) in ('done', 'cancelled') then '[]'::jsonb else public._mfg_blockers(x, p_viewer) end;
    ac := case when p_with_acceptance and public.mfg_status_kind(x.status) in ('build') then public._mfg_acceptance_readiness(x, p_viewer) end;
    insert into pg_temp.mfg_uv values (x.id, x.data->>'number', x.title, x.status, public.mfg_status_kind(x.status), x.data->>'product_ref_title', public.as_uuid(x.data->>'product_ref'),
      x.data->>'config_ref_title', public.as_uuid(x.data->>'project_ref'), x.data->>'owner_id', x.data->>'owner', public._mfg_date(coalesce(x.data->>'target', x.data->>'due')),
      coalesce(x.data->>'released_at', '') <> '', exists (select 1 from public.mfg_acceptance a where a.unit_id = x.id and a.status <> 'Rejected'), exists (select 1 from public.mfg_releases s where s.unit_id = x.id),
      coalesce((x.data->>'restricted')::boolean, false), bl,
      (select count(*) from jsonb_array_elements(bl) b where b->>'level' = 'block'),
      (select count(*) from jsonb_array_elements(bl) b where b->>'kind' = 'missing_material'),
      (select count(*) from jsonb_array_elements(bl) b where b->>'kind' = 'late_purchase'),
      ac->>'status', ac->'reasons', x.data->>'priority');
  end loop;
  insert into pg_temp.mfg_meta values (p_viewer, p_only, statement_timestamp());
end $$;
revoke execute on function public._mfg_base(uuid, uuid, boolean) from public, anon, authenticated;

-- one list definition for the dashboard numbers and the lists they open
create or replace function public._mfg_list_rows(p_kind text, p_viewer uuid) returns setof jsonb language plpgsql security definer set search_path = public as $$
begin
  return query select jsonb_strip_nulls(jsonb_build_object('id', u.id, 'number', u.number, 'title', u.title, 'status', u.status, 'product', u.product, 'config', u.config, 'owner', u.owner, 'target', u.target,
      'blocks', u.blocks, 'acceptance', u.acceptance, 'late', case when u.target < current_date and u.kind not in ('done', 'cancelled') then true end,
      'reasons', (select jsonb_agg(b->>'text') from jsonb_array_elements(u.blockers) b where b->>'level' = 'block' or p_kind in ('shortages', 'late_purchases')),
      'acceptance_reasons', case when p_kind = 'ready_acceptance' then null else (select jsonb_agg(b->>'text') from jsonb_array_elements(coalesce(u.acc_reasons, '[]'::jsonb)) b where p_kind = 'acceptance') end))
    from pg_temp.mfg_uv u
    where case p_kind
      when 'units' then u.kind not in ('done', 'cancelled')
      when 'ready_for_build' then u.status = 'Ready for Build'
      when 'in_assembly' then u.kind = 'build'
      when 'blocked' then u.blocks > 0 and u.kind not in ('done', 'cancelled', 'hold')
      when 'shortages' then u.missing > 0
      when 'late_purchases' then u.late_po > 0
      when 'late' then u.target < current_date and u.kind not in ('done', 'cancelled')
      when 'ready_acceptance' then u.acceptance = 'Ready' and not u.accepted
      when 'ready_shipment' then u.status = 'Ready for Shipment'
      when 'hold' then u.kind = 'hold'
      when 'done' then u.kind = 'done'
      when 'cancelled' then u.kind = 'cancelled'
      else false end
    order by u.target nulls last, u.number;
end $$;
revoke execute on function public._mfg_list_rows(text, uuid) from public, anon, authenticated;

create or replace function public._mfg_record_rows(p_kind text, p_viewer uuid, p_limit int default 200) returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_kind = 'inspections_required' then
    return query select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'number', r.data->>'number', 'title', r.title, 'kind', r.data->>'inspection_kind', 'unit', r.data->>'build_ref_title', 'status', r.status, 'created_at', r.created_at::date))
      from public.records r where r.section = 'operations.quality' and r.data ? 'inspection_kind' and r.status in ('Planned', 'Inspection') and coalesce(r.data->>'recorded_at', '') = '' and public.record_visible_for(p_viewer, r)
      order by r.created_at limit p_limit;
  elsif p_kind = 'failed_tests' then
    -- the latest run of each procedure on each unit, when it failed (a later pass clears it)
    return query select jsonb_strip_nulls(jsonb_build_object('id', z.id, 'number', z.data->>'number', 'title', z.title, 'unit', z.data->>'build_ref_title', 'procedure', z.data->>'procedure_code', 'date', z.data->>'date'))
      from (select distinct on (r.data->>'build_ref', r.data->>'procedure_code') r.* from public.records r
            where r.section = 'technical.testing' and r.data ? 'procedure_ref' and coalesce(r.data->>'recorded_at', '') <> '' and public.record_visible_for(p_viewer, r)
            order by r.data->>'build_ref', r.data->>'procedure_code', r.data->>'recorded_at' desc) z
      where z.data->>'outcome' = 'Fail' limit p_limit;
  elsif p_kind = 'nonconformances' then
    return query select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'number', r.data->>'number', 'title', r.title, 'status', r.status, 'severity', r.data->>'severity', 'unit', r.data->>'build_ref_title', 'disposition', r.data->>'disposition'))
      from public.records r where r.section = 'company.issues' and r.data->>'type' = 'Nonconformance' and r.status not in ('Closed', 'Cancelled') and public.record_visible_for(p_viewer, r)
      order by r.created_at limit p_limit;
  end if;
end $$;
revoke execute on function public._mfg_record_rows(text, uuid, int) from public, anon, authenticated;

create or replace function public.mfg_overview() returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer();
begin
  if me is null or not public._mfg_can_read(me, 'operations.builds') then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform public._mfg_base(me);
  return jsonb_build_object(
    'units', (select count(*) from pg_temp.mfg_uv u where u.kind not in ('done', 'cancelled')),
    'ready_for_build', (select count(*) from pg_temp.mfg_uv u where u.status = 'Ready for Build'),
    'in_assembly', (select count(*) from pg_temp.mfg_uv u where u.kind = 'build'),
    'blocked', (select count(*) from pg_temp.mfg_uv u where u.blocks > 0 and u.kind not in ('done', 'cancelled', 'hold')),
    'shortages', (select count(*) from pg_temp.mfg_uv u where u.missing > 0),
    'late_purchases', (select count(*) from pg_temp.mfg_uv u where u.late_po > 0),
    'inspections_required', (select count(*) from public._mfg_record_rows('inspections_required', me, 100000)),
    'failed_tests', (select count(*) from public._mfg_record_rows('failed_tests', me, 100000)),
    'nonconformances', (select count(*) from public._mfg_record_rows('nonconformances', me, 100000)),
    'ready_acceptance', (select count(*) from pg_temp.mfg_uv u where u.acceptance = 'Ready' and not u.accepted),
    'ready_shipment', (select count(*) from pg_temp.mfg_uv u where u.status = 'Ready for Shipment'),
    'late', (select count(*) from pg_temp.mfg_uv u where u.target < current_date and u.kind not in ('done', 'cancelled')),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('product', z.product, 'product_ref', z.product_ref, 'active', z.a, 'blocked', z.b, 'done', z.d) order by z.product) from (
       select u.product, u.product_ref, count(*) filter (where u.kind not in ('done', 'cancelled')) a, count(*) filter (where u.blocks > 0 and u.kind not in ('done', 'cancelled', 'hold')) b, count(*) filter (where u.kind = 'done') d
       from pg_temp.mfg_uv u group by 1, 2) z), '[]'::jsonb),
    'caps', public.mfg_my_caps(), 'cost_ok', public._mfg_cost_ok(me));
end $$;
revoke execute on function public.mfg_overview() from public, anon;
grant execute on function public.mfg_overview() to authenticated;

create or replace function public.mfg_list(p_kind text, p_filter jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer();
begin
  if me is null or not public._mfg_can_read(me, 'operations.builds') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_kind in ('inspections_required', 'failed_tests', 'nonconformances') then return coalesce((select jsonb_agg(x) from public._mfg_record_rows(p_kind, me, 500) x), '[]'::jsonb); end if;
  if p_kind not in ('units', 'ready_for_build', 'in_assembly', 'blocked', 'shortages', 'late_purchases', 'late', 'ready_acceptance', 'ready_shipment', 'hold', 'done', 'all') then raise exception 'Unknown list' using errcode = '22023'; end if;
  perform public._mfg_base(me);
  return coalesce((select jsonb_agg(x) from (select y from public._mfg_list_rows(case when p_kind = 'all' then 'units' else p_kind end, me) y
                                               union all select y from public._mfg_list_rows('done', me) y where p_kind = 'all'
                                               union all select y from public._mfg_list_rows('cancelled', me) y where p_kind = 'all') z(x)
    where (p_filter->>'product' is null or (select u.product_ref::text from pg_temp.mfg_uv u where u.id = (x->>'id')::uuid) = p_filter->>'product')
      and (p_filter->>'q' is null or lower(concat_ws(' ', x->>'number', x->>'title', x->>'product', x->>'config')) like '%' || lower(p_filter->>'q') || '%')), '[]'::jsonb);
end $$;
revoke execute on function public.mfg_list(text, jsonb) from public, anon;
grant execute on function public.mfg_list(text, jsonb) to authenticated;

/* ----- product view ----- */
create or replace function public.mfg_products() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer();
begin
  if me is null or not public._mfg_can_read(me, 'technical.products') then raise exception 'Not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', p.id, 'code', p.data->>'code', 'name', p.title, 'family', p.data->>'family', 'status', p.status, 'unit_code', p.data->>'unit_code',
      'current_config', p.data->>'current_config_ref_title', 'configs', (select count(*) from public.records c where c.section = 'technical.configurations' and c.data->>'product_ref' = p.id::text and public.record_visible_for(me, c)),
      'units', (select count(*) from public.records u where u.section = 'operations.builds' and u.data->>'product_ref' = p.id::text and public.record_visible_for(me, u)))) order by p.data->>'code')
    from public.records p where p.section = 'technical.products' and public.record_visible_for(me, p)), '[]'::jsonb);
end $$;
revoke execute on function public.mfg_products() from public, anon;
grant execute on function public.mfg_products() to authenticated;

create or replace function public.mfg_product_view(p_product uuid) returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); p public.records; cost boolean;
begin
  p := public._mfg_rec(me, p_product, 'technical.products', 'Product');
  cost := public._mfg_cost_ok(me);
  perform public._mfg_base(me);
  return jsonb_build_object('product', jsonb_strip_nulls(jsonb_build_object('id', p.id, 'code', p.data->>'code', 'name', p.title, 'family', p.data->>'family', 'status', p.status, 'description', p.data->>'description', 'uom', p.data->>'uom',
      'product_owner', p.data->>'product_owner', 'engineering_owner', p.data->>'engineering_owner', 'manufacturing_owner', p.data->>'manufacturing_owner', 'current_config', p.data->>'current_config_ref', 'unit_code', p.data->>'unit_code')),
    'configurations', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', c.id, 'code', c.data->>'code', 'version', c.data->>'version', 'name', c.title, 'status', c.status, 'effective', c.data->>'effective_date',
        'boms', (select jsonb_agg(jsonb_build_object('id', b.id, 'number', b.data->>'number', 'revision', b.data->>'revision', 'status', b.status, 'lines', b.data->'line_count') order by b.created_at)
                 from public.records b where b.section = 'technical.boms' and b.data->>'config_ref' = c.id::text and public.record_visible_for(me, b)))) order by c.data->>'code', (c.data->>'version')::int)
      from public.records c where c.section = 'technical.configurations' and c.data->>'product_ref' = p.id::text and public.record_visible_for(me, c)), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', u.id, 'number', u.number, 'status', u.status, 'config', u.config, 'target', u.target, 'blocks', u.blocks, 'acceptance', u.acceptance)) order by u.number)
      from pg_temp.mfg_uv u where u.product_ref = p.id), '[]'::jsonb),
    'status_counts', coalesce((select jsonb_object_agg(z.status, z.n) from (select u.status, count(*) n from pg_temp.mfg_uv u where u.product_ref = p.id group by 1) z), '{}'::jsonb),
    'shortages', coalesce((select jsonb_agg(jsonb_build_object('unit', u.number, 'id', u.id, 'missing', u.missing, 'late', u.late_po)) from pg_temp.mfg_uv u where u.product_ref = p.id and (u.missing > 0 or u.late_po > 0)), '[]'::jsonb),
    'issues', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.data->>'number', 'title', s.title, 'status', s.status, 'unit', s.data->>'build_ref_title'))
      from public.records s where s.section = 'company.issues' and s.status not in ('Closed', 'Cancelled') and public.as_uuid(s.data->>'build_ref') in (select u.id from pg_temp.mfg_uv u where u.product_ref = p.id)
        and public.record_visible_for(me, s)), '[]'::jsonb),
    'tests', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'number', t.data->>'number', 'procedure', t.data->>'procedure_code', 'outcome', t.data->>'outcome', 'unit', t.data->>'build_ref_title', 'date', t.data->>'date') order by t.data->>'recorded_at' desc)
      from (select * from public.records t where t.section = 'technical.testing' and t.data ? 'procedure_ref' and coalesce(t.data->>'recorded_at', '') <> ''
              and public.as_uuid(t.data->>'build_ref') in (select u.id from pg_temp.mfg_uv u where u.product_ref = p.id) and public.record_visible_for(me, t) order by t.data->>'recorded_at' desc limit 20) t), '[]'::jsonb),
    'open_changes', coalesce((select jsonb_agg(distinct jsonb_build_object('id', e.id, 'number', e.data->>'number', 'title', e.title, 'status', e.status))
      from public.records e where e.section = 'technical.changes' and e.status not in ('Closed', 'Rejected', 'Cancelled') and public.record_visible_for(me, e)
        and (exists (select 1 from public.records b where b.section in ('technical.boms', 'technical.configurations') and b.data->>'ecr_ref' = e.id::text and b.data->>'product_ref' = p.id::text)
             or exists (select 1 from public.records c where c.section = 'technical.configurations' and c.data->>'product_ref' = p.id::text and coalesce(c.data->>'legacy_config', '') <> '' and c.data->>'legacy_config' = e.data->>'config'))), '[]'::jsonb),
    'cost', case when cost then coalesce((select jsonb_agg(x) from (select jsonb_build_object('unit', u.number, 'cost', public.mfg_unit_cost(u.id)->'by_currency') x from pg_temp.mfg_uv u where u.product_ref = p.id and u.kind not in ('cancelled') limit 30) z), '[]'::jsonb) end);
end $$;
revoke execute on function public.mfg_product_view(uuid) from public, anon;
grant execute on function public.mfg_product_view(uuid) to authenticated;

/* ----- the Build Unit view: the header for everyone who may open the unit, each tab only for those who may open
   what it shows (engineering details, costs) ----- */
create or replace function public.mfg_unit_view(p_unit uuid) returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); u public.records; br jsonb; ar jsonb; bl jsonb; eng boolean; work boolean; cost boolean; deal public.records; party public.records;
begin
  u := public._mfg_unit(me, p_unit);
  eng := public._mfg_can_read(me, 'technical.boms'); work := public._mfg_can_read(me, 'operations.work_orders'); cost := public._mfg_cost_ok(me);
  bl := public._mfg_blockers(u, me);
  br := public._mfg_build_readiness(u, me);
  ar := public._mfg_acceptance_readiness(u, me);
  select * into deal from public.records where id = public.as_uuid(u.data->>'deal_ref');
  select * into party from public.records where id = public.as_uuid(u.data->>'party_ref');
  return jsonb_build_object(
    'header', jsonb_strip_nulls(jsonb_build_object('id', u.id, 'number', u.data->>'number', 'title', u.title, 'status', u.status, 'kind', public.mfg_status_kind(u.status),
      'product', u.data->>'product_ref_title', 'product_ref', u.data->>'product_ref', 'config', u.data->>'config_ref_title', 'config_ref', u.data->>'config_ref',
      'bom', case when eng then u.data->>'bom_ref_title' end, 'bom_ref', case when eng then u.data->>'bom_ref' end,
      'project', u.data->>'project_ref_title', 'project_ref', u.data->>'project_ref',
      -- the customer and the opportunity only for those who may open them (a technician does not get commercial values)
      'customer', case when party.id is not null and public.record_visible_for(me, party) then party.title end,
      'opportunity', case when deal.id is not null and public.record_visible_for(me, deal) then coalesce(deal.data->>'number', deal.title) end, 'deal_ref', case when deal.id is not null and public.record_visible_for(me, deal) then deal.id end,
      'owner', u.data->>'owner', 'target', coalesce(u.data->>'target', u.data->>'due'), 'planned_start', u.data->>'planned_start', 'actual_start', u.data->>'actual_start', 'actual_completion', u.data->>'actual_completion',
      'location', u.data->>'location', 'destination', coalesce(u.data->>'destination', u.data->>'site'), 'priority', u.data->>'priority', 'released_at', u.data->>'released_at', 'restricted', u.data->'restricted',
      'controlled', u.controlled, 'export_check', u.data->>'export_check', 'accepted_at', u.data->>'accepted_at', 'asbuilt_revision', u.data->'asbuilt_revision')),
    'readiness', jsonb_build_object('build', br, 'acceptance', ar),
    'blockers', bl,
    'tabs', jsonb_build_object('bom', eng, 'materials', public._mfg_can_read(me, 'technical.items'), 'work', work, 'installed', eng or work, 'inspections', work, 'tests', work or eng, 'issues', true,
      'changes', eng, 'software', eng or work, 'asbuilt', eng or work, 'cost', cost, 'documents', true, 'history', true),
    'counts', jsonb_build_object(
      'work_open', (select count(*) from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status not in ('Completed', 'Cancelled') and public.record_visible_for(me, w)),
      'work_done', (select count(*) from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and w.status = 'Completed' and public.record_visible_for(me, w)),
      'installed', (select count(*) from public.mfg_installs x where x.unit_id = u.id and x.removed_at is null),
      'issues_open', (select count(*) from public.records s where s.section = 'company.issues' and s.data->>'build_ref' = u.id::text and s.status not in ('Closed', 'Cancelled') and public.record_visible_for(me, s))),
    'caps', public.mfg_my_caps(),
    'statuses', (select jsonb_agg(s->>'status') from jsonb_array_elements(public.mfg_cfg()->'build_statuses') s));
end $$;
revoke execute on function public.mfg_unit_view(uuid) from public, anon;
grant execute on function public.mfg_unit_view(uuid) to authenticated;

create or replace function public.mfg_unit_tab(p_unit uuid, p_tab text) returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); u public.records; c public.records;
begin
  u := public._mfg_unit(me, p_unit);
  if p_tab = 'overview' then return public.mfg_unit_view(u.id);
  elsif p_tab = 'bom' then
    if coalesce(u.data->>'bom_ref', '') = '' then return jsonb_build_object('note', 'Not released: no BOM revision is pinned yet'); end if;
    return public.mfg_bom_get(public.as_uuid(u.data->>'bom_ref')) || jsonb_build_object('pinned_at', u.data->>'released_at', 'pin_history', u.data->'pin_history');
  elsif p_tab = 'materials' then return public.mfg_material_plan(jsonb_build_object('unit', u.id)) || jsonb_build_object('allocations', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'item', i.data->>'number', 'title', i.title, 'qty', a.qty, 'consumed', a.qty_consumed, 'location', l.code, 'serial', s.serial, 'at', a.created_at)) order by i.data->>'number')
      from public.mfg_allocs a join public.records i on i.id = a.item_id join public.mfg_locations l on l.id = a.location_id left join public.mfg_serials s on s.id = a.serial_id
      where a.unit_id = u.id and a.status = 'active' and public.record_visible_for(me, i)), '[]'::jsonb),
      'purchases', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', rq.id, 'number', rq.data->>'number', 'title', rq.title, 'status', rq.status, 'qty', rq.data->'qty', 'needed_by', rq.data->>'needed_by',
          'po', po.data->>'number', 'po_status', po.status, 'eta', po.data->>'eta', 'received', po.data->'qty_received')) order by rq.created_at)
        from public.records rq left join public.records po on po.section = 'operations.procurement' and po.data->>'request_ref' = rq.id::text
        where rq.section = 'operations.requests' and rq.data->>'build_ref' = u.id::text and public.record_visible_for(me, rq)), '[]'::jsonb));
  elsif p_tab = 'work' then
    if not public._mfg_can_read(me, 'operations.work_orders') then raise exception 'Not allowed' using errcode = '42501'; end if;
    return jsonb_build_object('routing', public._mfg_routing(u), 'work_orders', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', w.id, 'number', w.data->>'number', 'title', w.title, 'status', w.status,
        'operation', w.data->>'operation', 'sequence', w.data->'sequence', 'assignee', w.data->>'assignee', 'planned', w.data->>'planned', 'completed_at', w.data->>'completed_at', 'completed_by', w.data->>'completed_by',
        'rework', case when coalesce(w.data->>'rework_of', '') <> '' then w.data->>'rework_of_title' end, 'blocked_reason', w.data->>'blocked_reason', 'stale_documents', nullif(public._mfg_doc_stale(w), '[]'::jsonb),
        'documents', w.data->'documents')) order by coalesce(public._num(w.data->'sequence'), 999), w.created_at)
      from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and public.record_visible_for(me, w)), '[]'::jsonb));
  elsif p_tab = 'installed' then
    return jsonb_build_object('installed', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', x.id, 'item', i.data->>'number', 'item_id', i.id, 'title', i.title, 'serial', s.serial, 'serial_id', s.id, 'qty', x.qty, 'position', x.position,
        'work_order', w.data->>'number', 'installed_at', x.installed_at, 'installed_by', public._wf_name(x.installed_by), 'document_version', (select label from public.document_versions where id = x.doc_version_id))) order by i.data->>'number')
      from public.mfg_installs x join public.records i on i.id = x.item_id left join public.mfg_serials s on s.id = x.serial_id left join public.records w on w.id = x.wo_id
      where x.unit_id = u.id and x.removed_at is null and public.record_visible_for(me, i)), '[]'::jsonb),
      'removed', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item', i.data->>'number', 'serial', s.serial, 'installed_at', x.installed_at, 'removed_at', x.removed_at, 'reason', x.removal_reason)) order by x.removed_at)
        from public.mfg_installs x join public.records i on i.id = x.item_id left join public.mfg_serials s on s.id = x.serial_id where x.unit_id = u.id and x.removed_at is not null and public.record_visible_for(me, i)), '[]'::jsonb),
      'consumed', coalesce((select jsonb_agg(jsonb_build_object('item', i.data->>'number', 'title', i.title, 'qty', z.q) order by i.data->>'number')
        from (select item_id, sum(qty) q from public.mfg_txns where unit_id = u.id and kind = 'consume' group by 1) z join public.records i on i.id = z.item_id where public.record_visible_for(me, i)), '[]'::jsonb));
  elsif p_tab = 'inspections' then
    return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', q.id, 'number', q.data->>'number', 'title', q.title, 'kind', q.data->>'inspection_kind', 'status', q.status, 'result', q.data->>'result',
        'inspector', q.data->>'inspector', 'date', q.data->>'date', 'issue', q.data->>'issue_ref', 'reinspection_of', q.data->>'reinspection_of', 'work_order', q.data->>'work_order_ref_title')) order by q.created_at)
      from public.records q where q.section = 'operations.quality' and q.data->>'build_ref' = u.id::text and public.record_visible_for(me, q)), '[]'::jsonb);
  elsif p_tab = 'tests' then
    select * into c from public.records where id = public.as_uuid(u.data->>'config_ref');
    return jsonb_build_object('required', coalesce(c.data->'required_tests', '[]'::jsonb), 'runs', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', t.id, 'number', t.data->>'number', 'title', t.title, 'procedure', t.data->>'procedure_code',
        'version', t.data->>'procedure_version', 'status', t.status, 'outcome', t.data->>'outcome', 'date', t.data->>'date', 'operator', t.data->>'owner', 'approved_by', t.data->>'approved_by', 'check', t.data->'deterministic'->>'check',
        'values', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', v.key, 'name', v.name, 'value', coalesce(v.actual_num::text, v.actual_text), 'unit', v.unit, 'rule', v.rule, 'pass', v.pass)) order by v.id) from public.mfg_test_values v where v.run_id = t.id)))
        order by t.created_at)
      from public.records t where t.section = 'technical.testing' and t.data->>'build_ref' = u.id::text and public.record_visible_for(me, t)), '[]'::jsonb));
  elsif p_tab = 'issues' then
    return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', s.id, 'number', s.data->>'number', 'title', s.title, 'status', s.status, 'severity', s.data->>'severity', 'type', s.data->>'type',
        'disposition', s.data->>'disposition', 'rework', s.data->>'rework_ref_title', 'reinspection_passed', s.data->'reinspection_passed', 'created_at', s.created_at::date)) order by s.created_at)
      from public.records s where s.section = 'company.issues' and s.data->>'build_ref' = u.id::text and public.record_visible_for(me, s)), '[]'::jsonb);
  elsif p_tab = 'changes' then
    return jsonb_build_object('pin_history', u.data->'pin_history', 'dispositions', coalesce((select jsonb_agg(jsonb_build_object('decision', d.decision, 'bom', (select coalesce(b.data->>'number', '') || ' rev ' || coalesce(b.data->>'revision', '') from public.records b where b.id = d.bom_id),
        'ecr', (select e.data->>'number' from public.records e where e.id = d.ecr_id), 'by', public._wf_name(d.decided_by), 'at', d.decided_at, 'note', d.note) order by d.decided_at) from public.mfg_unit_dispositions d where d.unit_id = u.id), '[]'::jsonb),
      'pending', coalesce((select jsonb_agg(b->>'text') from jsonb_array_elements(public._mfg_blockers(u, me)) b where b->>'kind' = 'ecr_impact'), '[]'::jsonb));
  elsif p_tab = 'software' then
    return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', s.id, 'component', s.component, 'version', s.version, 'checksum', s.checksum, 'config_ref', s.config_ref, 'installed_at', s.installed_at,
        'installer', public._wf_name(s.installer), 'current', s.superseded_at is null, 'superseded_at', s.superseded_at)) order by s.component, s.installed_at)
      from public.mfg_software s where s.unit_id = u.id), '[]'::jsonb);
  elsif p_tab = 'asbuilt' then return jsonb_build_object('asbuilt', public.mfg_asbuilt(u.id), 'compare', public.mfg_planned_vs_built(u.id));
  elsif p_tab = 'cost' then return public.mfg_unit_cost(u.id);
  elsif p_tab = 'documents' then
    select * into c from public.records where id = public.as_uuid(u.data->>'config_ref');
    return jsonb_build_object('configuration', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'number', d.data->>'doc_number', 'current', (select label from public.document_versions where id = public._mfg_doc_current(d.id))))
        from jsonb_array_elements(coalesce(c.data->'documents', '[]'::jsonb) || coalesce(c.data->'required_documents', '[]'::jsonb)) x join public.records d on d.id = public.as_uuid(x->>'doc_ref') where public.record_visible_for(me, d)), '[]'::jsonb),
      'used_in_work', coalesce((select jsonb_agg(distinct jsonb_build_object('title', x->>'title', 'number', x->>'doc_number', 'version', x->>'version'))
        from public.records w, jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) x where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and public.record_visible_for(me, w)), '[]'::jsonb),
      'evidence', public._mfg_evidence_count('operations.builds', u.id), 'shipping', public._mfg_shipping_readiness(u));
  elsif p_tab = 'history' then
    return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', a.at, 'kind', a.kind, 'by', public._wf_name(a.actor), 'detail', a.detail - array['lines_hash', 'hash', 'allocations'])) order by a.at desc)
      from (select * from public.mfg_audit a where a.unit_id = u.id order by a.at desc limit 200) a), '[]'::jsonb);
  end if;
  raise exception 'Unknown tab' using errcode = '22023';
end $$;
revoke execute on function public.mfg_unit_tab(uuid, text) from public, anon;
grant execute on function public.mfg_unit_tab(uuid, text) to authenticated;

/* ----- Executive Control card, the weekly review section, Today ----- */
create or replace function public.mfg_exec() returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer();
begin
  if me is null or not public._mfg_can_read(me, 'operations.builds') then return null; end if;
  perform public._mfg_base(me);
  return jsonb_build_object(
    'active', (select count(*) from pg_temp.mfg_uv u where u.kind not in ('done', 'cancelled')),
    'blocked', (select count(*) from pg_temp.mfg_uv u where u.blocks > 0 and u.kind not in ('done', 'cancelled', 'hold')),
    'late', (select count(*) from pg_temp.mfg_uv u where u.target < current_date and u.kind not in ('done', 'cancelled')),
    'shortages', (select count(*) from pg_temp.mfg_uv u where u.missing > 0),
    'critical_procurement', (select count(*) from pg_temp.mfg_uv u where u.late_po > 0),
    'nonconformances', (select count(*) from public._mfg_record_rows('nonconformances', me, 100000)),
    'failed_tests', (select count(*) from public._mfg_record_rows('failed_tests', me, 100000)),
    'ready_acceptance', (select count(*) from pg_temp.mfg_uv u where u.acceptance = 'Ready' and not u.accepted),
    'ready_shipment', (select count(*) from pg_temp.mfg_uv u where u.status = 'Ready for Shipment'),
    'links', jsonb_build_object('active', '/mfg?list=units', 'blocked', '/mfg?list=blocked', 'late', '/mfg?list=late', 'shortages', '/mfg?list=shortages', 'critical_procurement', '/mfg?list=late_purchases',
      'nonconformances', '/mfg?list=nonconformances', 'failed_tests', '/mfg?list=failed_tests', 'ready_acceptance', '/mfg?list=ready_acceptance', 'ready_shipment', '/mfg?list=ready_shipment'));
end $$;
revoke execute on function public.mfg_exec() from public, anon;
grant execute on function public.mfg_exec() to authenticated;

create or replace function public.mfg_weekly(p_from date default null, p_to date default null) returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); f date := coalesce(p_from, current_date - 7); t date := coalesce(p_to, current_date); cost boolean;
begin
  if me is null or not public._mfg_can_read(me, 'operations.builds') then return null; end if;
  cost := public._mfg_cost_ok(me);
  perform public._mfg_base(me);
  return jsonb_build_object('from', f, 'to', t,
    'active', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'number', u.number, 'status', u.status, 'product', u.product, 'target', u.target) order by u.number) from pg_temp.mfg_uv u where u.kind not in ('done', 'cancelled')), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(jsonb_build_object('unit', u.number, 'completed_this_week', z.wk, 'completed', z.done, 'total', z.tot) order by u.number) from pg_temp.mfg_uv u join lateral (
        select count(*) filter (where w.status = 'Completed' and public._mfg_date(w.data->>'completed_at') between f and t) wk, count(*) filter (where w.status = 'Completed') done, count(*) filter (where w.status <> 'Cancelled') tot
        from public.records w where w.section = 'operations.work_orders' and w.data->>'build_ref' = u.id::text and public.record_visible_for(me, w)) z on true where u.kind not in ('done', 'cancelled')), '[]'::jsonb),
    'blockers', coalesce((select jsonb_agg(jsonb_build_object('unit', u.number, 'id', u.id, 'reasons', (select jsonb_agg(b->>'text') from jsonb_array_elements(u.blockers) b where b->>'level' = 'block'))) from pg_temp.mfg_uv u where u.blocks > 0 and u.kind not in ('done', 'cancelled')), '[]'::jsonb),
    'shortages', coalesce((select jsonb_agg(jsonb_build_object('unit', u.number, 'id', u.id, 'items', (select jsonb_agg(b->>'text') from jsonb_array_elements(u.blockers) b where b->>'kind' = 'missing_material'))) from pg_temp.mfg_uv u where u.missing > 0), '[]'::jsonb),
    'procurement_risk', coalesce((select jsonb_agg(jsonb_build_object('unit', u.number, 'id', u.id, 'late', (select jsonb_agg(b->>'text') from jsonb_array_elements(u.blockers) b where b->>'kind' = 'late_purchase'))) from pg_temp.mfg_uv u where u.late_po > 0), '[]'::jsonb),
    'engineering_changes', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'number', e.data->>'number', 'title', e.title, 'status', e.status)) from public.records e
      where e.section = 'technical.changes' and (e.updated_at::date between f and t or e.status not in ('Closed', 'Rejected', 'Cancelled')) and public.record_visible_for(me, e)
        and exists (select 1 from public.records b where b.section in ('technical.boms', 'technical.configurations') and b.data->>'ecr_ref' = e.id::text)), '[]'::jsonb),
    'nonconformance', jsonb_build_object('opened', (select count(*) from public.records s where s.section = 'company.issues' and s.data->>'type' = 'Nonconformance' and s.created_at::date between f and t and public.record_visible_for(me, s)),
      'closed', (select count(*) from public.records s where s.section = 'company.issues' and s.data->>'type' = 'Nonconformance' and s.status = 'Closed' and s.updated_at::date between f and t and public.record_visible_for(me, s)),
      'open', (select count(*) from public._mfg_record_rows('nonconformances', me, 100000))),
    'testing', jsonb_build_object('runs', (select count(*) from public.records r where r.section = 'technical.testing' and r.data ? 'procedure_ref' and public._mfg_date(r.data->>'recorded_at') between f and t and public.record_visible_for(me, r)),
      'failed', (select count(*) from public.records r where r.section = 'technical.testing' and r.data->>'outcome' = 'Fail' and public._mfg_date(r.data->>'recorded_at') between f and t and public.record_visible_for(me, r)),
      'failed_open', (select count(*) from public._mfg_record_rows('failed_tests', me, 100000))),
    'acceptance', jsonb_build_object('accepted', (select count(*) from public.mfg_acceptance a join pg_temp.mfg_uv u on u.id = a.unit_id where a.accepted_at::date between f and t and a.status <> 'Rejected'),
      'ready', (select count(*) from pg_temp.mfg_uv u where u.acceptance = 'Ready' and not u.accepted)),
    'shipment', jsonb_build_object('released', (select count(*) from public.mfg_releases x join pg_temp.mfg_uv u on u.id = x.unit_id where x.released_at::date between f and t),
      'ready', (select count(*) from pg_temp.mfg_uv u where u.status = 'Ready for Shipment')),
    'cost_variance', case when cost then coalesce((select jsonb_agg(jsonb_build_object('unit', u.number, 'by_currency', public.mfg_unit_cost(u.id)->'by_currency')) from (select * from pg_temp.mfg_uv where kind in ('build', 'done') order by number limit 20) u), '[]'::jsonb) end,
    'next_actions', coalesce((select jsonb_agg(jsonb_build_object('unit', u.number, 'owner', u.owner, 'action', b->>'text')) from pg_temp.mfg_uv u, jsonb_array_elements(u.blockers) b where b->>'level' = 'block' and u.kind not in ('done', 'cancelled')), '[]'::jsonb));
end $$;
revoke execute on function public.mfg_weekly(date, date) from public, anon;
grant execute on function public.mfg_weekly(date, date) to authenticated;

create or replace function public.mfg_today() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer();
begin
  if me is null or not public._mfg_can_read(me, 'operations.work_orders') then return null; end if;
  return jsonb_build_object(
    'work', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'number', w.data->>'number', 'title', w.title, 'status', w.status, 'unit', w.data->>'build_ref_title', 'planned', w.data->>'planned') order by w.data->>'planned' nulls last)
      from public.records w where w.section = 'operations.work_orders' and w.status in ('Ready', 'In Progress', 'Blocked') and (coalesce(w.data->>'assignee_id', '') = me::text or coalesce(w.data->'team_ids', '[]'::jsonb) ? me::text)
        and public.record_visible_for(me, w)), '[]'::jsonb),
    'inspections', case when public.has_cap(me, 'quality_inspector') then (select count(*) from public._mfg_record_rows('inspections_required', me, 100000)) end,
    'my_units_blocked', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'number', u.data->>'number', 'status', u.status)) from public.records u
      where u.section = 'operations.builds' and u.data->>'owner_id' = me::text and public.mfg_status_kind(u.status) not in ('done', 'cancelled') and public.record_visible_for(me, u)
        and exists (select 1 from jsonb_array_elements(public._mfg_blockers(u, me)) b where b->>'level' = 'block')), '[]'::jsonb));
end $$;
revoke execute on function public.mfg_today() from public, anon;
grant execute on function public.mfg_today() to authenticated;

/* ----- the Manufacturing Assistant: allow-listed questions answered from the viewer's records, with sources ----- */
create or replace function public._mfg_find_unit(p_viewer uuid, p_arg text) returns public.records language plpgsql stable security definer set search_path = public as $$
declare r public.records; a text := lower(trim(coalesce(p_arg, '')));
begin
  if a = '' then return null; end if;
  select x.* into r from public.records x where x.section = 'operations.builds'
    and (lower(coalesce(x.data->>'number', '')) = a or lower(coalesce(x.data->>'number', '')) like '%' || a or lower(coalesce(x.data->>'number', '')) like '%' || replace(a, ' ', '-') || '%' or lower(x.title) like '%' || a || '%')
    and public.record_visible_for(p_viewer, x)
  order by (lower(coalesce(x.data->>'number', '')) = a) desc, (lower(coalesce(x.data->>'number', '')) like '%' || a) desc, public.mfg_status_kind(x.status) in ('done', 'cancelled'), x.created_at desc limit 1;
  return r;
end $$;
revoke execute on function public._mfg_find_unit(uuid, text) from public, anon, authenticated;

create or replace function public.mfg_assistant(p_intent text, p_arg text default null) returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); arg text := nullif(trim(coalesce(p_arg, '')), ''); u public.records; pr public.records; a text; b text; ba public.records; bb public.records; x jsonb;
begin
  if me is null or not public._mfg_can_read(me, 'operations.builds') then return jsonb_build_object('kind', 'unavailable', 'note', 'Manufacturing records are not open to you'); end if;
  if p_intent = 'building' then
    perform public._mfg_base(me, null, false);
    return jsonb_build_object('kind', 'units', 'intent', p_intent, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'number', v.number, 'title', v.title, 'status', v.status, 'product', v.product, 'config', v.config, 'target', v.target, 'blocks', v.blocks) order by v.product, v.number)
      from pg_temp.mfg_uv v where v.kind not in ('done', 'cancelled')), '[]'::jsonb));
  elsif p_intent = 'risks' then
    perform public._mfg_base(me, null, false);
    return jsonb_build_object('kind', 'risks', 'intent', p_intent, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'number', v.number, 'status', v.status, 'reasons', (select jsonb_agg(z->>'text') from jsonb_array_elements(v.blockers) z where z->>'level' = 'block')) order by v.blocks desc, v.target nulls last)
      from pg_temp.mfg_uv v where v.blocks > 0 and v.kind not in ('done', 'cancelled')), '[]'::jsonb),
      'nonconformances', coalesce((select jsonb_agg(z) from public._mfg_record_rows('nonconformances', me, 20) z), '[]'::jsonb), 'failed_tests', coalesce((select jsonb_agg(z) from public._mfg_record_rows('failed_tests', me, 20) z), '[]'::jsonb));
  elsif p_intent in ('failed_inspections', 'failed_tests') then
    if p_intent = 'failed_tests' then return jsonb_build_object('kind', 'records', 'intent', p_intent, 'items', coalesce((select jsonb_agg(z) from public._mfg_record_rows('failed_tests', me, 50) z), '[]'::jsonb)); end if;
    return jsonb_build_object('kind', 'records', 'intent', p_intent, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'number', q.data->>'number', 'title', q.title, 'unit', q.data->>'build_ref_title', 'kind', q.data->>'inspection_kind', 'date', q.data->>'date', 'issue', q.data->>'issue_ref') order by q.data->>'recorded_at' desc)
      from public.records q where q.section = 'operations.quality' and q.data->>'result' = 'Fail' and public.record_visible_for(me, q)), '[]'::jsonb));
  elsif p_intent = 'bom_diff' then
    -- "What changed from BOM revision A to B?" — arg: "<BOM number or product or unit> A B" (the last two words are the revisions)
    a := upper((regexp_match(coalesce(arg, ''), '\m([A-Z]{1,2})\M\s*(?:to|→|->|-)\s*\m([A-Z]{1,2})\M\s*$', 'i'))[1]);
    b := upper((regexp_match(coalesce(arg, ''), '\m([A-Z]{1,2})\M\s*(?:to|→|->|-)\s*\m([A-Z]{1,2})\M\s*$', 'i'))[2]);
    if a is null or b is null or a !~ '^[A-Z]{1,2}$' or b !~ '^[A-Z]{1,2}$' then return jsonb_build_object('kind', 'unavailable', 'note', 'Say the two revisions, e.g. «BOM AGR-BOM-0001 revision A to B»'); end if;
    select x2.* into bb from public.records x2 where x2.section = 'technical.boms' and upper(x2.data->>'revision') = b and public.record_visible_for(me, x2)
      and (lower(coalesce(arg, '')) like '%' || lower(x2.data->>'number') || '%' or lower(coalesce(arg, '')) like '%' || lower(coalesce(x2.data->>'product_ref_title', '~')) || '%' or lower(coalesce(arg, '')) like '%' || lower(coalesce(x2.data->>'config_ref_title', '~')) || '%')
      order by x2.created_at desc limit 1;
    if bb.id is null then return jsonb_build_object('kind', 'unavailable', 'note', 'No BOM revision ' || b || ' you can open matches'); end if;
    select x2.* into ba from public.records x2 where x2.section = 'technical.boms' and x2.data->>'number' = bb.data->>'number' and upper(x2.data->>'revision') = a and public.record_visible_for(me, x2);
    if ba.id is null then return jsonb_build_object('kind', 'unavailable', 'note', 'No revision ' || a || ' of ' || (bb.data->>'number')); end if;
    return jsonb_build_object('kind', 'bom_diff', 'intent', p_intent, 'diff', public.mfg_bom_compare(ba.id, bb.id));
  elsif p_intent in ('missing', 'not_arrived', 'late_pos') and arg is null then
    perform public._mfg_base(me, null, false);
    return jsonb_build_object('kind', 'units', 'intent', p_intent, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'number', v.number, 'status', v.status,
        'reasons', (select jsonb_agg(z->>'text') from jsonb_array_elements(v.blockers) z where z->>'kind' = case when p_intent = 'missing' then 'missing_material' else 'late_purchase' end)))
      from pg_temp.mfg_uv v where (p_intent = 'missing' and v.missing > 0) or (p_intent <> 'missing' and v.late_po > 0)), '[]'::jsonb),
      'open_purchases', case when p_intent = 'not_arrived' then coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'number', po.data->>'number', 'title', po.title, 'status', po.status, 'eta', po.data->>'eta',
          'qty', po.data->'qty', 'received', po.data->'qty_received', 'unit', rq.data->>'build_ref_title'))
        from public.records rq join public.records po on po.section = 'operations.procurement' and po.data->>'request_ref' = rq.id::text
        where rq.section = 'operations.requests' and coalesce(rq.data->>'build_ref', '') <> '' and po.status in ('Approved', 'Ordered', 'Partially delivered') and public.record_visible_for(me, po)), '[]'::jsonb) end);
  end if;
  -- the questions about one unit (or a product): "the C40" picks the active unit of that product
  u := public._mfg_find_unit(me, arg);
  if u.id is null and arg is not null and arg !~ '\d{3,}' then
    select p.* into pr from public.records p where p.section = 'technical.products' and (lower(p.data->>'code') = lower(arg) or lower(p.title) = lower(arg) or lower(arg) like '%' || lower(p.data->>'code') || '%') and public.record_visible_for(me, p) limit 1;
    if pr.id is not null then
      select x2.* into u from public.records x2 where x2.section = 'operations.builds' and x2.data->>'product_ref' = pr.id::text and public.mfg_status_kind(x2.status) not in ('done', 'cancelled') and public.record_visible_for(me, x2) order by x2.created_at limit 1;
    end if;
  end if;
  if u.id is null then return jsonb_build_object('kind', 'unavailable', 'note', case when arg is null then 'Say which unit (its number, e.g. C20-0001)' else 'No build unit you can open matches «' || arg || '»' end); end if;
  if p_intent = 'status' then return jsonb_build_object('kind', 'unit', 'intent', p_intent, 'unit', public.mfg_unit_view(u.id) - 'caps' - 'statuses');
  elsif p_intent = 'blocking' then return jsonb_build_object('kind', 'blockers', 'intent', p_intent, 'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number', 'status', u.status), 'blockers', public._mfg_blockers(u, me));
  elsif p_intent = 'missing' then return jsonb_build_object('kind', 'materials', 'intent', p_intent, 'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number'),
      'rows', coalesce((select jsonb_agg(r2) from jsonb_array_elements(public.mfg_material_plan(jsonb_build_object('unit', u.id))->'rows') r2 where (r2->>'shortage')::numeric > 0), '[]'::jsonb));
  elsif p_intent in ('not_arrived', 'late_pos') then return jsonb_build_object('kind', 'purchases', 'intent', p_intent, 'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number'),
      'items', coalesce((select jsonb_agg(z) from jsonb_array_elements(public.mfg_unit_tab(u.id, 'materials')->'purchases') z
        where coalesce(z->>'po_status', z->>'status') not in ('Received', 'Closed', 'Cancelled', 'Rejected') and (p_intent = 'not_arrived' or public._mfg_date(z->>'eta') < current_date)), '[]'::jsonb));
  elsif p_intent in ('installed', 'serials') then return jsonb_build_object('kind', 'installed', 'intent', p_intent, 'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number'), 'installed', public.mfg_unit_tab(u.id, 'installed')->'installed');
  elsif p_intent = 'software' then return jsonb_build_object('kind', 'software', 'intent', p_intent, 'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number'), 'items', public.mfg_unit_tab(u.id, 'software'));
  elsif p_intent = 'diff_bom' then return jsonb_build_object('kind', 'compare', 'intent', p_intent, 'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number'), 'compare', public.mfg_planned_vs_built(u.id));
  elsif p_intent = 'ready_acceptance' then return jsonb_build_object('kind', 'readiness', 'intent', p_intent, 'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number'), 'readiness', public._mfg_acceptance_readiness(u, me));
  elsif p_intent = 'ready_shipment' then return jsonb_build_object('kind', 'readiness', 'intent', p_intent, 'unit', jsonb_build_object('id', u.id, 'number', u.data->>'number'), 'readiness', public._mfg_shipping_readiness(u));
  end if;
  return jsonb_build_object('kind', 'unavailable', 'note', 'Unknown question');
end $$;
revoke execute on function public.mfg_assistant(text, text) from public, anon;
grant execute on function public.mfg_assistant(text, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   17. Settings, capabilities, notices (bounded hourly job), QR codes and labels, import (preview → validation →
       duplicates → mapping → confirmation → import → report → rollback) and export (authorized, audited)
   --------------------------------------------------------------------------------------------- */
create or replace function public.mfg_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); s public.mfg_settings;
begin
  if me is null or not public._mfg_can_read(me, 'operations.builds') then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into s from public.mfg_settings where id;
  return jsonb_build_object('value', s.value - 'migrated', 'version', s.version, 'updated_at', s.updated_at, 'can_edit', public.has_cap(me, 'manufacturing_admin'),
    'caps', public.mfg_my_caps(), 'cap_names', to_jsonb(public.mfg_cap_names()),
    'policies', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'config_status', p.config_status, 'version', p.version,
        'label', case when p.config_status = 'Approved' then 'AGRON policy (approved)' else 'UNAPPROVED DEFAULT CONFIGURATION' end) order by p.code)
      from public.approval_policies p where public._policy_cap(p.code, p.section) = 'manufacturing_admin'), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.changed_at, 'by', public._wf_name(h.changed_by))) from (select * from public.mfg_settings_history order by changed_at desc limit 20) h), '[]'::jsonb));
end $$;
revoke execute on function public.mfg_settings_get() from public, anon;
grant execute on function public.mfg_settings_get() to authenticated;

create or replace function public.mfg_settings_save(p_value jsonb, p_version integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); cur public.mfg_settings; k text; s jsonb; seen text[] := '{}'; x text;
begin
  perform public._mfg_need(me, 'manufacturing_admin', 'Changing manufacturing settings');
  select * into cur from public.mfg_settings where id for update;
  if cur.version <> p_version then raise exception 'The settings were changed by someone else; reload' using errcode = '40001'; end if;
  for k in select jsonb_object_keys(p_value) loop
    if k not in ('build_statuses', 'item_types', 'item_categories', 'uoms', 'classifications', 'inspection_kinds', 'test_categories', 'software_components', 'dispositions', 'receive_default_state',
                 'required_inspections_default', 'test_approval_required', 'shipping_documents_default', 'late_purchase_grace_days', 'cost_roles', 'cost_caps', 'management_caps', 'export_excluded_fields') then
      raise exception 'Unknown setting %', k using errcode = '22023';
    end if;
    if k in ('item_types', 'item_categories', 'uoms', 'classifications', 'inspection_kinds', 'test_categories', 'software_components', 'dispositions', 'required_inspections_default', 'shipping_documents_default', 'cost_roles', 'cost_caps', 'management_caps', 'export_excluded_fields')
       and (jsonb_typeof(p_value->k) <> 'array' or exists (select 1 from jsonb_array_elements(p_value->k) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 80)) then
      raise exception 'Setting % is a list of names (1–80 characters each)', k using errcode = '22023';
    end if;
  end loop;
  if p_value ? 'dispositions' and not (p_value->'dispositions' ? 'Use As Is') then raise exception 'Use As Is stays a disposition (it is the one that needs the Quality Approver)' using errcode = '22023'; end if;
  if p_value ? 'management_caps' and exists (select 1 from jsonb_array_elements_text(p_value->'management_caps') c where not (c = any (public.mfg_cap_names()))) then raise exception 'Management may hold manufacturing capabilities only' using errcode = '22023'; end if;
  if p_value ? 'cost_caps' and exists (select 1 from jsonb_array_elements_text(p_value->'cost_caps') c where not (c = any (public.mfg_cap_names()))) then raise exception 'Unknown capability in cost_caps' using errcode = '22023'; end if;
  if p_value ? 'cost_roles' and exists (select 1 from jsonb_array_elements_text(p_value->'cost_roles') c where c in ('partner', 'vendor', 'investor', 'pending')) then raise exception 'External roles never see costs' using errcode = '22023'; end if;
  if p_value ? 'receive_default_state' and p_value->>'receive_default_state' not in ('Inspection', 'Available') then raise exception 'Received material goes to Inspection or Available' using errcode = '22023'; end if;
  if p_value ? 'late_purchase_grace_days' and (public._num(p_value->'late_purchase_grace_days') is null or public._num(p_value->'late_purchase_grace_days') not between 0 and 60) then raise exception 'Grace days are 0–60' using errcode = '22023'; end if;
  if p_value ? 'build_statuses' then
    if jsonb_typeof(p_value->'build_statuses') <> 'array' or jsonb_array_length(p_value->'build_statuses') < 3 then raise exception 'The build lifecycle needs its statuses' using errcode = '22023'; end if;
    for s in select * from jsonb_array_elements(p_value->'build_statuses') loop
      if coalesce(s->>'status', '') = '' or length(s->>'status') > 40 then raise exception 'A status needs a name (up to 40 characters)' using errcode = '22023'; end if;
      if s->>'status' = any (seen) then raise exception 'Status % appears twice', s->>'status' using errcode = '22023'; end if;
      seen := seen || (s->>'status');
      if coalesce(s->>'kind', 'open') not in ('open', 'build', 'done', 'hold', 'cancelled') then raise exception 'Status %: kind is open, build, done, hold or cancelled', s->>'status' using errcode = '22023'; end if;
      for x in select jsonb_array_elements_text(coalesce(s->'requires', '[]'::jsonb)) loop
        if x not in ('released', 'build_ready', 'accepted', 'shipment_released') then raise exception 'Status %: unknown prerequisite %', s->>'status', x using errcode = '22023'; end if;
      end loop;
      if s->>'kind' = 'done' and not (coalesce(s->'requires', '[]'::jsonb) ? 'accepted') then raise exception 'A completed status (%) needs the unit acceptance', s->>'status' using errcode = '22023'; end if;
    end loop;
    -- a status in use stays (a unit is never left on an unknown status)
    if exists (select 1 from public.records r where r.section = 'operations.builds' and r.status is not null and not (r.status = any (seen))) then
      raise exception 'Status % is used by a unit: keep it in the lifecycle', (select r.status from public.records r where r.section = 'operations.builds' and not (r.status = any (seen)) limit 1) using errcode = '23514';
    end if;
  end if;
  update public.mfg_settings set value = value || p_value, version = version + 1, updated_at = now(), updated_by = me where id;
  insert into public.mfg_settings_history(changed_by, before, after) values (me, cur.value, cur.value || p_value);
  perform public._mfg_audit(me, 'settings_changed', null, null, jsonb_build_object('keys', (select jsonb_agg(k2) from jsonb_object_keys(p_value) k2)));
  return jsonb_build_object('ok', true, 'version', cur.version + 1);
end $$;
revoke execute on function public.mfg_settings_save(jsonb, integer) from public, anon;
grant execute on function public.mfg_settings_save(jsonb, integer) to authenticated;

/* ----- notices: each occasion once; bounded per call ----- */
create or replace function public.mfg_tick() returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare x public.records; n int := 0; t0 timestamptz := clock_timestamp(); more boolean := false; who uuid; today date := current_date; k text; h uuid; bl jsonb;
begin
  if auth.uid() is not null then raise exception 'Not allowed' using errcode = '42501'; end if;
  -- work orders past their planned date (to the person they are assigned to)
  for x in select w.* from public.records w where w.section = 'operations.work_orders' and w.status in ('Ready', 'In Progress', 'Blocked', 'Planned') and public._mfg_date(w.data->>'planned') < today
           and public.as_uuid(w.data->>'assignee_id') is not null order by w.updated_at loop
    if clock_timestamp() - t0 > interval '2 seconds' then more := true; exit; end if;
    who := public.as_uuid(x.data->>'assignee_id'); k := 'mfg_wo_overdue:' || x.id || ':' || (x.data->>'planned');
    if not public._crm_seen(who, k) and public.notify_user(who, 'mfg_work_overdue', x.id, k, 'Work order past its planned date: ' || coalesce(x.data->>'number', '') || ' ' || x.title, 'Planned ' || (x.data->>'planned'), null, '/build?wo=' || x.id) then n := n + 1; end if;
  end loop;
  -- units: late, blocked (to the manufacturing owner), ready for acceptance (to the acceptance approvers)
  for x in select u.* from public.records u where u.section = 'operations.builds' and public.mfg_status_kind(u.status) in ('open', 'build') and coalesce(u.data->>'released_at', '') <> '' order by u.updated_at loop
    if clock_timestamp() - t0 > interval '2 seconds' then more := true; exit; end if;
    who := public.as_uuid(coalesce(x.data->>'manufacturing_owner_id', x.data->>'owner_id'));
    if who is not null and public._mfg_date(coalesce(x.data->>'target', x.data->>'due')) < today then
      k := 'mfg_unit_late:' || x.id || ':' || coalesce(x.data->>'target', x.data->>'due');
      if not public._crm_seen(who, k) and public.notify_user(who, 'mfg_unit_late', x.id, k, 'Build unit past its target date: ' || coalesce(x.data->>'number', x.title), 'Target ' || coalesce(x.data->>'target', x.data->>'due'), null, '/mfg?unit=' || x.id) then n := n + 1; end if;
    end if;
    if who is not null then
      bl := public._mfg_blockers(x, who);
      for k in select distinct b->>'kind' from jsonb_array_elements(bl) b where b->>'level' = 'block' and b->>'kind' in ('missing_material', 'late_purchase', 'nonconformance', 'failed_test', 'failed_inspection', 'ecr_impact') loop
        if not public._crm_seen(who, 'mfg_block:' || x.id || ':' || k || ':' || today) and not public._crm_seen(who, 'mfg_block:' || x.id || ':' || k || ':' || (today - 1)) then
          if public.notify_user(who, case k when 'missing_material' then 'mfg_shortage' when 'late_purchase' then 'mfg_purchase_late' when 'ecr_impact' then 'mfg_ecr_decision' else 'mfg_blocked' end, x.id, 'mfg_block:' || x.id || ':' || k || ':' || today,
               'Build unit blocked: ' || coalesce(x.data->>'number', x.title), (select string_agg(b->>'text', '; ') from jsonb_array_elements(bl) b where b->>'kind' = k), null, '/mfg?unit=' || x.id) then n := n + 1; end if;
        end if;
      end loop;
    end if;
    if public.mfg_status_kind(x.status) = 'build' and not exists (select 1 from public.mfg_acceptance a where a.unit_id = x.id and a.status <> 'Rejected')
       and public._mfg_acceptance_readiness(x, null)->>'status' = 'Ready' then
      for h in select hh from public.crm_cap_holders('unit_acceptance_approver') hh loop
        k := 'mfg_ready_acceptance:' || x.id;
        if not public._crm_seen(h, k) and public.notify_user(h, 'mfg_ready_acceptance', x.id, k, 'Ready for acceptance: ' || coalesce(x.data->>'number', x.title), 'Every acceptance rule is met', null, '/mfg?unit=' || x.id) then n := n + 1; end if;
      end loop;
    end if;
  end loop;
  -- inspections waiting to be recorded (to the people who hold the Quality Inspector capability)
  for x in select q.* from public.records q where q.section = 'operations.quality' and q.data ? 'inspection_kind' and q.status = 'Planned' and coalesce(q.data->>'recorded_at', '') = '' order by q.created_at limit 200 loop
    if clock_timestamp() - t0 > interval '2 seconds' then more := true; exit; end if;
    for h in select hh from public.crm_cap_holders('quality_inspector') hh loop
      k := 'mfg_inspection:' || x.id;
      if not public._crm_seen(h, k) and public.notify_user(h, 'mfg_inspection_required', x.id, k, 'Inspection to record: ' || x.title, coalesce(x.data->>'inspection_kind', ''), null, '/mfg?insp=' || x.id) then n := n + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'sent', n, 'more', more);
end $$;
revoke execute on function public.mfg_tick() from public, anon, authenticated;
grant execute on function public.mfg_tick() to service_role;

/* ----- QR codes and labels: a code opens the record only for someone who may open it ----- */
create or replace function public.mfg_resolve(p_code text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); c text := trim(coalesce(p_code, '')); kind text; v_id uuid; r public.records; s public.mfg_serials; l public.mfg_locations; lt public.mfg_lots;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if c ~* '^AGR1:[a-z_]+:[0-9a-f-]{36}$' then
    kind := lower(split_part(c, ':', 2)); v_id := public.as_uuid(split_part(c, ':', 3));
    if kind in ('unit', 'work_order', 'item', 'inspection', 'test', 'bom') then
      select * into r from public.records where records.id = v_id and section = case kind when 'unit' then 'operations.builds' when 'work_order' then 'operations.work_orders' when 'item' then 'technical.items'
        when 'inspection' then 'operations.quality' when 'test' then 'technical.testing' else 'technical.boms' end;
    elsif kind = 'serial' then select * into s from public.mfg_serials where mfg_serials.id = v_id;
    elsif kind = 'location' then select * into l from public.mfg_locations where mfg_locations.id = v_id;
    elsif kind = 'lot' then select * into lt from public.mfg_lots where mfg_lots.id = v_id;
    end if;
  elsif c ~* '^LOC:' then select * into l from public.mfg_locations where code = upper(substring(c from 5));
  else
    -- a printed number (unit, work order, item) or a serial number
    select x.* into r from public.records x where x.section in ('operations.builds', 'operations.work_orders', 'technical.items', 'operations.quality', 'technical.testing') and upper(coalesce(x.data->>'number', '')) = upper(c) limit 1;
    if r.id is null then select * into s from public.mfg_serials where upper(serial) = upper(c) or upper(coalesce(agron_serial, '')) = upper(c) order by created_at desc limit 1; end if;
  end if;
  if r.id is not null then
    if not public.record_visible_for(me, r) then return jsonb_build_object('found', false); end if;
    return jsonb_build_object('found', true, 'kind', case r.section when 'operations.builds' then 'unit' when 'operations.work_orders' then 'work_order' when 'technical.items' then 'item' when 'operations.quality' then 'inspection' when 'technical.testing' then 'test' else 'bom' end,
      'id', r.id, 'title', coalesce(r.data->>'number', '') || ' ' || r.title,
      'link', case r.section when 'operations.builds' then '/mfg?unit=' || r.id when 'operations.work_orders' then '/build?wo=' || r.id when 'technical.items' then '/mfg?item=' || r.id when 'technical.boms' then '/mfg?bom=' || r.id else '/' || replace(r.section, '.', '/') || '?r=' || r.id end);
  elsif s.id is not null then
    if public._mfg_item(me, s.item_id) is null or (s.unit_id is not null and not exists (select 1 from public.records u where u.id = s.unit_id and public.record_visible_for(me, u))) then return jsonb_build_object('found', false); end if;
    return jsonb_build_object('found', true, 'kind', 'serial', 'id', s.id, 'title', s.serial, 'link', '/mfg?serial=' || s.id);
  elsif l.id is not null then
    if not public._mfg_can_read(me, 'technical.items') then return jsonb_build_object('found', false); end if;
    return jsonb_build_object('found', true, 'kind', 'location', 'id', l.id, 'title', l.code || ' ' || l.name, 'link', '/mfg?tab=inventory&location=' || l.id);
  elsif lt.id is not null then
    if public._mfg_item(me, lt.item_id) is null then return jsonb_build_object('found', false); end if;
    return jsonb_build_object('found', true, 'kind', 'lot', 'id', lt.id, 'title', lt.lot_no, 'link', '/mfg?item=' || lt.item_id);
  end if;
  return jsonb_build_object('found', false);
end $$;
revoke execute on function public.mfg_resolve(text) from public, anon;
grant execute on function public.mfg_resolve(text) to authenticated;

-- what a printed internal label carries (never a certification mark); the QR holds an opaque reference
create or replace function public.mfg_label(p_kind text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); r public.records; s public.mfg_serials; l public.mfg_locations; lt public.mfg_lots; it public.records;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_kind in ('unit', 'work_order', 'item') then
    r := public._mfg_rec(me, p_id, case p_kind when 'unit' then 'operations.builds' when 'work_order' then 'operations.work_orders' else 'technical.items' end, 'Record');
    return jsonb_build_object('kind', p_kind, 'qr', 'AGR1:' || p_kind || ':' || r.id, 'big', coalesce(r.data->>'number', ''), 'title', r.title,
      'lines', jsonb_strip_nulls(jsonb_build_array(case p_kind when 'item' then concat_ws(' ', r.data->>'manufacturer', r.data->>'mpn') when 'unit' then concat_ws(' · ', r.data->>'product_ref_title', r.data->>'config_ref_title') else r.data->>'build_ref_title' end,
        case when p_kind = 'work_order' then r.data->>'operation' end)), 'footer', 'AGRON internal label');
  elsif p_kind = 'serial' then
    select * into s from public.mfg_serials where id = p_id;
    it := public._mfg_item(me, s.item_id);
    if s.id is null or it.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('kind', p_kind, 'qr', 'AGR1:serial:' || s.id, 'big', s.serial, 'title', it.title, 'lines', jsonb_build_array(coalesce(it.data->>'number', ''), coalesce(s.agron_serial, '')), 'footer', 'AGRON internal label');
  elsif p_kind = 'lot' then
    select * into lt from public.mfg_lots where id = p_id;
    it := public._mfg_item(me, lt.item_id);
    if lt.id is null or it.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('kind', p_kind, 'qr', 'AGR1:lot:' || lt.id, 'big', lt.lot_no, 'title', it.title, 'lines', jsonb_strip_nulls(jsonb_build_array(it.data->>'number', case when lt.expires is not null then 'Expires ' || lt.expires end)), 'footer', 'AGRON internal label');
  elsif p_kind = 'location' then
    if not public._mfg_can_read(me, 'technical.items') then raise exception 'Not allowed' using errcode = '42501'; end if;
    select * into l from public.mfg_locations where id = p_id;
    if l.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('kind', p_kind, 'qr', 'LOC:' || l.code, 'big', l.code, 'title', l.name, 'lines', jsonb_build_array(l.kind || ' · ' || l.purpose), 'footer', 'AGRON internal label');
  end if;
  raise exception 'Unknown label kind' using errcode = '22023';
end $$;
revoke execute on function public.mfg_label(text, uuid) from public, anon;
grant execute on function public.mfg_label(text, uuid) to authenticated;

/* ----- import: items, initial inventory, manufacturer part numbers, supplier mappings, a BOM draft ----- */
create or replace function public.mfg_import_preview(p_kind text, p_rows jsonb, p_target uuid default null) returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); x jsonb; k int := 0; out jsonb := '[]'::jsonb; errs text[]; warns text[]; dup jsonb; it public.records; l public.mfg_locations; v public.records; cnt jsonb := '{"ok":0,"error":0,"duplicate":0}'::jsonb; st text;
  types text[] := array(select jsonb_array_elements_text(public.mfg_cfg()->'item_types'));
begin
  if p_kind = 'inventory' then perform public._mfg_need(me, 'inventory_manager', 'Importing inventory');
  elsif p_kind = 'bom' then perform public._mfg_need(me, 'bom_editor', 'Importing a BOM draft');
  elsif not (public.has_cap(me, 'manufacturing_admin') or public.has_cap(me, 'bom_editor') or public.has_cap(me, 'inventory_manager')) then perform public._mfg_need(me, 'manufacturing_admin', 'Importing items'); end if;
  if p_kind not in ('items', 'inventory', 'supplier_parts', 'bom') then raise exception 'Unknown import kind' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'At most 5,000 rows per import' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    k := k + 1; errs := '{}'; warns := '{}'; dup := null; it := null; st := 'ok';
    if p_kind = 'items' then
      if coalesce(trim(x->>'description'), trim(x->>'name'), '') = '' then errs := errs || 'description is missing'::text; end if;
      if coalesce(x->>'item_type', '') <> '' and not (x->>'item_type' = any (types)) then errs := errs || ('unknown item type «' || (x->>'item_type') || '»')::text; end if;
      if coalesce(x->>'ref_cost', '') <> '' and public._num(x->'ref_cost') is null then errs := errs || 'reference cost is not a number'::text; end if;
      if coalesce(x->>'ref_cost', '') <> '' and coalesce(x->>'currency', '') = '' then errs := errs || 'a cost needs its currency'::text; end if;
      if coalesce(x->>'mpn', '') <> '' then
        select i.* into it from public.records i where i.section = 'technical.items' and lower(i.data->>'mpn') = lower(trim(x->>'mpn')) and lower(coalesce(i.data->>'manufacturer', '')) = lower(coalesce(trim(x->>'manufacturer'), '')) limit 1;
        if it.id is not null then dup := jsonb_build_object('id', it.id, 'number', it.data->>'number', 'title', it.title, 'why', 'same manufacturer and part number'); end if;
      end if;
    elsif p_kind = 'inventory' then
      select i.* into it from public.records i where i.section = 'technical.items' and (upper(i.data->>'number') = upper(trim(x->>'item')) or lower(coalesce(i.data->>'mpn', '')) = lower(trim(x->>'item'))) limit 1;
      if it.id is null or not public.record_visible_for(me, it) then errs := errs || ('item «' || coalesce(x->>'item', '') || '» not in the item master')::text; end if;
      select * into l from public.mfg_locations where code = upper(trim(coalesce(x->>'location', '')));
      if l.id is null then errs := errs || ('location «' || coalesce(x->>'location', '') || '» not found')::text; end if;
      if public._num(x->'qty') is null or public._num(x->'qty') <= 0 then errs := errs || 'quantity must be above zero'::text; end if;
      if coalesce(x->>'state', 'Available') not in ('Available', 'Quarantine', 'Inspection') then errs := errs || 'state is Available, Quarantine or Inspection'::text; end if;
      if it.id is not null and coalesce((it.data->>'serialized')::boolean, false) and coalesce(jsonb_array_length(case when jsonb_typeof(x->'serials') = 'array' then x->'serials' else to_jsonb(string_to_array(coalesce(x->>'serials', ''), '|')) end), 0) <> coalesce(public._num(x->'qty'), -1) then
        errs := errs || 'a serialized item needs one serial per unit (separated by |)'::text;
      end if;
      if it.id is not null and coalesce((it.data->>'lot_controlled')::boolean, false) and coalesce(x->>'lot', '') = '' then errs := errs || 'a lot-controlled item needs its lot number'::text; end if;
      if it.id is not null and l.id is not null and exists (select 1 from public.mfg_stock s where s.item_id = it.id and s.location_id = l.id and s.qty > 0) then
        warns := warns || 'stock exists here already: the import adds to it (nothing is overwritten)'::text;
      end if;
    elsif p_kind = 'supplier_parts' then
      select i.* into it from public.records i where i.section = 'technical.items' and upper(i.data->>'number') = upper(trim(coalesce(x->>'item', ''))) limit 1;
      if it.id is null or not public.record_visible_for(me, it) then errs := errs || ('item «' || coalesce(x->>'item', '') || '» not in the item master')::text; end if;
      select vv.* into v from public.records vv where vv.section = 'operations.vendors' and lower(vv.title) = lower(trim(coalesce(x->>'supplier', ''))) limit 1;
      if v.id is null then errs := errs || ('supplier «' || coalesce(x->>'supplier', '') || '» not found among the vendors')::text; end if;
      if it.id is not null and coalesce(it.data->>'vendor_ref', '') <> '' and coalesce((x->>'preferred')::boolean, false) and it.data->>'vendor_ref' is distinct from v.id::text then
        warns := warns || 'the item has another preferred supplier: it stays (the new one is added as an alternate)'::text;
      end if;
    elsif p_kind = 'bom' then
      select i.* into it from public.records i where i.section = 'technical.items' and (upper(i.data->>'number') = upper(trim(coalesce(x->>'item', ''))) or lower(coalesce(i.data->>'mpn', '')) = lower(trim(coalesce(x->>'item', '')))) limit 1;
      if it.id is null or not public.record_visible_for(me, it) then errs := errs || ('item «' || coalesce(x->>'item', '') || '» not in the item master')::text; end if;
      if public._num(x->'qty') is null or public._num(x->'qty') <= 0 then errs := errs || 'quantity must be above zero'::text; end if;
    end if;
    st := case when cardinality(errs) > 0 then 'error' when dup is not null then 'duplicate' else 'ok' end;
    cnt := jsonb_set(cnt, array[st], to_jsonb((cnt->>st)::int + 1));
    out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('row', k, 'status', st, 'errors', case when cardinality(errs) > 0 then to_jsonb(errs) end, 'warnings', case when cardinality(warns) > 0 then to_jsonb(warns) end,
      'duplicate', dup, 'item', case when it.id is not null then jsonb_build_object('id', it.id, 'number', it.data->>'number') end)));
  end loop;
  return jsonb_build_object('kind', p_kind, 'rows', out, 'summary', cnt, 'note', 'Nothing is imported until you confirm. Approved BOMs and existing stock are never overwritten.');
end $$;
revoke execute on function public.mfg_import_preview(text, jsonb, uuid) from public, anon;
grant execute on function public.mfg_import_preview(text, jsonb, uuid) to authenticated;

-- p_decisions: per row "create" | "skip" | "use" (use an existing duplicate). Rows with errors are skipped.
create or replace function public.mfg_import_commit(p_kind text, p_rows jsonb, p_decisions jsonb, p_file text default null, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); pv jsonb; x jsonb; k int := 0; batch uuid := gen_random_uuid(); made int := 0; n_linked int := 0; n_skipped int := 0; dec text; it public.records; l public.mfg_locations; v public.records; r public.records;
  v_report jsonb := '[]'::jsonb; lines jsonb := '[]'::jsonb; ser text[];
begin
  pv := public.mfg_import_preview(p_kind, p_rows, p_target);
  if p_kind = 'bom' then
    r := public._mfg_rec(me, p_target, 'technical.boms', 'BOM revision', true);
    if public._mfg_locked(r) is not null or r.status <> 'Draft' then raise exception 'A BOM is imported into a Draft revision only (approved revisions are never overwritten)' using errcode = '42501'; end if;
  end if;
  insert into public.mfg_imports(id, kind, created_by, file_name, rows_total) values (batch, p_kind, me, left(p_file, 200), jsonb_array_length(p_rows));
  for x in select * from jsonb_array_elements(p_rows) loop
    k := k + 1;
    dec := coalesce(p_decisions->>(k::text), case when pv->'rows'->(k - 1)->>'status' = 'ok' then 'create' else 'skip' end);
    if pv->'rows'->(k - 1)->>'status' = 'error' or dec = 'skip' then n_skipped := n_skipped + 1; v_report := v_report || jsonb_build_array(jsonb_build_object('row', k, 'result', 'skipped')); continue; end if;
    if p_kind = 'items' then
      if dec = 'use' and pv->'rows'->(k - 1)->'duplicate' is not null then n_linked := n_linked + 1; v_report := v_report || jsonb_build_array(jsonb_build_object('row', k, 'result', 'existing', 'id', pv->'rows'->(k - 1)->'duplicate'->>'id')); continue; end if;
      insert into public.records(section, title, status, controlled, created_by, data)
      values ('technical.items', left(trim(coalesce(x->>'description', x->>'name')), 300), coalesce(nullif(x->>'status', ''), 'Active'), coalesce(x->>'classification', '') = 'US Persons Only', me,
        jsonb_strip_nulls(jsonb_build_object('manufacturer', nullif(trim(x->>'manufacturer'), ''), 'mpn', nullif(trim(x->>'mpn'), ''), 'category', nullif(x->>'category', ''), 'uom', coalesce(nullif(x->>'uom', ''), 'ea'),
          'item_type', coalesce(nullif(x->>'item_type', ''), 'Purchased Part'), 'lead_time_days', public._num(x->'lead_time_days'), 'ref_cost', public._num(x->'ref_cost'), 'currency', nullif(x->>'currency', ''),
          'classification', nullif(x->>'classification', ''), 'serialized', case when lower(coalesce(x->>'serialized', '')) in ('yes', 'true', '1') then true end,
          'lot_controlled', case when lower(coalesce(x->>'lot_controlled', '')) in ('yes', 'true', '1') then true end, 'shelf_life_days', public._num(x->'shelf_life_days'), 'storage', nullif(x->>'storage', ''),
          'notes', nullif(left(x->>'notes', 2000), ''), 'import_batch', batch)))
      returning * into it;
      made := made + 1; v_report := v_report || jsonb_build_array(jsonb_build_object('row', k, 'result', 'created', 'id', it.id, 'number', it.data->>'number'));
    elsif p_kind = 'inventory' then
      select i.* into it from public.records i where i.section = 'technical.items' and (upper(i.data->>'number') = upper(trim(x->>'item')) or lower(coalesce(i.data->>'mpn', '')) = lower(trim(x->>'item'))) limit 1;
      select * into l from public.mfg_locations where code = upper(trim(x->>'location'));
      ser := case when jsonb_typeof(x->'serials') = 'array' then array(select jsonb_array_elements_text(x->'serials')) else string_to_array(nullif(x->>'serials', ''), '|') end;
      perform public._mfg_opening(me, it.id, l.id, public._num(x->'qty'), coalesce(nullif(x->>'state', ''), 'Available'), case when coalesce(x->>'lot', '') <> '' then jsonb_build_object('lot_no', x->>'lot', 'expires', x->>'expires', 'manufactured', x->>'manufactured') end, ser, batch);
      made := made + 1; v_report := v_report || jsonb_build_array(jsonb_build_object('row', k, 'result', 'opening balance', 'item', it.data->>'number', 'qty', public._num(x->'qty')));
    elsif p_kind = 'supplier_parts' then
      select i.* into it from public.records i where i.section = 'technical.items' and upper(i.data->>'number') = upper(trim(x->>'item')) limit 1 for update;
      select vv.* into v from public.records vv where vv.section = 'operations.vendors' and lower(vv.title) = lower(trim(x->>'supplier')) limit 1;
      if coalesce(it.data->>'vendor_ref', '') = '' and coalesce((x->>'preferred')::boolean, true) then
        perform public._mfg_sys_patch(it.id, null, jsonb_strip_nulls(jsonb_build_object('vendor_ref', v.id, 'vendor_ref_title', v.title, 'mpn', coalesce(it.data->>'mpn', nullif(x->>'mpn', '')), 'lead_time_days', coalesce(public._num(it.data->'lead_time_days'), public._num(x->'lead_time_days')))));
      else
        perform public._mfg_sys_patch(it.id, null, jsonb_build_object('alternate_suppliers', coalesce(it.data->'alternate_suppliers', '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('vendor_ref', v.id, 'vendor', v.title, 'mpn', nullif(x->>'mpn', ''), 'lead_time_days', public._num(x->'lead_time_days'))))));
      end if;
      n_linked := n_linked + 1; v_report := v_report || jsonb_build_array(jsonb_build_object('row', k, 'result', 'linked', 'item', it.data->>'number', 'supplier', v.title));
    elsif p_kind = 'bom' then
      select i.* into it from public.records i where i.section = 'technical.items' and (upper(i.data->>'number') = upper(trim(x->>'item')) or lower(coalesce(i.data->>'mpn', '')) = lower(trim(x->>'item'))) limit 1;
      lines := lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('key', coalesce(nullif(x->>'key', ''), k::text), 'parent', nullif(x->>'parent', ''), 'item', it.id, 'qty', public._num(x->'qty'), 'uom', x->>'uom',
        'position', x->>'position', 'required', case when lower(coalesce(x->>'optional', '')) in ('yes', 'true', '1') then false end, 'alt_group', nullif(x->>'alt_group', ''), 'notes', x->>'notes')));
      made := made + 1;
    end if;
  end loop;
  if p_kind = 'bom' then
    -- the lines already in the draft stay; the imported ones are added after them
    lines := coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', l.id::text, 'parent', l.parent_id::text, 'item', l.item_id, 'qty', l.qty, 'uom', l.uom, 'position', l.position,
        'required', l.required, 'alt_group', l.alt_group, 'notes', l.notes, 'source_doc', l.source_doc_id, 'source_version', l.source_version_id)) order by l.line_no)
      from public.mfg_bom_lines l where l.bom_id = r.id), '[]'::jsonb) || lines;
    perform public.mfg_bom_lines_save(r.id, lines);
    perform public._mfg_sys_patch(r.id, null, jsonb_build_object('import_batch', batch));
  end if;
  update public.mfg_imports set created = made, linked = n_linked, skipped = n_skipped, report = v_report where id = batch;
  perform public._mfg_audit(me, 'import', p_target, null, jsonb_build_object('batch', batch, 'kind', p_kind, 'created', made, 'linked', n_linked, 'skipped', n_skipped));
  return jsonb_build_object('ok', true, 'batch', batch, 'created', made, 'linked', n_linked, 'skipped', n_skipped, 'report', v_report);
end $$;
revoke execute on function public.mfg_import_commit(text, jsonb, jsonb, text, uuid) from public, anon;
grant execute on function public.mfg_import_commit(text, jsonb, jsonb, text, uuid) to authenticated;

-- an item import is undone (items not used anywhere since: no BOM line, no stock, no request)
create or replace function public.mfg_import_rollback(p_batch uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.mfg_viewer(); b public.mfg_imports; n int := 0; kept int := 0; x record;
begin
  perform public._mfg_need(me, 'manufacturing_admin', 'Undoing an import');
  select * into b from public.mfg_imports where id = p_batch for update;
  if not found then raise exception 'Import not found' using errcode = 'P0002'; end if;
  if b.status = 'rolled_back' then return jsonb_build_object('ok', true); end if;
  if b.kind <> 'items' then raise exception 'Only an item import is undone here (stock is corrected by an adjustment with a reason; a BOM draft is edited or retired)' using errcode = '55000'; end if;
  for x in select r.id from public.records r where r.section = 'technical.items' and r.data->>'import_batch' = p_batch::text loop
    if exists (select 1 from public.mfg_bom_lines l where l.item_id = x.id) or exists (select 1 from public.mfg_stock s where s.item_id = x.id) or exists (select 1 from public.mfg_txns t where t.item_id = x.id)
       or exists (select 1 from public.records q where q.data->>'item_ref' = x.id::text) then kept := kept + 1; continue; end if;
    delete from public.records where id = x.id; n := n + 1;
  end loop;
  update public.mfg_imports set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = me where id = b.id;
  perform public._mfg_audit(me, 'import_rolled_back', null, null, jsonb_build_object('batch', b.id, 'removed', n, 'kept_in_use', kept));
  return jsonb_build_object('ok', true, 'removed', n, 'kept_in_use', kept);
end $$;
revoke execute on function public.mfg_import_rollback(uuid) from public, anon;
grant execute on function public.mfg_import_rollback(uuid) to authenticated;

/* ----- export: what the person may open, the configured exclusions, every export audited ----- */
create or replace function public.mfg_export(p_kind text, p_ref uuid default null) returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare me uuid := public.mfg_viewer(); rows jsonb; excl text[] := array(select jsonb_array_elements_text(coalesce(public.mfg_cfg()->'export_excluded_fields', '[]'::jsonb))); cost boolean;
begin
  if not (public.has_cap(me, 'manufacturing_admin') or public.has_cap(me, 'build_manager') or public.has_cap(me, 'inventory_manager')) then perform public._mfg_need(me, 'build_manager', 'Exporting manufacturing data'); end if;
  cost := public._mfg_cost_ok(me);
  if p_kind = 'bom' then rows := public.mfg_bom_get(p_ref)->'lines';
  elsif p_kind = 'shortages' then rows := coalesce((select jsonb_agg(r) from jsonb_array_elements(public.mfg_material_plan(case when p_ref is null then '{}'::jsonb else jsonb_build_object('unit', p_ref) end)->'rows') r where (r->>'shortage')::numeric > 0), '[]'::jsonb);
  elsif p_kind = 'inventory' then rows := public.mfg_inventory(null, null, null, null, 1000);
  elsif p_kind = 'units' then rows := public.mfg_list('all', '{}'::jsonb);
  elsif p_kind = 'asbuilt' then rows := jsonb_build_array(public.mfg_asbuilt(p_ref)->'snapshot');
  elsif p_kind = 'tests' then rows := public.mfg_unit_tab(p_ref, 'tests')->'runs';
  elsif p_kind = 'inspections' then rows := public.mfg_unit_tab(p_ref, 'inspections');
  else raise exception 'Unknown export' using errcode = '22023'; end if;
  -- excluded fields are removed; values only for those the cost policy names
  rows := coalesce((select jsonb_agg((r - excl) - case when cost then array[]::text[] else array['ref_cost', 'value', 'currency', 'amount'] end) from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) r), '[]'::jsonb);
  perform public._mfg_audit(me, 'export', p_ref, case when p_kind in ('asbuilt', 'tests', 'inspections') then p_ref end, jsonb_build_object('kind', p_kind, 'rows', jsonb_array_length(rows)));
  return jsonb_build_object('kind', p_kind, 'rows', rows, 'exported_at', now(), 'by', public._wf_name(me));
end $$;
revoke execute on function public.mfg_export(text, uuid) from public, anon;
grant execute on function public.mfg_export(text, uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   18. Starting configuration: the approval policies for BOM revisions, configurations and test procedures
       (UNAPPROVED DEFAULT CONFIGURATION: capability holders, never named people) and their approval processes;
       the product families as starting data (Draft configurations — nothing is approved by a migration);
       the minimum inventory locations (renamed and extended in Manufacturing → Inventory → Locations)
   --------------------------------------------------------------------------------------------- */
insert into public.approval_policies(code, name, section, tiers, seeded, config_status) values
('BOM', 'BOM revision approval', 'technical.boms', $j$[
  {"label": "Every BOM revision", "mode": "sequential",
   "steps": [{"kind": "capability", "cap": "bom_approver", "label": "Engineering (BOM Approver)"}, {"kind": "capability", "cap": "build_manager", "label": "Manufacturing (Build Manager)"}]}
]$j$::jsonb, true, 'Draft'),
('CONFIG', 'Product configuration approval', 'technical.configurations', $j$[
  {"label": "Every configuration version", "mode": "sequential",
   "steps": [{"kind": "capability", "cap": "bom_approver", "label": "Engineering (BOM Approver)"}, {"kind": "capability", "cap": "build_manager", "label": "Manufacturing (Build Manager)"}]}
]$j$::jsonb, true, 'Draft'),
('TESTPROC', 'Test procedure approval', 'technical.test_procedures', $j$[
  {"label": "Every procedure version", "mode": "sequential", "steps": [{"kind": "capability", "cap": "test_approver", "label": "Test Approver"}]}
]$j$::jsonb, true, 'Draft')
on conflict (code) do nothing;

do $$
declare d jsonb; errs jsonb; nid uuid;
begin
  for d in select * from jsonb_array_elements($j$[
    {"code": "BOM", "name": "BOM revision approval", "category": "engineering", "source_section": "technical.boms", "owner_role": "engineering", "owner_department": "engineering",
     "completion": {"completed": "Approved", "rejected": "Draft", "cancelled": "Draft"},
     "description": "The exact line set of a BOM revision is approved (bound to its hash). A changed line is a new revision with a new approval.",
     "steps": [
      {"id": "approval", "name": "Approval of this revision", "type": "APPROVAL", "policy": "BOM", "record_status": "Review", "sla": {"amount": 3, "unit": "business_days"},
       "on": {"success": "$complete", "changes_requested": "revise", "rejected": "$reject"}},
      {"id": "revise", "name": "Revise the BOM", "type": "DATA", "responsible": {"kind": "requester"}, "record_status": "Draft",
       "instructions": "Change what the approver asked for, then submit: the approval is asked again on the new lines.", "on": {"success": "approval"}}]},
    {"code": "CONFIG", "name": "Configuration approval", "category": "engineering", "source_section": "technical.configurations", "owner_role": "engineering", "owner_department": "engineering",
     "completion": {"completed": "Approved", "rejected": "Draft", "cancelled": "Draft"},
     "description": "A configuration version is approved as it is; an approved configuration never changes (a new version or an engineering change).",
     "steps": [
      {"id": "approval", "name": "Approval of this version", "type": "APPROVAL", "policy": "CONFIG", "record_status": "Review", "sla": {"amount": 3, "unit": "business_days"},
       "on": {"success": "$complete", "changes_requested": "revise", "rejected": "$reject"}},
      {"id": "revise", "name": "Revise the configuration", "type": "DATA", "responsible": {"kind": "requester"}, "record_status": "Draft", "on": {"success": "approval"}}]},
    {"code": "TESTPROC", "name": "Test procedure approval", "category": "engineering", "source_section": "technical.test_procedures", "owner_role": "engineering", "owner_department": "engineering",
     "completion": {"completed": "Approved", "rejected": "Draft", "cancelled": "Draft"},
     "description": "A test procedure version and its structured fields are approved before any unit is tested against it.",
     "steps": [
      {"id": "approval", "name": "Approval of this version", "type": "APPROVAL", "policy": "TESTPROC", "record_status": "Review", "sla": {"amount": 3, "unit": "business_days"},
       "on": {"success": "$complete", "changes_requested": "revise", "rejected": "$reject"}},
      {"id": "revise", "name": "Revise the procedure", "type": "DATA", "responsible": {"kind": "requester"}, "record_status": "Draft", "on": {"success": "approval"}}]}
  ]$j$::jsonb) loop
    if exists (select 1 from public.wf_definitions w where w.code = d->>'code') then continue; end if;
    errs := public.wf_validate(d);
    if jsonb_array_length(errs) > 0 then raise exception 'Starting definition % is not valid: %', d->>'code', errs; end if;
    insert into public.wf_definitions(code, version, name, description, category, source_section, owner_department, owner_role, steps, sla, completion, template, state, published_at)
    values (d->>'code', 1, d->>'name', d->>'description', d->>'category', d->>'source_section', d->>'owner_department', d->>'owner_role', d->'steps', d->'sla', d->'completion', false, 'published', now())
    returning id into nid;
    insert into public.wf_events(kind, to_state, detail) values ('definition_published', 'published', jsonb_build_object('definition', nid, 'code', d->>'code', 'version', 1, 'by', 'v25 starting configuration'));
  end loop;
end $$;

-- the minimum locations (receiving, inspection and quarantine are needed by the receiving rules)
insert into public.mfg_locations(code, name, kind, purpose) values ('MAIN', 'Main facility (rename to the real site)', 'Facility', 'Storage') on conflict (code) do nothing;
insert into public.mfg_locations(code, name, kind, purpose, parent_id)
select v.code, v.name, 'Area', v.purpose, (select id from public.mfg_locations where code = 'MAIN') from (values
  ('RECV', 'Receiving', 'Receiving'), ('INSP', 'Inspection', 'Inspection'), ('QUAR', 'Quarantine', 'Quarantine'), ('STORE', 'Main warehouse', 'Storage'),
  ('PROD', 'Production floor', 'Production'), ('FG', 'Finished goods', 'Finished Goods'), ('SHIP', 'Shipping', 'Shipping')) v(code, name, purpose)
on conflict (code) do nothing;

/* ---------------------------------------------------------------------------------------------
   19. Once (the first time v25 is applied): the product families and their configurations as Draft starting data;
       the container builds onto the build lifecycle (the earlier status is kept for the rollback) and linked to their
       product and configuration; the earlier BOM lines into the item master and a Draft BOM revision per
       configuration; the earlier inventory and serial records into stock and serials. Every earlier record stays.
   --------------------------------------------------------------------------------------------- */
do $$
declare p record; c record; pid uuid; cid uuid; x record; it uuid; bid uuid; n int; loc uuid; lc text; st text; sid uuid; u public.records; owner_uid uuid;
begin
  if coalesce((public.mfg_cfg()->>'migrated')::boolean, false) then return; end if;
  -- the product families (names are data; a configuration is Draft until approved by its process)
  for p in select * from (values ('C20', 'StarDome C20', 'StarDome container', 'C20'), ('C40', 'StarDome C40', 'StarDome container', 'C40'), ('SPR', 'StarDome Sprinter', 'StarDome mobile', 'SPR')) v(code, name, family, unit_code) loop
    select id into pid from public.records where section = 'technical.products' and upper(data->>'code') = p.code;
    if pid is null then
      insert into public.records(section, title, status, data) values ('technical.products', p.name, 'Development',
        jsonb_build_object('code', p.code, 'family', p.family, 'uom', 'ea', 'unit_code', p.unit_code, 'seeded', true,
          'description', 'Starting data from Phase 8 (v25): confirm the lifecycle status, owners and description.'))
      returning id into pid;
    end if;
    for c in select * from (values ('C20', 'Base', 'C20 Base'), ('C20', 'Enhanced', 'C20 Enhanced'), ('C40', 'Base', 'C40 Base'), ('C40', 'Advanced', 'C40 Advanced'), ('C40', 'HQ', 'C40 HQ'),
                                   ('SPR', 'Base', 'Sprinter'), ('SPR', 'Advanced', 'Sprinter Advanced')) v(pc, name, legacy) where v.pc = p.code loop
      if not exists (select 1 from public.records where section = 'technical.configurations' and data->>'legacy_config' = c.legacy) then
        insert into public.records(section, title, status, data) values ('technical.configurations', p.name || ' ' || c.name, 'Draft',
          jsonb_build_object('code', p.code || '-' || upper(left(c.name, 3)), 'version', 1, 'name', c.name, 'product_ref', pid, 'product_ref_title', p.code, 'legacy_config', c.legacy, 'seeded', true,
            'required_inspections', '["Final Inspection"]'::jsonb, 'required_tests', '[]'::jsonb, 'routing', '[]'::jsonb,
            'notes', 'Starting data: add the routing, required tests and documents, then submit for approval.'));
      end if;
    end loop;
  end loop;
  perform set_config('agron.mfg_reason', 'Moved to the Phase 8 build lifecycle (v25)', true);
  -- container builds → build units (status names; the earlier status kept); product and configuration from the config field
  update public.records r set status = coalesce(public.mfg_cfg()->'legacy_status_map'->>r.status, r.status), data = r.data || jsonb_build_object('p8_prev_status', r.status)
   where r.section = 'operations.builds' and r.status is not null and public.mfg_cfg()->'legacy_status_map' ? r.status;
  update public.records r set data = r.data || jsonb_build_object('product_ref', pr.id, 'product_ref_title', pr.data->>'code', 'config_ref', cf.id, 'config_ref_title', cf.title, 'p8_linked', true)
    from public.records cf join public.records pr on pr.id = public.as_uuid(cf.data->>'product_ref')
   where r.section = 'operations.builds' and coalesce(r.data->>'config_ref', '') = '' and cf.section = 'technical.configurations' and cf.data->>'legacy_config' = r.data->>'config';
  -- the earlier BOM lines: one item per part number (or name), one Draft revision per configuration
  for c in select distinct l.data->>'config' cfg from public.records l where l.section = 'technical.bom' and coalesce(l.data->>'config', '') <> '' and not (l.data ? 'p8_migrated_to') loop
    select id into cid from public.records where section = 'technical.configurations' and data->>'legacy_config' = c.cfg limit 1;
    if cid is null then continue; end if;
    insert into public.records(section, title, status, data) values ('technical.boms', 'BOM — ' || c.cfg || ' (from the earlier BOM list)', 'Draft',
      jsonb_build_object('config_ref', cid, 'config_ref_title', (select title from public.records where id = cid), 'config_code', (select data->>'code' from public.records where id = cid), 'product_ref', (select data->>'product_ref' from public.records where id = cid),
        'change_reason', 'Migrated from the earlier BOM list (v25)', 'p8_migrated', true))
    returning id into bid;
    n := 0;
    for x in select l.* from public.records l where l.section = 'technical.bom' and l.data->>'config' = c.cfg and not (l.data ? 'p8_migrated_to') order by l.created_at loop
      select id into it from public.records i where i.section = 'technical.items'
        and ((coalesce(x.data->>'part_no', '') <> '' and lower(i.data->>'mpn') = lower(x.data->>'part_no')) or (coalesce(x.data->>'part_no', '') = '' and lower(i.title) = lower(coalesce(x.data->>'item', x.title)))) limit 1;
      if it is null then
        insert into public.records(section, title, status, controlled, data) values ('technical.items', left(coalesce(nullif(x.data->>'item', ''), x.title), 300), 'Active', x.controlled,
          jsonb_strip_nulls(jsonb_build_object('mpn', nullif(x.data->>'part_no', ''), 'item_type', 'Purchased Part', 'uom', 'ea', 'ref_cost', public._num(x.data->'unit_cost'), 'currency', case when public._num(x.data->'unit_cost') is not null then 'USD' end,
            'supplier_name', nullif(x.data->>'supplier', ''), 'p8_migrated', true, 'notes', x.data->>'notes')))
        returning id into it;
      end if;
      n := n + 1;
      insert into public.mfg_bom_lines(bom_id, line_no, item_id, qty, uom) values (bid, n, it, greatest(coalesce(public._num(x.data->'qty'), 1), 0.0001), 'ea');
      update public.records set data = data || jsonb_build_object('p8_migrated_to', bid) where id = x.id;
    end loop;
    update public.records set data = data || jsonb_build_object('lines_hash', public._mfg_lines_hash(bid), 'line_count', n) where id = bid;
  end loop;
  -- the earlier inventory and serial records → items, serials and stock (state from the earlier status)
  for x in select r.* from public.records r where r.section = 'operations.inventory' and not (r.data ? 'p8_migrated_to') order by r.created_at loop
    select id into it from public.records i where i.section = 'technical.items'
      and ((coalesce(x.data->>'part_no', '') <> '' and lower(i.data->>'mpn') = lower(x.data->>'part_no')) or (coalesce(x.data->>'part_no', '') = '' and lower(i.title) = lower(coalesce(nullif(x.data->>'model', ''), x.title)))) limit 1;
    if it is null then
      insert into public.records(section, title, status, controlled, data) values ('technical.items', left(coalesce(nullif(x.data->>'model', ''), x.title), 300), 'Active', x.controlled,
        jsonb_strip_nulls(jsonb_build_object('mpn', nullif(x.data->>'part_no', ''), 'item_type', 'Equipment', 'uom', 'ea', 'serialized', case when coalesce(x.data->>'serial', '') <> '' then true end, 'p8_migrated', true)))
      returning id into it;
    end if;
    lc := upper(left(regexp_replace(coalesce(nullif(x.data->>'location', ''), 'STORE'), '[^A-Za-z0-9]+', '-', 'g'), 40));
    lc := coalesce(nullif(trim(both '-' from lc), ''), 'STORE');
    insert into public.mfg_locations(code, name, kind, purpose, parent_id) values (lc, coalesce(nullif(x.data->>'location', ''), 'Main warehouse'), 'Area', 'Storage', (select id from public.mfg_locations where code = 'MAIN'))
      on conflict (code) do nothing;
    select id into loc from public.mfg_locations where code = lc;
    st := case x.status when 'In stock' then 'Available' when 'Reserved' then 'Available' when 'Installed' then 'Installed' when 'In repair' then 'Quarantine' when 'Returned' then 'Returned' else 'Available' end;
    select * into u from public.records where id = public.as_uuid(x.data->>'build_ref') and section = 'operations.builds';
    if st = 'Installed' and u.id is null then st := 'Available'; end if;
    if coalesce(x.data->>'serial', '') <> '' then
      insert into public.mfg_serials(item_id, serial, location_id, state, unit_id) values (it, trim(x.data->>'serial'), loc, st, case when st = 'Installed' then u.id end)
        on conflict (item_id, serial) do nothing returning id into sid;
      if sid is null then continue; end if;
    else sid := null; end if;
    if st in ('Available', 'Quarantine') then
      perform public._mfg_stock_add(it, loc, null, st, 1);
      perform public._mfg_txn('opening', it, 1, null, loc, null, st, null, sid, u.id, null, null, null, null, null, 'Migrated from the earlier inventory record (v25)', null, jsonb_build_object('record', x.id));
    elsif st = 'Installed' and u.id is not null then
      insert into public.mfg_installs(unit_id, item_id, serial_id, qty, installed_at) values (u.id, it, sid, 1, x.updated_at);
      perform public._mfg_txn('opening', it, 1, null, null, null, 'Installed', null, sid, u.id, null, null, null, null, null, 'Migrated: installed in the build (v25)', null, jsonb_build_object('record', x.id));
    end if;
    update public.records set data = data || jsonb_build_object('p8_migrated_to', it, 'p8_serial', sid) where id = x.id;
  end loop;
  update public.mfg_settings set value = value || '{"migrated": true}'::jsonb where id;
  perform set_config('agron.mfg_reason', '', true);
end $$;

-- the hourly job (service role) learns the manufacturing notices
grant execute on function public.mfg_tick() to service_role;

-- the API re-reads the functions
notify pgrst, 'reload schema';

commit;
