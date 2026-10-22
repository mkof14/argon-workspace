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
import { ENV, admin, makeUser, pool, signIn, sql, uid } from "./_stack.ts";
import { retrieve } from "../../src/lib/server/retrieval.ts";

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
const call = async (k: string, fn: string, args: any[] = []) => (await as(k, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args.map((a) => (Array.isArray(a) ? JSON.stringify(a) : a))))[0].r;
// v24 (Phase 7) moved this authority to the Workflow Admin capability; on the rolled-back v23 schema (B51) the
// earlier rule applies: owners, administrators and management. The checks below follow the schema they run on.
let V24: boolean | null = null;
const v24 = async () => (V24 ??= (await sql("select to_regproc('public.has_cap') is not null ok"))[0].ok);
const WFA = async () => ((await v24()) ? /Workflow Admin/ : /Only owners, administrators and management|owners and administrators/);
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
    { request_ref: res.record, vendor_ref: v.id, vendor_ref_title: v.title, amount, currency: "USD", lead_time_days: 10, valid_until: D(30) }]))[0];
  const q2 = (await as("proc", "insert into records(section, title, status, data) values ('operations.quotations', $1, 'Received', $2) returning id", [`${tag} Q2 ${title}`,
    { request_ref: res.record, vendor_ref: VENDOR2.id, vendor_ref_title: VENDOR2.title, amount: amount + 300, currency: "USD", lead_time_days: 5, valid_until: D(30) }]))[0];
  await act("proc", i.run, "submit");
  i = await inst(res.record); assert.equal(i.cur, "vendor_selection");
  // the side-by-side comparison: facts only (lowest price, shortest lead time), never a "best" pick
  const cmp = await call("proc", "ops_compare_quotes", [res.record]);
  assert.equal(cmp.quotes.length, 2, "both quotations side by side");
  const c1 = cmp.quotes.find((x: any) => x.id === q1.id), c2 = cmp.quotes.find((x: any) => x.id === q2.id);
  assert.equal(c1.lowest_in_currency, true); assert.equal(c1.shortest_lead_time, false);
  assert.equal(c2.lowest_in_currency, false); assert.equal(c2.shortest_lead_time, true);
  assert.equal(c1.selected, false); assert.doesNotMatch(JSON.stringify(cmp), /\bbest\b/i, "no quotation is called best");
  await call("proc", "ops_select_quote", [res.record, q1.id, "Lower price and the vendor already supplied us without problems"]);
  assert.equal((await call("proc", "ops_compare_quotes", [res.record])).quotes.find((x: any) => x.id === q1.id).selected, true, "the choice shows in the comparison");
  i = await inst(res.record); assert.equal(i.cur, "approval");
  return { ...res, q1: q1.id, q2: q2.id, inst: i };
}

