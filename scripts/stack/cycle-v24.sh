#!/usr/bin/env bash
# Phase 7 (B51) — the v24 migration on the isolated stack only. Synthetic data; never production.
#   A. Full path v18 → v24 on a separate, fresh database (agron_mig): the schema up to v18, legacy commercial data in the
#      old stage/status names, then v19 … v24 one by one; v24 again (re-runnable); rollback; v24 again.
#   B. The stack's own database (with all test data): v24 again → rollback → Phase 6 critical suites on the rolled-back
#      schema → rollback again (safe twice) → v24 again.
# After each step a fingerprint is printed: counts and checksums of the business data. "content" checksums leave out
# the row version counter (a status put back by the rollback is an update and bumps it); "full" checksums keep it.
#   bash scripts/stack/cycle-v24.sh                      (A and B)
#   P6_SUITES="tests/integration/p6.test.ts tests/integration/rls.test.ts" bash scripts/stack/cycle-v24.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGPASSWORD="${PGPASSWORD:-postgres}"
PORT="${STACK_PG_PORT:-54329}"
PSQL="psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -qtA"
fp() { # $1 = database
  $PSQL -d "$1" -c "select jsonb_build_object(
    'records', (select count(*) from records),
    'records_content_md5', (select md5(string_agg(id::text || ':' || title || ':' || coalesce(status, '') || ':' || md5(data::text) || ':' || controlled || ':' || coalesce(created_by::text, ''), ',' order by id)) from records),
    'records_full_md5', (select md5(string_agg(id::text || ':' || version || ':' || coalesce(status, '') || ':' || md5(data::text), ',' order by id)) from records),
    'non_commercial_md5', (select md5(string_agg(id::text || ':' || coalesce(status, '') || ':' || md5(data::text), ',' order by id)) from records where section not in ('sales.pipeline','marketing.leads','company.contacts','sales.proposals','company.parties')),
    'commercial_status', (select jsonb_object_agg(k, n) from (select section || '/' || coalesce(status, '') k, count(*) n from records where section in ('sales.pipeline','marketing.leads','company.contacts','sales.proposals') group by 1) x),
    'profiles', (select count(*) from profiles), 'profiles_md5', (select md5(string_agg(id::text || role || coalesce(company, ''), ',' order by id)) from profiles),
    'parties', (select count(*) from records where section = 'company.parties'), 'projects', (select count(*) from records where section = 'company.projects'),
    'tasks', (select count(*) from records where section = 'company.tasks'), 'documents', (select count(*) from records where section = 'company.documents'),
    'decisions', (select count(*) from records where section = 'company.decisions'), 'purchases', (select count(*) from records where section = 'operations.procurement'),
    'payments', (select count(*) from records where section = 'finance.payments'), 'contracts', (select count(*) from records where section = 'legal.contracts'),
    'ecrs', (select count(*) from records where section = 'technical.changes'),
    'document_versions', (select count(*) from document_versions), 'approvals', (select count(*) from approvals),
    'approvals_md5', (select md5(string_agg(id::text || status || coalesce(basis_hash, ''), ',' order by id)) from approvals),
    'comments', (select count(*) from comments), 'comments_md5', (select md5(string_agg(id::text || md5(body), ',' order by id)) from comments),
    'notifications', (select count(*) from notifications),
    'wf_definitions', (select count(*) from wf_definitions), 'wf_instances', (select count(*) from wf_instances),
    'wf_instances_md5', (select md5(string_agg(id::text || status || coalesce(current_step, ''), ',' order by id)) from wf_instances),
    'management_settings', (select count(*) from management_settings),
    'v24_functions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'crm\_%'),
    'v24_triggers', (select count(*) from pg_trigger where tgname like 'records_crm%'),
    'crm_values', (select count(*) from pg_tables where tablename = 'crm_values'))" 2>/dev/null || \
  $PSQL -d "$1" -c "select jsonb_build_object('records', (select count(*) from records),
    'records_content_md5', (select md5(string_agg(id::text || ':' || title || ':' || coalesce(status, '') || ':' || md5(data::text) || ':' || controlled || ':' || coalesce(created_by::text, ''), ',' order by id)) from records),
    'commercial_status', (select jsonb_object_agg(k, n) from (select section || '/' || coalesce(status, '') k, count(*) n from records where section in ('sales.pipeline','marketing.leads','company.contacts','sales.proposals') group by 1) x),
    'profiles', (select count(*) from profiles), 'comments', (select count(*) from comments), 'approvals', (select count(*) from approvals), 'note', 'pre-v22 schema: fewer tables')"
}
apply() { $PSQL -d "$1" -f "$2" >/dev/null 2>"/tmp/cyc24.err" || { echo "FAILED: $2 on $1"; tail -5 /tmp/cyc24.err; exit 1; }; }

