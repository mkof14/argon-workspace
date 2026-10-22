// Phase 6 — business operations and the workflow engine (v23) against the real database on the isolated stack,
// with real sign-ins. Synthetic data only (every title starts with the run tag; companies and vendors are invented).
// Covers the engine (definitions, validation, versions, steps, transitions, rules, SLA, escalation, automations with
// retry and dead-letter), the business processes (purchase, payment, contract, engineering change, issue, travel,
// general request, exhibition template), approvals bound to exact values, numbering under concurrency, receiving,
// budgets, the party directory, extraction proposals, the read models, the security matrix and the E2E scenarios.
// Evidence: .stack/p6.json
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENV, makeUser, pool, sql, uid } from "./_stack.ts";

const run = uid(); const tag = `p6${run}`;
const D = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const U: Record<string, any> = {};
const EV: Record<string, any> = { tag, scenarios: {}, engine: {}, security: {}, numbering: {}, automation: {}, sla: {} };
let DEPT = ""; let PROJ: any; let PROJ_US: any; let VENDOR: any; let VENDOR2: any; let VENDOR_NEW: any;

/** Run SQL as one signed-in person (API role + their claims) — what any direct database request would get. */
async function as<T = any>(k: string, q: string, p: any[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[k].id, role: "authenticated", aal: "aal1", iat: Math.floor(Date.now() / 1000) + 5 })]);
    const r = await c.query(q, p); await c.query("commit"); return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
/** one function call as one person; returns its value */
const call = async (k: string, fn: string, args: any[] = []) => (await as(k, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args))[0].r;
const fails = async (p: Promise<any>, re: RegExp) => { await assert.rejects(p, (e: any) => { assert.match(String(e.message), re); return true; }); };
const rec = async (section: string, title: string, status: string | null, data: Record<string, any> = {}, o: { by?: string; controlled?: boolean } = {}) =>
  (await sql(`insert into records(section, title, status, created_by, data, controlled) values ($1, $2, $3, $4, $5, $6) returning *`, [section, `${tag} ${title}`, status, U[o.by || "owner"].id, data, !!o.controlled]))[0];
const get = async (id: string) => (await sql("select * from records where id = $1", [id]))[0];
const inst = async (record: string) => (await sql("select i.*, s.step_id cur, s.step_type ctype, s.assignee cassignee, s.assignee_role crole, s.id run from wf_instances i left join wf_step_runs s on s.id = i.current_run where i.record_id = $1 order by i.created_at desc limit 1", [record]))[0];
const events = async (i: string) => (await sql("select kind, step_id, from_state, to_state, detail from wf_events where instance_id = $1 order by id", [i])).map((e: any) => e.kind + (e.step_id ? ":" + e.step_id : ""));
const pendingFor = async (record: string) => sql("select * from approvals where record_id = $1 and status = 'pending' order by step, created_at", [record]);
const act = (k: string, runId: string, outcome: string, note: string | null = null) => call(k, "wf_act", [runId, outcome, note]);
const decide = (k: string, id: string, d: string, c: string | null = null) => call(k, "wf_approval_decide", [id, d, c]);

/** a purchase request raised by «emp», driven up to the approval step */
async function prToApproval(title: string, amount: number, o: { project?: string; vendor?: any; by?: string } = {}) {
  const by = o.by || "emp";
  const res = await call(by, "ops_request_create", ["purchase", `${tag} ${title}`, { item: title, qty: 2, est_amount: amount, currency: "USD", justification: "for the test", ...(o.project ? { project_ref: o.project } : {}) }, "Normal"]);
  let i = await inst(res.record); assert.equal(i.cur, "request");
  await act(by, i.run, "submit");
  i = await inst(res.record); assert.equal(i.cur, "tech_review");
  await act("eng", i.run, "approved");
  i = await inst(res.record); assert.equal(i.cur, "quotations");
  const v = o.vendor || VENDOR;
  const q1 = (await as("proc", "insert into records(section, title, status, data) values ('operations.quotations', $1, 'Received', $2) returning id", [`${tag} Q1 ${title}`,
    { request_ref: res.record, vendor_ref: v.id, vendor_ref_title: v.title, amount: amount - 200, currency: "USD", lead_time_days: 10, valid_until: D(30) }]))[0];
  const q2 = (await as("proc", "insert into records(section, title, status, data) values ('operations.quotations', $1, 'Received', $2) returning id", [`${tag} Q2 ${title}`,
    { request_ref: res.record, vendor_ref: VENDOR2.id, vendor_ref_title: VENDOR2.title, amount: amount + 300, currency: "USD", lead_time_days: 5, valid_until: D(30) }]))[0];
  await act("proc", i.run, "submit");
  i = await inst(res.record); assert.equal(i.cur, "vendor_selection");
  await call("proc", "ops_select_quote", [res.record, q1.id, "Lower price and the vendor already supplied us without problems"]);
  i = await inst(res.record); assert.equal(i.cur, "approval");
  return { ...res, q1: q1.id, q2: q2.id, inst: i };
}

