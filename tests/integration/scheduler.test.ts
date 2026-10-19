// Scheduled jobs: every attempt traceable, no overlap, repeated triggers do not repeat work, back-off after a
// failure, dead-letter after five, recovery after an interrupted run, and the dispatcher running what is due.
import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, clearMail, makeUser, mailsTo, sql, uid } from "./_stack.ts";
import { runJob, dispatch, jobHealth } from "../../src/lib/server/jobs.ts";
import { JOBS, slotOf, jobDef } from "../../src/lib/jobs.ts";

const db = admin(); const run = uid();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a finished run is not repeated by a second trigger; every attempt is recorded", async () => {
  let n = 0; const job = `t-once-${run}`; const fn = async () => ({ n: ++n });
  const a = await runJob(db, job, "cron", fn, { slot: "2026-10-19" }); const b = await runJob(db, job, "github", fn, { slot: "2026-10-19" });
  assert.equal(a.status, "completed"); assert.deepEqual([b.status, (b as any).reason], ["skipped", "done"]); assert.equal(n, 1);
  const [r] = await sql("select status, trigger, attempt, duration_ms, result, finished_at from job_runs where job = $1", [job]);
  assert.equal(r.status, "completed"); assert.equal(r.trigger, "cron"); assert.equal(r.attempt, 1); assert.ok(r.duration_ms >= 0 && r.finished_at); assert.deepEqual(r.result, { n: 1 });
});

test("the same job never runs twice at the same time", async () => {
  let inside = 0, most = 0; const job = `t-overlap-${run}`;
  const fn = async () => { inside++; most = Math.max(most, inside); await sleep(300); inside--; return {}; };
  const r = await Promise.all([runJob(db, job, "a", fn), runJob(db, job, "b", fn), runJob(db, job, "c", fn)]);
  assert.equal(most, 1); assert.equal(r.filter((x) => x.status === "completed").length, 1); assert.equal(r.filter((x: any) => x.reason === "running").length, 2);
});

test("an interrupted run (function stopped) is recorded as timed out and the job runs again", async () => {
  const job = `t-crash-${run}`;
  await sql("insert into job_runs(job, slot, trigger, status, started_at, heartbeat_at) values ($1, 'x', 'cron', 'running', now() - interval '20 minutes', now() - interval '20 minutes')", [job]);
  const r = await runJob(db, job, "cron", async () => ({ ok: true }), { slot: "x" });
  assert.equal(r.status, "completed");
  const rows = await sql("select status, attempt from job_runs where job = $1 order by started_at", [job]);
  assert.deepEqual(rows.map((x: any) => x.status), ["timeout", "completed"]); assert.equal(rows[1].attempt, 2);
});

test("a failing job is recorded with its error, waits its back-off, and after 5 failures stops and tells administrators", async () => {
  const owner = await makeUser(`so-${run}@agron-stack.test`, "owner"); clearMail();
  const job = `t-fail-${run}`; let calls = 0; const fn = async () => { calls++; throw new Error("the payment provider answered 503"); };
  for (let i = 1; i <= 5; i++) { const r = await runJob(db, job, "cron", fn, { slot: "2026-10-19" }); assert.equal(r.status, "failed"); }
  const sixth = await runJob(db, job, "cron", fn, { slot: "2026-10-19" });
  assert.deepEqual([sixth.status, (sixth as any).reason], ["skipped", "dead"]); assert.equal(calls, 5);
  const rows = await sql("select status, attempt, error from job_runs where job = $1 order by started_at", [job]);
  assert.deepEqual(rows.map((r: any) => r.attempt), [1, 2, 3, 4, 5, 5]); assert.equal(rows[5].status, "dead"); assert.match(rows[0].error, /503/);
  assert.equal((await runJob(db, job, "cron", fn, { slot: "2026-10-19" })).status, "skipped", "stays stopped");
  assert.ok(mailsTo(owner.email).some((m) => /stopped trying/i.test(m.raw)), "administrators got the alert");
  const errs = await sql("select count(*)::int as n from app_errors where source = 'server' and agent = $1", [`job:${job}`]); assert.equal(errs[0].n, 5, "each failure is visible in the error log");
  await db.rpc("job_revive", { p_job: job, p_slot: "2026-10-19" });
  assert.equal((await runJob(db, job, "cron", async () => ({}), { slot: "2026-10-19" })).status, "completed", "after 'Allow again' it runs");
});

test("the dispatcher runs what is due once, and a second trigger right after does nothing new", async () => {
  await sql("delete from job_runs where job = any($1)", [JOBS.map((j) => j.id)]);
  const calls: Record<string, number> = {};
  const fns = Object.fromEntries(JOBS.map((j) => [j.id, async () => { calls[j.id] = (calls[j.id] || 0) + 1; return { ok: j.id }; }]));
  const a = await dispatch(db, fns, { trigger: "cron", budgetMs: 40_000 });
  assert.ok(a.jobs.every((j: any) => ["completed", "not-due"].includes(j.status)));
  const ran = Object.keys(calls); assert.ok(ran.includes("retry") && ran.includes("digest"), `ran ${ran.join(",")}`);
  const b = await dispatch(db, fns, { trigger: "github", budgetMs: 40_000 });
  assert.ok(b.jobs.every((j: any) => j.status === "not-due"), "nothing runs twice in the same slot");
  assert.ok(Object.values(calls).every((n) => n === 1));
  const h = await jobHealth(db); assert.ok(h.jobs.find((j: any) => j.job === "retry")?.last_ok);
});

test("a job left without time waits for the next trigger instead of being cut off", async () => {
  await sql("delete from job_runs where job = any($1)", [JOBS.map((j) => j.id)]);
  const fns = Object.fromEntries(JOBS.map((j) => [j.id, async () => { await sleep(150); return {}; }]));
  const r = await dispatch(db, fns, { trigger: "cron", budgetMs: 8_300 });
  assert.ok(r.jobs.some((j: any) => j.status === "deferred"), "some jobs deferred"); assert.ok(r.jobs.some((j: any) => j.status === "completed"));
});

test("a long job keeps its lock by heartbeat; partial work is retried, not counted as done", async () => {
  const job = `t-partial-${run}`;
  const r = await runJob(db, job, "cron", async (_d, c) => { await c.heartbeat(); return { partial: true, left: 3 }; }, { slot: "s" });
  assert.equal(r.status, "partial");
  const [x] = await sql("select status, error from job_runs where job = $1", [job]); assert.equal(x.status, "failed"); assert.match(x.error, /3 item\(s\) left/);
  assert.equal((await runJob(db, job, "cron", async () => ({ done: true }), { slot: "s" })).status, "completed");
  void slotOf; void jobDef;
});
