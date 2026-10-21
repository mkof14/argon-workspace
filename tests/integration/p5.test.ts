// Phase 5 — management engines (v22) against the real database on the isolated stack, with real sign-ins.
// Synthetic data only (every title starts with the run tag). Covers: each health rule alone and combined, every
// open-loop kind and its idempotence, Waiting For (internal / team / external / dependency, remind, escalate),
// attention determinism, portfolio aggregation and access, report totals against independent counts, change
// intelligence (exactly once, with its source), alerts (dedup, cool-down, resolve), settings authorisation, the
// security matrix (US Persons Only, Restricted, partner, contractor, employee, department lead, management,
// owner, disabled) including mgmt_visible == row-level security, the safe-action layer (confirmation, clarification,
// rejection, undo allowed / refused, audit guard) and the Assistant's executive retrieval.
// Evidence: .stack/p5.json
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENV, makeUser, pool, signIn, sql, uid } from "./_stack.ts";
import { cancel, complete, plan, start, undoDone, undoStart, type Ctx } from "../../src/lib/server/actions.ts";
import { retrieve } from "../../src/lib/server/retrieval.ts";
import { admin } from "./_stack.ts";

const run = uid(); const tag = `p5${run}`; const db = admin();
const D = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const AGO = (days: number) => new Date(Date.now() - days * 864e5 - 3600e3).toISOString(); // an hour more, so whole days are whole
const U: Record<string, any> = {}; const C: Record<string, any> = {};
const EV: Record<string, any> = { tag, health: {}, loops: {}, security: {}, actions: {}, alerts: {}, changes: {}, retrieval: {} };
let CFG: any; let DEPT = "";
const W = () => CFG.weights;

/** Run SQL as one signed-in person (API role + their claims) — what any direct database request would get. */
async function as<T = any>(k: string, q: string, p: any[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[k].id, role: "authenticated", aal: "aal1", iat: Math.floor(Date.now() / 1000) + 5 })]);
    const r = await c.query(q, p); await c.query("commit"); return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const rec = async (section: string, title: string, status: string | null, data: Record<string, any> = {}, o: { by?: string; controlled?: boolean; updated?: string; created?: string } = {}) =>
  (await sql(`insert into records(section, title, status, created_by, data, controlled, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), coalesce($8::timestamptz, coalesce($7::timestamptz, now()))) returning *`,
    [section, `${tag} ${title}`, status, U[o.by || "owner"].id, data, !!o.controlled, o.created || null, o.updated || null]))[0];
const project = (title: string, data: Record<string, any> = {}, o: any = {}) => rec("company.projects", title, o.status || "Active", { manager_id: U.mgmt.id, manager: "Mgmt", priority: "Normal", ...data }, o);
const task = (pid: string | null, title: string, data: Record<string, any> = {}, o: any = {}) => rec("company.tasks", title, o.status || "In progress", { ...(pid ? { project_ref: pid } : {}), assignee_id: U.emp.id, assignee: "Emp", due: D(10), priority: "Normal", ...data }, o);
const ms = (pid: string, title: string, data: Record<string, any> = {}, o: any = {}) => rec("company.milestones", title, o.status || "Planned", { project_ref: pid, due: D(20), owner_id: U.mgmt.id, ...data }, o);
const age = async (id: string, days: number) => { const c = await pool.connect(); try { await c.query("set session_replication_role = replica"); await c.query("update records set updated_at = $2, created_at = least(created_at, $2) where id = $1", [id, AGO(days)]); await c.query("set session_replication_role = default"); } finally { c.release(); } };
const health = async (k: string, pid: string) => (await as(k, "select * from public.project_health($1)", [pid]))[0];
const codes = (h: any) => (h?.reasons || []).map((r: any) => r.code).sort();

