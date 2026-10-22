-- AGRON Workspace — rollback of v23 (Phase 6) to the v22 behaviour. Data-preserving: every record (purchase requests,
-- quotations, receipts, payment requests, obligations, issues, travel and general requests, parties — and the
-- party_ref links on vendors, clients and partners) is kept, and so are the tables v23 created (process definitions,
-- instances, step runs, links, the append-only history, approval policies and their history, operations settings and
-- their history, extraction proposals) and the approval columns it added. Only v23's functions and triggers go, the
-- v21 reading rule and the v19 task rule come back, and the new sections and the procurement role leave the access
-- map (their records stay, readable again after v23 is applied). Process actions waiting in the Phase 1 queue are set
-- to failed (an administrator can requeue them after v23 is applied again). Safe to run twice.
begin;

drop trigger if exists records_ops_before on public.records;
drop trigger if exists records_ops_guard on public.records;
drop trigger if exists records_ops_after on public.records;

drop function if exists public._luhn(s text) cascade;
drop function if exists public._num(v jsonb) cascade;
drop function if exists public._ops_admin(p_uid uuid) cascade;
drop function if exists public._ops_base(p_viewer uuid, p_secs text[], p_closed boolean, p_open_only boolean) cascade;
drop function if exists public._ops_budget_calc(p_project uuid, p_viewer uuid) cascade;
drop function if exists public._ops_clean(p jsonb) cascade;
drop function if exists public._ops_items(p_viewer uuid, p_kinds text[]) cascade;
drop function if exists public._ops_kind_secs(p_kinds text[]) cascade;
drop function if exists public._wf_approval_current(p_inst uuid, r records) cascade;
drop function if exists public._wf_approval_decide(p_actor uuid, p_id uuid, p_decision text, p_comment text) cascade;
drop function if exists public._wf_approval_open(p_run uuid, st jsonb, i wf_instances, r records, p_actor uuid) cascade;
drop function if exists public._wf_auto_exec(p_run uuid, st jsonb, p_inst uuid, p_actor uuid) cascade;
drop function if exists public._wf_automate(p_run uuid, st jsonb, i wf_instances, r records, p_actor uuid) cascade;
drop function if exists public._wf_basis(r records) cascade;
drop function if exists public._wf_block(p_inst uuid, p_run uuid, p_reason text, p_actor uuid) cascade;
drop function if exists public._wf_can_act(p_actor uuid, s wf_step_runs, r records) cascade;
drop function if exists public._wf_cancel_tasks(p_inst uuid) cascade;
drop function if exists public._wf_close(p_inst uuid, p_outcome text, p_actor uuid, p_note text) cascade;
drop function if exists public._wf_could_see(p_uid uuid, r records) cascade;
drop function if exists public._wf_ctx(p_inst uuid, r records, p_actor uuid) cascade;
drop function if exists public._wf_engine() cascade;
drop function if exists public._wf_enter(p_inst uuid, p_step text, p_actor uuid, p_reason text) cascade;
drop function if exists public._wf_event(p_inst uuid, p_run uuid, p_actor uuid, p_kind text, p_step text, p_from text, p_to text, p_detail jsonb) cascade;
drop function if exists public._wf_facts(p_inst uuid, r records) cascade;
drop function if exists public._wf_finish(p_run uuid, p_actor uuid, p_outcome text, p_note text) cascade;
drop function if exists public._wf_invalidate(p_record uuid, p_reason text, p_actor uuid) cascade;
drop function if exists public._wf_missing(st jsonb, r records) cascade;
drop function if exists public._wf_name(p_uid uuid) cascade;
drop function if exists public._wf_notify(p_uid uuid, p_role text, p_kind text, r records, p_key text, p_title text, p_body text, p_actor uuid, p_link text) cascade;
drop function if exists public._wf_rec_patch(p_id uuid, p_status text, p_patch jsonb) cascade;
drop function if exists public._wf_resolve(sp jsonb, p_inst uuid, r records, p_def uuid, OUT o_uid uuid, OUT o_role text) cascade;
drop function if exists public._wf_resp_error(sp jsonb, what text) cascade;
drop function if exists public._wf_sla_error(s jsonb, what text) cascade;
drop function if exists public._wf_start(p_actor uuid, p_code text, p_record uuid, p_priority text) cascade;
drop function if exists public._wf_step(p_def uuid, p_step text) cascade;
drop function if exists public._wf_task(p_run uuid, st jsonb, i wf_instances, r records, p_actor uuid, p_kind text) cascade;
drop function if exists public._wf_task_actor(p_uid uuid, p_run uuid) cascade;
drop function if exists public._wf_task_closed(t records) cascade;
drop function if exists public.ops_assistant(p_intent text, p_arg text) cascade;
drop function if exists public.ops_attention() cascade;
drop function if exists public.ops_budget(p_project uuid) cascade;
drop function if exists public.ops_cfg() cascade;
drop function if exists public.ops_compare_quotes(p_request uuid) cascade;
drop function if exists public.ops_deadlines(p_days integer, p_q text) cascade;
drop function if exists public.ops_ecr_candidates(p_ecr uuid) cascade;
drop function if exists public.ops_ecr_confirm_impact(p_ecr uuid, p_note text) cascade;
drop function if exists public.ops_guard(p_op text, o records, n records) cascade;
drop function if exists public.ops_instance(p_id uuid) cascade;
drop function if exists public.ops_involved(p_uid uuid, r records) cascade;
drop function if exists public.ops_list(p_kind text, p_limit integer, p_q text) cascade;
drop function if exists public.ops_my_processes() cascade;
drop function if exists public.ops_number(p_section text, p_project uuid) cascade;
drop function if exists public.ops_overview() cascade;
drop function if exists public.ops_party(p_id uuid) cascade;
drop function if exists public.ops_policy_save(p_code text, p_name text, p_tiers jsonb, p_active boolean) cascade;
drop function if exists public.ops_proposal_add(p_actor uuid, p_source uuid, p_kind text, p_target text, p_proposed jsonb, p_method text, p_evidence jsonb) cascade;
drop function if exists public.ops_proposal_decide(p_id uuid, p_accept boolean, p_values jsonb, p_note text) cascade;
drop function if exists public.ops_proposals(p_source uuid) cascade;
drop function if exists public.ops_receive(p_purchase uuid, p_qty numeric, p_rejected numeric, p_condition text, p_note text, p_date date) cascade;
drop function if exists public.ops_record_payment(p_payment uuid, p_paid_on date, p_amount numeric, p_reference text, p_note text) cascade;
drop function if exists public.ops_record_processes(p_record uuid) cascade;
drop function if exists public.ops_request_create(p_type text, p_title text, p_data jsonb, p_priority text) cascade;
drop function if exists public.ops_request_types() cascade;
drop function if exists public.ops_secret_check(d jsonb) cascade;
drop function if exists public.ops_sections() cascade;
drop function if exists public.ops_select_quote(p_request uuid, p_quote uuid, p_reason text) cascade;
drop function if exists public.ops_settings_get() cascade;
drop function if exists public.ops_settings_save(p_value jsonb, p_version integer) cascade;
drop function if exists public.ops_viewer() cascade;
drop function if exists public.ops_visible_ids() cascade;
drop function if exists public.ops_weekly(p_from timestamp with time zone, p_to timestamp with time zone) cascade;
drop function if exists public.records_ops_after() cascade;
drop function if exists public.records_ops_before() cascade;
drop function if exists public.records_ops_guard() cascade;
drop function if exists public.sla_add(p_from timestamp with time zone, p_amount numeric, p_unit text, p_weekend integer[]) cascade;
drop function if exists public.wf_act(p_run uuid, p_outcome text, p_note text) cascade;
drop function if exists public.wf_approval_decide(p_id uuid, p_decision text, p_comment text) cascade;
drop function if exists public.wf_automation_execute(p_queue uuid) cascade;
drop function if exists public.wf_cancel(p_inst uuid, p_note text) cascade;
drop function if exists public.wf_definition_disable(p_code text, p_on boolean) cascade;
drop function if exists public.wf_definition_new_version(p_code text) cascade;
drop function if exists public.wf_definition_publish(p_id uuid) cascade;
drop function if exists public.wf_definition_save(p jsonb) cascade;
drop function if exists public.wf_definitions_list() cascade;
drop function if exists public.wf_known_roles() cascade;
drop function if exists public.wf_migrate(p_inst uuid, p_definition uuid, p_note text) cascade;
drop function if exists public.wf_reassign(p_run uuid, p_user uuid, p_note text) cascade;
drop function if exists public.wf_retry_due(p_limit integer) cascade;
drop function if exists public.wf_rule(r jsonb, ctx jsonb) cascade;
drop function if exists public.wf_rule_error(r jsonb, depth integer) cascade;
drop function if exists public.wf_sla_tick() cascade;
drop function if exists public.wf_start(p_code text, p_record uuid, p_priority text) cascade;
drop function if exists public.wf_todo(p_type text, p_name text) cascade;
drop function if exists public.wf_validate(d jsonb) cascade;
drop function if exists public._ops_base(uuid) cascade;
drop function if exists public._ops_base(uuid, text[], boolean) cascade;
drop function if exists public._ops_items(uuid) cascade;
drop function if exists public.ops_list(text, integer) cascade;
drop function if exists public.ops_deadlines(integer) cascade;

