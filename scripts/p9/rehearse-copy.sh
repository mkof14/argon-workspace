#!/usr/bin/env bash
# P9-R1 R18 — migration and rollback rehearsal on an AUTHORISED, PROTECTED COPY of production. Never on production.
#
# Prerequisites (owner):
#   1. Michael authorises the copy in writing (who may access it, where it lives, when it is deleted).
#   2. Supabase Pro: restore the latest production backup into a NEW private project ("agron-workspace-rehearsal").
#   3. In a shell on a trusted machine (not committed anywhere):
#        COPY_AUTHORIZED=yes COPY_REF=<rehearsal project ref> PRODUCTION_REF=<production ref> \
#        COPY_DB_URL='postgresql://postgres.<rehearsal ref>:<password>@<pooler host>:5432/postgres' \
#        bash scripts/p9/rehearse-copy.sh
#
# Steps (numbers as in the P9-R1 request): 2 fingerprint before · 3 backup (pg_dump) · 4 the exact v18 → latest files ·
# 5 fingerprint after · 6 every pre-existing record compared by content hash · 7–8 start v2.42 against the copy and run
# the smoke (manual: a staging-style preview with the copy's URL/keys, then scripts/p9/smoke-ui.mjs or the §58
# checklist) · 9 rollback latest → v18 · 10–11 v2.33 against the copy + smoke (same way) · 12 migrate again · 13 verify.
# Output: .staging/rehearsal-<ref>.log — counts and checksums only, no content.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "${COPY_AUTHORIZED:-}" = "yes" ] || { echo "Refused: COPY_AUTHORIZED=yes is required (Michael's written authorisation)."; exit 3; }
: "${COPY_DB_URL:?}" "${COPY_REF:?}" "${PRODUCTION_REF:?}"
case "$COPY_DB_URL" in *"$PRODUCTION_REF"*) echo "Refused: this is the production project."; exit 3;; esac
case "$COPY_DB_URL" in *"$COPY_REF"*) ;; *) echo "Refused: the database URL is not the rehearsal project $COPY_REF."; exit 3;; esac
mkdir -p .staging; LOG=".staging/rehearsal-$COPY_REF.log"; : > "$LOG"
PSQL=(psql "$COPY_DB_URL" -v ON_ERROR_STOP=1 -qtA)
LAST=$(ls supabase | sed -n 's/^update-v\([0-9]*\)\.sql$/\1/p' | sort -n | tail -1); STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
say() { echo "$*" | tee -a "$LOG"; }
ms() { date +%s%3N; }
apply() { local t0; t0=$(ms); "${PSQL[@]}" -f "$1" >/dev/null 2>>"$LOG" || { say "FAILED: $1"; exit 1; }; say "  $(sha256sum "$1" | cut -c1-12) $1 $(( $(ms) - t0 )) ms"; }
fp() { "${PSQL[@]}" -f scripts/p9/fingerprint.sql; }
REC="select md5(string_agg(id::text || ':' || title || ':' || md5(data::text) || ':' || controlled, ',' order by id)) from records where id in (select id from _p9_pre)
     and section not in ('technical.bom', 'operations.quality', 'operations.procurement', 'operations.builds', 'operations.inventory')"
COUNTS="select json_object_agg(t, n) from (select 'users' t, count(*) n from auth.users union all select 'profiles', count(*) from profiles union all select 'records', count(*) from records
  union all select 'sections', count(distinct section) from records union all select 'files', count(*) from storage.objects where bucket_id = 'files' union all select 'comments', count(*) from comments
  union all select 'approvals', count(*) from approvals union all select 'activity', count(*) from activity union all select 'calendar_links', count(*) from gcal_links
  union all select 'calendar_feeds', count(*) from calendar_feeds union all select 'mail_outbox', count(*) from records where section = 'mail.outbox') x"

