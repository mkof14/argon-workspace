// Phase 7 in a real browser against the app built on the test stack (synthetic people and data only): IDEX capture on
// a phone-width screen (lead + owner + follow-up, no horizontal scrolling); a business card read from its QR/vCard text
// (proposed fields → duplicate check → confirmation → record; nothing created before confirmation); one-step lead
// conversion; the opportunity view (next action, a stage rule refusing Lost without a reason, then accepting it); the
// dashboard numbers opening their lists; settings hidden from people without the authority; the unapproved policy label.
// Screenshots: .stack/shots/p7-*.png
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { APP, ENV, makeUser, PASSWORD, sql, uid } from "./_stack.ts";

const skip = !APP; const run = uid(); const tag = `e7${run.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
let pw: any, browser: any; const U: Record<string, any> = {}; const R: Record<string, any> = {};
const SHOTS = path.join(ENV.STACK_DIR || ".stack", "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const loadPw = () => { try { return createRequire(import.meta.url)("playwright"); } catch { return createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright"); } };
const shot = (p: any, n: string) => p.screenshot({ path: path.join(SHOTS, `p7-${n}.png`), fullPage: false });
const waitFor = async (fn: () => Promise<boolean>, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const PHONE = { width: 390, height: 844 };
async function login(email: string, viewport = { width: 1280, height: 900 }) {
  const c = await browser.newContext({ viewport, locale: "en-US", isMobile: viewport.width < 500, hasTouch: viewport.width < 500 }); const p = await c.newPage();
  await p.addInitScript(() => { try { localStorage.setItem("agronws.lang", "en"); } catch {} });
  await p.goto(`${APP}/login`); await p.fill("#email", email); await p.fill("#password", PASSWORD); await p.click("button[type=submit]");
  await p.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 20000 }); return p;
}
const noHScroll = (p: any) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const leadsTitled = async (like: string) => sql("select * from records where section = 'marketing.leads' and title like $1", [like]);

before(async () => {
  if (skip) return;
  pw = loadPw(); browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-proxy-server"] });
  U.sales = await makeUser(`e7s-${run}@agron-stack.test`, "sales", { us: true, name: `Sami Sales ${tag}` });
  U.mkt = await makeUser(`e7k-${run}@agron-stack.test`, "marketing", { us: true, name: `Mira Mkt ${tag}` });
  U.mgmt = await makeUser(`e7m-${run}@agron-stack.test`, "management", { us: true, name: `Max Mgmt ${tag}` });
  U.admin = await makeUser(`e7a-${run}@agron-stack.test`, "admin", { us: true, name: `Ada Admin ${tag}` });
  // a known organisation and contact (the card's person is already in Workspace)
  R.org = (await sql("insert into records(section, title, status, data) values ('company.parties', $1, 'Active', $2) returning *", [`Harbor Marine ${tag} LLC`, { domain: `harbor-${tag}.ae`, relationship_types: ["Prospect"] }]))[0];
  R.contact = (await sql("insert into records(section, title, status, data) values ('company.contacts', $1, 'Active', $2) returning *", [`Layla Haddad ${tag}`, { email: `layla@harbor-${tag}.ae`, party_ref: R.org.id, party_ref_title: R.org.title }]))[0];
  // an open opportunity (the dashboard and its lists have something to open on a fresh stack)
  R.open = (await sql("insert into records(section, title, status, data, created_by) values ('sales.pipeline', $1, 'Qualified', $2, $3) returning *",
    [`Harbor Marine ${tag} — StarDome`, { party_ref: R.org.id, party_ref_title: R.org.title, owner_id: U.sales.id, owner: `Sami Sales ${tag}`, value: 1200000, currency: "USD", next_action: "Call", next_action_due: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) }, U.sales.id]))[0];
});
after(async () => { await browser?.close(); });

test("Scenario 10 — IDEX capture on a phone: lead + owner + follow-up in the fast-entry flow, no horizontal scrolling", { skip }, async () => {
  const p = await login(U.mkt.email, PHONE); await p.goto(`${APP}/crm?tab=event`);
  assert.ok(await waitFor(async () => (await p.$$("[data-capture] [data-cap='first_name']")).length === 1), "capture form");
  assert.ok(await noHScroll(p), "no horizontal scrolling on the event screen");
  await p.fill("[data-cap='first_name']", "Karim"); await p.fill("[data-cap='organization']", `Yacht Club ${tag}`); await p.fill("[data-cap='phone']", "+33 6 1234 5678");
  await p.selectOption("[data-cap='importance']", "Hot"); await p.selectOption("[data-cap='owner_id']", U.sales.id);
  await shot(p, "event-capture-phone");
  const t0 = Date.now(); await p.click("[data-cap-save]");
  assert.ok(await waitFor(async () => (await leadsTitled(`%Yacht Club ${tag}%`)).length === 1), "lead saved");
  R.captureMs = Date.now() - t0;
  const l = (await leadsTitled(`%Yacht Club ${tag}%`))[0];
  assert.equal(l.data.owner_id, U.sales.id, "owner"); assert.match(String(l.data.follow_up), /^\d{4}-\d{2}-\d{2}$/, "follow-up date"); assert.equal(l.data.importance, "Hot");
  assert.ok(await noHScroll(p), "still no horizontal scrolling after saving");
  await p.click("[data-event-view='after']"); await p.waitForTimeout(800); assert.ok(await noHScroll(p));
  await shot(p, "event-after-phone"); await p.context().close();
});

test("Scenario 11 — business card (QR / vCard): proposed fields → duplicate check → confirmation → record; nothing before confirmation", { skip }, async () => {
  const p = await login(U.mkt.email, PHONE); await p.goto(`${APP}/crm?tab=event`);
  assert.ok(await waitFor(async () => (await p.$$("[data-card] summary")).length === 1));
  await p.click("[data-card] summary");
  await p.fill("[data-card-text]", `BEGIN:VCARD\nVERSION:3.0\nN:Haddad;Layla\nORG:Harbor Marine ${tag} LLC\nTITLE:Fleet Director\nEMAIL:LAYLA@HARBOR-${tag.toUpperCase()}.AE\nTEL:+971 50 111 2222\nEND:VCARD`);
  await p.click("[data-card-read]");
  assert.equal(await p.inputValue("[data-cap='first_name']"), "Layla"); assert.equal(await p.inputValue("[data-cap='organization']"), `Harbor Marine ${tag} LLC`);
  assert.equal(await p.inputValue("[data-cap='email']"), `layla@harbor-${tag}.ae`);
  assert.ok(await waitFor(async () => (await p.$$("[data-dupes] [data-dupe='strong']")).length >= 1), "the known contact is shown as a possible duplicate");
  assert.equal((await leadsTitled(`%Layla%Harbor Marine ${tag}%`)).length + (await leadsTitled(`%Harbor Marine ${tag}%`)).length, 0, "nothing is created before confirmation");
  assert.ok(await p.$("[data-card-note]"), "the screen says the fields are only proposed");
  await shot(p, "card-proposed-phone");
  await p.click("[data-cap-save]");
  assert.ok(await waitFor(async () => (await leadsTitled(`%Harbor Marine ${tag}%`)).length === 1), "confirmed → one lead");
  assert.equal((await sql("select count(*)::int n from records where section = 'company.contacts' and data->>'email' = $1", [`layla@harbor-${tag}.ae`]))[0].n, 1, "the contact is not duplicated");
  await p.context().close();
});

test("Lead → opportunity in one step from the Leads screen; the opportunity view: next action, Lost refused without a reason, then kept with it", { skip }, async () => {
  const p = await login(U.sales.email); await p.goto(`${APP}/crm?tab=leads`);
  const lead = (await leadsTitled(`%Yacht Club ${tag}%`))[0];
  assert.ok(await waitFor(async () => (await p.$$(`[data-convert='${lead.id}']`)).length === 1), "convert button");
  await p.click(`[data-convert='${lead.id}']`);
  assert.ok(await waitFor(async () => (await p.$$("[data-convert-dialog]")).length === 1));
  await p.fill("[data-conv-value]", "750000"); await p.selectOption("[data-conv-currency]", "EUR"); await p.fill("[data-conv-next]", "Send the brochure");
  await shot(p, "convert");
  await p.click("[data-conv-go]");
  assert.ok(await waitFor(async () => (await sql("select status from records where id = $1", [lead.id]))[0].status === "Converted"), "converted");
  const o = (await sql("select * from records where section = 'sales.pipeline' and data->>'lead_ref' = $1", [lead.id]))[0];
  assert.ok(o, "one opportunity"); assert.equal(o.data.currency, "EUR"); assert.equal(Number(o.data.value), 750000); assert.match(o.data.number, /^AGR-OPP-/);
  assert.equal((await sql("select count(*)::int n from records where section = 'company.parties' and title = $1", [`Yacht Club ${tag}`]))[0].n, 1, "one organisation");
  assert.ok(await waitFor(async () => (await p.$$(`[data-opp-view='${o.id}']`)).length === 1), "the opportunity opens");
  // next action
  await p.fill("[data-na-text]", "Call Karim about the site"); await p.click("[data-na-save]");
  assert.ok(await waitFor(async () => (await sql("select data->>'next_action' a from records where id = $1", [o.id]))[0].a === "Call Karim about the site"), "next action saved");
  // Lost without a reason → refused by the database, shown on screen
  await p.selectOption("[data-stage-select]", "Lost"); await p.click("[data-stage-save]");
  assert.ok(await waitFor(async () => (await p.$$("[data-err]")).length >= 1), "the refusal is shown");
  assert.notEqual((await sql("select status from records where id = $1", [o.id]))[0].status, "Lost", "not moved without a reason");
  await p.selectOption("[data-need='lost_reason']", { index: 1 }); await p.click("[data-stage-save]");
  assert.ok(await waitFor(async () => (await sql("select status from records where id = $1", [o.id]))[0].status === "Lost"), "moved with a reason");
  const h = await sql("select to_stage from crm_stage_history where record_id = $1 order by at", [o.id]);
  assert.equal(h[h.length - 1].to_stage, "Lost");
  await shot(p, "opportunity"); await p.context().close();
});

test("Dashboard numbers open their lists; the phone layout of the dashboard and the opportunity has no horizontal scrolling", { skip }, async () => {
  const p = await login(U.mgmt.email); await p.goto(`${APP}/crm`);
  assert.ok(await waitFor(async () => (await p.$$("[data-block='active']")).length === 1), "dashboard");
  const n = Number(await p.textContent("[data-block='active'] b")); assert.ok(n >= 1, "at least the opportunity created for this test");
  await p.click("[data-block='active']");
  assert.ok(await waitFor(async () => (await p.$$("[data-drill] [data-opp]")).length === Math.min(n, 300)), `the list behind «active» has ${n} rows`);
  await shot(p, "dashboard"); await p.context().close();
  const q = await login(U.mgmt.email, PHONE); await q.goto(`${APP}/crm`);
  assert.ok(await waitFor(async () => (await q.$$("[data-block='active']")).length === 1)); assert.ok(await noHScroll(q), "dashboard on a phone");
  await q.click("[data-block='active']"); assert.ok(await waitFor(async () => (await q.$$("[data-drill] [data-opp]")).length >= 1));
  await q.click("[data-drill] [data-opp]"); assert.ok(await waitFor(async () => (await q.$$("[data-opp-view]")).length === 1)); await q.waitForTimeout(600);
  assert.ok(await noHScroll(q), "opportunity on a phone"); await shot(q, "opportunity-phone"); await q.context().close();
});

test("Settings: hidden from a salesperson; a System Administrator sees no Commercial Admin controls; the seeded policy is labelled unapproved", { skip }, async () => {
  const s = await login(U.sales.email); await s.goto(`${APP}/crm`);
  assert.ok(await waitFor(async () => (await s.$$("[data-tab='dashboard']")).length === 1));
  assert.equal((await s.$$("[data-tab='settings']")).length, 0, "no settings tab for a salesperson"); await s.context().close();
  const a = await login(U.admin.email); await a.goto(`${APP}/crm?tab=settings`);
  await a.waitForTimeout(1500);
  assert.equal((await a.$$("[data-crm-settings-save]")).length, 0, "a System Administrator cannot save commercial settings by role");
  assert.equal((await a.$$("[data-cap-grant]")).length, 0, "nor grant authorities"); await a.context().close();
  const m = await login(U.mgmt.email); await m.goto(`${APP}/ops?tab=builder`);
  assert.ok(await waitFor(async () => (await m.$$("[data-policy-status='PROPOSAL']")).length === 1), "the PROPOSAL policy is listed");
  const label = await m.textContent("[data-policy-status='PROPOSAL']");
  const st = (await sql("select config_status from approval_policies where code = 'PROPOSAL'"))[0].config_status;
  if (st !== "Approved") assert.match(String(label), /UNAPPROVED DEFAULT CONFIGURATION/);
  await shot(m, "policies"); await m.context().close();
  fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "e2e7.json"), JSON.stringify({ capture_ms: R.captureMs }, null, 1));
});
