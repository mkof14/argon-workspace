#!/usr/bin/env bash
# Scenario 12 — v22 apply → test → rollback → verify Phase 4 → apply again, on the isolated stack only.
# Prints a fingerprint of the data after each step (counts and checksums); they must not change.
#   bash scripts/stack/cycle-v22.sh            (uses the stack's Postgres on 127.0.0.1:54329)
set -euo pipefail
cd "$(dirname "$0")/../.."
PG="psql -h 127.0.0.1 -p ${STACK_PG_PORT:-54329} -U postgres -v ON_ERROR_STOP=1 -qtA"
export PGPASSWORD="${PGPASSWORD:-postgres}"
fp() {
  $PG -c "select jsonb_build_object(
    'records', (select count(*) from records),
    'records_md5', (select md5(string_agg(id::text || ':' || version || ':' || coalesce(status, '') || ':' || md5(data::text), ',' order by id)) from records),
    'portfolios', (select count(*) from records where section = 'company.portfolios'),
    'activity', (select count(*) from activity), 'approvals', (select count(*) from approvals), 'comments', (select count(*) from comments),
    'notifications', (select count(*) from notifications), 'document_versions', (select count(*) from document_versions),
    'profiles_md5', (select md5(string_agg(id::text || coalesce(location, '') || coalesce(availability, '') || coalesce(timezone, ''), ',' order by id)) from profiles),
    'mgmt_settings', (select count(*) from management_settings), 'mgmt_settings_history', (select count(*) from management_settings_history),
    'snapshots', (select count(*) from management_snapshots), 'alerts', (select count(*) from management_alerts), 'voice_inbox', (select count(*) from voice_inbox),
    'action_audit', (select count(*) from action_audit), 'action_audit_md5', (select md5(string_agg(id::text || status, ',' order by id)) from action_audit),
    'portfolio_access_rows', (select count(*) from section_access where section = 'company.portfolios'),
    'v22_functions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('exec_overview','project_health','_project_health','open_loops','waiting_for','attention_items','portfolio_overview','mgmt_deadlines','management_changes','team_status','mgmt_alert_scan','mgmt_settings_save','mgmt_visible','waiting_remind','waiting_escalate','mgmt_daily_snapshots')),
    'v22_triggers', (select count(*) from pg_trigger where tgname in ('records_mgmt_changes', 'action_audit_guard')),
    'v21_record_visible', (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.proname = 'record_visible' and p.pronamespace = 'public'::regnamespace limit 1))"
}
step() { echo "== $1"; fp; }
step "1 before (v22 applied, with test data)"
$PG -f supabase/update-v22.sql >/dev/null 2>&1; step "2 after applying v22 again (re-runnable)"
$PG -f supabase/rollback-v22.sql >/dev/null; step "3 after rollback"
$PG -c "select count(*) || ' records still readable by the v21 rule' from records r where public.record_visible_for((select id from profiles where role = 'owner' and not disabled limit 1), r)"
if [ -n "${P4_SUITES:-}" ]; then echo "== Phase 4 suites on the rolled-back schema: $P4_SUITES"; node --experimental-strip-types --disable-warning=ExperimentalWarning --import ./scripts/guide/reg.mjs --test --test-concurrency=1 $P4_SUITES 2>&1 | grep -E "^# (tests|pass|fail)"; fi
$PG -f supabase/rollback-v22.sql >/dev/null; step "4 after a second rollback (safe twice)"
$PG -f supabase/update-v22.sql >/dev/null 2>&1; step "5 after applying v22 again"
$PG -c "select 'engines answer: ' || (select count(*) from public._project_health((select id from profiles where role = 'owner' and not disabled limit 1))) || ' projects'"
