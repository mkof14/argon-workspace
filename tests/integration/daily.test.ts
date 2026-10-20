// Phase 2 — daily work, checked against the real database rules (v19) with real sign-ins on the isolated stack:
// task assignment only to active employees, who may change a task, completion dates, project teams, personal
// notifications (once per event, only for records the person may open), mentions by account, internal notes,
// approvals both ways, deadline reminders, delivery by e-mail (one letter per person, never twice in parallel),
// search that never shows restricted records, and personal settings.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { admin, clearMail, makeUser, mailsTo, signIn, sql, uid } from "./_stack.ts";
import { deliverNotifications } from "../../src/lib/server/notify.ts";

const db = admin(); const run = uid();
let mgr: any, eng: any, eng2: any, ops: any, gone: any, pat: any, fin: any;
const notes = async (user: string, record?: string) => sql(`select kind, key, title, body, read_at, email_state from notifications where user_id = $1 ${record ? "and record_id = $2" : ""} order by id`, record ? [user, record] : [user]);
before(async () => {
  mgr = await makeUser(`dm-${run}@agron-stack.test`, "management", { us: true, name: `Mia Manager ${run}` });
  eng = await makeUser(`de-${run}@agron-stack.test`, "engineering", { name: `Eli Engineer ${run}` });
  eng2 = await makeUser(`dx-${run}@agron-stack.test`, "engineering", { name: `Ezra Engineer ${run}` });
  ops = await makeUser(`do-${run}@agron-stack.test`, "operations", { name: `Oz Ops ${run}` });
  fin = await makeUser(`df-${run}@agron-stack.test`, "finance", { us: true, name: `Fay Finance ${run}` });
  gone = await makeUser(`dg-${run}@agron-stack.test`, "engineering", { name: `Gus Gone ${run}` });
  await db.from("profiles").update({ disabled: true }).eq("id", gone.id);
  pat = await makeUser(`dp-${run}@agron-stack.test`, "partner", { name: `Pat Partner ${run}`, company: `Acme ${run}` });
});

test("a task goes only to an active employee; an old assignment stays when the person leaves", async () => {
  const { c } = await signIn(mgr.email);
  const bad = await c.from("records").insert({ section: "company.tasks", title: `To a leaver ${run}`, status: "New", data: { assignee_id: gone.id } }).select("id");
  assert.match(String(bad.error?.message), /active employee/);
  const ext = await c.from("records").insert({ section: "company.tasks", title: `To a partner ${run}`, status: "New", data: { assignee_id: pat.id } }).select("id");
  assert.match(String(ext.error?.message), /active employee/, "external accounts are not employees");
  const { data: t } = await c.from("records").insert({ section: "company.tasks", title: `Before leaving ${run}`, status: "New", data: { assignee_id: eng2.id, assignee: `Ezra Engineer ${run}` } }).select("*").single();
  await db.from("profiles").update({ disabled: true }).eq("id", eng2.id);
  const { error } = await c.from("records").update({ data: { ...t.data, notes: "still readable" } }).eq("id", t.id);
  assert.ifError(error); // unchanged assignment of someone who left: allowed, attribution kept
  const [row] = await sql("select data->>'assignee' a, data->>'assignee_id' i from records where id = $1", [t.id]); assert.deepEqual([row.a, row.i], [`Ezra Engineer ${run}`, eng2.id]);
  await db.from("profiles").update({ disabled: false }).eq("id", eng2.id);
});

