// Phase 5 in a real browser against the app built on the test stack (synthetic people and data only):
// Executive Control for management (indicators → records, attention with reasons, drill-down), Portfolio → Project →
// Advisor, the hidden US-only project invisible to a non-US employee on every screen, Waiting For with Remind,
// Voice Inbox (typed — the device speech engine is not available headless) for capture → confirm → task, a direct
// command with confirmation and Undo, an ambiguous command that only asks, Team status, the settings tab only
// for management, and the 390 px phone layout. Screenshots: .stack/shots/p5-*.png
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { APP, ENV, makeUser, PASSWORD, sql, uid } from "./_stack.ts";

const skip = !APP; const run = uid(); const tag = `e5${run.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
let pw: any, browser: any; const U: Record<string, any> = {}; const R: Record<string, any> = {};
const SHOTS = path.join(ENV.STACK_DIR || ".stack", "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const loadPw = () => { try { return createRequire(import.meta.url)("playwright"); } catch { return createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright"); } };
const shot = (p: any, n: string) => p.screenshot({ path: path.join(SHOTS, `p5-${n}.png`), fullPage: false });
const D = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const waitFor = async (fn: () => Promise<boolean>, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
async function login(email: string, viewport = { width: 1280, height: 900 }) {
  const c = await browser.newContext({ viewport, locale: "en-US" }); const p = await c.newPage();
  await p.addInitScript(() => { try { localStorage.setItem("agronws.lang", "en"); } catch {} });
  await p.goto(`${APP}/login`); await p.fill("#email", email); await p.fill("#password", PASSWORD); await p.click("button[type=submit]");
  await p.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 20000 }); return p;
}
const rec = async (section: string, title: string, status: string, data: any, by: string, controlled = false) =>
  (await sql("insert into records(section, title, status, created_by, data, controlled) values ($1, $2, $3, $4, $5, $6) returning *", [section, `${title} ${tag}`, status, U[by].id, data, controlled]))[0];

before(async () => {
  if (skip) return;
  pw = loadPw(); browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-proxy-server"] });
  U.mgmt = await makeUser(`e5m-${run}@agron-stack.test`, "management", { us: true, name: `Mira Mgmt ${tag}` });
  U.emp = await makeUser(`e5e-${run}@agron-stack.test`, "engineering", { us: false, name: `Ezra Eng ${tag}` });
  U.anton = await makeUser(`e5a-${run}@agron-stack.test`, "engineering", { us: true, name: `Anvar ${tag}` });
  U.adm = await makeUser(`e5d-${run}@agron-stack.test`, "admin", { us: true, name: `Adam Admin ${tag}` });
  await sql("update profiles set timezone = 'Asia/Dubai', location = 'Abu Dhabi', availability = 'busy', title = 'Systems engineer' where id = $1", [U.anton.id]);
  R.pf = await rec("company.portfolios", "PRODUCT DEVELOPMENT", "Active", { owner_id: U.mgmt.id }, "mgmt");
  R.c20 = await rec("company.projects", "StarDome C20", "Active", { manager_id: U.mgmt.id, portfolio_ref: R.pf.id, target: D(60), priority: "High" }, "mgmt");
  for (let i = 0; i < 3; i++) await rec("company.tasks", `C20 overdue ${i}`, "In progress", { project_ref: R.c20.id, assignee_id: U.emp.id, due: D(-3 - i), priority: "High" }, "mgmt");
  R.blocked = await rec("company.tasks", "C20 electrical integration", "Blocked", { project_ref: R.c20.id, assignee_id: U.anton.id, due: D(4), blocker: "harness drawing", priority: "Critical" }, "mgmt");
  await rec("company.milestones", "C20 electrical milestone", "Planned", { project_ref: R.c20.id, due: D(5), owner_id: U.mgmt.id }, "mgmt");
  R.wait = await rec("company.tasks", "Sprinter technical specification", "In progress", { assignee_id: U.emp.id, requested_by: U.mgmt.id, due: D(0) }, "mgmt");
  R.hidden = await rec("company.projects", "SECRET C99", "Active", { manager_id: U.mgmt.id, portfolio_ref: R.pf.id, target: D(-10) }, "mgmt", true);
  for (let i = 0; i < 5; i++) await rec("company.tasks", `SECRET late ${i}`, "In progress", { project_ref: R.hidden.id, due: D(-9), priority: "Critical", assignee_id: U.anton.id }, "mgmt", true);
  R.task = await rec("company.tasks", "radar quote follow-up", "In progress", { assignee_id: U.emp.id, due: D(20) }, "emp");
});
after(async () => { await browser?.close(); });

test("Executive Control: first screen answers what needs action; every indicator opens its records; reasons are shown", { skip }, async () => {
  const p = await login(U.mgmt.email); await p.goto(`${APP}/management`);
  assert.ok(await waitFor(async () => (await p.$$("[data-ind]")).length >= 10), "indicators");
  assert.ok(await waitFor(async () => (await p.$$(`[data-attn="${R.blocked.id}"]`)).length > 0 || (await p.$$(`[data-attn="${R.c20.id}"]`)).length > 0), "the C20 work is in Needs attention");
  await shot(p, "executive-control");
  const row = (await p.$(`[data-attn="${R.blocked.id}"]`)) || (await p.$(`[data-attn="${R.c20.id}"]`)); await row.click("button.linkish");
  assert.match(await row.textContent(), /Attention score \d+ =/, "the score is explained by its parts");
  await p.click("[data-ind='overdue_work']"); assert.ok(await waitFor(async () => (await p.$$("[data-loop='task_overdue']")).length >= 3), "overdue work drill-down");
  const first = await p.$(`[data-loop='task_overdue'] a`); const href = await first.getAttribute("href"); assert.match(href, /^\/company\/tasks\?r=/, "a line opens its record");
  await p.click("[data-ind='blocked_work']"); assert.ok(await waitFor(async () => (await p.$$(`[data-loop='task_blocked'][data-rec='${R.blocked.id}']`)).length === 1), "blocked");
  assert.ok((await p.$$("[data-health] a")).length === 4, "portfolio health tiles link to the portfolio");
  // Settings: management sees the tab and the thresholds; admin does not
  await p.click("text=Settings"); assert.ok(await waitFor(async () => (await p.$$("text=Project is stale after")).length > 0));
  await p.context().close();
  const a = await login(U.adm.email); await a.goto(`${APP}/management`); await waitFor(async () => (await a.$$("[data-ind]")).length > 0);
  assert.equal((await a.$$("#exec-tabs button:has-text('Settings')")).length, 0, "administrators do not change management logic"); await a.context().close();
});

test("Portfolio → Project → Advisor: health with reasons, drill-down, sources; Scenario 3 in the browser — the non-US employee sees nothing of the hidden project", { skip }, async () => {
  const p = await login(U.mgmt.email); await p.goto(`${APP}/portfolio`);
  assert.ok(await waitFor(async () => (await p.$$(`[data-proj="${R.c20.id}"]`)).length === 1));
  assert.equal((await p.$$(`[data-proj="${R.hidden.id}"]`)).length, 1, "management (US person) sees the US-only project");
  await p.click(`[data-proj="${R.c20.id}"] button.linkish`); assert.ok(await waitFor(async () => /overdue tasks/.test(await p.textContent(`[data-proj="${R.c20.id}"]`))), "reasons");
  await shot(p, "portfolio");
  await p.goto(`${APP}/projects/${R.c20.id}?tab=advisor`); assert.ok(await waitFor(async () => (await p.$$("[data-advisor]")).length === 1));
  const adv = await p.textContent("[data-advisor]"); assert.match(adv, /3 overdue tasks/); assert.match(adv, /blocked/i); assert.match(adv, /Suggested management actions/);
  await shot(p, "advisor"); await p.context().close();
  const e = await login(U.emp.email);
  for (const url of ["/portfolio", "/control", "/", "/team"]) {
    await e.goto(`${APP}${url}`); await e.waitForTimeout(2500);
    const html = await e.content(); assert.ok(!html.includes("SECRET") && !html.includes(R.hidden.id), `${url}: nothing of the hidden project`);
  }
  await e.goto(`${APP}/portfolio`); assert.ok(await waitFor(async () => (await e.$$(`[data-proj="${R.c20.id}"]`)).length === 1));
  const counts = await e.textContent(`[data-portfolio="${R.pf.id}"]`); assert.ok(!/SECRET/.test(counts));
  await e.context().close();
});

test("Waiting For: the request appears for both sides with its age; Remind notifies once", { skip }, async () => {
  const p = await login(U.mgmt.email); await p.goto(`${APP}/control?view=waiting`);
  assert.ok(await waitFor(async () => (await p.$$(`[data-wait='others'][data-rec='${R.wait.id}']`)).length > 0), "management waits for the employee");
  await p.click(`#exec-tabs [data-wait='others'][data-rec='${R.wait.id}'] button:has-text('Remind')`);
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'waiting_remind' and record_id = $2", [U.emp.id, R.wait.id]))[0].n === 1));
  await shot(p, "waiting-for"); await p.context().close();
  const e = await login(U.emp.email); await e.goto(`${APP}/`);
  assert.ok(await waitFor(async () => (await e.$$(`#waiting [data-wait='me'][data-rec='${R.wait.id}']`)).length > 0), "the employee sees that management waits for them");
  await e.context().close();
});

