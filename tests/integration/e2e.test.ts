// End to end in a real browser against the app built on the test stack (synthetic people and data):
// the complete daily workflow (account → project → task → notification → comment → document → review →
// changes → new version → approval → completion → project progress → management dashboard → history),
// navigation on desktop and on a 390 px phone in all four languages, a conflicting edit resolved in the dialog,
// an offline change that meets a newer copy, the two-step sign-in gate, and search that respects permissions.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { admin, APP, ENV, makeUser, mails, mailsTo, PASSWORD, sql, totp, uid } from "./_stack.ts";
import { deliverNotifications } from "../../src/lib/server/notify.ts";

const skip = !APP;
const db = admin(); const run = uid();
let pw: any, browser: any; let erin: any, omar: any, pat: any, olga: any, mia: any, admn: any;
export const evidence: Record<string, any> = { timings: {} as Record<string, number[]>, summary: {} as Record<string, any>, screenshots: [] as string[] };
const SHOTS = path.join(ENV.STACK_DIR || ".stack", "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const loadPw = () => { try { return createRequire(import.meta.url)("playwright"); } catch { return createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright"); } };
const time = (k: string, ms: number) => { (evidence.timings[k] ||= []).push(Math.round(ms)); };
const shot = async (p: any, name: string) => { const f = path.join(SHOTS, `${name}.png`); await p.screenshot({ path: f, fullPage: false }); evidence.screenshots.push(f); };

before(async () => {
  if (skip) return;
  pw = loadPw(); browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-proxy-server"] });
  erin = await makeUser(`erin-${run}@agron-stack.test`, "engineering", { name: `Erin Engineer ${run}` });
  omar = await makeUser(`omar-${run}@agron-stack.test`, "operations", { name: `Omar Ops ${run}` });
  pat = await makeUser(`pat-${run}@agron-stack.test`, "partner", { name: `Pat Partner ${run}`, company: "Acme" });
  olga = await makeUser(`olga-${run}@agron-stack.test`, "owner", { name: `Olga Owner ${run}` });
  mia = await makeUser(`mia-${run}@agron-stack.test`, "management", { name: `Mia Manager ${run}`, us: true });
  admn = await makeUser(`adam-${run}@agron-stack.test`, "admin", { name: `Adam Admin ${run}`, us: true });
});
after(async () => { await browser?.close(); console.log("E2E_EVIDENCE " + JSON.stringify(evidence)); });