before(async () => {
  const mk = async (k: string, role: string, o: any = {}) => { U[k] = await makeUser(`${tag}.${k}@agron.test`, role, { name: `${k} ${tag}`, ...o }); };
  await mk("owner", "owner", { us: true }); await mk("admin", "admin", { us: true }); await mk("mgmt", "management", { us: true }); await mk("mgmtNon", "management", { us: false });
  await mk("pm", "engineering", { us: true }); await mk("eng", "engineering", { us: true }); await mk("proc", "procurement", { us: true }); await mk("ops", "operations", { us: true });
  await mk("fin", "finance", { us: true }); await mk("fin2", "finance", { us: true }); await mk("legal", "legal", { us: true }); await mk("emp", "sales", { us: true });
  await mk("salesLead", "sales", { us: true }); await mk("empNon", "engineering", { us: false }); await mk("hrEmp", "hr", { us: true });
  await mk("partner", "partner", { company: `Acme${run}` }); await mk("vendor", "vendor", { company: `Bolt${run}` }); await mk("disabled", "sales", { us: true });
  DEPT = (await sql("insert into departments(code, key, name, manager_id) values ($1, $2, $3, $4) returning id", [`P6${run.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`, `p6${run}`, `Sales ${tag}`, U.salesLead.id]))[0].id;
  await sql("update profiles set department_id = $1 where id = any($2)", [DEPT, [U.emp.id, U.salesLead.id, U.disabled.id]]);
  await sql("update profiles set disabled = true where id = $1", [U.disabled.id]);
  PROJ = await rec("company.projects", "Project", "Active", { manager_id: U.pm.id, manager: "PM", code: `P${run.slice(0, 4)}` });
  PROJ_US = await rec("company.projects", "US project", "Active", { manager_id: U.pm.id, manager: "PM" }, { controlled: true });
  VENDOR = await rec("operations.vendors", "Vendor A", "Approved", { country: "US" });
  VENDOR2 = await rec("operations.vendors", "Vendor B", "Approved", { country: "AE" });
  VENDOR_NEW = await rec("operations.vendors", "Vendor C", "Prospect", { country: "US" });
});
after(async () => { fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p6.json"), JSON.stringify(EV, null, 1)); });

/* ------------------------------------------- Scenario 1: purchase end to end ------------------------------------------- */
test("Scenario 1 — purchase end to end: request → review → quotations → selection → approval → PO → order → delivery → receiving → closed", async () => {
  await sql("insert into records(section, title, status, data) values ('finance.budget', $1, 'Approved', $2)", [`${tag} budget`, { project_ref: PROJ.id, planned: 50000, currency: "USD", department: "Sales" }]);
  const pr = await prToApproval("Laptops", 4000, { project: PROJ.id });
  assert.match((await get(pr.record)).data.number, /^AGR-PR-\d{4}-\d{4,}$/);
  const ap = await pendingFor(pr.record);
  assert.equal(ap.length, 1, "≤5,000: one level, the requester's department lead");
  assert.equal(ap[0].approver_id, U.salesLead.id);
  assert.equal(Number(ap[0].basis.selected_amount), 3800);
  await fails(decide("emp", ap[0].id, "approved"), /not yours/);
  await decide("salesLead", ap[0].id, "approved");
  let i = await inst(pr.record);
  assert.equal(i.cur, "order", "purchase record created automatically, then the order task");
  const prr = await get(pr.record);
  assert.ok(prr.data.purchase_ref); assert.equal(Number(prr.data.approved_amount), 3800);
  const po = await get(prr.data.purchase_ref);
  assert.equal(po.section, "operations.procurement"); assert.equal(po.status, "Approved"); assert.match(po.data.number, /^AGR-PO-/);
  assert.equal(Number(po.data.amount), 3800); assert.equal(po.data.vendor_ref, VENDOR.id);
  // the order is placed by a person: completing the task moves the process on
  const task = (await sql("select r.* from wf_links l join records r on r.id = l.record_id where l.run_id = $1 and l.kind = 'task'", [i.run]))[0];
  assert.equal(task.section, "company.tasks"); assert.equal(task.data.project_ref, PROJ.id);
  assert.equal(task.data.assignee_id, undefined, "a role step: the task waits for a member of the role");
  await act("proc", i.run, "done");
  assert.equal((await get(task.id)).status, "Completed", "completing the step completes its task");
  i = await inst(pr.record); assert.equal(i.cur, "delivery"); assert.equal(i.status, "waiting");
  assert.equal((await get(po.id)).status, "Ordered");
  const wt = (await sql("select r.* from wf_links l join records r on r.id = l.record_id where l.run_id = $1 and l.kind = 'task'", [i.run]))[0];
  assert.equal(wt.status, "Waiting"); assert.equal(wt.data.waiting_kind, "Supplier");
  // partial delivery, then the rest
  let rr = await call("ops", "ops_receive", [po.id, 1, 0, "Good", null, null]);
  assert.equal(rr.status, "Partially delivered");
  i = await inst(pr.record); assert.equal(i.cur, "receiving");
  await fails(act("ops", i.run, "submit"), /Not everything has been received/);
  rr = await call("ops", "ops_receive", [po.id, 1, 0, "Good", null, null]);
  assert.equal(rr.status, "Received");
  i = await inst(pr.record);
  assert.equal(i.status, "completed"); assert.equal(i.outcome, "completed");
  assert.equal((await get(pr.record)).status, "Closed");
  const ev = await events(i.id);
  for (const k of ["started", "step_entered:request", "step_completed:tech_review", "vendor_selected:vendor_selection", "approval_requested:approval", "approval_decided:approval", "purchase_created:purchase", "automation_done:ordered", "received:delivery", "received:receiving", "completed"])
    assert.ok(ev.includes(k), `event ${k} in ${ev.join(", ")}`);
  EV.scenarios.s1 = { number: prr.data.number, po: po.data.number, events: ev };
});
