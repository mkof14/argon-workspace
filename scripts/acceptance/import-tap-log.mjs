// Turns the log of an integration run made before P9-R2 (TAP output of scripts/stack/integration.mjs) into an
// evidence row, so earlier runs appear in the test-run register. Counts are parsed from the log, never typed in;
// identity values the log does not contain are given explicitly and named as such in the row.
//   node scripts/acceptance/import-tap-log.mjs <log> --sha=<full sha> --app=2.42 --db=26 --started=<iso> --finished=<iso> --suites=29
import fs from "node:fs";
import crypto from "node:crypto";
const file = process.argv[2]; const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const log = fs.readFileSync(file, "utf8");
const n = (k) => { const m = log.match(new RegExp(`^# ${k} (\\d+)`, "m")); return m ? Number(m[1]) : null; };
const tests = n("tests"), passed = n("pass"), failed = n("fail"), skipped = n("skipped"), cancelled = n("cancelled"), todo = n("todo");
const fresh = /\[integration\] build/.test(log), exitOk = /^exit 0$/m.test(log);
const ok = exitOk && failed === 0 && tests > 0 && passed === tests;
const sha256 = crypto.createHash("sha256").update(log).digest("hex");
const row = { check_id: "P9.REG.FULL", status: ok ? "PASS" : "FAIL", environment: "local", app_version: arg("app"), git_sha: arg("sha"), db_version: Number(arg("db")), migration_hash: null,
  started_at: arg("started"), completed_at: arg("finished"), source: "scripts/stack/integration.mjs (log imported by scripts/acceptance/import-tap-log.mjs)", source_ref: `log ${file.split("/").pop()} sha256 ${sha256.slice(0, 16)}`,
  summary: `FULL CLEAN REGRESSION (imported log): ${passed}/${tests} passed, ${failed} failed, ${skipped} skipped`, blocker: ok ? null : "the log does not show a clean pass",
  metrics: { mode: fresh && !/SKIP_BUILD/.test(log) ? "full_clean" : "partial", scope: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"], env_recreated: true, reruns: 0, fresh_build: fresh, tests, passed, failed, skipped, cancelled, todo,
    suite_count: Number(arg("suites")) || null, duration_s: Math.round((Date.parse(arg("finished")) - Date.parse(arg("started"))) / 1000), log_sha256: sha256, imported: true,
    identity_source: "SHA, app and database version from the run's .sha file and the release at that commit; counts parsed from the log" } };
const out = file.replace(/\.log$/, ".evidence.json"); fs.writeFileSync(out, JSON.stringify(row, null, 1)); console.log(`${row.summary} → ${out}`);