say "== 2. before =="; "${PSQL[@]}" -c "select public.workspace_db_version()" >/dev/null 2>&1 && { say "Refused: this database is already at v18 or later (has workspace_db_version)"; exit 3; } || true
FP0=$(fp)
say "fingerprint $(fp)"; say "counts $("${PSQL[@]}" -c "$COUNTS")"
"${PSQL[@]}" -c "drop table if exists public._p9_pre; create table public._p9_pre as select id from public.records; alter table public._p9_pre enable row level security" >/dev/null
H0=$("${PSQL[@]}" -c "$REC"); say "existing records hash $H0"
say "== 3. backup =="; t0=$(ms); pg_dump "$COPY_DB_URL" -Fc -n public -f ".staging/rehearsal-$COPY_REF.dump"; say "pg_dump $(( $(ms) - t0 )) ms, $(stat -c %s ".staging/rehearsal-$COPY_REF.dump") bytes"
say "== 4. migrate v18 … v$LAST (exact files) =="; t0=$(ms); for n in $(seq 18 $LAST); do apply "supabase/update-v$n.sql"; done; say "total $(( $(ms) - t0 )) ms"
say "== 5. after =="; FP1=$(fp); say "fingerprint $FP1"; say "counts $("${PSQL[@]}" -c "$COUNTS")"
say "== 6. existing records =="; H1=$("${PSQL[@]}" -c "$REC"); [ "$H0" = "$H1" ] && say "existing records IDENTICAL ($H1)" || say "EXISTING RECORDS DIFFER: $H0 -> $H1"
"${PSQL[@]}" -f scripts/p9/dataquality.sql | sed 's/^/data quality /' | tee -a "$LOG" >/dev/null
read -r -p "7–8. Start the new release against the copy and run the smoke; type pass or fail: " NEWSMOKE || true
say "== 9. rollback v$LAST … v18 =="; t0=$(ms); for n in $(seq $LAST -1 18); do apply "supabase/rollback-v$n.sql"; done; say "rollback $(( $(ms) - t0 )) ms"
H2=$("${PSQL[@]}" -c "$REC"); [ "$H0" = "$H2" ] && say "existing records after rollback IDENTICAL" || say "EXISTING RECORDS DIFFER AFTER ROLLBACK"
read -r -p "10–11. Start v2.33 against the copy and run the smoke; type pass or fail: " OLDSMOKE || true
say "== 12. migrate again =="; for n in $(seq 18 $LAST); do apply "supabase/update-v$n.sql"; done
say "== 13. verify =="; [ "$(fp)" = "$FP1" ] && say "structure IDENTICAL to the first migration" || say "STRUCTURE DIFFERS FROM THE FIRST MIGRATION"
H3=$("${PSQL[@]}" -c "$REC"); [ "$H0" = "$H3" ] && say "existing records IDENTICAL after the second migration" || say "EXISTING RECORDS DIFFER"
"${PSQL[@]}" -c "drop table if exists public._p9_pre" >/dev/null
# acceptance evidence (P9-R2): source "production_copy" — the only rehearsal that proves production-data compatibility
node --input-type=module -e '
import { row, emit } from "./scripts/acceptance/evidence.mjs";
const [h0,h1,h2,h3,fp0,fp1,last,started,newS,oldS,ref]=process.argv.slice(1);
const m={ source:"production_copy", copy_ref:ref, source_db_version:17, target_db_version:Number(last), migration_files:"v18 … v"+last, source_fingerprint:fp0, post_migration_fingerprint:fp1,
  existing_records_identical:h0===h1, rollback_ok:h0===h2, remigration_identical:h0===h3, new_app_smoke:newS==="pass", old_app_smoke:oldS==="pass", records_hash:h0 };
const ok = m.existing_records_identical && m.rollback_ok && m.remigration_identical && m.new_app_smoke && m.old_app_smoke;
const r = await row("P9.MIGRATION.PRODCOPY","production-copy",{ status: ok ? "PASS" : "FAIL", source:"scripts/p9/rehearse-copy.sh", source_ref:"prodcopy "+ref+" "+started, started_at:started,
  summary: ok ? "existing records identical through migrate, rollback and re-migration; both smoke tests passed" : "rehearsal did not pass every step", blocker: ok ? null : "see the rehearsal log", metrics:m });
console.log("evidence: "+await emit(r,{dir:".staging/evidence"}));
' "$H0" "$H1" "$H2" "$H3" "$FP0" "$FP1" "$LAST" "$STARTED" "${NEWSMOKE:-}" "${OLDSMOKE:-}" "$COPY_REF" | tee -a "$LOG"
say "done — log $LOG. Delete the copy project and the dump when the rehearsal is accepted."