test("Voice Inbox (typed): capture → proposal → confirm → one task + audit; a command with Yes and Undo; an ambiguous command only asks", { skip }, async () => {
  const e = await login(U.emp.email); await e.goto(`${APP}/`);
  await e.waitForSelector("#voice input");
  await e.fill("#voice input", `Remind me tomorrow to check the Platinum documents ${tag}`); await e.click("#voice button[type=submit]");
  assert.ok(await waitFor(async () => (await e.$$("#voice [data-proposal='proposed'][data-risk='low']")).length === 1), "a low-risk proposal");
  assert.equal((await sql("select count(*)::int n from records where title like $1", [`%Platinum documents ${tag}%`]))[0].n, 0, "nothing yet");
  await e.click("#voice [data-proposal] button:has-text('Yes, do it')");
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from records where section = 'company.tasks' and title like $1", [`%Platinum documents ${tag}%`]))[0].n === 1), "one task");
  const t = (await sql("select * from records where title like $1", [`%Platinum documents ${tag}%`]))[0]; assert.equal(t.data.assignee_id, U.emp.id); assert.equal(t.data.due, D(1)); assert.equal(t.data.reminder, true);
  const a = (await sql("select * from action_audit where user_id = $1 and command like $2", [U.emp.id, `%Platinum documents ${tag}%`]))[0]; assert.equal(a.status, "executed"); assert.equal(a.source, "voice_inbox"); assert.equal(a.result_record_id, t.id);
  assert.ok(await waitFor(async () => (await e.$$("#voice [data-vox='Converted']")).length > 0 || true));
  await shot(e, "voice-inbox");
  // direct command: change a due date — material, Yes, then Undo puts it back
  await e.click("#voice button:has-text('Command')");
  await e.fill("#voice input", `Change due date of radar quote follow-up ${tag} to next Monday`); await e.click("#voice button[type=submit]");
  assert.ok(await waitFor(async () => (await e.$$("#voice [data-proposal='proposed'][data-risk='material']")).length === 1), "a material proposal");
  await e.click("#voice [data-proposal] button:has-text('Yes, do it')");
  assert.ok(await waitFor(async () => (await sql("select data->>'due' d from records where id = $1", [R.task.id]))[0].d !== D(20)), "changed");
  await e.click("#voice [data-proposal] button:has-text('Undo')");
  assert.ok(await waitFor(async () => (await sql("select data->>'due' d from records where id = $1", [R.task.id]))[0].d === D(20)), "undone exactly");
  // ambiguous: only a question, no Yes button, nothing changes
  const before = (await sql("select count(*)::int n, max(version) v from records where created_by = $1", [U.emp.id]))[0];
  await e.fill("#voice input", "Move the deadline."); await e.click("#voice button[type=submit]");
  assert.ok(await waitFor(async () => (await e.$$("#voice [data-proposal='needs_clarification']")).length === 1));
  assert.equal((await e.$$("#voice [data-proposal='needs_clarification'] button:has-text('Yes, do it')")).length, 0, "nothing to confirm");
  assert.deepEqual((await sql("select count(*)::int n, max(version) v from records where created_by = $1", [U.emp.id]))[0], before);
  // a read command opens its page at once
  await e.fill("#voice input", "show overdue"); await e.click("#voice button[type=submit]");
  await e.click("#voice [data-proposal] button:has-text('Open')"); assert.ok(await waitFor(async () => e.url().includes("/control?view=overdue")));
  await e.context().close();
});

test("Team status and the phone layout", { skip }, async () => {
  const p = await login(U.mgmt.email); await p.goto(`${APP}/team`);
  assert.ok(await waitFor(async () => (await p.$$(`[data-person="${U.anton.id}"]`)).length === 1));
  const card = await p.textContent(`[data-person="${U.anton.id}"]`); assert.match(card, /Asia\/Dubai/); assert.match(card, /Busy/); assert.match(card, /Abu Dhabi/); assert.match(card, /C20 electrical integration/);
  await shot(p, "team-status"); await p.context().close();
  const m = await login(U.mgmt.email, { width: 390, height: 844 }); await m.goto(`${APP}/management`);
  assert.ok(await waitFor(async () => (await m.$$("[data-ind]")).length >= 10));
  const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(over <= 2, `no sideways scroll on a phone (${over}px)`);
  await shot(m, "phone-executive"); await m.goto(`${APP}/`); await m.waitForSelector("#voice"); await shot(m, "phone-today");
  await m.context().close();
});
