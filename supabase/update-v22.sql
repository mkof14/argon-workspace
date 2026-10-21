-- AGRON Workspace — v22 (Phase 5: executive control, portfolio and project intelligence)
-- Builds on v18–v21. One transaction; safe to run again. Nothing is deleted.
--
-- Everything is computed from the existing records, approvals, comments, activity and profiles, for ONE viewer at a
-- time and only from what that viewer may open (the v21 reading rule): a record a person cannot open never changes a
-- number, a health reason, a report line, an alert or an Assistant answer that person sees.
-- New storage only where the information cannot live in an existing structure:
--   management_settings (+ history)   thresholds and weights, changed by owners / management, audited
--   management_snapshots              what one person saw at a management review (for "changed since")
--   management_alerts                 one open alert per condition and person (deduplicated, cooled down)
--   voice_inbox                       captured instructions and their parsed proposal
--   action_audit                      every Assistant / voice proposal, confirmation, result and undo
-- Portfolios are records (section company.portfolios): access, history, discussion and backup come with them.
begin;

/* ---------------------------------------------------------------------------------------------
   1. People: where they work and whether they are available (set by the person, never measured)
   --------------------------------------------------------------------------------------------- */
alter table public.profiles add column if not exists location text check (location is null or length(location) <= 120);
alter table public.profiles add column if not exists availability text check (availability is null or availability in ('available', 'busy', 'away', 'out_of_office', 'off'));
alter table public.profiles add column if not exists availability_note text check (availability_note is null or length(availability_note) <= 200);
alter table public.profiles add column if not exists availability_until timestamptz;

/* ---------------------------------------------------------------------------------------------
   2. Portfolios: readable by internal roles, written by management (as generated in access.sql)
   --------------------------------------------------------------------------------------------- */
insert into public.section_access(section, role, can_write, external)
select 'company.portfolios', r, r = 'management', false
from unnest(array['management', 'engineering', 'operations', 'finance', 'sales', 'marketing', 'hr', 'legal', 'security']) r
on conflict (section, role) do nothing;

-- lookups the engines make for every project
create index if not exists records_task_assignee_idx on public.records ((data->>'assignee_id')) where section = 'company.tasks';
create index if not exists records_project_portfolio_idx on public.records ((data->>'portfolio_ref')) where section = 'company.projects';
create index if not exists records_task_blocked_by_idx on public.records ((data->>'blocked_by')) where section = 'company.tasks' and data ? 'blocked_by';
create index if not exists approvals_pending_created_idx on public.approvals (created_at) where status = 'pending';
create index if not exists activity_record_idx on public.activity (record_id, created_at desc);
create index if not exists activity_mgmt_idx on public.activity (record_id, created_at desc) where action in ('mgmt_escalated', 'mgmt_reminded');
create index if not exists activity_created_idx on public.activity (created_at desc);

/* ---------------------------------------------------------------------------------------------
   3. Settings: safe defaults in the code of the database, changes stored and audited
   --------------------------------------------------------------------------------------------- */
create table if not exists public.management_settings (
  id boolean primary key default true check (id),
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.management_settings_history (
  id bigserial primary key,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  before jsonb, after jsonb not null
);
alter table public.management_settings enable row level security;
alter table public.management_settings_history enable row level security;
drop policy if exists p_mgmt_settings_read on public.management_settings;
create policy p_mgmt_settings_read on public.management_settings for select to authenticated using ((select public.is_active_employee(auth.uid())));
drop policy if exists p_mgmt_settings_history_read on public.management_settings_history;
create policy p_mgmt_settings_history_read on public.management_settings_history for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and not p.disabled and p.role in ('owner', 'admin', 'management')));
drop policy if exists p_session_mgmt_settings on public.management_settings;
create policy p_session_mgmt_settings on public.management_settings as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));
revoke insert, update, delete on public.management_settings, public.management_settings_history from anon, authenticated;

-- defaults; a stored value replaces the default of the same key (nested groups merged one level deep)
create or replace function public.mgmt_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'stale_days', 14,               -- project without activity
    'task_stale_days', 10,          -- open task unchanged
    'approval_age_days', 3,         -- approval waiting too long
    'decision_age_days', 7,         -- decision pending / in review too long
    'review_age_days', 5,           -- document or task waiting for review too long
    'deadline_warn_days', 7,        -- project deadline approaching
    'milestone_warn_days', 7,       -- next milestone approaching
    'horizon_days', 30,             -- deadline report horizon
    'expiry_warn_days', 30,         -- document expiry / periodic review approaching
    'insufficient_progress_pct', 80,-- approaching deadline with less than this done
    'overdue_share_pct', 30,        -- "excessive overdue": this share of open tasks overdue
    'alert_cooldown_hours', 24,     -- a resolved alert does not come back sooner
    'approval_sla_days', 5,         -- executive alert: approval exceeds
    'decision_sla_days', 10,        -- executive alert: decision exceeds
    'health', jsonb_build_object('attention', 80, 'risk', 60, 'critical', 35),   -- score >= 80 healthy, >= 60 attention, >= 35 risk
    'weights', jsonb_build_object(
      'no_owner', 25, 'overdue_base', 10, 'overdue_each', 5, 'overdue_cap', 25,
      'blocked_base', 15, 'blocked_each', 5, 'blocked_cap', 15, 'overdue_share', 10, 'critical_task', 10,
      'milestone_overdue', 20, 'milestone_soon', 8, 'milestone_no_owner', 4,
      'deadline_passed', 30, 'deadline_soon', 12, 'stale_per_day', 1, 'stale_cap', 20,
      'no_open_tasks', 8, 'unassigned_each', 3, 'unassigned_cap', 9,
      'approval_old_each', 6, 'approval_old_cap', 18, 'decision_old_each', 6, 'decision_old_cap', 12,
      'doc_review_each', 4, 'doc_review_cap', 8, 'on_hold', 10),
    'attention', jsonb_build_object('threshold', 30, 'max_items', 7),
    'priority_weight', jsonb_build_object('Critical', 40, 'High', 25, 'Normal', 12, 'Low', 5),
    'severity_weight', jsonb_build_object('critical', 60, 'high', 40, 'medium', 20, 'low', 8))
$$;
create or replace function public.mgmt_config() returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select public.mgmt_defaults() d), s as (select coalesce((select config from public.management_settings where id), '{}'::jsonb) s)
  select d.d || s.s || jsonb_build_object(
    'health', (d.d->'health') || coalesce(s.s->'health', '{}'), 'weights', (d.d->'weights') || coalesce(s.s->'weights', '{}'),
    'attention', (d.d->'attention') || coalesce(s.s->'attention', '{}'), 'priority_weight', (d.d->'priority_weight') || coalesce(s.s->'priority_weight', '{}'),
    'severity_weight', (d.d->'severity_weight') || coalesce(s.s->'severity_weight', '{}'))
  from d, s
$$;
revoke execute on function public.mgmt_config() from public, anon;
grant execute on function public.mgmt_config() to authenticated, service_role;

-- only owners and management change company-wide logic; numbers only, within sane ranges; every change kept
create or replace function public.mgmt_settings_save(p_config jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); old jsonb; k text; v jsonb; g text; clean jsonb := '{}'::jsonb; sub jsonb; d jsonb := public.mgmt_defaults();
begin
  if me is null or not public.session_ok() or not exists (select 1 from public.profiles where id = me and not disabled and role in ('owner', 'management')) then
    raise exception 'Only owners and management can change management settings' using errcode = '42501';
  end if;
  if jsonb_typeof(p_config) <> 'object' then raise exception 'Settings must be an object'; end if;
  for k, v in select * from jsonb_each(p_config) loop
    if k in ('health', 'weights', 'attention', 'priority_weight', 'severity_weight') then
      if jsonb_typeof(v) <> 'object' then raise exception 'Setting % must be a group', k; end if;
      sub := '{}'::jsonb;
      for g in select jsonb_object_keys(v) loop
        if not (d->k ? g) then raise exception 'Unknown setting %.%', k, g; end if;
        if jsonb_typeof(v->g) <> 'number' or (v->>g)::numeric < 0 or (v->>g)::numeric > 1000 then raise exception 'Setting %.% must be a number from 0 to 1000', k, g; end if;
        sub := sub || jsonb_build_object(g, (v->>g)::numeric);
      end loop;
      clean := clean || jsonb_build_object(k, sub);
    else
      if not (d ? k) then raise exception 'Unknown setting %', k; end if;
      if jsonb_typeof(v) <> 'number' or v::text::numeric < 0 or v::text::numeric > 3650 then raise exception 'Setting % must be a number from 0 to 3650', k; end if;
      clean := clean || jsonb_build_object(k, v::text::numeric);
    end if;
  end loop;
  if (coalesce(clean->'health', d->'health') ? 'attention') then
    if ((d->'health') || coalesce(clean->'health', '{}'))->>'attention' is not null
       and not ((((d->'health') || coalesce(clean->'health', '{}'))->>'attention')::numeric > (((d->'health') || coalesce(clean->'health', '{}'))->>'risk')::numeric
            and (((d->'health') || coalesce(clean->'health', '{}'))->>'risk')::numeric > (((d->'health') || coalesce(clean->'health', '{}'))->>'critical')::numeric) then
      raise exception 'Health thresholds must go down: attention > risk > critical';
    end if;
  end if;
  select config into old from public.management_settings where id;
  insert into public.management_settings(id, config, updated_by, updated_at) values (true, clean, me, now())
    on conflict (id) do update set config = excluded.config, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.management_settings_history(changed_by, before, after) values (me, old, clean);
  return public.mgmt_config();
end $$;
revoke execute on function public.mgmt_settings_save(jsonb) from public, anon;
grant execute on function public.mgmt_settings_save(jsonb) to authenticated;

/* ---------------------------------------------------------------------------------------------
   4. Meaningful changes are recorded as they happen (owner, deadline, portfolio): the activity log kept status
      changes only; Change Intelligence needs who-was-responsible and when-it-was-due as well
   --------------------------------------------------------------------------------------------- */
create or replace function public.records_mgmt_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare f text; a text; o text; n text;
begin
  if new.section not in ('company.projects', 'company.milestones', 'company.tasks', 'company.decisions', 'company.portfolios') then return null; end if;
  foreach f in array array['manager_id', 'owner_id', 'assignee_id', 'responsible_id', 'target', 'due', 'reconsider', 'portfolio_ref', 'priority'] loop
    o := old.data->>f; n := new.data->>f;
    if o is distinct from n then
      a := case when f in ('manager_id', 'owner_id', 'assignee_id', 'responsible_id') then 'owner_changed' when f = 'portfolio_ref' then 'portfolio_changed' when f = 'priority' then 'priority_changed' else 'deadline_changed' end;
      insert into public.activity(record_id, section, actor, action, detail)
      values (new.id, new.section, auth.uid(), a, jsonb_build_object('title', new.title, 'field', f, 'from', o, 'to', n));
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.records_mgmt_changes() from public, anon, authenticated;
drop trigger if exists records_mgmt_changes on public.records;
create trigger records_mgmt_changes after update on public.records for each row
  when (old.data is distinct from new.data) execute function public.records_mgmt_changes();

/* ---------------------------------------------------------------------------------------------
   5. What one person may open, for the management engines. The SAME rule as record_visible (v21) written out
      for the seven sections the engines read, with the person resolved once; checked against the row-level
      security in the tests (identical sets for every role). Externals, pending and disabled accounts: nothing.
   --------------------------------------------------------------------------------------------- */
create or replace function public.mgmt_visible(p_viewer uuid) returns setof public.records
language plpgsql stable security definer set search_path = public as $$
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
revoke execute on function public.mgmt_visible(uuid) from public, anon, authenticated;

-- the caller, if an active internal person with a valid session (every public function starts here)
create or replace function public.mgmt_viewer() returns uuid
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and public.session_ok() and public.is_active_employee(auth.uid()) then auth.uid() end
$$;
revoke execute on function public.mgmt_viewer() from public, anon, authenticated;

create or replace function public.mgmt_date(t text) returns date language sql immutable parallel safe set search_path = '' as $$
  select case when t ~ '^\d{4}-\d{2}-\d{2}' then left(t, 10)::date end
$$;

/* ---------------------------------------------------------------------------------------------
   6. Project Health Engine — deterministic, 0–100, every point lost has a reason that names its records.
      Progress = completed tasks / tasks not cancelled; without tasks: milestones reached / milestones; else none.
   --------------------------------------------------------------------------------------------- */