-- the v21 reading rule (no per-record rule for requests and payment requests)

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
  end if;
  return true;
end $$;

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
  if r.section in ('company.announcements', 'company.documents', 'company.wiki', 'company.decisions') then return coalesce(public.extra_visible(me, r), false); end if;
  return true;
end $$;

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
  if r.section in ('company.announcements', 'company.documents', 'company.wiki', 'company.decisions') then return coalesce(public.extra_visible(p_user, r), false); end if;
  return true;
end $$;

revoke execute on function public.extra_visible(uuid, public.records) from public, anon, authenticated;
revoke execute on function public.record_visible(public.records) from anon;
revoke execute on function public.record_visible_for(uuid, public.records) from public, anon, authenticated;

-- the v19 task rule (without the process-step exception)

create or replace function public.record_rules()
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
       and old.created_by is distinct from me and coalesce(od->>'assignee_id', '') <> me::text then
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

-- access: the new sections and the procurement role leave the map; their records stay
delete from public.section_access where section in ('operations.requests', 'operations.quotations', 'operations.receipts', 'finance.payments', 'legal.contract_obligations',
  'company.issues', 'company.travel', 'company.requests', 'company.parties');
delete from public.section_access where role = 'procurement';

-- process actions in the Phase 1 queue would find no engine: they stop, visibly, until v23 is applied again
update public.automation_queue set status = 'failed', last_error = 'Workflow engine rolled back (v23); requeue after applying v23 again', next_attempt_at = null, updated_at = now()
where agent = 'workflow' and status in ('pending', 'processing', 'retrying');

notify pgrst, 'reload schema';

commit;