test("who may change a task: author, assignee, project manager, management — nobody else", async () => {
  const { data: p } = await db.from("records").insert({ section: "company.projects", title: `StarDome C40 ${run}`, status: "Active", data: { manager_id: ops.id, manager: "Oz" } }).select("*").single();
  const { c: ce } = await signIn(eng.email); const { c: c2 } = await signIn(eng2.email); const { c: co } = await signIn(ops.email); const { c: cm } = await signIn(mgr.email);
  const { data: t } = await ce.from("records").insert({ section: "company.tasks", title: `Wiring ${run}`, status: "New", data: { assignee_id: eng.id, project_ref: p.id } }).select("*").single();
  const other = await c2.from("records").update({ status: "Cancelled" }).eq("id", t.id).select("id");
  assert.match(String(other.error?.message), /Only the author/, "a colleague who is neither author, assignee nor manager is refused");
  const del = await c2.from("records").delete().eq("id", t.id).select("id"); assert.ok(del.error || !del.data?.length, "…and cannot delete it");
  assert.ifError((await co.from("records").update({ status: "In progress" }).eq("id", t.id)).error); // project manager
  assert.ifError((await cm.from("records").update({ status: "Waiting" }).eq("id", t.id)).error); // management
  assert.ifError((await ce.from("records").update({ status: "Review" }).eq("id", t.id)).error); // author and assignee
});

test("completion date is set by the status and cleared when the task is reopened", async () => {
  const { c } = await signIn(eng.email);
  const { data: t } = await c.from("records").insert({ section: "company.tasks", title: `Done-date ${run}`, status: "New", data: { assignee_id: eng.id } }).select("*").single();
  const { data: d1 } = await c.from("records").update({ status: "Completed" }).eq("id", t.id).select("data").single();
  assert.equal(d1.data.completed_at, new Date().toISOString().slice(0, 10));
  const { data: d2 } = await c.from("records").update({ status: "In progress", data: d1.data }).eq("id", t.id).select("data").single();
  assert.equal(d2.data.completed_at, undefined);
});

test("project teams: only active employees as manager and members; added people are told once", async () => {
  const { c } = await signIn(mgr.email);
  const bad = await c.from("records").insert({ section: "company.projects", title: `Bad PM ${run}`, status: "Planned", data: { manager_id: gone.id } }).select("id");
  assert.match(String(bad.error?.message), /active employee/);
  const bad2 = await c.from("records").insert({ section: "company.projects", title: `Bad team ${run}`, status: "Planned", data: { manager_id: mgr.id, members_ids: [eng.id, pat.id] } }).select("id");
  assert.match(String(bad2.error?.message), /active employees/);
  const { data: p } = await c.from("records").insert({ section: "company.projects", title: `UAE Operations ${run}`, status: "Planned", data: { manager_id: ops.id, members_ids: [eng.id] } }).select("*").single();
  await c.from("records").update({ data: { ...p.data, members_ids: [eng.id, fin.id] } }).eq("id", p.id);
  await c.from("records").update({ data: { ...p.data, members_ids: [eng.id, fin.id], description: "x" } }).eq("id", p.id);
  assert.deepEqual((await notes(eng.id, p.id)).map((n: any) => n.kind), ["project_member"]);
  assert.deepEqual((await notes(fin.id, p.id)).map((n: any) => n.kind), ["project_member"]);
  assert.deepEqual((await notes(ops.id, p.id)).map((n: any) => n.kind), ["project_member"], "the manager is told once");
});

test("notifications: assignment, reassignment, status — once per event, never to the person who did it", async () => {
  const { c } = await signIn(mgr.email);
  const { data: t } = await c.from("records").insert({ section: "company.tasks", title: `Order radar ${run}`, status: "New", data: { assignee_id: eng.id, priority: "High", due: "2026-12-01" } }).select("*").single();
  await c.from("records").update({ data: { ...t.data, notes: "x" } }).eq("id", t.id); // nothing that concerns the assignee
  assert.deepEqual((await notes(eng.id, t.id)).map((n: any) => n.kind), ["assigned"]);
  assert.match((await notes(eng.id, t.id))[0].body, /High · due 2026-12-01/);
  await c.from("records").update({ data: { ...t.data, assignee_id: eng2.id } }).eq("id", t.id);
  assert.deepEqual((await notes(eng2.id, t.id)).map((n: any) => n.kind), ["reassigned"]);
  assert.deepEqual((await notes(eng.id, t.id)).map((n: any) => n.kind), ["assigned", "unassigned"]);
  const { c: c2 } = await signIn(eng2.email);
  await c2.from("records").update({ status: "In progress" }).eq("id", t.id);
  assert.deepEqual((await notes(mgr.id, t.id)).map((n: any) => n.kind), ["status"], "the author hears about the status");
  assert.equal((await notes(eng2.id, t.id)).filter((n: any) => n.kind === "status").length, 0, "not the person who changed it");
  // a translation written later is not an event
  await db.from("records").update({ data: { ...t.data, assignee_id: eng2.id, _tr: { h: { en: "x" } } } }).eq("id", t.id);
  assert.equal((await notes(eng2.id, t.id)).length, 1);
});