async function login(email: string, o: { viewport?: { width: number; height: number }; lang?: string } = {}) {
  const c = await browser.newContext({ viewport: o.viewport || { width: 1280, height: 900 }, locale: "en-US" });
  const p = await c.newPage(); await p.addInitScript((l: string) => { try { localStorage.setItem("agronws.lang", l); } catch {} }, o.lang || "en");
  const t0 = Date.now(); await p.goto(`${APP}/login`); time("login_page_load", Date.now() - t0);
  await p.fill("#email", email); await p.fill("#password", PASSWORD); await p.click("button[type=submit]");
  await p.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  return { c, p };
}
const waitFor = async (fn: () => Promise<boolean>, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const record = async (title: string) => (await sql("select * from records where title = $1", [title]))[0];
const save = (p: any) => p.click("aside.drawer >> button.btn.primary:has-text('Save')");
const drawerOpen = (p: any) => p.waitForSelector("#f-title", { timeout: 20000 });

test("the daily workflow from a new account to the management dashboard", { skip }, async () => {
  const proj = `StarDome C40 pilot ${run}`, task = `Prepare FAT checklist ${run}`, doc = `FAT checklist ${run}`;
  // 1. an administrator creates the employee account (invitation with role and department)
  const { p: pa } = await login(admn.email);
  await pa.goto(`${APP}/admin/users`); await pa.waitForSelector("#inv-email");
  const newMail = `nina-${run}@agron-stack.test`;
  await pa.fill("#inv-email", newMail); await pa.selectOption("#inv-role", "engineering"); await pa.selectOption("#inv-dept", "engineering");
  await pa.click("button.btn.primary:has-text('Invite user')");
  assert.ok(await waitFor(async () => (await sql("select role, department from profiles where email = $1", [newMail]))[0]?.department === "engineering"), "account created with role and department");
  assert.ok(await waitFor(async () => mailsTo(newMail).length > 0), "the invitation e-mail was sent");
  const [nina] = await sql("select id, role from profiles where email = $1", [newMail]); assert.equal(nina.role, "engineering");
  await db.from("profiles").update({ full_name: `Nina New ${run}` }).eq("id", nina.id);
  // the person chooses a password on the invitation page (done here through Auth, the page itself is Supabase's)
  await db.auth.admin.updateUserById(nina.id, { password: PASSWORD, email_confirm: true });
  // 2. the employee signs in
  const { p: pn } = await login(newMail); await pn.waitForSelector(".today-hero", { timeout: 20000 });
  // 3. the manager creates a project with the employee in the team
  const { p: pm } = await login(mia.email);
  let t0 = Date.now(); await pm.goto(`${APP}/company/projects?new=1`); await drawerOpen(pm); time("open_new_record", Date.now() - t0);
  await pm.fill("#f-title", proj); await pm.selectOption("#f-manager", mia.id); await pm.selectOption("#f-department", "operations"); await pm.fill("#f-target", "2026-12-20");
  await pm.fill("[data-people=members]", "Nina New"); await pm.click(`.ref-menu button:has-text('Nina New ${run}')`);
  await save(pm); assert.ok(await waitFor(async () => !!(await record(proj))), "project saved");
  const P = await record(proj); assert.equal(P.data.manager_id, mia.id); assert.deepEqual(P.data.members_ids, [nina.id]);
  // 4. the manager assigns a task in the project
  t0 = Date.now(); await pm.goto(`${APP}/company/tasks?new=1&project_ref=${P.id}&project_ref_title=${encodeURIComponent(proj)}`); await drawerOpen(pm);
  await pm.fill("#f-title", task); await pm.selectOption("#f-assignee", nina.id); await pm.fill("#f-due", "2026-12-01"); await pm.selectOption("#f-priority", "High");
  await save(pm); assert.ok(await waitFor(async () => !!(await record(task))), "task saved"); time("task_create", Date.now() - t0);
  const T0 = await record(task); assert.equal(T0.data.assignee_id, nina.id, "linked to the account, not a name"); assert.equal(T0.data.project_ref, P.id); assert.equal(T0.status, "New"); assert.equal(T0.created_by, mia.id);
  // 5. the employee receives the notification (in Workspace and by e-mail)
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from notifications where user_id = $1 and record_id = $2 and kind = 'assigned'", [nina.id, T0.id]))[0].n === 1));
  await deliverNotifications(db, { deadline: Date.now() + 15000 }); assert.ok(mailsTo(newMail).some((m) => m.raw.includes(task.slice(0, 18))), "e-mail with the task");
  await pn.reload(); await pn.waitForSelector(".bell .badge", { timeout: 20000 }); await shot(pn, "today-desktop");
  // 6. the employee opens the task from the notification
  await pn.click(".bell"); await pn.click(`.inbox .notice:has-text('${task}')`); await drawerOpen(pn);
  assert.equal(await pn.inputValue("#f-title"), task);
  // 7. a comment that mentions the manager
  await pn.fill("aside.drawer .composer textarea[aria-label='Message']", "Started — see the checklist @Mia"); await pn.keyboard.press("Backspace"); await pn.keyboard.press("Backspace"); await pn.keyboard.press("Backspace");
  await pn.keyboard.type("Mia"); await pn.click(`.mention-menu button:has-text('Mia Manager ${run}')`); // several people may be called Mia
  const netlog: string[] = []; const t7 = Date.now();
  pn.on("response", (r: any) => { if (r.url().includes("/rest/v1/comments") || r.url().includes("/auth/v1/user")) netlog.push(`${Date.now() - t7}ms ${r.request().method()} ${r.status()} ${r.url().split("?")[0].slice(-30)}`); });
  pn.on("requestfailed", (r: any) => netlog.push(`${Date.now() - t7}ms FAILED ${r.url().slice(-40)} ${r.failure()?.errorText}`));
  await pn.click("aside.drawer .composer button.btn.primary");
  const stored = await waitFor(async () => !!(await sql("select mentions from comments where record_id = $1", [T0.id]))[0]?.mentions?.includes(mia.id), 30000);
  assert.ok(stored, `the mention is stored by account: ${JSON.stringify(await sql("select body, mentions, created_at from comments where record_id = $1", [T0.id]))} net=${JSON.stringify(netlog)} now=${new Date().toISOString()}`);
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'mention' and record_id = $2", [mia.id, T0.id]))[0].n === 1), "the manager is told");
  // 8. the employee adds the document to the register, attaches the file and sends it for approval
  await pn.goto(`${APP}/company/documents?new=1&project_ref=${P.id}&project_ref_title=${encodeURIComponent(proj)}`); await drawerOpen(pn);
  await pn.fill("#f-title", doc); await pn.selectOption("#f-doc_type", "Engineering documentation"); await pn.fill("#f-version", "1"); await pn.selectOption("#f-status", "In review");
  await save(pn); assert.ok(await waitFor(async () => !!(await record(doc))));
  const D = await record(doc);
  await pn.goto(`${APP}/company/documents?r=${D.id}`); await drawerOpen(pn);
  await pn.setInputFiles("aside.drawer input[type=file][multiple]", { name: "fat-checklist.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic v1") });
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from storage.objects where name like $1", [`company.documents/${D.id}/%`]))[0].n === 1), "file attached");
  await pn.click("aside.drawer button:has-text('Send for approval')"); await pn.selectOption(".appr-form select", mia.id); await pn.click(".appr-form button:has-text('Send')");
  assert.ok(await waitFor(async () => (await sql("select status from approvals where record_id = $1", [D.id]))[0]?.status === "pending"), "approval requested");
  // 9–10. the manager reviews the document and asks for changes
  await pm.goto(`${APP}/company/documents?r=${D.id}`); await drawerOpen(pm);
  await pm.waitForSelector("aside.drawer .att-row:has-text('fat-checklist.pdf')");
  t0 = Date.now(); const [popup] = await Promise.all([pm.waitForEvent("response", (r: any) => r.url().includes("/object/sign/") || r.url().includes("/storage/v1/object/sign"), { timeout: 15000 }).catch(() => null), pm.click("aside.drawer .att-row:has-text('fat-checklist.pdf') button[title='Preview']")]); time("document_open", Date.now() - t0);
  assert.ok(popup, "the preview link was issued"); await pm.click(".viewer .iconbtn");
  await pm.fill(".appr textarea", "Add the wiring section"); await pm.click(".appr button:has-text('Request changes')");
  assert.ok(await waitFor(async () => (await sql("select status, decided_by from approvals where record_id = $1 order by created_at desc limit 1", [D.id]))[0]?.status === "changes_requested"));
  assert.equal((await record(doc)).status, "Draft", "the document goes back to Draft");
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'approval_done' and record_id = $2", [nina.id, D.id]))[0].n === 1), "the employee is told");
  // 11. the employee uploads a new version (the first one stays) and sends it again
  await pn.goto(`${APP}/company/documents?r=${D.id}`); await drawerOpen(pn);
  await pn.waitForSelector("aside.drawer button[aria-label='Upload a new version']");
  const [fc] = await Promise.all([pn.waitForEvent("filechooser"), pn.click("aside.drawer button[aria-label='Upload a new version']")]);
  await fc.setFiles({ name: "fat-checklist.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic v2 with wiring") });
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from storage.objects where name like $1", [`company.documents/${D.id}/%`]))[0].n === 2), "both versions kept");
  await pn.reload(); await drawerOpen(pn); await pn.waitForSelector("aside.drawer .att-vers");
  await pn.fill("#f-version", "2"); await pn.selectOption("#f-status", "In review"); await save(pn);
  assert.ok(await waitFor(async () => (await record(doc)).status === "In review"));
  await pn.goto(`${APP}/company/documents?r=${D.id}`); await drawerOpen(pn);
  await pn.click("aside.drawer button:has-text('Send for approval')"); await pn.selectOption(".appr-form select", mia.id); await pn.click(".appr-form button:has-text('Send')");
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from approvals where record_id = $1 and status = 'pending'", [D.id]))[0].n === 1));
  // 12. the manager approves (from the approvals page)
  await pm.goto(`${APP}/decide`); await pm.waitForSelector(`.dc:has-text('${doc}')`, { timeout: 20000 }); await shot(pm, "approvals-desktop");
  await pm.click(`.dc:has-text('${doc}') button:has-text('Approve')`);
  assert.ok(await waitFor(async () => (await record(doc)).status === "Approved"), "document approved");
  // 13. the employee completes the task
  await pn.goto(`${APP}/company/tasks?r=${T0.id}`); await drawerOpen(pn); await pn.selectOption("#f-status", "Completed"); await save(pn);
  assert.ok(await waitFor(async () => (await record(task)).status === "Completed"));
  assert.equal((await record(task)).data.completed_at, new Date().toISOString().slice(0, 10), "completion date set automatically");
  // 14. the project shows the progress
  t0 = Date.now(); await pm.goto(`${APP}/projects/${P.id}`); await pm.waitForSelector(".proj-hero"); time("project_open", Date.now() - t0);
  assert.match(await pm.locator(".kpis").innerText(), /100%/); await shot(pm, "project-desktop");
  await pm.click("[data-tab=documents]"); assert.ok(await pm.locator(`.hub-row:has-text('${doc}')`).count());
  // 15. the management dashboard reflects it
  t0 = Date.now(); await pm.goto(`${APP}/management`); await pm.waitForSelector(".mkpis"); time("dashboard_load", Date.now() - t0);
  await pm.selectOption("select[aria-label='Project']", P.id);
  assert.match(await pm.locator(".hub-card.wide").first().innerText(), new RegExp(`${proj.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*100%`)); await shot(pm, "management-desktop");
  // 16. the history holds the whole sequence
  const h = await sql("select r.section, a.action, a.actor, a.detail from activity a join records r on r.id = a.record_id where a.record_id = any($1) order by a.id", [[P.id, T0.id, D.id]]);
  const seq = h.map((x: any) => `${x.section.split(".")[1]}:${x.action}${x.action === "status" ? `:${x.detail.from}→${x.detail.to}` : ""}`);
  for (const step of ["projects:created", "tasks:created", "documents:created", "documents:status:In review→Draft", "documents:status:Draft→In review", "documents:status:In review→Approved", "tasks:status:New→Completed"]) assert.ok(seq.includes(step), `history has ${step} (${seq.join(", ")})`);
  const c = await sql("select body from comments where record_id = $1 order by created_at", [D.id]); assert.ok(c.some((x: any) => /Changes requested by Mia/.test(x.body)) && c.some((x: any) => /Approved by Mia/.test(x.body)), "decisions are in the document's discussion");
  evidence.workflow = { project: P.id, task: T0.id, document: D.id, history: seq };
});

