#!/usr/bin/env bash
# Phase 9 (B52 steps 5–9) on the isolated stack: roll the stack database back v26 … v18, build and start the CURRENT
# PRODUCTION application (origin/main, v2.33) against it, sign in and open the main screens, then migrate v18 … v26
# again and check the new build signs in too. Synthetic data only; never production.
#   bash scripts/p9/oldapp.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd); export PGPASSWORD=postgres
PSQL="psql -h 127.0.0.1 -p ${STACK_PG_PORT:-54329} -U postgres -v ON_ERROR_STOP=1 -qtA -d postgres"
ms() { date +%s%3N; }
OLD=/home/claude/agron-main
envs() { node -e 'const e=require(process.argv[1]);for(const[k,v] of Object.entries(e))console.log(`${k}=${String(v).replace(/ /g,"_")}`)' "$ROOT/.stack/env.json"; }

echo "== rollback the stack database v26 … v18 =="
if [ -z "${SKIP_ROLLBACK:-}" ]; then t0=$(ms); for n in 26 25 24 23 22 21 20 19 18; do $PSQL -f supabase/rollback-v$n.sql >/dev/null; done; echo "rollback $(( $(ms) - t0 )) ms"; else echo "skipped (database already rolled back)"; fi

echo "== a synthetic owner for the sign-in =="
node --input-type=module -e '
import { createClient } from "@supabase/supabase-js"; import fs from "node:fs";
const e = JSON.parse(fs.readFileSync(".stack/env.json", "utf8"));
const a = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = "rollback-owner@agron-stack.test";
const { error } = await a.auth.admin.createUser({ email, password: "Stack-Test-Password-1!", email_confirm: true, user_metadata: { full_name: "Rollback Owner" } });
if (error && !/already/i.test(error.message)) { console.error(error.message); process.exit(1); }
console.log("user ready");'
$PSQL -c "update public.profiles set role = 'owner', us_person = true where email = 'rollback-owner@agron-stack.test'" >/dev/null

echo "== build and start v2.33 (origin/main) =="
git worktree remove --force "$OLD" >/dev/null 2>&1 || true
git worktree add --detach "$OLD" origin/main >/dev/null 2>&1
ln -sfn "$ROOT/node_modules" "$OLD/node_modules"
# test harness only: v2.33's content security policy allows only *.supabase.co, so the browser could not reach the local
# stack; the worktree copy allows the stack origin too (no application code is changed)
STACK_URL=$(node -e 'console.log(require(process.argv[1]).NEXT_PUBLIC_SUPABASE_URL)' "$ROOT/.stack/env.json")
sed -i "s#connect-src 'self' \${supabase}#connect-src 'self' $STACK_URL \${supabase}#; s#img-src 'self' data: blob:#img-src 'self' data: blob: $STACK_URL#; s#\"upgrade-insecure-requests\",##; s#  \"upgrade-insecure-requests\"##" "$OLD/next.config.mjs"
grep -c "$STACK_URL" "$OLD/next.config.mjs" >/dev/null || { echo "CSP patch failed"; exit 1; }
( cd "$OLD" && grep -o 'VERSION = "[^"]*"' src/components/App.tsx && export $(envs | xargs) NEXT_DIST_DIR=.next-old NEXT_TELEMETRY_DISABLED=1 && npx next build > "$ROOT/.stack/oldapp-build.log" 2>&1 ) || { tail -20 .stack/oldapp-build.log; exit 1; }
fuser -k 3126/tcp >/dev/null 2>&1 || true
( cd "$OLD" && export $(envs | xargs) NEXT_DIST_DIR=.next-old && setsid npx next start -p 3126 -H 127.0.0.1 > "$ROOT/.stack/oldapp.log" 2>&1 < /dev/null & )
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:3126/login && break; sleep 1; done
APP=http://127.0.0.1:3126 node scripts/p9/smoke-ui.mjs rollback-owner@agron-stack.test v2.33 || echo "OLD APPLICATION SMOKE FAILED"

fuser -k 3126/tcp >/dev/null 2>&1 || true
echo "== migrate the stack database again v18 … v26 =="
t0=$(ms); for n in 18 19 20 21 22 23 24 25 26; do $PSQL -f supabase/update-v$n.sql >/dev/null; done; echo "re-migration $(( $(ms) - t0 )) ms"
$PSQL -c "select 'workspace_db_version=' || public.workspace_db_version()"
git worktree remove --force "$OLD" >/dev/null 2>&1 || true
