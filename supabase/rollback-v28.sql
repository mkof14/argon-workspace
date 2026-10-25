-- AGRON Workspace — rollback of v28 to v27. One transaction; safe to run twice.
-- Removes the 1inow personal state (pins, snoozes, context, detected commitments, counters, flags) and returns the
-- policy model to v1: every policy that the v28 model changed and nobody approved since gets back its earlier tiers
-- (from the policy history), as a new Draft version — the history itself is kept.
begin;

-- 1. policy model back to v1 (only where the v2 model is still the unapproved current version)
do $$
declare p record; h record;
begin
  if to_regclass('public.approval_policies') is null or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'approval_policies' and column_name = 'model_version') then return; end if;
  for p in select * from public.approval_policies where model_version = 2 and config_status <> 'Approved' and ready_for_approval loop
    select * into h from public.approval_policies_history where policy_code = p.code and after->>'note' like 'policy model v2%' order by id desc limit 1;
    if found and h.before ? 'tiers' then
      insert into public.approval_policies_history(policy_code, changed_by, before, after, config_status, version)
        values (p.code, null, to_jsonb(p), jsonb_build_object('tiers', h.before->'tiers', 'note', 'rollback of policy model v2'), 'Draft', p.version + 1);
      update public.approval_policies set tiers = h.before->'tiers', version = version + 1, config_status = 'Draft', updated_at = now(), updated_by = null where code = p.code;
    end if;
  end loop;
end $$;

drop trigger if exists crm_caps_guard on public.crm_caps;
drop function if exists public.crm_caps_guard();

-- the v25 policy approval (without the edit/approve separation)
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

-- the v27 acceptance live state (it reads only columns that exist after this rollback)
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

alter table public.approval_policies drop column if exists self_approved;
alter table public.approval_policies drop column if exists model_version;
alter table public.approval_policies drop column if exists ready_for_approval;
alter table public.approval_policies drop column if exists currency;

-- 2. 1inow layer
drop function if exists public.inow_engines(integer, integer);
drop function if exists public.inow_detect_commitments(integer);
drop function if exists public.inow_touch(uuid);
drop function if exists public.inow_metric(text, integer);
drop function if exists public.inow_settings_save(jsonb, jsonb);
drop table if exists public.inow_metrics;
drop table if exists public.inow_commitments;
drop function if exists public.inow_commitments_guard();
drop table if exists public.inow_context;
drop table if exists public.inow_item_state;
drop table if exists public.inow_prefs;
drop table if exists public.inow_settings;

-- 3. acceptance scope P10 is removed from the catalog only where no evidence refers to it (evidence is append-only)
delete from public.acceptance_checks c where c.phase = 'P10-1INOW' and not exists (select 1 from public.acceptance_evidence e where e.check_id = c.id);
update public.acceptance_checks set params = jsonb_set(params, '{scope}', '["P1","P2","P3","P4","P5","P6","P7","P8","P9","P9-R2"]'::jsonb), name = 'Full clean regression (P1–P9 + R2)' where id = 'P9.REG.FULL';

create or replace function public.workspace_db_version() returns int
  language sql immutable security invoker set search_path = public
as $$ select 27 $$;
revoke all on function public.workspace_db_version() from public, anon;
grant execute on function public.workspace_db_version() to authenticated, service_role;


-- the stale-version error code back to 40001 (v27 behaviour)
do $$ declare f text; d text; begin
  foreach f in array array['public.crm_settings_save(jsonb, integer)', 'public.ops_settings_save(jsonb, integer)', 'public.mfg_settings_save(jsonb, integer)'] loop
    if to_regprocedure(f) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(f));
    if position('errcode = ''55000''' in d) > 0 then execute replace(d, 'errcode = ''55000''', 'errcode = ''40001'''); end if;
  end loop;
end $$;


-- the engineering-change facts back to the v24 set
do $$ declare d text; i int; j int;
begin
  d := pg_get_functiondef('public._wf_facts(uuid, public.records)'::regprocedure);
  i := position($o$'amount', public._num(r.data->'impact_cost'), 'currency', r.data->>'currency',$o$ in d);
  if i = 0 then return; end if;
  j := position($o$o.kind = 'unit' and coalesce(x.status, '') not in ('Planned', 'Delivered', 'Cancelled', 'Scrapped')));$o$ in d);
  d := left(d, i - 1) || $n$'amount', public._num(r.data->'impact_cost'));$n$ || substr(d, j + length($o$o.kind = 'unit' and coalesce(x.status, '') not in ('Planned', 'Delivered', 'Cancelled', 'Scrapped')));$o$));
  execute d;
end $$;

commit;