test("navigation: six main sections, two clicks to anything, permissions, phone width, four languages", { skip }, async () => {
  const { p } = await login(erin.email); await p.waitForSelector(".rail .nav-item.primary");
  const labels = await p.locator(".rail .nav-item.primary span").allInnerTexts();
  assert.deepEqual(labels, ["Today", "Messages", "Projects", "Documents", "Calendar", "Assistant"]);
  for (const [href, sel] of [["/messages", ".threads"], ["/projects", ".tabs"], ["/documents", ".sec-hero"], ["/calendar", ".month"], ["/assistant", ".sec-hero"], ["/", ".today-hero"]] as const) {
    const t0 = Date.now(); await p.click(`.rail a.nav-item[href='${href}']`); await p.waitForSelector(sel, { timeout: 15000 }); time("navigation", Date.now() - t0);
    assert.equal(await p.locator(`.rail a.nav-item[href='${href}']`).getAttribute("aria-current"), "page", `${href} marked as current`);
  }
  assert.equal(await p.locator(".rail a[href='/management']").count(), 0, "engineering does not see the management dashboard");
  await p.goto(`${APP}/management`); await p.waitForSelector("text=You don't have access", { timeout: 10000 }).catch(() => null);
  assert.equal(await p.locator(".mkpis").count(), 0, "…and cannot open it by address");
  assert.equal(await p.locator(".rail a[href='/admin/users']").count(), 0);
  const { p: pp } = await login(pat.email); await pp.waitForSelector(".rail .nav-item.primary");
  assert.deepEqual(await pp.locator(".rail .nav-item.primary span").allInnerTexts(), ["Company overview", "Messages", "Reports"], "a partner sees only what partners may use");
  await pp.goto(`${APP}/documents`); assert.equal(await pp.locator(".sec-hero:has-text('Documents')").count(), 0);
  // phone: bottom bar, one tap to each main section, nothing wider than the screen, in every language
  for (const lang of ["en", "ru", "uk", "ar"]) {
    const { p: m } = await login(erin.email, { viewport: { width: 390, height: 844 }, lang });
    await m.waitForSelector(".tabbar a", { timeout: 15000 });
    assert.equal(await m.locator(".tabbar a").count(), 6);
    await m.locator(".tabbar a").nth(2).click(); await m.waitForURL(/\/projects/); await m.waitForSelector(".tabs [role=tab]", { timeout: 15000 }); await m.waitForTimeout(400);
    const wide = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(wide <= 1, `${lang}: no sideways scrolling (${wide}px)`);
    if (lang === "ar") assert.equal(await m.evaluate(() => document.documentElement.dir), "rtl");
    if (lang === "en" || lang === "ar") await shot(m, `projects-phone-${lang}`);
    await m.locator(".tabbar a").nth(0).click(); await m.waitForSelector(".today-hero"); if (lang === "en") await shot(m, "today-phone-en");
    await m.context().close();
  }
});

