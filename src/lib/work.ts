// Daily work: tasks, projects and milestones — the rules shared by Today, the task views, project pages and the
// management dashboard (pure functions, also used by the tests).
import type { Rec } from "./store";

export const TASK = "company.tasks", PROJECT = "company.projects", MILESTONE = "company.milestones", DOCUMENT = "company.documents", MEETING = "company.meetings";
export const CLOSED = new Set(["Completed", "Cancelled", "Done"]);
export const MS_CLOSED = new Set(["Reached", "Missed", "Done", "Cancelled"]);
export const PRIORITY_RANK: Record<string, number> = { Critical: 3, High: 2, Normal: 1, Medium: 1, Low: 0 };
export const isOpenTask = (r: Pick<Rec, "status">) => !CLOSED.has(r.status || "");

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const todayIso = (d = new Date()) => d.toISOString().slice(0, 10);
/** Days from today to the date (negative = past); null without a date. */
export const daysTo = (iso: unknown, today = todayIso()) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? Math.round((day(iso) - day(today)) / 864e5) : null);

export const assigneeOf = (r: Rec) => r.data?.assignee_id || null;
export const isMineTask = (r: Rec, me: string) => r.data?.assignee_id === me || (!r.data?.assignee_id && r.created_by === me);

/** Bucket of a task for "My tasks": overdue, today, upcoming, later, done. */
export function taskBucket(r: Rec, today = todayIso()): "overdue" | "today" | "upcoming" | "later" | "done" {
  if (!isOpenTask(r)) return "done";
  const d = daysTo(r.data?.due, today);
  if (d === null) return "later";
  if (d < 0) return "overdue"; if (d === 0) return "today"; if (d <= 7) return "upcoming"; return "later";
}

/** Urgency for sorting: overdue first (the longer the more), then today, then by priority and the nearest deadline. */
export function urgency(r: Rec, today = todayIso()): number {
  if (!isOpenTask(r)) return -1e9;
  const d = daysTo(r.data?.due, today); const p = PRIORITY_RANK[r.data?.priority] ?? 1;
  const waiting = r.status === "Waiting" || r.status === "Review" ? -50 : 0;
  if (d === null) return p * 100 - 400 + waiting;
  if (d < 0) return 10000 + Math.min(-d, 365) * 10 + p * 100 + waiting;
  if (d === 0) return 5000 + p * 100 + waiting;
  return p * 100 + Math.max(0, 300 - d * 10) + waiting;
}
export const byUrgency = (today = todayIso()) => (a: Rec, b: Rec) => urgency(b, today) - urgency(a, today) || String(a.data?.due || "9").localeCompare(String(b.data?.due || "9")) || a.title.localeCompare(b.title);

export type Urgent = { kind: "approval" | "task" | "milestone"; id: string; title: string; why: "overdue" | "today" | "approval" | "critical" | "soon"; days: number | null; rec?: Rec; href: string };
const href = (r: Pick<Rec, "id" | "section">) => `/${r.section.replace(".", "/")}?r=${r.id}`;
/** The three things to look at first after signing in: overdue and due-today work, decisions waiting for me, critical tasks. */
export function topUrgent(tasks: Rec[], approvals: { id: string; record_id: string; section: string; title?: string; created_at: string }[], me: string, today = todayIso(), n = 3): Urgent[] {
  const mine = tasks.filter((t) => t.section === TASK && isOpenTask(t) && isMineTask(t, me)).sort(byUrgency(today));
  const out: Urgent[] = [];
  const push = (u: Urgent) => { if (!out.some((x) => x.id === u.id)) out.push(u); };
  for (const t of mine) { const d = daysTo(t.data?.due, today); if (d !== null && d < 0) push({ kind: "task", id: t.id, title: t.title, why: "overdue", days: d, rec: t, href: href(t) }); }
  for (const a of [...approvals].sort((x, y) => x.created_at.localeCompare(y.created_at))) push({ kind: "approval", id: a.record_id, title: a.title || "—", why: "approval", days: null, href: `/${a.section.replace(".", "/")}?r=${a.record_id}` });
  for (const t of mine) { const d = daysTo(t.data?.due, today); if (d === 0) push({ kind: "task", id: t.id, title: t.title, why: "today", days: 0, rec: t, href: href(t) }); }
  for (const t of mine) if (t.data?.priority === "Critical") push({ kind: "task", id: t.id, title: t.title, why: "critical", days: daysTo(t.data?.due, today), rec: t, href: href(t) });
  for (const t of mine) push({ kind: "task", id: t.id, title: t.title, why: "soon", days: daysTo(t.data?.due, today), rec: t, href: href(t) });
  return out.slice(0, n);
}

export type ProjectStats = { tasks: number; open: number; done: number; overdue: number; review: number; progress: number; nextMilestone: Rec | null; delayed: Rec[]; late: boolean; members: string[]; health: "ok" | "risk" | "late" };
/** Progress and risk of one project from its tasks and milestones. */
export function projectStats(p: Rec, all: Rec[], today = todayIso()): ProjectStats {
  const tasks = all.filter((t) => t.section === TASK && t.data?.project_ref === p.id && t.status !== "Cancelled");
  const ms = all.filter((m) => m.section === MILESTONE && m.data?.project_ref === p.id).sort((a, b) => String(a.data?.due || "9").localeCompare(String(b.data?.due || "9")));
  const done = tasks.filter((t) => !isOpenTask(t)).length; const open = tasks.length - done;
  const overdue = tasks.filter((t) => isOpenTask(t) && (daysTo(t.data?.due, today) ?? 1) < 0).length;
  const delayed = ms.filter((m) => !MS_CLOSED.has(m.status || "") && (daysTo(m.data?.due, today) ?? 1) < 0);
  const nextMilestone = ms.find((m) => !MS_CLOSED.has(m.status || "")) || null;
  const late = !["Completed", "Cancelled"].includes(p.status || "") && (daysTo(p.data?.target, today) ?? 1) < 0;
  const members = [...new Set([p.data?.manager_id, ...(Array.isArray(p.data?.members_ids) ? p.data.members_ids : [])].filter(Boolean))] as string[];
  const health = late || delayed.length ? "late" : overdue ? "risk" : "ok";
  return { tasks: tasks.length, open, done, overdue, review: tasks.filter((t) => t.status === "Review").length, progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0, nextMilestone, delayed, late, members, health };
}

/** Workload per person: open tasks, overdue, awaiting review, due in the next 7 days. */
export function workload(tasks: Rec[], today = todayIso()) {
  const m = new Map<string, { open: number; overdue: number; review: number; week: number; tasks: Rec[] }>();
  for (const t of tasks) {
    if (t.section !== TASK || !isOpenTask(t)) continue;
    const k = t.data?.assignee_id || "—"; const e = m.get(k) || { open: 0, overdue: 0, review: 0, week: 0, tasks: [] };
    const d = daysTo(t.data?.due, today);
    e.open++; if (d !== null && d < 0) e.overdue++; if (t.status === "Review") e.review++; if (d !== null && d >= 0 && d <= 7) e.week++; e.tasks.push(t); m.set(k, e);
  }
  return m;
}

/** Group a list by a key (insertion order kept). */
export function groupBy<T>(xs: T[], k: (x: T) => string) { const m = new Map<string, T[]>(); for (const x of xs) { const key = k(x); m.set(key, [...(m.get(key) || []), x]); } return m; }

/** CSV for the exportable summary (quotes doubled, formulas neutralised). */
export function csv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: unknown) => { let s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
