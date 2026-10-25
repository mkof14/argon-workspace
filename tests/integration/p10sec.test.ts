// P10 §59 — 1inow security on the isolated stack, with real sign-ins (each person's own JWT through PostgREST).
// The central property: a record a person may not open contributes ZERO information to 1inow — not an item, not a
// count, not a reason, not a signal on another item, not a change line, not an excerpt, not an answer, not an
// ambiguity choice. Tested as before/after invariance: the output for an unauthorised person is identical whether
// the hidden records exist or not, and a positive control proves the same records DO appear for an authorised person.
// Synthetic data only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { APP, ENV, makeUser, PASSWORD, signIn, sql, uid } from "./_stack.ts";
import { myDay, executive, changes, endOfDay, meetingBrief } from "../../src/lib/server/inow.ts";

const run = uid(); const tag = `p10s${run}`; const BN = `C97#${Math.floor(Math.random() * 9000 + 1000)}`; const skipApp = !APP;
const D = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const U: Record<string, any> = {}; const C: Record<string, any> = {}; const EV: Record<string, any> = { tag, tests: {} };
const ins = async (section: string, title: string, status: string | null, data: any, controlled = false) =>
  (await sql("insert into records(section, title, status, data, controlled) values ($1, $2, $3, $4, $5) returning *", [section, `${tag} ${title}`, status, data, controlled]))[0];