test("search finds by kind and project, in English and Russian, and never shows restricted records", { skip }, async () => {
  const secret = `Quasar${run}`;
  await db.from("records").insert([{ section: "company.tasks", title: `${secret} open task`, status: "New", data: {}, controlled: false, created_by: erin.id },
    { section: "company.tasks", title: `${secret} US-only task`, status: "New", data: {}, controlled: true }, { section: "finance.invoices", title: `${secret} invoice`, status: "Draft", data: {}, controlled: false },
    { section: "company.tasks", title: `Проверить ${secret} радар`, status: "New", data: {}, controlled: false }]);
  const { p } = await login(erin.email); await p.waitForSelector(".searchbtn");
  const t0 = Date.now(); await p.click(".searchbtn"); await p.fill(".gsearch input", secret);
  await p.waitForSelector(`.search-hit:has-text('${secret} open task')`, { timeout: 15000 }); time("search", Date.now() - t0);
  const txt = await p.locator(".search-list").innerText();
  assert.ok(!txt.includes("US-only") && !txt.includes("invoice"), "nothing restricted, not even the title");
  await p.click(".search-kinds button:has-text('Documents')"); await p.waitForTimeout(400);
  assert.equal(await p.locator(`.search-hit:has-text('${secret} open task')`).count(), 0, "filter by kind");
  await p.click(".search-kinds button:has-text('All')"); await p.fill(".gsearch input", `проверить ${secret.toLowerCase()}`);
  await p.waitForSelector(`.search-hit:has-text('Проверить')`, { timeout: 15000 });
  await p.fill(".gsearch input", `Erin Engineer ${run}`); await p.waitForSelector(`.search-hit:has-text('Erin Engineer ${run}')`);
  await shot(p, "search-desktop");
});