create or replace function public._project_health(p_viewer uuid, p_project uuid default null)
returns table (project_id uuid, title text, status text, portfolio_id uuid, manager_id uuid, priority text, target date,
  score integer, level text, reasons jsonb, progress integer, progress_basis text, tasks_total integer, tasks_open integer, tasks_done integer,
  overdue integer, blocked integer, unassigned integer, next_milestone jsonb, pending_approvals integer, pending_decisions integer,
  docs_in_review integer, last_activity timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb := public.mgmt_config(); w jsonb; h jsonb; today date := (now() at time zone 'utc')::date;
begin
  w := c->'weights'; h := c->'health';
  return query
  with v as materialized (select * from public.mgmt_visible(p_viewer)),
  pr as (select * from v where v.section = 'company.projects' and (p_project is null or v.id = p_project)),
  t0 as (select v.id, v.title, v.status, v.data, v.updated_at, public.as_uuid(v.data->>'project_ref') pid,
           v.status is distinct from 'Completed' and v.status is distinct from 'Cancelled' is_open, public.mgmt_date(v.data->>'due') due
         from v where v.section = 'company.tasks' and public.as_uuid(v.data->>'project_ref') in (select pr.id from pr)),
  -- blocked: marked Blocked, or waiting for another open task the viewer can see (a hidden blocker never counts)
  ot as (select v.id from v where v.section = 'company.tasks' and v.status is distinct from 'Completed' and v.status is distinct from 'Cancelled'),
  t as (select t0.*, (t0.is_open and (t0.status = 'Blocked' or ot.id is not null)) blocked from t0 left join ot on ot.id = public.as_uuid(t0.data->>'blocked_by')),
  ta as (select t.pid, count(*) filter (where t.status is distinct from 'Cancelled') total, count(*) filter (where not t.is_open and t.status = 'Completed') done,
           count(*) filter (where t.is_open) open, count(*) filter (where t.is_open and t.due < today) overdue,
           coalesce(jsonb_agg(t.id) filter (where t.is_open and t.due < today), '[]') overdue_ids,
           count(*) filter (where t.blocked) blocked, coalesce(jsonb_agg(t.id) filter (where t.blocked), '[]') blocked_ids,
           count(*) filter (where t.is_open and coalesce(t.data->>'assignee_id', '') = '') unassigned, coalesce(jsonb_agg(t.id) filter (where t.is_open and coalesce(t.data->>'assignee_id', '') = ''), '[]') unassigned_ids,
           count(*) filter (where t.is_open and t.data->>'priority' = 'Critical' and (t.blocked or t.due < today)) critical, coalesce(jsonb_agg(t.id) filter (where t.is_open and t.data->>'priority' = 'Critical' and (t.blocked or t.due < today)), '[]') critical_ids,
           max(t.updated_at) last from t group by t.pid),
  m as (select v.id, v.title, v.status, v.data, v.updated_at, public.as_uuid(v.data->>'project_ref') pid, public.mgmt_date(v.data->>'due') due,
          v.status is distinct from 'Reached' and v.status is distinct from 'Missed' is_open
        from v where v.section = 'company.milestones' and public.as_uuid(v.data->>'project_ref') in (select pr.id from pr)),
  ma as (select m.pid, count(*) total, count(*) filter (where m.status = 'Reached') reached,
           count(*) filter (where (m.is_open and m.due < today) or m.status = 'Missed') late, coalesce(jsonb_agg(m.id) filter (where (m.is_open and m.due < today) or m.status = 'Missed'), '[]') late_ids,
           count(*) filter (where m.is_open and coalesce(m.data->>'owner_id', '') = '') no_owner, coalesce(jsonb_agg(m.id) filter (where m.is_open and coalesce(m.data->>'owner_id', '') = ''), '[]') no_owner_ids,
           max(m.updated_at) last from m group by m.pid),
  mn as (select distinct on (m.pid) m.pid, m.id, m.title, m.due, m.data->>'owner_id' owner_id from m where m.is_open and m.due >= today order by m.pid, m.due, m.id),
  -- approvals waiting on records of the project (the project itself, its tasks, documents, milestones) that the viewer may open
  ap as (select coalesce(public.as_uuid(rv.data->>'project_ref'), case when rv.section = 'company.projects' then rv.id end) pid, a.id, a.record_id, a.created_at
         from public.approvals a join v rv on rv.id = a.record_id where a.status = 'pending'),
  apa as (select ap.pid, count(*) total, count(*) filter (where ap.created_at < now() - make_interval(days => (c->>'approval_age_days')::int)) old,
            coalesce(jsonb_agg(distinct ap.record_id) filter (where ap.created_at < now() - make_interval(days => (c->>'approval_age_days')::int)), '[]') old_ids,
            max(extract(day from now() - ap.created_at))::int max_age from ap group by ap.pid),
  de as (select public.as_uuid(v.data->>'project_ref') pid, count(*) total,
           count(*) filter (where coalesce(public.mgmt_date(v.data->>'date'), v.created_at::date) < today - (c->>'decision_age_days')::int) old,
           coalesce(jsonb_agg(v.id) filter (where coalesce(public.mgmt_date(v.data->>'date'), v.created_at::date) < today - (c->>'decision_age_days')::int), '[]') old_ids
         from v where v.section = 'company.decisions' and v.status in ('Proposed', 'In review') group by 1),
  dr as (select public.as_uuid(v.data->>'project_ref') pid, count(*) total, coalesce(jsonb_agg(v.id), '[]') ids
         from v where v.section = 'company.documents' and v.status = 'In review' group by 1),
  cm as (select c2.record_id pid, max(c2.created_at) last from public.comments c2 where c2.record_id in (select pr.id from pr) and c2.deleted_at is null group by 1),
  base as (
    select pr.*, coalesce(ta.total, 0) t_total, coalesce(ta.done, 0) t_done, coalesce(ta.open, 0) t_open, coalesce(ta.overdue, 0) t_overdue, coalesce(ta.overdue_ids, '[]') overdue_ids,
      coalesce(ta.blocked, 0) t_blocked, coalesce(ta.blocked_ids, '[]') blocked_ids, coalesce(ta.unassigned, 0) t_unassigned, coalesce(ta.unassigned_ids, '[]') unassigned_ids,
      coalesce(ta.critical, 0) t_critical, coalesce(ta.critical_ids, '[]') critical_ids,
      coalesce(ma.total, 0) m_total, coalesce(ma.reached, 0) m_reached, coalesce(ma.late, 0) m_late, coalesce(ma.late_ids, '[]') m_late_ids,
      coalesce(ma.no_owner, 0) m_no_owner, coalesce(ma.no_owner_ids, '[]') m_no_owner_ids,
      mn.id mn_id, mn.title mn_title, mn.due mn_due, mn.owner_id mn_owner,
      coalesce(apa.total, 0) ap_total, coalesce(apa.old, 0) ap_old, coalesce(apa.old_ids, '[]') ap_old_ids, coalesce(apa.max_age, 0) ap_max_age,
      coalesce(de.total, 0) d_total, coalesce(de.old, 0) d_old, coalesce(de.old_ids, '[]') d_old_ids,
      coalesce(dr.total, 0) dr_total, coalesce(dr.ids, '[]') dr_ids,
      greatest(pr.updated_at, ta.last, ma.last, cm.last) last_act, public.mgmt_date(pr.data->>'target') tgt,
      pr.status is distinct from 'Completed' and pr.status is distinct from 'Cancelled' p_open
    from pr left join ta on ta.pid = pr.id left join ma on ma.pid = pr.id left join mn on mn.pid = pr.id
      left join apa on apa.pid = pr.id left join de on de.pid = pr.id left join dr on dr.pid = pr.id left join cm on cm.pid = pr.id),
  sig as (  -- one row per signal that fires: code, penalty, how many, the records behind it
    select b.id pid, s.code, s.pen, s.n, s.refs, s.extra from base b cross join lateral (values
      ('no_owner', case when b.p_open and coalesce(b.data->>'manager_id', '') = '' then (w->>'no_owner')::int end, 1, jsonb_build_array(b.id), null::jsonb),
      ('overdue_tasks', case when b.p_open and b.t_overdue > 0 then (w->>'overdue_base')::int + least((w->>'overdue_cap')::int, b.t_overdue * (w->>'overdue_each')::int) end, b.t_overdue, b.overdue_ids, null),
      ('blocked_tasks', case when b.p_open and b.t_blocked > 0 then (w->>'blocked_base')::int + least((w->>'blocked_cap')::int, b.t_blocked * (w->>'blocked_each')::int) end, b.t_blocked, b.blocked_ids, null),
      ('overdue_share', case when b.p_open and b.t_open > 0 and b.t_overdue * 100 >= b.t_open * (c->>'overdue_share_pct')::int and b.t_overdue > 1 then (w->>'overdue_share')::int end,
         case when b.t_open > 0 then (b.t_overdue * 100 / b.t_open) end, b.overdue_ids, jsonb_build_object('open', b.t_open)),
      ('critical_tasks', case when b.p_open and b.t_critical > 0 then (w->>'critical_task')::int end, b.t_critical, b.critical_ids, null),
      ('milestone_overdue', case when b.p_open and b.m_late > 0 then (w->>'milestone_overdue')::int end, b.m_late, b.m_late_ids, null),
      ('milestone_soon', case when b.p_open and b.mn_due is not null and b.mn_due - today <= (c->>'milestone_warn_days')::int then (w->>'milestone_soon')::int end,
         b.mn_due - today, jsonb_build_array(b.mn_id), jsonb_build_object('title', b.mn_title, 'due', b.mn_due)),
      ('milestone_no_owner', case when b.p_open and b.m_no_owner > 0 then (w->>'milestone_no_owner')::int end, b.m_no_owner, b.m_no_owner_ids, null),
      ('deadline_passed', case when b.p_open and b.tgt < today then (w->>'deadline_passed')::int end, today - b.tgt, jsonb_build_array(b.id), jsonb_build_object('target', b.tgt)),
      ('deadline_soon', case when b.p_open and b.tgt >= today and b.tgt - today <= (c->>'deadline_warn_days')::int then (w->>'deadline_soon')::int end, b.tgt - today, jsonb_build_array(b.id), jsonb_build_object('target', b.tgt)),
      ('stale', case when b.p_open and b.status = 'Active' and b.last_act < now() - make_interval(days => (c->>'stale_days')::int)
         then least((w->>'stale_cap')::int, greatest(1, (extract(day from now() - b.last_act)::int - (c->>'stale_days')::int) * (w->>'stale_per_day')::int)) end,
         extract(day from now() - b.last_act)::int, jsonb_build_array(b.id), null),
      ('no_open_tasks', case when b.status = 'Active' and b.t_open = 0 then (w->>'no_open_tasks')::int end, 0, jsonb_build_array(b.id), null),
      ('unassigned_tasks', case when b.p_open and b.t_unassigned > 0 then least((w->>'unassigned_cap')::int, b.t_unassigned * (w->>'unassigned_each')::int) end, b.t_unassigned, b.unassigned_ids, null),
      ('approvals_waiting', case when b.p_open and b.ap_old > 0 then least((w->>'approval_old_cap')::int, b.ap_old * (w->>'approval_old_each')::int) end, b.ap_old, b.ap_old_ids, jsonb_build_object('days', (c->>'approval_age_days')::int, 'max', b.ap_max_age)),
      ('decisions_waiting', case when b.p_open and b.d_old > 0 then least((w->>'decision_old_cap')::int, b.d_old * (w->>'decision_old_each')::int) end, b.d_old, b.d_old_ids, jsonb_build_object('days', (c->>'decision_age_days')::int)),
      ('documents_in_review', case when b.p_open and b.dr_total > 0 then least((w->>'doc_review_cap')::int, b.dr_total * (w->>'doc_review_each')::int) end, b.dr_total, b.dr_ids, null),
      ('on_hold', case when b.status = 'On hold' then (w->>'on_hold')::int end, 0, jsonb_build_array(b.id), null)
    ) s(code, pen, n, refs, extra) where s.pen is not null and s.pen > 0),
  sc as (select b.id pid, greatest(0, 100 - coalesce(sum(sig.pen), 0))::int score,
           coalesce(jsonb_agg(jsonb_build_object('code', sig.code, 'penalty', sig.pen, 'n', sig.n, 'refs', sig.refs) || coalesce(sig.extra, '{}'::jsonb) order by sig.pen desc, sig.code) filter (where sig.code is not null), '[]') reasons
         from base b left join sig on sig.pid = b.id group by b.id)
  select b.id, b.title, b.status, public.as_uuid(b.data->>'portfolio_ref'), public.as_uuid(b.data->>'manager_id'), b.data->>'priority', b.tgt,
    case when b.p_open then sc.score end,
    case when not b.p_open then 'closed' when sc.score >= (h->>'attention')::int then 'healthy' when sc.score >= (h->>'risk')::int then 'attention' when sc.score >= (h->>'critical')::int then 'risk' else 'critical' end,
    sc.reasons,
    case when b.t_total > 0 then (b.t_done * 100 / b.t_total)::int when b.m_total > 0 then (b.m_reached * 100 / b.m_total)::int end,
    case when b.t_total > 0 then 'tasks' when b.m_total > 0 then 'milestones' else 'none' end,
    b.t_total::int, b.t_open::int, b.t_done::int, b.t_overdue::int, b.t_blocked::int, b.t_unassigned::int,
    case when b.mn_id is not null then jsonb_build_object('id', b.mn_id, 'title', b.mn_title, 'due', b.mn_due, 'owner_id', b.mn_owner) end,
    b.ap_total::int, b.d_total::int, b.dr_total::int, b.last_act
  from base b join sc on sc.pid = b.id
  order by case when not b.p_open then 1 else 0 end, sc.score, b.title, b.id;
end $$;
revoke execute on function public._project_health(uuid, uuid) from public, anon, authenticated;

create or replace function public.project_health(p_project uuid default null)
returns table (project_id uuid, title text, status text, portfolio_id uuid, manager_id uuid, priority text, target date,
  score integer, level text, reasons jsonb, progress integer, progress_basis text, tasks_total integer, tasks_open integer, tasks_done integer,
  overdue integer, blocked integer, unassigned integer, next_milestone jsonb, pending_approvals integer, pending_decisions integer,
  docs_in_review integer, last_activity timestamptz)
language sql stable security definer set search_path = public as $$
  select * from public._project_health(public.mgmt_viewer(), p_project) where public.mgmt_viewer() is not null
$$;
revoke execute on function public.project_health(uuid) from public, anon;
grant execute on function public.project_health(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   7. Links to the record behind every item
   --------------------------------------------------------------------------------------------- */
create or replace function public.mgmt_link(p_section text, p_id uuid) returns text language sql immutable set search_path = '' as $$
  select case p_section when 'company.projects' then '/projects/' || p_id when 'company.documents' then '/documents?d=' || p_id
    when 'company.portfolios' then '/portfolio?p=' || p_id else '/' || replace(p_section, '.', '/') || '?r=' || p_id end
$$;

/* ---------------------------------------------------------------------------------------------
   8. Open Loops — unfinished work found from the records themselves, computed on request (nothing is copied or
      stored, so a scan can never duplicate one). key = kind + record: the same loop has the same key every time.
      "since" is when the condition began (the due date that passed, the request, the last change).
   --------------------------------------------------------------------------------------------- */
create or replace function public._open_loops(p_viewer uuid, p_project uuid default null)
returns table (loop_key text, kind text, category text, severity text, record_id uuid, section text, title text, project_id uuid, project_title text,
  owner_id uuid, since timestamptz, age_days integer, reason jsonb, next_action text, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb := public.mgmt_config(); today date := (now() at time zone 'utc')::date;
begin
  return query
  with v as materialized (select * from public.mgmt_visible(p_viewer)),
  pr as (select v.id, v.title, v.status, v.data from v where v.section = 'company.projects'),
  t0 as (select v.*, public.as_uuid(v.data->>'project_ref') pid, public.mgmt_date(v.data->>'due') due
        from v where v.section = 'company.tasks' and v.status is distinct from 'Completed' and v.status is distinct from 'Cancelled'),
  t as (select t0.*, (t0.status = 'Blocked' or b.id is not null) blocked from t0 left join t0 b on b.id = public.as_uuid(t0.data->>'blocked_by')),
  h0 as (select * from public._project_health(p_viewer) hh where hh.level <> 'closed'),
  tb as (select t.pid, min(t.updated_at) first_blocked from t where t.blocked group by t.pid),
  om as (select distinct public.as_uuid(m.data->>'project_ref') pid from v m where m.section = 'company.milestones' and m.status in ('Planned', 'In progress')),
  na as (select distinct t.pid from t where coalesce(t.data->>'assignee_id', '') <> '' and t.due is not null),
  h as (select h0.*, pc.created_at p_created, tb.first_blocked, (om.pid is not null) has_ms, (na.pid is not null) has_next
        from h0 join v pc on pc.id = h0.project_id left join tb on tb.pid = h0.project_id left join om on om.pid = h0.project_id left join na on na.pid = h0.project_id),
  loops as (
    -- tasks
    select 'task_no_owner' kind, 'task' cat, case when t.data->>'priority' in ('High', 'Critical') then 'high' else 'medium' end sev, t.id rid, t.section sec, t.title ttl, t.pid,
      t.created_by own, t.created_at since, jsonb_build_object('code', 'task_no_owner') rsn, 'assign_owner' nxt
      from t where coalesce(t.data->>'assignee_id', '') = ''
    union all select 'task_no_due', 'task', 'low', t.id, t.section, t.title, t.pid, public.as_uuid(t.data->>'assignee_id'), t.created_at, jsonb_build_object('code', 'task_no_due'), 'set_due_date'
      from t where coalesce(t.data->>'assignee_id', '') <> '' and t.due is null
    union all select 'task_overdue', 'task',
        case when t.data->>'priority' = 'Critical' and today - t.due > 7 then 'critical' when t.data->>'priority' in ('High', 'Critical') or today - t.due > 7 then 'high' else 'medium' end,
        t.id, t.section, t.title, t.pid, public.as_uuid(t.data->>'assignee_id'), t.due::timestamptz, jsonb_build_object('code', 'task_overdue', 'days', today - t.due, 'due', t.due), 'follow_up'
      from t where t.due < today
    union all select 'task_blocked', 'task', case when t.data->>'priority' = 'Critical' then 'critical' else 'high' end, t.id, t.section, t.title, t.pid,
        public.as_uuid(t.data->>'assignee_id'), t.updated_at, jsonb_build_object('code', 'task_blocked', 'blocker', t.data->>'blocker', 'blocked_by', t.data->>'blocked_by'), 'resolve_blocker'
      from t where t.blocked
    union all select 'task_review', 'task', case when t.updated_at < now() - make_interval(days => (c->>'review_age_days')::int) then 'medium' else 'low' end, t.id, t.section, t.title, t.pid,
        coalesce(public.as_uuid(t.data->>'requested_by'), t.created_by), t.updated_at, jsonb_build_object('code', 'task_review'), 'review'
      from t where t.status = 'Review'
    union all select 'task_stale', 'task', 'low', t.id, t.section, t.title, t.pid, public.as_uuid(t.data->>'assignee_id'), t.updated_at,
        jsonb_build_object('code', 'task_stale', 'days', extract(day from now() - t.updated_at)::int), 'update_status'
      from t where t.updated_at < now() - make_interval(days => (c->>'task_stale_days')::int) and not t.blocked and (t.due is null or t.due >= today) and t.status <> 'Review'
    -- projects (from the health engine, so the same facts as the score)
    union all select 'project_no_owner', 'project', 'high', h.project_id, 'company.projects', h.title, h.project_id, null::uuid, h.p_created,
        jsonb_build_object('code', 'project_no_owner'), 'assign_owner' from h where h.manager_id is null
    union all select 'project_no_milestone', 'project', 'low', h.project_id, 'company.projects', h.title, h.project_id, h.manager_id, h.p_created,
        jsonb_build_object('code', 'project_no_milestone'), 'plan_milestone' from h where h.status = 'Active' and not h.has_ms
    union all select 'project_stale', 'project', 'medium', h.project_id, 'company.projects', h.title, h.project_id, h.manager_id, h.last_activity,
        jsonb_build_object('code', 'project_stale', 'days', extract(day from now() - h.last_activity)::int), 'update_project'
      from h where h.status = 'Active' and h.last_activity < now() - make_interval(days => (c->>'stale_days')::int)
    union all select 'project_deadline_passed', 'project', case when today - h.target > 14 then 'critical' else 'high' end, h.project_id, 'company.projects', h.title, h.project_id, h.manager_id,
        h.target::timestamptz, jsonb_build_object('code', 'project_deadline_passed', 'days', today - h.target, 'target', h.target), 'replan_deadline' from h where h.target < today
    union all select 'project_deadline_risk', 'project', 'high', h.project_id, 'company.projects', h.title, h.project_id, h.manager_id, (h.target - (c->>'deadline_warn_days')::int)::timestamptz,
        jsonb_build_object('code', 'project_deadline_risk', 'days', h.target - today, 'progress', h.progress, 'target', h.target), 'review_readiness'
      from h where h.target >= today and h.target - today <= (c->>'deadline_warn_days')::int and coalesce(h.progress, 0) < (c->>'insufficient_progress_pct')::int
    union all select 'project_blocked', 'project', case when h.blocked > 2 then 'high' else 'medium' end, h.project_id, 'company.projects', h.title, h.project_id, h.manager_id,
        h.first_blocked, jsonb_build_object('code', 'project_blocked', 'n', h.blocked), 'resolve_blocker' from h where h.blocked > 0
    union all select 'project_no_next_action', 'project', 'medium', h.project_id, 'company.projects', h.title, h.project_id, h.manager_id, h.last_activity,
        jsonb_build_object('code', 'project_no_next_action'), 'define_next_action' from h where h.status = 'Active' and not h.has_next
    -- decisions
    union all select 'decision_pending', 'decision',
        case when coalesce(public.mgmt_date(d.data->>'date'), d.created_at::date) < today - (c->>'decision_age_days')::int then 'high' else 'medium' end,
        d.id, d.section, d.title, public.as_uuid(d.data->>'project_ref'), coalesce(public.as_uuid(d.data->>'responsible_id'), public.as_uuid(d.data->>'made_by_id'), d.created_by),
        coalesce(public.mgmt_date(d.data->>'date')::timestamptz, d.created_at), jsonb_build_object('code', 'decision_pending'), 'decide'
      from v d where d.section = 'company.decisions' and d.status = 'Proposed'
    union all select 'decision_review_long', 'decision', 'high', d.id, d.section, d.title, public.as_uuid(d.data->>'project_ref'),
        coalesce(public.as_uuid(d.data->>'responsible_id'), d.created_by), d.updated_at, jsonb_build_object('code', 'decision_review_long', 'days', extract(day from now() - d.updated_at)::int), 'finish_review'
      from v d where d.section = 'company.decisions' and d.status = 'In review' and d.updated_at < now() - make_interval(days => (c->>'decision_age_days')::int)
    union all select 'decision_deferred_due', 'decision', 'medium', d.id, d.section, d.title, public.as_uuid(d.data->>'project_ref'),
        coalesce(public.as_uuid(d.data->>'responsible_id'), d.created_by), public.mgmt_date(d.data->>'reconsider')::timestamptz, jsonb_build_object('code', 'decision_deferred_due', 'reconsider', d.data->>'reconsider'), 'revisit'
      from v d where d.section = 'company.decisions' and d.status = 'Deferred' and public.mgmt_date(d.data->>'reconsider') <= today
    -- approvals on records the viewer may open
    union all select 'approval_waiting', 'approval', case when a.created_at < now() - make_interval(days => 2 * (c->>'approval_age_days')::int) then 'high' else 'medium' end,
        a.record_id, rv.section, rv.title, coalesce(public.as_uuid(rv.data->>'project_ref'), case when rv.section = 'company.projects' then rv.id end), a.approver_id, a.created_at,
        jsonb_build_object('code', 'approval_waiting', 'days', extract(day from now() - a.created_at)::int, 'approval', a.id), 'review_approval'
      from public.approvals a join v rv on rv.id = a.record_id where a.status = 'pending' and a.created_at < now() - make_interval(days => (c->>'approval_age_days')::int)
    union all select 'approval_approver_inactive', 'approval', 'high', a.record_id, rv.section, rv.title, coalesce(public.as_uuid(rv.data->>'project_ref'), case when rv.section = 'company.projects' then rv.id end),
        a.requested_by, a.created_at, jsonb_build_object('code', 'approval_approver_inactive', 'approval', a.id, 'approver', a.approver_id), 'reassign_approver'
      from public.approvals a join v rv on rv.id = a.record_id where a.status = 'pending' and not public.is_active_employee(a.approver_id)
    union all select distinct on (a.chain_id) 'approval_chain_blocked', 'approval', 'high', a.record_id, rv.section, rv.title, coalesce(public.as_uuid(rv.data->>'project_ref'), case when rv.section = 'company.projects' then rv.id end),
        a.approver_id, a.created_at, jsonb_build_object('code', 'approval_chain_blocked', 'step', a.step, 'waiting', (select count(*) from public.approvals q where q.chain_id = a.chain_id and q.status = 'queued')), 'review_approval'
      from public.approvals a join v rv on rv.id = a.record_id
      where a.status = 'pending' and a.chain_id is not null and a.created_at < now() - make_interval(days => (c->>'approval_age_days')::int)
        and exists (select 1 from public.approvals q where q.chain_id = a.chain_id and q.status = 'queued')
    -- documents
    union all select 'document_review', 'document', case when public.mgmt_date(d.data->>'review_due') < today or d.updated_at < now() - make_interval(days => (c->>'review_age_days')::int) then 'medium' else 'low' end,
        d.id, d.section, d.title, public.as_uuid(d.data->>'project_ref'), public.as_uuid(d.data->>'reviewer_id'), d.updated_at, jsonb_build_object('code', 'document_review', 'review_due', d.data->>'review_due'), 'review_document'
      from v d where d.section = 'company.documents' and d.status = 'In review'
    union all select 'document_approval', 'document', 'low', d.id, d.section, d.title, public.as_uuid(d.data->>'project_ref'), a.approver_id, a.created_at,
        jsonb_build_object('code', 'document_approval', 'approval', a.id), 'complete_approval'
      from public.approvals a join v d on d.id = a.record_id
      where d.section = 'company.documents' and a.status = 'pending' and a.created_at >= now() - make_interval(days => (c->>'approval_age_days')::int)
    union all select 'document_expiring', 'document', case when coalesce(public.mgmt_date(d.data->>'expiration_date'), public.mgmt_date(d.data->>'review_date')) < today then 'high' else 'medium' end,
        d.id, d.section, d.title, public.as_uuid(d.data->>'project_ref'), public.as_uuid(d.data->>'owner_id'),
        least(public.mgmt_date(d.data->>'expiration_date'), public.mgmt_date(d.data->>'review_date'))::timestamptz,
        jsonb_build_object('code', 'document_expiring', 'expires', d.data->>'expiration_date', 'review', d.data->>'review_date'), 'renew_document'
      from v d where d.section = 'company.documents' and d.status in ('Approved', 'Effective')
        and (public.mgmt_date(d.data->>'expiration_date') <= today + (c->>'expiry_warn_days')::int or public.mgmt_date(d.data->>'review_date') <= today)
    -- meetings that ended with loose ends
    union all select 'meeting_decision_no_followup', 'meeting', 'medium', mt.id, mt.section, mt.title, public.as_uuid(mt.data->>'project_ref'),
        coalesce(public.as_uuid(mt.data->>'organizer_id'), mt.created_by), public.mgmt_date(mt.data->>'date')::timestamptz, jsonb_build_object('code', 'meeting_decision_no_followup'), 'log_decisions'
      from v mt where mt.section = 'company.meetings' and mt.status is distinct from 'Cancelled' and public.mgmt_date(mt.data->>'date') < today
        and length(trim(coalesce(mt.data->>'decisions', ''))) > 0
        and not exists (select 1 from v dd where dd.section = 'company.decisions' and dd.data->>'source_ref' = mt.id::text)
    union all select 'meeting_action_no_task', 'meeting', 'medium', mt.id, mt.section, mt.title || ' — ' || coalesce(it->>'title', ''), public.as_uuid(mt.data->>'project_ref'),
        coalesce(public.as_uuid(it->>'assignee_id'), public.as_uuid(mt.data->>'organizer_id'), mt.created_by), public.mgmt_date(mt.data->>'date')::timestamptz,
        jsonb_build_object('code', 'meeting_action_no_task', 'item', it->>'id'), 'create_task'
      from v mt cross join lateral jsonb_array_elements(case when jsonb_typeof(mt.data->'action_items') = 'array' then mt.data->'action_items' else '[]'::jsonb end) it
      where mt.section = 'company.meetings' and mt.status is distinct from 'Cancelled' and public.mgmt_date(mt.data->>'date') < today and coalesce(it->>'task_id', '') = ''
    union all select 'meeting_task_no_owner', 'meeting', 'medium', t.id, t.section, t.title, t.pid, t.created_by, t.created_at,
        jsonb_build_object('code', 'meeting_task_no_owner', 'meeting', t.data->>'meeting_ref'), 'assign_owner'
      from t where coalesce(t.data->>'meeting_ref', '') <> '' and coalesce(t.data->>'assignee_id', '') = ''
  )
  select l.kind || ':' || l.rid || case when l.kind = 'meeting_action_no_task' then ':' || (l.rsn->>'item') when l.kind in ('approval_waiting', 'approval_approver_inactive', 'document_approval') then ':' || (l.rsn->>'approval') else '' end,
    l.kind, l.cat, l.sev, l.rid, l.sec, l.ttl, l.pid, pr.title, l.own, l.since, greatest(0, extract(day from now() - l.since))::int, l.rsn, l.nxt, public.mgmt_link(l.sec, l.rid)
  from loops l left join pr on pr.id = l.pid
  where p_project is null or l.pid = p_project
  order by case l.sev when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, l.since nulls last, 1;
end $$;
revoke execute on function public._open_loops(uuid, uuid) from public, anon, authenticated;

create or replace function public.open_loops(p_project uuid default null)
returns table (loop_key text, kind text, category text, severity text, record_id uuid, section text, title text, project_id uuid, project_title text,
  owner_id uuid, since timestamptz, age_days integer, reason jsonb, next_action text, link text)
language sql stable security definer set search_path = public as $$
  select * from public._open_loops(public.mgmt_viewer(), p_project) where public.mgmt_viewer() is not null
$$;
revoke execute on function public.open_loops(uuid) from public, anon;
grant execute on function public.open_loops(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   9. Waiting For — what is owed, by whom, to whom. Every item is a real task, approval, decision or review.
      me: others wait for me · others: I wait for a colleague · team: people in departments / projects I lead owe
      it · external: a supplier, partner, client, contractor or authority (task in Waiting with that party)
   --------------------------------------------------------------------------------------------- */
create or replace function public._waiting_for(p_viewer uuid)
returns table (item_key text, bucket text, kind text, record_id uuid, section text, title text, project_id uuid, project_title text,
  party_type text, party_id uuid, party_name text, requested_at timestamptz, due date, age_days integer, state text, last_activity timestamptz,
  escalation text, link text, approval_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb := public.mgmt_config(); today date := (now() at time zone 'utc')::date; me uuid := p_viewer;
begin
  return query
  with v as materialized (select * from public.mgmt_visible(p_viewer)),
  pr as (select v.id, v.title, v.data from v where v.section = 'company.projects'),
  esc as (select x.record_id, max(x.created_at) at from public.activity x where x.action = 'mgmt_escalated' and x.created_at > now() - interval '90 days' group by x.record_id),
  team as (select p.id from public.profiles p join public.departments d on d.id = p.department_id where d.manager_id = me and p.id <> me and not p.disabled
           union select public.as_uuid(x) from pr, jsonb_array_elements_text(coalesce(pr.data->'members_ids', '[]')) x where pr.data->>'manager_id' = me::text),
  t as (select v.*, public.as_uuid(v.data->>'project_ref') pid, public.mgmt_date(v.data->>'due') due, public.as_uuid(v.data->>'assignee_id') asg,
          coalesce(public.as_uuid(v.data->>'requested_by'), v.created_by) req
        from v where v.section = 'company.tasks' and v.status is distinct from 'Completed' and v.status is distinct from 'Cancelled'),
  items as (
    -- someone waits for me
    select 'me' b, 'task' k, t.id rid, t.section sec, t.title ttl, t.pid, 'person' pt, t.req party, null::text pname, t.created_at req_at, t.due, t.status st, t.updated_at last_act,
      null::text esc, null::uuid aid from t where t.asg = me and t.req is distinct from me
    union all select 'me', 'approval', a.record_id, rv.section, rv.title, coalesce(public.as_uuid(rv.data->>'project_ref'), case when rv.section = 'company.projects' then rv.id end),
      'person', a.requested_by, null, a.created_at, null::date, 'pending', a.created_at, null, a.id
      from public.approvals a join v rv on rv.id = a.record_id where a.status = 'pending' and a.approver_id = me
    union all select 'me', 'review', d.id, d.section, d.title, public.as_uuid(d.data->>'project_ref'), 'person', coalesce(public.as_uuid(d.data->>'owner_id'), d.created_by), null,
      d.updated_at, public.mgmt_date(d.data->>'review_due'), d.status, d.updated_at, null, null
      from v d where d.section = 'company.documents' and d.status = 'In review' and d.data->>'reviewer_id' = me::text
    union all select 'me', 'decision', d.id, d.section, d.title, public.as_uuid(d.data->>'project_ref'), 'person', d.created_by, null, d.created_at, public.mgmt_date(d.data->>'due'), d.status, d.updated_at, null, null
      from v d where d.section = 'company.decisions' and d.status in ('Proposed', 'In review') and d.data->>'responsible_id' = me::text and d.created_by is distinct from me
    -- I wait for a colleague
    union all select 'others', 'task', t.id, t.section, t.title, t.pid, 'person', t.asg, null, t.created_at, t.due, t.status, t.updated_at, null, null
      from t where t.req = me and t.asg is not null and t.asg <> me and not (t.status = 'Waiting' and coalesce(t.data->>'waiting_kind', 'Colleague') <> 'Colleague')
    union all select 'others', 'approval', a.record_id, rv.section, rv.title, coalesce(public.as_uuid(rv.data->>'project_ref'), case when rv.section = 'company.projects' then rv.id end),
      'person', a.approver_id, null, a.created_at, null, 'pending', a.created_at, null, a.id
      from public.approvals a join v rv on rv.id = a.record_id where a.status = 'pending' and a.requested_by = me and a.approver_id <> me
    union all select 'others', 'review', d.id, d.section, d.title, public.as_uuid(d.data->>'project_ref'), 'person', public.as_uuid(d.data->>'reviewer_id'), null, d.updated_at,
      public.mgmt_date(d.data->>'review_due'), d.status, d.updated_at, null, null
      from v d where d.section = 'company.documents' and d.status = 'In review' and (d.data->>'owner_id' = me::text or d.created_by = me) and coalesce(d.data->>'reviewer_id', '') not in ('', me::text)
    -- my team owes it (late, blocked or due within two days)
    union all select 'team', 'task', t.id, t.section, t.title, t.pid, 'person', t.asg, null, t.created_at, t.due, t.status, t.updated_at, null, null
      from t where t.asg in (select team.id from team) and t.req is distinct from t.asg and t.req is distinct from me
        and (t.due <= today + 2 or t.status in ('Blocked', 'Waiting'))
    -- an outside party
    union all select 'external', 'task', t.id, t.section, t.title, t.pid, 'external', null, coalesce(nullif(t.data->>'waiting_on', ''), t.data->>'waiting_kind'), t.updated_at, t.due, t.status, t.updated_at,
      null, null
      from t where t.status = 'Waiting' and coalesce(t.data->>'waiting_kind', 'Colleague') <> 'Colleague'
        and (t.asg = me or t.req = me or t.created_by = me or exists (select 1 from pr where pr.id = t.pid and pr.data->>'manager_id' = me::text)
             or exists (select 1 from public.profiles q where q.id = me and q.role in ('owner', 'admin', 'management')))
  )
  select i.b || ':' || i.k || ':' || i.rid || coalesce(':' || i.aid, ''), i.b, i.k, i.rid, i.sec, i.ttl, i.pid, pr.title, i.pt, i.party,
    coalesce(i.pname, (select coalesce(nullif(q.full_name, ''), q.email) from public.profiles q where q.id = i.party)),
    i.req_at, i.due, greatest(0, extract(day from now() - i.req_at))::int, i.st, i.last_act,
    case when e.at is not null then 'escalated' when i.due < today then 'overdue' when i.due <= today + 2 then 'due_soon'
         when i.req_at < now() - make_interval(days => (c->>'approval_age_days')::int) then 'aging' else 'none' end,
    public.mgmt_link(i.sec, i.rid), i.aid
  from items i left join pr on pr.id = i.pid left join esc e on e.record_id = i.rid and e.at >= i.req_at
  order by case i.b when 'me' then 0 when 'team' then 1 when 'others' then 2 else 3 end,
    case when e.at is not null then 0 when i.due < today then 1 when i.due <= today + 2 then 2 else 3 end, i.due nulls last, i.req_at, 1;
end $$;
revoke execute on function public._waiting_for(uuid) from public, anon, authenticated;
create or replace function public.waiting_for()
returns table (item_key text, bucket text, kind text, record_id uuid, section text, title text, project_id uuid, project_title text,
  party_type text, party_id uuid, party_name text, requested_at timestamptz, due date, age_days integer, state text, last_activity timestamptz,
  escalation text, link text, approval_id uuid)
language sql stable security definer set search_path = public as $$
  select * from public._waiting_for(public.mgmt_viewer()) where public.mgmt_viewer() is not null
$$;
revoke execute on function public.waiting_for() from public, anon;
grant execute on function public.waiting_for() to authenticated;

/* ---------------------------------------------------------------------------------------------
   10. Management Attention — one deterministic score per item with the reasons it is made of. Candidates: the
       open loops, projects at risk or critical, approvals and decisions that need this person. Ties: older first,
       then the key, so the same data always gives the same order.
   --------------------------------------------------------------------------------------------- */
create or replace function public._attention(p_viewer uuid, p_limit integer default 50)
returns table (item_key text, kind text, record_id uuid, section text, title text, project_id uuid, project_title text, owner_id uuid,
  severity text, attention_score integer, why jsonb, next_action text, link text, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb := public.mgmt_config(); sw jsonb; pw jsonb; today date := (now() at time zone 'utc')::date; lead boolean;
begin
  sw := c->'severity_weight'; pw := c->'priority_weight';
  select p.role in ('owner', 'admin', 'management') into lead from public.profiles p where p.id = p_viewer;
  return query
  with h as materialized (select * from public._project_health(p_viewer) hh where hh.level <> 'closed'),
  l as materialized (select * from public._open_loops(p_viewer)),
  v as materialized (select * from public.mgmt_visible(p_viewer) where section = 'company.tasks'),
  cand as (
    select l.loop_key k, l.kind kd, l.record_id rid, l.section sec, l.title ttl, l.project_id pid, l.project_title ptitle, l.owner_id own, l.severity sev, l.reason rsn,
      l.next_action nxt, l.link lnk, l.since sn, l.age_days age
    from l where l.kind not in ('project_blocked', 'project_no_next_action', 'project_no_milestone', 'project_stale', 'task_stale', 'task_no_due', 'document_approval')
    union all
    select 'project_health:' || h.project_id, 'project_health', h.project_id, 'company.projects', h.title, h.project_id, h.title, h.manager_id,
      case h.level when 'critical' then 'critical' else 'high' end, jsonb_build_object('code', 'project_' || h.level, 'score', h.score, 'reasons', h.reasons),
      case when h.manager_id is null then 'assign_owner' when h.blocked > 0 then 'resolve_blocker' when h.next_milestone is not null then 'review_milestone' else 'review_project' end,
      public.mgmt_link('company.projects', h.project_id), h.last_activity, 0
    from h where h.level in ('risk', 'critical')
  ),
  bc as (select b.data->>'blocked_by' bid, count(*) n from v b where coalesce(b.data->>'blocked_by', '') <> '' and b.status is distinct from 'Completed' and b.status is distinct from 'Cancelled' group by 1),
  scored as (
    select cand.*, hp.level plevel, hp.priority ppri, coalesce(hp.overdue, 0) p_overdue, coalesce(hp.blocked, 0) p_blocked,
      public.mgmt_date(coalesce(cand.rsn->>'due', cand.rsn->>'target', tk.data->>'due', case when cand.kd = 'project_health' then hp.next_milestone->>'due' end)) due,
      coalesce(bc.n, 0) downstream, tk.data->>'priority' tpri, coalesce(tk.data->>'blocked_by', '') <> '' dep
    from cand left join h hp on hp.project_id = cand.pid left join v tk on tk.id = cand.rid left join bc on bc.bid = cand.rid::text),
  parts as (
    select s.*, x.code, x.pts, x.n from scored s cross join lateral (values
      ('severity', (sw->>s.sev)::int, null::int),
      ('deadline', case when s.due is null then null when s.due < today then least(30, 10 + (today - s.due) * 2) when s.due - today <= 3 then 15 when s.due - today <= 7 then 8 end, s.due - today),
      ('priority', case when coalesce(s.tpri, s.ppri) = 'Critical' then 20 when coalesce(s.tpri, s.ppri) = 'High' then 12 end, null),
      ('downstream', case when s.downstream > 0 then least(20, s.downstream * 5) end, s.downstream::int),
      ('affected', case when s.kd = 'project_health' and s.p_overdue + s.p_blocked > 0 then least(20, (s.p_overdue + s.p_blocked) * 2) end, (s.p_overdue + s.p_blocked)),
      ('executive', case when s.kd in ('decision_pending', 'decision_review_long', 'decision_deferred_due') and lead then 15
                         when s.kd in ('approval_waiting', 'approval_chain_blocked') and s.own = p_viewer then 15 end, null),
      ('aging', case when s.age > 0 then least(20, s.age) end, s.age),
      ('critical_project', case when s.plevel = 'critical' then 15 when s.plevel = 'risk' then 8 end, null),
      ('dependency', case when s.dep and s.kd = 'task_blocked' then 10 end, null)
    ) x(code, pts, n) where x.pts is not null and x.pts > 0)
  select p.k, p.kd, p.rid, p.sec, p.ttl, p.pid, p.ptitle, p.own, p.sev, sum(p.pts)::int,
    jsonb_build_object('reason', (array_agg(p.rsn))[1], 'parts', jsonb_agg(jsonb_build_object('code', p.code, 'points', p.pts, 'n', p.n) order by p.pts desc, p.code), 'project_level', (array_agg(p.plevel))[1]),
    (array_agg(p.nxt))[1], (array_agg(p.lnk))[1], (array_agg(p.sn))[1]
  from parts p
  group by p.k, p.kd, p.rid, p.sec, p.ttl, p.pid, p.ptitle, p.own, p.sev
  having sum(p.pts) >= (c->'attention'->>'threshold')::int
  order by 10 desc, (array_agg(p.sn))[1] nulls last, 1
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
end $$;
revoke execute on function public._attention(uuid, integer) from public, anon, authenticated;
create or replace function public.attention_items(p_limit integer default 50)
returns table (item_key text, kind text, record_id uuid, section text, title text, project_id uuid, project_title text, owner_id uuid,
  severity text, attention_score integer, why jsonb, next_action text, link text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select * from public._attention(public.mgmt_viewer(), p_limit) where public.mgmt_viewer() is not null
$$;
revoke execute on function public.attention_items(integer) from public, anon;
grant execute on function public.attention_items(integer) to authenticated;

/* ---------------------------------------------------------------------------------------------
   11. Portfolio — portfolios the viewer may open, each with its projects the viewer may open (and a group of the
       projects without a portfolio). Progress = completed tasks / tasks across those projects; level = the worst
       open project. Hidden projects are not counted anywhere.
   --------------------------------------------------------------------------------------------- */
create or replace function public._portfolio(p_viewer uuid)
returns table (portfolio_id uuid, name text, description text, owner_id uuid, status text, priority text, start date, target date,
  level text, progress integer, project_count integer, open_projects integer, levels jsonb, overdue integer, blocked integer,
  pending_decisions integer, pending_approvals integer, next_milestone jsonb, risks jsonb, projects jsonb, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with h as materialized (select * from public._project_health(p_viewer)),
  pf as (select v.* from public.mgmt_visible(p_viewer) v where v.section = 'company.portfolios'),
  grp as (select coalesce(case when h.portfolio_id in (select pf.id from pf) then h.portfolio_id end, '00000000-0000-0000-0000-000000000000'::uuid) gid, h.* from h),
  agg as (select g.gid, count(*) n, count(*) filter (where g.level <> 'closed') n_open,
      jsonb_build_object('healthy', count(*) filter (where g.level = 'healthy'), 'attention', count(*) filter (where g.level = 'attention'),
        'risk', count(*) filter (where g.level = 'risk'), 'critical', count(*) filter (where g.level = 'critical'), 'closed', count(*) filter (where g.level = 'closed')) lv,
      case when count(*) filter (where g.level = 'critical') > 0 then 'critical' when count(*) filter (where g.level = 'risk') > 0 then 'risk'
           when count(*) filter (where g.level = 'attention') > 0 then 'attention' when count(*) filter (where g.level = 'healthy') > 0 then 'healthy' else 'closed' end lvl,
      case when sum(g.tasks_total) > 0 then (sum(g.tasks_done) * 100 / sum(g.tasks_total))::int end prog,
      sum(g.overdue)::int ov, sum(g.blocked)::int bl, sum(g.pending_decisions)::int pd, sum(g.pending_approvals)::int pa,
      (array_agg(g.next_milestone || jsonb_build_object('project_id', g.project_id, 'project', g.title) order by g.next_milestone->>'due') filter (where g.next_milestone is not null))[1] nm,
      coalesce(jsonb_agg(jsonb_build_object('project_id', g.project_id, 'project', g.title, 'level', g.level, 'reason', g.reasons->0) order by g.score) filter (where g.level in ('risk', 'critical')), '[]') rk,
      jsonb_agg(jsonb_build_object('id', g.project_id, 'title', g.title, 'status', g.status, 'level', g.level, 'score', g.score, 'progress', g.progress, 'progress_basis', g.progress_basis,
        'manager_id', g.manager_id, 'target', g.target, 'overdue', g.overdue, 'blocked', g.blocked, 'next_milestone', g.next_milestone, 'reasons', g.reasons,
        'pending_decisions', g.pending_decisions, 'pending_approvals', g.pending_approvals) order by g.score nulls last, g.title) pj
    from grp g group by g.gid)
  select case when a.gid = '00000000-0000-0000-0000-000000000000' then null else a.gid end, coalesce(pf.title, null), pf.data->>'description',
    public.as_uuid(pf.data->>'owner_id'), pf.status, pf.data->>'priority', public.mgmt_date(pf.data->>'start'), public.mgmt_date(pf.data->>'target'),
    a.lvl, a.prog, a.n::int, a.n_open::int, a.lv, a.ov, a.bl, a.pd, a.pa, a.nm, a.rk, a.pj,
    case when pf.id is not null then public.mgmt_link('company.portfolios', pf.id) end
  from agg a left join pf on pf.id = a.gid
  union all  -- portfolios with no project the viewer can see are shown empty (their own record is visible to the viewer)
  select pf.id, pf.title, pf.data->>'description', public.as_uuid(pf.data->>'owner_id'), pf.status, pf.data->>'priority', public.mgmt_date(pf.data->>'start'), public.mgmt_date(pf.data->>'target'),
    'closed', null, 0, 0, '{"healthy":0,"attention":0,"risk":0,"critical":0,"closed":0}'::jsonb, 0, 0, 0, 0, null, '[]'::jsonb, '[]'::jsonb, public.mgmt_link('company.portfolios', pf.id)
  from pf where not exists (select 1 from agg a where a.gid = pf.id)
  order by 1 nulls last, 2;
end $$;
revoke execute on function public._portfolio(uuid) from public, anon, authenticated;
create or replace function public.portfolio_overview()
returns table (portfolio_id uuid, name text, description text, owner_id uuid, status text, priority text, start date, target date,
  level text, progress integer, project_count integer, open_projects integer, levels jsonb, overdue integer, blocked integer,
  pending_decisions integer, pending_approvals integer, next_milestone jsonb, risks jsonb, projects jsonb, link text)
language sql stable security definer set search_path = public as $$
  select * from public._portfolio(public.mgmt_viewer()) where public.mgmt_viewer() is not null
$$;
revoke execute on function public.portfolio_overview() from public, anon;
grant execute on function public.portfolio_overview() to authenticated;

/* ---------------------------------------------------------------------------------------------
   12. Deadlines — tasks, milestones, project targets, decision due dates, document expiry / review, within a
       horizon (and everything already overdue)
   --------------------------------------------------------------------------------------------- */
create or replace function public._deadlines(p_viewer uuid, p_days integer default 30)
returns table (kind text, record_id uuid, section text, title text, project_id uuid, project_title text, owner_id uuid, due date, days integer, status text, priority text, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare today date := (now() at time zone 'utc')::date;
begin
  return query
  with v as materialized (select * from public.mgmt_visible(p_viewer)),
  pr as (select v.id, v.title from v where v.section = 'company.projects'),
  d as (
    select 'task' k, v.id, v.section, v.title, public.as_uuid(v.data->>'project_ref') pid, public.as_uuid(v.data->>'assignee_id') own, public.mgmt_date(v.data->>'due') dd, v.status, v.data->>'priority' pri
      from v where v.section = 'company.tasks' and v.status not in ('Completed', 'Cancelled')
    union all select 'milestone', v.id, v.section, v.title, public.as_uuid(v.data->>'project_ref'), public.as_uuid(v.data->>'owner_id'), public.mgmt_date(v.data->>'due'), v.status, null
      from v where v.section = 'company.milestones' and v.status not in ('Reached', 'Missed')
    union all select 'project', v.id, v.section, v.title, v.id, public.as_uuid(v.data->>'manager_id'), public.mgmt_date(v.data->>'target'), v.status, v.data->>'priority'
      from v where v.section = 'company.projects' and v.status not in ('Completed', 'Cancelled')
    union all select 'decision', v.id, v.section, v.title, public.as_uuid(v.data->>'project_ref'), public.as_uuid(v.data->>'responsible_id'), coalesce(public.mgmt_date(v.data->>'due'), public.mgmt_date(v.data->>'reconsider')), v.status, null
      from v where v.section = 'company.decisions' and v.status in ('Proposed', 'In review', 'Deferred')
    union all select 'document', v.id, v.section, v.title, public.as_uuid(v.data->>'project_ref'), public.as_uuid(v.data->>'owner_id'),
      least(public.mgmt_date(v.data->>'expiration_date'), public.mgmt_date(v.data->>'review_due'), public.mgmt_date(v.data->>'review_date')), v.status, null
      from v where v.section = 'company.documents' and v.status not in ('Superseded', 'Archived'))
  select d.k, d.id, d.section, d.title, d.pid, pr.title, d.own, d.dd, d.dd - today, d.status, d.pri, public.mgmt_link(d.section, d.id)
  from d left join pr on pr.id = d.pid
  where d.dd is not null and d.dd <= today + least(greatest(coalesce(p_days, 30), 0), 366)
  order by d.dd, d.k, d.title, d.id;
end $$;
revoke execute on function public._deadlines(uuid, integer) from public, anon, authenticated;
create or replace function public.mgmt_deadlines(p_days integer default 30)
returns table (kind text, record_id uuid, section text, title text, project_id uuid, project_title text, owner_id uuid, due date, days integer, status text, priority text, link text)
language sql stable security definer set search_path = public as $$
  select * from public._deadlines(public.mgmt_viewer(), p_days) where public.mgmt_viewer() is not null
$$;
revoke execute on function public.mgmt_deadlines(integer) from public, anon;
grant execute on function public.mgmt_deadlines(integer) to authenticated;

/* ---------------------------------------------------------------------------------------------
   13. Snapshots: what one person saw (project levels and scores), kept for "changed since". A daily one at most
       once a day; a review one each time a management review is started.
   --------------------------------------------------------------------------------------------- */
create table if not exists public.management_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('daily', 'review')),
  title text check (title is null or length(title) <= 200),
  taken_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists management_snapshots_user_idx on public.management_snapshots (user_id, kind, taken_at desc);
alter table public.management_snapshots enable row level security;
drop policy if exists p_mgmt_snapshots_own on public.management_snapshots;
create policy p_mgmt_snapshots_own on public.management_snapshots for select to authenticated using (user_id = auth.uid());
drop policy if exists p_session_mgmt_snapshots on public.management_snapshots;
create policy p_session_mgmt_snapshots on public.management_snapshots as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));
revoke insert, update, delete on public.management_snapshots from anon, authenticated;

create or replace function public._mgmt_snapshot(p_viewer uuid, p_kind text, p_title text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; d jsonb;
begin
  if p_viewer is null or p_kind not in ('daily', 'review') then return null; end if;
  if p_kind = 'daily' then
    select id into sid from public.management_snapshots where user_id = p_viewer and kind = 'daily' and taken_at::date = (now() at time zone 'utc')::date limit 1;
    if sid is not null then return sid; end if;
  end if;
  select jsonb_build_object('projects', coalesce(jsonb_object_agg(h.project_id, jsonb_build_object('level', h.level, 'score', h.score, 'status', h.status,
      'manager_id', h.manager_id, 'target', h.target, 'progress', h.progress, 'title', h.title)), '{}'::jsonb))
    into d from public._project_health(p_viewer) h;
  insert into public.management_snapshots(user_id, kind, title, data) values (p_viewer, p_kind, left(p_title, 200), d) returning id into sid;
  return sid;
end $$;
revoke execute on function public._mgmt_snapshot(uuid, text, text) from public, anon, authenticated;
create or replace function public.mgmt_snapshot(p_kind text, p_title text default null) returns uuid
language sql security definer set search_path = public as $$ select public._mgmt_snapshot(public.mgmt_viewer(), p_kind, p_title) $$;
revoke execute on function public.mgmt_snapshot(text, text) from public, anon;
grant execute on function public.mgmt_snapshot(text, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   14. Change Intelligence — meaningful changes only, each with the history row (or snapshot) it comes from.
       Window: since a moment (yesterday, 7 days) or since the person's last management review.
   --------------------------------------------------------------------------------------------- */
create or replace function public._changes(p_viewer uuid, p_since timestamptz, p_snapshot uuid default null)
returns table (change_key text, at timestamptz, kind text, project_id uuid, project_title text, record_id uuid, section text, title text, detail jsonb, link text, source text, source_id text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare today date := (now() at time zone 'utc')::date; snap jsonb;
begin
  if p_snapshot is not null then select s.data into snap from public.management_snapshots s where s.id = p_snapshot and s.user_id = p_viewer; end if;
  return query
  with v as materialized (select * from public.mgmt_visible(p_viewer)),
  pr as (select v.id, v.title from v where v.section = 'company.projects'),
  act as (select a.*, rv.title rtitle, rv.data rdata, rv.section rsec from public.activity a join v rv on rv.id = a.record_id where a.created_at >= p_since),
  ch as (
    select 'project_status' k, a.created_at at, rv_pid.pid, a.record_id rid, a.rsec sec, a.rtitle ttl, jsonb_build_object('from', a.detail->>'from', 'to', a.detail->>'to') det, 'activity' src, a.id::text sid
      from act a cross join lateral (select a.record_id pid) rv_pid where a.rsec = 'company.projects' and a.action = 'status'
    union all select 'milestone_completed', a.created_at, public.as_uuid(a.rdata->>'project_ref'), a.record_id, a.rsec, a.rtitle, jsonb_build_object('to', a.detail->>'to'), 'activity', a.id::text
      from act a where a.rsec = 'company.milestones' and a.action = 'status' and a.detail->>'to' = 'Reached'
    union all select 'milestone_delayed', a.created_at, public.as_uuid(a.rdata->>'project_ref'), a.record_id, a.rsec, a.rtitle,
        case when a.action = 'status' then jsonb_build_object('to', 'Missed') else jsonb_build_object('from', a.detail->>'from', 'to', a.detail->>'to') end, 'activity', a.id::text
      from act a where a.rsec = 'company.milestones' and ((a.action = 'status' and a.detail->>'to' = 'Missed')
        or (a.action = 'deadline_changed' and a.detail->>'field' = 'due' and coalesce(a.detail->>'from', '') <> '' and a.detail->>'to' > a.detail->>'from'))
    union all select 'blocker_new', a.created_at, public.as_uuid(a.rdata->>'project_ref'), a.record_id, a.rsec, a.rtitle,
        jsonb_build_object('priority', a.rdata->>'priority', 'critical', a.rdata->>'priority' in ('Critical', 'High'), 'blocker', a.rdata->>'blocker'), 'activity', a.id::text
      from act a where a.rsec = 'company.tasks' and a.action = 'status' and a.detail->>'to' = 'Blocked'
    union all select 'blocker_resolved', a.created_at, public.as_uuid(a.rdata->>'project_ref'), a.record_id, a.rsec, a.rtitle, jsonb_build_object('to', a.detail->>'to'), 'activity', a.id::text
      from act a where a.rsec = 'company.tasks' and a.action = 'status' and a.detail->>'from' = 'Blocked' and a.detail->>'to' is distinct from 'Blocked'
    union all select 'tasks_completed', max(a.created_at), public.as_uuid(a.rdata->>'project_ref'), public.as_uuid(a.rdata->>'project_ref'), 'company.projects',
        (array_agg(a.rtitle order by a.created_at desc))[1], jsonb_build_object('n', count(distinct a.record_id)), 'activity', min(a.id)::text || '-' || max(a.id)::text
      from act a where a.rsec = 'company.tasks' and a.action = 'status' and a.detail->>'to' = 'Completed' and coalesce(a.rdata->>'project_ref', '') <> ''
      group by public.as_uuid(a.rdata->>'project_ref')
    union all select 'decision_made', a.created_at, public.as_uuid(a.rdata->>'project_ref'), a.record_id, a.rsec, a.rtitle, jsonb_build_object('to', a.detail->>'to'), 'activity', a.id::text
      from act a where a.rsec = 'company.decisions' and a.action = 'status' and a.detail->>'to' in ('Approved', 'Rejected')
    union all select 'document_approved', a.created_at, public.as_uuid(a.rdata->>'project_ref'), a.record_id, a.rsec, a.rtitle,
        jsonb_build_object('to', coalesce(a.detail->>'to', 'Approved'), 'version', a.detail->>'version'), 'activity', a.id::text
      from act a where a.rsec = 'company.documents' and ((a.action = 'status' and a.detail->>'to' in ('Approved', 'Effective')) or a.action = 'version_approved')
    union all select 'deadline_changed', a.created_at, coalesce(public.as_uuid(a.rdata->>'project_ref'), case when a.rsec = 'company.projects' then a.record_id end), a.record_id, a.rsec, a.rtitle,
        jsonb_build_object('field', a.detail->>'field', 'from', a.detail->>'from', 'to', a.detail->>'to'), 'activity', a.id::text
      from act a where a.action = 'deadline_changed' and (a.rsec in ('company.projects', 'company.portfolios') or (a.rsec = 'company.tasks' and a.rdata->>'priority' in ('High', 'Critical')))
    union all select 'owner_changed', a.created_at, coalesce(public.as_uuid(a.rdata->>'project_ref'), case when a.rsec = 'company.projects' then a.record_id end), a.record_id, a.rsec, a.rtitle,
        jsonb_build_object('field', a.detail->>'field', 'from', a.detail->>'from', 'to', a.detail->>'to'), 'activity', a.id::text
      from act a where a.action = 'owner_changed' and (a.rsec in ('company.projects', 'company.milestones', 'company.portfolios') or (a.rsec = 'company.tasks' and a.rdata->>'priority' in ('High', 'Critical')))
    -- approvals decided in the window on records the viewer may open
    union all select 'approval_completed', ap.decided_at, coalesce(public.as_uuid(rv.data->>'project_ref'), case when rv.section = 'company.projects' then rv.id end), ap.record_id, rv.section, rv.title,
        jsonb_build_object('status', ap.status, 'by', ap.decided_by), 'approval', ap.id::text
      from public.approvals ap join v rv on rv.id = ap.record_id where ap.status in ('approved', 'rejected', 'changes_requested') and ap.decided_at >= p_since
    -- important work that became overdue in the window (no history row: the date itself is the source)
    union all select 'task_overdue', (public.mgmt_date(v.data->>'due') + 1)::timestamptz, public.as_uuid(v.data->>'project_ref'), v.id, v.section, v.title,
        jsonb_build_object('due', v.data->>'due', 'priority', v.data->>'priority'), 'due_date', v.id::text
      from v where v.section = 'company.tasks' and v.status not in ('Completed', 'Cancelled') and v.data->>'priority' in ('High', 'Critical')
        and public.mgmt_date(v.data->>'due') >= p_since::date and public.mgmt_date(v.data->>'due') < today
    union all select 'milestone_delayed', (public.mgmt_date(v.data->>'due') + 1)::timestamptz, public.as_uuid(v.data->>'project_ref'), v.id, v.section, v.title,
        jsonb_build_object('due', v.data->>'due', 'overdue', true), 'due_date', v.id::text
      from v where v.section = 'company.milestones' and v.status not in ('Reached', 'Missed')
        and public.mgmt_date(v.data->>'due') >= p_since::date and public.mgmt_date(v.data->>'due') < today
    -- health compared with the snapshot (only projects the viewer can still open)
    union all select 'health_changed', now(), h.project_id, h.project_id, 'company.projects', h.title,
        jsonb_build_object('from', snap->'projects'->h.project_id::text->>'level', 'to', h.level, 'score_from', (snap->'projects'->h.project_id::text->>'score')::int, 'score_to', h.score), 'snapshot', p_snapshot::text
      from public._project_health(p_viewer) h where snap is not null and snap->'projects' ? h.project_id::text
        and snap->'projects'->h.project_id::text->>'level' is distinct from h.level
  )
  select ch.k || ':' || ch.rid || ':' || ch.sid, ch.at, ch.k, ch.pid, pr.title, ch.rid, ch.sec, ch.ttl, ch.det, public.mgmt_link(ch.sec, ch.rid), ch.src, ch.sid
  from ch left join pr on pr.id = ch.pid
  order by ch.at desc, 1;
end $$;
revoke execute on function public._changes(uuid, timestamptz, uuid) from public, anon, authenticated;

-- p_window: 'day' | 'week' | 'review'. Health changes compare with the person's snapshot from that time.
create or replace function public.management_changes(p_window text default 'week')
returns table (change_key text, at timestamptz, kind text, project_id uuid, project_title text, record_id uuid, section text, title text, detail jsonb, link text, source text, source_id text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := public.mgmt_viewer(); since timestamptz; sid uuid;
begin
  if me is null then return; end if;
  if p_window = 'review' then
    select s.id, s.taken_at into sid, since from public.management_snapshots s where s.user_id = me and s.kind = 'review' order by s.taken_at desc limit 1;
    if sid is null then since := now() - interval '7 days'; end if;
  else
    since := now() - case when p_window = 'day' then interval '1 day' else interval '7 days' end;
    select s.id into sid from public.management_snapshots s where s.user_id = me and s.taken_at <= since + interval '4 hours' order by s.taken_at desc limit 1;
  end if;
  return query select * from public._changes(me, since, sid);
end $$;
revoke execute on function public.management_changes(text) from public, anon;
grant execute on function public.management_changes(text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   15. Team Status — who is where, their availability as they set it, and what they are responsible for among
       the projects and tasks the VIEWER may open. No scores of people, no presence tracking.
   --------------------------------------------------------------------------------------------- */
drop function if exists public.team_status();
drop function if exists public._team_status(uuid);
create or replace function public._team_status(p_viewer uuid)
returns table (person_id uuid, name text, title text, role text, department_id uuid, department text, location text, timezone text,
  availability text, availability_note text, availability_until timestamptz, projects jsonb, assignments jsonb, open_tasks integer, overdue_tasks integer, blocked_tasks integer, upcoming_14 integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare today date := (now() at time zone 'utc')::date;
begin
  if not public.is_active_employee(p_viewer) then return; end if;
  return query
  with v as materialized (select * from public.mgmt_visible(p_viewer)),
  pr as (select v.id, v.title, v.status, v.data from v where v.section = 'company.projects' and v.status not in ('Completed', 'Cancelled')),
  pm as (select public.as_uuid(pr.data->>'manager_id') pid, pr.id, pr.title, 'manager' r from pr where coalesce(pr.data->>'manager_id', '') <> ''
         union select public.as_uuid(x), pr.id, pr.title, 'member' from pr, jsonb_array_elements_text(coalesce(pr.data->'members_ids', '[]')) x where x <> coalesce(pr.data->>'manager_id', '')),
  t as (select v.id, v.title, v.status, public.as_uuid(v.data->>'assignee_id') asg, public.mgmt_date(v.data->>'due') due, v.data->>'priority' pri, v.data->>'project_ref_title' ptitle
        from v where v.section = 'company.tasks' and v.status not in ('Completed', 'Cancelled') and coalesce(v.data->>'assignee_id', '') <> ''),
  ta as (select t.asg, count(*) n, count(*) filter (where t.due < today) od, count(*) filter (where t.status = 'Blocked') bl, count(*) filter (where t.due between today and today + 14) up,
           jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due', t.due, 'status', t.status, 'priority', t.priority, 'project', t.ptitle)
             order by (t.due < today) desc, case t.pri when 'Critical' then 0 when 'High' then 1 else 2 end, t.due nulls last, t.title) items
         from (select t.*, t.pri priority from t) t group by t.asg)
  select p.id, coalesce(nullif(p.full_name, ''), p.email), p.title, p.role, p.department_id, d.name, p.location, p.timezone,
    case when p.availability_until is not null and p.availability_until < now() then null else p.availability end, p.availability_note,
    case when p.availability_until is not null and p.availability_until < now() then null else p.availability_until end,
    coalesce((select jsonb_agg(jsonb_build_object('id', pm.id, 'title', pm.title, 'as', pm.r) order by pm.r, pm.title) from pm where pm.pid = p.id), '[]'),
    coalesce((select jsonb_path_query_array(ta.items, '$[0 to 4]')), '[]'), coalesce(ta.n, 0)::int, coalesce(ta.od, 0)::int, coalesce(ta.bl, 0)::int, coalesce(ta.up, 0)::int
  from public.profiles p left join public.departments d on d.id = p.department_id left join ta on ta.asg = p.id
  where not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending')
  order by coalesce(nullif(p.full_name, ''), p.email);
end $$;
revoke execute on function public._team_status(uuid) from public, anon, authenticated;
create or replace function public.team_status()
returns table (person_id uuid, name text, title text, role text, department_id uuid, department text, location text, timezone text,
  availability text, availability_note text, availability_until timestamptz, projects jsonb, assignments jsonb, open_tasks integer, overdue_tasks integer, blocked_tasks integer, upcoming_14 integer)
language sql stable security definer set search_path = public as $$
  select * from public._team_status(public.mgmt_viewer()) where public.mgmt_viewer() is not null
$$;
revoke execute on function public.team_status() from public, anon;
grant execute on function public.team_status() to authenticated;

/* ---------------------------------------------------------------------------------------------
   16. Executive overview — the first screen: what needs attention, portfolio health, today, waiting for,
       decisions, deadlines, and the indicators (each with the list it counts, so every number can be opened)
   --------------------------------------------------------------------------------------------- */
create or replace function public.exec_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.mgmt_viewer(); c jsonb := public.mgmt_config(); today date := (now() at time zone 'utc')::date; res jsonb; lead boolean;
begin
  if me is null then return null; end if;
  select role in ('owner', 'admin', 'management') into lead from public.profiles where id = me;
  with h as materialized (select * from public._project_health(me)),
  l as materialized (select * from public._open_loops(me)),
  w as materialized (select * from public._waiting_for(me)),
  dl as materialized (select * from public._deadlines(me, 30)),
  at as materialized (select * from public._attention(me, 100))
  select jsonb_build_object(
    'generated_at', now(), 'today', today, 'lead', lead,
    'indicators', jsonb_build_object(
      'active_projects', (select count(*) from h where h.level <> 'closed'),
      'critical_projects', (select count(*) from h where h.level = 'critical'),
      'risk_projects', (select count(*) from h where h.level = 'risk'),
      'overdue_work', (select count(*) from l where l.kind = 'task_overdue'),
      'blocked_work', (select count(*) from l where l.kind = 'task_blocked'),
      'pending_decisions', (select count(*) from l where l.kind in ('decision_pending', 'decision_review_long', 'decision_deferred_due')),
      'pending_approvals', (select count(*) from w where w.kind = 'approval' and w.bucket = 'me'),
      'deadlines_7', (select count(*) from dl where dl.days between 0 and 7),
      'deadlines_30', (select count(*) from dl where dl.days between 0 and 30),
      'open_loops', (select count(*) from l)),
    'portfolio_health', jsonb_build_object('healthy', (select count(*) from h where h.level = 'healthy'), 'attention', (select count(*) from h where h.level = 'attention'),
      'risk', (select count(*) from h where h.level = 'risk'), 'critical', (select count(*) from h where h.level = 'critical')),
    'attention', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from at order by at.attention_score desc, at.since nulls last, at.item_key limit (c->'attention'->>'max_items')::int) x), '[]'),
    'attention_total', (select count(*) from at),
    'today', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select dl.kind, dl.record_id, dl.section, dl.title, dl.project_title, dl.due, dl.days, dl.status, dl.link from dl
        where dl.days <= 0 and (dl.owner_id = me or (lead and dl.kind in ('milestone', 'project', 'decision'))) order by dl.days, dl.title limit 10) x), '[]'),
    'waiting', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from w where w.bucket <> 'me' order by case w.escalation when 'escalated' then 0 when 'overdue' then 1 when 'due_soon' then 2 when 'aging' then 3 else 4 end, w.age_days desc, w.item_key limit 8) x), '[]'),
    'waiting_for_me', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from w where w.bucket = 'me' order by w.due nulls last, w.age_days desc, w.item_key limit 8) x), '[]'),
    'decisions', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from l where l.kind in ('decision_pending', 'decision_review_long', 'decision_deferred_due') order by l.since, l.loop_key limit 8) x), '[]'),
    'deadlines', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from dl where dl.days between 0 and 30 and dl.kind in ('milestone', 'project', 'decision', 'document') order by dl.due, dl.title limit 10) x), '[]'),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', h.project_id, 'title', h.title, 'level', h.level, 'score', h.score, 'reasons', h.reasons, 'progress', h.progress,
        'portfolio_id', h.portfolio_id, 'manager_id', h.manager_id, 'next_milestone', h.next_milestone, 'target', h.target) order by h.score nulls last, h.title) from h where h.level <> 'closed'), '[]'))
  into res;
  return res;