test("nobody is told about a record they may not open (US-persons-only, other sections)", async () => {
  const { c } = await signIn(mgr.email); // US person
  const { data: t } = await c.from("records").insert({ section: "company.tasks", title: `Controlled task ${run}`, status: "New", controlled: true, data: { assignee_id: eng.id } }).select("*").single();
  assert.equal((await notes(eng.id, t.id)).length, 0, "Eli is not a US person: no notice, not even the title");
  const { data: inv } = await db.from("records").insert({ section: "finance.invoices", title: `Invoice ${run}`, status: "Draft", data: {}, controlled: false }).select("*").single();
  await db.from("comments").insert({ record_id: inv.id, author: fin.id, body: `@[Eli](${eng.id}) see the invoice` });
  assert.equal((await notes(eng.id, inv.id)).length, 0, "engineering cannot read invoices: no mention notice");
});

test("mentions come from the text by account; forged lists are ignored; partners never see internal notes", async () => {
  const { data: rec } = await db.from("records").insert({ section: "operations.support", title: `Support case ${run}`, status: "Active", data: {}, company: `Acme ${run}`, controlled: false }).select("*").single();
  const { c: cm } = await signIn(mgr.email);
  const ins = await cm.from("comments").insert({ record_id: rec.id, author: mgr.id, body: `Hi @[Pat](${pat.id}) and @[Fay](${fin.id}) — internal pricing note`, internal: true, mentions: [ops.id] }).select("id, mentions").single();
  assert.ifError(ins.error); assert.deepEqual(new Set(ins.data!.mentions), new Set([pat.id, fin.id]), "the stored list is what the text says");
  assert.equal((await notes(ops.id, rec.id)).length, 0, "a forged mention list notifies nobody");
  assert.equal((await notes(pat.id, rec.id)).length, 0, "an internal note never reaches a partner");
  const fn = await notes(fin.id, rec.id); // finance is told only if it may read support cases
  const canFin = (await sql("select count(*)::int n from section_access where role = 'finance' and section = 'operations.support'"))[0].n > 0;
  assert.equal(fn.length, canFin ? 1 : 0);
  await cm.from("comments").insert({ record_id: rec.id, author: mgr.id, body: `@[Pat](${pat.id}) the visit is on Monday`, internal: false });
  assert.deepEqual((await notes(pat.id, rec.id)).map((n: any) => n.kind), ["mention"], "a shared comment reaches the partner of that company");
  const { c: cp } = await signIn(pat.email);
  const seen = (await cp.from("comments").select("body, internal").eq("record_id", rec.id)).data || [];
  assert.equal(seen.length, 1); assert.equal(seen[0].internal, false);
  const forged = await cp.from("comments").insert({ record_id: rec.id, author: pat.id, body: "partner note", internal: true }).select("internal").single();
  if (!forged.error) assert.equal(forged.data!.internal, false, "a partner cannot write an internal note");
});

