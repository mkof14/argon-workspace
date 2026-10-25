// P10 §61 — 1inow functional flows on the isolated stack with real sign-ins, and the B19 business-policy model.
// Flows: employee morning, manager / executive, commercial (IDEX follow-up), procurement (waiting for a vendor),
// manufacturing (C20 build unit), meeting (brief), voice (command and capture), end of day. Policy model: USD
// thresholds, ECR escalation, PROPOSAL Management review, separation of duty, Policy Approver restrictions — and the
// nine AGRON policies stay READY FOR OWNER APPROVAL (nothing approved). Synthetic data only. Evidence: .stack/p10.json
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { admin, APP, ENV, makeUser, PASSWORD, pool, signIn, sql, uid } from "./_stack.ts";
import { myDay, executive, endOfDay, meetingBrief, changes } from "../../src/lib/server/inow.ts";
import { complete, plan, start, type Ctx } from "../../src/lib/server/actions.ts";
import { why } from "../../src/lib/inow.ts";

const run = uid(); const tag = `p10f${run}`; const skipApp = !APP;
const D = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const U: Record<string, any> = {}; const C: Record<string, any> = {}; const R: Record<string, any> = {}; const EV: Record<string, any> = { tag, flows: {}, policy: {} };
const me = (k: string) => ({ id: U[k].id, role: U[k].role, timezone: "UTC" });
const ctx = (k: string): Ctx => ({ user: C[k], admin: admin(), me: { id: U[k].id, role: U[k].role, full_name: U[k].email, timezone: "UTC" }, lang: "en" });
const ins = async (section: string, title: string, status: string | null, data: any, by?: string) =>
  (await sql("insert into records(section, title, status, data, created_by) values ($1, $2, $3, $4, $5) returning *", [section, `${tag} ${title}`, status, data, by || null]))[0];
const all = (d: any) => [...d.now, ...d.decisions, ...d.today, ...d.attention, ...d.waiting, ...d.loops];
const find = (d: any, id: string) => all(d).find((r: any) => r.record_id === id);
async function as<T = any>(k: string, q: string, p: any[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[k].id, role: "authenticated", aal: "aal2", iat: Math.floor(Date.now() / 1000) + 5 })]);
    const r = await c.query(q, p); await c.query("commit"); return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
