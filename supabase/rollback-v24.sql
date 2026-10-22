-- AGRON Workspace — rollback of v24 (Phase 7) to v23. One transaction; safe to run more than once.
-- Data preserving: every table and every row stays (the commercial history, capabilities, imports, e-mail links,
-- settings and the new fields on records). What goes: the v24 triggers, functions, indexes and the working-set
-- type; the earlier functions come back exactly as v21–v23 shipped them; statuses moved by v24 go back to their
-- earlier names (the earlier value was kept on each record). Records created after v24 keep their own statuses.
begin;

do $$ begin
  if to_regprocedure('public._ops_base(uuid,text[],boolean,boolean)') is null then raise exception 'This database is not at v23/v24'; end if;
end $$;

drop trigger if exists records_crm_a_guard on public.records;
drop trigger if exists records_crm_before on public.records;
drop trigger if exists records_crm_after on public.records;
drop index if exists public.records_crm_act_last_idx;
drop index if exists public.records_crm_meet_last_idx;
drop index if exists public.records_crm_prop_last_idx;
drop index if exists public.records_opp_number_uq;
drop index if exists public.records_prp_version_uq;
drop index if exists public.records_deal_ref_idx;
drop index if exists public.records_contact_ref_idx;
drop index if exists public.records_crm_section_idx;
drop index if exists public.records_crm_email_idx;
drop index if exists public.records_crm_event_idx;
drop index if exists public.records_crm_owner_idx;
drop index if exists public.records_crm_name_idx;
drop index if exists public.records_crm_search_trgm_idx;
drop index if exists public.records_crm_norm_idx;
drop index if exists public.records_crm_domain_idx;
drop index if exists public.records_crm_phone_idx;

-- the earlier functions, as they were
-- mgmt_visible as in update-v22.sql
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
      when r.section = 'company.decisions' and coalesce(r.data->>'source_ref', '') ~ '^[0-9a-f-]{36}$' then coalesce(public.extra_visible(p.id, r), false)
      else true end;
end $$;

-- _mgmt_base as in update-v22.sql
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

-- _wf_approval_open as in update-v23.sql
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

-- _wf_facts as in update-v23.sql
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
    f := f || jsonb_build_object('documents', case when v is not null then 1 else 0 end, 'document_version', v, 'obligations', q, 'amount', public._num(r.data->'amount'), 'currency', r.data->>'currency');
  elsif r.section = 'technical.changes' then
    f := f || jsonb_build_object('impact_complete', coalesce(r.data->>'impact_confirmed_at', '') <> '', 'amount', public._num(r.data->'impact_cost'));
  elsif r.section = 'company.travel' then
    f := f || jsonb_build_object('amount', public._num(r.data->'est_cost'), 'currency', r.data->>'currency');
  else
    f := f || jsonb_build_object('amount', public._num(r.data->'amount'), 'currency', r.data->>'currency');
  end if;
  return f;
end $$;

-- wf_definition_save as in update-v23.sql
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

-- wf_definition_publish as in update-v23.sql
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

-- wf_definition_new_version as in update-v23.sql
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

-- wf_definition_disable as in update-v23.sql
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

-- corp_search as in update-v21.sql
create or replace function public.corp_search(p_q text, p_types text[] default null, p_project uuid default null, p_department text default null, p_person uuid default null,
  p_doc_type text default null, p_from date default null, p_to date default null, p_classification text default null, p_status text default null, p_limit integer default 40)
