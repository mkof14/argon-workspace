// Phase 2 pure rules: urgency and the three things to do first, task buckets, project progress and risk,
// workload, CSV export safety, the navigation set and the field types.
import { test } from "node:test";
import assert from "node:assert/strict";
import { byUrgency, csv, daysTo, projectStats, taskBucket, topUrgent, workload } from "../src/lib/work.ts";
import { DEPARTMENTS, ORG_DEPTS, TASK_STATUSES, TASK_PRIORITY, allSections } from "../src/config/workspace.config.mjs";
import { APPROVALS } from "../src/config/approvals.ts";

const T = "2026-10-20";
const task = (id: string, o: any = {}) => ({ id, section: "company.tasks", title: id, status: o.status || "New", data: { assignee_id: "me", ...o.data }, company: null, controlled: false, created_by: o.by || "boss" }) as any;

test("days and buckets", () => {
  assert.equal(daysTo("2026-10-21", T), 1); assert.equal(daysTo("2026-10-18", T), -2); assert.equal(daysTo("", T), null);
  assert.equal(taskBucket(task("a", { data: { due: "2026-10-19" } }), T), "overdue");
  assert.equal(taskBucket(task("b", { data: { due: T } }), T), "today");
  assert.equal(taskBucket(task("c", { data: { due: "2026-10-25" } }), T), "upcoming");
  assert.equal(taskBucket(task("d"), T), "later");
  assert.equal(taskBucket(task("e", { status: "Completed", data: { due: "2026-10-01" } }), T), "done");
});

test("urgency: overdue first (longest first), then today, then priority and the nearest date", () => {
  const xs = [task("later-low", { data: { due: "2026-11-30", priority: "Low" } }), task("today", { data: { due: T } }), task("late1", { data: { due: "2026-10-19" } }), task("late5", { data: { due: "2026-10-15" } }), task("crit", { data: { due: "2026-10-27", priority: "Critical" } }), task("done", { status: "Completed", data: { due: "2026-10-01" } })];
  assert.deepEqual([...xs].sort(byUrgency(T)).map((x) => x.id), ["late5", "late1", "today", "crit", "later-low", "done"]);
});

test("the three most urgent: overdue, then approvals waiting for me, then due today", () => {
  const tasks = [task("t-today", { data: { due: T } }), task("t-late", { data: { due: "2026-10-10" } }), task("other", { data: { assignee_id: "you", due: "2026-10-01" } }), task("t-crit", { data: { priority: "Critical" } })];
  const appr = [{ id: "a1", record_id: "r1", section: "finance.expenses", title: "Laptop", created_at: "2026-10-19T10:00:00Z" }];
  const top = topUrgent(tasks, appr, "me", T);
  assert.deepEqual(top.map((u) => `${u.why}:${u.id}`), ["overdue:t-late", "approval:r1", "today:t-today"]);
  assert.ok(!top.some((u) => u.id === "other"), "someone else's task is not mine");
  assert.equal(topUrgent([], [], "me", T).length, 0);
});

test("project progress, overdue work, delayed milestones and health", () => {
  const p = { id: "p", section: "company.projects", title: "C40", status: "Active", data: { target: "2026-12-01", manager_id: "m", members_ids: ["a", "b", "m"] } } as any;
  const all = [p, task("1", { status: "Completed", data: { project_ref: "p" } }), task("2", { data: { project_ref: "p", due: "2026-10-01" } }), task("3", { status: "Review", data: { project_ref: "p" } }), task("x", { status: "Cancelled", data: { project_ref: "p" } }),
    { id: "m1", section: "company.milestones", title: "FAT", status: "Planned", data: { project_ref: "p", due: "2026-10-10" } }, { id: "m2", section: "company.milestones", title: "Ship", status: "Planned", data: { project_ref: "p", due: "2026-11-10" } }] as any[];
  const s = projectStats(p, all, T);
  assert.deepEqual([s.tasks, s.done, s.open, s.overdue, s.review, s.progress], [3, 1, 2, 1, 1, 33]);
  assert.deepEqual(s.delayed.map((m) => m.id), ["m1"]); assert.equal(s.nextMilestone?.id, "m1"); assert.equal(s.health, "late");
  assert.deepEqual(s.members.sort(), ["a", "b", "m"]);
  const ok = projectStats({ ...p, id: "q" }, [], T); assert.equal(ok.health, "ok"); assert.equal(ok.progress, 0);
});

test("workload per person", () => {
  const w = workload([task("1", { data: { due: "2026-10-01" } }), task("2", { status: "Review", data: { due: "2026-10-22" } }), task("3", { data: { assignee_id: "you" } }), task("4", { status: "Completed" })], T);
  assert.deepEqual({ ...w.get("me"), tasks: undefined }, { open: 2, overdue: 1, review: 1, week: 1, tasks: undefined });
  assert.equal(w.get("you")?.open, 1);
});

test("CSV export: quotes, separators and formula injection", () => {
  assert.equal(csv([["a,b", 'say "hi"', "=SUM(A1)", null, 3]]), '"a,b","say ""hi""",\'=SUM(A1),,3');
});

test("task, project, milestone and document sections are configured with the Phase 2 fields", () => {
  const S = allSections() as any[]; const sec = (id: string) => S.find((s) => s.id === id);
  const t = sec("company.tasks"); assert.deepEqual(t.statuses, TASK_STATUSES); assert.deepEqual(TASK_PRIORITY, ["Low", "Normal", "High", "Critical"]);
  for (const [k, type] of [["assignee", "person"], ["project_ref", "ref"], ["department", "dept"], ["description", "rich"], ["due", "date"], ["start", "date"], ["completed_at", "date"]]) assert.equal(t.fields.find((f: any) => f.key === k)?.type, type, k);
  assert.equal(sec("company.projects").fields.find((f: any) => f.key === "members")?.type, "people");
  assert.equal(sec("company.milestones").fields.find((f: any) => f.key === "project_ref")?.ref, "company.projects");
  assert.ok(sec("company.documents").fields.find((f: any) => f.key === "doc_type").options.includes("NDA"));
  assert.ok(APPROVALS["company.documents"].changes === "Changes requested", "Phase 4: changes requested is its own state");
  assert.equal(new Set(ORG_DEPTS.map((d: any) => d.key)).size, ORG_DEPTS.length);
  for (const d of ORG_DEPTS as any[]) for (const l of ["en", "ru", "uk", "ar"]) assert.ok(d.label[l], `${d.key} ${l}`);
  assert.ok(DEPARTMENTS.length > 5);
});
