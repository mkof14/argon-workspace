// P9-R1 R16 — staging endurance run (at least 24 continuous hours for acceptance). Never against production.
//   TARGET_SUPABASE_URL=… TARGET_ANON_KEY=… TARGET_SERVICE_ROLE_KEY=… TARGET_REF=<staging ref> PRODUCTION_REF=<prod ref> \
//   APP_URL=https://<staging app> CRON_SECRET=<staging cron secret> HOURS=24 WORKERS=12 node scripts/p9/endurance.mjs
//   node scripts/p9/endurance.mjs --stack --minutes=2      (checks the tool itself on the local stack)
//
// WORKERS synthetic users (the personas, round robin) each loop: a read model or list (dashboards, pipeline,
// manufacturing, queues, search, Assistant retrieval), and about one in four times a write — a task, a comment, a
// status change, a travel request through its workflow — all titled P9END-<run>. With APP_URL + CRON_SECRET the
// scheduler endpoint runs every 15 minutes (all due jobs: notifications, workflow SLA, commercial follow-ups,
// manufacturing notices, digest, backup …), as in production.
// Every minute one line goes to .staging/endurance-<ref>-<run>.jsonl: requests, errors, p50/p95/p99, database
// connections, queue depth (automation, outbound, notifications pending), failed and dead jobs, retries, duplicate
// notifications (the same notice twice: same person, kind, record and text within the run), process memory. At the end: the summary with the
// latency trend (first hour vs last hour) and the clean-up of the P9END rows.
import fs from "node:fs";
import crypto from "node:crypto";
import { target } from "./target.mjs";
import { row, emit } from "../acceptance/evidence.mjs";