test("comment notifications reach the people in the conversation, not the author", async () => {
  const { c } = await signIn(eng.email);
  const { data: t } = await c.from("records").insert({ section: "company.tasks", title: `Talk ${run}`, status: "New", data: { assignee_id: ops.id } }).select("*").single();
  await c.from("comments").insert({ record_id: t.id, author: eng.id, body: "Started" });
  const { c: co } = await signIn(ops.email); await co.from("comments").insert({ record_id: t.id, author: ops.id, body: "Thanks" });
  assert.deepEqual((await notes(ops.id, t.id)).map((n: any) => n.kind), ["assigned", "comment"]);
  assert.deepEqual((await notes(eng.id, t.id)).map((n: any) => n.kind), ["comment"]);
});

test("approvals: the approver is told; the requester hears the decision, including 'changes requested'", async () => {
  const { data: d } = await db.from("records").insert({ section: "company.documents", title: `Spec ${run}`, status: "In review", data: {}, created_by: eng.id }).select("*").single();
  const { data: a } = await db.from("approvals").insert({ record_id: d.id, section: d.section, requested_by: eng.id, approver_id: mgr.id, token_hash: (run + "y".repeat(64)).slice(0, 64) }).select("*").single();
  assert.deepEqual((await notes(mgr.id, d.id)).map((n: any) => n.kind), ["approval_requested"]);
  await db.from("approvals").update({ status: "changes_requested", comment: "Add the wiring section", decided_by: mgr.id, decided_at: new Date().toISOString() }).eq("id", a.id);
  const n = await notes(eng.id, d.id); assert.deepEqual(n.map((x: any) => x.kind), ["approval_done"]); assert.match(n[0].body, /changes_requested: Add the wiring section/);
});

test("deadline reminders: due soon and overdue, once per date", async () => {
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const { data: t1 } = await db.from("records").insert({ section: "company.tasks", title: `Due tomorrow ${run}`, status: "New", data: { assignee_id: eng.id, due: day(1) }, created_by: mgr.id }).select("id").single();
  const { data: t2 } = await db.from("records").insert({ section: "company.tasks", title: `Late ${run}`, status: "In progress", data: { assignee_id: eng.id, due: day(-2) }, created_by: mgr.id }).select("id").single();
  const { data: t3 } = await db.from("records").insert({ section: "company.tasks", title: `Finished ${run}`, status: "Completed", data: { assignee_id: eng.id, due: day(-2) }, created_by: mgr.id }).select("id").single();
  await db.rpc("notify_due", {}); await db.rpc("notify_due", {});
  assert.deepEqual((await notes(eng.id, t1!.id)).map((n: any) => n.kind), ["assigned", "due_soon"]);
  assert.deepEqual((await notes(eng.id, t2!.id)).map((n: any) => n.kind), ["assigned", "overdue"]);
  assert.equal((await notes(eng.id, t3!.id)).filter((n: any) => n.kind === "overdue").length, 0, "completed work is not chased");
});

test("my notifications are mine: others cannot read them, I can only mark them read", async () => {
  const { c: ce } = await signIn(eng.email); const { c: c2 } = await signIn(eng2.email);
  const mine = (await ce.from("notifications").select("id,user_id,read_at")).data || [];
  assert.ok(mine.length > 0 && mine.every((n: any) => n.user_id === eng.id));
  assert.equal(((await c2.from("notifications").select("id").in("id", mine.map((n: any) => n.id))).data || []).length, 0);
  const forge = await ce.from("notifications").update({ title: "changed" }).eq("id", mine[0].id).select("id");
  assert.ok(forge.error, "only the read marker can be changed");
  const ok = await ce.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", mine[0].id).select("read_at").single();
  assert.ifError(ok.error); assert.ok(ok.data!.read_at);
  const steal = await c2.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", mine[1]?.id || mine[0].id).select("id");
  assert.equal((steal.data || []).length, 0);
});

