// Phase 6 in a real browser against the app built on the test stack (synthetic people and data only): an employee
// raises a purchase request in the Request Center; the reviewer approves it in the process view; procurement compares
// quotations and chooses one with a reason; the department lead approves the exact values; the purchase record is
// created; management drills from the Operations dashboard to the record and sees the Operations card in Executive
// Control; a non-US employee sees nothing of a US-only request; the process builder validates; the phone layout.
// Screenshots: .stack/shots/p6-*.png
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { APP, ENV, makeUser, PASSWORD, sql, uid } from "./_stack.ts";

const skip = !APP; const run = uid(); const tag = `e6${run.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
let pw: any, browser: any; const U: Record<string, any> = {}; const R: Record<string, any> = {};
const SHOTS = path.join(ENV.STACK_DIR || ".stack", "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const loadPw = () => { try { return createRequire(import.meta.url)("playwright"); } catch { return createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright"); } };
const shot = (p: any, n: string) => p.screenshot({ path: path.join(SHOTS, `p6-${n}.png`), fullPage: false });
const waitFor = async (fn: () => Promise<boolean>, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
async function login(email: string, viewport = { width: 1280, height: 900 }) {
  const c = await browser.newContext({ viewport, locale: "en-US" }); const p = await c.newPage();
  await p.addInitScript(() => { try { localStorage.setItem("agronws.lang", "en"); } catch {} });
  await p.goto(`${APP}/login`); await p.fill("#email", email); await p.fill("#password", PASSWORD); await p.click("button[type=submit]");
  await p.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 20000 }); return p;
}
const inst = async (record: string) => (await sql("select i.*, s.step_id cur, s.id run from wf_instances i left join wf_step_runs s on s.id = i.current_run where i.record_id = $1 order by i.created_at desc limit 1", [record]))[0];

before(async () => {
  if (skip) return;
  pw = loadPw(); browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-proxy-server"] });
  U.emp = await makeUser(`e6e-${run}@agron-stack.test`, "sales", { us: true, name: `Sara Sales ${tag}` });
  U.lead = await makeUser(`e6l-${run}@agron-stack.test`, "sales", { us: true, name: `Leo Lead ${tag}` });
  U.eng = await makeUser(`e6g-${run}@agron-stack.test`, "engineering", { us: true, name: `Enzo Eng ${tag}` });
  U.proc = await makeUser(`e6p-${run}@agron-stack.test`, "procurement", { us: true, name: `Pia Proc ${tag}` });
  U.mgmt = await makeUser(`e6m-${run}@agron-stack.test`, "management", { us: true, name: `Max Mgmt ${tag}` });
  U.non = await makeUser(`e6n-${run}@agron-stack.test`, "engineering", { us: false, name: `Nia NonUS ${tag}` });
  const dept = (await sql("insert into departments(code, key, name, manager_id) values ($1, $2, $3, $4) returning id", [`E6${run.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`, `e6${run}`, `Sales ${tag}`, U.lead.id]))[0].id;
  await sql("update profiles set department_id = $1 where id = any($2)", [dept, [U.emp.id, U.lead.id]]);
  R.vendor = (await sql("insert into records(section, title, status, data) values ('operations.vendors', $1, 'Approved', '{}') returning *", [`Harbor Supply ${tag}`]))[0];
  R.vendor2 = (await sql("insert into records(section, title, status, data) values ('operations.vendors', $1, 'Approved', '{}') returning *", [`Gulf Parts ${tag}`]))[0];
  R.us = (await sql("insert into records(section, title, status, controlled, data) values ('company.projects', $1, 'Active', true, $2) returning *", [`US only project ${tag}`, { manager_id: U.mgmt.id }]))[0];
});
after(async () => { await browser?.close(); });

test("Request Center → process: raise, review, compare quotations, choose with a reason, approve the exact values, purchase record", { skip }, async () => {
  const e = await login(U.emp.email); await e.goto(`${APP}/ops?tab=requests`);
  assert.ok(await waitFor(async () => (await e.$$("[data-rtype]")).length >= 4), "request types");
  assert.equal((await e.$$("[data-rtype='change']")).length, 0, "a sales employee cannot raise an engineering change");
  await shot(e, "request-center");
  await e.click("[data-rtype='purchase']");
  await e.fill("#rq-title", `Rugged tablets ${tag}`); await e.fill("#rq-item", "Rugged tablet"); await e.fill("#rq-qty", "3"); await e.fill("#rq-est_amount", "2400");
  await e.click("[data-submit]");
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from records where section = 'operations.requests' and title = $1", [`Rugged tablets ${tag}`]))[0].n === 1), "created");
  R.pr = (await sql("select * from records where section = 'operations.requests' and title = $1", [`Rugged tablets ${tag}`]))[0];
  assert.match(R.pr.data.number, /^AGR-PR-/);
  assert.ok(await waitFor(async () => (await inst(R.pr.id))?.cur === "tech_review"), "submitted: now at technical review");
  assert.ok(await waitFor(async () => (await e.$$("[data-instance] [data-current='tech_review']")).length === 1), "the process view opens at the current step");
  await shot(e, "process-view"); await e.context().close();
  // the engineer reviews in the process view
  const g = await login(U.eng.email); await g.goto(`${APP}/ops?tab=mine`);
  assert.ok(await waitFor(async () => (await g.$$(`[data-list='needs_action'] [data-rec='${R.pr.id}']`)).length === 1), "it needs the engineer's action");
  await g.click(`[data-list='needs_action'] [data-rec='${R.pr.id}'] button:has-text('Open')`);
  await g.click("[data-act='approved']");
  assert.ok(await waitFor(async () => (await inst(R.pr.id)).cur === "quotations")); await g.context().close();
  // procurement: two quotations, submit, compare, choose with a reason
  for (const [v, amt, lead] of [[R.vendor, 2300, 12], [R.vendor2, 2550, 4]] as const)
    await sql("insert into records(section, title, status, data) values ('operations.quotations', $1, 'Received', $2)", [`Quote ${v.title}`, { request_ref: R.pr.id, vendor_ref: v.id, vendor_ref_title: v.title, amount: amt, currency: "USD", lead_time_days: lead, valid_until: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) }]);
  const p = await login(U.proc.email); await p.goto(`${APP}/ops?i=${(await inst(R.pr.id)).id}`);
  assert.ok(await waitFor(async () => (await p.$$("[data-act='submit']")).length === 1)); await p.click("[data-act='submit']");
  assert.ok(await waitFor(async () => (await inst(R.pr.id)).cur === "vendor_selection"));
  assert.ok(await waitFor(async () => (await p.$$("[data-quotes] [data-select]")).length === 2), "two quotations to choose from");
  const qt = await p.textContent("[data-quotes]"); assert.match(qt!, /lowest/); assert.match(qt!, /shortest/); assert.doesNotMatch(qt!, /\bbest\b/i, "no quotation is called best");
  await p.fill("[data-quotes] textarea", "Lower total price; delivery time is acceptable for the project");
  const q1 = (await sql("select id from records where section = 'operations.quotations' and data->>'request_ref' = $1 and (data->>'amount')::numeric = 2300", [R.pr.id]))[0].id;
  await p.click(`[data-select='${q1}']`);
  assert.ok(await waitFor(async () => (await inst(R.pr.id)).cur === "approval"), "the choice goes to approval");
  await shot(p, "quotations"); await p.context().close();
  // the department lead approves the exact values
  const l = await login(U.lead.email); await l.goto(`${APP}/ops?i=${(await inst(R.pr.id)).id}`);
  assert.ok(await waitFor(async () => (await l.$$("[data-my-approval]")).length === 1));
  assert.match(await l.textContent("[data-my-approval]") as string, /selected_amount=2300/);
  await shot(l, "approval"); await l.click("[data-decide='approved']");
  assert.ok(await waitFor(async () => (await inst(R.pr.id)).cur === "order"), "approved → purchase record → order task");
  const po = (await sql("select * from records where section = 'operations.procurement' and data->>'request_ref' = $1", [R.pr.id]))[0];
  assert.ok(po); assert.equal(Number(po.data.amount), 2300); assert.match(po.data.number, /^AGR-PO-/);
  await l.context().close();
});

test("Operations dashboard drills to the records; Executive Control has the Operations card; the builder validates", { skip }, async () => {
  const m = await login(U.mgmt.email); await m.goto(`${APP}/ops?tab=dashboard`);
  assert.ok(await waitFor(async () => (await m.$$("[data-block]")).length === 8), "eight blocks");
  await shot(m, "dashboard");
  await m.click("[data-kind='po_awaiting_delivery']");
  assert.ok(await waitFor(async () => (await m.$$(`[data-drill] [data-rec]`)).length > 0), "the number opens its list");
  await m.goto(`${APP}/control`);
  assert.ok(await waitFor(async () => (await m.$$("[data-ops-card] [data-ops-kind]")).length === 8), "Operations in Executive Control");
  await m.goto(`${APP}/ops?tab=builder`);
  assert.ok(await waitFor(async () => (await m.$$("[data-def='PURCHASE']")).length === 1));
  await shot(m, "builder"); await m.context().close();
});

test("A US-only request is invisible to a non-US employee on every operations screen", { skip }, async () => {
  const hidden = (await sql("insert into records(section, title, status, data, created_by) values ('operations.requests', $1, 'Submitted', $2, $3) returning *", [`Secret sensors ${tag}`, { project_ref: R.us.id, item: "x", est_amount: 1, requester_id: U.mgmt.id }, U.mgmt.id]))[0];
  assert.equal(hidden.controlled, true, "inherited from the project");
  const n = await login(U.non.email);
  for (const t of ["mine", "dashboard"]) { await n.goto(`${APP}/ops?tab=${t}`); await n.waitForTimeout(1500); assert.ok(!(await n.content()).includes(`Secret sensors ${tag}`), t); }
  await n.goto(`${APP}/ops?tab=dashboard`); await n.click("[data-kind='pr_open']"); await n.waitForTimeout(1500); assert.ok(!(await n.content()).includes(`Secret sensors ${tag}`), "drill-down");
  await n.context().close();
});

test("Phone layout of Requests & processes", { skip }, async () => {
  const p = await login(U.emp.email, { width: 390, height: 844 }); await p.goto(`${APP}/ops?tab=mine`);
  assert.ok(await waitFor(async () => (await p.$$("[data-mine]")).length === 5));
  const w = await p.evaluate(() => document.documentElement.scrollWidth); assert.ok(w <= 400, `no sideways scroll (${w}px)`);
  await shot(p, "phone"); await p.context().close();
});