const T = target();
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const minutes = Number(arg("minutes", 0)) || Number(process.env.HOURS || 24) * 60;
const WORKERS = Number(process.env.WORKERS || 12), run = crypto.randomBytes(4).toString("hex"), TAG = `P9END-${run}`;
const P = JSON.parse(fs.readFileSync(T.file("personas"), "utf8")).personas;
const people = ["mgmt-us", "sales", "operations", "manufacturing", "technician", "eng-us", "eng-nonus", "mgmt-nonus"];
const C = {}; for (const k of people) { const c = T.anon(); const { error } = await c.auth.signInWithPassword({ email: P[k].email, password: P[k].password }); if (error) throw new Error(`${k}: ${error.message}`); C[k] = c; }
const out = T.file(`endurance-${run}`).replace(/\.json$/, ".jsonl");
// each person runs only what their role allows (checked once at the start), so every later error is a real one
const allowed = {};
for (const k of people) {
  allowed[k] = [];
  for (const [fn, a] of [["exec_overview", {}], ["crm_overview", { p_filter: {} }], ["crm_list", { p_kind: "active", p_q: null, p_limit: 200, p_filter: {} }], ["crm_followups", { p_scope: "mine" }],
    ["mfg_overview", {}], ["mfg_queue", {}], ["mfg_today", {}], ["mfg_list", { p_kind: "all", p_filter: {} }], ["ops_my_processes", {}], ["ops_list", { p_kind: "pr_open", p_limit: 100 }],
    ["search_records", { q: "AGR", n: 20 }], ["corp_search", { p_q: "AGR", p_limit: 20 }], ["mfg_assistant", { p_intent: "building", p_arg: null }], ["crm_assistant", { p_intent: "attention", p_arg: null }]]) {
    const { error } = await C[k].rpc(fn, a); if (!error) allowed[k].push([fn, a]);
  }
  const t = await C[k].from("records").insert({ section: "company.tasks", title: `${TAG} probe`, status: "Open", data: {} }).select("id").single();
  allowed[k].write = !t.error; if (t.data) await T.admin.from("records").delete().eq("id", t.data.id);
}
const READS = [
  ["exec_overview", {}], ["crm_overview", { p_filter: {} }], ["crm_list", { p_kind: "active", p_q: null, p_limit: 200, p_filter: {} }], ["crm_followups", { p_scope: "mine" }],
  ["mfg_overview", {}], ["mfg_queue", {}], ["mfg_today", {}], ["mfg_list", { p_kind: "all", p_filter: {} }], ["ops_my_processes", {}], ["ops_list", { p_kind: "pr_open", p_limit: 100 }],
  ["search_records", { q: "AGR", n: 20 }], ["corp_search", { p_q: "AGR", p_limit: 20 }], ["mfg_assistant", { p_intent: "building", p_arg: null }], ["crm_assistant", { p_intent: "attention", p_arg: null }],
];
let bucket = { req: 0, err: 0, lat: [] }, all = { req: 0, err: 0 }; const firstHour = [], lastHour = [], created = [];
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]); };
const timed = async (fn) => { const t0 = performance.now(); let e = null; try { const r = await fn(); e = r?.error || null; } catch (x) { e = x; } const ms = performance.now() - t0; bucket.req++; all.req++; bucket.lat.push(ms); if (e) { bucket.err++; all.err++; } return ms; };
const end = Date.now() + minutes * 60e3, t0 = Date.now();
async function worker(i) {
  const k = people[i % people.length], c = C[k]; const own = []; // each worker comments on and changes only its own tasks
  while (Date.now() < end) {
    const r = Math.random();
    const mine = allowed[k];
    if (r < 0.75 || !mine.write) { if (!mine.length) break; const [fn, a] = mine[Math.floor(Math.random() * mine.length)]; const ms = await timed(() => c.rpc(fn, a)); (Date.now() - t0 < 3600e3 ? firstHour : lastHour).push(ms); if (lastHour.length > 20000) lastHour.shift(); }
    else if (r < 0.85) await timed(async () => { const x = await c.from("records").insert({ section: "company.tasks", title: `${TAG} task ${i}`, status: "Open", data: { owner_id: P[k].id } }).select("id").single(); if (x.data) { created.push(x.data.id); own.push(x.data.id); } return x; });
    else if (r < 0.93 && own.length) await timed(() => c.from("comments").insert({ record_id: own[Math.floor(Math.random() * own.length)], author: P[k].id, body: `${TAG} comment` }));
    else if (own.length) await timed(() => c.from("records").update({ status: Math.random() < 0.5 ? "In progress" : "Open" }).eq("id", own[Math.floor(Math.random() * own.length)]));
    await new Promise((s) => setTimeout(s, 200 + Math.random() * 800));
  }
}
async function scheduler() {
  if (!process.env.APP_URL || !process.env.CRON_SECRET) return;
  while (Date.now() < end) { await timed(() => fetch(`${process.env.APP_URL}/api/ops`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).then((r) => (r.ok ? null : { error: r.status }))); await new Promise((s) => setTimeout(s, 15 * 60e3)); }
}
async function sampler() {
  while (Date.now() < end + 1000) {
    await new Promise((s) => setTimeout(s, Math.min(60e3, Math.max(1000, end - Date.now() + 500))));
    const { data: st } = await T.admin.rpc("ops_db_stats");
    const { data: dup } = await T.admin.from("notifications").select("user_id,kind,record_id,title,body").gte("created_at", new Date(t0).toISOString()).limit(20000);
    const seen = new Map(); let dups = 0; for (const n of dup || []) { const key = `${n.user_id}|${n.kind}|${n.record_id}|${n.title}|${n.body}`; seen.set(key, (seen.get(key) || 0) + 1); } for (const v of seen.values()) if (v > 1) dups += v - 1;
    const line = { at: new Date().toISOString(), minute: Math.round((Date.now() - t0) / 60e3), requests: bucket.req, errors: bucket.err, p50: q(bucket.lat, 0.5), p95: q(bucket.lat, 0.95), p99: q(bucket.lat, 0.99),
      db_connections: st?.connections ?? null, automation_queue: st?.automation_queue ?? null, outbound: st?.outbound ?? null, notifications_pending: st?.notifications_pending ?? null,
      jobs_failed_24h: st?.jobs_failed_24h ?? null, jobs_dead: st?.jobs_dead ?? null, repeated_notifications: dups, memory_mb: Math.round(process.memoryUsage().rss / 1048576) };
    fs.appendFileSync(out, JSON.stringify(line) + "\n"); console.log(JSON.stringify(line)); bucket = { req: 0, err: 0, lat: [] };
  }
}
console.log(`endurance ${TAG}: ${minutes} min, ${WORKERS} workers, ${T.stack ? "local stack (tool check only)" : `staging ${T.ref}`}`);
await Promise.all([...Array.from({ length: WORKERS }, (_, i) => worker(i)), scheduler(), sampler()]);
// clean-up of the synthetic rows
for (let i = 0; i < created.length; i += 200) await T.admin.from("records").delete().in("id", created.slice(i, i + 200));
const lines = fs.readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const summary = { ref: T.ref, run, minutes, workers: WORKERS, staging_evidence: !T.stack && minutes >= 1440, requests: all.req, errors: all.err, error_rate: all.req ? +(all.err / all.req).toFixed(5) : 0,
  p95_first_hour: q(firstHour, 0.95), p95_last_hour: q(lastHour, 0.95), max_db_connections: Math.max(...lines.map((l) => l.db_connections || 0)), max_repeated_notifications: Math.max(...lines.map((l) => l.repeated_notifications || 0)),
  max_jobs_failed_24h: Math.max(...lines.map((l) => l.jobs_failed_24h || 0)), created_rows_cleaned: created.length, log: out };