end $$;
revoke execute on function public.exec_overview() from public, anon;
grant execute on function public.exec_overview() to authenticated;

/* ---------------------------------------------------------------------------------------------
   17. Executive alerts — one row per condition and person. A new condition notifies once (the existing
       notification centre, kind mgmt_alert); while it stays true nothing more is sent; when it clears the alert is
       resolved; if it comes back within the cool-down it reopens quietly. Evaluated under each recipient's own
       visibility, so an alert never tells anyone about a record they cannot open.
   --------------------------------------------------------------------------------------------- */
create table if not exists public.management_alerts (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  key text not null,
  kind text not null check (kind in ('project_critical', 'milestone_overdue', 'critical_blocker', 'approval_sla', 'decision_sla', 'project_no_owner', 'critical_task_overdue')),
  record_id uuid references public.records(id) on delete cascade,
  project_id uuid,
  severity text not null default 'high',
  title text, detail jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  resolved_at timestamptz, notified_at timestamptz, times_opened integer not null default 1,
  unique (user_id, key)
);
create index if not exists management_alerts_open_idx on public.management_alerts (user_id) where resolved_at is null;
alter table public.management_alerts enable row level security;
drop policy if exists p_mgmt_alerts_own on public.management_alerts;
create policy p_mgmt_alerts_own on public.management_alerts for select to authenticated
  using (user_id = auth.uid() and (record_id is null or exists (select 1 from public.records r where r.id = record_id and public.record_visible(r))));
