// Phase 1 logic without a database: scheduling slots and back-off, missed runs, backup retention, three-way merge,
// e-mail failure meaning, role checks with MFA, AWS Signature V4 (official AWS example), link tokens, offline queue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOBS, backoffMin, isDue, jobDef, missed, slotOf, type Run } from "../src/lib/jobs.ts";
import { retention } from "../src/lib/retention.ts";
import { merge3, resolve } from "../src/lib/merge.ts";
import { classifySend } from "../src/lib/mailerror.ts";
import { meets } from "../src/lib/roles.ts";
import { signV4 } from "../src/lib/server/s3.ts";
import { hashToken, newToken } from "../src/lib/server/tokens.ts";
import { enqueueSave, ConflictError, isConflict } from "../src/lib/outboxlogic.ts";

const at = (s: string) => new Date(s);

test("each job belongs to the right run (slot)", () => {
  assert.equal(slotOf(jobDef("retry")!, at("2026-10-19T10:07:00Z")), "2026-10-19T10:00");
  assert.equal(slotOf(jobDef("retry")!, at("2026-10-19T10:59:00Z")), "2026-10-19T10:45");
  assert.equal(slotOf(jobDef("digest")!, at("2026-10-19T10:59:00Z")), "2026-10-19T10");
  assert.equal(slotOf(jobDef("agents")!, at("2026-10-19T09:59:00Z")), "2026-10-18", "before 10:00 the daily run is yesterday's");
  assert.equal(slotOf(jobDef("agents")!, at("2026-10-19T10:00:00Z")), "2026-10-19");
  assert.equal(slotOf(jobDef("reports")!, at("2026-11-01T09:00:00Z")), "2026-10", "on the 1st before 10:00 the monthly run is last month's");
  assert.equal(slotOf(jobDef("reports")!, at("2026-11-01T10:30:00Z")), "2026-11");
  assert.ok(JOBS.every((j) => typeof j.label === "string" && j.label.length > 3));
});

test("a job runs once per slot, never twice at the same time, and waits after a failure", () => {
  const j = jobDef("agents")!; const now = at("2026-10-19T10:20:00Z");
  const r = (status: Run["status"], started: string, slot = "2026-10-19", finished?: string): Run => ({ job: "agents", slot, status, started_at: started, finished_at: finished || started });
  assert.deepEqual(isDue(j, now, []).due, true);
  assert.equal(isDue(j, now, [r("completed", "2026-10-19T10:01:00Z")]).why, "done");
  assert.equal(isDue(j, now, [r("running", "2026-10-19T10:15:00Z")]).why, "running");
  assert.equal(isDue(j, now, [r("running", "2026-10-19T09:00:00Z", "2026-10-18")]).due, true, "a running copy older than 10 minutes does not block");
  assert.equal(isDue(j, now, [r("failed", "2026-10-19T10:18:00Z", "2026-10-19", "2026-10-19T10:19:00Z")]).why, "backoff", "2 minutes after the first failure");
  assert.equal(isDue(j, now, [r("failed", "2026-10-19T10:10:00Z", "2026-10-19", "2026-10-19T10:11:00Z")]).why, "retry");
  assert.equal(isDue(j, now, [r("dead", "2026-10-19T10:12:00Z")]).why, "dead");
  assert.equal(isDue(j, now, [r("completed", "2026-10-18T10:01:00Z", "2026-10-18")]).due, true, "yesterday's success does not cover today");
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(backoffMin), [2, 4, 8, 16, 32, 60, 60]);
});

test("missed runs are found; frequent jobs are expected daily until the 15-minute trigger is on", () => {
  const now = at("2026-10-20T15:00:00Z");
  const done = (job: string, t: string, trigger = "cron"): Run => ({ job, slot: "x", status: "completed", started_at: t, finished_at: t, trigger });
  const runs = JOBS.map((j) => done(j.id, "2026-10-20T10:05:00Z"));
  assert.deepEqual(missed(now, runs), [], "everything ran today");
  const old = runs.map((r) => (r.job === "backup" ? { ...r, started_at: "2026-10-18T09:05:00Z", finished_at: "2026-10-18T09:05:00Z" } : r));
  assert.deepEqual(missed(now, old).map((m) => m.job), ["backup"]);
  const fast = [...runs.map((r) => (r.job === "retry" ? { ...r, started_at: "2026-10-20T14:40:00Z", finished_at: "2026-10-20T14:40:00Z", trigger: "github" } : r))];
  assert.deepEqual(missed(now, fast).map((m) => m.job), ["intake", "sla", "calendar", "digest", "translate"], "with the 15-minute trigger seen, frequent jobs that only ran in the morning are late");
  assert.deepEqual(missed(now, [], "2026-10-20T14:30:00Z"), [], "a fresh install is not 'missed' yet");
});

test("backup retention keeps 14 daily, 8 Monday and 12 monthly copies", () => {
  const items = []; for (let i = 0; i < 400; i++) { const d = new Date(Date.UTC(2026, 9, 20) - i * 864e5).toISOString().slice(0, 10); items.push({ name: `db/${d}`, date: d }); }
  const { keep, drop } = retention(items, "2026-10-20");
  assert.equal(keep.length + drop.length, 400);
  for (let i = 0; i <= 14; i++) assert.ok(keep.includes(`db/${new Date(Date.UTC(2026, 9, 20) - i * 864e5).toISOString().slice(0, 10)}`), `day -${i} kept`);
  assert.ok(keep.includes("db/2026-09-07"), "a Monday 6 weeks back"); assert.ok(!keep.includes("db/2026-09-08"), "a Tuesday 6 weeks back goes");
  assert.ok(keep.includes("db/2026-01-01") && keep.includes("db/2025-11-01"), "first of the month"); assert.ok(!keep.includes("db/2025-09-21"));
  assert.ok(keep.length < 45, `kept ${keep.length}`);
  assert.deepEqual(retention([{ name: "only", date: "2020-01-01" }], "2026-10-20").keep, ["only"], "the newest always stays");
});

