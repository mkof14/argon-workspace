// P9-R1 R17 — production-grade performance on STAGING (the same critical P5–P8 paths as the local suites).
//   TARGET_SUPABASE_URL=… TARGET_ANON_KEY=… TARGET_SERVICE_ROLE_KEY=… TARGET_REF=<staging ref> PRODUCTION_REF=<prod ref> \
//   [APP_URL=https://<staging app>] [RUNS=20] node scripts/p9/staging-perf.mjs
//   node scripts/p9/staging-perf.mjs --stack   (checks the tool on the local stack — NOT staging evidence)
// Each path is called RUNS times as the persona who uses it (after 2 warm-up calls); p50/p95/p99 in ms from the
// caller's side (network + database), against the targets: common p95 < 1 s, heavy p95 < 3 s. The data volume found
// on the target is recorded with the result, because a timing means nothing without it.
import fs from "node:fs";
import { target } from "./target.mjs";
import { row, emit } from "../acceptance/evidence.mjs";

const T = target(); const RUNS = Number(process.env.RUNS || 20);
const P = JSON.parse(fs.readFileSync(T.file("personas"), "utf8")).personas;
const C = {};
for (const k of ["owner-us", "mgmt-us", "sales", "eng-us", "manufacturing", "technician"]) { const c = T.anon(); const { error } = await c.auth.signInWithPassword({ email: P[k].email, password: P[k].password }); if (error) throw new Error(`${k}: ${error.message}`); C[k] = c; }
const first = async (c, fn, args, pick) => { const { data } = await c.rpc(fn, args); return pick(data); };
const opp = await first(C["mgmt-us"], "crm_list", { p_kind: "active", p_q: null, p_limit: 1, p_filter: {} }, (d) => (d?.rows || d?.items || d || [])[0]?.id || null).catch(() => null);
const units = await first(C["manufacturing"], "mfg_list", { p_kind: "all", p_filter: {} }, (d) => (d?.rows || []).map((r) => r.id)).catch(() => []);

