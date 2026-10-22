#!/usr/bin/env bash
# Phase 8 (B72) — the v25 migration on the isolated stack only. Synthetic data; never production.
#   A. Full path v18 → v25 on a separate, fresh database (agron_mig): the schema up to v18, legacy manufacturing data in the
#      old shapes (builds with the old statuses, the earlier BOM and inventory lists), then v19 … v25 one by one; v25 again
#      (re-runnable); rollback twice; v25 again.
#   B. The stack's own database (with all test data): v25 again → rollback → Phase 7 critical suites on the rolled-back
#      schema → rollback again (safe twice) → v25 again.
# After each step a fingerprint is printed: counts and checksums of the business data. "content" checksums leave out
# the row version counter (a status put back by the rollback is an update and bumps it); "full" checksums keep it.
#   bash scripts/stack/cycle-v25.sh                      (A and B)
#   P7_SUITES="tests/integration/p7.test.ts tests/integration/rls.test.ts" bash scripts/stack/cycle-v25.sh
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
    'manufacturing_status', (select jsonb_object_agg(k, n) from (select section || '/' || coalesce(status, '') k, count(*) n from records where section in ('operations.builds','technical.bom','operations.inventory') group by 1) x),
    'manufacturing_md5', (select md5(string_agg(id::text || ':' || coalesce(status, '') || ':' || md5((data - 'p8_prev_status' - 'p8_migrated_to' - 'product_ref' - 'product_ref_title' - 'config_ref' - 'config_ref_title')::text), ',' order by id)) from records where section in ('operations.builds','technical.bom','operations.inventory')),
    'v25_functions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'mfg\_%'),
    'v25_triggers', (select count(*) from pg_trigger where tgname like 'records_%mfg%'),
    'v25_tables', (select count(*) from pg_tables where schemaname = 'public' and tablename like 'mfg\_%'),
    'p8_sections', (select count(*) from records where section in ('technical.products','technical.configurations','technical.items','technical.boms','technical.test_procedures','operations.work_orders')))" 2>/dev/null || \
  $PSQL -d "$1" -c "select jsonb_build_object('records', (select count(*) from records),
    'records_content_md5', (select md5(string_agg(id::text || ':' || title || ':' || coalesce(status, '') || ':' || md5(data::text) || ':' || controlled || ':' || coalesce(created_by::text, ''), ',' order by id)) from records),
    'commercial_status', (select jsonb_object_agg(k, n) from (select section || '/' || coalesce(status, '') k, count(*) n from records where section in ('sales.pipeline','marketing.leads','company.contacts','sales.proposals') group by 1) x),
    'profiles', (select count(*) from profiles), 'comments', (select count(*) from comments), 'approvals', (select count(*) from approvals), 'note', 'pre-v22 schema: fewer tables')"
}
apply() { $PSQL -d "$1" -f "$2" >/dev/null 2>"/tmp/cyc25.err" || { echo "FAILED: $2 on $1"; tail -5 /tmp/cyc25.err; exit 1; }; }