drop policy if exists p_session_mgmt_alerts on public.management_alerts;
create policy p_session_mgmt_alerts on public.management_alerts as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));
revoke insert, update, delete on public.management_alerts from anon, authenticated;

-- the conditions true now for one person (owners / management: everything they can open; a project manager: their projects)
create or replace function public._alert_conditions(p_viewer uuid)
returns table (key text, kind text, record_id uuid, project_id uuid, severity text, title text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb := public.mgmt_config(); today date := (now() at time zone 'utc')::date; lead boolean;
begin
  select p.role in ('owner', 'admin', 'management') into lead from public.profiles p where p.id = p_viewer and not p.disabled;
  if lead is null then return; end if;
  return query
  with h as materialized (select * from public._project_health(p_viewer) hh where hh.level <> 'closed' and (lead or hh.manager_id = p_viewer)),
  v as materialized (select * from public.mgmt_visible(p_viewer)),
  mine as (select h.project_id from h)
  select 'project_critical:' || h.project_id, 'project_critical', h.project_id, h.project_id, 'critical', h.title, jsonb_build_object('score', h.score, 'reasons', h.reasons) from h where h.level = 'critical'
  union all select 'project_no_owner:' || h.project_id, 'project_no_owner', h.project_id, h.project_id, 'high', h.title, '{}'::jsonb from h where h.manager_id is null
  union all select 'milestone_overdue:' || m.id, 'milestone_overdue', m.id, public.as_uuid(m.data->>'project_ref'), 'high', m.title, jsonb_build_object('due', m.data->>'due')
    from v m where m.section = 'company.milestones' and m.status not in ('Reached', 'Missed') and public.mgmt_date(m.data->>'due') < today and public.as_uuid(m.data->>'project_ref') in (select mine.project_id from mine)
  union all select 'critical_blocker:' || t.id, 'critical_blocker', t.id, public.as_uuid(t.data->>'project_ref'), 'critical', t.title, jsonb_build_object('blocker', t.data->>'blocker')
    from v t where t.section = 'company.tasks' and t.status = 'Blocked' and t.data->>'priority' = 'Critical' and (lead or public.as_uuid(t.data->>'project_ref') in (select mine.project_id from mine))
  union all select 'critical_task_overdue:' || t.id, 'critical_task_overdue', t.id, public.as_uuid(t.data->>'project_ref'), 'high', t.title, jsonb_build_object('due', t.data->>'due')
    from v t where t.section = 'company.tasks' and t.status not in ('Completed', 'Cancelled') and t.data->>'priority' = 'Critical' and public.mgmt_date(t.data->>'due') < today
      and (lead or public.as_uuid(t.data->>'project_ref') in (select mine.project_id from mine))
  union all select 'approval_sla:' || a.id, 'approval_sla', a.record_id, coalesce(public.as_uuid(rv.data->>'project_ref'), case when rv.section = 'company.projects' then rv.id end), 'high', rv.title,
      jsonb_build_object('days', extract(day from now() - a.created_at)::int, 'approver', a.approver_id)
    from public.approvals a join v rv on rv.id = a.record_id where a.status = 'pending' and a.created_at < now() - make_interval(days => (c->>'approval_sla_days')::int)
      and (lead or coalesce(public.as_uuid(rv.data->>'project_ref'), rv.id) in (select mine.project_id from mine))
  union all select 'decision_sla:' || d.id, 'decision_sla', d.id, public.as_uuid(d.data->>'project_ref'), 'high', d.title, jsonb_build_object('status', d.status)
    from v d where d.section = 'company.decisions' and d.status in ('Proposed', 'In review')
      and coalesce(public.mgmt_date(d.data->>'date'), d.created_at::date) < today - (c->>'decision_sla_days')::int
      and (lead or public.as_uuid(d.data->>'project_ref') in (select mine.project_id from mine));
end $$;
revoke execute on function public._alert_conditions(uuid) from public, anon, authenticated;

create or replace function public.mgmt_alert_text(p_kind text) returns text language sql immutable set search_path = '' as $$
  select case p_kind when 'project_critical' then 'Project became CRITICAL' when 'project_no_owner' then 'Project has no owner' when 'milestone_overdue' then 'Milestone is overdue'
    when 'critical_blocker' then 'Critical task is blocked' when 'critical_task_overdue' then 'Critical task is overdue' when 'approval_sla' then 'Approval is over its time limit'
    when 'decision_sla' then 'Decision is over its time limit' else p_kind end
$$;
-- evaluate for one person (p_user) or, from the scheduler, for every owner / manager / project manager
create or replace function public.mgmt_alert_scan(p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := public.mgmt_config(); u uuid; cond record; al public.management_alerts; opened int := 0; reopened int := 0; resolved int := 0; seen int := 0;
  cool interval; svc boolean := auth.uid() is null; keys text[]; n int;
begin
  cool := make_interval(hours => (c->>'alert_cooldown_hours')::int);
  if not svc then  -- a person may only scan for themselves
    if p_user is distinct from auth.uid() or public.mgmt_viewer() is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  end if;
  for u in select p.id from public.profiles p where not p.disabled and (p_user is null or p.id = p_user)
             and (p.role in ('owner', 'admin', 'management') or exists (select 1 from public.records r where r.section = 'company.projects' and r.data->>'manager_id' = p.id::text and r.status not in ('Completed', 'Cancelled')))
  loop
    keys := '{}';
    for cond in select * from public._alert_conditions(u) loop
      seen := seen + 1; keys := keys || cond.key;
      select * into al from public.management_alerts where user_id = u and key = cond.key for update;
      if not found then
        insert into public.management_alerts(user_id, key, kind, record_id, project_id, severity, title, detail, notified_at)
          values (u, cond.key, cond.kind, cond.record_id, cond.project_id, cond.severity, cond.title, cond.detail, now()) returning * into al;
        perform public.notify_user(u, 'mgmt_alert', cond.record_id, 'alert:' || al.id || ':1', cond.title, public.mgmt_alert_text(cond.kind), null, (select public.mgmt_link(r.section, r.id) from public.records r where r.id = cond.record_id));
        opened := opened + 1;
      elsif al.resolved_at is null then
        update public.management_alerts set last_seen_at = now(), detail = cond.detail, title = cond.title, severity = cond.severity where id = al.id;
      else  -- it came back
        update public.management_alerts set resolved_at = null, last_seen_at = now(), opened_at = now(), times_opened = al.times_opened + 1, detail = cond.detail,
          notified_at = case when al.resolved_at < now() - cool then now() else al.notified_at end where id = al.id;
        if al.resolved_at < now() - cool then
          perform public.notify_user(u, 'mgmt_alert', cond.record_id, 'alert:' || al.id || ':' || (al.times_opened + 1), cond.title, public.mgmt_alert_text(cond.kind), null, (select public.mgmt_link(r.section, r.id) from public.records r where r.id = cond.record_id));
          opened := opened + 1;
        else reopened := reopened + 1; end if;
      end if;
    end loop;
    update public.management_alerts a set resolved_at = now() where a.user_id = u and a.resolved_at is null and not (a.key = any(keys));
    get diagnostics n = row_count; resolved := resolved + n;
  end loop;
  return jsonb_build_object('conditions', seen, 'notified', opened, 'reopened_quietly', reopened, 'resolved', resolved);
end $$;
revoke execute on function public.mgmt_alert_scan(uuid) from public, anon;
grant execute on function public.mgmt_alert_scan(uuid) to authenticated, service_role;

/* ---------------------------------------------------------------------------------------------
   18. Voice Inbox — what a person said or typed, the proposal it became, and what it was turned into
   --------------------------------------------------------------------------------------------- */
create table if not exists public.voice_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  raw_text text not null check (length(raw_text) between 1 and 2000),
  source text not null default 'voice' check (source in ('voice', 'text')),
  lang text check (lang is null or lang in ('en', 'ru', 'uk', 'ar')),
  status text not null default 'New' check (status in ('New', 'Parsed', 'Needs Confirmation', 'Converted', 'Dismissed', 'Failed')),
  plan jsonb, question text, error text,
  result_record_id uuid references public.records(id) on delete set null,
  action_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.voice_inbox add column if not exists converted_as text;
create index if not exists voice_inbox_user_idx on public.voice_inbox (user_id, created_at desc);
alter table public.voice_inbox enable row level security;
drop policy if exists p_voice_inbox_own on public.voice_inbox;
create policy p_voice_inbox_own on public.voice_inbox for select to authenticated using (user_id = auth.uid());
drop policy if exists p_session_voice_inbox on public.voice_inbox;
create policy p_session_voice_inbox on public.voice_inbox as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));
revoke insert, update, delete on public.voice_inbox from anon, authenticated;  -- written by the server route (the parser and the safe-action layer)

