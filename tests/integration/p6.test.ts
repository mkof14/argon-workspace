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
    { request_ref: res.record, vendor_ref: v.id, vendor_ref_title: v.title, amount, currency: "USD", lead_time_days: 10, valid_until: D(30) }]))[0];
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
  const a = att.find((x: any) => x.record_id === ob); assert.ok(a); assert.equal(a.kind, "obl_overdue"); assert.match(a.reason, /Overdue since/);
  const dl = await call("legal", "ops_deadlines", [60]);
  assert.ok(dl.some((x: any) => x.record_id === soon && x.kind === "obligation")); assert.ok(dl.some((x: any) => x.record_id === c && x.kind === "contract_end"));
  const ov = await call("mgmt", "ops_overview"); assert.ok(ov.items.obl_overdue.ids.includes(ob)); assert.ok(ov.items.obl_due_soon.ids.includes(soon));
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
  const ov = await call("mgmt", "ops_overview"); assert.ok(ov.items.sla_escalated.ids.includes(pr.record)); assert.ok(ov.items.sla_overdue.ids.includes(pr.record));
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
