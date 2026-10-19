// End to end in a real browser against the app built on the test stack: a daily task from creation to done
// (assignment to a real employee account, a document, a deadline, comments, status changes, the notice to the
// assignee, the history), unauthorized people kept out, a conflicting edit resolved in the dialog, a change made
// offline that meets a newer copy, and the two-step sign-in gate for an owner.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
import { admin, APP, makeUser, mailsTo, PASSWORD, sql, totp, uid } from "./_stack.ts";

const skip = !APP;
const db = admin(); const run = uid();
let pw: any, browser: any; let erin: any, omar: any, pat: any, olga: any;
const loadPw = () => { try { return createRequire(import.meta.url)("playwright"); } catch { return createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright"); } };

before(async () => {
  if (skip) return;
  pw = loadPw(); browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-proxy-server"] });
  erin = await makeUser(`erin-${run}@agron-stack.test`, "engineering", { name: `Erin Engineer ${run}` });
  omar = await makeUser(`omar-${run}@agron-stack.test`, "operations", { name: `Omar Ops ${run}` });
  pat = await makeUser(`pat-${run}@agron-stack.test`, "partner", { name: `Pat Partner ${run}`, company: "Acme" });
  olga = await makeUser(`olga-${run}@agron-stack.test`, "owner", { name: `Olga Owner ${run}` });
});
after(async () => { await browser?.close(); });

async function login(email: string, ctx?: any) {
  const c = ctx || await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const p = await c.newPage(); await p.addInitScript(() => { try { localStorage.setItem("agronws.lang", "en"); } catch {} });
  await p.goto(`${APP}/login`); await p.fill("#email", email); await p.fill("#password", PASSWORD); await p.click("button[type=submit]");
  await p.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  return { c, p };
}
const waitFor = async (fn: () => Promise<boolean>, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const record = async (title: string) => (await sql("select * from records where title = $1", [title]))[0];

test("a daily task from creation to done", { skip }, async () => {
  const { p } = await login(erin.email); const title = `Prepare FAT checklist ${run}`;
  // create: title, responsible colleague (a real account), deadline
  await p.goto(`${APP}/company/tasks?new=1`); await p.waitForSelector("#f-title");
  await p.fill("#f-title", title); await p.fill("#f-assignee", `Omar Ops ${run}`); await p.fill("#f-due", "2026-12-01");
  await p.click("aside.drawer >> button.btn.primary:has-text('Save')");
  assert.ok(await waitFor(async () => !!(await record(title))), "the task was saved");
  const t = await record(title); assert.equal(t.data.assignee_id, omar.id, "linked to Omar's account"); assert.equal(t.data.due, "2026-12-01"); assert.equal(t.created_by, erin.id);
  assert.ok(await waitFor(async () => mailsTo(omar.email).some((m) => m.raw.includes(title.slice(0, 20)))), "Omar was told about the new task");
  // open it: a document, a comment, status changes
  await p.goto(`${APP}/company/tasks?r=${t.id}`); await p.waitForSelector("#f-title");
  await p.setInputFiles("aside.drawer input[type=file]", { name: "fat-checklist.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic test document") });
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from storage.objects where bucket_id = 'files' and name like $1", [`company.tasks/${t.id}/%`]))[0].n === 1), "the document is attached to the task");
  await p.fill("aside.drawer input[aria-label='Write a comment…']", `Started, see the attached checklist ${run}`); await p.click("aside.drawer button:has-text('Send')");
  assert.ok(await waitFor(async () => (await sql("select count(*)::int n from comments where record_id = $1", [t.id]))[0].n === 1));
  await p.selectOption("#f-status", "In progress"); await p.click("aside.drawer >> button.btn.primary:has-text('Save')");
  assert.ok(await waitFor(async () => (await record(title)).status === "In progress"));
  await p.goto(`${APP}/company/tasks?r=${t.id}`); await p.waitForSelector("#f-title");
  await p.selectOption("#f-status", "Done"); await p.click("aside.drawer >> button.btn.primary:has-text('Save')");
  assert.ok(await waitFor(async () => (await record(title)).status === "Done"), "the task is complete");
  // history
  const h = await sql("select actor, action, detail from activity where record_id = $1 order by id", [t.id]);
  assert.deepEqual(h.map((x: any) => x.action), ["created", "status", "status"]);
  assert.deepEqual(h.slice(1).map((x: any) => `${x.detail.from}→${x.detail.to}`), ["Open→In progress", "In progress→Done"]); assert.ok(h.every((x: any) => x.actor === erin.id));
  await p.goto(`${APP}/company/tasks?r=${t.id}`); await p.waitForSelector("text=History"); assert.ok(await p.locator("aside.drawer").innerText().then((s: string) => /status: In progress → Done/.test(s)), "the history is shown in the task");
  // Omar sees it as his
  const { p: po } = await login(omar.email); await po.goto(`${APP}/company/tasks?r=${t.id}`); await po.waitForSelector("#f-title");
  assert.equal(await po.inputValue("#f-title"), title);
  // unauthorized: a partner, and the same people's API
  const { p: pp } = await login(pat.email); await pp.goto(`${APP}/company/tasks?r=${t.id}`); await pp.waitForTimeout(2500);
  assert.ok(!(await pp.content()).includes(title), "a partner never sees the task");
  const leak = await pp.evaluate(async ([u, k, id]: string[]) => { const s = JSON.parse(Object.entries(localStorage).find(([x]) => x.includes("auth-token"))?.[1] || "null"); const tok = s?.access_token || ""; const r = await fetch(`${u}/rest/v1/records?id=eq.${id}&select=id`, { headers: { apikey: k, Authorization: `Bearer ${tok}` } }); return r.ok ? (await r.json()).length : -1; }, [process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, t.id]);
  assert.ok(leak === 0 || leak === -1, "…not through the API either");
});

test("two people change the same field: the dialog shows both, the choice is saved, nothing is lost silently", { skip }, async () => {
  const { data: r } = await db.from("records").insert({ section: "company.tasks", title: `Order radar ${run}`, status: "Open", data: { notes: "first", priority: "Normal" }, controlled: false }).select("*").single();
  const { p } = await login(erin.email); await p.goto(`${APP}/company/tasks?r=${r.id}`); await p.waitForSelector("#f-notes");
  // meanwhile Omar saves the same field and another one
  await db.from("records").update({ data: { ...r.data, notes: "omar's text", priority: "High" } }).eq("id", r.id);
  await p.fill("#f-notes", "erin's text"); await p.click("aside.drawer >> button.btn.primary:has-text('Save')");
  await p.waitForSelector("text=Someone changed this record while you were editing", { timeout: 15000 });
  assert.ok((await p.locator(".cf-list").innerText()).includes("omar's text"));
  await p.click("button:has-text('Save my choice')"); // "mine" is pre-selected
  assert.ok(await waitFor(async () => (await sql("select data from records where id = $1", [r.id]))[0].data.notes === "erin's text"));
  const [x] = await sql("select data, version from records where id = $1", [r.id]);
  assert.equal(x.data.priority, "High", "Omar's other change stayed"); assert.equal(x.version, 3);
});

test("a change made without a connection meets a newer copy: the parts that do not overlap merge by themselves", { skip }, async () => {
  const { data: r } = await db.from("records").insert({ section: "company.tasks", title: `Offline ${run}`, status: "Open", data: { notes: "a", priority: "Normal" }, controlled: false }).select("*").single();
  const { c, p } = await login(erin.email); await p.goto(`${APP}/company/tasks?r=${r.id}`); await p.waitForSelector("#f-notes");
  await c.setOffline(true);
  await p.fill("#f-notes", "written on the plane"); await p.click("aside.drawer >> button.btn.primary:has-text('Save')");
  await p.waitForSelector(".offbar", { timeout: 10000 });
  await db.from("records").update({ data: { ...r.data, priority: "High" } }).eq("id", r.id); // a colleague, online
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
    // the next sign-in asks for the code
    const { p: p2 } = await login(olga.email); await p2.waitForSelector("text=Confirm it is you", { timeout: 15000 });
    await p2.fill("input[autocomplete='one-time-code']", totp(secret)); await p2.click("button:has-text('Confirm')");
    await p2.waitForSelector("nav, .rail", { timeout: 20000 });
  } finally { await db.from("security_settings").update({ mfa_required: false }).eq("id", true); }
});
