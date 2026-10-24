#!/usr/bin/env bash
# Phase 9 (B50, B52) — production migration rehearsal on the isolated stack. Synthetic data only; never production.
#   1. Fresh database "agron_reh" built exactly as production was: schema.sql, update-v2 … v17 and the access.sql of
#      the production branch (main). Its structure fingerprint is compared with the production fingerprint taken
#      read-only (structure only: tables/columns, functions, policies, triggers, indexes).
#   2. Production-shaped synthetic content: the production record count per section and status, the same data keys,
#      the same number of controlled records, files, FAQ and history rows — invented values only.
#   3. Backup (pg_dump, custom format) → v18 … latest, the exact files intended for production, timed one by one →
#      counts and fingerprints → latest again (re-runnable) → full rollback latest … v18, timed → structure compared
#      with step 1 → restore drill of the step-3 backup into "agron_reh_restore" → v18 … latest again → compared.
#   Acceptance evidence (P9-R2): .stack/evidence/rehearsal-<time>.json, source "synthetic" — a synthetic rehearsal
#   never proves production-data compatibility. The application smoke tests are not part of this script; they are
#   recorded as not performed unless OLD_APP_SMOKE / NEW_APP_SMOKE=pass name a smoke run of the same release.
#   PROD_FP='{"tables":17,...}' bash scripts/p9/rehearse.sh      (the production fingerprint, if known)
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGPASSWORD="${PGPASSWORD:-postgres}"
PORT="${STACK_PG_PORT:-54329}"; DB=agron_reh
PSQL="psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -qtA"
LAST=$(ls supabase | sed -n 's/^update-v\([0-9]*\)\.sql$/\1/p' | sort -n | tail -1); STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OUT="${REHEARSAL_OUT:-.stack/rehearsal}"; mkdir -p "$OUT"; BASE="$OUT/base"; rm -rf "$BASE"; mkdir -p "$BASE"
ms() { date +%s%3N; }
fp() { $PSQL -d "$1" -f scripts/p9/fingerprint.sql; }
counts() { $PSQL -d "$1" -c "select json_build_object('profiles',(select count(*) from profiles),'records',(select count(*) from records),
  'sections',(select count(distinct section) from records),'controlled',(select count(*) from records where controlled),'comments',(select count(*) from comments),
  'activity',(select count(*) from activity),'approvals',(select count(*) from approvals),'faq',(select count(*) from faq),'doc_pages',(select count(*) from doc_pages),
  'files',(select count(*) from storage.objects where bucket_id='files'),'records_md5',(select md5(string_agg(id::text||':'||title||':'||md5(data::text)||':'||controlled, ',' order by id)) from records where title like 'Rehearsal %' and section not in ('technical.bom','operations.quality','operations.procurement')),
  'existing_records',(select count(*) from records where title like 'Rehearsal %'),
  'auth_users',(select count(*) from auth.users),
  'profiles_md5',(select md5(string_agg(id::text||':'||role||':'||coalesce(title,'')||':'||coalesce(phone,'')||':'||us_person, ',' order by id)) from profiles))"; }
apply() { local t0; t0=$(ms); $PSQL -d "$1" -f "$2" >/dev/null 2>"$OUT/last.err" || { echo "FAILED: $2"; tail -5 "$OUT/last.err"; exit 1; }; echo "$2 $(( $(ms) - t0 )) ms"; }