test("two people change the same field: the dialog shows both, the choice is saved, nothing is lost silently", { skip }, async () => {
  const { data: r } = await db.from("records").insert({ section: "company.tasks", title: `Order radar ${run}`, status: "New", data: { notes: "first", priority: "Normal" }, controlled: false, created_by: erin.id }).select("*").single();
  const { p } = await login(erin.email); await p.goto(`${APP}/company/tasks?r=${r.id}`); await p.waitForSelector("#f-notes");
  await db.from("records").update({ data: { ...r.data, notes: "omar's text", priority: "High" } }).eq("id", r.id);
  await p.fill("#f-notes", "erin's text"); await save(p);
  await p.waitForSelector("text=Someone changed this record while you were editing", { timeout: 15000 });
  assert.ok((await p.locator(".cf-list").innerText()).includes("omar's text")); await shot(p, "conflict-dialog");
  await p.click("button:has-text('Save my choice')");
  assert.ok(await waitFor(async () => (await sql("select data from records where id = $1", [r.id]))[0].data.notes === "erin's text"));
  const [x] = await sql("select data, version from records where id = $1", [r.id]);
  assert.equal(x.data.priority, "High", "Omar's other change stayed"); assert.equal(x.version, 3);
});

test("a change made without a connection meets a newer copy: the parts that do not overlap merge by themselves", { skip }, async () => {
  const { data: r } = await db.from("records").insert({ section: "company.tasks", title: `Offline ${run}`, status: "New", data: { notes: "a", priority: "Normal" }, controlled: false, created_by: erin.id }).select("*").single();
  const { c, p } = await login(erin.email); await p.goto(`${APP}/company/tasks?r=${r.id}`); await p.waitForSelector("#f-notes");
  await c.setOffline(true);
  await p.fill("#f-notes", "written on the plane"); await save(p);
  await p.waitForSelector(".offbar", { timeout: 10000 });
  await db.from("records").update({ data: { ...r.data, priority: "High" } }).eq("id", r.id);
  await c.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event("online")));
  assert.ok(await waitFor(async () => (await sql("select data from records where id = $1", [r.id]))[0].data.notes === "written on the plane", 25000), "the offline change arrived");
  const [x] = await sql("select data from records where id = $1", [r.id]); assert.equal(x.data.priority, "High", "the colleague's change was not overwritten");
});