before(async () => {
  await v24(); // resolve the schema once, so a refusal pattern never awaits after its call has started
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
  assert.equal(Number(ap[0].basis.selected_amount), 4000);
  await fails(decide("emp", ap[0].id, "approved"), /not yours/);
  await decide("salesLead", ap[0].id, "approved");
  let i = await inst(pr.record);
  assert.equal(i.cur, "order", "purchase record created automatically, then the order task");
  const prr = await get(pr.record);
  assert.ok(prr.data.purchase_ref); assert.equal(Number(prr.data.approved_amount), 4000);
  const po = await get(prr.data.purchase_ref);
  assert.equal(po.section, "operations.procurement"); assert.equal(po.status, "Approved"); assert.match(po.data.number, /^AGR-PO-/);
  assert.equal(Number(po.data.amount), 4000); assert.equal(po.data.vendor_ref, VENDOR.id);
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

/* ------------------------------------------- Scenario 2: concurrent numbering ------------------------------------------- */
test("Scenario 2 — 25 requests raised at the same moment get 25 different numbers, in one sequence", async () => {
  const res = await Promise.all(Array.from({ length: 25 }, (_, n) => call(n % 2 ? "emp" : "hrEmp", "ops_request_create", ["purchase", `${tag} parallel ${n}`, { item: `Item ${n}`, qty: 1, est_amount: 100, currency: "USD" }, null])));
  const nums = res.map((r: any) => r.number);
  assert.equal(new Set(nums).size, 25, "no duplicate numbers");
  const seq = nums.map((x: string) => Number(x.split("-").pop())).sort((a: number, b: number) => a - b);
  assert.equal(seq[24] - seq[0], 24, "one unbroken sequence (no gaps between concurrent requests)");
  // the counter itself under direct concurrency (the allocation function every type uses)
  const direct = await Promise.all(Array.from({ length: 40 }, () => sql("select public.ops_number('company.issues') n")));
  assert.equal(new Set(direct.map((r: any) => r[0].n)).size, 40);
  await fails(as("emp", "update records set data = data || '{\"number\": \"AGR-PR-0000-0001\"}' where id = $1", [res[1].record]), /set by the process|set by Workspace/);
  EV.numbering = { first: nums.sort()[0], last: nums.sort()[24], count: 25, direct_unique: 40 };
});

/* ------------------------------------------- Scenario 3: amount changes after approval ------------------------------------------- */
test("Scenario 3 — a revised quotation ($10,000 → $15,000) makes the approval stale; a new approval is needed and no purchase is duplicated", async () => {
  const pr = await prToApproval("Generator", 10000, { project: PROJ.id });
  let ap = await pendingFor(pr.record);
  assert.equal(ap.length, 1); assert.equal(ap[0].approver_id, U.salesLead.id, "level 1: department lead");
  await decide("salesLead", ap[0].id, "approved");
  ap = await pendingFor(pr.record);
  assert.ok(ap.length >= 1 && ap.every((a: any) => a.step === 2), "level 2 (finance) is now pending");
  const finAp = ap.find((a: any) => a.approver_id === U.fin.id); assert.ok(finAp, "finance can approve level 2");
  // the vendor revises the quotation
  await as("proc", "update records set data = data || '{\"amount\": 15000}' where id = $1", [pr.q1]);
  assert.equal(Number((await get(pr.record)).data.selected_amount), 15000, "the request follows the revised quotation");
  const old = await sql("select status, count(*)::int n from approvals where wf_run = $1 group by 1", [pr.inst.run]);
  assert.ok(old.some((x: any) => x.status === "invalidated"), "the approvals given on $10,000 are invalidated");
  await fails(decide("fin", finAp.id, "approved"), /no longer applies/);
  let i = await inst(pr.record); assert.equal(i.cur, "approval"); assert.notEqual(i.run, pr.inst.run, "a new approval step run");
  ap = await pendingFor(pr.record);
  assert.equal(ap[0].step, 1); assert.equal(Number(ap[0].basis.selected_amount), 15000);
  await decide("salesLead", ap[0].id, "approved");
  ap = await pendingFor(pr.record);
  await decide("fin", ap.find((a: any) => a.approver_id === U.fin.id).id, "approved");
  i = await inst(pr.record); assert.equal(i.cur, "order");
  const prr = await get(pr.record); const po = await get(prr.data.purchase_ref);
  assert.equal(Number(po.data.amount), 15000); assert.equal(Number(prr.data.approved_amount), 15000);
  // a change after the purchase record exists: approval again, and still one purchase record (a person amends the order)
  await as("proc", "update records set data = data || '{\"amount\": 16000}' where id = $1", [pr.q1]);
  i = await inst(pr.record); assert.equal(i.cur, "approval");
  assert.equal((await get(pr.record)).data.approved_amount, undefined, "what was approved is withdrawn from the record");
  for (const lvl of [1, 2]) { ap = await pendingFor(pr.record); const a = ap.find((x: any) => x.step === lvl && [U.salesLead.id, U.fin.id].includes(x.approver_id)); await decide(a.approver_id === U.fin.id ? "fin" : "salesLead", a.id, "approved"); }
  const pos = await sql("select count(*)::int n from records where section = 'operations.procurement' and data->>'request_ref' = $1", [pr.record]);
  assert.equal(pos[0].n, 1, "no second purchase record");
  const ev = await events(i.id);
  assert.ok(ev.filter((e: string) => e.startsWith("approval_invalidated")).length >= 2); assert.ok(ev.includes("purchase_amend_needed:purchase"));
  EV.scenarios.s3 = { events: ev.filter((e: string) => /approval|purchase/.test(e)) };
});

/* ------------------------------------------- Scenario 4: payment is paid only when recorded ------------------------------------------- */
test("Scenario 4 — a payment request shows as paid only after Finance records the payment (and the approver cannot record it)", async () => {
  await fails(call("emp", "ops_request_create", ["payment", `${tag} card`, { payee: "Vendor A", amount: 100, currency: "USD", note: "card 4111 1111 1111 1111" }, null]), /card number/);
  await fails(call("emp", "ops_request_create", ["payment", `${tag} iban`, { payee: "Vendor A", amount: 100, currency: "USD", bank: "GB82WEST12345698765432" }, null]), /IBAN/);
  await fails(call("emp", "ops_request_create", ["payment", `${tag} pw`, { payee: "Vendor A", amount: 100, currency: "USD", bank_password: "x" }, null]), /secrets/);
  await fails(as("emp", "insert into records(section, title, status, data) values ('finance.payments', $1, 'Paid', $2)", [`${tag} direct paid`, { amount: 5, currency: "USD" }]), /starts as Requested/);
  const res = await call("emp", "ops_request_create", ["payment", `${tag} Consultant invoice`, { payee: "Consultant Ltd", amount: 2500, currency: "USD", due: D(10), project_ref: PROJ.id }, null]);
  assert.match(res.number, /^AGR-PAY-/);
  let i = await inst(res.record); await act("emp", i.run, "submit");
  i = await inst(res.record); assert.equal(i.cur, "review"); assert.equal(i.crole, "finance");
  await act("fin", i.run, "approved");
  i = await inst(res.record); assert.equal(i.cur, "approval");
  const ap = (await pendingFor(res.record)).find((a: any) => a.approver_id === U.fin.id);
  await decide("fin", ap.id, "approved");
  i = await inst(res.record); assert.equal(i.cur, "ready");
  await act("fin2", i.run, "submit");
  i = await inst(res.record); assert.equal(i.cur, "paid");
  assert.equal((await get(res.record)).status, "Ready for payment");
  await fails(act("fin2", i.run, "submit"), /Record the payment first/);
  await fails(as("fin2", "update records set status = 'Paid' where id = $1", [res.record]), /process actions|marked paid/);
  await fails(as("fin2", "update records set data = data || '{\"paid_on\": \"2026-01-01\"}' where id = $1", [res.record]), /set by the process/);
  const before = await call("fin2", "ops_overview");
  assert.ok((before.items.pay_unpaid?.ids || []).includes(res.record), "approved and not yet paid");
  await fails(call("fin", "ops_record_payment", [res.record, D(0), 2500, "BANK-REF-77", null]), /separation of duties/);
  await fails(call("emp", "ops_record_payment", [res.record, D(0), 2500, "BANK-REF-77", null]), /recorded by Finance/);
  await fails(call("fin2", "ops_record_payment", [res.record, D(0), 3000, "BANK-REF-77", null]), /more than the approved amount/);
  const r1 = await call("fin2", "ops_record_payment", [res.record, D(0), 1000, "BANK-REF-77", null]);
  assert.equal(r1.status, "Partially paid");
  i = await inst(res.record); assert.equal(i.cur, "paid", "a partial payment does not finish the step");
  const r2 = await call("fin2", "ops_record_payment", [res.record, D(0), 1500, "BANK-REF-78", null]);
  assert.equal(r2.status, "Paid");
  i = await inst(res.record); assert.equal(i.cur, "reconcile");
  const after = await call("fin2", "ops_overview");
  assert.ok(!(after.items.pay_unpaid?.ids || []).includes(res.record));
  await act("fin2", i.run, "approved");
  i = await inst(res.record); assert.equal(i.status, "completed"); assert.equal((await get(res.record)).status, "Reconciled");
  const ev = await events(i.id); assert.equal(ev.filter((e: string) => e.startsWith("payment_recorded")).length, 2);
  EV.scenarios.s4 = { number: res.number, events: ev };
});

/* ------------------------------------------- Scenario 5: contract approval belongs to one version ------------------------------------------- */
const docWithVersion = async (title: string) => {
  const d = await rec("company.documents", title, "Draft", { doc_type: "Contract", classification: "Internal" }, { by: "legal" });
  const v1 = (await sql("insert into document_versions(record_id, label, major, minor, path, file_name, size, sha256, author) values ($1, '1.0', 1, 0, $2, 'c.pdf', 10, $3, $4) returning id", [d.id, `${d.id}/v1-${run}.pdf`, "a".repeat(64), U.legal.id]))[0].id;
  await sql("update records set data = data || jsonb_build_object('current_version_id', $2::text) where id = $1", [d.id, v1]);
  return { id: d.id, v1 };
};
test("Scenario 5 — contract: V1 approved, V2 uploaded → the V1 approval does not apply; V2 is approved before signature", async () => {
  const res = await call("emp", "ops_request_create", ["contract", `${tag} Supply agreement`, { counterparty: "Harbor Marine LLC", type: "Supply" }, null]);
  assert.match(res.number, /^AGR-CTR-/);
  let i = await inst(res.record); await act("emp", i.run, "submit");
  i = await inst(res.record); assert.equal(i.cur, "draft");
  await fails(act("legal", i.run, "done"), /Link the contract document/);
  const doc = await docWithVersion("Supply agreement document");
  await as("legal", "update records set data = data || jsonb_build_object('document_ref', $2::text) where id = $1", [res.record, doc.id]);
  await act("legal", i.run, "done");
  i = await inst(res.record); assert.equal(i.cur, "internal_review"); await act("legal", i.run, "approved");
  i = await inst(res.record); assert.equal(i.cur, "counterparty"); assert.equal(i.status, "waiting"); await act("legal", i.run, "received");
  i = await inst(res.record); assert.equal(i.cur, "approval");
  let ap = await pendingFor(res.record);
  assert.equal(ap[0].basis.document_version, doc.v1); assert.equal(ap[0].version_id, doc.v1);
  await decide("legal", ap.find((a: any) => a.approver_id === U.legal.id).id, "approved");
  ap = await pendingFor(res.record); await decide("mgmt", ap.find((a: any) => a.approver_id === U.mgmt.id).id, "approved");
  i = await inst(res.record); assert.equal(i.cur, "signature");
  const v1run = i.run;
  // version 2 of the document
  const v2 = (await sql("insert into document_versions(record_id, label, major, minor, path, file_name, size, sha256, author) values ($1, '2.0', 2, 0, $2, 'c2.pdf', 11, $3, $4) returning id", [doc.id, `${doc.id}/v2-${run}.pdf`, "b".repeat(64), U.legal.id]))[0].id;
  await sql("update records set data = data || jsonb_build_object('current_version_id', $2::text) where id = $1", [doc.id, v2]); // as the upload route does (service role)
  i = await inst(res.record); assert.equal(i.cur, "approval", "signature is no longer open: approval of version 2 first");
  assert.ok((await sql("select count(*)::int n from approvals where record_id = $1 and status = 'invalidated' and version_id = $2", [res.record, doc.v1]))[0].n >= 2);
  await fails(act("legal", v1run, "submit"), /already done/);
  ap = await pendingFor(res.record); assert.equal(ap[0].basis.document_version, v2);
  await decide("legal", ap.find((a: any) => a.approver_id === U.legal.id).id, "approved");
  ap = await pendingFor(res.record); await decide("mgmt", ap.find((a: any) => a.approver_id === U.mgmt.id).id, "approved");
  i = await inst(res.record); assert.equal(i.cur, "signature");
  await fails(act("legal", i.run, "submit"), /Fill in first: signed_on/);
  await as("legal", "update records set data = data || '{\"signed_on\": \"2026-10-01\", \"end_date\": \"2026-12-01\"}' where id = $1", [res.record]);
  await act("legal", i.run, "submit");
  i = await inst(res.record); assert.equal(i.cur, "obligations"); await act("legal", i.run, "submit");
  i = await inst(res.record); assert.equal(i.status, "completed"); assert.equal((await get(res.record)).status, "Active");
  EV.scenarios.s5 = { v1: doc.v1, v2, events: await events(i.id) };
  EV.contract = res.record;
});

/* ------------------------------------------- Scenario 6: obligations in deadlines and attention ------------------------------------------- */
test("Scenario 6 — a contract obligation appears in deadlines and attention for those who may see it, with its reason", async () => {
  const c = EV.contract;
  const ob = (await as("legal", "insert into records(section, title, status, data) values ('legal.contract_obligations', $1, 'Open', $2) returning id", [`${tag} Quarterly report to counterparty`, { contract_ref: c, due: D(-2), description: "Send the quarterly delivery report", owner_id: U.legal.id }]))[0].id;
  const soon = (await as("legal", "insert into records(section, title, status, data) values ('legal.contract_obligations', $1, 'Open', $2) returning id", [`${tag} Insurance certificate`, { contract_ref: c, due: D(5), description: "Provide the insurance certificate" }]))[0].id;
  const att = await call("legal", "ops_attention");
  const lst = await call("legal", "ops_list", ["obl_overdue", 500, tag]);
  const a = lst.find((x: any) => x.record_id === ob); assert.ok(a); assert.equal(a.kind, "obl_overdue"); assert.match(a.reason, /Overdue since/);
  assert.ok(att.some((x: any) => x.record_id === ob) || att.length === 200, "in attention (the list shows the first 200 by rank)");
  const dl = await call("legal", "ops_deadlines", [60, tag]);
  assert.ok(dl.some((x: any) => x.record_id === soon && x.kind === "obligation")); assert.ok(dl.some((x: any) => x.record_id === c && x.kind === "contract_end"));
  const ov = await call("mgmt", "ops_overview"); assert.ok(ov.items.obl_overdue.count >= 1 && ov.items.obl_due_soon.count >= 1);
  assert.ok((await call("mgmt", "ops_list", ["obl_overdue", 500, tag])).some((x: any) => x.record_id === ob)); assert.ok((await call("mgmt", "ops_list", ["obl_due_soon", 500, tag])).some((x: any) => x.record_id === soon));
  const hr = await call("hrEmp", "ops_attention"); assert.ok(!hr.some((x: any) => x.record_id === ob), "HR cannot read contract obligations");
  EV.scenarios.s6 = { overdue: a, deadlines: dl.length };
});

/* ------------------------------------------- Scenario 7: engineering change traceability ------------------------------------------- */
test("Scenario 7 — engineering change: impact record before approval, parallel approval, implementation, verification, documents — every step traceable", async () => {
  const bom = await rec("technical.bom", "Power module", "Active", { config: "C20 Base" });
  const res = await call("pm", "ops_request_create", ["change", `${tag} Replace inverter`, { reason: "Supplier end-of-life", config: "C20 Base", project_ref: PROJ.id }, "High"]);
  assert.match(res.number, /^AGR-ECR-/);
  let i = await inst(res.record); await act("pm", i.run, "submit");
  i = await inst(res.record); assert.equal(i.cur, "impact");
  await fails(act("eng", i.run, "submit"), /Confirm the impact record first/);
  await fails(call("eng", "ops_ecr_confirm_impact", [res.record, null]), /Fill in the impact first/);
  const cand = await call("eng", "ops_ecr_candidates", [res.record]);
  assert.ok(cand.some((x: any) => x.id === bom.id && /Same configuration/.test(x.reason)), "deterministic link with its reason");
  await fails(as("eng", "update records set data = data || '{\"impact_confirmed_at\": \"2026-01-01\"}' where id = $1", [res.record]), /set by the process/);
  await as("eng", "update records set data = data || $2 where id = $1", [res.record, { impact_summary: "New inverter model; wiring change", impact_cost: 12000, impact_schedule_days: 5, impact_configs: ["C20 Base"], impact_bom: [bom.id] }]);
  await call("eng", "ops_ecr_confirm_impact", [res.record, "Checked with the supplier"]);
  i = await inst(res.record); assert.equal(i.cur, "technical_review");
  await fails(act("pm", i.run, "approved"), /own request/);
  await act("eng", i.run, "approved");
  i = await inst(res.record); assert.equal(i.cur, "approval", "the impact check passed by itself");
  const ap = await pendingFor(res.record);
  assert.deepEqual([...new Set(ap.map((a: any) => a.step))].sort(), [1, 2], "cost > 10,000: engineering and management in parallel");
  await decide("mgmt", ap.find((a: any) => a.approver_id === U.mgmt.id).id, "approved");
  i = await inst(res.record); assert.equal(i.cur, "approval", "parallel: waits for both");
  await decide("eng", ap.find((a: any) => a.approver_id === U.eng.id).id, "approved");
  i = await inst(res.record); assert.equal(i.cur, "implementation");
  await act("eng", i.run, "done");
  i = await inst(res.record); assert.equal(i.cur, "verification");
  await act("eng", i.run, "changes_requested", "Torque values missing");
  i = await inst(res.record); assert.equal(i.cur, "implementation", "verification sent it back");
  await act("eng", i.run, "done");
  i = await inst(res.record); await act("eng", i.run, "approved");
  i = await inst(res.record); assert.equal(i.cur, "doc_update"); await act("eng", i.run, "done");
  i = await inst(res.record); assert.equal(i.status, "completed"); assert.equal((await get(res.record)).status, "Closed");
  const detail = await call("pm", "ops_instance", [i.id]);
  assert.ok(detail.runs.length >= 9); assert.ok(detail.links.filter((l: any) => l.kind === "task").length >= 3);
  assert.ok(detail.events.some((e: any) => e.kind === "impact_confirmed"));
  EV.scenarios.s7 = { number: res.number, runs: detail.runs.map((r: any) => `${r.step_id}:${r.outcome || r.status}`) };
});

/* ------------------------------------------- Scenario 8: issue from damaged receiving ------------------------------------------- */
test("Scenario 8 — damaged goods at receiving open an issue (with its own process) and a vendor follow-up task; nothing is sent to the vendor", async () => {
  const pr = await prToApproval("Cables", 1000);
  await decide("salesLead", (await pendingFor(pr.record))[0].id, "approved");
  let i = await inst(pr.record); await act("proc", i.run, "done");
  const po = (await get(pr.record)).data.purchase_ref;
  const out0 = (await sql("select count(*)::int n from outbound_messages"))[0].n;
  const rr = await call("ops", "ops_receive", [po, 2, 1, "Damaged", "One reel crushed", null]);
  assert.ok(rr.issue && rr.task); assert.equal(rr.status, "Partially delivered");
  const iss = await get(rr.issue);
  assert.equal(iss.section, "company.issues"); assert.match(iss.data.number, /^AGR-ISS-/); assert.equal(iss.data.source_ref, rr.receipt); assert.equal(iss.data.purchase_ref, po);
  const ii = await inst(rr.issue); assert.equal(ii.def_code, "ISSUE"); assert.equal(ii.cur, "investigate");
  const tk = await get(rr.task); assert.match(tk.title, /Follow up with the vendor/); assert.equal(tk.data.assignee_id, U.ops.id);
  const rc = await get(rr.receipt); assert.equal(rc.status, "Discrepancy"); assert.equal(Number(rc.data.qty_rejected), 1);
  assert.equal((await sql("select count(*)::int n from outbound_messages"))[0].n, out0, "no e-mail to the vendor");
  i = await inst(pr.record); assert.equal(i.cur, "receiving");
  await fails(as("ops", "insert into records(section, title, data) values ('operations.receipts', 'x', '{}')"), /Receive goods/);
  await act("ops", i.run, "accept_partial", "Replacement agreed in the issue");
  i = await inst(pr.record); assert.equal(i.status, "completed");
  EV.scenarios.s8 = { issue: iss.data.number, receipt: rr.receipt };
});

/* ------------------------------------------- Scenario 9: waiting for someone outside ------------------------------------------- */
test("Scenario 9 — waiting for the vendor is a Waiting task (Phase 5 Waiting For) and pauses the process SLA; no message goes out", async () => {
  const pr = await prToApproval("Brackets", 800);
  await decide("salesLead", (await pendingFor(pr.record))[0].id, "approved");
  let i = await inst(pr.record); await act("proc", i.run, "done");
  i = await inst(pr.record); assert.equal(i.cur, "delivery"); assert.equal(i.status, "waiting"); assert.ok(i.paused_since);
  const t = (await sql("select r.* from wf_links l join records r on r.id = l.record_id where l.run_id = $1", [i.run]))[0];
  assert.equal(t.status, "Waiting"); assert.equal(t.data.waiting_kind, "Supplier"); assert.match(t.data.waiting_on || "", /Vendor A/);
  const wf = await as("mgmt", "select * from public.waiting_for() where record_id = $1", [t.id]);
  assert.equal(wf.length, 1, "Phase 5 Waiting For shows it"); assert.equal(wf[0].bucket, "external"); assert.match(wf[0].party_name, /Vendor A/);
  const ov = await call("mgmt", "ops_overview"); assert.ok((ov.items.wait_open?.ids || []).includes(pr.record));
  const due0 = i.due_at;
  await sql("update wf_instances set paused_since = now() - interval '3 days' where id = $1", [i.id]);
  await call("ops", "ops_receive", [(await get(pr.record)).data.purchase_ref, 2, 0, "Good", null, null]);
  i = await inst(pr.record);
  assert.equal(i.status, "completed");
  const pt = (await sql("select extract(epoch from paused_total) s from wf_instances where id = $1", [i.id]))[0].s;
  assert.ok(Number(pt) >= 3 * 86400 - 5, "the waiting time is counted as paused");
  EV.scenarios.s9 = { paused_seconds: Number(pt), due_before: due0 };
});

/* ------------------------------------------- Scenario 10: one SLA escalation ------------------------------------------- */
test("Scenario 10 — an overdue approval: one overdue notice and one escalation to management, never repeated", async () => {
  const pr = await prToApproval("Monitors", 3000);
  const i = await inst(pr.record);
  await sql("update wf_step_runs set due_at = now() - interval '4 days' where id = $1", [i.run]);
  const t1 = (await sql("select public.wf_sla_tick() r"))[0].r;
  const t2 = (await sql("select public.wf_sla_tick() r"))[0].r;
  const run = (await sql("select * from wf_step_runs where id = $1", [i.run]))[0];
  assert.equal(run.escalation_level, 1); assert.ok(run.overdue_at);
  const ev = (await events(i.id)).filter((e: string) => /overdue|escalated/.test(e));
  assert.deepEqual(ev, ["overdue:approval", "escalated:approval"], "exactly once each, even after a second run");
  const nEsc = (await sql("select count(*)::int n from notifications where kind = 'wf_escalated' and key like $1", [`wf-esc:${i.run}%`]))[0].n;
  assert.ok(nEsc >= 1); assert.equal((await sql("select count(*)::int n from notifications where user_id = $1 and key like $2", [U.mgmt.id, `wf-esc:${i.run}%`]))[0].n, 1);
  assert.equal((await sql("select count(*)::int n from notifications where user_id = $1 and key like 'wf-ap:%' and record_id = $2", [U.salesLead.id, pr.record]))[0].n, 1, "the approver is told once");
  assert.ok((await call("mgmt", "ops_list", ["sla_escalated", 500, tag])).some((x: any) => x.record_id === pr.record));
  assert.ok((await call("mgmt", "ops_list", ["sla_overdue", 500, tag])).some((x: any) => x.record_id === pr.record));
  EV.sla = { tick1: t1, tick2: t2, escalation_notices: nEsc };
});

/* ------------------------------------------- business days ------------------------------------------- */
test("SLA calendar: business days skip the configured weekend; hours and calendar days are exact", async () => {
  const r = (await sql(`select public.sla_add('2026-10-16 10:00Z', 1, 'business_days') a, public.sla_add('2026-10-16 10:00Z', 3, 'business_days') b,
    public.sla_add('2026-10-16 10:00Z', 1, 'calendar_days') c, public.sla_add('2026-10-16 10:00Z', 5, 'hours') d, public.sla_add('2026-10-16 10:00Z', 1, 'business_days', array[5,6]) e`))[0];
  assert.equal(new Date(r.a).toISOString(), "2026-10-19T10:00:00.000Z", "Friday + 1 business day = Monday");
  assert.equal(new Date(r.b).toISOString(), "2026-10-21T10:00:00.000Z");
  assert.equal(new Date(r.c).toISOString(), "2026-10-17T10:00:00.000Z");
  assert.equal(new Date(r.d).toISOString(), "2026-10-16T15:00:00.000Z");
  assert.equal(new Date(r.e).toISOString(), "2026-10-18T10:00:00.000Z", "Friday–Saturday weekend: next business day is Sunday");
});

/* ------------------------------------------- Scenario 11: a hidden (US-persons-only) project ------------------------------------------- */
test("Scenario 11 — purchase, contract, change and issue of a US-persons-only project are invisible everywhere to non-US people", async () => {
  await fails(call("empNon", "ops_request_create", ["purchase", `${tag} leak`, { item: "x", qty: 1, est_amount: 10, currency: "USD", project_ref: PROJ_US.id }, null]), /Linked record not found/);
  const pr = await prToApproval("Sensor heads", 2000, { project: PROJ_US.id });
  const prr = await get(pr.record); assert.equal(prr.controlled, true, "the request inherits US Persons Only from its project");
  const q = await get(pr.q1); assert.equal(q.controlled, true, "so does its quotation");
  const ecr = await call("pm", "ops_request_create", ["change", `${tag} US change`, { reason: "r", project_ref: PROJ_US.id }, null]);
  const ctr = await call("emp", "ops_request_create", ["contract", `${tag} US contract`, { counterparty: "Gov Lab", type: "Supply", project_ref: PROJ_US.id }, null]);
  const iss = (await as("ops", "insert into records(section, title, status, data) values ('company.issues', $1, 'Open', $2) returning *", [`${tag} US issue`, { type: "Technical", project_ref: PROJ_US.id, due: D(-1) }]))[0];
  for (const id of [ecr.record, ctr.record, iss.id]) assert.equal((await get(id)).controlled, true);
  const tasks = await sql("select r.controlled from wf_links l join records r on r.id = l.record_id where l.instance_id in (select id from wf_instances where record_id = any($1))", [[pr.record, ecr.record, ctr.record]]);
  assert.ok(tasks.every((t: any) => t.controlled), "tasks made by those processes are US Persons Only too");
  const hidden = [pr.record, pr.q1, ecr.record, ctr.record, iss.id];
  for (const k of ["empNon", "mgmtNon"]) {
    const ids = (await as(k, "select public.ops_visible_ids() id")).map((r: any) => r.id);
    for (const h of hidden) assert.ok(!ids.includes(h), `${k} must not see ${h}`);
    const ov = await call(k, "ops_overview");
    for (const kind of Object.keys(ov.items)) for (const h of hidden) assert.ok(!ov.items[kind].ids.includes(h), `${k} overview ${kind}`);
    const att = await call(k, "ops_attention"); assert.ok(!att.some((x: any) => hidden.includes(x.record_id)));
    const dl = await call(k, "ops_deadlines", [60]); assert.ok(!dl.some((x: any) => hidden.includes(x.record_id)));
    for (const intent of ["purchases_open", "issues_open", "changes_open", "contracts_open", "sla_overdue"]) {
      const a = await call(k, "ops_assistant", [intent, null]); assert.ok(!a.items.some((x: any) => hidden.includes(x.record_id)), `${k} assistant ${intent}`);
    }
    await fails(call(k, "ops_instance", [pr.record]), /not found/);
    await fails(call(k, "ops_budget", [PROJ_US.id]), /not found/);
    const n = (await as(k, "select count(*)::int n from records where id = any($1)", [hidden]))[0].n; assert.equal(n, 0, "row-level security agrees");
  }
  const notes = await sql("select count(*)::int n from notifications where record_id = any($1) and user_id = any($2)", [hidden, [U.empNon.id, U.mgmtNon.id]]);
  assert.equal(notes[0].n, 0, "no notification about them reached a non-US person");
  const us = (await as("mgmt", "select public.ops_visible_ids() id")).map((r: any) => r.id);
  for (const h of hidden) assert.ok(us.includes(h), "a US person in management sees them");
  EV.security.hidden_project = { hidden: hidden.length, checked_for: ["empNon", "mgmtNon"] };
});

/* ------------------------------------------- Scenario 12: the Assistant ------------------------------------------- */
test("Scenario 12 — Assistant: «What purchases need my approval?» answers from the approvals with sources; nothing for someone else", async () => {
  const pr = await prToApproval("Docking station", 1200);
  const a = await call("salesLead", "ops_assistant", ["my_approvals", "operations.requests"]);
  assert.equal(a.kind, "fact");
  const it = a.items.find((x: any) => x.record_id === pr.record); assert.ok(it, "the pending request is listed");
  assert.equal(Number(it.amount), 1200); assert.equal(it.currency, "USD"); assert.match(it.number, /^AGR-PR-/); assert.match(it.requester, /^emp /);
  const b = await call("hrEmp", "ops_assistant", ["my_approvals", "operations.requests"]);
  assert.ok(!b.items.some((x: any) => x.record_id === pr.record));
  const c = await call("hrEmp", "ops_assistant", ["horoscope", null]); assert.equal(c.kind, "unavailable");
  const bud = await call("mgmt", "ops_assistant", ["budget", PROJ.id]); assert.equal(bud.kind, "calculation"); assert.match(bud.formula, /Remaining = Budget/);
  const proc = await call("emp", "ops_assistant", ["process", (await get(pr.record)).data.number]); assert.equal(proc.kind, "fact"); assert.equal(proc.items[0].processes[0].step, "Approval");
  // the same question through the Assistant's retrieval, as the signed-in approver (row-level security on)
  const lead = (await signIn(U.salesLead.email)).c;
  const r = await retrieve(lead, { id: U.salesLead.id, role: "sales" }, { q: "What purchases need my approval?" });
  assert.ok(r.intents.includes("ops_my_approvals")); assert.ok(r.sources.some((x) => x.id === pr.record && /approval level 1/.test(x.excerpt) && /USD 1200/.test(x.excerpt)), "the request is a numbered source with its amount");
  assert.ok(r.facts.some((f) => /Operations \(my_approvals, fact\)/.test(f)));
  const other = await retrieve((await signIn(U.hrEmp.email)).c, { id: U.hrEmp.id, role: "hr" }, { q: "What purchases need my approval?" });
  assert.ok(!other.sources.some((x) => x.id === pr.record)); assert.ok(other.facts.some((f) => /unavailable/.test(f)));
  EV.scenarios.s12 = { answer: { kind: a.kind, item: it }, other: b.kind };
});

/* ------------------------------------------- Scenario 13: extraction needs a person ------------------------------------------- */
test("Scenario 13 — values extracted from a document are proposals: nothing is created until a person confirms (and their edits win)", async () => {
  const pr = await call("emp", "ops_request_create", ["purchase", `${tag} Extraction`, { item: "Valves", qty: 4, est_amount: 900, currency: "USD" }, null]);
  const doc = await rec("company.documents", "Vendor quote PDF", "Draft", { doc_type: "Supplier quotation", request_ref: pr.record }, { by: "proc" });
  const before = (await sql("select count(*)::int n from records where section = 'operations.quotations' and data->>'request_ref' = $1", [pr.record]))[0].n;
  const pid = (await sql("select public.ops_proposal_add($1, $2, 'quotation', 'operations.quotations', $3, 'pattern', $4) id", [U.proc.id, doc.id, { title: "Quote from document", amount: 950, currency: "USD", vendor_ref: VENDOR.id }, { amount: "page 1: Total USD 950.00" }]))[0].id;
  assert.equal((await sql("select count(*)::int n from records where section = 'operations.quotations' and data->>'request_ref' = $1", [pr.record]))[0].n, before, "a proposal creates nothing");
  await fails(sql("select public.ops_proposal_add($1, $2, 'quotation', 'operations.quotations', $3, 'model', null)", [U.proc.id, doc.id, { amount: 1, cvv: "123" }]), /secrets/);
  await fails(call("hrEmp", "ops_proposal_decide", [pid, true, null, null]), /not found|cannot create/);
  const res = await call("proc", "ops_proposal_decide", [pid, true, { amount: 925 }, "Total corrected from the PDF"]);
  const q = await get(res.record);
  assert.equal(Number(q.data.amount), 925, "the person's correction wins"); assert.equal(q.data.request_ref, pr.record); assert.equal(q.data.confirmed_by_id, U.proc.id);
  assert.equal(q.data.extracted.method, "pattern");
  const ev = await sql("select detail from wf_events where kind = 'proposal_accepted' and detail->>'proposal' = $1", [pid]);
  assert.deepEqual(ev[0].detail.changed, ["amount"]);
  await fails(call("proc", "ops_proposal_decide", [pid, true, null, null]), /Already accepted/);
  // an obligation proposal from a contract must be described in a person's words
  const p2 = (await sql("select public.ops_proposal_add($1, $2, 'obligation', 'legal.contract_obligations', $3, 'model', null) id", [U.legal.id, EV.contract, { title: "Deliver monthly report", due: D(20) }]))[0].id;
  await fails(call("legal", "ops_proposal_decide", [p2, true, null, null]), /Describe the obligation/);
  const r2 = await call("legal", "ops_proposal_decide", [p2, true, { description: "Monthly delivery report to the client" }, null]);
  assert.equal((await get(r2.record)).data.contract_ref, EV.contract);
  const p3 = (await sql("select public.ops_proposal_add($1, $2, 'obligation', 'legal.contract_obligations', $3, 'model', null) id", [U.legal.id, EV.contract, { title: "Rejected one" }]))[0].id;
  await call("legal", "ops_proposal_decide", [p3, false, null, "Not in the contract"]);
  assert.equal((await sql("select status from ops_proposals where id = $1", [p3]))[0].status, "rejected");
  EV.scenarios.s13 = { proposal: pid, record: res.record };
});

/* ------------------------------------------- Scenario 14: definitions, validation, versions ------------------------------------------- */
test("Scenario 14 — definition V1/V2: running processes keep V1, new ones take V2; published versions cannot change; validation catches every error class", async () => {
  // validation
  const base = { code: `T${run.toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 30), name: "Test", source_section: "company.requests" };
  const errs = async (steps: any[], extra: any = {}) => (await call("owner", "wf_validate", [{ ...base, steps, ...extra }])).map((e: any) => e.code);
  assert.ok((await errs([{ id: "a", name: "A", type: "TASK", responsible: { kind: "requester" }, on: { success: "$complete" } }, { id: "b", name: "B", type: "TASK", responsible: { kind: "requester" } }])).includes("unreachable"));
  assert.ok((await errs([{ id: "a", name: "A", type: "TASK" }])).includes("missing_owner"));
  assert.ok((await errs([{ id: "a", name: "A", type: "AUTOMATION", action: "notify", params: { to: { kind: "requester" } }, on: { success: "b" } }, { id: "b", name: "B", type: "AUTOMATION", action: "notify", params: { to: { kind: "requester" } }, on: { success: "a" } }])).includes("loop"));
  assert.ok((await errs([{ id: "a", name: "A", type: "REVIEW", responsible: { kind: "requester" }, on: { success: "a" } }])).some((c: string) => ["missing_completion", "loop"].includes(c)));
  assert.ok((await errs([{ id: "a", name: "A", type: "TASK", responsible: { kind: "role", role: "wizard" } }])).includes("missing_owner"), "invalid role");
  assert.ok((await errs([{ id: "a", name: "A", type: "DOCUMENT", responsible: { kind: "requester" }, documents: [{ kind: "document", field: "document_ref", doc_type: "Spellbook" }] }])).includes("invalid_document"));
  assert.ok((await errs([{ id: "a", name: "A", type: "APPROVAL", policy: "NOPE" }])).includes("approval_chain"));
  assert.ok((await errs([{ id: "a", name: "A", type: "CHECK", rule: { field: "record.amount", op: "eval", value: "1; drop table records" } }])).includes("rule"), "no code in rules");
  assert.ok((await errs([{ id: "a", name: "A", type: "AUTOMATION", action: "run_sql", params: { sql: "select 1" } }])).includes("automation"));
  assert.ok((await errs([{ id: "a", name: "A", type: "TASK", responsible: { kind: "requester" }, script: "alert(1)" }])).includes("step_key"), "no scripts in a step");
  assert.ok((await errs([{ id: "a", name: "A", type: "TASK", responsible: { kind: "requester" } }], { required_roles: ["pirate"] })).includes("invalid_role"));
  assert.deepEqual(await errs([{ id: "a", name: "A", type: "TASK", responsible: { kind: "requester" } }]), [], "a minimal valid process");
  // editing: Workflow Admins only (owners; management by policy) — v24 (B45): not the System Administrator by role
  await fails(call("emp", "wf_definition_save", [{ ...base, steps: [] }]), await WFA());
  if (await v24()) await fails(call("admin", "wf_definition_save", [{ ...base, steps: [] }]), /Workflow Admin/);
  const v1 = await call("owner", "wf_definition_save", [{ ...base, steps: [{ id: "first", name: "First", type: "TASK", responsible: { kind: "requester" } }] }]);
  assert.equal(v1.version, 1);
  const bad = await call("owner", "wf_definition_save", [{ id: v1.id, steps: [{ id: "first", name: "First", type: "TASK" }] }]);
  const pubBad = await call("owner", "wf_definition_publish", [v1.id]); assert.equal(pubBad.ok, false); assert.ok(bad.errors.length > 0);
  await call("owner", "wf_definition_save", [{ id: v1.id, steps: [{ id: "first", name: "First", type: "TASK", responsible: { kind: "requester" } }] }]);
  assert.equal((await call("owner", "wf_definition_publish", [v1.id])).ok, true);
  await fails(sql("update wf_definitions set steps = '[]' where id = $1", [v1.id]), /cannot be changed/);
  const r1 = await rec("company.requests", "on V1", "Triage", {}, { by: "emp" });
  const i1 = await call("emp", "wf_start", [base.code, r1.id, null]);
  const nv = await call("owner", "wf_definition_new_version", [base.code]);
  await call("owner", "wf_definition_save", [{ id: nv.id, steps: [{ id: "first", name: "First", type: "TASK", responsible: { kind: "requester" } }, { id: "second", name: "Second", type: "TASK", responsible: { kind: "requester" } }] }]);
  assert.equal((await call("owner", "wf_definition_publish", [nv.id])).ok, true);
  const r2 = await rec("company.requests", "on V2", "Triage", {}, { by: "emp" });
  const i2 = await call("emp", "wf_start", [base.code, r2.id, null]);
  const a = (await sql("select def_version from wf_instances where id = $1", [i1]))[0]; const b = (await sql("select def_version from wf_instances where id = $1", [i2]))[0];
  assert.equal(a.def_version, 1); assert.equal(b.def_version, 2);
  let x = await inst(r1.id); await act("emp", x.run, "done");
  assert.equal((await inst(r1.id)).status, "completed", "V1 has one step and keeps it");
  x = await inst(r2.id); await act("emp", x.run, "done");
  assert.equal((await inst(r2.id)).cur, "second", "V2 has two");
  assert.deepEqual((await sql("select state from wf_definitions where code = $1 order by version", [base.code])).map((r: any) => r.state), ["retired", "published"]);
  // an explicit move of a running process to another version (Workflow Admins only)
  const r3 = await rec("company.requests", "migrate", "Triage", {}, { by: "emp" });
  await call("owner", "wf_definition_disable", [base.code, false]);
  await fails(call("emp", "wf_start", [base.code, r3.id, null]), /not available/);
  await call("owner", "wf_definition_disable", [base.code, true]);
  const i3 = await call("emp", "wf_start", [base.code, r3.id, null]);
  const v1id = (await sql("select id from wf_definitions where code = $1 and version = 1", [base.code]))[0].id;
  if (await v24()) await fails(call("admin", "wf_migrate", [i3, v1id, null]), /Workflow Admin/);
  await fails(call("emp", "wf_migrate", [i3, v1id, null]), await WFA());
  const m = await call("owner", "wf_migrate", [i3, v1id, "back to V1 for the test"]); assert.equal(m.version, 1);
  EV.engine.versions = { v1: a.def_version, v2: b.def_version };
});

/* ------------------------------------------- Scenario 15: automation idempotency, retry, dead letter ------------------------------------------- */
test("Scenario 15 — automatic steps run at most once, failures are retried through the Phase 1 queue and give up into the dead letter", async () => {
  const code = `AU${run.toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 30);
  const d = await call("owner", "wf_definition_save", [{ code, name: "Auto test", source_section: "marketing.events", steps: [
    { id: "num", name: "Give a number", type: "AUTOMATION", action: "allocate_number" },
    { id: "done", name: "Done", type: "TASK", responsible: { kind: "requester" }, on: { success: "$complete" } }] }]);
  assert.equal((await call("owner", "wf_definition_publish", [d.id])).ok, true);
  { const c0 = await call("owner", "ops_settings_get"); const nb = { ...c0.value.numbering }; delete nb["marketing.events"]; await call("owner", "ops_settings_save", [{ numbering: nb }, c0.version]); }
  await sql("delete from doc_number_formats where scope = 'ops' and doc_type = 'EVT'");
  const e1 = await rec("marketing.events", "Event 1", "Considering", {}, { by: "mgmt" });
  await sql("insert into section_access(section, role, can_write) values ('marketing.events', 'management', true) on conflict (section, role) do update set can_write = true");
  await call("mgmt", "wf_start", [code, e1.id, null]);
  let i = await inst(e1.id); assert.equal(i.status, "blocked"); assert.match(i.blocker, /No number format/);
  let q = (await sql("select * from automation_queue where dedupe_key = $1", [`wf:${i.run}`]))[0];
  assert.equal(q.status, "retrying"); assert.equal(q.agent, "workflow"); assert.equal(q.attempts, 1);
  // fixed by configuration: a number type for the section
  const cur = await call("owner", "ops_settings_get");
  await call("owner", "ops_settings_save", [{ numbering: { ...cur.value.numbering, "marketing.events": "EVT" } }, cur.version]);
  await sql("insert into doc_number_formats(scope, doc_type, pattern, company) values ('ops', 'EVT', '{CO}-EVT-{YEAR}-{SEQ:3}', 'AGR')");
  await sql("update automation_queue set next_attempt_at = now() where id = $1", [q.id]);
  const rd = (await sql("select public.wf_retry_due(50) r"))[0].r;
  assert.ok(rd.completed >= 1);
  i = await inst(e1.id); assert.equal(i.cur, "done"); assert.equal(i.status, "active");
  assert.match((await get(e1.id)).data.number, /^AGR-EVT-\d{4}-\d{3}$/);
  q = (await sql("select * from automation_queue where id = $1", [q.id]))[0]; assert.equal(q.status, "completed"); assert.equal(q.attempts, 2);
  { const c1 = await call("owner", "ops_settings_get"); const nb = { ...c1.value.numbering }; delete nb["marketing.events"]; await call("owner", "ops_settings_save", [{ numbering: nb }, c1.version]); }
  // running the same queued action again does nothing a second time
  assert.match((await sql("select public.wf_automation_execute($1) r", [q.id]))[0].r, /no longer open/);
  const n = (await get(e1.id)).data.number;
  assert.equal((await sql("select count(*)::int n from wf_events where instance_id = $1 and kind = 'automation_done'", [i.id]))[0].n, 1);
  assert.equal((await get(e1.id)).data.number, n);
  // dead letter: a failure that never goes away gives up after the configured attempts and says so
  const code2 = `AD${run.toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 30);
  const d2 = await call("owner", "wf_definition_save", [{ code: code2, name: "Auto dead", source_section: "company.parties", steps: [{ id: "num", name: "Give a number", type: "AUTOMATION", action: "allocate_number", on: { success: "$complete" } }] }]);
  await call("owner", "wf_definition_publish", [d2.id]);
  const p = await rec("company.parties", "Party X", "Active", {}, { by: "admin" });
  await call("owner", "wf_start", [code2, p.id, null]);
  i = await inst(p.id);
  const qid = (await sql("select id from automation_queue where dedupe_key = $1", [`wf:${i.run}`]))[0].id;
  for (let k = 0; k < 6; k++) { await sql("update automation_queue set next_attempt_at = now() where id = $1 and status = 'retrying'", [qid]); await sql("select public.wf_retry_due(50)"); }
  q = (await sql("select * from automation_queue where id = $1", [qid]))[0];
  assert.equal(q.status, "dead"); assert.equal(q.attempts, 5);
  i = await inst(p.id); assert.equal(i.status, "blocked"); assert.match(i.blocker, /gave up after 5 attempts/);
  // an administrator retries it by hand (after fixing the cause) — the same step run, never a second one
  await fails(act("emp", i.run, "retry"), /Only the process owner/);
  // the Phase 1 scheduler's workflow job runs the same retries and the SLA tick (service role)
  // (the job "workflow" in src/lib/server/schedule.ts is exactly this call with the service role)
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/server/schedule.ts"), "utf8");
  assert.match(src, /workflow: async \(db\) => \{[\s\S]*?await db\.rpc\("wf_sla_tick"\)[\s\S]*?while \(last\?\.more && Date\.now\(\) - t0 < 20000\)/, "the job repeats bounded calls while more is waiting");
  const { data: j, error: je } = await admin().rpc("wf_sla_tick");
  assert.equal(je, null); assert.ok(j && typeof j.due_soon === "number" && typeof j.more === "boolean" && j.retries, "the workflow job answers with its counts and whether more is waiting");
  EV.automation = { retried: { attempts: 2, status: "completed" }, dead: { attempts: q.attempts, status: q.status } };
});

/* ------------------------------------------- B33 security matrix: 14 roles ------------------------------------------- */
test("Security matrix — the operations working set equals row-level security for every internal role; external, pending and disabled get nothing", async () => {
  const internal = ["owner", "admin", "mgmt", "pm", "eng", "proc", "fin", "legal", "ops", "emp", "empNon", "hrEmp", "salesLead", "mgmtNon"];
  const out: Record<string, any> = {};
  for (const k of internal) {
    const mine = new Set((await as(k, "select public.ops_visible_ids() id")).map((r: any) => r.id));
    const rls = new Set((await as(k, "select id from records where section = any(public.ops_sections())")).map((r: any) => r.id));
    const extra = [...mine].filter((x) => !rls.has(x)); const missing = [...rls].filter((x) => !mine.has(x));
    assert.deepEqual([extra.length, missing.length], [0, 0], `${k}: working set ≠ row-level security (extra ${extra.slice(0, 3)}, missing ${missing.slice(0, 3)})`);
    out[k] = mine.size;
  }
  for (const k of ["partner", "vendor", "disabled"]) {
    await fails(call(k, "ops_overview"), /Not signed in/);
    await fails(call(k, "ops_request_create", ["purchase", `${tag} ext`, { item: "x", qty: 1, est_amount: 1, currency: "USD" }, null]), /Not signed in/);
    assert.equal((await as(k, "select public.ops_visible_ids() id")).length, 0);
    assert.equal((await call(k, "ops_request_types")).length, 0);
    assert.equal((await as(k, "select count(*)::int n from records where section in ('operations.requests', 'finance.payments', 'company.travel', 'company.requests', 'operations.quotations')"))[0].n, 0);
  }
  out.external = 0;
  EV.security.matrix = out;
});

test("Per-record privacy: a request is seen by its requester, its approvers, the people on its steps, its project manager and the desks — not by colleagues", async () => {
  const pr = await prToApproval("Private chair", 400, { project: PROJ.id });
  const seen = async (k: string) => (await as(k, "select count(*)::int n from records where id = $1", [pr.record]))[0].n === 1;
  assert.equal(await seen("emp"), true, "requester");
  assert.equal(await seen("salesLead"), true, "approver");
  assert.equal(await seen("eng"), true, "did the technical review");
  assert.equal(await seen("pm"), true, "project manager");
  assert.equal(await seen("proc"), true, "procurement desk");
  assert.equal(await seen("fin"), true, "finance desk");
  assert.equal(await seen("hrEmp"), false, "a colleague in HR");
  assert.equal(await seen("legal"), false, "a colleague in Legal");
  await fails(call("hrEmp", "ops_instance", [pr.record]), /not found/);
  // separation of duties, everywhere: no process approval was ever offered to its own requester
  const self = await sql("select count(*)::int n from approvals a join wf_step_runs s on s.id = a.wf_run join wf_instances i on i.id = s.instance_id where a.approver_id = i.requester");
  assert.equal(self[0].n, 0);
  // management raising a large request: management approval comes from someone else
  const big = await prToApproval("Big lathe", 40000, { by: "mgmt" });
  const lv = await sql("select distinct step from approvals where record_id = $1 and status = 'pending'", [big.record]);
  assert.equal(lv.length, 1, "level 1 first (sequential)");
  assert.equal((await sql("select count(distinct step)::int n from approvals where record_id = $1", [big.record]))[0].n, 3, "above 25,000: three levels");
  const all = await sql("select approver_id from approvals where record_id = $1", [big.record]);
  assert.ok(!all.some((a: any) => a.approver_id === U.mgmt.id));
});

test("Direct edits cannot bypass a process: statuses, numbers, selections, approvals, receipts and purchase records are set by the steps", async () => {
  const pr = await prToApproval("Guarded", 600);
  await fails(as("emp", "update records set status = 'Approved' where id = $1", [pr.record]), /follows the process/);
  await fails(as("proc", "update records set data = data || $2 where id = $1", [pr.record, { selected_amount: 1 }]), /set by the process/);
  await fails(as("proc", "update records set data = data || $2 where id = $1", [pr.record, { approved_amount: 600 }]), /set by the process/);
  await fails(as("emp", "update records set data = data || $2 where id = $1", [pr.record, { requester_id: U.hrEmp.id }]), /set by the process/);
  await fails(as("proc", "insert into records(section, title, status, data) values ('operations.procurement', 'po', 'Approved', $1)", [{ request_ref: pr.record, amount: 1 }]), /created by the purchase process/);
  await fails(as("emp", "insert into records(section, title, status, data) values ('operations.requests', 'x', 'Draft', $1)", [{ requester_id: U.hrEmp.id }]), /own name/);
  await fails(as("emp", "update wf_instances set status = 'completed'"), /permission denied/);
  await fails(as("emp", "insert into wf_events(kind) values ('fake')"), /permission denied/);
  await as("emp", "update approvals set status = 'approved' where record_id = $1", [pr.record]);
  assert.equal((await sql("select count(*)::int n from approvals where record_id = $1 and status = 'approved'", [pr.record]))[0].n, 0, "approvals cannot be written directly (no policy allows it)");
  await fails(sql("update wf_events set kind = 'x' where id = (select max(id) from wf_events)"), /cannot be changed or deleted/);
  await fails(sql("delete from wf_events where id = (select max(id) from wf_events)"), /cannot be changed or deleted/);
  // a step belongs to its responsible people only
  const i = await inst(pr.record);
  await fails(act("hrEmp", i.run, "approved"), /not found|someone else/);
  const ap = (await pendingFor(pr.record))[0];
  await fails(decide("emp", ap.id, "approved"), /not yours/);
  await fails(decide("salesLead", ap.id, "rejected", null), /Say why/);
  await decide("salesLead", ap.id, "rejected", "Not in the budget this quarter");
  const done = await inst(pr.record); assert.equal(done.status, "completed"); assert.equal(done.outcome, "rejected"); assert.equal((await get(pr.record)).status, "Rejected");
});

/* ------------------------------------------- B20 Request Center, B4 My Processes ------------------------------------------- */
test("Request Center shows only the request types a person may raise; My Processes splits what needs me, what I asked, what waits, is blocked, is done", async () => {
  const keys = async (k: string) => (await call(k, "ops_request_types")).map((t: any) => t.key).sort();
  assert.deepEqual(await keys("hrEmp"), ["general", "payment", "purchase", "travel"]);
  assert.deepEqual(await keys("emp"), ["contract", "general", "payment", "purchase", "travel"]);
  assert.deepEqual(await keys("eng"), ["change", "contract", "general", "payment", "purchase", "travel"]);
  await fails(call("hrEmp", "ops_request_create", ["change", `${tag} no`, { reason: "x" }, null]), /cannot raise/);
  const pr = await prToApproval("Headsets", 300);
  const mine = await call("emp", "ops_my_processes");
  assert.ok(mine.requested.some((x: any) => x.record_id === pr.record && x.step === "Approval"));
  const lead = await call("salesLead", "ops_my_processes");
  const na = lead.needs_action.find((x: any) => x.record_id === pr.record); assert.ok(na); assert.match(na.reason, /^Approve or reject/);
  const t = await call("emp", "ops_request_create", ["travel", `${tag} Trip to Abu Dhabi`, { destination: "Abu Dhabi", starts: D(20), ends: D(24), purpose: "Client visit", est_cost: 3000, currency: "USD" }, null]);
  const ti = await inst(t.record);
  const emp2 = await call("emp", "ops_my_processes");
  const n2 = emp2.needs_action.find((x: any) => x.record_id === t.record); assert.ok(n2); assert.match(n2.reason, /Fill in the details and submit/);
  await act("emp", ti.run, "submit");
  await decide("salesLead", (await pendingFor(t.record))[0].id, "approved");
  for (const step of ["planning", "booked", "ready", "completed", "expense"]) {
    const x = await inst(t.record); assert.equal(x.cur, step);
    if (step === "booked") { await fails(act("emp", x.run, "submit"), /booking_refs/); await as("emp", "update records set data = data || '{\"booking_refs\": \"EK 123, Hotel conf. 98765\"}' where id = $1", [t.record]); }
    await act("emp", x.run, step === "booked" || step === "completed" ? "submit" : "done");
  }
  assert.equal((await inst(t.record)).status, "completed"); assert.equal((await get(t.record)).status, "Closed");
  const emp3 = await call("emp", "ops_my_processes"); assert.ok(emp3.completed.some((x: any) => x.record_id === t.record));
  // general request routed to a handler
  const g = await call("hrEmp", "ops_request_create", ["general", `${tag} New badge printer`, { description: "Reception printer is broken", handler_id: U.ops.id }, null]);
  let gi = await inst(g.record); assert.equal(gi.cur, "triage"); assert.equal(gi.cassignee, U.ops.id);
  await act("ops", gi.run, "approved"); gi = await inst(g.record); assert.equal(gi.cur, "work"); await act("ops", gi.run, "done");
  assert.equal((await get(g.record)).status, "Closed");
  EV.scenarios.request_center = { hr: await keys("hrEmp"), eng: await keys("eng") };
});

/* ------------------------------------------- B19 exhibitions, B24 parties ------------------------------------------- */
test("Exhibition checklist template (IDEX) runs on an event record; nothing in the engine is specific to it", async () => {
  const ev = await rec("marketing.events", "IDEX booth", "Considering", { type: "Exhibition (booth)", owner_id: U.mgmt.id }, { by: "mgmt" });
  await call("mgmt", "wf_start", ["EXH-IDEX", ev.id, null]);
  let n = 0;
  for (;;) { const x = await inst(ev.id); if (x.status !== "active") break; assert.equal(x.cassignee, U.mgmt.id); await act("mgmt", x.run, "done"); n++; }
  assert.equal(n, 6); assert.equal((await get(ev.id)).status, "Done");
  const src = fs.readFileSync(path.join(process.cwd(), "supabase/update-v23.sql"), "utf8").split("20. Starting configuration")[0];
  assert.ok(!/IDEX/i.test(src), "the engine part of the migration never mentions IDEX");
});

test("Party directory: one organisation, several relationships; restricted relationships are not shown to those who may not see them", async () => {
  const p = (await as("proc", "insert into records(section, title, status, data) values ('company.parties', $1, 'Active', $2) returning id", [`${tag} Harbor Marine`, { country: "AE" }]))[0].id;
  await rec("operations.vendors", "Harbor Marine (vendor)", "Approved", { party_ref: p }); await rec("sales.clients", "Harbor Marine (client)", "Active", { party_ref: p });
  await rec("sales.partners", "Harbor Marine (partner, US only)", "Active", { party_ref: p }, { controlled: true });
  const a = await call("mgmt", "ops_party", [p]); const b = await call("empNon", "ops_party", [p]);
  assert.deepEqual(a.relationships.map((r: any) => r.type).sort(), ["Client", "Partner", "Vendor"]);
  assert.deepEqual(b.relationships.map((r: any) => r.type).sort(), ["Vendor"], "a non-US engineer sees only what their role can open");
  await fails(as("proc", "insert into records(section, title, status, data) values ('company.parties', 'x', 'Active', $1)", [{ bank_account_number: "1234" }]), /secrets/);
  const back = (await sql("select count(*)::int n from records where section = 'company.parties' and data->>'backfilled' = 'true'"))[0].n;
  EV.parties = { relationships_mgmt: a.relationships.length, relationships_non_us: b.relationships.length, backfilled: back };
});

/* ------------------------------------------- B26/B27 money without accounting ------------------------------------------- */
test("Project budget: planned, requested (estimates), approved, committed, paid and remaining — each traceable and equal to an independent count", async () => {
  const b = await call("mgmt", "ops_budget", [PROJ.id]);
  const usd = b.rows.find((r: any) => r.currency === "USD"); assert.ok(usd);
  const q = async (where: string) => Number((await sql(`select coalesce(sum(x), 0) s from (${where}) t`, [PROJ.id]))[0].s);
  const budget = await q("select (data->>'planned')::numeric x from records where section = 'finance.budget' and data->>'project_ref' = $1 and coalesce(status, '') <> 'Closed'");
  const committed = await q("select (data->>'amount')::numeric x from records where section = 'operations.procurement' and data->>'project_ref' = $1 and coalesce(status, '') not in ('Cancelled', 'Draft')");
  const paid = await q("select (data->>'paid_amount')::numeric x from records where section = 'finance.payments' and data->>'project_ref' = $1 and coalesce(data->>'paid_on', '') <> ''");
  const requested = await q("select (data->>'est_amount')::numeric x from records where section = 'operations.requests' and data->>'project_ref' = $1 and not data ? 'approved_amount' and not data ? 'purchase_ref' and coalesce(status, '') not in ('Closed', 'Rejected', 'Cancelled')");
  assert.equal(Number(usd.budget), budget); assert.equal(Number(usd.committed), committed); assert.equal(Number(usd.paid), paid); assert.equal(Number(usd.requested), requested);
  assert.equal(Number(usd.remaining), budget - committed - Number(usd.approved), "remaining = budget − committed − approved; estimates are not subtracted");
  assert.ok(Array.isArray(usd.refs.committed) && usd.refs.committed.length > 0, "every figure names its records");
  assert.match(b.formula, /not subtracted/);
  await fails(call("empNon", "ops_budget", [PROJ_US.id]), /not found/);
  const all = await call("fin", "ops_budget", [null]); assert.ok(all.rows.some((r: any) => r.project_id === PROJ.id));
  EV.budget = usd;
});

/* ------------------------------------------- B31 weekly, B30 dashboard, B28 assistant, B32 audit ------------------------------------------- */
test("Weekly review OPERATIONS numbers, the dashboard drill-down and the audit trail come from the same records", async () => {
  const w = await call("mgmt", "ops_weekly", [null, null]);
  assert.ok(w.started > 0 && w.approvals_decided > 0 && w.purchases_created > 0 && w.receipts > 0);
  assert.ok(Number(w.payments_recorded.USD) >= 2500);
  const ov = await call("mgmt", "ops_overview");
  for (const kind of ["pr_open", "po_awaiting_delivery", "iss_open"]) {
    const list = await call("mgmt", "ops_list", [kind, 500]);
    assert.equal(list.length, Math.min(500, ov.items[kind].count), `${kind}: drill-down has the dashboard's count`);
  }
  const secrets = await sql("select count(*)::int n from wf_events where detail::text ~* '(password|cvv|iban|4111 ?1111)'");
  assert.equal(secrets[0].n, 0, "no secret in the audit trail");
  const kinds = (await sql("select distinct kind from wf_events")).map((r: any) => r.kind);
  for (const k of ["started", "step_entered", "step_completed", "approval_requested", "approval_decided", "approval_invalidated", "purchase_created", "received", "payment_recorded", "vendor_selected", "definition_published", "proposal_accepted", "escalated"])
    assert.ok(kinds.includes(k), `audit has ${k}`);
  EV.weekly = w; EV.dashboard_counts = Object.fromEntries(Object.entries(ov.items).map(([k, v]: any) => [k, v.count]));
});

// v24 (Phase 7, B45): business authority follows the Workflow Admin capability — owners, management by policy,
// anyone an owner grants it — never the System Administrator role by itself
test("Settings and approval authority are changed only by Workflow Admins (owners; management by policy), validated, and kept in history", async () => {
  const s = await call("emp", "ops_settings_get"); assert.equal(s.can_edit, false);
  await fails(call("emp", "ops_settings_save", [{ due_soon_hours: 12 }, s.version]), await WFA());
  if (await v24()) assert.equal((await call("admin", "ops_settings_get")).can_edit, false, "a System Administrator holds no business authority by role (v24)");
  if (await v24()) await fails(call("admin", "ops_settings_save", [{ due_soon_hours: 12 }, s.version]), /Workflow Admin/);
  await fails(call("owner", "ops_settings_save", [{ due_soon_hours: 0 }, s.version]), /1–720/);
  await fails(call("owner", "ops_settings_save", [{ evil: 1 }, s.version]), /Unknown setting/);
  await fails(call("owner", "ops_settings_save", [{ due_soon_hours: 24 }, s.version - 1]), /changed by someone else/);
  const ok = await call("owner", "ops_settings_save", [{ due_soon_hours: 24 }, s.version]); assert.equal(ok.version, s.version + 1);
  await fails(call("mgmt", "ops_policy_save", ["PURCHASE", "x", [], true]), (await v24()) ? /at least one level/ : /Only owners and administrators/); // management holds Workflow Admin by policy: validated, not refused
  if (await v24()) await fails(call("admin", "ops_policy_save", ["PURCHASE", "x", [{ steps: [{ kind: "role", role: "finance" }] }], true]), /Workflow Admin/);
  await fails(call("owner", "ops_policy_save", ["PTEST", "x", [{ steps: [{ kind: "requester" }] }], true]), /own request/);
  await fails(call("owner", "ops_policy_save", ["PTEST", "x", [{ when: { field: "record.amount", op: "exec", value: 1 }, steps: [{ kind: "role", role: "finance" }] }], true]), /Unknown operator/);
  await call("owner", "ops_policy_save", ["PTEST", "Test policy", [{ steps: [{ kind: "role", role: "finance" }] }], true]);
  assert.ok((await sql("select count(*)::int n from approval_policies_history where policy_code = 'PTEST'"))[0].n >= 1);
  assert.ok((await sql("select count(*)::int n from ops_settings_history"))[0].n >= 1);
});

test("Rule model: allow-listed fields and operators only; evaluation is deterministic", async () => {
  const ev = async (rule: any, ctx: any) => (await sql("select public.wf_rule($1, $2) r", [rule, ctx]))[0].r;
  const er = async (rule: any) => (await sql("select public.wf_rule_error($1) e", [rule]))[0].e;
  const ctx = { record: { amount: "12000", kind: "Supply" }, facts: { quotations: 2, selected: true }, instance: { priority: "High" } };
  assert.equal(await ev({ all: [{ field: "record.amount", op: "gt", value: 10000 }, { field: "facts.quotations", op: "gte", value: 2 }] }, ctx), true);
  assert.equal(await ev({ any: [{ field: "record.kind", op: "in", value: ["Sale", "Lease"] }, { field: "instance.priority", op: "eq", value: "Low" }] }, ctx), false);
  assert.equal(await ev({ not: { field: "record.missing", op: "present" } }, ctx), true);
  assert.equal(await ev({ field: "facts.selected", op: "eq", value: true }, ctx), true);
  assert.match(await er({ field: "record.amount", op: "regex", value: ".*" }), /Unknown operator/);
  assert.match(await er({ field: "pg_catalog.pg_sleep", op: "eq", value: 1 }), /Unknown field/);
  assert.match(await er({ field: "record.amount", op: "eq", value: { $where: "x" } }), /plain value/);
  assert.match(await er({ field: "record.a", op: "eq", value: 1, code: "x" }), /Unknown key/);
  assert.match(await er({ all: [] }), /1–20/);
  assert.equal(await er({ field: "facts.amount", op: "lte", value: 5000 }), null);
});

/* ------------------------------------------- Scenario 15 (cont.): the same completion at the same moment ------------------------------------------- */
test("Concurrency — the same step completed five times at once, two approvers deciding the same level at once: one result each", async () => {
  const res = await call("emp", "ops_request_create", ["purchase", `${tag} Concurrent`, { item: "Gloves", qty: 10, est_amount: 300, currency: "USD" }, null]);
  let i = await inst(res.record);
  const five = await Promise.allSettled(Array.from({ length: 5 }, () => act("emp", i.run, "submit")));
  assert.equal(five.filter((x) => x.status === "fulfilled").length, 1, "one completion wins");
  for (const x of five.filter((y) => y.status === "rejected") as PromiseRejectedResult[]) assert.match(String(x.reason?.message), /already done|could not serialize|deadlock/);
  assert.equal((await sql("select count(*)::int n from wf_step_runs where instance_id = $1 and step_id = 'tech_review'", [i.id]))[0].n, 1, "one next step");
  i = await inst(res.record); await act("eng", i.run, "approved");
  i = await inst(res.record);
  await sql("insert into records(section, title, status, data) values ('operations.quotations', $1, 'Received', $2)", [`${tag} QC`, { request_ref: res.record, vendor_ref: VENDOR.id, amount: 300, currency: "USD", valid_until: D(10) }]);
  await act("proc", i.run, "submit"); const q = (await sql("select id from records where section = 'operations.quotations' and data->>'request_ref' = $1", [res.record]))[0].id;
  await call("proc", "ops_select_quote", [res.record, q, "Only vendor that can deliver this week"]);
  // the same approval decided twice at the same moment (a double click, two tabs): one decision, one purchase record
  await call("owner", "ops_policy_save", ["PURCHASE_PAR", "Parallel test", [{ steps: [{ kind: "role", role: "finance", label: "Finance" }] }], true]);
  const a = (await pendingFor(res.record))[0];
  const two = await Promise.allSettled([decide("salesLead", a.id, "approved"), decide("salesLead", a.id, "approved")]);
  assert.equal(two.filter((x) => x.status === "fulfilled").length, 1, "the same decision twice: one wins");
  i = await inst(res.record); assert.equal(i.cur, "order");
  assert.equal((await sql("select count(*)::int n from records where section = 'operations.procurement' and data->>'request_ref' = $1", [res.record]))[0].n, 1, "one purchase record");
  assert.equal((await sql("select count(*)::int n from wf_links where instance_id = $1 and kind = 'task'", [i.id]))[0].n, 1, "one order task");
  // a role level with two members deciding at the same moment
  const code = `CP${run.toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 30);
  const d = await call("owner", "wf_definition_save", [{ code, name: "Concurrent approval", source_section: "company.requests", steps: [{ id: "ap", name: "Approve", type: "APPROVAL", policy: "PURCHASE_PAR", on: { success: "$complete" } }] }]);
  await call("owner", "wf_definition_publish", [d.id]);
  const r2 = await rec("company.requests", "concurrent approval", "Triage", {}, { by: "emp" });
  await call("emp", "wf_start", [code, r2.id, null]);
  const ap2 = await sql("select * from approvals where record_id = $1 and status = 'pending' and approver_id = any($2)", [r2.id, [U.fin.id, U.fin2.id]]);
  assert.equal(ap2.length, 2);
  const both = await Promise.allSettled([decide("fin", ap2.find((a: any) => a.approver_id === U.fin.id).id, "approved"), decide("fin2", ap2.find((a: any) => a.approver_id === U.fin2.id).id, "approved")]);
  assert.equal(both.filter((x) => x.status === "fulfilled").length, 1, "one approver decides; the other finds it decided");
  const done = await inst(r2.id); assert.equal(done.status, "completed");
  assert.equal((await sql("select count(*)::int n from wf_events where instance_id = $1 and kind = 'completed'", [done.id]))[0].n, 1, "completed once");
  assert.equal((await sql("select count(*)::int n from approvals where record_id = $1 and status = 'approved'", [r2.id]))[0].n, 1);
  EV.concurrency = { five_completions: five.map((x) => x.status), approvers: both.map((x) => x.status) };
});