/** Remove what legitimately varies between two identical reads (timings, clock), keep everything a person could see. */
const norm = (x: any) => JSON.parse(JSON.stringify(x, (k, v) => (k === "ms" || k === "generated_at" ? undefined : v)));
const me = (k: string) => ({ id: U[k].id, role: U[k].role, timezone: "UTC" });
async function cookiesFor(email: string) {
  const jar = new Map<string, string>();
  const c = createServerClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
const api = async (cookie: string, q: string, body?: any) => {
  const r = await fetch(`${APP}/api/inow${q}`, { method: body ? "POST" : "GET", headers: { cookie, "Content-Type": "application/json", origin: APP }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, text: await r.text() };
};
const HIDDEN_WORDS = () => [`${tag} SECRET`, "SECRETPROMISE", BN, "Atlas-Hidden"];
const leaks = (s: string) => HIDDEN_WORDS().filter((w) => s.includes(w));

async function snapshot(k: string) {
  const c = C[k];
  const out: any = { day: norm(await myDay(c, me(k))), changes_day: norm(await changes(c, me(k), "day")), changes_week: norm(await changes(c, me(k), "week")), eod: norm(await endOfDay(c, me(k))) };
  if (["management", "owner", "admin"].includes(U[k].role)) out.exec = norm(await executive(c, me(k)));
  return out;
}

before(async () => {
  U.empNon = await makeUser(`p10en-${run}@agron-stack.test`, "engineering", { us: false, name: `${tag} Emp Non` });
  U.empUS = await makeUser(`p10eu-${run}@agron-stack.test`, "engineering", { us: true, name: `${tag} Emp US` });
  U.mgmtNon = await makeUser(`p10mn-${run}@agron-stack.test`, "management", { us: false, name: `${tag} Mgmt Non` });
  U.mgmtUS = await makeUser(`p10mu-${run}@agron-stack.test`, "management", { us: true, name: `${tag} Mgmt US` });
  U.partner = await makeUser(`p10pt-${run}@agron-stack.test`, "partner", { us: false, company: `${tag} Partner Co` });
  U.adminU = await makeUser(`p10ad-${run}@agron-stack.test`, "admin", { us: true });
  for (const k of ["empNon", "empUS", "mgmtNon", "mgmtUS", "adminU"]) C[k] = (await signIn(U[k].email)).c;
  // ordinary, visible work
  C.visTask = await ins("company.tasks", "Prepare the quarterly drawing set", "In Progress", { assignee_id: U.empNon.id, due: D(0), priority: "Medium" });
  C.visTaskUS = await ins("company.tasks", "Review export file", "In Progress", { assignee_id: U.empUS.id, due: D(3) });
  C.visTaskM = await ins("company.tasks", "Board pack", "In Progress", { assignee_id: U.mgmtNon.id, due: D(1) });
});

test("§59.1–6 a US-persons-only task, dependency, meeting, opportunity, build and promise add nothing for non-US people", async () => {
  const before0 = { empNon: await snapshot("empNon"), mgmtNon: await snapshot("mgmtNon") };
  for (const [k, v] of Object.entries(before0)) { const bad = Object.entries(v.day.sources).filter(([, s]: any) => !s.ok).map(([n]) => n); assert.deepEqual(bad, [], `${k}: every engine answered (an invariance over failures would prove nothing)`); }
  // hidden: US-persons-only records that name the non-US people directly
  C.hTask = await ins("company.tasks", "SECRET overdue engine test plan", "In Progress", { assignee_id: U.empNon.id, due: D(-3), priority: "High" }, true);
  C.hTaskM = await ins("company.tasks", "SECRET mgmt review", "In Progress", { assignee_id: U.mgmtNon.id, due: D(-1), priority: "High" }, true);
  C.hDep = await ins("company.tasks", "SECRET dependent step", "To Do", { assignee_id: U.empUS.id, blocked_by: C.visTask.id, due: D(1) }, true);
  C.hMeet = await ins("company.meetings", "SECRET Atlas-Hidden briefing", "Planned", { date: D(0), time: "23:30", timezone: "UTC", organizer_id: U.mgmtUS.id, participants_ids: [U.empNon.id, U.mgmtNon.id, U.empUS.id] }, true);
  C.hOpp = await ins("sales.pipeline", "SECRET Atlas-Hidden opportunity", "Negotiation", { owner_id: U.mgmtNon.id, value: 9000000, currency: "USD", next_action: "call", next_action_due: D(-2) }, true);
  C.hBuild = await ins("operations.builds", `SECRET ${BN} unit`, "Blocked", { number: BN, blocked: true, blocked_reason: "SECRET part" }, true);
  C.hProj = await ins("company.projects", "SECRET Atlas-Hidden program", "Active", { owner_id: U.mgmtNon.id }, true);
  // a promise the non-US employee once wrote on a record that is now US-persons-only (the excerpt must not surface)
  await sql("insert into comments(record_id, author, body) values ($1, $2, $3)", [C.hTask.id, U.empNon.id, "SECRETPROMISE I will send the report tomorrow"]);
  await sql("insert into activity(section, actor, action, detail) values ('company.tasks', $1, 'updated', $2)", [U.mgmtUS.id, `${tag} SECRET changed`]).catch(() => null);
  const after = { empNon: await snapshot("empNon"), mgmtNon: await snapshot("mgmtNon") };
  assert.deepEqual(after.empNon, before0.empNon, "non-US employee: identical My Day, changes, end of day");
  assert.deepEqual(after.mgmtNon, before0.mgmtNon, "non-US management: identical — management status does not bypass US-persons-only");
  for (const [k, v] of Object.entries(after)) assert.deepEqual(leaks(JSON.stringify(v)), [], `${k}: no hidden word anywhere`);
  // positive control: the same records DO reach an authorised (US) person — the test can see a leak if there were one
  const us = norm(await myDay(C.empUS, me("empUS")));
  assert.ok(JSON.stringify(us).includes(`${tag} SECRET dependent step`), "the US assignee sees the US-only task");
  const usm = norm(await myDay(C.mgmtUS, me("mgmtUS")));
  assert.ok(JSON.stringify(usm).includes("Atlas-Hidden briefing"), "the US organiser sees the US-only meeting");
  // positive control for the dependency signal: a VISIBLE dependent does add "blocks others" to the same task
  const vd = await ins("company.tasks", "Visible dependent step", "To Do", { assignee_id: U.empUS.id, blocked_by: C.visTask.id, due: D(1) });
  const dd = await myDay(C.empNon, me("empNon")); const mine = [...dd.now, ...dd.today, ...dd.attention].find((r) => r.record_id === C.visTask.id);
  assert.ok(mine && mine.signals.some((x) => x.code === "blocks_others"), "a visible dependent is counted");
  await sql("delete from records where id = $1", [vd.id]);
  EV.tests.invariance = { users: ["empNon", "mgmtNon"], hidden_records: 7, identical: true, positive_control: true };
});

test("§59.7 meeting brief of a hidden meeting does not exist (same as a random id)", async () => {
  assert.equal(await meetingBrief(C.empNon, me("empNon"), C.hMeet.id), null);
  assert.equal(await meetingBrief(C.empNon, me("empNon"), "00000000-0000-4000-8000-000000000000"), null);
  assert.ok(await meetingBrief(C.mgmtUS, me("mgmtUS"), C.hMeet.id), "the authorised organiser gets the brief");
});

test("§59.8 commitments: detection never reads comments on records the person cannot open; nobody inserts commitments directly", async () => {
  const n = (await C.empNon.rpc("inow_detect_commitments", { p_days: 14 })).data; assert.equal(n, 0);
  const rows = await sql("select count(*)::int n from inow_commitments where user_id = $1", [U.empNon.id]); assert.equal(rows[0].n, 0);
  const ins2 = await C.empNon.from("inow_commitments").insert({ user_id: U.empNon.id, source_kind: "comment", source_id: C.visTask.id, record_id: C.visTask.id, excerpt: "x", phrase: "x", confidence: "high" });
  assert.ok(ins2.error, "insert is not granted to people");
  // a visible promise is detected — with evidence and confidence
  await sql("insert into comments(record_id, author, body) values ($1, $2, $3)", [C.visTask.id, U.empNon.id, `${tag} I will send the drawings tomorrow`]);
  const d = await myDay(C.empNon, me("empNon"));
  const p = [...d.loops, ...d.now, ...d.today, ...d.attention].find((r) => r.src === "commitment");
  assert.ok(p && p.evidence && p.evidence.confidence === "high" && /tomorrow/.test(p.evidence.excerpt), "visible commitment with evidence");
  // the source record later becomes US-persons-only → the excerpt disappears for the non-US author
  await sql("update records set controlled = true where id = $1", [C.visTask.id]);
  const d2 = await myDay(C.empNon, me("empNon"));
  assert.ok(![...d2.loops, ...d2.now, ...d2.today, ...d2.attention].some((r) => r.src === "commitment"), "the excerpt of a record no longer visible is not shown");
  await sql("update records set controlled = false where id = $1", [C.visTask.id]);
  // a person only decides, once: no rewriting of the excerpt or source, no turning a handled one back into a suggestion
  const cid = p!.key.replace(/^commitment:/, "");
  assert.ok((await C.empNon.from("inow_commitments").update({ excerpt: "rewritten", record_id: C.hTask.id }).eq("id", cid).select()).error, "excerpt / source cannot be rewritten");
  assert.equal((await C.empNon.from("inow_commitments").update({ status: "dismissed" }).eq("id", cid).select()).error, null);
  assert.ok((await C.empNon.from("inow_commitments").update({ status: "suggested" }).eq("id", cid).select()).error, "a handled commitment stays handled");
  const tp = await sql("select string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where grantee = 'authenticated' and table_name like 'inow_%' and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')");
  assert.equal(tp[0].p, null, "no table-level powers outside row-level security on the 1inow tables");
});

test("§59.9–12 personal state, context and counters are private; context never expands permissions", async () => {
  const a = C.empNon, b = C.empUS;
  assert.equal((await a.from("inow_item_state").upsert({ user_id: U.empNon.id, item_key: `task:${C.visTask.id}`, pinned: true })).error, null);
  const other = await a.from("inow_item_state").insert({ user_id: U.empUS.id, item_key: "task:x", pinned: true }); assert.ok(other.error, "cannot write someone else's state");
  const peek = await b.from("inow_item_state").select("*").eq("user_id", U.empNon.id); assert.equal((peek.data || []).length, 0, "cannot read someone else's state");
  await a.rpc("inow_touch", { p_record: C.hTask.id });
  assert.equal((await sql("select count(*)::int n from inow_context where user_id = $1 and record_id = $2", [U.empNon.id, C.hTask.id]))[0].n, 0, "touching a hidden record stores nothing");
  await a.rpc("inow_touch", { p_record: C.visTask.id });
  assert.equal((await sql("select count(*)::int n from inow_context where user_id = $1", [U.empNon.id]))[0].n, 1);
  const m = await a.from("inow_metrics").select("*").limit(1); assert.ok(m.error || !(m.data || []).length, "counters are not readable by people");
  const bad = await a.rpc("inow_metric", { p_name: "anything_goes", p_n: 5 });
  assert.equal((await sql("select count(*)::int n from inow_metrics where metric = 'anything_goes'"))[0].n, 0, "only whitelisted counter names"); void bad;
  const st = await a.from("inow_settings").update({ flags: { my_day: false } }).neq("id", 0).select(); assert.ok(st.error || !(st.data || []).length, "settings are not writable directly");
  const st2 = await a.rpc("inow_settings_save", { p_flags: { my_day: false }, p_home: null }); assert.ok(st2.error && st2.error.code === "42501", "an employee cannot change 1inow settings");
});

test("§59.13–20 API: internal only, hidden ids look like missing ids, answers and choices leak nothing", { skip: skipApp && "no app" }, async () => {
  const anonR = await fetch(`${APP}/api/inow?view=day`); assert.ok([401, 403].includes(anonR.status), "anonymous refused");
  const pk = await cookiesFor(U.partner.email);
  assert.equal((await api(pk, "?view=day")).status, 403, "an external partner gets no 1inow");
  const ek = await cookiesFor(U.empNon.email);
  const day = await api(ek, "?view=day"); assert.equal(day.status, 200); assert.deepEqual(leaks(day.text), []);
  const ex = await api(ek, "?view=executive"); assert.equal(ex.status, 403, "Executive 1inow is not for employees");
  const m1 = await api(ek, `?view=meeting&id=${C.hMeet.id}`), m2 = await api(ek, "?view=meeting&id=00000000-0000-4000-8000-000000000000");
  assert.equal(m1.status, 404); assert.equal(m1.status, m2.status); assert.equal(m1.text, m2.text, "a hidden meeting is indistinguishable from a missing one");
  for (const q of [`What is blocking ${BN}?`, "What is happening with Atlas-Hidden?", "What changed this week?", "What needs my attention?", "What did I promise?", "What is waiting for me?"]) {
    const r = await api(ek, "", { op: "ask", q, lang: "en" }); assert.equal(r.status, 200, q); assert.deepEqual(leaks(r.text), [], q);
  }
  const ctx = await api(ek, "", { op: "ask", q: "What is happening with it?", context: C.hTask.id, lang: "en" }); assert.deepEqual(leaks(ctx.text), [], "context of a hidden record adds nothing");
  const pick = await api(ek, "", { op: "ask", q: `What is happening with ${BN}?`, choice: C.hBuild.id, lang: "en" }); assert.deepEqual(leaks(pick.text), [], "a guessed (hidden) choice id resolves to nothing");
  const mk = await cookiesFor(U.mgmtNon.email);
  const exm = await api(mk, "?view=executive"); assert.equal(exm.status, 200); assert.deepEqual(leaks(exm.text), [], "non-US management executive view");
  const ch = await api(mk, "?view=changes&window=week"); assert.deepEqual(leaks(ch.text), []);
  const errText = await api(ek, "?view=nope"); assert.ok(!/select|from |postgres|stack/i.test(errText.text), "no internal detail in errors");
  EV.tests.api = { ok: true };
});

test("evidence file", () => {
  fs.mkdirSync(path.join(process.cwd(), ".stack"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".stack", "p10sec.json"), JSON.stringify(EV, null, 1));
});
