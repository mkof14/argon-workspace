// Scheduled jobs: what runs when, which run ("slot") a moment belongs to, when a failed run is tried again,
// and when a job counts as missed. Pure — the server side (lib/server/jobs.ts) stores the runs in job_runs.

export type Every = "15m" | "hour" | "day" | "month";
export type JobDef = { id: string; every: Every; at?: number; max?: number; label: string };
export type Run = { job: string; slot: string | null; status: "running" | "completed" | "failed" | "timeout" | "dead"; started_at: string; finished_at?: string | null; trigger?: string };

/** at = minute of the UTC day from which a daily / monthly job is due (10:00 UTC = 600). */
export const JOBS: JobDef[] = [
  { id: "retry", every: "15m", label: "Automation retries and delivery checks" },
  { id: "intake", every: "15m", label: "E-mail intake" },
  { id: "sla", every: "15m", label: "Service SLA alerts" },
  { id: "calendar", every: "15m", label: "Google Calendar sync" },
  { id: "notify", every: "15m", label: "Notifications by e-mail and phone" },
  { id: "announce", every: "15m", label: "Scheduled announcements" },
  { id: "workflow", every: "15m", label: "Process deadlines, escalations and automatic-step retries" },
  { id: "digest", every: "hour", label: "Morning digest (8:00 local time)" },
  { id: "translate", every: "hour", label: "Translation of new texts" },
  { id: "executive", every: "hour", label: "Management alerts and daily snapshots" },
  { id: "commercial", every: "hour", label: "Commercial follow-ups, decisions, stalled opportunities, proposals and meetings" },
  { id: "manufacturing", every: "hour", label: "Manufacturing notices: work assigned or overdue, units late or blocked, shortages, late purchases, inspections, change decisions, ready for acceptance" },
  { id: "due", every: "day", at: 480, label: "Deadline reminders (due soon, overdue)" },
  { id: "backup", every: "day", at: 540, label: "Encrypted backup" },
  { id: "agents", every: "day", at: 600, label: "Agents" },
  { id: "monitor", every: "day", at: 600, label: "Monitoring" },
  { id: "trash", every: "day", at: 600, label: "Recycle bin and housekeeping" },
  { id: "reports", every: "month", at: 600, label: "Monthly department reports" },
];
export const jobDef = (id: string) => JOBS.find((j) => j.id === id);
const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** The run a moment belongs to. Daily jobs before their hour belong to yesterday's run. */
export function slotOf(j: JobDef, now: Date): string {
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (j.every === "15m") return `${day(now)}T${pad(now.getUTCHours())}:${pad(Math.floor(now.getUTCMinutes() / 15) * 15)}`;
  if (j.every === "hour") return `${day(now)}T${pad(now.getUTCHours())}`;
  if (j.every === "day") return mins >= (j.at || 0) ? day(now) : day(new Date(now.getTime() - 864e5));
  // month: due from the 1st at `at`
  const before = now.getUTCDate() === 1 && mins < (j.at || 0);
  const m = before ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)) : now;
  return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}`;
}

/** Minutes to wait after the n-th failure of the same run: 2, 4, 8, 16, 32, then 60. */
export const backoffMin = (n: number) => Math.min(60, 2 * 2 ** Math.max(0, n - 1));

/** Should this job start now? `runs` = recent runs of this job (any order). */
export function isDue(j: JobDef, now: Date, runs: Run[], staleMin = 10): { due: boolean; slot: string; why: string } {
  const slot = slotOf(j, now); const mine = runs.filter((r) => r.job === j.id && r.slot === slot);
  if (mine.some((r) => r.status === "completed")) return { due: false, slot, why: "done" };
  if (mine.some((r) => r.status === "dead")) return { due: false, slot, why: "dead" };
  if (runs.some((r) => r.job === j.id && r.status === "running" && now.getTime() - Date.parse(r.started_at) < staleMin * 60e3)) return { due: false, slot, why: "running" };
  const failed = mine.filter((r) => r.status === "failed" || r.status === "timeout").sort((a, b) => Date.parse(b.finished_at || b.started_at) - Date.parse(a.finished_at || a.started_at));
  if (failed.length) {
    const wait = backoffMin(failed.length) * 60e3; const last = Date.parse(failed[0].finished_at || failed[0].started_at);
    if (now.getTime() < last + wait) return { due: false, slot, why: "backoff" };
  }
  return { due: true, slot, why: failed.length ? "retry" : "new" };
}

const PERIOD: Record<Every, number> = { "15m": 15, hour: 60, day: 1440, month: 44640 };
/**
 * Jobs that did not finish when they should have. Frequent jobs (every 15 minutes / every hour) depend on the
 * 15-minute trigger; when it has not been seen in the last day they are expected only daily.
 */
export function missed(now: Date, runs: Run[], since?: string): { job: string; label: string; last: string | null; overdueMin: number }[] {
  const frequentTrigger = runs.some((r) => r.trigger === "github" && now.getTime() - Date.parse(r.started_at) < 864e5);
  const out: { job: string; label: string; last: string | null; overdueMin: number }[] = [];
  for (const j of JOBS) {
    const ok = runs.filter((r) => r.job === j.id && r.status === "completed").map((r) => Date.parse(r.finished_at || r.started_at)).sort((a, b) => b - a)[0];
    const period = j.every === "15m" || j.every === "hour" ? (frequentTrigger ? PERIOD[j.every] : 1440) : PERIOD[j.every];
    const grace = j.every === "day" || j.every === "month" ? 180 : 45;
    const from = ok ?? (since ? Date.parse(since) : null); if (from == null) continue;
    const late = (now.getTime() - from) / 60e3 - period - grace;
    if (late > 0) out.push({ job: j.id, label: j.label, last: ok ? new Date(ok).toISOString() : null, overdueMin: Math.round(late) });
  }
  return out;
}