echo "== 1. production baseline (schema … v17 + access.sql of main) =="
for f in schema.sql $(ls supabase | sed -n 's/^update-v\([0-9]*\)\.sql$/\1/p' | sort -n | awk '$1<=17{print "update-v"$1".sql"}'); do git show "origin/main:supabase/$f" > "$BASE/$f"; done
git show origin/main:supabase/access.sql > "$BASE/access.sql"
$PSQL -d postgres -c "drop database if exists ${DB}_restore" >/dev/null; $PSQL -d postgres -c "drop database if exists $DB" >/dev/null; $PSQL -d postgres -c "create database $DB" >/dev/null
sed "s/alter database postgres/alter database $DB/g" scripts/stack/bootstrap.sql | $PSQL -d $DB >/dev/null 2>&1
pg_dump -h 127.0.0.1 -p "$PORT" -U postgres -d postgres --schema-only -n auth -n storage -n realtime 2>/dev/null | grep -v "^CREATE SCHEMA" | psql -h 127.0.0.1 -p "$PORT" -U postgres -q -d $DB >/dev/null 2>&1 || true
$PSQL -d $DB -c "do \$\$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end \$\$" >/dev/null
$PSQL -d $DB -f scripts/stack/post-auth.sql >/dev/null
for f in schema.sql $(ls "$BASE" | sed -n 's/^update-v\([0-9]*\)\.sql$/\1/p' | sort -n | sed 's/.*/update-v&.sql/') access.sql; do $PSQL -d $DB -f "$BASE/$f" >/dev/null 2>"$OUT/last.err" || { echo "baseline FAILED $f"; tail -3 "$OUT/last.err"; exit 1; }; done
$PSQL -d $DB -f scripts/stack/post-migrate.sql >/dev/null
FP_A=$(fp $DB); echo "fingerprint v17: $FP_A"
[ -n "${PROD_FP:-}" ] && node -e '
const a=JSON.parse(process.argv[1]), b=JSON.parse(process.argv[2]); const keys=Object.keys(b).filter(k=>!k.startsWith("access"));
const diff=keys.filter(k=>String(a[k])!==String(b[k])); console.log(diff.length?"STRUCTURE DIFFERS from production in: "+diff.join(", "):"structure (tables, columns, functions, policies, triggers, indexes) IDENTICAL to production");' "$FP_A" "$PROD_FP"

echo "== 2. production-shaped synthetic content =="
$PSQL -d $DB -f scripts/p9/shape.sql >/dev/null
C_A=$(counts $DB); echo "counts v17: $C_A"

echo "== 3. backup, migrate v18 … v$LAST =="
t0=$(ms); pg_dump -h 127.0.0.1 -p "$PORT" -U postgres -d $DB -Fc -f "$OUT/before.dump"; echo "backup $(( $(ms) - t0 )) ms, $(stat -c %s "$OUT/before.dump") bytes, sha256 $(sha256sum "$OUT/before.dump" | cut -c1-16)"
for f in $(ls supabase | sed -n 's/^update-v\([0-9]*\)\.sql$/\1/p' | sort -n | awk '$1>=18{print "supabase/update-v"$1".sql"}'); do echo "  $(sha256sum "$f" | cut -c1-12) $(apply $DB "$f")"; done
FP_B=$(fp $DB); C_B=$(counts $DB); echo "fingerprint v$LAST: $FP_B"; echo "counts v$LAST: $C_B"
echo "  re-run: $(apply $DB supabase/update-v$LAST.sql) / $(apply $DB supabase/update-v$((LAST-1)).sql)"
[ "$(fp $DB)" = "$FP_B" ] && echo "  re-run leaves the structure unchanged" || echo "  RE-RUN CHANGED THE STRUCTURE"
$PSQL -d $DB -c "select json_build_object('workspace_db_version', public.workspace_db_version(), 'mfg_functions', (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'mfg\_%'))"

echo "== 4. full rollback v$LAST … v18 =="
t0=$(ms); for n in $(seq $LAST -1 18); do echo "  $(apply $DB supabase/rollback-v$n.sql)"; done; echo "rollback total $(( $(ms) - t0 )) ms"
FP_R=$(fp $DB); C_R=$(counts $DB); echo "fingerprint after rollback: $FP_R"; echo "counts after rollback: $C_R"
node -e 'const a=JSON.parse(process.argv[1]),b=JSON.parse(process.argv[2]);const d=Object.keys(a).filter(k=>String(a[k])!==String(b[k]));console.log(d.length?"after rollback differs from v17 in: "+d.map(k=>k+" "+a[k]+"→"+b[k]).join(", "):"after rollback: structure IDENTICAL to v17")' "$FP_A" "$FP_R"
node -e 'const a=JSON.parse(process.argv[1]),b=JSON.parse(process.argv[2]);const d=Object.keys(a).filter(k=>String(a[k])!==String(b[k]));console.log(d.length?"content differs from v17 in: "+d.join(", "):"content after rollback IDENTICAL to v17")' "$C_A" "$C_R"

