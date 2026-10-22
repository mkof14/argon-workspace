#!/usr/bin/env bash
# Scenario 16 — v23 apply → test → rollback → verify Phase 5 → apply again, on the isolated stack only.
# Prints a fingerprint of the data after each step (counts and checksums); they must not change.
#   bash scripts/stack/cycle-v23.sh            (uses the stack's Postgres on 127.0.0.1:54329)
#   P5_SUITES="tests/integration/p5.test.ts" bash scripts/stack/cycle-v23.sh   (also runs Phase 5 on the rolled-back schema)
set -euo pipefail
cd "$(dirname "$0")/../.."
PG="psql -h 127.0.0.1 -p ${STACK_PG_PORT:-54329} -U postgres -v ON_ERROR_STOP=1 -qtA"
export PGPASSWORD="${PGPASSWORD:-postgres}"
fp() {
  $PG -c "select jsonb_build_object(
    'records', (select count(*) from records),
    'records_md5', (select md5(string_agg(id::text || ':' || version || ':' || coalesce(status, '') || ':' || md5(data::text) || ':' || controlled, ',' order by id)) from records),
    'activity', (select count(*) from activity), 'approvals', (select count(*) from approvals),
    'approvals_md5', (select md5(string_agg(id::text || status || coalesce(basis_hash, ''), ',' order by id)) from approvals),
    'comments', (select count(*) from comments), 'notifications', (select count(*) from notifications), 'document_versions', (select count(*) from document_versions),
    'wf_definitions', (select count(*) from wf_definitions), 'wf_instances', (select count(*) from wf_instances),
    'wf_instances_md5', (select md5(string_agg(id::text || status || coalesce(current_step, ''), ',' order by id)) from wf_instances),
    'wf_step_runs', (select count(*) from wf_step_runs), 'wf_events', (select count(*) from wf_events), 'wf_links', (select count(*) from wf_links),
    'approval_policies', (select count(*) from approval_policies), 'ops_settings_version', (select version from ops_settings), 'ops_proposals', (select count(*) from ops_proposals),
    'mgmt_settings', (select count(*) from management_settings), 'action_audit', (select count(*) from action_audit),
    'doc_counters_md5', (select md5(string_agg(prefix || ':' || last, ',' order by prefix)) from doc_counters),
    'v23_functions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('wf_start','wf_act','wf_approval_decide','ops_overview','ops_request_create','ops_receive','ops_record_payment','wf_sla_tick','_ops_base','wf_validate')),
    'v23_triggers', (select count(*) from pg_trigger where tgname in ('records_ops_before', 'records_ops_guard', 'records_ops_after')),
    'v22_functions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('exec_overview','project_health','open_loops','waiting_for','attention_items','portfolio_overview','mgmt_deadlines','team_status','_mgmt_base')),
    'access_rows', (select count(*) from section_access), 'procurement_access', (select count(*) from section_access where role = 'procurement'))"
}
step() { echo "== $1"; fp; }
step "1 before (v23 applied, with test data)"
$PG -f supabase/update-v23.sql >/dev/null 2>&1; step "2 after applying v23 again (re-runnable)"
$PG -f supabase/rollback-v23.sql >/dev/null; step "3 after rollback"
$PG -c "select count(*) || ' records readable by the owner under the v21 rule' from records r where public.record_visible_for((select id from profiles where role = 'owner' and not disabled limit 1), r)"
$PG -c "select 'Phase 5 engines answer: ' || (select count(*) from public._project_health((select id from profiles where role = 'owner' and not disabled limit 1))) || ' projects'"
if [ -n "${P5_SUITES:-}" ]; then echo "== Phase 5 suites on the rolled-back schema: $P5_SUITES"; node --experimental-strip-types --disable-warning=ExperimentalWarning --import ./scripts/guide/reg.mjs --test --test-concurrency=1 $P5_SUITES 2>&1 | grep -E "^# (tests|pass|fail)"; fi
$PG -f supabase/rollback-v23.sql >/dev/null; step "4 after a second rollback (safe twice)"
$PG -f supabase/update-v23.sql >/dev/null 2>&1; step "5 after applying v23 again"
$PG -c "select 'engine answers: ' || jsonb_array_length(public.wf_validate((select to_jsonb(d) from wf_definitions d where code = 'PURCHASE' and state = 'published'))) || ' validation errors in PURCHASE; ' || (select count(*) from wf_instances where status in ('active','waiting','blocked')) || ' open processes kept'"
