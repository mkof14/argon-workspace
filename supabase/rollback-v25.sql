-- AGRON Workspace — rollback of v25 (Phase 8) to v24. One transaction; safe to run more than once.
-- Data preserving: every table and every row stays (BOM lines, inventory ledger and balances, serials, lots,
-- allocations, installations, software history, test values, As-Built revisions, acceptance and shipment release,
-- change impact, settings, imports, the manufacturing audit, and the new fields on records). What goes: the v25
-- triggers, functions and record indexes; the earlier functions come back exactly as v24 shipped them; build
-- statuses moved by v25 go back to their earlier names (the earlier value was kept on each record). The
-- capability list of v24 applies again to new grants (grants made under v25 stay as rows).
begin;

do $$ begin
  if to_regprocedure('public.has_cap(uuid,text)') is null then raise exception 'This database is not at v24/v25'; end if;
end $$;

drop trigger if exists records_bmfg_0_map on public.records;
drop trigger if exists records_bmfg_a_guard on public.records;
drop trigger if exists records_bmfg_before on public.records;
drop trigger if exists records_mfg_after on public.records;
drop index if exists public.records_bom_number_idx;
drop index if exists public.records_bom_revision_uq;
drop index if exists public.records_build_ref_idx;
drop index if exists public.records_config_ref_idx;
drop index if exists public.records_config_version_uq;
drop index if exists public.records_item_mpn_idx;
drop index if exists public.records_item_ref_idx;
drop index if exists public.records_mfg_number_uq;
drop index if exists public.records_mfg_search_trgm_idx;
drop index if exists public.records_mfg_section_idx;
drop index if exists public.records_product_code_uq;
drop index if exists public.records_product_ref_idx;
drop index if exists public.records_wo_ref_idx;

-- the earlier functions, as they were
-- has_cap as in update-v24.sql
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

-- crm_cap_set as in update-v24.sql
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

-- crm_caps_list as in update-v24.sql
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

-- _policy_cap as in update-v24.sql
create or replace function public._policy_cap(p_code text, p_section text) returns text language sql immutable as $$
  select case when p_code like 'PROPOSAL%' or coalesce(p_section, '') like 'sales.%' then 'commercial_admin' else 'workflow_admin' end
$$;

-- ops_policy_approve as in update-v24.sql
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

-- ops_settings_get as in update-v24.sql
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

-- _wf_resp_error as in update-v24.sql
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

-- extra_visible as in update-v24.sql
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

-- record_visible as in update-v24.sql
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

-- record_visible_for as in update-v24.sql
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

-- corp_search as in update-v24.sql
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


