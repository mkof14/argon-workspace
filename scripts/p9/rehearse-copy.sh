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
# Steps (numbers as in the P9-R1 request): 2 fingerprint before · 3 backup (pg_dump) · 4 the exact v18 → v26 files ·
# 5 fingerprint after · 6 every pre-existing record compared by content hash · 7–8 start v2.42 against the copy and run
# the smoke (manual: a staging-style preview with the copy's URL/keys, then scripts/p9/smoke-ui.mjs or the §58
# checklist) · 9 rollback v26 → v18 · 10–11 v2.33 against the copy + smoke (same way) · 12 migrate again · 13 verify.
# Output: .staging/rehearsal-<ref>.log — counts and checksums only, no content.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "${COPY_AUTHORIZED:-}" = "yes" ] || { echo "Refused: COPY_AUTHORIZED=yes is required (Michael's written authorisation)."; exit 3; }
: "${COPY_DB_URL:?}" "${COPY_REF:?}" "${PRODUCTION_REF:?}"
case "$COPY_DB_URL" in *"$PRODUCTION_REF"*) echo "Refused: this is the production project."; exit 3;; esac
case "$COPY_DB_URL" in *"$COPY_REF"*) ;; *) echo "Refused: the database URL is not the rehearsal project $COPY_REF."; exit 3;; esac
mkdir -p .staging; LOG=".staging/rehearsal-$COPY_REF.log"; : > "$LOG"
PSQL=(psql "$COPY_DB_URL" -v ON_ERROR_STOP=1 -qtA)
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

say "== 2. before =="; "${PSQL[@]}" -c "select public.workspace_db_version()" >/dev/null 2>&1 && { say "Refused: this database is already at v26"; exit 3; } || true
say "fingerprint $(fp)"; say "counts $("${PSQL[@]}" -c "$COUNTS")"
"${PSQL[@]}" -c "drop table if exists public._p9_pre; create table public._p9_pre as select id from public.records; alter table public._p9_pre enable row level security" >/dev/null
H0=$("${PSQL[@]}" -c "$REC"); say "existing records hash $H0"
say "== 3. backup =="; t0=$(ms); pg_dump "$COPY_DB_URL" -Fc -n public -f ".staging/rehearsal-$COPY_REF.dump"; say "pg_dump $(( $(ms) - t0 )) ms, $(stat -c %s ".staging/rehearsal-$COPY_REF.dump") bytes"
say "== 4. migrate v18 … v26 (exact files) =="; t0=$(ms); for n in 18 19 20 21 22 23 24 25 26; do apply "supabase/update-v$n.sql"; done; say "total $(( $(ms) - t0 )) ms"
say "== 5. after =="; FP1=$(fp); say "fingerprint $FP1"; say "counts $("${PSQL[@]}" -c "$COUNTS")"
say "== 6. existing records =="; H1=$("${PSQL[@]}" -c "$REC"); [ "$H0" = "$H1" ] && say "existing records IDENTICAL ($H1)" || say "EXISTING RECORDS DIFFER: $H0 -> $H1"
"${PSQL[@]}" -f scripts/p9/dataquality.sql | sed 's/^/data quality /' | tee -a "$LOG" >/dev/null
read -r -p "7–8. Start v2.42 against the copy and run the smoke now; press Enter when it passed (Ctrl+C to stop) " _ || true
say "== 9. rollback v26 … v18 =="; t0=$(ms); for n in 26 25 24 23 22 21 20 19 18; do apply "supabase/rollback-v$n.sql"; done; say "rollback $(( $(ms) - t0 )) ms"
H2=$("${PSQL[@]}" -c "$REC"); [ "$H0" = "$H2" ] && say "existing records after rollback IDENTICAL" || say "EXISTING RECORDS DIFFER AFTER ROLLBACK"
read -r -p "10–11. Start v2.33 against the copy and run the smoke now; press Enter when it passed " _ || true
say "== 12. migrate again =="; for n in 18 19 20 21 22 23 24 25 26; do apply "supabase/update-v$n.sql"; done
say "== 13. verify =="; [ "$(fp)" = "$FP1" ] && say "structure IDENTICAL to the first migration" || say "STRUCTURE DIFFERS FROM THE FIRST MIGRATION"
H3=$("${PSQL[@]}" -c "$REC"); [ "$H0" = "$H3" ] && say "existing records IDENTICAL after the second migration" || say "EXISTING RECORDS DIFFER"
"${PSQL[@]}" -c "drop table if exists public._p9_pre" >/dev/null
say "done — log $LOG. Delete the copy project and the dump when the rehearsal is accepted."
