-- AGRON Workspace — rollback of v22 (Phase 5) to the v21 behaviour. Data-preserving: the tables v22 created
-- (management settings and history, snapshots, alerts, voice inbox, action audit), the profile columns (location,
-- availability) and every record — portfolios included — are kept; only v22's functions, triggers and indexes go,
-- and portfolios leave the access map (their records stay, readable again after v22 is applied). Safe to run twice.
begin;

drop trigger if exists records_mgmt_changes on public.records;
drop trigger if exists action_audit_guard on public.action_audit;

drop function if exists public.mgmt_daily_snapshots();
drop function if exists public.waiting_escalate(uuid, uuid, text);
drop function if exists public.waiting_remind(uuid, uuid);
drop function if exists public._waiting_target(uuid, uuid, uuid);
drop function if exists public.exec_overview();
drop function if exists public.mgmt_decisions_report();
drop function if exists public.mgmt_alert_scan(uuid);
drop function if exists public._alert_conditions(uuid);
drop function if exists public.mgmt_alert_text(text);
drop function if exists public.team_status();
drop function if exists public._team_status(uuid);
drop function if exists public.management_changes(text);
drop function if exists public._changes(uuid, timestamptz, uuid);
drop function if exists public.mgmt_snapshot(text, text);
drop function if exists public._mgmt_snapshot(uuid, text, text);
drop function if exists public.mgmt_deadlines(integer);
drop function if exists public._deadlines(uuid, integer);
drop function if exists public.portfolio_overview();
drop function if exists public._portfolio(uuid);
drop function if exists public.attention_items(integer);
drop function if exists public._attention(uuid, integer);
drop function if exists public.waiting_for();
drop function if exists public._waiting_for(uuid);
drop function if exists public.open_loops(uuid);
drop function if exists public._open_loops(uuid, uuid);
drop function if exists public._open_loops_calc(uuid, uuid);
drop function if exists public.project_health(uuid);
drop function if exists public._project_health(uuid, uuid);
drop function if exists public._project_health_calc(uuid, uuid);
drop function if exists public.mgmt_link(text, uuid);
drop function if exists public.mgmt_date(text);
drop function if exists public.mgmt_viewer();
drop function if exists public._mgmt_base(uuid);
drop function if exists public.mgmt_visible(uuid);
drop function if exists public.records_mgmt_changes();
drop function if exists public.mgmt_settings_save(jsonb);
drop function if exists public.mgmt_config();
drop function if exists public.mgmt_defaults();
drop function if exists public.action_audit_guard();

drop index if exists public.records_task_assignee_idx;
drop index if exists public.records_project_portfolio_idx;
drop index if exists public.records_task_blocked_by_idx;
drop index if exists public.approvals_pending_created_idx;
drop index if exists public.activity_created_idx;
drop index if exists public.activity_record_idx;
drop index if exists public.activity_mgmt_idx;

-- portfolios leave the access map (records kept)
delete from public.section_access where section = 'company.portfolios';

notify pgrst, 'reload schema';

commit;
