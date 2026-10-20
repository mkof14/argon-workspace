// The transactional automation engine: no duplicate proposals, one execution per approval even when many people
// press "Approve" at once, durable e-mail delivery (never resent when unsure), retries with back-off, dead letters,
// parallel workers, "already done" keys, task assignment notices, and moving the old file-based state.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { admin, clearMail, makeUser, mailsTo, sql, uid } from "./_stack.ts";
import { decide, runRetries, onRecordEvent, getQueue, migrateLegacy } from "../../src/lib/server/automation.ts";
import { sendExternal } from "../../src/lib/server/outbound.ts";
import { claimKeys } from "../../src/lib/server/state.ts";

const run = uid(); const db = admin();
let owner: any, sales: any;
before(async () => {
  owner = await makeUser(`ao-${run}@agron-stack.test`, "owner", { us: true, name: "Olga Owner" });
  sales = await makeUser(`as-${run}@agron-stack.test`, "sales", { name: `Sam Sales ${run}` });
});
const enqueue = async (items: any[]) => (await db.rpc("automation_enqueue", { p_items: items })).data as string[];
const email = (to: string, subject = `Hello ${uid()}`) => ({ type: "email", to_field: "", to, subject, body: "Synthetic test letter." });

test("a waiting or rejected proposal is never proposed twice", async () => {
  const k = `dedupe|${run}`; const item = { agent: "rules", title: "Create X", detail: "t", action: email(`x-${run}@client.test`), dedupe_key: k };
  assert.equal((await enqueue([item])).length, 1);
  assert.equal((await enqueue([item, item])).length, 0, "same key while waiting");
  const [{ id }] = await sql("select id from automation_queue where dedupe_key = $1", [k]);
  await decide(db, id, false, { id: owner.id, us_person: true, email: owner.email });
  assert.equal((await enqueue([item])).length, 0, "same key after it was rejected");
});

test("20 people pressing Approve at the same moment: one execution, one e-mail", async () => {
  clearMail(); const to = `client-${run}@client.test`;
  const [id] = await enqueue([{ agent: "sales", title: `Email ${to}`, detail: "race", action: email(to, `Proposal ${run}`), dedupe_key: `race|${run}` }]);
  const by = { id: owner.id, us_person: true, email: owner.email };
  const res = await Promise.allSettled(Array.from({ length: 20 }, () => decide(db, id, true, by)));
  const ok = res.filter((r) => r.status === "fulfilled"); const no = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(ok.length, 1, "exactly one decision wins");
  assert.ok(no.every((r) => /Already decided/.test(String(r.reason?.message))), "the others are told it is decided");
  assert.equal(mailsTo(to).length, 1, "exactly one e-mail left");
  const [row] = await sql("select status, attempts, decided_by from automation_queue where id = $1", [id]);
  assert.deepEqual([row.status, row.attempts, row.decided_by], ["completed", 1, owner.email]);
  const [m] = await sql("select status, provider_id from outbound_messages where idem_key = $1", [`queue:${id}`]); assert.equal(m.status, "sent"); assert.ok(m.provider_id);
});

test("the same delivery key never sends twice, even in parallel", async () => {
  clearMail(); const to = `dup-${run}@client.test`; const m = { idem: `test:${run}:dup`, to, subject: "Once", html: "<p>x</p>", text: "x" };
  const r = await Promise.all(Array.from({ length: 8 }, () => sendExternal(db, m)));
  assert.equal(r.filter((x) => x.status === "sent").length, 1);
  assert.ok(r.every((x) => ["sent", "already-sent", "in-progress"].includes(x.status)));
  assert.equal((await sendExternal(db, m)).status, "already-sent"); assert.equal(mailsTo(to).length, 1);
});