/* ---------------------------------------------------------------------------------------------
   19. Action audit — every proposal made by the Assistant, the Voice Inbox or a voice command, with its risk
       class, the confirmation, the record it produced and its undo. Written by the server only.
   --------------------------------------------------------------------------------------------- */
create table if not exists public.action_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('voice', 'voice_inbox', 'assistant', 'text')),
  command text not null check (length(command) <= 2000),
  intent text not null,
  risk text not null check (risk in ('read', 'low', 'material', 'controlled')),
  interpreted jsonb not null default '{}'::jsonb,
  status text not null default 'proposed',
  question text, error text,
  confirmed_at timestamptz, executed_at timestamptz,
  result_record_id uuid, result jsonb,
  undo jsonb, undone_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.action_audit drop constraint if exists action_audit_status_check;
alter table public.action_audit add constraint action_audit_status_check check (status in ('proposed', 'needs_clarification', 'rejected', 'confirmed', 'executed', 'failed', 'cancelled', 'undone'));
create index if not exists action_audit_user_idx on public.action_audit (user_id, created_at desc);
alter table public.action_audit enable row level security;
drop policy if exists p_action_audit_read on public.action_audit;
create policy p_action_audit_read on public.action_audit for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and not p.disabled and p.role in ('owner', 'admin')));
drop policy if exists p_session_action_audit on public.action_audit;
create policy p_session_action_audit on public.action_audit as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));
revoke insert, update, delete on public.action_audit from anon, authenticated;