if [ -z "${SKIP_A:-}" ]; then
echo "================ A. full path v18 → v24 on a fresh database ================"
$PSQL -d postgres -c "drop database if exists agron_mig" >/dev/null; $PSQL -d postgres -c "create database agron_mig" >/dev/null
sed 's/alter database postgres/alter database agron_mig/g' scripts/stack/bootstrap.sql | $PSQL -d agron_mig >/dev/null 2>&1
pg_dump -h 127.0.0.1 -p "$PORT" -U postgres -d postgres --schema-only -n auth -n storage -n realtime 2>/dev/null | grep -v "^CREATE SCHEMA" | psql -h 127.0.0.1 -p "$PORT" -U postgres -q -d agron_mig >/dev/null 2>&1 || true
$PSQL -d agron_mig -c "do \$\$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end \$\$" >/dev/null
apply agron_mig scripts/stack/post-auth.sql
for f in $(node -e 'import("./scripts/stack/stack.mjs").then(m=>console.log(m.migrations().join(" ")))' 2>/dev/null); do
  n=$(echo "$f" | sed -n 's/^update-v\([0-9]*\)\.sql$/\1/p'); if [ -n "$n" ] && [ "$n" -gt 18 ]; then continue; fi
  apply agron_mig "supabase/$f"
done
apply agron_mig scripts/stack/post-migrate.sql
echo "-- schema at v18; loading synthetic legacy data (old stage and status names)"
$PSQL -d agron_mig <<'SQL' >/dev/null
insert into auth.users(id, email, aud, role, instance_id) values ('00000000-0000-4000-8000-000000000001', 'owner@mig.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-4000-8000-000000000002', 'sales@mig.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') on conflict do nothing;
update profiles set role = 'owner', full_name = 'Mig Owner', us_person = true where id = '00000000-0000-4000-8000-000000000001';
update profiles set role = 'sales', full_name = 'Mig Sales', us_person = true where id = '00000000-0000-4000-8000-000000000002';
insert into records(id, section, title, status, data, created_by) values
 ('10000000-0000-4000-8000-000000000001', 'company.parties', 'Mig Harbor Marine LLC', 'Active', '{"country":"UAE"}', '00000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000002', 'sales.clients', 'Mig Harbor Marine (client)', 'Active', '{"party_ref":"10000000-0000-4000-8000-000000000001","party_ref_title":"Mig Harbor Marine LLC"}', '00000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003', 'sales.partners', 'Mig Gulf Partner', 'Active', '{"party_ref":"10000000-0000-4000-8000-000000000001"}', '00000000-0000-4000-8000-000000000002');
insert into records(section, title, status, data, created_by)
 select 'sales.pipeline', 'Mig deal ' || g, (array['Lead','Qualified','Proposal','Negotiation','Won','Lost'])[1 + g % 6],
   jsonb_build_object('value', 100000 * g, 'currency', 'USD', 'client_ref', '10000000-0000-4000-8000-000000000002', 'owner', 'Mig Sales'), '00000000-0000-4000-8000-000000000002' from generate_series(1, 30) g;
insert into records(section, title, status, data, created_by)
 select 'marketing.leads', 'Mig lead ' || g, (array['New','Contacted','Qualified','To pipeline','Dropped'])[1 + g % 5], jsonb_build_object('email', 'lead' || g || '@mig.test'), '00000000-0000-4000-8000-000000000002' from generate_series(1, 25) g;
