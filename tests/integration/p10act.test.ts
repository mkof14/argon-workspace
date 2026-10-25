// P10 §60 — action safety of Ask→Act on the isolated stack: Understand → Resolve → Preview → Confirm → Execute →
// Verify → Audit. Every case the specification lists: ambiguous person / project / vendor / date, low confidence,
// unauthorised, stale, changed after preview, double confirmation, duplicate, retry, hallucinated id, deleted target,
// controlled, irreversible, undoable, undo after change — and that nothing is ever carried out twice.
// Synthetic data only; real sign-ins (each person's own JWT).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { admin, APP, ENV, makeUser, PASSWORD, pool, signIn, sql, uid } from "./_stack.ts";
import { cancel, complete, plan, start, undoDone, undoStart, type Ctx } from "../../src/lib/server/actions.ts";

const run = uid(); const tag = `p10a${run}`; const NM = "Zolt" + run.replace(/\d/g, (d) => "abcdefghij"[Number(d)]); const skipApp = !APP; // NM: a first name only this run uses (letters only)
const U: Record<string, any> = {}; const C: Record<string, any> = {}; const R: Record<string, any> = {}; const EV: Record<string, any> = { tag, cases: {} };
const ctx = (k: string): Ctx => ({ user: C[k], admin: admin(), me: { id: U[k].id, role: U[k].role, full_name: U[k].name, timezone: "UTC" }, lang: "en" });
const ins = async (section: string, title: string, status: string | null, data: any, by?: string) =>
  (await sql("insert into records(section, title, status, data, created_by) values ($1, $2, $3, $4, $5) returning *", [section, `${tag} ${title}`, status, data, by || null]))[0];