returns table (kind text, id uuid, record_id uuid, section text, title text, excerpt text, project_ref text, version text, owner_id text, updated_at timestamptz, link text, rank real)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := auth.uid(); pr public.profiles; q text := lower(trim(coalesce(p_q, ''))); w1 text; tsq tsquery; lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  sec_kind jsonb := '{"company.documents":"document","company.wiki":"knowledge","company.projects":"project","company.tasks":"task","company.meetings":"meeting","company.decisions":"decision","company.announcements":"announcement","company.milestones":"milestone"}';
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
    order by (lower(r.title) like '%' || q || '%') desc, r.updated_at desc
    limit 400
  ), recv as (select x.* from rec x join public.records rr on rr.id = x.id where public.record_visible(rr)
      and not exists (select 1 from unnest(string_to_array(q, ' ')) w where w <> '' and position(w in lower(x.title || ' ' || coalesce(x.data::text, ''))) = 0)
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

-- wf_rule_error as in update-v23.sql
create or replace function public.wf_rule_error(r jsonb, depth integer default 0) returns text
language plpgsql immutable set search_path = public as $$
declare x jsonb; e text; f text; o text; facts text[] := array['quotations', 'selected', 'amount', 'currency', 'approval_current', 'vendor_status',
  'impact_complete', 'received_all', 'received_any', 'budget_remaining', 'documents', 'paid', 'document_version', 'days_to_need', 'obligations'];
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

-- wf_migrate as in update-v23.sql
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

-- _ops_admin as in update-v23.sql
create or replace function public._ops_admin(p_uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_uid and not p.disabled and p.role in ('owner', 'admin', 'management'))
$$;

-- _wf_resp_error as in update-v23.sql
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

-- extra_visible as in update-v23.sql
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

-- record_visible as in update-v23.sql
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

-- record_visible_for as in update-v23.sql
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

-- ops_settings_get as in update-v23.sql
create or replace function public.ops_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.ops_viewer();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return jsonb_build_object('value', public.ops_cfg(), 'version', (select version from public.ops_settings where id),
    'policies', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'section', p.section, 'active', p.active, 'tiers', p.tiers, 'version', p.version) order by p.code) from public.approval_policies p), '[]'::jsonb),
    'can_edit', exists (select 1 from public.profiles x where x.id = me and x.role in ('owner', 'admin')));
end $$;

-- ops_settings_save as in update-v23.sql
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

-- ops_policy_save as in update-v23.sql
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