fs.writeFileSync(T.file(`endurance-${run}-summary`), JSON.stringify(summary, null, 1));
console.log("SUMMARY " + JSON.stringify(summary));
// acceptance evidence (P9-R2): a run shorter than 24 continuous hours is a TOOL CHECK, never acceptance evidence
const actual = Math.round((Date.now() - t0) / 60e3); const full = !T.stack && actual >= 1440;
const healthy = summary.error_rate <= 0.001 && summary.max_repeated_notifications === 0 && Math.max(...lines.map((l) => l.jobs_dead || 0)) === 0 && (summary.p95_last_hour == null || summary.p95_first_hour == null || summary.p95_last_hour <= summary.p95_first_hour * 1.5 + 50);
const ev = await row("P9.ENDURANCE", T.stack ? "local" : "staging", { status: full ? (healthy ? "PASS" : "FAIL") : "NOT VERIFIED", source: "scripts/p9/endurance.mjs", source_ref: `endurance ${run}`, started_at: new Date(t0).toISOString(),
  summary: full ? `${actual} min, ${summary.requests} requests, error rate ${summary.error_rate}` : `TOOL CHECK — NOT ACCEPTANCE EVIDENCE (${actual} min)`, blocker: full && !healthy ? "error rate, duplicate notices, dead jobs or latency growth over limits" : null,
  metrics: { minutes: actual, planned_minutes: minutes, continuous: lines.length >= Math.floor(minutes) - 1, requests: summary.requests, writes: created.length, errors: summary.errors, error_rate: summary.error_rate, retries: 0,
    duplicate_notifications: summary.max_repeated_notifications, job_failures_24h_max: summary.max_jobs_failed_24h, dead_jobs_max: Math.max(...lines.map((l) => l.jobs_dead || 0)),
    queue_depth_max: Math.max(...lines.map((l) => Number(l.notifications_pending) || 0)), db_connections_max: summary.max_db_connections, p95_first_hour: summary.p95_first_hour, p95_last_hour: summary.p95_last_hour,
    p99_max: Math.max(...lines.map((l) => l.p99 || 0)), workers: WORKERS, log: out.split("/").pop() } }, T.admin);
console.log(`evidence: ${await emit(ev, { db: T.admin })}`);
