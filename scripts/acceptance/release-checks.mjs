// Release checks with recorded evidence (P9-R2): dependency audit (all and production-only), TypeScript, the
// production build and the unit tests — each one execution, bound to the Git SHA of the checkout.
//   node scripts/acceptance/release-checks.mjs            writes .stack/evidence/release-<run>.json
//   … --skip-build                                        (the build is then NOT RUN, not assumed)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { identity } from "./identity.mjs";
import { runId } from "./evidence.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const id = identity("local"); const RUN = runId("release", id.git_sha);
const EVD = path.join(ROOT, ".stack", "evidence"); fs.mkdirSync(EVD, { recursive: true });
const run = (cmd, args, env = {}) => { const t0 = new Date(); const r = spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 28 }); return { ...r, started: t0, finished: new Date() }; };
const rows = [];
const add = (check_id, status, r, metrics, summary, blocker = null) => rows.push({ check_id, status, environment: "local", app_version: id.app_version, git_sha: id.git_sha, db_version: id.db_version, migration_hash: id.migration_hash,
  started_at: r.started.toISOString(), completed_at: r.finished.toISOString(), source: "scripts/acceptance/release-checks.mjs", source_ref: `${RUN}:${check_id}`, summary, blocker: status === "PASS" ? null : blocker || summary, metrics: { ...metrics, dirty: id.dirty } });

// 1. dependency audit
const a = run("npm", ["audit", "--json"]), ap = run("npm", ["audit", "--omit=dev", "--json"]);
const vul = (x) => { try { return JSON.parse(x.stdout).metadata.vulnerabilities; } catch { return null; } };
const va = vul(a), vp = vul(ap);
add("P9.AUDIT", va && vp && va.total === 0 && vp.total === 0 ? "PASS" : "FAIL", a, { vulnerabilities: va, production_vulnerabilities: vp, tool: "npm audit" }, `npm audit: ${va?.total ?? "?"} (production ${vp?.total ?? "?"})`);
// 2. TypeScript
const t = run("npx", ["tsc", "--noEmit", "-p", "."]);
add("P9.TYPECHECK", t.status === 0 ? "PASS" : "FAIL", t, { exit_code: t.status, errors: (t.stdout.match(/error TS/g) || []).length }, t.status === 0 ? "tsc: no errors" : "tsc: errors");
// 3. production build (its own folder: the demo and stack builds are untouched)
if (!process.argv.includes("--skip-build")) {
  const b = run("npx", ["next", "build"], { NEXT_DIST_DIR: ".next-acceptance", NEXT_TELEMETRY_DISABLED: "1" });
  add("P9.BUILD", b.status === 0 ? "PASS" : "FAIL", b, { exit_code: b.status, compiled: /Compiled successfully/.test(b.stdout + b.stderr), dist: ".next-acceptance" }, b.status === 0 ? "next build: compiled successfully" : "next build failed");
}
// 4. unit tests
const counts = path.join(EVD, `${RUN}.unit.json`);
const u = run(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--import", "./scripts/guide/reg.mjs", "--test", "--test-reporter=tap", "--test-reporter-destination=stdout",
  "--test-reporter=./scripts/acceptance/reporter.mjs", `--test-reporter-destination=${counts}`, ...fs.readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".test.ts")).map((f) => `tests/${f}`)]);
let c = {}; try { c = JSON.parse(fs.readFileSync(counts, "utf8")); } catch {}
add("P9.UNIT", u.status === 0 && c.failed === 0 ? "PASS" : "FAIL", u, c, `unit: ${c.passed ?? "?"}/${c.tests ?? "?"} passed, ${c.failed ?? "?"} failed`);
fs.writeFileSync(path.join(EVD, `${RUN}.json`), JSON.stringify({ records: rows }, null, 1));
for (const r of rows) console.log(`${r.check_id.padEnd(14)} ${r.status.padEnd(5)} ${r.summary}`);
console.log(`evidence: .stack/evidence/${RUN}.json`);
process.exit(rows.every((r) => r.status === "PASS") ? 0 : 1);