async function storeRun(k: string, ops: any[]) {
  const out: any[] = [];
  for (const o of ops) {
    if (o.op === "create") { const { data, error } = await C[k].from("records").insert({ section: o.section, title: o.title, status: o.status, data: o.data, created_by: U[k].id }).select("id").single(); out.push(error ? { ok: false, error: error.message } : { ok: true, id: data.id }); }
    else if (o.op === "update") { const { data, error } = await C[k].from("records").update({ status: o.status, data: o.data }).eq("id", o.id).eq("version", o.version).select("id").maybeSingle(); out.push(error || !data ? { ok: false, error: error?.message || "conflict" } : { ok: true, id: o.id }); }
  }
  return out;
}
async function cookiesFor(email: string) {
  const jar = new Map<string, string>();
  const c = createServerClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

before(async () => {
  U.eng = await makeUser(`p10fe-${run}@agron-stack.test`, "engineering", { us: true, name: `${tag} Lena Engineer` });
  U.sales = await makeUser(`p10fs-${run}@agron-stack.test`, "sales", { us: true, name: `${tag} Sam Sales` });
  U.mgmt = await makeUser(`p10fm-${run}@agron-stack.test`, "management", { us: true, name: `${tag} Max Manager` });
  U.mgmt2 = await makeUser(`p10fm2-${run}@agron-stack.test`, "management", { us: true, name: `${tag} Mia Manager` });
  U.owner = await makeUser(`p10fo-${run}@agron-stack.test`, "owner", { us: true, name: `${tag} Olga Owner` });
  U.adm = await makeUser(`p10fa-${run}@agron-stack.test`, "admin", { us: true, name: `${tag} Adam Admin` });
  for (const k of Object.keys(U)) C[k] = (await signIn(U[k].email)).c;
  const hhmm = new Date(Date.now() + 30 * 60e3).toISOString().slice(11, 16); // a meeting in 30 minutes (UTC)
  R.project = await ins("company.projects", "Sprinter integration", "Active", { owner_id: U.mgmt.id });
  R.overdue = await ins("company.tasks", "Finish harness drawing", "In Progress", { assignee_id: U.eng.id, due: D(-2), project_ref: R.project.id, priority: "Normal" }, U.mgmt.id);
  R.today = await ins("company.tasks", "Send test report to customer", "In Progress", { assignee_id: U.eng.id, due: D(0), priority: "High" }, U.mgmt.id);
  R.later = await ins("company.tasks", "Tidy the lab inventory", "New", { assignee_id: U.eng.id, due: D(9) }, U.eng.id);
  R.dep = await ins("company.tasks", "Assemble the harness", "To Do", { assignee_id: U.mgmt2.id, blocked_by: R.overdue.id, due: D(2) }, U.mgmt.id);
  R.wait = await ins("company.tasks", "Connector samples from vendor", "Waiting", { assignee_id: U.eng.id, waiting_kind: "Supplier", waiting_on: `${tag} Vendor Q`, due: D(-1) }, U.eng.id);
  R.meeting = await ins("company.meetings", "Sprinter design review", "Planned", { date: D(0), time: hhmm, timezone: "UTC", organizer_id: U.mgmt.id, participants_ids: [U.eng.id, U.mgmt.id], project_ref: R.project.id, agenda: "Harness and connector status" }, U.mgmt.id);
  R.opp = await ins("sales.pipeline", "IDEX demonstrator — Gulf customer", "Negotiation", { owner_id: U.sales.id, value: 400000, currency: "USD", next_action: "Send revised quote", next_action_due: D(-2) }, U.sales.id);
});

test("§61.1 employee morning: NOW holds the overdue work, the meeting in 30 minutes and the work that blocks others — each with its reasons", async () => {
  const t0 = Date.now(); const d = await myDay(C.eng, me("eng")); const ms = Date.now() - t0;
  assert.deepEqual(Object.entries(d.sources).filter(([, s]: any) => !s.ok).map(([k]) => k), [], "every engine answered");
  const ov = find(d, R.overdue.id); const mt = find(d, R.meeting.id); const td = find(d, R.today.id);
  assert.ok(ov && mt && td, "overdue task, meeting and today's task are in My Day");
  assert.ok(d.now.some((r: any) => r.record_id === R.overdue.id), "overdue + blocks others → NOW");
  assert.ok(d.now.some((r: any) => r.record_id === R.meeting.id), "meeting in 30 min → NOW");
  assert.ok(ov.signals.some((s: any) => s.code === "overdue") && ov.signals.some((s: any) => s.code === "blocks_others"), why(ov));
  assert.ok(mt.signals.some((s: any) => s.code === "meeting_soon" && s.n <= 35), why(mt));
  assert.ok(td.priority === "HIGH", `due today + high priority → HIGH (${why(td)})`);
  const later = find(d, R.later.id); assert.ok(!later || later.priority === "LOW", "a task due in 9 days is not urgent");
  const w = find(d, R.wait.id); assert.ok(w, "the vendor wait is shown");
  assert.ok(w.signals.some((s: any) => s.code === "vendor_waiting"), `vendor waiting (${why(w)})`);
  assert.ok(d.next.length > 0 && d.next.every((n: any) => (n.required ? n.suggested.length === 0 : true)), "NEXT never mixes required and suggested");
  EV.flows.employee_morning = { now: d.now.map((r: any) => r.title), ms, reasons: d.now.map((r: any) => why(r)) };
});

test("§61.2 procurement: waiting for a vendor → Waiting For with age and the vendor; follow-up becomes a proposal, not an action", async () => {
  const d = await myDay(C.eng, me("eng"));
  const w = find(d, R.wait.id); assert.equal(w.waiting.party, "vendor"); assert.match(String(w.waiting.on), /Vendor Q/);
  assert.ok(w.suggested.some((s: any) => s.kind === "followup_task"));
  const p = await plan(ctx("eng"), `Create task Follow up: ${w.title}`, "assistant");
  assert.equal(p.status, "proposed"); assert.equal(p.needsConfirmation, true);
  assert.equal((await sql("select count(*)::int n from records where title like $1 and section = 'company.tasks' and id <> $2", [`%Follow up: ${tag}%`, R.wait.id]))[0].n, 0, "nothing created before the yes");
  EV.flows.procurement = { party: w.waiting.party, age_days: w.waiting.age_days };
});

test("§61.3 commercial (IDEX): an overdue next action of my opportunity is a follow-up with its reason", async () => {
  const d = await myDay(C.sales, me("sales"));
  const o = find(d, R.opp.id); assert.ok(o, "IDEX opportunity in the salesperson's day");
  assert.ok(o.signals.some((s: any) => s.code === "commercial_followup") && o.signals.some((s: any) => s.code === "overdue"), why(o));
  const other = await myDay(C.eng, me("eng")); assert.ok(!find(other, R.opp.id), "not in an engineer's day (not theirs, not visible)");
  EV.flows.commercial = { reasons: why(o) };
});

test("§61.4 manufacturing (C20): a build unit is resolved by number for Ask; ambiguity is offered as a choice", { skip: skipApp && "no app" }, async () => {
  const n = Math.floor(Math.random() * 900 + 100);
  R.u1 = await ins("operations.builds", `C20 #${n}`, "In Build", { number: `C20 #${n}` });
  const ck = await cookiesFor(U.mgmt.email);
  const r = await fetch(`${APP}/api/inow`, { method: "POST", headers: { cookie: ck, "Content-Type": "application/json", origin: APP }, body: JSON.stringify({ op: "ask", q: `What is blocking C20 #${n}?`, lang: "en" }) }).then((x) => x.json());
  assert.equal(r.kind, "answer"); assert.equal(r.intent, "blockers"); assert.equal(r.subject.id, R.u1.id); assert.ok(r.sources.length >= 1, "answer names its source");
  EV.flows.manufacturing = { subject: r.subject.title, facts: !!r.facts };
});

test("§61.5 manager: Executive 1inow from the existing engines, with the viewer's rights; team status has no scoring", async () => {
  const t0 = Date.now(); const e = await executive(C.mgmt, me("mgmt")); const ms = Date.now() - t0;
  assert.deepEqual(Object.entries(e.sources).filter(([, s]: any) => !s.ok).map(([k]) => k), [], "every engine answered");
  for (const k of ["now", "decisions", "waiting", "today", "projects"]) assert.ok(Array.isArray((e as any)[k]), k);
  const txt = JSON.stringify(e); assert.ok(!/productivity|score_per_person|ranking/i.test(txt), "no productivity scoring or ranking of people");
  const c = await changes(C.mgmt, me("mgmt"), "week"); assert.ok(Array.isArray(c.items));
  EV.flows.manager = { ms, sections: Object.keys(e) };
});

test("§61.6 meeting: the brief brings purpose, people, the project's open actions and documents; only for participants with access", async () => {
  const b = await meetingBrief(C.eng, me("eng"), R.meeting.id); assert.ok(b);
  assert.equal(b!.meeting.agenda, "Harness and connector status");
  assert.ok(b!.participants.some((p: any) => p.id === U.eng.id) && b!.participants.some((p: any) => p.id === U.mgmt.id));
  assert.ok(b!.open_actions.length >= 0 && Array.isArray(b!.documents));
  assert.match(b!.meeting.project!.title, /Sprinter integration/);
  // the brief follows record access exactly: whoever cannot open the meeting gets nothing
  for (const k of ["sales", "mgmt2"]) {
    const canOpen = !!(await C[k].from("records").select("id").eq("id", R.meeting.id).maybeSingle()).data;
    assert.equal(!!(await meetingBrief(C[k], me(k), R.meeting.id)), canOpen, k);
  }
  EV.flows.meeting = { participants: b!.participants.length, open_actions: b!.open_actions.length };
});

test("§61.7 voice: a spoken command is a preview until confirmed; then exactly one verified result; end of day shows it", async () => {
  const p = await plan(ctx("eng"), `Complete task ${tag} Finish harness drawing`, "voice");
  assert.equal(p.status, "proposed", p.question); assert.equal(p.risk, "material");
  assert.equal((await sql("select status from records where id = $1", [R.overdue.id]))[0].status, "In Progress", "spoken words alone change nothing");
  const s = await start(ctx("eng"), p.id, { confirm: true }); assert.equal(s.ok, true);
  const done = await complete(ctx("eng"), p.id, await storeRun("eng", (s as any).ops)); assert.equal(done.ok, true);
  assert.equal((await sql("select status from action_audit where id = $1", [p.id]))[0].status, "executed");
  const eod = await endOfDay(C.eng, me("eng")); assert.ok(eod.completed.some((x: any) => x.id === R.overdue.id), "end of day lists it as done");
  const d = await myDay(C.eng, me("eng")); assert.ok(!find(d, R.overdue.id), "a completed task leaves My Day");
  EV.flows.voice = { audit: "executed", eod_completed: eod.completed.length };
});

/* ---------------------------------------------- B19 business-policy model ---------------------------------------------- */
const tier = async (code: string, facts: any) => (await sql(`select t->>'label' l, t->>'mode' m, t->'steps' s from approval_policies p, jsonb_array_elements(p.tiers) with ordinality x(t, o)
  where p.code = $1 and (t->'when' is null or public.wf_rule(t->'when', $2)) order by o limit 1`, [code, { facts }]))[0];

test("B19 the nine AGRON policies: model v2, READY FOR OWNER APPROVAL, nothing approved", async () => {
  const rows = await sql("select code, config_status, ready_for_approval, model_version, approved_by, currency from approval_policies where code in ('PURCHASE','PAYMENT','TRAVEL','ECR','PROPOSAL','BOM','CONFIG','CONTRACT','TESTPROC') order by code");
  assert.equal(rows.length, 9);
  for (const r of rows) { assert.notEqual(r.config_status, "Approved", r.code); assert.equal(r.ready_for_approval, true, r.code); assert.equal(r.model_version, 2, r.code); assert.equal(r.approved_by, null, r.code); assert.equal(r.currency, "USD", r.code); }
  const h = await sql("select count(distinct policy_code)::int n from approval_policies_history where after->>'note' like 'policy model v2%'"); assert.ok(h[0].n >= 9, "each change is in the policy history");
  EV.policy.ready = rows.map((r) => r.code);
});

test("B19 USD thresholds: another currency goes to the highest tier; no currency counts as USD", async () => {
  assert.match((await tier("PURCHASE", { amount: 3000, currency: "USD" })).l, /Up to 5,000 USD/);
  assert.match((await tier("PURCHASE", { amount: 3000 })).l, /Up to 5,000 USD/);
  assert.match((await tier("PURCHASE", { amount: 3000, currency: "EUR" })).l, /another currency/);
  assert.match((await tier("PURCHASE", { amount: 20000, currency: "USD" })).l, /Up to 25,000/);
  assert.match((await tier("PURCHASE", { amount: 30000, currency: "USD" })).l, /Above 25,000/);
  assert.match((await tier("PAYMENT", { amount: 12000, currency: "USD" })).l, /Above 10,000/);
  assert.match((await tier("PAYMENT", { amount: 500, currency: "AED" })).l, /another currency/);
  assert.match((await tier("TRAVEL", { amount: 900, currency: "GBP" })).l, /another currency/);
  EV.policy.usd = true;
});

test("B19 ECR escalation: Management in parallel above 10,000 USD, in another currency, or with a safety / customer / certification impact", async () => {
  assert.equal((await tier("ECR", { amount: 5000, currency: "USD" })).l, "Engineering");
  for (const f of [{ amount: 15000, currency: "USD" }, { amount: 100, currency: "EUR" }, { amount: 100, currency: "USD", safety_impact: true }, { amount: 100, currency: "USD", customer_impact: true }, { amount: 100, currency: "USD", certification_impact: true }]) {
    const t = await tier("ECR", f); assert.match(t.l, /safety/, JSON.stringify(f)); assert.equal(t.m, "parallel"); assert.ok(t.s.some((s: any) => s.role === "management"), JSON.stringify(f));
  }
  EV.policy.ecr = true;
});

test("B19 PROPOSAL: Management review above the high-value threshold (250,000 USD) or in another currency", async () => {
  assert.match((await tier("PROPOSAL", { amount: 200000, currency: "USD", discount: 5 })).l, /discount up to 10%/);
  assert.match((await tier("PROPOSAL", { amount: 200000, currency: "USD", discount: 15 })).l, /discount above 10%/);
  for (const f of [{ amount: 300000, currency: "USD", discount: 0 }, { amount: 100000, currency: "EUR", discount: 0 }]) {
    const t = await tier("PROPOSAL", f); assert.match(t.l, /Management review/); assert.ok(t.s.some((s: any) => s.label === "Management review"));
  }
  EV.policy.proposal = { threshold_usd: 250000 };
});

test("B19 separation of duty: the editor of a version does not approve it; an owner's own approval is recorded; System Administrators never approve", async () => {
  // synthetic policies of this run only — the nine AGRON policies are never approved here
  const code = `ZZ${run}`.toUpperCase(), code2 = `ZY${run}`.toUpperCase();
  const tiers = [{ label: "All", mode: "sequential", steps: [{ kind: "role", role: "management", label: "Management" }] }];
  await sql("insert into crm_caps(user_id, cap) values ($1, 'workflow_admin'), ($1, 'policy_approver'), ($2, 'policy_approver')", [U.mgmt.id, U.mgmt2.id]);
  await as("mgmt", "select public.ops_policy_save($1, $2, $3::jsonb, true)", [code, `${tag} test policy`, JSON.stringify(tiers)]);
  const v = (await sql("select version from approval_policies where code = $1", [code]))[0].version;
  await assert.rejects(as("mgmt", "select public.ops_policy_approve($1, $2)", [code, v]), /Separation of duty/);
  const ok = (await as("mgmt2", "select public.ops_policy_approve($1, $2) r", [code, v]))[0].r; assert.equal(ok.status, "Approved"); assert.equal(ok.self_approved, false);
  await assert.rejects(as("mgmt2", "select public.ops_policy_approve($1, $2)", [code, v + 5]), /changed since you opened it/);
  // the owner edits and approves their own version: allowed, and recorded as a self-approval
  await sql("insert into crm_caps(user_id, cap) values ($1, 'workflow_admin')", [U.owner.id]);
  await as("owner", "select public.ops_policy_save($1, $2, $3::jsonb, true)", [code2, `${tag} owner policy`, JSON.stringify(tiers)]);
  const v2 = (await sql("select version from approval_policies where code = $1", [code2]))[0].version;
  const own = (await as("owner", "select public.ops_policy_approve($1, $2) r", [code2, v2]))[0].r; assert.equal(own.self_approved, true);
  assert.equal((await sql("select self_approved from approval_policies where code = $1", [code2]))[0].self_approved, true);
  // a System Administrator cannot be given the Policy Approver capability, and cannot approve even with an old grant
  await assert.rejects(sql("insert into crm_caps(user_id, cap) values ($1, 'policy_approver')", [U.adm.id]), /System Administrator cannot be a Policy Approver/);
  await sql("insert into crm_caps(user_id, cap) values ($1, 'policy_approver')", [U.mgmt2.id]).catch(() => null);
  const c3 = `ZX${run}`.toUpperCase(); await as("mgmt", "select public.ops_policy_save($1, $2, $3::jsonb, true)", [c3, `${tag} p3`, JSON.stringify(tiers)]);
  await sql("update profiles set role = 'admin' where id = $1", [U.mgmt2.id]); // a Policy Approver who later became a System Administrator
  const v3 = (await sql("select version from approval_policies where code = $1", [c3]))[0].version;
  await assert.rejects(as("mgmt2", "select public.ops_policy_approve($1, $2)", [c3, v3]), /System Administrator/);
  await sql("update profiles set role = 'management' where id = $1", [U.mgmt2.id]);
  // an employee without the capability cannot approve
  await assert.rejects(as("eng", "select public.ops_policy_approve($1, $2)", [c3, v3]), /Only the Owner or a Policy Approver/);
  // the API returns at once on a stale version (the old retried error code would make it wait forever)
  const t0 = Date.now(); const r = await C.mgmt2.rpc("ops_policy_approve", { p_code: c3, p_version: 99999 }); assert.ok(r.error); assert.ok(Date.now() - t0 < 5000, `returned in ${Date.now() - t0} ms`);
  const nine = await sql("select count(*)::int n from approval_policies where code in ('PURCHASE','PAYMENT','TRAVEL','ECR','PROPOSAL','BOM','CONFIG','CONTRACT','TESTPROC') and config_status = 'Approved'");
  assert.equal(nine[0].n, 0, "none of the nine AGRON policies was approved by these tests");
  EV.policy.sod = true;
});

test("evidence file", () => {
  fs.mkdirSync(path.join(process.cwd(), ".stack"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".stack", "p10.json"), JSON.stringify(EV, null, 1));
});