-- the v25 functions (the append-only guard of v24 stays: it protects the history tables, which stay)
drop function if exists public._mfg_acceptance_readiness(u records, p_viewer uuid) cascade;
drop function if exists public._mfg_affected(p_bom uuid) cascade;
drop function if exists public._mfg_alt_ok(p_item uuid, p_sub uuid, u records) cascade;
drop function if exists public._mfg_applicable_bom(p_config uuid, p_seq integer, p_unit uuid) cascade;
drop function if exists public._mfg_asbuilt_build(p_unit uuid) cascade;
drop function if exists public._mfg_asbuilt_hash(j jsonb) cascade;
drop function if exists public._mfg_audit(p_actor uuid, p_kind text, p_record uuid, p_unit uuid, p_detail jsonb) cascade;
drop function if exists public._mfg_base(p_viewer uuid, p_only uuid, p_with_acceptance boolean) cascade;
drop function if exists public._mfg_blockers(u records, p_viewer uuid) cascade;
drop function if exists public._mfg_bom_rows(p_bom uuid) cascade;
drop function if exists public._mfg_build_readiness(u records, p_viewer uuid) cascade;
drop function if exists public._mfg_can_read(p_uid uuid, p_section text) cascade;
drop function if exists public._mfg_can_write(p_uid uuid, p_section text) cascade;
drop function if exists public._mfg_consume(p_unit uuid, p_wo uuid, p_item uuid, p_qty numeric, p_actor uuid, p_reason text, p_key text, p_lot uuid) cascade;
drop function if exists public._mfg_cost_ok(p_uid uuid) cascade;
drop function if exists public._mfg_date(t text) cascade;
drop function if exists public._mfg_default_location(p_purpose text) cascade;
drop function if exists public._mfg_doc_current(p_doc uuid) cascade;
drop function if exists public._mfg_doc_stale(w records) cascade;
drop function if exists public._mfg_evidence_count(p_section text, p_id uuid) cascade;
drop function if exists public._mfg_field_error(f jsonb) cascade;
drop function if exists public._mfg_find_unit(p_viewer uuid, p_arg text) cascade;
drop function if exists public._mfg_follow_ok(p_uid uuid, r records) cascade;
drop function if exists public._mfg_install(p_unit uuid, p_wo uuid, p_item uuid, p_serial uuid, p_qty numeric, p_position text, p_actor uuid, p_doc_version uuid, p_config jsonb, p_key text, p_reason text) cascade;
drop function if exists public._mfg_item(p_uid uuid, p_item uuid) cascade;
drop function if exists public._mfg_lines_hash(p_bom uuid) cascade;
drop function if exists public._mfg_list_rows(p_kind text, p_viewer uuid) cascade;
drop function if exists public._mfg_location(p_id uuid) cascade;
drop function if exists public._mfg_lock_item(p_item uuid) cascade;
drop function if exists public._mfg_locked(r records) cascade;
drop function if exists public._mfg_move(p_item uuid, p_from uuid, p_to uuid, p_lot uuid, p_fs text, p_ts text, p_qty numeric, p_serials uuid[], p_actor uuid, p_kind text, p_reason text, p_key text, p_unit uuid, p_wo uuid, p_detail jsonb) cascade;
drop function if exists public._mfg_nc_create(p_actor uuid, p jsonb) cascade;
drop function if exists public._mfg_need(p_uid uuid, p_cap text, p_what text) cascade;
drop function if exists public._mfg_next_revision(p_rev text) cascade;
drop function if exists public._mfg_opening(p_actor uuid, p_item uuid, p_location uuid, p_qty numeric, p_state text, p_lot jsonb, p_serials text[], p_batch uuid) cascade;
drop function if exists public._mfg_pin(p_unit uuid, p_actor uuid, p_config records, p_bom records, p_why text) cascade;
drop function if exists public._mfg_rec(p_uid uuid, p_id uuid, p_section text, p_what text, p_lock boolean) cascade;
drop function if exists public._mfg_record_rows(p_kind text, p_viewer uuid, p_limit integer) cascade;
drop function if exists public._mfg_release_alloc(p_alloc uuid, p_actor uuid, p_reason text) cascade;
drop function if exists public._mfg_req(p_unit uuid, p_viewer uuid) cascade;
drop function if exists public._mfg_routing(u records) cascade;
drop function if exists public._mfg_seen_key(p_key text) cascade;
drop function if exists public._mfg_shipping_readiness(u records) cascade;
drop function if exists public._mfg_software_add(p_unit uuid, p_actor uuid, p_wo uuid, x jsonb) cascade;
drop function if exists public._mfg_status(p_status text) cascade;
drop function if exists public._mfg_status_check(p_op text, o records, n records, p_actor uuid) cascade;
drop function if exists public._mfg_stock_add(p_item uuid, p_loc uuid, p_lot uuid, p_state text, p_qty numeric) cascade;
drop function if exists public._mfg_stock_take(p_item uuid, p_loc uuid, p_lot uuid, p_state text, p_qty numeric) cascade;
drop function if exists public._mfg_sys_patch(p_id uuid, p_status text, p_patch jsonb) cascade;
drop function if exists public._mfg_txn(p_kind text, p_item uuid, p_qty numeric, p_from uuid, p_to uuid, p_fs text, p_ts text, p_lot uuid, p_serial uuid, p_unit uuid, p_wo uuid, p_receipt uuid, p_alloc uuid, p_purchase uuid, p_actor uuid, p_reason text, p_key text, p_detail jsonb) cascade;
drop function if exists public._mfg_unit(p_uid uuid, p_unit uuid, p_lock boolean) cascade;
drop function if exists public._mfg_unit_done(u records) cascade;
drop function if exists public._mfg_unit_ok(p_uid uuid, u records) cascade;
drop function if exists public._mfg_wo_actor_ok(p_uid uuid, w records) cascade;
drop function if exists public._mfg_wo_insert(u records, p_actor uuid, st jsonb, p_status text, p_extra jsonb) cascade;
drop function if exists public._mfg_wo_open_prereqs(w records) cascade;
drop function if exists public._policy_approver(p_uid uuid) cascade;
drop function if exists public.business_cap_names() cascade;
drop function if exists public.mfg_accept(p_unit uuid, p jsonb) cascade;
drop function if exists public.mfg_adjust(p_item uuid, p_location uuid, p_state text, p_counted numeric, p_reason text, p_lot uuid, p_key text) cascade;
drop function if exists public.mfg_allocate(p_target jsonb, p_item uuid, p_qty numeric, p_location uuid, p_lot uuid, p_serials uuid[], p_reason text, p_key text) cascade;
drop function if exists public.mfg_alt_decide(p_id uuid, p_decision text, p_note text, p_ecr uuid) cascade;
drop function if exists public.mfg_alt_propose(p_item uuid, p_substitute uuid, p_scope text, p_target uuid, p_units uuid[], p_reason text) cascade;
drop function if exists public.mfg_alternates(p_item uuid) cascade;
drop function if exists public.mfg_asbuilt(p_unit uuid, p_revision integer) cascade;
drop function if exists public.mfg_asbuilt_generate(p_unit uuid) cascade;
drop function if exists public.mfg_assistant(p_intent text, p_arg text) cascade;
drop function if exists public.mfg_bom_compare(p_a uuid, p_b uuid) cascade;
drop function if exists public.mfg_bom_create(p_config uuid, p_title text, p_notes text) cascade;
drop function if exists public.mfg_bom_effectivity(p_bom uuid, p_eff jsonb) cascade;
drop function if exists public.mfg_bom_get(p_bom uuid) cascade;
drop function if exists public.mfg_bom_lines_save(p_bom uuid, p_lines jsonb) cascade;
drop function if exists public.mfg_cap_names() cascade;
drop function if exists public.mfg_cfg() cascade;
drop function if exists public.mfg_change_impact(p_ecr uuid) cascade;
drop function if exists public.mfg_def_new_version(p_id uuid, p_reason text, p_ecr uuid) cascade;
drop function if exists public.mfg_def_retire(p_id uuid, p_reason text) cascade;
drop function if exists public.mfg_def_submit(p_id uuid) cascade;
drop function if exists public.mfg_doc_impact(p_doc uuid) cascade;
drop function if exists public.mfg_ecr_candidates(p_ecr uuid) cascade;
drop function if exists public.mfg_ecr_confirm(p_ecr uuid, p_objects jsonb) cascade;
drop function if exists public.mfg_exec() cascade;
drop function if exists public.mfg_export(p_kind text, p_ref uuid) cascade;
drop function if exists public.mfg_follow_sections() cascade;
drop function if exists public.mfg_import_commit(p_kind text, p_rows jsonb, p_decisions jsonb, p_file text, p_target uuid) cascade;
drop function if exists public.mfg_import_preview(p_kind text, p_rows jsonb, p_target uuid) cascade;
drop function if exists public.mfg_import_rollback(p_batch uuid) cascade;
drop function if exists public.mfg_inspection_create(p jsonb) cascade;
drop function if exists public.mfg_inspection_record(p_id uuid, p jsonb) cascade;
drop function if exists public.mfg_inventory(p_q text, p_item uuid, p_location uuid, p_state text, p_limit integer) cascade;
drop function if exists public.mfg_inventory_value() cascade;
drop function if exists public.mfg_item_stock(p_item uuid) cascade;
drop function if exists public.mfg_label(p_kind text, p_id uuid) cascade;
drop function if exists public.mfg_list(p_kind text, p_filter jsonb) cascade;
drop function if exists public.mfg_location_save(p jsonb) cascade;
drop function if exists public.mfg_locations() cascade;
drop function if exists public.mfg_material_plan(p_scope jsonb) cascade;
drop function if exists public.mfg_move(p_item uuid, p_from uuid, p_to uuid, p_qty numeric, p_lot uuid, p_serials uuid[], p_state text, p_key text) cascade;
drop function if exists public.mfg_my_caps() cascade;
drop function if exists public.mfg_nc_close(p_issue uuid, p_note text) cascade;
drop function if exists public.mfg_nc_create(p jsonb) cascade;
drop function if exists public.mfg_nc_disposition(p_issue uuid, p_disposition text, p_note text) cascade;
drop function if exists public.mfg_overview() cascade;
drop function if exists public.mfg_planned_vs_built(p_unit uuid) cascade;
drop function if exists public.mfg_procedure_check(p_fields jsonb) cascade;
drop function if exists public.mfg_product_view(p_product uuid) cascade;
drop function if exists public.mfg_products() cascade;
drop function if exists public.mfg_queue() cascade;
drop function if exists public.mfg_readiness(p_unit uuid) cascade;
drop function if exists public.mfg_reassign(p_alloc uuid, p_unit uuid, p_reason text) cascade;
drop function if exists public.mfg_receive(p_purchase uuid, p_qty numeric, p_rejected numeric, p_condition text, p_note text, p_date date, p_location uuid, p_serials text[], p_lot jsonb, p_key text) cascade;
drop function if exists public.mfg_release(p_alloc uuid, p_reason text) cascade;
drop function if exists public.mfg_remove(p_install uuid, p_reason text, p_to text, p_location uuid) cascade;
drop function if exists public.mfg_resolve(p_code text) cascade;
drop function if exists public.mfg_rework_create(p_issue uuid, p jsonb) cascade;
drop function if exists public.mfg_search_text(t text, d jsonb) cascade;
drop function if exists public.mfg_sections() cascade;
drop function if exists public.mfg_serial(p_id uuid) cascade;
drop function if exists public.mfg_serial_search(p_q text, p_limit integer) cascade;
drop function if exists public.mfg_set_state(p_item uuid, p_location uuid, p_from text, p_to text, p_qty numeric, p_lot uuid, p_serials uuid[], p_reason text, p_inspection uuid, p_key text) cascade;
drop function if exists public.mfg_settings_get() cascade;
drop function if exists public.mfg_settings_save(p_value jsonb, p_version integer) cascade;
drop function if exists public.mfg_ship_release(p_unit uuid, p jsonb) cascade;
drop function if exists public.mfg_shipping_save(p_unit uuid, p jsonb) cascade;
drop function if exists public.mfg_shortage_request(p_unit uuid, p_item uuid, p_qty numeric, p_needed_by date, p_note text) cascade;
drop function if exists public.mfg_software_install(p_unit uuid, p jsonb) cascade;
drop function if exists public.mfg_status_kind(p_status text) cascade;
drop function if exists public.mfg_supplier_performance(p_vendor uuid) cascade;
drop function if exists public.mfg_test_approve(p_run uuid, p_note text) cascade;
drop function if exists public.mfg_test_create(p_unit uuid, p_procedure uuid, p jsonb) cascade;
drop function if exists public.mfg_test_record(p_run uuid, p jsonb) cascade;
drop function if exists public.mfg_tick() cascade;
drop function if exists public.mfg_today() cascade;
drop function if exists public.mfg_unit_cost(p_unit uuid) cascade;
drop function if exists public.mfg_unit_create(p jsonb, p_release boolean) cascade;
drop function if exists public.mfg_unit_disposition(p_bom uuid, p_unit uuid, p_decision text, p_note text) cascade;
drop function if exists public.mfg_unit_release(p_unit uuid) cascade;
drop function if exists public.mfg_unit_status(p_unit uuid, p_status text, p_reason text, p_exception text) cascade;
drop function if exists public.mfg_unit_tab(p_unit uuid, p_tab text) cascade;
drop function if exists public.mfg_unit_view(p_unit uuid) cascade;
drop function if exists public.mfg_viewer() cascade;
drop function if exists public.mfg_weekly(p_from date, p_to date) cascade;
drop function if exists public.mfg_wo(p_wo uuid) cascade;
drop function if exists public.mfg_wo_block(p_wo uuid, p_blocked boolean, p_reason text) cascade;
drop function if exists public.mfg_wo_complete(p_wo uuid, p jsonb) cascade;
drop function if exists public.mfg_wo_create(p_unit uuid, p jsonb) cascade;
drop function if exists public.mfg_wo_generate(p_unit uuid) cascade;
drop function if exists public.mfg_wo_repin(p_wo uuid, p_reason text) cascade;
drop function if exists public.mfg_wo_start(p_wo uuid) cascade;
drop function if exists public.records_mfg_after() cascade;
drop function if exists public.records_mfg_before() cascade;
drop function if exists public.records_mfg_guard() cascade;
drop function if exists public.records_mfg_map() cascade;