if [ -z "${SKIP_A:-}" ]; then
echo "================ A. full path v18 → v25 on a fresh database ================"
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
echo "-- schema at v18; loading synthetic legacy manufacturing data (old build statuses, the earlier BOM and inventory lists)"
$PSQL -d agron_mig <<'SQL' >/dev/null
insert into auth.users(id, email, aud, role, instance_id) values ('00000000-0000-4000-8000-000000000001', 'owner@mig.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') on conflict do nothing;
update profiles set role = 'owner', full_name = 'Mig Owner', us_person = true where id = '00000000-0000-4000-8000-000000000001';
insert into records(id, section, title, status, data, created_by)
 select ('20000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'operations.builds', 'Mig build ' || g, (array['Design','Procurement','Assembly','Integration','Testing','Shipping','Installed'])[1 + g % 7],
   jsonb_build_object('config', (array['C20 Base','C40 Advanced','Sprinter','C20 Enhanced'])[1 + g % 4], 'export_check', case when g % 7 = 5 then 'Cleared' end, 'site', 'Mig site ' || g), '00000000-0000-4000-8000-000000000001' from generate_series(1, 14) g;
insert into records(section, title, status, data, created_by)
 select 'technical.bom', 'Mig BOM line ' || g, null, jsonb_build_object('config', (array['C20 Base','C40 Advanced'])[1 + g % 2], 'part_no', 'MIG-' || g, 'qty', 1 + g % 3, 'supplier', 'Mig Supplier'), '00000000-0000-4000-8000-000000000001' from generate_series(1, 12) g;
insert into records(section, title, status, data, created_by)
 select 'operations.inventory', 'Mig stock ' || g, 'In stock', jsonb_build_object('model', 'Mig part ' || g, 'part_no', 'MIG-' || g, 'qty', 2 + g, 'location', 'Main', 'unit_cost', 10 * g, 'serial', case when g % 4 = 0 then 'MIG-SN-' || g end), '00000000-0000-4000-8000-000000000001' from generate_series(1, 8) g;
insert into records(section, title, status, data, created_by)
 select s, 'Mig ' || s || ' ' || g, null, jsonb_build_object('n', g), '00000000-0000-4000-8000-000000000001' from generate_series(1, 10) g, unnest(array['company.projects','company.tasks','company.documents','operations.procurement','technical.testing','operations.quality']) s;
insert into comments(record_id, author, body) select id, '00000000-0000-4000-8000-000000000001', 'Mig comment on ' || title from records where title like 'Mig build %';
SQL
step() { echo "== A$1"; fp agron_mig; }
step "1 v18 with legacy data"
for n in 19 20 21 22 23 24; do apply agron_mig "supabase/update-v$n.sql"; done; step "2 after v19 … v24"
apply agron_mig supabase/update-v25.sql; step "3 after v25 (build statuses mapped, products/configurations/items/BOM drafts made from the earlier lists)"
$PSQL -d agron_mig -c "select 'A3 check: ' || (select count(*) from records where section = 'technical.products') || ' products; ' || (select count(*) from records where section = 'technical.configurations') || ' configurations (Draft: ' || (select count(*) from records where section = 'technical.configurations' and status = 'Draft') || '); ' || (select count(*) from records where section = 'operations.builds' and data ? 'p8_prev_status') || ' builds with their earlier status kept; ' || (select count(*) from records where section = 'operations.builds' and status in ('Design','Shipping','Installed')) || ' in an old status; ' || (select count(*) from records where section = 'operations.builds' and coalesce(data->>'config_ref','') <> '') || ' linked to a configuration; ' || (select count(*) from records where section = 'technical.items') || ' items; ' || (select count(*) from records where section = 'technical.boms') || ' BOM drafts with ' || (select count(*) from mfg_bom_lines) || ' lines; ' || (select count(*) from mfg_serials) || ' serials; stock ' || coalesce((select sum(qty)::text from mfg_stock), '0') || '; earlier lists marked migrated: ' || (select count(*) from records where data ? 'p8_migrated_to')"
apply agron_mig supabase/update-v25.sql; step "4 after v25 again (re-runnable: same as A3)"
apply agron_mig supabase/rollback-v25.sql; step "5 after rollback (statuses as in A2; earlier lists unchanged; additive records kept)"
apply agron_mig supabase/rollback-v25.sql; step "6 after a second rollback (safe twice)"
apply agron_mig supabase/update-v25.sql; step "7 after v25 again (content as in A3)"
$PSQL -d postgres -c "drop database agron_mig" >/dev/null
fi

if [ -z "${SKIP_B:-}" ]; then
echo "================ B. the stack database (all test data) ================"
stepb() { echo "== B$1"; fp postgres; }
stepb "1 before (v25 applied, with test data)"
apply postgres supabase/update-v25.sql; stepb "2 after v25 again (re-runnable)"
apply postgres supabase/rollback-v25.sql; stepb "3 after rollback"
$PSQL -d postgres -c "select 'v24 answers: ' || (select count(*) from pg_proc where proname like 'crm\_%' and pronamespace = 'public'::regnamespace) || ' crm functions; ' || (select count(*) from wf_definitions where state = 'published') || ' published processes; ' || (select count(*) from pg_proc where proname like 'mfg\_%' and pronamespace = 'public'::regnamespace) || ' mfg functions left; build statuses: ' || (select string_agg(distinct status, ', ') from records where section = 'operations.builds')"
if [ -n "${P7_SUITES:-}" ]; then echo "== Phase 7 critical suites on the rolled-back schema: $P7_SUITES"; node --experimental-strip-types --disable-warning=ExperimentalWarning --import ./scripts/guide/reg.mjs --test --test-concurrency=1 $P7_SUITES 2>&1 | grep -E "^# (tests|pass|fail)|^not ok" ; fi
apply postgres supabase/rollback-v25.sql; stepb "4 after a second rollback (safe twice)"
apply postgres supabase/update-v25.sql; stepb "5 after v25 again"
fi