test("two-step sign-in: an owner without the code sees the gate, sets up the app, then works", { skip }, async () => {
  await db.from("security_settings").update({ mfa_required: true }).eq("id", true);
  try {
    const { p } = await login(olga.email);
    await p.waitForSelector("text=Turn on two-step sign-in", { timeout: 15000 });
    assert.ok(!(await p.content()).includes("Company overview"), "nothing of Workspace is shown before the code");
    await p.waitForSelector(".mfa-qr img"); const secret = (await p.locator(".mfa-qr .mono").innerText()).trim();
    await p.fill("input[autocomplete='one-time-code']", totp(secret)); await p.click("button:has-text('Confirm')");
    await p.waitForSelector("nav, .rail", { timeout: 20000 });
    const f = await sql("select status from auth.mfa_factors where user_id = $1", [olga.id]); assert.deepEqual(f.map((x: any) => x.status), ["verified"]);
    const { p: p2 } = await login(olga.email); await p2.waitForSelector("text=Confirm it is you", { timeout: 15000 });
    await p2.fill("input[autocomplete='one-time-code']", totp(secret)); await p2.click("button:has-text('Confirm')");
    await p2.waitForSelector("nav, .rail", { timeout: 20000 });
  } finally { await db.from("security_settings").update({ mfa_required: false }).eq("id", true); }
});

test("a non-technical path: find my task, open the project, reply to a comment, complete the task — each in a few clicks", { skip }, async () => {
  const { data: p0 } = await db.from("records").insert({ section: "company.projects", title: `Exhibitions ${run}`, status: "Active", data: { manager_id: mia.id, members_ids: [omar.id] }, created_by: mia.id }).select("*").single();
  const { data: t } = await db.from("records").insert({ section: "company.tasks", title: `Book the stand ${run}`, status: "New", data: { assignee_id: omar.id, assignee: `Omar Ops ${run}`, project_ref: p0.id, project_ref_title: p0.title, due: new Date().toISOString().slice(0, 10) }, created_by: mia.id }).select("*").single();
  await db.from("comments").insert({ record_id: t.id, author: mia.id, body: `@[Omar](${omar.id}) which hall?` });
  const { p } = await login(omar.email); let clicks = 0;
  await p.waitForSelector(`.top3 a:has-text('Book the stand ${run}')`, { timeout: 20000 }); // the task is among the three most urgent
  await p.click(`.top3 a:has-text('Book the stand ${run}')`); clicks++; await drawerOpen(p);
  await p.fill("aside.drawer .composer textarea[aria-label='Message']", "Hall 4, stand B12"); await p.click("aside.drawer .composer button.btn.primary"); clicks++;
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from comments where record_id = $1", [t.id]))[0].n === 2));
  await p.selectOption("#f-status", "Completed"); await save(p); clicks += 2;
  assert.ok(await waitFor(async () => (await record(`Book the stand ${run}`)).status === "Completed"));
  await p.keyboard.press("Escape"); clicks++; await p.click(".rail a.nav-item[href='/projects']"); clicks++; await p.click(`a.proj-card:has-text('Exhibitions ${run}')`); clicks++; await p.waitForSelector(".proj-hero");
  evidence.usability_clicks = clicks; assert.ok(clicks <= 7, `${clicks} actions`);
});