-- no Assistant / voice row may be changed or removed except by the server's own state transitions
create or replace function public.action_audit_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'The action audit is kept'; end if;
  if new.user_id is distinct from old.user_id or new.command is distinct from old.command or new.created_at is distinct from old.created_at or new.source is distinct from old.source then
    raise exception 'An audit entry cannot be rewritten';
  end if;
  -- states only move forward: proposed / needs_clarification → confirmed | cancelled | rejected | executed | failed;
  -- confirmed → executed | failed; executed | failed → undone (once). Closed entries stay closed.
  if new.status is distinct from old.status and not (
       (old.status in ('proposed', 'needs_clarification') and new.status in ('confirmed', 'cancelled', 'rejected', 'executed', 'failed'))
    or (old.status = 'confirmed' and new.status in ('executed', 'failed'))
    or (old.status in ('executed', 'failed') and new.status = 'undone')) then
    raise exception 'Audit state % cannot become %', old.status, new.status;
  end if;
  if old.status in ('executed', 'failed', 'cancelled', 'rejected', 'undone') and (new.interpreted is distinct from old.interpreted or new.result is distinct from old.result or new.confirmed_at is distinct from old.confirmed_at) then
    raise exception 'A closed audit entry cannot be rewritten';
  end if;
  return new;
end $$;
drop trigger if exists action_audit_guard on public.action_audit;
create trigger action_audit_guard before update or delete on public.action_audit for each row execute function public.action_audit_guard();