test("delivery unknown (connection broke after the message): not resent, waits for a person", async () => {
  clearMail(); const to = `lost-${run}@drop.test`;
  const [id] = await enqueue([{ agent: "sales", title: `Email ${to}`, detail: "drop", action: email(to), dedupe_key: `drop|${run}` }]);
  const out = await decide(db, id, true, { id: owner.id, us_person: true, email: owner.email });
  assert.equal(out.state, "failed"); assert.match(String(out.last_error), /uncertain/i);
  const [m] = await sql("select status from outbound_messages where idem_key = $1", [`queue:${id}`]); assert.equal(m.status, "uncertain");
  await sql("update automation_queue set status = 'retrying', next_attempt_at = now() where id = $1", [id]); // even if someone forces a retry…
  await runRetries(db);
  assert.equal(mailsTo(to).length, 1, "…the message is not sent a second time");
});

test("a passing failure is retried with growing pauses, then dead-lettered and announced", async () => {
  clearMail(); const to = `later-${run}@busy.test`;
  const [id] = await enqueue([{ agent: "sales", title: `Email ${to}`, detail: "busy", action: email(to), dedupe_key: `busy|${run}` }]);
  let st = await decide(db, id, true, { id: owner.id, us_person: true, email: owner.email });
  assert.equal(st.state, "retrying"); assert.equal(st.attempts, 1);
  const [r1] = await sql("select extract(epoch from (next_attempt_at - now())) as wait from automation_queue where id = $1", [id]); assert.ok(r1.wait > 30 && r1.wait <= 61, `first pause ~1 min, got ${r1.wait}`);
  const waits: number[] = [];
  for (let i = 2; i <= 5; i++) {
    assert.equal((await runRetries(db)).claimed >= 0, true);
    const [before] = await sql("select status from automation_queue where id = $1", [id]); assert.equal(before.status, "retrying", "not due yet: untouched");
    await sql("update automation_queue set next_attempt_at = now() - interval '1 second' where id = $1", [id]);
    await runRetries(db);
    const [r] = await sql("select status, attempts, extract(epoch from (next_attempt_at - now())) as wait from automation_queue where id = $1", [id]);
    assert.equal(r.attempts, i); if (r.status === "retrying") waits.push(Math.round(r.wait / 60));
    st = r as any;
  }
  assert.deepEqual(waits, [4, 16, 64]); assert.equal((st as any).status, "dead");
  assert.ok(mailsTo(owner.email).some((m) => /gave up/i.test(m.raw)), "administrators were told");
  const again = await db.rpc("automation_requeue", { p_id: id, p_by: owner.email }); assert.equal(again.data[0].status, "retrying", "an administrator can send it round again");
});

test("two workers at once never take the same item", async () => {
  clearMail(); const ids = await enqueue(Array.from({ length: 6 }, (_, i) => ({ agent: "sales", title: `W${i}`, detail: "w", action: email(`w${i}-${run}@client.test`), dedupe_key: `w${i}|${run}` })));
  await sql("update automation_queue set status = 'retrying', next_attempt_at = now() - interval '1 second', exec_id = gen_random_uuid() where id = any($1::uuid[])", [ids]);
  await Promise.all([runRetries(db), runRetries(db), runRetries(db)]);
  for (let i = 0; i < 6; i++) assert.equal(mailsTo(`w${i}-${run}@client.test`).length, 1, `item ${i} sent once`);
  const rows = await sql("select status, attempts from automation_queue where id = any($1::uuid[])", [ids]);
  assert.ok(rows.every((r: any) => r.status === "completed" && r.attempts === 1));
});

test("a worker that stopped half-way: the item is picked up again, an e-mail already sent is not repeated", async () => {
  clearMail(); const to = `crash-${run}@client.test`;
  const [id] = await enqueue([{ agent: "sales", title: `Email ${to}`, detail: "crash", action: email(to), dedupe_key: `crash|${run}` }]);
  await decide(db, id, true, { id: owner.id, us_person: true, email: owner.email });
  // pretend the worker died after sending but before recording the result
  await sql("update automation_queue set status = 'processing', claimed_at = now() - interval '20 minutes' where id = $1", [id]);
  const r = await runRetries(db); assert.ok(r.claimed >= 1);
  const [row] = await sql("select status, result from automation_queue where id = $1", [id]);
  assert.equal(row.status, "completed"); assert.match(row.result, /already emailed/); assert.equal(mailsTo(to).length, 1);
});