echo "== 5. restore drill of the pre-migration backup =="
$PSQL -d postgres -c "create database ${DB}_restore" >/dev/null
t0=$(ms); pg_restore -h 127.0.0.1 -p "$PORT" -U postgres -d ${DB}_restore --no-owner "$OUT/before.dump" 2>"$OUT/restore.err" || true; echo "restore $(( $(ms) - t0 )) ms ($(grep -c 'error' "$OUT/restore.err" || true) restore warnings)"
C_RS=$(counts ${DB}_restore); FP_RS=$(fp ${DB}_restore)
[ "$C_RS" = "$C_A" ] && echo "restored content IDENTICAL to the backup source" || echo "RESTORED CONTENT DIFFERS: $C_RS"
[ "$FP_RS" = "$FP_A" ] && echo "restored structure IDENTICAL to the backup source" || echo "RESTORED STRUCTURE DIFFERS: $FP_RS"

COLQ="select table_schema||'.'||table_name||'.'||column_name from information_schema.columns where table_schema in ('public','storage','auth') order by 1"
LOST=$(comm -23 <($PSQL -d ${DB}_restore -c "$COLQ") <($PSQL -d $DB -c "$COLQ") | tr '\n' ' ')
[ -z "$LOST" ] && echo "after the full rollback every v17 column still exists (nothing the old application uses was dropped)" || echo "COLUMNS LOST BY THE ROLLBACK: $LOST"
echo "== 6. migrate again v18 … v$LAST =="
t0=$(ms); for f in $(ls supabase | sed -n 's/^update-v\([0-9]*\)\.sql$/\1/p' | sort -n | awk '$1>=18{print "supabase/update-v"$1".sql"}'); do apply $DB "$f" >/dev/null; done; echo "re-migration $(( $(ms) - t0 )) ms"
[ "$(fp $DB)" = "$FP_B" ] && echo "structure after re-migration IDENTICAL to the first migration" || echo "STRUCTURE AFTER RE-MIGRATION DIFFERS: $(fp $DB)"
C_B2=$(counts $DB); node -e 'const a=JSON.parse(process.argv[1]),b=JSON.parse(process.argv[2]);const d=Object.keys(a).filter(k=>String(a[k])!==String(b[k]));console.log(d.length?"content after re-migration differs in: "+d.join(", "):"content after re-migration IDENTICAL to the first migration")' "$C_B" "$C_B2"
echo "== stack database (all migrations incl. the current access.sql) for comparison =="
fp postgres
echo "== acceptance evidence =="
FP_RM=$(fp $DB)
node --input-type=module -e '
import { row, emit } from "./scripts/acceptance/evidence.mjs";
const [A,B,R,RS,B2,fa,fb,fr,frs,frm,last,started,lost]=process.argv.slice(1); const j=(x)=>JSON.parse(x);
const ca=j(A), cb=j(B), cr=j(R), crs=j(RS), cb2=j(B2);
const m={ source:"synthetic", source_db_version:17, target_db_version:Number(last), migration_files:"v18 … v"+last, source_fingerprint:fa, post_migration_fingerprint:fb,
  existing_records_identical: ca.records_md5===cb.records_md5, rollback_ok: ca.records_md5===cr.records_md5 && !lost.trim(), rollback_structure_identical: fr===fa, columns_lost_by_rollback: lost.trim() || null, restore_identical: crs.records_md5===ca.records_md5 && frs===fa,
  remigration_identical: frm===fb && cb2.records_md5===cb.records_md5, old_app_smoke: process.env.OLD_APP_SMOKE==="pass" ? true : null, new_app_smoke: process.env.NEW_APP_SMOKE==="pass" ? true : null,
  counts_before: ca, counts_after: cb };
const okData = m.existing_records_identical && m.rollback_ok && m.remigration_identical;
const r = await row("P9.MIGRATION.SYNTHETIC","local",{ status: okData ? (m.old_app_smoke && m.new_app_smoke ? "PASS" : "NOT VERIFIED") : "FAIL", source:"scripts/p9/rehearse.sh", source_ref:"rehearsal "+started, started_at:started,
  summary: (okData ? "data and structure identical through migrate, rollback and re-migration" : "DIFFERENCES found") + (m.old_app_smoke && m.new_app_smoke ? "" : "; application smoke tests not performed in this run"),
  blocker: okData ? null : "synthetic rehearsal found differences", metrics:m });
console.log("evidence: "+await emit(r,{dir:".stack/evidence"}));
' "$C_A" "$C_B" "$C_R" "$C_RS" "$C_B2" "$FP_A" "$FP_B" "$FP_R" "$FP_RS" "$FP_RM" "$LAST" "$STARTED" "$LOST"