test("three-way merge: changes that do not overlap combine, the rest is asked", () => {
  const base = { title: "Radar units", status: "Draft", data: { qty: 2, vendor: "A", notes: "x" } };
  const mine = { title: "Radar units", status: "Ordered", data: { qty: 2, vendor: "A", notes: "x", eta: "2026-11-01" } };
  const theirs = { title: "Radar units ×2", status: "Draft", data: { qty: 3, vendor: "A", notes: "x", _tr: { h: {} } }, version: 4 };
  const m = merge3(base, mine, theirs);
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.merged.title, "Radar units ×2"); assert.equal(m.merged.status, "Ordered"); assert.equal(m.merged.data!.qty, 3); assert.equal(m.merged.data!.eta, "2026-11-01");
  const both = merge3(base, { ...mine, data: { ...mine.data, qty: 5 } }, theirs);
  assert.deepEqual(both.conflicts.map((c) => c.field), ["data.qty"]);
  assert.equal(resolve(both.merged, both.conflicts, { "data.qty": "mine" }).data!.qty, 5);
  assert.equal(resolve(both.merged, both.conflicts, {}).data!.qty, 3, "default keeps theirs");
  assert.deepEqual(merge3(base, { ...base, data: { ...base.data } }, { ...base, data: { ...base.data, vendor: "B" } }).merged.data!.vendor, "B", "untouched by me: theirs");
});

test("a failed e-mail send is classified before anyone retries it", () => {
  assert.equal(classifySend({ code: "EAUTH", command: "AUTH PLAIN" }).kind, "retry");
  assert.equal(classifySend({ code: "ECONNECTION" }).kind, "retry");
  assert.equal(classifySend({ code: "EENVELOPE", command: "RCPT TO", responseCode: 550 }).kind, "permanent");
  assert.equal(classifySend({ command: "RCPT TO", responseCode: 451 }).kind, "retry");
  assert.equal(classifySend({ code: "ETIMEDOUT", command: "DATA" }).kind, "uncertain", "after the message was handed over: may have arrived");
  assert.equal(classifySend({ code: "ESOCKET" }).kind, "uncertain");
  assert.equal(classifySend({ code: "ECONNECTION", command: "CONN", message: "Connection closed unexpectedly" }).kind, "uncertain", "what nodemailer says when the server hangs up after the message");
  assert.equal(classifySend({ code: "ECONNECTION", command: "CONN", message: "connect ECONNREFUSED 127.0.0.1:465" }).kind, "retry");
  assert.equal(classifySend({ command: "DATA", responseCode: 554 }).kind, "permanent");
});

test("role checks: privileged sessions need the second factor once it is required", () => {
  assert.equal(meets({ role: "owner" }, "admin", { mfaRequired: true, aal: "aal1" }).reason, "mfa");
  assert.equal(meets({ role: "owner" }, "admin", { mfaRequired: true, aal: "aal2" }).ok, true);
  assert.equal(meets({ role: "owner" }, "admin", { mfaRequired: false, aal: "aal1" }).ok, true);
  assert.equal(meets({ role: "sales" }, "internal", { mfaRequired: true, aal: "aal1" }).ok, true, "staff are not forced");
  assert.equal(meets({ role: "partner" }, "internal").reason, "role");
  assert.equal(meets({ role: "pending" }, "signed-in").reason, "signin");
  assert.equal(meets({ role: "finance", disabled: true }, "internal").reason, "disabled");
  assert.equal(meets({ role: "admin" }, "owner").reason, "role");
});

test("AWS Signature V4 matches the official AWS example (GET Object)", () => {
  const h = signV4({ method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), region: "us-east-1", keyId: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", headers: { range: "bytes=0-9" }, now: new Date("2013-05-24T00:00:00Z") });
  assert.equal(h.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.match(h.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/);
});

test("link tokens: long, random, stored only as a SHA-256", () => {
  const a = newToken(), b = newToken();
  assert.notEqual(a, b); assert.ok(a.length >= 32); assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("offline queue keeps the version the first change started from", () => {
  let n = 0; const id = () => String(++n);
  let { q } = enqueueSave([], { id: "r1", section: "company.tasks", title: "A", version: 3, data: { a: 1 } }, "t1", "u", id, { title: "A0", version: 3, data: {} });
  ({ q } = enqueueSave(q, { id: "r1", section: "company.tasks", title: "B", version: 7, data: { b: 2 } }, "t2", "u", id));
  assert.equal(q.length, 1); const x: any = q[0];
  assert.equal(x.rec.version, 3, "replay checks against the version the change was made on"); assert.deepEqual(x.rec.data, { a: 1, b: 2 }); assert.equal(x.base.title, "A0");
  const e = new ConflictError({ id: "r1", version: 9 }); assert.ok(isConflict(e)); assert.equal(e.theirs.version, 9); assert.ok(!isConflict(new Error("x")));
});
