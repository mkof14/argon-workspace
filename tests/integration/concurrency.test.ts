// No silent loss of newer data: version-checked saves for two people editing one record, translations that never
// bump the version, multi-record steps in one transaction, server read-change-write under load, and a change order
// fired several times at once that still adds its invoice exactly once.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { admin, makeUser, signIn, sql, uid } from "./_stack.ts";
import { patchRecord, applyOps, Conflict } from "../../src/lib/server/records.ts";
import { onRecordEvent } from "../../src/lib/server/automation.ts";
import { merge3 } from "../../src/lib/merge.ts";

const db = admin(); const run = uid();
let a: any, b: any;
before(async () => { a = await makeUser(`ca-${run}@agron-stack.test`, "operations"); b = await makeUser(`cb-${run}@agron-stack.test`, "operations"); });

test("two people edit the same record: the later save is refused, merged, then saved — nothing is lost", async () => {
  const { c: ca } = await signIn(a.email); const { c: cb } = await signIn(b.email);
  const { data: r } = await ca.from("records").insert({ section: "operations.procurement", title: `PO ${run}`, status: "Draft", data: { qty: 2, vendor: "A" } }).select("*").single();
  assert.equal(r.version, 1);
  const openedA = { ...r }, openedB = { ...r };
  const s1 = await ca.from("records").update({ title: r.title, status: "Draft", data: { ...openedA.data, qty: 3 } }).eq("id", r.id).eq("version", openedA.version).select("*").maybeSingle();
  assert.equal(s1.data?.version, 2);
  const s2 = await cb.from("records").update({ title: r.title, status: "Draft", data: { ...openedB.data, vendor: "B" } }).eq("id", r.id).eq("version", openedB.version).select("*").maybeSingle();
  assert.equal(s2.data, null, "B's save from the old version is refused");
  const { data: theirs } = await cb.from("records").select("*").eq("id", r.id).single();
  const m = merge3(openedB, { ...openedB, data: { ...openedB.data, vendor: "B" } }, theirs);
  assert.deepEqual(m.conflicts, []);
  const s3 = await cb.from("records").update({ title: m.merged.title, status: m.merged.status, data: m.merged.data }).eq("id", r.id).eq("version", theirs.version).select("*").single();
  assert.deepEqual([s3.data.version, s3.data.data.qty, s3.data.data.vendor], [3, 3, "B"], "both changes are kept");
  const hist = await sql("select actor, action from activity where record_id = $1 order by id", [r.id]);
  assert.deepEqual(hist.map((h: any) => h.action), ["created", "updated", "updated"]); assert.deepEqual(new Set(hist.slice(1).map((h: any) => h.actor)), new Set([a.id, b.id]), "the history keeps who changed what");
});

test("a translation written next to the record does not count as an edit", async () => {
  const { data: r } = await db.from("records").insert({ section: "operations.procurement", title: `Tr ${run}`, status: "Draft", data: { notes: "Привет" } }).select("*").single();
  const { data: t } = await db.from("records").update({ data: { ...r.data, _tr: { h: { en: "Hello" } } } }).eq("id", r.id).select("version,updated_at").single();
  assert.equal(t.version, 1); assert.equal(t.updated_at, r.updated_at);
});

test("a multi-record step is one transaction: a record that moved stops everything", async () => {
  const { data: x } = await db.from("records").insert({ section: "finance.invoices", title: `Inv ${run}`, status: "Draft", data: { amount: 100 } }).select("*").single();
  await db.from("records").update({ data: { amount: 101 } }).eq("id", x.id); // someone changed it: version 2
  await assert.rejects(applyOps(db, [{ op: "insert", row: { section: "finance.invoices", title: `Extra ${run}`, status: "Draft", data: {} } }, { op: "update", id: x.id, set: { data: { amount: 999 } }, if_version: 1 }]), Conflict);
  assert.equal((await sql("select count(*)::int as n from records where title = $1", [`Extra ${run}`]))[0].n, 0, "the insert was rolled back with it");
  assert.equal((await sql("select data->>'amount' as a from records where id = $1", [x.id]))[0].a, "101");
});

test("server read-change-write under load: 20 parallel changes, 20 results", async () => {
  const { data: x } = await db.from("records").insert({ section: "operations.support", title: `Counter ${run}`, status: "New", data: { n: 0, seen: [] } }).select("*").single();
  await Promise.all(Array.from({ length: 20 }, (_, i) => patchRecord(db, x.id, (cur) => ({ data: { ...cur.data, n: cur.data.n + 1, seen: [...cur.data.seen, i] } }), 60)));
  const [row] = await sql("select data, version from records where id = $1", [x.id]);
  assert.equal(row.data.n, 20); assert.equal(row.data.seen.length, 20); assert.equal(row.version, 21);
});

test("a signed change order handled five times at once adds its invoice exactly once", async () => {
  const deal = globalThis.crypto.randomUUID();
  const { data: co } = await db.from("records").insert({ section: "legal.contracts", title: `CO-1 ${run}`, status: "Signed", data: { type: "Change order", amount: 5000, deal_ref: deal, currency: "USD" } }).select("*").single();
  await Promise.all(Array.from({ length: 5 }, () => onRecordEvent(db, co, { kind: "status", from: "Review", to: "Signed" })));
  const inv = await sql("select id, data from records where section = 'finance.invoices' and data->>'change_ref' = $1", [co.id]);
  assert.equal(inv.length, 1); assert.equal(Number(inv[0].data.amount), 5000);
  const [c2] = await sql("select data from records where id = $1", [co.id]); assert.ok(c2.data.applied_on);
});