-- the v24 functions and the working-set type (the append-only guard stays: it protects the history tables, which stay)
drop function if exists public._crm_base(p_viewer uuid);
drop function if exists public._crm_base(p_viewer uuid, p_only uuid);
drop function if exists public._crm_blank(v jsonb);
drop function if exists public._crm_can_write(p_uid uuid, p_section text);
drop function if exists public._crm_date(t text);
drop function if exists public._crm_follow_ok(p_uid uuid, r records);
drop function if exists public._crm_free_mail(d text);
drop function if exists public._crm_import_fields(p_kind text);
drop function if exists public._crm_import_section(p_kind text);
drop function if exists public._crm_kind_ok(v crm_vrow, p_kind text, p_me uuid);
drop function if exists public._crm_lead_row(l records);
drop function if exists public._crm_match(v crm_vrow, f jsonb, q text);
drop function if exists public._crm_name(p_uid uuid);
drop function if exists public._crm_nda(o jsonb, c_status text, c_end text);
drop function if exists public._crm_opp_ok(p_uid uuid, o records);
drop function if exists public._crm_patch(p_id uuid, p_patch jsonb, p_reason text);
drop function if exists public._crm_pick(p_kind text, p_choice jsonb, p_me uuid, p_seed jsonb);
drop function if exists public._crm_proposal_approved(r records);
drop function if exists public._crm_proposal_check(p_op text, o records, n records);
drop function if exists public._crm_row(v crm_vrow);
drop function if exists public._crm_settings_error(v jsonb);
drop function if exists public._crm_stage(p_stage text);
drop function if exists public._crm_stage_check(p_op text, o records, n records, p_actor uuid);
drop function if exists public._crm_sums(p_rows jsonb);
drop function if exists public._policy_cap(p_code text, p_section text);
drop function if exists public.crm_assistant(p_intent text, p_arg text);
drop function if exists public.crm_bulk_assign(p_leads uuid[], p_owner uuid, p_follow_up date);
drop function if exists public.crm_cap_holders(p_cap text);
drop function if exists public.crm_cap_set(p_user uuid, p_cap text, p_on boolean);
drop function if exists public.crm_caps_list();
drop function if exists public.crm_catalogs();
drop function if exists public.crm_cfg();
drop function if exists public.crm_digits(t text);
drop function if exists public.crm_dupes(p_kind text, p jsonb);
drop function if exists public.crm_email_link(p_source_kind text, p_source_id text, p_target uuid, p_accept boolean, p_subject text, p_from text);
drop function if exists public.crm_email_suggest(p_from text, p_subject text, p_source_kind text, p_source_id text);
drop function if exists public.crm_event_day(p_event uuid, p_day date);
drop function if exists public.crm_event_followup(p_event uuid);
drop function if exists public.crm_export(p_kind text, p_filter jsonb);
drop function if exists public.crm_follow_sections();
drop function if exists public.crm_followups(p_scope text);
drop function if exists public.crm_forecast(p_from date, p_to date, p_bucket text, p_filter jsonb);
drop function if exists public.crm_handoff(p_opp uuid);
drop function if exists public.crm_handoff_project(p_opp uuid, p_mode text, p_project uuid, p jsonb);
drop function if exists public.crm_import_commit(p_kind text, p_rows jsonb, p_decisions jsonb, p_file text);
drop function if exists public.crm_import_preview(p_kind text, p_rows jsonb);
drop function if exists public.crm_import_rollback(p_batch uuid);
drop function if exists public.crm_imports_list();
drop function if exists public.crm_lead_capture(p jsonb);
drop function if exists public.crm_lead_convert(p_lead uuid, p jsonb);
drop function if exists public.crm_leads(p_filter jsonb, p_limit integer);
drop function if exists public.crm_list(p_kind text, p_q text, p_limit integer, p_filter jsonb);
drop function if exists public.crm_merge(p_kind text, p_keep uuid, p_merge uuid, p_reason text);
drop function if exists public.crm_my_caps();
drop function if exists public.crm_norm(t text);
drop function if exists public.crm_opp(p_id uuid);
drop function if exists public.crm_overview(p_filter jsonb);
drop function if exists public.crm_pipeline_value(p_filter jsonb);
drop function if exists public.crm_proposal_new_version(p_id uuid, p_reason text);
drop function if exists public.crm_proposal_submit(p_id uuid);
drop function if exists public.crm_relations(p_id uuid);
drop function if exists public.crm_search_text(t text, d jsonb);
drop function if exists public.crm_sections();
drop function if exists public.crm_settings_get();
drop function if exists public.crm_settings_save(p_value jsonb, p_version integer);
drop function if exists public.crm_stage_kind(p_stage text);
drop function if exists public.crm_tick();
drop function if exists public.crm_timeline(p_id uuid, p_limit integer);
drop function if exists public.crm_viewer();
drop function if exists public.crm_waiting();
drop function if exists public.crm_weekly(p_from date, p_to date);
drop function if exists public.has_cap(p_uid uuid, p_cap text);
drop function if exists public.ops_policy_approve(p_code text, p_version integer);
drop function if exists public.records_crm_after();
drop function if exists public.records_crm_before();
drop function if exists public.records_crm_guard();
drop function if exists public._crm_seen(p_user uuid, p_key text);
drop type if exists public.crm_vrow cascade;

-- statuses back to the earlier names (only where v24 moved them). The numbers, versions, organisation links and
-- relationship types v24 added stay: they are facts, unknown to v23 and harmless there, and the next apply reuses them
update public.records set status = data->>'p7_prev_status', data = data - 'p7_prev_status' where data ? 'p7_prev_status' and section in ('sales.pipeline', 'marketing.leads', 'company.contacts');
-- the next apply of v24 moves the data again
update public.crm_settings set value = value - 'migrated' where id;

-- access: the new section and the leads change for management
delete from public.section_access where section = 'sales.introductions';
update public.section_access set can_write = false where section = 'marketing.leads' and role = 'management'
  and coalesce((select (value->>'leads_mgmt_write_changed')::boolean from public.crm_settings where id), false);
update public.crm_settings set value = value - 'leads_mgmt_write_changed' where id;

notify pgrst, 'reload schema';
commit;
