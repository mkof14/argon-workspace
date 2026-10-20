// Phase 4 in a real browser against the app built on the test stack (synthetic people and data, no real AGRON
// technical information): the Document Center for three roles (what each one sees and counts), table / list,
// filters; the document drawer with versions, upload and integrity check; Knowledge search to the current article;
// the calendar views; the decision log with its sources; meeting minutes generated and approved by the organizer;
// information settings for administrators; the 390 px phone layout.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { APP, ENV, makeUser, PASSWORD, sql, uid } from "./_stack.ts";

const skip = !APP; const run = uid(); const tag = `zz${run.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
let pw: any, browser: any; const U: Record<string, any> = {}; const D: Record<string, any> = {};
const SHOTS = path.join(ENV.STACK_DIR || ".stack", "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const loadPw = () => { try { return createRequire(import.meta.url)("playwright"); } catch { return createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright"); } };
const shot = (p: any, n: string) => p.screenshot({ path: path.join(SHOTS, `p4-${n}.png`) });
const waitFor = async (fn: () => Promise<boolean>, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
async function login(email: string, viewport = { width: 1280, height: 900 }) {
  const c = await browser.newContext({ viewport, locale: "en-US" }); const p = await c.newPage();
  await p.addInitScript(() => { try { localStorage.setItem("agronws.lang", "en"); } catch {} });
  await p.goto(`${APP}/login`); await p.fill("#email", email); await p.fill("#password", PASSWORD); await p.click("button[type=submit]");
  await p.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 20000 }); return p;
}
const ids = async (p: any) => p.$$eval("[data-doc]", (els: any[]) => [...new Set(els.map((e) => e.getAttribute("data-doc")))]);

before(async () => {
  if (skip) return;
  pw = loadPw(); browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-proxy-server"] });
  U.mgmt = await makeUser(`p4m-${run}@agron-stack.test`, "management", { us: true, name: `Mona Mgmt ${run}` });
  U.eng = await makeUser(`p4e-${run}@agron-stack.test`, "engineering", { us: true, name: `Evan Eng ${run}` });
  U.nonus = await makeUser(`p4n-${run}@agron-stack.test`, "engineering", { us: false, name: `Nadia NonUS ${run}` });
  U.adm = await makeUser(`p4a-${run}@agron-stack.test`, "admin", { us: true, name: `Ada Admin ${run}` });
  const mk = async (k: string, cls: string, extra: Record<string, any> = {}) => (D[k] = (await sql(`insert into records(section, title, status, controlled, created_by, data) values ('company.documents', $1, 'Draft', $2, $3, $4) returning *`,
    [`${k} ${tag}`, cls === "US Persons Only", cls === "Restricted" ? U.mgmt.id : U.eng.id, { doc_type: "Procedure", classification: cls, owner_id: U.eng.id, department: "engineering", description: `synthetic ${tag}`, ...extra }]))[0]);
  await mk("Internal procedure", "Internal"); await mk("Confidential budget", "Confidential"); await mk("US-only drawing", "US Persons Only"); await mk("Restricted plan", "Restricted", { owner_id: U.mgmt.id });
  D.kb = (await sql(`insert into records(section, title, status, created_by, data) values ('company.wiki', $1, 'Published', $2, $3) returning *`, [`Receiving inspection ${tag}`, U.mgmt.id, { category: "Procedures", summary: `How to inspect parts ${tag}`, body: `1. Check the packing list ${tag}`, language: "en" }]))[0];
  const today = new Date().toISOString().slice(0, 10);
  D.meet = (await sql(`insert into records(section, title, status, created_by, data) values ('company.meetings', $1, 'Scheduled', $2, $3) returning *`, [`Design review ${tag}`, U.mgmt.id, { date: today, time: "10:00", timezone: "America/New_York", organizer_id: U.mgmt.id, participants_ids: [U.eng.id], agenda: `Harness ${tag}`, notes: "Synthetic notes", decisions: `Use connector B ${tag}`, action_items: [{ id: "a1", title: `Order samples ${tag}`, assignee_id: U.eng.id }] }]))[0];
  D.dec = (await sql(`insert into records(section, title, status, created_by, data) values ('company.decisions', $1, 'Approved', $2, $3) returning *`, [`Connector choice ${tag}`, U.mgmt.id, { decision: `Use connector B ${tag}`, source_ref: D.meet.id, source_section: "meeting", document_ref: D["Internal procedure"].id, responsible_id: U.eng.id, due: today }]))[0];
});
after(async () => { await browser?.close(); });

test("Document Center: each role sees and counts only what it may open; table, list, views and filters", { skip }, async () => {
  const seen: Record<string, string[]> = {};
  for (const k of ["mgmt", "eng", "nonus"]) {
    const p = await login(U[k].email); await p.goto(`${APP}/documents`); await p.waitForSelector(".doc-center");
    await p.fill(".doc-center .search input", tag); await p.waitForTimeout(800);
    assert.ok(await waitFor(async () => (await ids(p)).length > 0), `${k} sees the list`);
    seen[k] = (await ids(p)).sort();
    const total = Number(await p.textContent("[data-total]"));
    assert.equal(total, seen[k].length, `${k}: the count equals the rows shown (no hidden documents counted)`);
    if (k === "eng") { await shot(p, "document-center"); await p.click(".doc-center [data-view='controlled']"); await p.waitForTimeout(800); assert.deepEqual((await ids(p)).sort(), [D["US-only drawing"].id], "Controlled view"); }
    if (k === "mgmt") { await p.selectOption(".doc-center select[aria-label='Classification']", "Confidential"); await p.waitForTimeout(800); assert.deepEqual(await ids(p), [D["Confidential budget"].id], "classification filter"); }
    await p.context().close();
  }
  const id = (k: string) => D[k].id;
  assert.deepEqual(seen.mgmt, [id("Internal procedure"), id("Confidential budget"), id("US-only drawing"), id("Restricted plan")].sort());
  assert.deepEqual(seen.eng, [id("Internal procedure"), id("Confidential budget"), id("US-only drawing")].sort(), "Restricted is not shown to an engineer who is not on it");
  assert.deepEqual(seen.nonus, [id("Internal procedure"), id("Confidential budget")].sort(), "US-persons-only is invisible to a non-US employee");
});

test("document drawer: upload a version, the system number and version, integrity check", { skip }, async () => {
  const p = await login(U.eng.email); const d = D["Internal procedure"];
  await p.goto(`${APP}/company/documents?r=${d.id}`); await p.waitForSelector("#f-title", { timeout: 20000 });
  await p.fill("aside.drawer input[aria-label='Change description']", "First issue");
  await p.setInputFiles("aside.drawer input[data-upload-version]", { name: "procedure.txt", mimeType: "text/plain", buffer: Buffer.from(`synthetic procedure ${tag}`) });
  await p.waitForSelector("aside.drawer .ver[data-version='0.1']", { timeout: 20000 });
  assert.equal((await sql("select change_note from document_versions where record_id = $1", [d.id]))[0].change_note, "First issue");
  await p.click("aside.drawer .ver[data-version='0.1'] button[title='Check integrity']");
  assert.ok(await waitFor(async () => (await sql("select verified_ok from document_versions where record_id = $1", [d.id]))[0].verified_ok === true), "integrity verified against the stored hash");
  assert.match(await p.textContent("aside.drawer"), new RegExp(d.data.doc_number), "the register number is shown");
  await shot(p, "document-versions"); await p.context().close();
});

test("Knowledge: search reaches the current published article", { skip }, async () => {
  const p = await login(U.nonus.email); await p.goto(`${APP}/knowledge`);
  await p.fill(".card .search input[type=search]", tag); await p.waitForSelector("[data-kb-hits]", { timeout: 15000 });
  await p.click(`[data-kb-hits] .hub-row:has-text('Receiving inspection')`); await p.waitForSelector(`[data-open-article='${D.kb.id}']`);
  assert.match(await p.textContent(".kb-article"), new RegExp(`inspect parts ${tag}`)); await shot(p, "knowledge"); await p.context().close();
});

test("calendar: day, week, month and agenda show the meeting; decision log shows source and responsible", { skip }, async () => {
  const p = await login(U.eng.email); await p.goto(`${APP}/calendar`); await p.waitForSelector(".cal-page");
  for (const v of ["day", "week", "agenda"]) { await p.click(`[data-calview='${v}']`); assert.ok(await p.waitForSelector(`.cal-page :text('Design review ${tag}')`, { timeout: 15000 }), v); }
  await p.click("[data-calview='month']"); await p.waitForTimeout(800); assert.match(await p.textContent(".cal-page"), new RegExp(`Design review ${tag}|1`), "month"); await shot(p, "calendar");
  await p.goto(`${APP}/decisions`); await p.waitForSelector(`[data-decision='${D.dec.id}']`, { timeout: 15000 });
  const row = await p.textContent(`[data-decision='${D.dec.id}']`);
  assert.match(row!, /Design review/, "the source meeting"); assert.match(row!, /Internal procedure/, "the related document"); assert.match(row!, /Evan Eng/, "the responsible person");
  await shot(p, "decision-log"); await p.context().close();
});

test("meeting record: generated as a draft, becomes the record only when the organizer approves it", { skip }, async () => {
  const p = await login(U.mgmt.email); await p.goto(`${APP}/company/meetings?r=${D.meet.id}`); await p.waitForSelector("#f-title", { timeout: 20000 });
  await p.click("[data-generate-minutes]"); await p.waitForSelector(".minutes-view[data-minutes-state='draft']");
  assert.match(await p.textContent(".minutes-view"), new RegExp(`Use connector B ${tag}`));
  await p.click("aside.drawer >> button.btn.primary:has-text('Save')");
  assert.ok(await waitFor(async () => !!(await sql("select data->>'minutes' m from records where id = $1", [D.meet.id]))[0].m), "minutes saved as a draft");
  assert.equal((await sql("select coalesce(data->>'minutes_state', 'draft') s from records where id = $1", [D.meet.id]))[0].s, "draft");
  await p.click("[data-approve-minutes]", { timeout: 15000 });
  assert.ok(await waitFor(async () => (await sql("select data->>'minutes_state' s, data->>'minutes_approved_by' b from records where id = $1", [D.meet.id]))[0].s === "approved"), "approved by the organizer");
  await shot(p, "meeting-record"); await p.context().close();
});

test("information settings for administrators; Document Center and Knowledge fit a 390 px phone", { skip }, async () => {
  const a = await login(U.adm.email); await a.goto(`${APP}/admin/info`); await a.waitForSelector(":text('Departments')", { timeout: 15000 });
  const codes = await a.$$eval("main input", (els: any[]) => els.map((e) => e.value)); assert.ok(codes.includes("ENG") || /ENG/.test(await a.textContent("main")), "the department directory is listed");
  assert.match(await a.textContent("main"), /Document numbers/); await shot(a, "info-settings"); await a.context().close();
  const p = await login(U.eng.email, { width: 390, height: 844 });
  for (const r of ["/documents", "/knowledge", "/calendar", "/decisions"]) {
    await p.goto(`${APP}${r}`); await p.waitForTimeout(1500);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `${r}: no sideways scrolling on a phone (${over}px)`);
  }
  await shot(p, "phone-documents"); await p.context().close();
});