test("performance: measured page loads, navigation, task creation, search, document opening and the dashboard", { skip }, async () => {
  const { p } = await login(mia.email);
  for (let i = 0; i < 5; i++) { // first screen after sign-in (Today), full navigation timing from the browser
    await p.goto(`${APP}/`, { waitUntil: "load" }); await p.waitForSelector(".today-hero");
    const nav = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0] as any; return { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; });
    time("initial_ttfb", nav.ttfb); time("initial_dom_ready", nav.dcl); time("initial_load", nav.load);
    const t0 = Date.now(); await p.reload(); await p.waitForSelector(".today-hero .dhero-top h2"); time("today_ready", Date.now() - t0);
  }
  const { c } = await (await import("./_stack.ts")).signIn(mia.email);
  for (let i = 0; i < 20; i++) { const t0 = performance.now(); const r = await c.from("records").insert({ section: "company.tasks", title: `Perf ${run} ${i}`, status: "New", data: { assignee_id: erin.id } }).select("id").single(); time("api_task_create", performance.now() - t0); assert.ifError(r.error); }
  for (let i = 0; i < 20; i++) { const t0 = performance.now(); const r = await c.rpc("search_records", { q: `Perf ${run}`, n: 25 }); time("api_search", performance.now() - t0); assert.ifError(r.error); }
  for (const k of Object.keys(evidence.timings)) { const xs = [...evidence.timings[k]].sort((a: number, b: number) => a - b); (evidence.summary ||= {})[k] = { n: xs.length, median: xs[Math.floor(xs.length / 2)], p90: xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))], max: xs[xs.length - 1] } as any; }
});

/* ---------------- Phase 3 in the browser ---------------- */
test("Phase 3 · project discussion: mention → notification → exact message → reply → Decision in the project's log", { skip }, async () => {
  const proj = `Comms pilot ${run}`;
  const { data: P } = await db.from("records").insert({ section: "company.projects", title: proj, status: "Active", data: { manager_id: mia.id, manager: `Mia Manager ${run}`, members_ids: [erin.id], members: `Erin Engineer ${run}` } }).select("*").single();
  const { p: pm } = await login(mia.email);
  let t0 = Date.now(); await pm.goto(`${APP}/projects/${P.id}?tab=discussion`); await pm.waitForSelector(".discussion .composer textarea"); time("p3_discussion_open", Date.now() - t0);
  await pm.click(".discussion .composer textarea"); await pm.keyboard.type("Please confirm the harness length @Erin");
  await pm.click(`.mention-menu button:has-text('Erin Engineer ${run}')`);
  t0 = Date.now(); await pm.click(".discussion .composer button.btn.primary");
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from comments where record_id = $1", [P.id]))[0].n === 1)); time("p3_post_message", Date.now() - t0);
  const [m1] = await sql("select id, mentions from comments where record_id = $1", [P.id]); assert.deepEqual(m1.mentions, [erin.id]);
  await shot(pm, "p3-project-discussion");
  // the employee: notification centre → Mentions → opens the exact message, replies
  const { p: pe } = await login(erin.email);
  await pe.goto(`${APP}/notifications`); await pe.click("[data-cat='mentions']");
  await pe.waitForSelector(`.notice[data-kind='mention']:has-text('${proj}')`); await shot(pe, "p3-notification-centre");
  await pe.click(`.notice[data-kind='mention']:has-text('${proj}')`);
  await pe.waitForURL((u: URL) => u.pathname === `/projects/${P.id}`); await pe.waitForSelector(`#c-${m1.id}`);
  assert.ok((await pe.url()).includes(`#c-${m1.id}`), "the link opens the exact message");
  await pe.click(`#c-${m1.id} button:has-text('Reply')`); await pe.click(".discussion .composer textarea"); await pe.keyboard.type("Confirmed: 2.4 m, rev C");
  await pe.click(".discussion .composer button.btn.primary");
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from comments where record_id = $1 and parent_id = $2", [P.id, m1.id]))[0].n === 1), "a reply in the thread");
  const [r1] = await sql("select id from comments where parent_id = $1", [m1.id]);
  // the manager marks the reply as a Decision — it appears in the project's decision log
  await pm.reload(); await pm.waitForSelector(`#c-${r1.id}`);
  await pm.selectOption(`#c-${r1.id} select`, "decision");
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from records where section = 'company.decisions' and data->>'project_ref' = $1", [P.id]))[0].n === 1), "decision recorded for the project");
  await pm.reload(); await pm.waitForSelector(".dec-log .hub-row"); assert.ok(await pm.isVisible(`#c-${r1.id} [data-flag='decision']`));
  // the employee cannot mark messages (no control), and a phone shows the same discussion
  await pe.reload(); await pe.waitForSelector(`#c-${r1.id}`); assert.equal(await pe.locator(`#c-${r1.id} select`).count(), 0);
  const { p: ph } = await login(erin.email, { viewport: { width: 390, height: 844 } });
  await ph.goto(`${APP}/projects/${P.id}?tab=discussion`); await ph.waitForSelector(`#c-${r1.id}`);
  assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scrolling on a phone");
  await shot(ph, "p3-discussion-phone");
});