insert into records(section, title, status, data, created_by)
 select 'company.contacts', 'Mig contact ' || g, (array['Active','Archived'])[1 + g % 2], jsonb_build_object('email', 'c' || g || '@mig.test'), '00000000-0000-4000-8000-000000000002' from generate_series(1, 20) g;
insert into records(section, title, status, data, created_by)
 select 'sales.proposals', 'Mig proposal ' || g, 'Sent', jsonb_build_object('value', 50000 * g, 'currency', 'USD'), '00000000-0000-4000-8000-000000000002' from generate_series(1, 10) g;
insert into records(section, title, status, data, created_by)
 select s, 'Mig ' || s || ' ' || g, null, jsonb_build_object('n', g), '00000000-0000-4000-8000-000000000001' from generate_series(1, 15) g, unnest(array['company.projects','company.tasks','company.documents','company.decisions','legal.contracts','finance.payments']) s;
insert into comments(record_id, author, body) select id, '00000000-0000-4000-8000-000000000001', 'Mig comment on ' || title from records where title like 'Mig deal %';
SQL
step() { echo "== A$1"; fp agron_mig; }
step "1 v18 with legacy data"
for n in 19 20 21 22 23; do apply agron_mig "supabase/update-v$n.sql"; done; step "2 after v19 … v23"
apply agron_mig supabase/update-v24.sql; step "3 after v24 (statuses moved to the Phase 7 lists, numbers added)"
$PSQL -d agron_mig -c "select 'A3 check: ' || (select count(*) from records where section = 'sales.pipeline' and coalesce(data->>'number','') <> '') || ' numbered; ' || (select count(*) from records where section='sales.pipeline' and status='Lead') || ' in old Lead stage; ' || (select count(*) from records where section='sales.pipeline' and data->>'party_ref' = '10000000-0000-4000-8000-000000000001') || ' linked to the organisation; ' || (select count(*) from crm_stage_history) || ' stage-history starts; ' || (select count(*) from crm_values) || ' value-history starts; types=' || (select data->>'relationship_types' from records where id = '10000000-0000-4000-8000-000000000001')"
apply agron_mig supabase/update-v24.sql; step "4 after v24 again (re-runnable: same as A3)"
apply agron_mig supabase/rollback-v24.sql; step "5 after rollback (statuses as in A2; additive data kept)"
apply agron_mig supabase/rollback-v24.sql; step "6 after a second rollback (safe twice)"
apply agron_mig supabase/update-v24.sql; step "7 after v24 again (content as in A3)"
$PSQL -d postgres -c "drop database agron_mig" >/dev/null
fi

if [ -z "${SKIP_B:-}" ]; then
echo "================ B. the stack database (all test data) ================"
stepb() { echo "== B$1"; fp postgres; }
stepb "1 before (v24 applied, with test data)"
apply postgres supabase/update-v24.sql; stepb "2 after v24 again (re-runnable)"
apply postgres supabase/rollback-v24.sql; stepb "3 after rollback"
$PSQL -d postgres -c "select 'v23 engine answers: ' || (select count(*) from wf_definitions where state = 'published') || ' published processes; ' || (select count(*) from wf_instances where status in ('active','waiting','blocked')) || ' open processes kept; ' || (select count(*) from pg_proc where proname like 'crm\_%' and pronamespace = 'public'::regnamespace) || ' crm functions left (crm_append_only is kept)'"
if [ -n "${P6_SUITES:-}" ]; then echo "== Phase 6 critical suites on the rolled-back schema: $P6_SUITES"; node --experimental-strip-types --disable-warning=ExperimentalWarning --import ./scripts/guide/reg.mjs --test --test-concurrency=1 $P6_SUITES 2>&1 | grep -E "^# (tests|pass|fail)|^not ok" ; fi
apply postgres supabase/rollback-v24.sql; stepb "4 after a second rollback (safe twice)"
apply postgres supabase/update-v24.sql; stepb "5 after v24 again"
fi