const audit = async (id: string) => (await sql("select * from action_audit where id = $1", [id]))[0];
const mark = (k: string, v: any = true) => { EV.cases[k] = v; };
/** what the browser's store does with the operations — here with the person's own client (same RLS) */
async function storeRun(k: string, ops: any[]) {
  const out: any[] = [];
  for (const o of ops) {
    if (o.op === "create") { const { data, error } = await C[k].from("records").insert({ section: o.section, title: o.title, status: o.status, data: o.data, created_by: U[k].id }).select("id").single(); out.push(error ? { ok: false, error: error.message } : { ok: true, id: data.id }); }
    else if (o.op === "update") { const { data, error } = await C[k].from("records").update({ status: o.status, data: o.data }).eq("id", o.id).eq("version", o.version).select("id").maybeSingle(); out.push(error || !data ? { ok: false, error: error?.message || "conflict" } : { ok: true, id: o.id }); }
    else if (o.op === "delete") { const { error } = await C[k].from("records").delete().eq("id", o.id); out.push(error ? { ok: false, error: error.message } : { ok: true, id: o.id }); }
  }
  return out;
}
async function cookiesFor(email: string) {
  const jar = new Map<string, string>();
  const c = createServerClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
const post = async (cookie: string, url: string, body: any) => { const r = await fetch(`${APP}${url}`, { method: "POST", headers: { cookie, "Content-Type": "application/json", origin: APP }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

before(async () => {
  U.mgr = await makeUser(`p10am-${run}@agron-stack.test`, "management", { us: true, name: `Mira ${tag}` });
  U.emp = await makeUser(`p10ae-${run}@agron-stack.test`, "engineering", { us: true, name: `Oskar ${tag}` });
  U.anton1 = await makeUser(`p10a1-${run}@agron-stack.test`, "engineering", { us: true, name: `${NM} Petrov` });
  U.anton2 = await makeUser(`p10a2-${run}@agron-stack.test`, "engineering", { us: true, name: `${NM} Ivanov` });
  U.partner = await makeUser(`p10ap-${run}@agron-stack.test`, "partner", { company: `${tag} Co` });
  for (const k of ["mgr", "emp", "partner"]) { U[k].name = (await sql("select full_name from profiles where id = $1", [U[k].id]))[0].full_name; C[k] = (await signIn(U[k].email)).c; }
  R.task = await ins("company.tasks", "Calibrate torque bench", "In Progress", { assignee_id: U.mgr.id, due: new Date().toISOString().slice(0, 10) }, U.mgr.id);
  R.p1 = await ins("company.projects", "Falcon One", "Active", {}); R.p2 = await ins("company.projects", "Falcon Two", "Active", {});
  R.v1 = await ins("company.parties", "Nordline Steel", "Active", { kind: "vendor" }); R.v2 = await ins("company.parties", "Nordline Cables", "Active", { kind: "vendor" });
});

test("ambiguous person: two matches → a choice, never a guess; a forged choice is refused; the real choice works", async () => {
  const p = await plan(ctx("mgr"), `Create task for ${NM} to check ${tag} pumps tomorrow`, "assistant");
  assert.equal(p.status, "needs_clarification"); assert.ok((p.options || []).length >= 2, "both people offered");
  assert.equal((await start(ctx("mgr"), p.id, { confirm: true })).ok, false, "no choice → nothing happens");
  const forged = await start(ctx("mgr"), p.id, { confirm: true, personId: "00000000-0000-4000-8000-000000000001" }); assert.equal(forged.ok, false); assert.equal((forged as any).status, 400);
  const s = await start(ctx("mgr"), p.id, { confirm: true, personId: U.anton2.id }); assert.equal(s.ok, true);
  const done = await complete(ctx("mgr"), p.id, await storeRun("mgr", (s as any).ops)); assert.equal(done.ok, true);
  const t = (await sql("select data from records where id = $1", [(done as any).result.id]))[0]; assert.equal(t.data.assignee_id, U.anton2.id);
  mark("ambiguous_person");
});

test("ambiguous date and low confidence: asked, not executed", async () => {
  const d = await plan(ctx("mgr"), `Move the deadline of ${tag} Calibrate torque bench`, "assistant");
  assert.equal(d.status, "needs_clarification"); assert.match(String(d.question), /date/i);
  assert.equal((await start(ctx("mgr"), d.id, { confirm: true })).ok, false);
  const u = await plan(ctx("mgr"), "frobnicate the wibble", "assistant");
  assert.equal(u.status, "needs_clarification"); assert.equal((await start(ctx("mgr"), u.id, { confirm: true })).ok, false);
  mark("ambiguous_date"); mark("low_confidence");
});

test("unauthorised: an external person cannot plan; nobody can start someone else's proposal", async () => {
  await assert.rejects(plan(ctx("partner"), "Create task to review the budget tomorrow", "assistant"), /Not allowed/);
  const p = await plan(ctx("mgr"), `Remind me tomorrow to check ${tag} invoices`, "assistant");
  const other = await start(ctx("emp"), p.id, { confirm: true }); assert.equal(other.ok, false); assert.equal((other as any).status, 404, "another person's proposal does not exist for them");
  await cancel(ctx("mgr"), p.id); mark("unauthorized");
});

test("hallucinated ids: a made-up proposal, task or record id is refused (never trusted)", async () => {
  assert.equal(((await start(ctx("mgr"), "00000000-0000-4000-8000-00000000abcd", { confirm: true })) as any).status, 404);
  assert.equal(((await start(ctx("mgr"), "not-a-uuid", { confirm: true })) as any).status, 404);
  const p = await plan(ctx("mgr"), "Mark task done", "assistant");
  const r = await start(ctx("mgr"), p.id, { confirm: true, taskId: "00000000-0000-4000-8000-00000000beef" }); assert.equal(r.ok, false); assert.equal((r as any).status, 400);
  // a proposal that resolved its task does not accept a different task id at confirmation (never silently ignored)
  const q = await plan(ctx("mgr"), `Complete task ${tag} Calibrate torque bench`, "assistant"); assert.equal(q.status, "proposed", q.question);
  const w = await start(ctx("mgr"), q.id, { confirm: true, taskId: "00000000-0000-4000-8000-00000000beef" }); assert.equal(w.ok, false); assert.equal((w as any).status, 400);
  await cancel(ctx("mgr"), q.id);
  mark("hallucinated_id");
});

test("controlled: approvals are never carried out by Ask (rejected at preview, refused at start)", async () => {
  const c = await plan(ctx("mgr"), "Approve the C20 drawing", "assistant"); assert.equal(c.status, "rejected"); assert.equal(c.risk, "controlled");
  const s = await start(ctx("mgr"), c.id, { confirm: true }); assert.equal(s.ok, false); assert.equal((s as any).status, 403);
  mark("controlled");
});

test("changed after preview: the yes applies to the version shown — a changed task is not touched", async () => {
  const p = await plan(ctx("mgr"), `Complete task ${tag} Calibrate torque bench`, "assistant"); assert.equal(p.status, "proposed", p.question);
  await sql("update records set data = data || '{\"note\":\"changed by someone\"}'::jsonb where id = $1", [R.task.id]);
  const s = await start(ctx("mgr"), p.id, { confirm: true }); assert.equal(s.ok, false); assert.match(String((s as any).error), /changed/i);
  assert.equal((await sql("select status from records where id = $1", [R.task.id]))[0].status, "In Progress", "not completed");
  assert.equal((await audit(p.id)).status, "failed"); mark("changed_after_preview");
});

test("stale: a proposal older than 12 hours is never carried out late", async () => {
  const p = await plan(ctx("mgr"), `Remind me tomorrow to call ${tag} supplier`, "assistant");
  // test fixture only: age the proposal (the audit table refuses rewrites, so the trigger is bypassed for this one row)
  const cl = await pool.connect();
  try { await cl.query("begin"); await cl.query("set local session_replication_role = replica"); await cl.query("update action_audit set created_at = now() - interval '13 hours' where id = $1", [p.id]); await cl.query("commit"); } finally { cl.release(); }
  const s = await start(ctx("mgr"), p.id, { confirm: true }); assert.equal(s.ok, false); assert.equal((s as any).stale, true);
  assert.equal((await audit(p.id)).status, "cancelled"); mark("stale");
});

test("double confirmation and retries: exactly one execution", async () => {
  const p = await plan(ctx("mgr"), `Remind me tomorrow to file ${tag} report`, "assistant");
  const both = await Promise.all([start(ctx("mgr"), p.id, { confirm: true }), start(ctx("mgr"), p.id, { confirm: true }), start(ctx("mgr"), p.id, { confirm: true })]);
  const ok = both.filter((x) => x.ok); assert.equal(ok.length, 1, "one of three simultaneous confirmations proceeds");
  assert.ok(both.filter((x) => !x.ok).every((x: any) => x.status === 409));
  const res = await storeRun("mgr", (ok[0] as any).ops);
  const d1 = await complete(ctx("mgr"), p.id, res); assert.equal(d1.ok, true);
  const d2 = await complete(ctx("mgr"), p.id, res); assert.equal(d2.ok, false, "a retried completion is refused");
  assert.equal((await start(ctx("mgr"), p.id, { confirm: true })).ok, false, "an executed proposal cannot start again");
  const n = await sql("select count(*)::int n from records where section = 'company.tasks' and title like $1", [`%file ${tag} report%`]); assert.equal(n[0].n, 1, "one record");
  mark("double_confirmation"); mark("retry"); mark("duplicate");
});

test("deleted target: the task vanished before the yes → failed, nothing created", async () => {
  const t = await ins("company.tasks", "Order spare seals", "In Progress", { assignee_id: U.mgr.id }, U.mgr.id);
  const p = await plan(ctx("mgr"), `Complete task ${tag} Order spare seals`, "assistant"); assert.equal(p.status, "proposed", p.question);
  await sql("delete from records where id = $1", [t.id]);
  const s = await start(ctx("mgr"), p.id, { confirm: true }); assert.equal(s.ok, false); assert.equal((await audit(p.id)).status, "failed");
  mark("deleted_target");
});

test("undoable and undo after change; irreversible has no undo", async () => {
  const p = await plan(ctx("mgr"), `Remind me tomorrow to check ${tag} gaskets`, "assistant");
  const s = await start(ctx("mgr"), p.id, { confirm: true }); const d = await complete(ctx("mgr"), p.id, await storeRun("mgr", (s as any).ops));
  assert.equal(d.ok, true); assert.equal((d as any).undoable, true);
  const u = await undoStart(ctx("mgr"), p.id); assert.equal(u.ok, true);
  await storeRun("mgr", (u as any).ops); assert.equal((await undoDone(ctx("mgr"), p.id)).ok, true);
  assert.equal((await sql("select count(*)::int n from records where id = $1", [(d as any).result.id]))[0].n, 0, "the reminder is gone");
  assert.equal((await undoStart(ctx("mgr"), p.id)).ok, false, "undo twice is refused");
  // undo after somebody changed the record → refused, record untouched
  const p2 = await plan(ctx("mgr"), `Remind me tomorrow to check ${tag} hoses`, "assistant");
  const s2 = await start(ctx("mgr"), p2.id, { confirm: true }); const d2 = await complete(ctx("mgr"), p2.id, await storeRun("mgr", (s2 as any).ops));
  await sql("update records set data = data || '{\"note\":\"edited\"}'::jsonb where id = $1", [(d2 as any).result.id]);
  const u2 = await undoStart(ctx("mgr"), p2.id); assert.equal(u2.ok, false); assert.match(String((u2 as any).error), /changed/i);
  assert.equal((await sql("select count(*)::int n from records where id = $1", [(d2 as any).result.id]))[0].n, 1);
  // a note (no record operation) has nothing to undo — no fake undo
  const p3 = await plan(ctx("mgr"), `Note: ${tag} the bench is noisy`, "assistant");
  if (p3.status === "proposed") { const s3 = await start(ctx("mgr"), p3.id, { confirm: true }); assert.equal((s3 as any).undoable ?? false, false); }
  assert.equal((await undoStart(ctx("mgr"), p3.id)).ok, false, "no undo for an action without an exact reversal");
  mark("undoable"); mark("undo_after_change"); mark("irreversible_no_fake_undo");
});

test("API: ambiguous project and vendor → a choice; a choice is re-read with the person's rights; commitments convert once; Inbox keeps the words", { skip: skipApp && "no app" }, async () => {
  const ck = await cookiesFor(U.mgr.email);
  const a = await post(ck, "/api/inow", { op: "ask", q: `What is happening with ${tag} Falcon`, lang: "en" });
  assert.equal(a.j.kind, "choose"); assert.ok(a.j.options.length >= 2);
  const pick = await post(ck, "/api/inow", { op: "ask", q: `What is happening with ${tag} Falcon`, choice: R.p2.id, lang: "en" });
  assert.equal(pick.j.kind, "answer"); assert.equal(pick.j.subject.id, R.p2.id);
  const v = await post(ck, "/api/inow", { op: "ask", q: `What is happening with ${tag} Nordline`, lang: "en" });
  assert.equal(v.j.kind, "choose", "two vendors with the same start → choose"); assert.ok(v.j.options.some((o: any) => o.id === R.v1.id) && v.j.options.some((o: any) => o.id === R.v2.id));
  const vv = await post(ck, "/api/inow", { op: "ask", q: `What is happening with ${tag} Nordline`, choice: R.v1.id, lang: "en" });
  assert.equal(vv.j.subject.id, R.v1.id); mark("ambiguous_project"); mark("ambiguous_vendor");
  // a write request from Ask is only a preview
  const w = await post(ck, "/api/inow", { op: "ask", q: `Create task ${tag} prepare the IDEX demo by Friday`, lang: "en" });
  assert.equal(w.j.kind, "proposal"); assert.equal((await sql("select count(*)::int n from records where title like $1", [`%${tag} prepare the IDEX demo%`]))[0].n, 0, "nothing created before the yes");
  // a promise in my own comment → one suggestion → confirm twice at once → exactly one proposal
  await sql("insert into comments(record_id, author, body) values ($1, $2, $3)", [R.p1.id, U.mgr.id, `${tag} I will send the test plan tomorrow`]);
  const day = await fetch(`${APP}/api/inow?view=day`, { headers: { cookie: ck } }).then((r) => r.json());
  const cm = [...day.loops, ...day.now, ...day.today, ...day.attention].find((r: any) => r.src === "commitment"); assert.ok(cm, "commitment suggested with evidence");
  assert.equal(cm.evidence.confidence, "high");
  const id = cm.key.replace(/^commitment:/, "");
  const two = await Promise.all([post(ck, "/api/inow", { op: "commitment", id, decision: "confirm", lang: "en" }), post(ck, "/api/inow", { op: "commitment", id, decision: "confirm", lang: "en" })]);
  assert.equal(two.filter((x) => x.status === 200).length, 1, "exactly one confirmation makes a proposal"); assert.equal(two.filter((x) => x.status === 409).length, 1);
  assert.equal(two.find((x) => x.status === 200)!.j.proposal.status, "proposed", "a proposal — the task is created only after its own yes");
  const st = (await sql("select status from inow_commitments where id = $1", [id]))[0].status; assert.equal(st, "confirmed");
  assert.equal((await post(ck, "/api/inow", { op: "commitment", id, decision: "confirm" })).status, 409, "a handled commitment cannot be converted again");
  mark("commitment_once");
  // the Inbox never loses what was said, even when nothing could be understood
  const cap = await post(ck, "/api/voice", { action: "capture", text: `${tag} hmm the thing with the blue crate`, source: "text", lang: "en" });
  assert.notEqual(cap.status, 500);
  assert.equal((await sql("select count(*)::int n from voice_inbox where raw_text like $1", [`%${tag} hmm the thing%`]))[0].n, 1, "kept");
  // personal state is exactly reversible
  const pin = await post(ck, "/api/inow", { op: "state", key: `task:${R.task.id}`, pin: true }); assert.equal(pin.j.ok, true);
  await post(ck, "/api/inow", pin.j.undo);
  assert.equal((await sql("select count(*)::int n from inow_item_state where user_id = $1 and item_key = $2", [U.mgr.id, `task:${R.task.id}`]))[0].n, 0, "undo restores 'no state'");
  mark("inbox_never_loses"); mark("state_undo");
});

test("evidence file", () => {
  fs.mkdirSync(path.join(process.cwd(), ".stack"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".stack", "p10act.json"), JSON.stringify(EV, null, 1));
});