test("delivery: one e-mail per person with everything new; two workers never send the same notice twice", async () => {
  clearMail();
  await sql("update notifications set email_state = 'skipped' where email_state in ('pending','sending')"); // earlier tests
  const { c } = await signIn(mgr.email);
  for (let i = 0; i < 3; i++) await c.from("records").insert({ section: "company.tasks", title: `Batch ${i} ${run}`, status: "New", data: { assignee_id: ops.id } });
  const [r1, r2] = await Promise.all([deliverNotifications(db, { deadline: Date.now() + 20000, batch: 2 }), deliverNotifications(db, { deadline: Date.now() + 20000, batch: 2 })]);
  const got = mailsTo(ops.email);
  assert.equal(r1.email_items + r2.email_items, 3, "every notice delivered once");
  assert.ok(got.length >= 1 && got.length <= 2, `${got.length} letters`);
  assert.equal(got.map((m: any) => (m.raw.match(/Batch \d/g) || []).length).reduce((a: number, b: number) => a + b, 0) >= 3, true);
  const st = await sql("select email_state from notifications where user_id = $1 and title like $2", [ops.id, `Batch % ${run}`]);
  assert.ok(st.every((x: any) => x.email_state === "sent"));
  const again = await deliverNotifications(db, { deadline: Date.now() + 5000 }); assert.equal(again.email_items, 0, "nothing is sent twice");
});

test("delivery: a refused address is marked failed; a person can switch an event off", async () => {
  const bad = await makeUser(`nobody-${run}@fail.test`, "engineering", { name: `Nobody ${run}` });
  const { c } = await signIn(mgr.email);
  await c.from("records").insert({ section: "company.tasks", title: `To a bad address ${run}`, status: "New", data: { assignee_id: bad.id } });
  await deliverNotifications(db, { deadline: Date.now() + 10000 });
  const [n] = await sql("select email_state, error from notifications where user_id = $1", [bad.id]); assert.equal(n.email_state, "failed"); assert.ok(n.error);
  const { c: cb } = await signIn(bad.email);
  assert.ifError((await cb.from("profiles").update({ notify_prefs: { muted: ["assigned"] } }).eq("id", bad.id)).error);
  await c.from("records").insert({ section: "company.tasks", title: `Muted ${run}`, status: "New", data: { assignee_id: bad.id } });
  assert.equal((await sql("select count(*)::int n from notifications where user_id = $1", [bad.id]))[0].n, 1, "muted events are not written");
  const self = await cb.from("profiles").update({ department: "management" }).eq("id", bad.id).select("id");
  assert.ok(self.error, "department is set by administrators only");
});

test("search never shows what the person may not open — not in titles, comments or counts", async () => {
  const secret = `Zephyr${run}`;
  await db.from("records").insert([
    { section: "company.tasks", title: `${secret} internal task`, status: "New", data: {}, controlled: false },
    { section: "company.tasks", title: `${secret} controlled task`, status: "New", data: {}, controlled: true },
    { section: "finance.invoices", title: `${secret} invoice`, status: "Draft", data: {}, controlled: false },
  ]);
  const hits = async (email: string) => ((await (await signIn(email)).c.rpc("search_records", { q: secret, n: 50 })).data || []).map((r: any) => r.title).sort();
  assert.deepEqual(await hits(eng.email), [`${secret} internal task`], "engineering: internal task only");
  const m = await hits(mgr.email); assert.ok(m.includes(`${secret} controlled task`) && m.includes(`${secret} internal task`), "a US-person manager also finds the US-persons-only task");
  assert.deepEqual(await hits(pat.email), [], "a partner finds nothing internal");
  const ru = `Радар${run}`; await db.from("records").insert({ section: "company.tasks", title: `Заказать ${ru}`, status: "New", data: {} });
  const ruHits = ((await (await signIn(eng.email)).c.rpc("search_records", { q: `заказать ${ru.toLowerCase()}`, n: 10 })).data || []);
  assert.equal(ruHits.length, 1, "Russian words are found regardless of case");
  const { c: cp } = await signIn(pat.email);
  assert.equal(((await cp.from("comments").select("id").ilike("body", "%internal pricing%")).data || []).length, 0, "internal comments are not searchable by partners");
});