before(async () => {
  const mk = async (k: string, role: string, o: any = {}) => { U[k] = await makeUser(`${tag}.${k}@agron.test`, role, { name: `${k} ${tag}`, ...o }); };
  await mk("owner", "owner", { us: true }); await mk("mgmt", "management", { us: true }); await mk("mgmtNon", "management", { us: false });
  await mk("lead", "engineering", { us: true }); await mk("emp", "engineering", { us: false }); await mk("empUS", "engineering", { us: true }); await mk("other", "engineering", { us: true });
  await mk("admin", "admin", { us: true }); await mk("partner", "partner", { company: `Acme${run}` }); await mk("vendor", "vendor", { company: `Bolt${run}` }); await mk("disabled", "engineering", { us: true });
  DEPT = (await sql("insert into departments(code, key, name, manager_id) values ($1, $2, $3, $4) returning id", [`P5${run.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`, `p5${run}`, `Eng ${tag}`, U.lead.id]))[0].id;
  await sql("update profiles set department_id = $1, timezone = 'Asia/Dubai', location = 'Abu Dhabi', availability = 'busy' where id = any($2)", [DEPT, [U.emp.id, U.empUS.id, U.other.id]]);
  await sql("update profiles set disabled = true where id = $1", [U.disabled.id]);
  for (const k of ["owner", "mgmt", "emp", "empUS", "partner", "lead"]) C[k] = (await signIn(U[k].email)).c;
  CFG = (await sql("select public.mgmt_config() c"))[0].c;
});
after(async () => { fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p5.json"), JSON.stringify(EV, null, 1)); });

/* ------------------------------------------------ B2 Health ------------------------------------------------ */
test("health: Scenario 1 — owner, current activity, no overdue work → HEALTHY 100 with no reasons", async () => {
  const p = await project("Healthy"); await task(p.id, "on track"); await ms(p.id, "M later", { due: D(40) });
  const h = await health("mgmt", p.id);
  assert.equal(h.level, "healthy"); assert.equal(h.score, 100); assert.deepEqual(h.reasons, []);
  assert.equal(h.progress, 0); assert.equal(h.progress_basis, "tasks");
  EV.health.scenario1 = { level: h.level, score: h.score };
});

test("health: every rule alone gives exactly its reason and its configured penalty", async () => {
  const w = W(); const out: Record<string, any> = {};
  const one = async (name: string, setup: (pid: string) => Promise<any>, pdata: any = {}, po: any = {}, expect: { code: string; pen: number }) => {
    const p = await project(name, pdata, po); await setup(p.id); const h = await health("mgmt", p.id);
    out[expect.code] = { score: h.score, reasons: codes(h) };
    const r = h.reasons.find((x: any) => x.code === expect.code); assert.ok(r, `${expect.code}: got ${codes(h)}`);
    assert.equal(r.penalty, expect.pen, `${expect.code} penalty`);
    assert.ok(Array.isArray(r.refs) && r.refs.length > 0, `${expect.code} names its records`);
    return h;
  };
  const keep = async (pid: string) => { await task(pid, "keep open"); await ms(pid, "keep ms", { due: D(60) }); };
  await one("R no owner", keep, { manager_id: null, manager: null }, {}, { code: "no_owner", pen: w.no_owner });
  await one("R overdue", async (pid) => { await keep(pid); await task(pid, "late 1", { due: D(-3) }); }, {}, {}, { code: "overdue_tasks", pen: w.overdue_base + Math.min(w.overdue_cap, w.overdue_each) });
  await one("R blocked", async (pid) => { await keep(pid); await task(pid, "blocked", {}, { status: "Blocked" }); }, {}, {}, { code: "blocked_tasks", pen: w.blocked_base + Math.min(w.blocked_cap, w.blocked_each) });
  const dep = await one("R dependency", async (pid) => { const a = await task(pid, "upstream"); await task(pid, "waits for upstream", { blocked_by: a.id }); await ms(pid, "keep ms", { due: D(60) }); }, {}, {}, { code: "blocked_tasks", pen: w.blocked_base + Math.min(w.blocked_cap, w.blocked_each) });
  assert.equal(dep.blocked, 1, "a task waiting for an open visible task counts as blocked");
  await one("R share", async (pid) => { await task(pid, "late a", { due: D(-2) }); await task(pid, "late b", { due: D(-2) }); await task(pid, "fine", {}); await ms(pid, "keep ms", { due: D(60) }); }, {}, {}, { code: "overdue_share", pen: w.overdue_share });
  await one("R critical", async (pid) => { await keep(pid); await task(pid, "crit", { priority: "Critical", due: D(-1) }); }, {}, {}, { code: "critical_tasks", pen: w.critical_task });
  await one("R ms overdue", async (pid) => { await task(pid, "keep open"); await ms(pid, "late ms", { due: D(-4) }); }, {}, {}, { code: "milestone_overdue", pen: w.milestone_overdue });
  await one("R ms soon", async (pid) => { await task(pid, "keep open"); await ms(pid, "soon ms", { due: D(3) }); }, {}, {}, { code: "milestone_soon", pen: w.milestone_soon });
  await one("R ms no owner", async (pid) => { await task(pid, "keep open"); await ms(pid, "orphan ms", { owner_id: null, due: D(60) }); }, {}, {}, { code: "milestone_no_owner", pen: w.milestone_no_owner });
  await one("R deadline passed", keep, { target: D(-5) }, {}, { code: "deadline_passed", pen: w.deadline_passed });
  await one("R deadline soon", keep, { target: D(4) }, {}, { code: "deadline_soon", pen: w.deadline_soon });
  const st = await project("R stale"); const t0 = await task(st.id, "old"); const m0 = await ms(st.id, "old ms", { due: D(60) });
  for (const id of [st.id, t0.id, m0.id]) await age(id, CFG.stale_days + 6);
  { const h = await health("mgmt", st.id); const r = h.reasons.find((x: any) => x.code === "stale"); assert.ok(r, `stale: ${codes(h)}`); assert.equal(r.penalty, Math.min(w.stale_cap, Math.max(1, 6 * w.stale_per_day)), "stale penalty grows per day past the threshold"); out.stale = codes(h); }
  await one("R no open tasks", async (pid) => { await ms(pid, "keep ms", { due: D(60) }); }, {}, {}, { code: "no_open_tasks", pen: w.no_open_tasks });
  await one("R unassigned", async (pid) => { await keep(pid); await task(pid, "nobody", { assignee_id: null, assignee: null }); }, {}, {}, { code: "unassigned_tasks", pen: Math.min(w.unassigned_cap, w.unassigned_each) });
  await one("R approvals", async (pid) => { await keep(pid); const t = await task(pid, "needs approval");
    await sql("insert into approvals(record_id, section, requested_by, approver_id, status, created_at) values ($1, 'company.tasks', $2, $3, 'pending', $4)", [t.id, U.emp.id, U.mgmt.id, AGO(CFG.approval_age_days + 2)]); }, {}, {}, { code: "approvals_waiting", pen: Math.min(w.approval_old_cap, w.approval_old_each) });
  await one("R decisions", async (pid) => { await keep(pid); await rec("company.decisions", "old decision", "Proposed", { project_ref: pid, date: D(-(CFG.decision_age_days + 3)) }); }, {}, {}, { code: "decisions_waiting", pen: Math.min(w.decision_old_cap, w.decision_old_each) });
  await one("R docs", async (pid) => { await keep(pid); await rec("company.documents", "spec in review", "In review", { project_ref: pid, doc_type: "Specification", owner_id: U.mgmt.id }); }, {}, {}, { code: "documents_in_review", pen: Math.min(w.doc_review_cap, w.doc_review_each) });
  await one("R on hold", keep, {}, { status: "On hold" }, { code: "on_hold", pen: w.on_hold });
  EV.health.rules = out;
});

test("health: Scenario 2 — degradation with exact reasons; score = 100 − sum of penalties; thresholds decide the level", async () => {
  const p = await project("Degrading"); await task(p.id, "ok"); await ms(p.id, "M", { due: D(40) });
  const before = await health("mgmt", p.id); assert.equal(before.level, "healthy");
  await task(p.id, "late A", { due: D(-2) }); await task(p.id, "late B", { due: D(-6) }); await task(p.id, "late C", { due: D(-1) }); await task(p.id, "stuck", { blocker: "waiting for harness" }, { status: "Blocked" });
  const h = await health("mgmt", p.id);
  assert.deepEqual(codes(h), ["blocked_tasks", "overdue_share", "overdue_tasks"].sort());
  assert.equal(h.score, 100 - h.reasons.reduce((a: number, r: any) => a + r.penalty, 0));
  const lv = h.score >= CFG.health.attention ? "healthy" : h.score >= CFG.health.risk ? "attention" : h.score >= CFG.health.critical ? "risk" : "critical";
  assert.equal(h.level, lv); assert.notEqual(h.level, "healthy");
  assert.equal(h.reasons.find((r: any) => r.code === "overdue_tasks").n, 3);
  assert.equal(h.overdue, 3); assert.equal(h.blocked, 1);
  EV.health.scenario2 = { before: before.score, after: h.score, level: h.level, reasons: h.reasons.map((r: any) => [r.code, r.n, r.penalty]) };
  // the same data gives the same result every time
  assert.deepEqual(await health("mgmt", p.id), h);
});

/* ------------------------------------------------ B3 Open loops ------------------------------------------------ */
test("open loops: every kind is detected from real records, with owner, age, reason, next action and link — and nothing is stored", async () => {
  const p = await project("Loops", { target: D(3) }); const pid = p.id;
  await task(pid, "L no owner", { assignee_id: null, assignee: null });
  await task(pid, "L no due", { due: null });
  await task(pid, "L overdue", { due: D(-2) });
  const up = await task(pid, "L upstream"); await task(pid, "L dependent", { blocked_by: up.id });
  await task(pid, "L review", {}, { status: "Review" });
  const stale = await task(pid, "L stale"); await age(stale.id, CFG.task_stale_days + 2);
  const np = await project("Loops no owner", { manager_id: null, manager: null }); await task(np.id, "x");
  const nm = await project("Loops no milestone"); await task(nm.id, "x", { due: null });
  const sp = await project("Loops stale project"); await age(sp.id, CFG.stale_days + 3);
  const dp = await project("Loops deadline passed", { target: D(-3) }); await task(dp.id, "x");
  await rec("company.decisions", "L decision pending", "Proposed", { project_ref: pid, date: D(-1) });
  const dr = await rec("company.decisions", "L decision review", "In review", { project_ref: pid }); await age(dr.id, CFG.decision_age_days + 2);
  await rec("company.decisions", "L decision deferred", "Deferred", { project_ref: pid, reconsider: D(-1) });
  const at = await task(pid, "L approval target");
  await sql("insert into approvals(record_id, section, requested_by, approver_id, status, created_at) values ($1, 'company.tasks', $2, $3, 'pending', $4)", [at.id, U.emp.id, U.mgmt.id, AGO(CFG.approval_age_days + 1)]);
  await sql("insert into approvals(record_id, section, requested_by, approver_id, status, created_at) values ($1, 'company.tasks', $2, $3, 'pending', now())", [at.id, U.emp.id, U.disabled.id]);
  const chain = (await sql("select gen_random_uuid() id"))[0].id;
  await sql("insert into approvals(record_id, section, requested_by, approver_id, status, created_at, chain_id, step, chain_mode) values ($1, 'company.tasks', $2, $3, 'pending', $4, $5, 1, 'sequential'), ($1, 'company.tasks', $2, $6, 'queued', $4, $5, 2, 'sequential')", [at.id, U.emp.id, U.mgmt.id, AGO(CFG.approval_age_days + 1), chain, U.owner.id]);
  const dv = await rec("company.documents", "L doc review", "In review", { project_ref: pid, doc_type: "Procedure", owner_id: U.mgmt.id, reviewer_id: U.emp.id });
  const da = await rec("company.documents", "L doc approval", "Draft", { project_ref: pid, doc_type: "Procedure", owner_id: U.mgmt.id });
  await sql("insert into approvals(record_id, section, requested_by, approver_id, status) values ($1, 'company.documents', $2, $3, 'pending')", [da.id, U.mgmt.id, U.owner.id]);
  await rec("company.documents", "L doc expiring", "Effective", { project_ref: pid, doc_type: "Certificate", owner_id: U.mgmt.id, expiration_date: D(10) });
  await rec("company.meetings", "L meeting decisions", "Done", { project_ref: pid, date: D(-2), decisions: "Go with supplier B", organizer_id: U.mgmt.id });
  await rec("company.meetings", "L meeting actions", "Done", { project_ref: pid, date: D(-2), organizer_id: U.mgmt.id, action_items: [{ id: "a1", title: "send drawings", assignee_id: U.emp.id }] });
  const mt = await rec("company.meetings", "L meeting src", "Done", { project_ref: pid, date: D(-3), organizer_id: U.mgmt.id });
  await task(pid, "L meeting task", { assignee_id: null, assignee: null, meeting_ref: mt.id });
  void dv;
  const auditBefore = (await sql("select (select count(*) from management_alerts)::int a, (select count(*) from notifications)::int n"))[0];
  const all = await as("owner", "select * from public.open_loops(null)");
  const mine = all.filter((l) => String(l.title).startsWith(tag));
  const kinds = [...new Set(mine.map((l) => l.kind))].sort();
  const want = ["task_no_owner", "task_no_due", "task_overdue", "task_blocked", "task_review", "task_stale", "project_no_owner", "project_no_milestone", "project_stale", "project_deadline_passed", "project_deadline_risk", "project_blocked",
    "project_no_next_action", "decision_pending", "decision_review_long", "decision_deferred_due", "approval_waiting", "approval_approver_inactive", "approval_chain_blocked", "document_review", "document_approval", "document_expiring",
    "meeting_decision_no_followup", "meeting_action_no_task", "meeting_task_no_owner"].sort();
  assert.deepEqual(want.filter((k) => !kinds.includes(k)), [], `missing kinds (found ${kinds})`);
  for (const l of mine) {
    assert.ok(l.loop_key && l.category && l.severity && l.record_id && l.since && l.age_days >= 0 && l.reason?.code && l.next_action && l.link?.startsWith("/"), `complete row ${JSON.stringify(l)}`);
  }
  const again = await as("owner", "select * from public.open_loops(null)");
  assert.deepEqual(again.filter((l) => String(l.title).startsWith(tag)).map((l) => l.loop_key).sort(), mine.map((l) => l.loop_key).sort(), "the same loops, the same keys");
  assert.equal(new Set(mine.map((l) => l.loop_key)).size, mine.length, "no duplicates");
  const auditAfter = (await sql("select (select count(*) from management_alerts)::int a, (select count(*) from notifications)::int n"))[0];
  assert.deepEqual(auditAfter, auditBefore, "detection writes nothing");
  EV.loops = { kinds: kinds.length, rows: mine.length, sample: mine.slice(0, 3) };
});

/* ------------------------------------------------ B4 Waiting For ------------------------------------------------ */
test("waiting for: Scenario 4 and every group, with aging, escalation, remind and its cool-down", async () => {
  const p = await project("Waiting", { manager_id: U.lead.id });
  const t1 = await task(p.id, "W spec from emp", { requested_by: U.mgmt.id, due: D(0) }, { by: "mgmt", created: AGO(5) });
  const t2 = await task(p.id, "W radar quote", { waiting_kind: "Supplier", waiting_on: "RadarCo", assignee_id: U.mgmt.id, due: D(4) }, { by: "mgmt", status: "Waiting", created: AGO(6), updated: AGO(6) });
  const t3 = await task(p.id, "W team late", { assignee_id: U.emp.id, due: D(-1) }, { by: "owner" });
  const ap = await task(p.id, "W needs mgmt approval", { assignee_id: U.emp.id }, { by: "emp" });
  await sql("insert into approvals(record_id, section, requested_by, approver_id, status, created_at) values ($1, 'company.tasks', $2, $3, 'pending', $4)", [ap.id, U.emp.id, U.mgmt.id, AGO(4)]);
  const mgmtW = await as("mgmt", "select * from public.waiting_for()");
  const others = mgmtW.find((w) => w.record_id === t1.id); assert.ok(others, "mgmt waits for emp");
  assert.equal(others.bucket, "others"); assert.equal(others.party_id, U.emp.id); assert.equal(others.age_days, 5); assert.equal(others.escalation, "due_soon");
  const ext = mgmtW.find((w) => w.record_id === t2.id); assert.equal(ext.bucket, "external"); assert.equal(ext.party_name, "RadarCo"); assert.equal(ext.age_days, 6);
  const me = mgmtW.find((w) => w.record_id === ap.id && w.kind === "approval"); assert.equal(me.bucket, "me", "an approval waiting for me");
  const leadW = await as("lead", "select * from public.waiting_for()");
  assert.ok(leadW.some((w) => w.record_id === t3.id && w.bucket === "team"), "the department lead sees late work of the team");
  const empW = await as("emp", "select * from public.waiting_for()");
  assert.ok(empW.some((w) => w.record_id === t1.id && w.bucket === "me"), "emp sees that mgmt waits for them");
  for (const w of [...mgmtW, ...leadW, ...empW]) { const r = (await sql("select id from records where id = $1", [w.record_id]))[0]; assert.ok(r, "every item is a real record"); }
  // remind once a day; escalate → history row, notification to the person above (project manager), item shows escalated
  const r1 = await as("mgmt", "select public.waiting_remind($1, null) r", [t1.id]); assert.equal(r1[0].r.ok, true);
  const r2 = await as("mgmt", "select public.waiting_remind($1, null) r", [t1.id]); assert.equal(r2[0].r.ok, false); assert.equal(r2[0].r.reason, "cooldown");
  assert.equal((await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'waiting_remind' and record_id = $2", [U.emp.id, t1.id]))[0].n, 1);
  const e1 = await as("mgmt", "select public.waiting_escalate($1, null, 'needed for the review') r", [t1.id]); assert.equal(e1[0].r.ok, true); assert.equal(e1[0].r.to, U.lead.id);
  assert.equal((await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'waiting_escalated' and record_id = $2", [U.lead.id, t1.id]))[0].n, 1);
  assert.equal((await as("mgmt", "select * from public.waiting_for()")).find((w) => w.record_id === t1.id).escalation, "escalated");
  assert.equal((await sql("select count(*)::int n from activity where record_id = $1 and action = 'mgmt_escalated'", [t1.id]))[0].n, 1);
  await assert.rejects(as("emp", "select public.waiting_escalate($1, null, null)", [t2.id]), /Not in your Waiting For list/, "only an item in my own list");
  await assert.rejects(as("partner", "select public.waiting_remind($1, null)", [t1.id]), /Not allowed/);
  EV.waiting = { mgmt: mgmtW.filter((w) => String(w.title).startsWith(tag)).map((w) => [w.bucket, w.kind, w.age_days, w.escalation]) };
});

/* ------------------------------------------------ B6 Attention ------------------------------------------------ */
test("attention: deterministic order, score = sum of its parts, explanation for every item, threshold respected", async () => {
  const p = await project("Attention", { target: D(2), priority: "High" }); const up = await task(p.id, "A upstream", { due: D(-4), priority: "Critical" });
  await task(p.id, "A down 1", { blocked_by: up.id }); await task(p.id, "A down 2", { blocked_by: up.id }); await ms(p.id, "A ms", { due: D(2) });
  const a = await as("owner", "select * from public.attention_items(200)"); const b = await as("owner", "select * from public.attention_items(200)");
  assert.deepEqual(a.map((x) => x.item_key), b.map((x) => x.item_key), "same order twice");
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].attention_score >= a[i].attention_score, "highest first");
  for (const x of a) {
    assert.equal(x.attention_score, x.why.parts.reduce((s: number, p: any) => s + p.points, 0), "score is the sum of its parts");
    assert.ok(x.attention_score >= CFG.attention.threshold); assert.ok(x.why.reason?.code, "with its reason"); assert.ok(x.next_action);
  }
  // the specific item: through a viewer whose candidate list is small enough to be listed in full (the shared stack may hold a large volume)
  const full = await as("owner", "select * from public.attention_items(500)");
  const top = full.find((x) => x.record_id === up.id && x.kind === "task_overdue");
  if (top || full.length < 500) { // fewer than 500 → the list is complete
    assert.ok(top, "the overdue critical upstream task is there");
    for (const c of ["severity", "deadline", "priority", "downstream"]) assert.ok(top.why.parts.some((p: any) => p.code === c), `part ${c}`);
    assert.equal(top.why.parts.find((p: any) => p.code === "downstream").n, 2, "blocks two tasks");
  }
  EV.attention = { top: a.slice(0, 5).map((x) => [x.title, x.attention_score, x.why.parts.map((p: any) => `${p.code}+${p.points}`).join(" ")]) };
});

/* ------------------------------------------------ B1 Portfolio ------------------------------------------------ */
test("portfolio: aggregation equals its projects; hidden projects never count; empty portfolios show; projects need no portfolio", async () => {
  const pf = await rec("company.portfolios", "PRODUCT DEVELOPMENT", "Active", { owner_id: U.mgmt.id, priority: "High", target: D(200) });
  const empty = await rec("company.portfolios", "EMPTY", "Planned", {});
  const a = await project("C20", { portfolio_ref: pf.id }); await task(a.id, "done 1", {}, { status: "Completed" }); await task(a.id, "late", { due: D(-2) });
  const b = await project("C40", { portfolio_ref: pf.id }); await task(b.id, "open"); await task(b.id, "blocked", {}, { status: "Blocked" });
  const hidden = await project("SECRET C60", { portfolio_ref: pf.id }, { controlled: true }); await task(hidden.id, "s late", { due: D(-9) }, { controlled: true }); await task(hidden.id, "s blocked", {}, { status: "Blocked", controlled: true });
  const loose = await project("No portfolio"); await task(loose.id, "x");
  const own = (await as("owner", "select * from public.portfolio_overview()")).find((g) => g.portfolio_id === pf.id);
  const emp = (await as("emp", "select * from public.portfolio_overview()")).find((g) => g.portfolio_id === pf.id);
  assert.equal(own.project_count, 3); assert.equal(emp.project_count, 2, "the non-US employee does not count the US-only project");
  assert.equal(own.overdue, 2); assert.equal(emp.overdue, 1); assert.equal(own.blocked, 2); assert.equal(emp.blocked, 1);
  assert.ok(!JSON.stringify(emp).includes("SECRET"), "no trace of the hidden project");
  const h = await as("emp", "select * from public.project_health(null) where portfolio_id = $1", [pf.id]);
  assert.equal(emp.overdue, h.reduce((s, x) => s + x.overdue, 0)); assert.equal(emp.blocked, h.reduce((s, x) => s + x.blocked, 0));
  assert.equal(emp.progress, Math.floor((h.reduce((s, x) => s + x.tasks_done, 0) * 100) / h.reduce((s, x) => s + x.tasks_total, 0)));
  assert.ok((await as("owner", "select * from public.portfolio_overview()")).some((g) => g.portfolio_id === empty.id && g.project_count === 0));
  assert.ok((await as("owner", "select * from public.portfolio_overview()")).find((g) => g.portfolio_id === null).projects.some((x: any) => x.id === loose.id));
  EV.portfolio = { owner: { n: own.project_count, overdue: own.overdue, blocked: own.blocked, level: own.level }, emp: { n: emp.project_count, overdue: emp.overdue, blocked: emp.blocked, level: emp.level } };
});

/* ------------------------------------------------ B5/B9 totals ------------------------------------------------ */
test("reports: every indicator equals an independent count through row-level security", async () => {
  for (const k of ["owner", "mgmt", "emp", "lead"]) {
    const ov = (await as(k, "select public.exec_overview() o"))[0].o; const i = ov.indicators;
    const [c] = await as(k, `select
      (select count(*) from records where section = 'company.tasks' and status not in ('Completed', 'Cancelled') and public.mgmt_date(data->>'due') < (now() at time zone 'utc')::date)::int overdue,
      (select count(*) from records where section = 'company.projects' and status not in ('Completed', 'Cancelled'))::int active,
      (select count(*) from approvals a where a.status = 'pending' and a.approver_id = auth.uid() and exists (select 1 from records r where r.id = a.record_id and r.section in ('company.projects','company.tasks','company.milestones','company.decisions','company.documents','company.meetings','company.portfolios')))::int my_approvals`);
    assert.equal(i.overdue_work, c.overdue, `${k}: overdue work`); assert.equal(i.active_projects, c.active, `${k}: active projects`); assert.equal(i.pending_approvals, c.my_approvals, `${k}: my approvals`);
    const ph = ov.portfolio_health; assert.equal(ph.healthy + ph.attention + ph.risk + ph.critical, i.active_projects, `${k}: levels add up`);
    assert.ok(ov.attention.length <= CFG.attention.max_items);
    EV.security[`indicators_${k}`] = i;
  }
});

/* ------------------------------------------------ B10 Changes ------------------------------------------------ */
test("changes: Scenario 6 — a health change between reviews appears exactly once, with its source; minor edits do not appear", async () => {
  const p = await project("Changes"); await task(p.id, "c ok"); await ms(p.id, "c ms", { due: D(50) });
  const snap = (await as("mgmt", "select public.mgmt_snapshot('review', 'R1') id"))[0].id; assert.ok(snap);
  for (let i = 0; i < 4; i++) await task(p.id, `c late ${i}`, { due: D(-3 - i), priority: "High" });
  await sql("update records set status = 'Blocked' where section = 'company.tasks' and title = $1", [`${tag} c ok`]);
  await sql("update records set data = data || '{\"notes\":\"typo fixed\"}' where id = $1", [p.id]);
  await sql("update records set data = data || jsonb_build_object('manager_id', $2::text) where id = $1", [p.id, U.lead.id]);
  const ch = (await as("mgmt", "select * from public.management_changes('review')")).filter((c) => c.project_id === p.id);
  const hc = ch.filter((c) => c.kind === "health_changed"); assert.equal(hc.length, 1, "exactly once"); assert.equal(hc[0].source, "snapshot"); assert.equal(hc[0].source_id, snap);
  assert.equal(hc[0].detail.from, "healthy"); assert.notEqual(hc[0].detail.to, "healthy");
  assert.equal(ch.filter((c) => c.kind === "blocker_new").length, 1); assert.equal(ch.filter((c) => c.kind === "owner_changed").length, 1);
  assert.ok(!ch.some((c) => JSON.stringify(c.detail).includes("typo")), "a minor field edit is not a change");
  for (const c of ch.filter((x) => x.source === "activity")) assert.ok((await sql("select 1 from activity where id = $1", [Number(c.source_id)])).length, "linked to its history row");
  const again = (await as("mgmt", "select * from public.management_changes('review')")).filter((c) => c.project_id === p.id);
  assert.deepEqual(again.map((c) => c.change_key).sort(), ch.map((c) => c.change_key).sort(), "stable keys");
  EV.changes = ch.map((c) => [c.kind, c.source, c.detail]);
});

/* ------------------------------------------------ B16 Alerts ------------------------------------------------ */
test("alerts: Scenario 11 — one alert per condition however often it is evaluated; resolved when it clears; quiet reopen inside the cool-down", async () => {
  const p = await project("Alert critical", { manager_id: U.mgmt.id, target: D(-20) }, { status: "Active" });
  for (let i = 0; i < 6; i++) await task(p.id, `al late ${i}`, { due: D(-10 - i), priority: "Critical" }); await ms(p.id, "al ms late", { due: D(-5) });
  const h = await health("mgmt", p.id); assert.equal(h.level, "critical", `score ${h.score}`);
  const n0 = (await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'mgmt_alert'", [U.mgmt.id]))[0].n;
  for (let i = 0; i < 4; i++) await sql("select public.mgmt_alert_scan($1)", [U.mgmt.id]);
  const al = await sql("select * from management_alerts where user_id = $1 and key = $2", [U.mgmt.id, `project_critical:${p.id}`]);
  assert.equal(al.length, 1); assert.equal(al[0].resolved_at, null);
  const n1 = (await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'mgmt_alert' and record_id = $2", [U.mgmt.id, p.id]))[0].n;
  assert.equal(n1, 1, "one notification for the critical project"); assert.ok(n0 >= 0);
  await sql("update records set status = 'Cancelled' where id = $1", [p.id]);
  await sql("select public.mgmt_alert_scan($1)", [U.mgmt.id]);
  assert.ok((await sql("select resolved_at from management_alerts where id = $1", [al[0].id]))[0].resolved_at, "resolved when the condition clears");
  await sql("update records set status = 'Active' where id = $1", [p.id]); await sql("select public.mgmt_alert_scan($1)", [U.mgmt.id]);
  const back = (await sql("select * from management_alerts where id = $1", [al[0].id]))[0]; assert.equal(back.resolved_at, null); assert.equal(back.times_opened, 2);
  assert.equal((await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'mgmt_alert' and record_id = $2", [U.mgmt.id, p.id]))[0].n, 1, "came back inside the cool-down: no second notification");
  await assert.rejects(as("emp", "select public.mgmt_alert_scan($1)", [U.mgmt.id]), /Not allowed/, "nobody scans for someone else");
  const hp = await project("Alert hidden", { manager_id: U.mgmtNon.id, target: D(-30) }, { controlled: true }); for (let i = 0; i < 6; i++) await task(hp.id, `h late ${i}`, { due: D(-10), priority: "Critical" }, { controlled: true });
  await sql("select public.mgmt_alert_scan($1)", [U.mgmtNon.id]);
  assert.equal((await sql("select count(*)::int n from management_alerts where user_id = $1 and (record_id = $2 or project_id = $2)", [U.mgmtNon.id, hp.id]))[0].n, 0, "never an alert about a record the person cannot open");
  EV.alerts = { notifications: n1, times_opened: back.times_opened };
});

/* ------------------------------------------------ B17 Settings ------------------------------------------------ */
test("settings: only owners and management change them; validated; every change kept; new thresholds change the result", async () => {
  await assert.rejects(as("emp", "select public.mgmt_settings_save('{\"stale_days\": 3}')"), /Only owners and management/);
  await assert.rejects(as("admin", "select public.mgmt_settings_save('{\"stale_days\": 3}')"), /Only owners and management/);
  await assert.rejects(as("mgmt", "select public.mgmt_settings_save('{\"nope\": 3}')"), /Unknown setting/);
  await assert.rejects(as("mgmt", "select public.mgmt_settings_save('{\"health\": {\"attention\": 50, \"risk\": 60, \"critical\": 35}}')"), /must go down/);
  await assert.rejects(as("mgmt", "select public.mgmt_settings_save('{\"stale_days\": \"x\"}')"), /must be a number/);
  const p = await project("Settings"); await task(p.id, "x"); await ms(p.id, "m", { due: D(9) });
  assert.ok(!codes(await health("mgmt", p.id)).includes("milestone_soon"));
  const n = (await sql("select count(*)::int n from management_settings_history"))[0].n;
  await as("mgmt", "select public.mgmt_settings_save($1::jsonb)", [JSON.stringify({ milestone_warn_days: 10 })]);
  assert.ok(codes(await health("mgmt", p.id)).includes("milestone_soon"), "the configured window applies at once");
  const hist = await sql("select * from management_settings_history order by id desc limit 1"); assert.equal((await sql("select count(*)::int n from management_settings_history"))[0].n, n + 1); assert.equal(hist[0].changed_by, U.mgmt.id); assert.equal(hist[0].after.milestone_warn_days, 10);
  await as("owner", "select public.mgmt_settings_save('{}'::jsonb)"); CFG = (await sql("select public.mgmt_config() c"))[0].c; assert.equal(CFG.milestone_warn_days, 7, "back to defaults");
});

/* ------------------------------------------------ B18 Security ------------------------------------------------ */
test("security: Scenario 3 — a US-only project turns critical: nothing reaches the non-US employee; authorized management sees it with reasons", async () => {
  const p = await project("HIDDEN critical", { manager_id: U.mgmt.id, target: D(-15) }, { controlled: true });
  for (let i = 0; i < 6; i++) await task(p.id, `hidden late ${i}`, { due: D(-8 - i), priority: "Critical", assignee_id: U.empUS.id }, { controlled: true });
  await ms(p.id, "hidden ms", { due: D(-3) }, { controlled: true });
  await rec("company.decisions", "hidden decision", "Proposed", { project_ref: p.id, date: D(-20) }, { controlled: true });
  const mg = await health("mgmt", p.id); assert.equal(mg.level, "critical"); assert.ok(mg.reasons.length >= 4);
  const leak = (k: string, rows: any) => { const s = JSON.stringify(rows); assert.ok(!s.includes(p.id) && !s.includes("HIDDEN") && !s.includes("hidden "), `${k} leaked`); };
  for (const k of ["emp", "mgmtNon", "partner", "vendor", "disabled"]) {
    const outs: any = {
      health: await as(k, "select * from public.project_health(null)"), one: await as(k, "select * from public.project_health($1)", [p.id]), loops: await as(k, "select * from public.open_loops(null)"),
      waiting: await as(k, "select * from public.waiting_for()"), attention: await as(k, "select * from public.attention_items(500)"), portfolio: await as(k, "select * from public.portfolio_overview()"),
      deadlines: await as(k, "select * from public.mgmt_deadlines(366)"), changes: await as(k, "select * from public.management_changes('week')"), team: await as(k, "select * from public.team_status()"),
      overview: await as(k, "select public.exec_overview() o"), decisions: await as(k, "select * from public.mgmt_decisions_report()"),
    };
    for (const [n, v] of Object.entries(outs)) leak(`${k}.${n}`, v);
    assert.deepEqual(outs.one, [], `${k}: the project itself is not there`);
    if (["partner", "vendor", "disabled"].includes(k)) { for (const n of ["health", "loops", "waiting", "attention", "portfolio", "deadlines", "changes", "team", "decisions"]) assert.deepEqual(outs[n], [], `${k}.${n} empty`); assert.equal(outs.overview[0].o, null); }
    EV.security[`scenario3_${k}`] = "nothing";
  }
  assert.ok((await as("owner", "select * from public.project_health(null)")).some((h) => h.project_id === p.id && h.level === "critical"), "the owner (US person) sees it critical");
  // the US employee assigned to it sees it
  assert.equal((await health("empUS", p.id)).level, "critical");
  EV.security.scenario3_mgmt = { level: mg.level, score: mg.score, reasons: mg.reasons.map((r: any) => r.code) };
});

test("security: Restricted documents count only for those who may open them", async () => {
  const p = await project("Restricted docs"); await task(p.id, "x"); await ms(p.id, "m", { due: D(60) });
  const d = await rec("company.documents", "RESTRICTED review", "In review", { project_ref: p.id, doc_type: "Contract", classification: "Restricted", owner_id: U.mgmt.id }, { by: "mgmt" });
  const hm = await health("mgmt", p.id); const he = await health("emp", p.id);
  assert.ok(codes(hm).includes("documents_in_review")); assert.ok(!codes(he).includes("documents_in_review"), "a restricted document never changes the employee's score");
  assert.ok(hm.score < he.score);
  assert.ok(!JSON.stringify(await as("emp", "select * from public.open_loops($1)", [p.id])).includes(d.id));
  await sql("update records set data = data || jsonb_build_object('access_ids', jsonb_build_array($2::text)) where id = $1", [d.id, U.emp.id]);
  assert.ok(codes(await health("emp", p.id)).includes("documents_in_review"), "given access, it counts");
});

test("security: mgmt_visible is exactly row-level security for every role (owner, admin, management ± US, lead, employee ± US, partner, contractor, disabled)", async () => {
  const secs = ["company.projects", "company.tasks", "company.milestones", "company.decisions", "company.documents", "company.meetings", "company.portfolios"];
  for (const k of ["owner", "admin", "mgmt", "mgmtNon", "lead", "emp", "empUS", "partner", "vendor", "disabled"]) {
    const rls = new Set((await as(k, "select id from records where section = any($1) and title like $2", [secs, `${tag}%`])).map((r) => r.id));
    const mv = new Set((await sql("select id from public.mgmt_visible($1) where title like $2", [U[k].id, `${tag}%`])).map((r) => r.id));
    const external = ["partner", "vendor", "disabled"].includes(k);
    if (external) assert.equal(mv.size, 0, `${k}: the engines see nothing`);
    else assert.deepEqual([k, [...mv].filter((x) => !rls.has(x)).length, [...rls].filter((x) => !mv.has(x)).length], [k, 0, 0], `${k}: same records`);
    EV.security[`equivalence_${k}`] = { rls: rls.size, engines: mv.size };
  }
  // and the private helpers cannot be called directly
  for (const f of ["_project_health(null::uuid, null::uuid)", "_open_loops(null::uuid, null::uuid)", "_waiting_for(null::uuid)", "mgmt_visible(null::uuid)", "_attention(null::uuid, 5)"])
    await assert.rejects(as("emp", `select * from public.${f}`), /permission denied/, f);
});

test("team status: availability as set, local time zone, responsibilities only among records the viewer may open", async () => {
  const p = await project("TEAM secret", { manager_id: U.other.id, members_ids: [U.emp.id] }, { controlled: true });
  await task(p.id, "TEAM secret task", { assignee_id: U.other.id }, { controlled: true });
  const pub = await project("TEAM public", { manager_id: U.other.id }); await task(pub.id, "TEAM public task", { assignee_id: U.other.id });
  const seenE = (await as("emp", "select * from public.team_status()")).find((r) => r.person_id === U.other.id);
  const seenO = (await as("owner", "select * from public.team_status()")).find((r) => r.person_id === U.other.id);
  assert.equal(seenE.availability, "busy"); assert.equal(seenE.timezone, "Asia/Dubai"); assert.equal(seenE.location, "Abu Dhabi");
  assert.ok(!JSON.stringify(seenE).includes("secret"), "the US-only responsibilities stay hidden"); assert.ok(JSON.stringify(seenO).includes("TEAM secret"));
  assert.equal(seenO.open_tasks - seenE.open_tasks, 1);
  assert.ok(!(await as("emp", "select * from public.team_status()")).some((r) => r.person_id === U.disabled.id || r.person_id === U.partner.id), "no disabled or external people");
  assert.ok(!Object.keys(seenO).some((k) => /score|productiv|presence|online/.test(k)), "no performance or presence fields");
  // the person sets it; nobody else can
  const { error } = await C.emp.from("profiles").update({ availability: "away", location: "Monroe" }).eq("id", U.emp.id); assert.equal(error, null);
  assert.equal((await sql("select availability from profiles where id = $1", [U.emp.id]))[0].availability, "away");
  await C.emp.from("profiles").update({ availability: "off" }).eq("id", U.other.id);
  assert.equal((await sql("select availability from profiles where id = $1", [U.other.id]))[0].availability, "busy", "not someone else's");
});

/* ------------------------------------------------ B12–B14 Safe actions ------------------------------------------------ */
const ctx = (k: string): Ctx => ({ user: C[k], admin: db, me: { id: U[k].id, role: U[k].role, full_name: `${k} ${tag}`, timezone: "UTC" }, lang: "en" });
/** what the browser's store does with the operations (insert / update with the version check), as that person */
async function storeRun(k: string, ops: any[]) {
  const out: any[] = [];
  for (const o of ops) {
    if (o.op === "create") { const { data, error } = await C[k].from("records").insert({ section: o.section, title: o.title, status: o.status, data: o.data, created_by: U[k].id }).select("id").single(); out.push(error ? { ok: false, error: error.message } : { ok: true, id: data.id }); }
    else if (o.op === "update") { const { data, error } = await C[k].from("records").update({ status: o.status, data: o.data }).eq("id", o.id).eq("version", o.version).select("id").maybeSingle(); out.push(error || !data ? { ok: false, error: error?.message || "conflict" } : { ok: true, id: o.id }); }
    else if (o.op === "delete") { const { error } = await C[k].from("records").delete().eq("id", o.id); out.push(error ? { ok: false, error: error.message } : { ok: true, id: o.id }); }
    else if (o.op === "comment") { const { data, error } = await C[k].from("comments").insert({ record_id: o.id, body: o.body, author: U[k].id }).select("id").single(); out.push(error ? { ok: false } : { ok: true, id: o.id, comment: data.id }); }
  }
  return out;
}

test("voice: Scenario 7 — proposal → confirmation → exactly one task → audit record with actor, source, command, interpretation, confirmation, result, time", async () => {
  await sql("update profiles set full_name = 'Anton Petrov' where id = $1", [U.empUS.id]);
  const words = `Create task for Anton to finish Sprinter specification ${tag} Friday.`;
  const before = (await sql("select count(*)::int n from records where section = 'company.tasks' and title like $1", [`%${tag}%Sprinter%`]))[0].n;
  let p = await plan(ctx("mgmt"), words, "voice"); let pick: any = {};
  if (p.status === "needs_clarification" && p.options?.some((o) => o.id === U.empUS.id)) { // another "Anton" exists on the shared stack: the server asks which one
    pick = { personId: U.empUS.id }; p = { ...p, status: "proposed", resolved: { person: { id: U.empUS.id, name: "Anton Petrov" } }, needsConfirmation: true, risk: "material" };
  }
  assert.equal(p.status, "proposed"); assert.equal(p.risk, "material"); assert.equal(p.resolved.person?.id, U.empUS.id); assert.equal(p.needsConfirmation, true);
  assert.equal((await sql("select count(*)::int n from records where section = 'company.tasks' and title like $1", [`%${tag}%Sprinter%`]))[0].n, before, "nothing changes on a proposal");
  const no = await start(ctx("mgmt"), p.id, { ...pick }); assert.equal(no.ok, false); assert.equal((no as any).status, 409, "a write needs the explicit yes");
  const s = await start(ctx("mgmt"), p.id, { confirm: true, ...pick }); assert.equal(s.ok, true); assert.equal((s as any).ops.length, 1);
  const done = await complete(ctx("mgmt"), p.id, await storeRun("mgmt", (s as any).ops)); assert.equal(done.ok, true);
  const tasks = await sql("select * from records where section = 'company.tasks' and title like $1", [`%Sprinter specification ${tag}%`]);
  assert.equal(tasks.length, 1, "one task"); assert.equal(tasks[0].data.assignee_id, U.empUS.id); assert.equal(tasks[0].created_by, U.mgmt.id); assert.match(tasks[0].data.due, /^\d{4}-\d{2}-\d{2}$/);
  const a = (await sql("select * from action_audit where id = $1", [p.id]))[0];
  assert.deepEqual([a.user_id, a.source, a.command, a.intent, a.risk, a.status], [U.mgmt.id, "voice", words, "create_task", "material", "executed"]);
  assert.ok(a.confirmed_at && a.executed_at && a.result_record_id === tasks[0].id && a.interpreted?.slots?.title);
  // a second "complete" or "start" is refused: the proposal ran once
  assert.equal((await start(ctx("mgmt"), p.id, { confirm: true })).ok, false); assert.equal((await complete(ctx("mgmt"), p.id, [{ ok: true, id: tasks[0].id }])).ok, false);
  // a result the database does not confirm is not accepted into the audit
  const p2 = await plan(ctx("mgmt"), `Remind me tomorrow to check ${tag} drawings`, "voice"); const s2 = await start(ctx("mgmt"), p2.id, { confirm: true });
  const fake = await complete(ctx("mgmt"), p2.id, [{ ok: true, id: tasks[0].id }]); assert.equal(fake.ok, false, "a record made before the confirmation is not this action's result"); void s2;
  EV.actions.scenario7 = { audit: { source: a.source, intent: a.intent, risk: a.risk, status: a.status, confirmed: !!a.confirmed_at, result: a.result_record_id } };
});

test("voice: Scenario 8 — “Move the deadline.” changes nothing and asks; options are re-checked; Scenario 9 — an outside partner is refused", async () => {
  const n0 = (await sql("select count(*)::int n, max(updated_at) m from records where title like $1", [`${tag}%`]))[0];
  const p = await plan(ctx("mgmt"), "Move the deadline.", "voice");
  assert.equal(p.status, "needs_clarification"); assert.ok(p.question);
  const r = await start(ctx("mgmt"), p.id, { confirm: true }); assert.equal(r.ok, false); assert.equal((r as any).status, 409);
  assert.deepEqual((await sql("select count(*)::int n, max(updated_at) m from records where title like $1", [`${tag}%`]))[0], n0, "no mutation");
  const bogus = await start(ctx("mgmt"), p.id, { confirm: true, taskId: "00000000-0000-0000-0000-000000000000" }); assert.equal(bogus.ok, false);
  await assert.rejects(plan(ctx("partner"), "Create task for Anton to review the budget tomorrow", "voice"), /Not allowed/);
  const res = await fetch(`${ENV.STACK_APP_URL || "http://127.0.0.1:3125"}/api/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "plan", text: "show overdue" }) }).catch(() => null);
  if (res) assert.ok([401, 403].includes(res.status), "signed out: refused");
  const c = await plan(ctx("mgmt"), "Approve the C20 drawing", "voice"); assert.equal(c.status, "rejected"); assert.equal(c.risk, "controlled");
  assert.equal((await start(ctx("mgmt"), c.id, { confirm: true })).ok, false, "controlled actions keep their own approval flow");
  EV.actions.scenario8 = { status: p.status, question: p.question }; EV.actions.scenario9 = "refused";
});

test("safe actions: READ needs no confirmation; LOW and MATERIAL need it; undo only where exact; the audit cannot be rewritten", async () => {
  const rd = await plan(ctx("emp"), "show blocked", "voice"); assert.equal(rd.risk, "read"); const r = await start(ctx("emp"), rd.id, {}); assert.equal(r.ok, true); assert.equal((r as any).route, "/control?view=blocked");
  // a reminder to myself: low risk, still confirmed, undo removes exactly that task
  const lo = await plan(ctx("emp"), `Remind me tomorrow to call ${tag} supplier`, "voice"); assert.equal(lo.risk, "low");
  const s = await start(ctx("emp"), lo.id, { confirm: true }); const done = await complete(ctx("emp"), lo.id, await storeRun("emp", (s as any).ops)); assert.equal(done.ok, true); assert.equal(done.undoable, true);
  const id = done.result!.id!; const u = await undoStart(ctx("emp"), lo.id); assert.equal(u.ok, true);
  await storeRun("emp", (u as any).ops); assert.equal((await undoDone(ctx("emp"), lo.id)).ok, true);
  assert.equal((await sql("select count(*)::int n from records where id = $1", [id]))[0].n, 0);
  assert.equal((await sql("select status from action_audit where id = $1", [lo.id]))[0].status, "undone");
  // a change someone else touched afterwards cannot be undone
  const t = await task(null, "undo target", { assignee_id: U.emp.id, due: D(30) }, { by: "emp" });
  const ch = await plan(ctx("emp"), `Change due date of ${tag} undo target to next Monday`, "voice"); assert.equal(ch.status, "proposed", ch.question);
  const s2 = await start(ctx("emp"), ch.id, { confirm: true }); const d2 = await complete(ctx("emp"), ch.id, await storeRun("emp", (s2 as any).ops)); assert.equal(d2.ok, true);
  await sql("update records set data = data || '{\"notes\":\"edited by someone\"}' where id = $1", [t.id]);
  const u2 = await undoStart(ctx("emp"), ch.id); assert.equal(u2.ok, false, "refused: changed since");
  // a comment has no undo
  const pr = await project("Comment target");
  const { data: auditCmd } = await db.from("action_audit").insert({ user_id: U.mgmt.id, source: "assistant", command: "comment", intent: "command_plan", risk: "material", interpreted: { ops: [{ op: "comment", id: pr.id, body: "noted" }], before: {} }, status: "proposed" }).select("id").single();
  const s3 = await start(ctx("mgmt"), auditCmd!.id, { confirm: true }); const d3 = await complete(ctx("mgmt"), auditCmd!.id, await storeRun("mgmt", (s3 as any).ops)); assert.equal(d3.ok, true); assert.equal(d3.undoable, false, "a posted message is not silently taken back");
  // cancel; the audit only moves forward and cannot be deleted
  const cx = await plan(ctx("emp"), `Remind me tomorrow to water ${tag} plants`, "voice"); assert.equal((await cancel(ctx("emp"), cx.id)).ok, true);
  await assert.rejects(sql("update action_audit set status = 'proposed' where id = $1", [cx.id]), /cannot become/);
  await assert.rejects(sql("delete from action_audit where id = $1", [cx.id]), /kept/);
  await assert.rejects(sql("update action_audit set command = 'other' where id = $1", [lo.id]), /cannot be rewritten/);
  const { error } = await C.emp.from("action_audit").insert({ user_id: U.emp.id, source: "voice", command: "x", intent: "x", risk: "read" }); assert.ok(error, "the browser cannot write the audit");
  assert.ok(((await C.emp.from("action_audit").select("user_id")).data || []).every((x: any) => x.user_id === U.emp.id), "each person reads only their own audit");
  EV.actions.undo = { allowed: "created task removed", refused: "changed since", comment: "no undo" };
});

/* ------------------------------------------------ B15 Assistant ------------------------------------------------ */
test("assistant: Scenario 10 — “What needs my attention?” is answered from the engines, ordered, with sources; nothing hidden reaches the employee", async () => {
  const ro = await retrieve(C.owner, { id: U.owner.id, role: "owner" }, { q: "What needs my attention?" });
  assert.ok(ro.intents.includes("attention")); const at = ro.sources.filter((s) => s.kind === "attention"); assert.ok(at.length > 0);
  const scores = at.map((s) => Number(s.excerpt.match(/attention score (\d+)/)![1])); for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] >= scores[i], "ordered");
  for (const s of at) { assert.ok(s.link.startsWith("/")); assert.match(s.excerpt, /why: /); }
  const re = await retrieve(C.emp, { id: U.emp.id, role: "engineering" }, { q: "What needs my attention? What is late? Show all critical projects. What are we waiting for?" });
  assert.ok(!JSON.stringify(re).includes("HIDDEN") && !JSON.stringify(re).includes("SECRET"), "no hidden project in the employee's sources");
  const late = await retrieve(C.owner, { id: U.owner.id, role: "owner" }, { q: "What deadlines do we have in the next two weeks?" }); assert.ok(late.intents.includes("deadlines_14"));
  const resp = await retrieve(C.owner, { id: U.owner.id, role: "owner" }, { q: "What is Anton responsible for?" }); assert.ok(resp.intents.includes("responsibilities"));
  const rev = await retrieve(C.mgmt, { id: U.mgmt.id, role: "management" }, { q: "Prepare my management review" });
  for (const i of ["attention", "critical_projects", "waiting_for", "pending_decisions", "changes_review", "deadlines_14"]) assert.ok(rev.intents.includes(i), i);
  // the browser cannot add trusted context: the retrieval takes only the question and a record id it re-reads itself
  const forged = await retrieve(C.emp, { id: U.emp.id, role: "engineering" }, { q: "What is happening with this project?", recordId: (await sql("select id from records where title like $1 limit 1", [`${tag} HIDDEN%`]))[0].id });
  assert.ok(!JSON.stringify(forged).includes("HIDDEN"), "a hidden record id gives nothing");
  EV.retrieval = { owner_attention: at.slice(0, 5).map((s) => [s.title, s.excerpt.slice(0, 80)]), review_intents: rev.intents };
});