const PATHS = [
  ["Today (my processes)", "sales", "ops_my_processes", {}, "common"],
  ["Today (shop floor)", "technician", "mfg_today", {}, "common"],
  ["Executive Control", "mgmt-us", "exec_overview", {}, "common"],
  ["Corporate search", "sales", "corp_search", { p_q: "AGR", p_limit: 20 }, "common"],
  ["Documents", "eng-us", "document_center", {}, "common"],
  ["Workflow dashboard", "mgmt-us", "ops_list", { p_kind: "pr_open", p_limit: 200 }, "common"],
  ["Commercial dashboard", "mgmt-us", "crm_overview", { p_filter: {} }, "common"],
  ["Opportunity", "mgmt-us", "crm_opp", { p_id: opp }, "common", !opp],
  ["Pipeline", "mgmt-us", "crm_list", { p_kind: "active", p_q: null, p_limit: 200, p_filter: {} }, "common"],
  ["Manufacturing dashboard", "manufacturing", "mfg_overview", {}, "common"],
  ["Build Unit", "manufacturing", "mfg_unit_view", { p_unit: units[0] }, "common", !units.length],
  ["Material plan (100 units)", "manufacturing", "mfg_material_plan", { p_scope: { units: units.slice(0, 100) } }, "heavy", !units.length],
  ["Weekly Review (manufacturing)", "mgmt-us", "mfg_weekly", { p_from: null, p_to: null }, "heavy"],
  ["Weekly Review (commercial)", "mgmt-us", "crm_weekly", { p_from: null, p_to: null }, "heavy"],
  ["Weekly Review (processes)", "mgmt-us", "ops_weekly", {}, "heavy"],
  ["Assistant retrieval (manufacturing)", "manufacturing", "mfg_assistant", { p_intent: "building", p_arg: null }, "common"],
  ["Assistant retrieval (commercial)", "sales", "crm_assistant", { p_intent: "attention", p_arg: null }, "common"],
];
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]); };
const rows = [];
for (const [name, who, fn, args, cls, skip] of PATHS) {
  if (skip) { rows.push({ name, fn, cls, skipped: "no data of this kind on the target" }); continue; }
  const c = C[who]; const t = []; let errors = 0;
  for (let i = 0; i < RUNS + 2; i++) { const t0 = performance.now(); const { error } = await c.rpc(fn, args); const ms = performance.now() - t0; if (error) errors++; if (i >= 2) t.push(ms); }
  const p95 = q(t, 0.95), limit = cls === "heavy" ? 3000 : 1000;
  rows.push({ name, fn, who, cls, runs: RUNS, p50: q(t, 0.5), p95, p99: q(t, 0.99), errors, target_ms: limit, pass: errors === 0 && p95 < limit });
  console.log(`${(p95 < limit && !errors ? "PASS" : "FAIL").padEnd(5)} ${name.padEnd(38)} p50 ${String(q(t, 0.5)).padStart(5)}  p95 ${String(p95).padStart(5)}  p99 ${String(q(t, 0.99)).padStart(5)} ms  (< ${limit})${errors ? `  ${errors} errors` : ""}`);
}
if (process.env.APP_URL) { const t = []; for (let i = 0; i < RUNS; i++) { const t0 = performance.now(); await fetch(`${process.env.APP_URL}/api/health`).catch(() => null); t.push(performance.now() - t0); } rows.push({ name: "Application health (end to end)", p50: q(t, 0.5), p95: q(t, 0.95), p99: q(t, 0.99), target_ms: 1000, pass: q(t, 0.95) < 1000 }); }
const vol = {}; for (const s of ["sales.pipeline", "company.parties", "technical.items", "technical.boms", "operations.builds", "operations.work_orders", "company.documents", "operations.requests"]) { const { count } = await T.admin.from("records").select("id", { count: "exact", head: true }).eq("section", s); vol[s] = count; }
for (const t of ["mfg_bom_lines", "mfg_stock", "mfg_serials", "wf_instances", "approvals", "comments"]) { const { count } = await T.admin.from(t).select("*", { count: "exact", head: true }); vol[t] = count; }
const report = { ref: T.ref, at: new Date().toISOString(), staging_evidence: !T.stack, volume: vol, rows, pass: rows.every((r) => r.skipped || r.pass) };
fs.writeFileSync(T.file("perf"), JSON.stringify(report, null, 1));
// acceptance evidence (P9-R2): tier "local" never satisfies the production-grade gate
const ev = await row("P9.PERF.STAGING", T.stack ? "local" : "staging", { status: report.pass ? "PASS" : "FAIL", source: "scripts/p9/staging-perf.mjs", source_ref: `perf ${report.at}`,
  summary: `${rows.filter((r) => r.pass).length}/${rows.filter((r) => !r.skipped).length} paths within target${T.stack ? " — LOCAL PERFORMANCE" : ""}`, blocker: report.pass ? null : rows.filter((r) => !r.skipped && !r.pass).map((r) => r.name).join(", "),
  metrics: { tier: T.stack ? "local" : "staging", runs_per_path: RUNS, concurrency: 1, dataset: vol, rows: rows.map((r) => ({ path: r.name, rpc: r.fn, persona: r.who, class: r.cls, samples: r.runs, p50: r.p50, p95: r.p95, p99: r.p99, errors: r.errors, threshold_ms: r.target_ms, pass: r.pass, skipped: r.skipped })) } }, T.admin);
console.log(`evidence: ${await emit(ev, { db: T.admin })}`);
console.log(`${report.pass ? "PASS" : "FAIL"} — volume ${JSON.stringify(vol)}; report .staging/perf-${T.ref}.json${T.stack ? " (local stack: NOT staging evidence)" : ""}`);
process.exit(report.pass ? 0 : 1);