test("'already done' keys: of 25 parallel claims exactly one wins; repeat intervals are honoured", async () => {
  const k = `once|${run}`; const r = await Promise.all(Array.from({ length: 25 }, () => claimKeys(db, [{ key: k, repeat: null }])));
  assert.equal(r.filter((s) => s.has(k)).length, 1);
  const w = `weekly|${run}`; assert.equal((await claimKeys(db, [{ key: w, repeat: 7 }])).size, 1); assert.equal((await claimKeys(db, [{ key: w, repeat: 7 }])).size, 0);
  await sql("update automation_fired set fired_on = current_date - 8 where key = $1", [w]); assert.equal((await claimKeys(db, [{ key: w, repeat: 7 }])).size, 1, "a week later it may fire again");
});

test("workflow A: a new task tells the person it is assigned to, once", async () => {
  // since v19 the database writes the personal notification; the old automatic e-mail rule is off (no double message)
  clearMail();
  const { data: t } = await db.from("records").insert({ section: "company.tasks", title: `Prepare FAT checklist ${run}`, status: "New", data: { assignee: sales.email, assignee_id: sales.id, due: "2026-12-01" }, created_by: owner.id }).select("*").single();
  const a = await onRecordEvent(db, t, { kind: "created" }); const b = await onRecordEvent(db, t, { kind: "created" });
  assert.equal(a.matched, 0); assert.equal(b.matched, 0, "the old e-mail rule no longer fires");
  await db.from("records").update({ data: { ...t.data, notes: "more detail" } }).eq("id", t.id); // an edit that does not change the assignment
  const n = await sql("select kind, title from notifications where user_id = $1 and record_id = $2", [sales.id, t.id]);
  assert.deepEqual(n.map((x: any) => x.kind), ["assigned"]); assert.match(n[0].title, /Prepare FAT checklist/);
  assert.equal(mailsTo(sales.email).length, 0, "no e-mail from the automation engine; delivery is the notification job");
});

test("state kept by the earlier version (files in Storage) moves into the tables once", async () => {
  const st = db.storage.from("backups"); await db.storage.createBucket("backups", { public: false }).catch(() => null);
  await sql("delete from ops_state where key = 'legacy_import'");
  const legacyQueue = [{ id: globalThis.crypto.randomUUID(), at: "2026-10-01T10:00:00Z", agent: "rules", title: `legacy ${run}`, detail: "", action: { type: "notify", to: "leads", message: "x" }, status: "pending" }];
  await st.upload("state/queue.json", Buffer.from(JSON.stringify(legacyQueue)), { upsert: true, contentType: "application/json" });
  await st.upload("state/fired.json", Buffer.from(JSON.stringify({ [`legacy|${run}`]: "2026-10-01" })), { upsert: true, contentType: "application/json" });
  // a fresh process: the module checks again
  const mod = await import(`../../src/lib/server/automation.ts?fresh=${run}`); await mod.migrateLegacy(db);
  assert.equal((await sql("select count(*)::int as n from automation_queue where title = $1", [`legacy ${run}`]))[0].n, 1);
  assert.equal((await sql("select count(*)::int as n from automation_fired where key = $1", [`legacy|${run}`]))[0].n, 1);
  await mod.migrateLegacy(db); assert.equal((await sql("select count(*)::int as n from automation_queue where title = $1", [`legacy ${run}`]))[0].n, 1, "never twice");
  assert.ok((await getQueue(db)).some((q) => q.title === `legacy ${run}` && q.status === "pending"));
  void migrateLegacy;
});