/* ---------------------------------------------------------------------------------------------
   20. Report helpers: workload per person (counts only — never a productivity score) and decisions by state
   --------------------------------------------------------------------------------------------- */
create or replace function public.mgmt_decisions_report()
returns table (record_id uuid, number text, title text, status text, project_id uuid, project_title text, responsible_id uuid, date date, due date, reconsider date, age_days integer, link text)
language sql stable security definer set search_path = public as $$
  with v as (select * from public.mgmt_visible(public.mgmt_viewer())), pr as (select v.id, v.title from v where v.section = 'company.projects')
  select d.id, d.data->>'doc_number', d.title, d.status, public.as_uuid(d.data->>'project_ref'), pr.title, public.as_uuid(d.data->>'responsible_id'),
    coalesce(public.mgmt_date(d.data->>'date'), d.created_at::date), public.mgmt_date(d.data->>'due'), public.mgmt_date(d.data->>'reconsider'),
    ((now() at time zone 'utc')::date - coalesce(public.mgmt_date(d.data->>'date'), d.created_at::date))::int, public.mgmt_link(d.section, d.id)
  from v d left join pr on pr.id = public.as_uuid(d.data->>'project_ref') where d.section = 'company.decisions'
  order by case d.status when 'Proposed' then 0 when 'In review' then 1 when 'Deferred' then 2 else 3 end, 8 desc, d.id
