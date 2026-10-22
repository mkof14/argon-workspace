import { JOBS, isDue, jobDef, missed, type Run } from "@/lib/jobs";
import { reportError } from "./errors";
import { alertAdmins } from "./alerts";

/**
 * Scheduled jobs, run inside the scheduler's own function (no HTTP calls between functions).
 * Every attempt is a row in job_runs: start, finish, duration, error, result, attempt number.
 * job_start refuses a second copy of a running job and a run whose slot already finished, so repeated triggers
 * (Vercel cron, the 15-minute GitHub trigger, a person pressing "Run now") never repeat business work.
 */
export type JobFn = (db: any, ctx: { runId: string; heartbeat: () => Promise<void>; deadline: number }) => Promise<any>;

export async function runJob(db: any, id: string, trigger: string, fn: JobFn, o: { slot?: string | null; budgetMs?: number } = {}) {
  const def = jobDef(id); const slot = o.slot !== undefined ? o.slot : null;
  const { data: st, error } = await db.rpc("job_start", { p_job: id, p_slot: slot, p_trigger: trigger, p_stale_seconds: 600, p_max_attempts: def?.max || 5 });
  if (error) { await reportError(db, `job:${id}`, error); return { job: id, status: "error", error: error.message }; }
  if (!st.started) {
    if (st.new_dead) await alertAdmins(db, { key: `job-dead|${id}|${slot}`, subject: `AGRON Workspace: "${def?.label || id}" stopped trying`, lines: [`The scheduled job failed ${st.reason === "dead" ? "5 times" : ""} for ${slot}.`, "Open Operations, check the error and press Run now after fixing the cause."], repeatDays: 3650 }).catch(() => 0);
    return { job: id, status: "skipped", reason: st.reason };
  }
  const runId = st.id as string; const t0 = Date.now(); const deadline = t0 + (o.budgetMs ?? 50_000);
  const heartbeat = async () => { await db.rpc("job_heartbeat", { p_id: runId }); };
  try {
    const result = await fn(db, { runId, heartbeat, deadline });
    const partial = result && typeof result === "object" && result.partial === true;
    await db.rpc("job_finish", { p_id: runId, p_status: partial ? "failed" : "completed", p_error: partial ? `Not finished in time: ${result.left ?? "?"} item(s) left — continues on the next run` : null, p_result: safeJson(result) });
    return { job: id, status: partial ? "partial" : "completed", ms: Date.now() - t0, result };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 2000);
    await db.rpc("job_finish", { p_id: runId, p_status: "failed", p_error: msg, p_result: null });
    await reportError(db, `job:${id}`, e, { detail: `slot ${slot || "-"} · attempt ${st.attempt}` });
    return { job: id, status: "failed", error: msg, ms: Date.now() - t0 };
  }
}
const safeJson = (x: any) => { try { const s = JSON.stringify(x ?? null); return s.length > 20000 ? { truncated: true, size: s.length } : JSON.parse(s); } catch { return null; } };

/** Recent runs (for due checks, the status screen and missed-run detection). */
export async function recentRuns(db: any, days = 8): Promise<(Run & { id: string; error: string | null; duration_ms: number | null; attempt: number; result: any })[]> {
  const { data } = await db.from("job_runs").select("id,job,slot,status,started_at,finished_at,trigger,error,duration_ms,attempt,result").gte("started_at", new Date(Date.now() - days * 864e5).toISOString()).order("started_at", { ascending: false }).limit(3000);
  return data || [];
}

/**
 * Runs every due job, most important first, within the time budget of one function call. Jobs that do not fit
 * wait for the next trigger; a failed job waits its back-off; a job that failed 5 times for the same slot is
 * dead-lettered and announced to administrators.
 */
export async function dispatch(db: any, fns: Record<string, JobFn>, o: { trigger: string; budgetMs?: number; only?: string[] } = { trigger: "cron" }) {
  const t0 = Date.now(); const budget = o.budgetMs ?? 50_000; const now = new Date();
  const runs = await recentRuns(db, 2);
  const out: any[] = [];
  const order = ["backup", "agents", "retry", "monitor", "intake", "sla", "digest", "executive", "workflow", "calendar", "translate", "trash", "reports"];
  for (const id of order) {
    const def = jobDef(id); if (!def || !fns[id] || (o.only && !o.only.includes(id))) continue;
    const d = isDue(def, now, runs);
    if (!d.due) { out.push({ job: id, status: "not-due", why: d.why }); continue; }
    const left = budget - (Date.now() - t0);
    if (left < 8_000) { out.push({ job: id, status: "deferred" }); continue; }
    out.push(await runJob(db, id, o.trigger, fns[id], { slot: d.slot, budgetMs: left - 3_000 }));
  }
  return { ms: Date.now() - t0, jobs: out };
}

/** What the Operations screen and the monitor need: last run per job, failures, dead slots, missed runs. */
export async function jobHealth(db: any) {
  const runs = await recentRuns(db, 8); const now = new Date();
  const { data: first } = await db.from("job_runs").select("started_at").order("started_at").limit(1);
  const per = JOBS.map((j) => {
    const mine = runs.filter((r) => r.job === j.id);
    const lastOk = mine.find((r) => r.status === "completed");
    return { job: j.id, label: j.label, every: j.every, last: mine[0] || null, last_ok: lastOk ? lastOk.finished_at || lastOk.started_at : null, failures_24h: mine.filter((r) => ["failed", "timeout"].includes(r.status) && now.getTime() - Date.parse(r.started_at) < 864e5).length, dead: mine.filter((r) => r.status === "dead").map((r) => ({ slot: r.slot, error: r.error, at: r.started_at })), due: isDue(j, now, runs) };
  });
  return { jobs: per, missed: missed(now, runs, first?.[0]?.started_at), frequent_trigger: runs.some((r) => r.trigger === "github" && now.getTime() - Date.parse(r.started_at) < 864e5), recent: runs.slice(0, 80) };
}
