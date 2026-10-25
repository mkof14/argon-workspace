// Full integration run on the isolated stack: start the stack, build the app against it (into .next-stack, so the
// normal build is untouched), start it on 127.0.0.1:3125, run every suite in tests/integration, stop everything.
//
//   node scripts/stack/integration.mjs            all suites
//   node scripts/stack/integration.mjs rls e2e    only these (file name without .test.ts)
//   SKIP_BUILD=1 …                                reuse an existing .next-stack build
//   RERUN_OF=<run id> …                           marks the run as an isolated rerun of an earlier run
//
// Every run leaves its acceptance evidence (P9-R2) in .stack/evidence/: run id, Git SHA (and whether the checkout had
// uncommitted changes), app and database version, migration set, start/finish, suites, tests, passed/failed/skipped,
// reruns, whether the environment was recreated — and the class: FULL CLEAN REGRESSION only for all suites, a fresh
// stack, a fresh build and no rerun; otherwise PARTIAL TEST or ISOLATED RERUN, which never satisfy the final gate.
// `node scripts/acceptance/record.mjs <file>` records it into an environment's evidence store.
//
// Synthetic data only. Browser tests need Chromium (PW_CHROMIUM or Playwright's own); without the app they skip.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { up, down, ENV, sql } from "./stack.mjs";
import { identity } from "../acceptance/identity.mjs";
import { runId } from "../acceptance/evidence.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const PORT = 3125, APP = `http://127.0.0.1:${PORT}`;
const only = process.argv.slice(2);
const suites = fs.readdirSync(path.join(ROOT, "tests/integration")).filter((f) => f.endsWith(".test.ts")).filter((f) => !only.length || only.includes(f.replace(/\.test\.ts$/, ""))).map((f) => `tests/integration/${f}`);
const log = (...a) => console.error("[integration]", ...a);
const env = { ...process.env, ...ENV, NEXT_DIST_DIR: ".next-stack", NEXT_TELEMETRY_DISABLED: "1" };
let app, app2;
const PORT2 = 3126, APP2 = `http://127.0.0.1:${PORT2}`, MODEL = "http://127.0.0.1:54391";
const stop = () => { for (const a of [app, app2]) try { if (a?.pid) process.kill(-a.pid, "SIGTERM"); } catch {} down(); }; // the whole group: npx, next and its server
process.on("SIGINT", () => { stop(); process.exit(130); });

const started = new Date(); const ident = identity("local"); const RUN = runId("reg", ident.git_sha);
const mode = process.env.RERUN_OF ? "isolated_rerun" : only.length || process.env.SKIP_BUILD ? "partial" : "full_clean";
const EVD = path.join(ROOT, ".stack", "evidence"); fs.mkdirSync(EVD, { recursive: true }); const counts = path.join(EVD, `${RUN}.tests.json`);
function evidence(status, extra = {}) {
  let c = {}; try { c = JSON.parse(fs.readFileSync(counts, "utf8")); } catch {}
  let dbv = null; try { dbv = Number(sql("select public.workspace_db_version()").trim()) || null; } catch {}
  const finished = new Date();
  const m = { mode, scope: mode === "full_clean" ? ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P9-R2", "P10-1INOW"] : only, suites_run: suites.map((f) => path.basename(f, ".test.ts")),
    env_recreated: true, reruns: 0, rerun_of: process.env.RERUN_OF || null, fresh_build: !process.env.SKIP_BUILD, dirty: ident.dirty, duration_s: Math.round((finished - started) / 1000), ...c, ...extra };
  const ok = status === "PASS";
  const row = { check_id: "P9.REG.FULL", status, environment: "local", app_version: ident.app_version, git_sha: ident.git_sha, db_version: dbv, migration_hash: ident.migration_hash,
    started_at: started.toISOString(), completed_at: finished.toISOString(), source: "scripts/stack/integration.mjs", source_ref: RUN,
    summary: `${mode === "full_clean" ? "FULL CLEAN REGRESSION" : mode === "isolated_rerun" ? "ISOLATED RERUN" : "PARTIAL TEST"}: ${m.passed ?? "?"}/${m.tests ?? "?"} passed, ${m.failed ?? "?"} failed, ${m.skipped ?? "?"} skipped`,
    blocker: ok ? null : `${m.failed ?? "?"} failed${extra.error ? ` — ${extra.error}` : ""}`, metrics: m };
  fs.writeFileSync(path.join(EVD, `${RUN}.json`), JSON.stringify(row, null, 1));
  log(`evidence: .stack/evidence/${RUN}.json — ${row.summary}`);
}
try {
  await up();
  const needApp = suites.some((s) => /\/(api|e2e|docapi|e2e4|p4accept|p5|e2e5|e2e6|e2e7|e2e8|p9|p9r2|p10|p10sec|p10act|p10perf)\.test\.ts$/.test(s));
  if (needApp) {
    if (!process.env.SKIP_BUILD) { log("build"); const b = spawnSync("npx", ["next", "build"], { cwd: ROOT, env, stdio: "inherit" }); if (b.status) throw new Error("build failed"); }
    try { await fetch(APP); throw new Error(`port ${PORT} is already in use — stop the old app first`); } catch (e) { if (/already in use/.test(e.message)) throw e; }
    const out = fs.openSync(path.join(ROOT, ".stack", "app.log"), "w");
    app = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", out, out], detached: true });
    const t = Date.now(); while (Date.now() - t < 60000) { try { if ((await fetch(`${APP}/api/health`)).status < 500) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    log("app:", APP);
    // the Assistant acceptance test needs the app with a model configured: a second instance of the same build whose
    // model endpoint is a deterministic stand-in run by the test (it records what reaches the model); never a real key
    if (suites.some((s) => s.endsWith("/p4accept.test.ts"))) {
      const out2 = fs.openSync(path.join(ROOT, ".stack", "app2.log"), "w");
      app2 = spawn("npx", ["next", "start", "-p", String(PORT2), "-H", "127.0.0.1"], { cwd: ROOT, env: { ...env, ANTHROPIC_API_KEY: "stack-standin-not-a-key", ANTHROPIC_BASE_URL: MODEL }, stdio: ["ignore", out2, out2], detached: true });
      const t2 = Date.now(); while (Date.now() - t2 < 60000) { try { if ((await fetch(`${APP2}/api/health`)).status < 500) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
      log("app with model stand-in:", APP2);
    }
  }
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--import", "./scripts/guide/reg.mjs", "--test", "--test-concurrency=1",
    "--test-reporter=tap", "--test-reporter-destination=stdout", "--test-reporter=./scripts/acceptance/reporter.mjs", `--test-reporter-destination=${counts}`, ...suites],
    { cwd: ROOT, env: { ...env, STACK_APP_URL: needApp ? APP : "", STACK_AI_APP_URL: app2 ? APP2 : "", STACK_MODEL_PORT: "54391", ACCEPTANCE_RUN: RUN, ACCEPTANCE_EVD: EVD }, stdio: "inherit" });
  evidence(r.status === 0 ? "PASS" : "FAIL");
  stop(); process.exit(r.status ?? 1);
} catch (e) { log("failed:", e.message); try { evidence("FAIL", { error: e.message }); } catch {} stop(); process.exit(1); }