$$;
revoke execute on function public.mgmt_decisions_report() from public, anon;
grant execute on function public.mgmt_decisions_report() to authenticated;

/* ---------------------------------------------------------------------------------------------
   21. Waiting For actions. Remind: a notification to the party (once a day per item). Escalate: the project
       manager (or the department head of the person) and the party are told; the escalation is a history row, the
       record itself is not touched. Both only for an item that is in the caller's own Waiting For list.
   --------------------------------------------------------------------------------------------- */
create or replace function public._waiting_target(p_viewer uuid, p_record uuid, p_approval uuid)
returns table (bucket text, kind text, record_id uuid, section text, title text, project_id uuid, party_id uuid, party_name text, link text)
language sql stable security definer set search_path = public as $$
  select w.bucket, w.kind, w.record_id, w.section, w.title, w.project_id, w.party_id, w.party_name, w.link
  from public._waiting_for(p_viewer) w
  where w.record_id = p_record and w.approval_id is not distinct from p_approval and w.bucket in ('others', 'team', 'external')
  order by case w.bucket when 'others' then 0 when 'team' then 1 else 2 end limit 1
$$;
revoke execute on function public._waiting_target(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.waiting_remind(p_record uuid, p_approval uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := public.mgmt_viewer(); w record; who uuid; last timestamptz; sent boolean;
begin
  if me is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into w from public._waiting_target(me, p_record, p_approval);
  if w.record_id is null then raise exception 'Not in your Waiting For list' using errcode = '42501'; end if;
  -- an outside party is reminded through the colleague who handles it
  who := coalesce(w.party_id, (select public.as_uuid(r.data->>'assignee_id') from public.records r where r.id = p_record));
  if who is null or who = me then raise exception 'Nobody to remind'; end if;
  select max(a.created_at) into last from public.activity a where a.record_id = p_record and a.action = 'mgmt_reminded' and a.actor = me and (a.detail->>'to')::uuid = who;
  if last > now() - interval '20 hours' then return jsonb_build_object('ok', false, 'reason', 'cooldown', 'last', last); end if;
  sent := public.notify_user(who, 'waiting_remind', p_record, 'remind:' || p_record || ':' || me || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
    'Reminder: ' || w.title, coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = me), '') || ' is waiting for this.', me, w.link);
  insert into public.activity (record_id, section, actor, action, detail) values (p_record, w.section, me, 'mgmt_reminded', jsonb_build_object('to', who, 'kind', w.kind, 'approval', p_approval));
  return jsonb_build_object('ok', true, 'to', who, 'notified', coalesce(sent, false));
end $$;
revoke execute on function public.waiting_remind(uuid, uuid) from public, anon;
grant execute on function public.waiting_remind(uuid, uuid) to authenticated;

create or replace function public.waiting_escalate(p_record uuid, p_approval uuid default null, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := public.mgmt_viewer(); w record; r record; up uuid; party uuid; n int := 0; last timestamptz;
begin
  if me is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into w from public._waiting_target(me, p_record, p_approval);
  if w.record_id is null then raise exception 'Not in your Waiting For list' using errcode = '42501'; end if;
  select max(a.created_at) into last from public.activity a where a.record_id = p_record and a.action = 'mgmt_escalated';
  if last > now() - interval '20 hours' then return jsonb_build_object('ok', false, 'reason', 'cooldown', 'last', last); end if;
  select * into r from public.records where id = p_record;
  party := coalesce(w.party_id, public.as_uuid(r.data->>'assignee_id'));
  -- the person above: the project's manager, else the department head of the party
  up := (select public.as_uuid(p.data->>'manager_id') from public.records p where p.id = w.project_id and p.section = 'company.projects');
  if up is null or up in (me, party) then up := (select d.manager_id from public.profiles q join public.departments d on d.id = q.department_id where q.id = party); end if;
  if up is not null and up not in (me) and exists (select 1 from public.profiles q where q.id = up and not q.disabled) then
    perform public.notify_user(up, 'waiting_escalated', p_record, 'escalate:' || p_record || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 'Escalated: ' || w.title,
      left(coalesce(p_note, ''), 300), me, w.link); n := n + 1;
  end if;
  if party is not null and party not in (me) and party is distinct from up then
    perform public.notify_user(party, 'waiting_escalated', p_record, 'escalate-party:' || p_record || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 'Escalated: ' || w.title,
      left(coalesce(p_note, ''), 300), me, w.link); n := n + 1;
  end if;
  insert into public.activity (record_id, section, actor, action, detail) values (p_record, w.section, me, 'mgmt_escalated', jsonb_build_object('to', up, 'party', party, 'approval', p_approval, 'note', left(coalesce(p_note, ''), 300)));
  return jsonb_build_object('ok', true, 'to', up, 'party', party, 'notified', n);
end $$;
revoke execute on function public.waiting_escalate(uuid, uuid, text) from public, anon;
grant execute on function public.waiting_escalate(uuid, uuid, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   22. Hourly management job (Phase 1 scheduler, job "executive"): one daily snapshot per manager (for "since
       yesterday") — service role only. The alert scan is mgmt_alert_scan(null).
   --------------------------------------------------------------------------------------------- */
create or replace function public.mgmt_daily_snapshots() returns integer
language plpgsql security definer set search_path = public as $$
declare u uuid; n int := 0;
begin
  if auth.uid() is not null then raise exception 'Not allowed' using errcode = '42501'; end if;
  for u in select p.id from public.profiles p where not p.disabled
             and (p.role in ('owner', 'admin', 'management') or exists (select 1 from public.records r where r.section = 'company.projects' and r.data->>'manager_id' = p.id::text and r.status not in ('Completed', 'Cancelled')))
  loop
    if not exists (select 1 from public.management_snapshots s where s.user_id = u and s.kind = 'daily' and s.taken_at::date = (now() at time zone 'utc')::date) then
      perform public._mgmt_snapshot(u, 'daily'); n := n + 1;
    end if;
  end loop;
  -- snapshots older than 400 days (daily) are not needed for any comparison
  delete from public.management_snapshots where kind = 'daily' and taken_at < now() - interval '400 days';
  return n;
end $$;
revoke execute on function public.mgmt_daily_snapshots() from public, anon, authenticated;
grant execute on function public.mgmt_daily_snapshots() to service_role;

commit;