-- capabilities: the v24 list again for new grants (existing rows are kept: the check is not validated against them)
alter table public.crm_caps drop constraint if exists crm_caps_cap_check;
alter table public.crm_caps add constraint crm_caps_cap_check check (cap in ('commercial_admin', 'workflow_admin', 'pricing_approver', 'proposal_approver', 'export_commercial')) not valid;

-- build statuses back to the earlier names (only where v25 moved them); the product and configuration links stay
update public.records set status = data->>'p8_prev_status', data = data - 'p8_prev_status' where data ? 'p8_prev_status' and section = 'operations.builds';
-- the next apply of v25 moves the data again (the earlier BOM and inventory records are not migrated twice)
update public.mfg_settings set value = value - 'migrated' where id;

-- the settings keys v25 added to the operations settings
update public.ops_settings set value = jsonb_set(jsonb_set(value, '{numbering}', coalesce(value->'numbering', '{}'::jsonb) - array['technical.items', 'technical.boms', 'operations.work_orders', 'operations.quality', 'technical.testing', 'technical.configurations', 'technical.test_procedures']),
  '{material}', coalesce(value->'material', '{}'::jsonb) - array['technical.boms', 'technical.configurations']) where id;

-- access: the new sections
delete from public.section_access where section in ('technical.products', 'technical.configurations', 'technical.items', 'technical.boms', 'technical.test_procedures', 'operations.work_orders');

notify pgrst, 'reload schema';
commit;