test("Phase 3 · announcement: Read & Acknowledged on Today; a changed text asks again; management sees the numbers", { skip }, async () => {
  const today = new Date().toISOString().slice(0, 10); const title = `Safety briefing ${run}`;
  const { p: pm } = await login(mia.email);
  const { data: A } = await db.from("records").insert({ section: "company.announcements", title, status: "Published", created_by: mia.id, data: { message: "Hard hats in hall 4.", priority: "Important", audience_type: "roles", audience: "engineering", publish_at: today, ack_required: true } }).select("*").single();
  const { p: pe } = await login(erin.email);
  await pe.goto(`${APP}/`); await pe.waitForSelector(`[data-ack='${A.id}']`); await shot(pe, "p3-announcement-today");
  await pe.click(`[data-ack='${A.id}']`);
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from announcement_acks where announcement_id = $1 and user_id = $2 and version = 1", [A.id, erin.id]))[0].n === 1));
  await db.from("records").update({ data: { ...A.data, message: "Hard hats and goggles in hall 4." } }).eq("id", A.id);
  await pe.reload(); await pe.waitForSelector(`[data-ack='${A.id}']`, { timeout: 20000 });
  assert.ok(await pe.isVisible(`[data-ann='${A.id}'] .chip.c-warn`), "the person is told the text changed");
  await pm.goto(`${APP}/company/announcements`); await pm.waitForSelector(`[data-stats='${A.id}']`);
  assert.match(await pm.textContent(`[data-stats='${A.id}']`) || "", /Acknowledged 0 · v2/);
});

test("Phase 3 · meeting: action item becomes one task, even after a second click", { skip }, async () => {
  const title = `Kick-off ${run}`;
  const { data: M } = await db.from("records").insert({ section: "company.meetings", title, status: "Planned", created_by: mia.id, data: { date: "2026-10-22", time: "10:00", timezone: "America/New_York", organizer_id: mia.id, agenda: "Plan", action_items: [{ id: "i1", title: `Order connectors ${run}`, assignee_id: erin.id, due: "2026-10-30" }] } }).select("*").single();
  const { p } = await login(mia.email);
  await p.goto(`${APP}/company/meetings?r=${M.id}`); await p.waitForSelector("[data-item='i1'] button:has-text('Create task')");
  await shot(p, "p3-meeting");
  await p.click("[data-item='i1'] button:has-text('Create task')");
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from records where section = 'company.tasks' and data->>'_idem' = $1", [`meeting:${M.id}:i1`]))[0].n === 1));
  // a second attempt through the API: still one
  const { c } = await (await import("./_stack.ts")).signIn(mia.email); await c.rpc("meeting_action_to_task", { p_meeting: M.id, p_item: "i1" });
  assert.equal((await sql("select count(*)::int n from records where section = 'company.tasks' and data->>'_idem' = $1", [`meeting:${M.id}:i1`]))[0].n, 1);
  await p.waitForSelector("[data-item='i1'] a.chip.c-ok");
});
