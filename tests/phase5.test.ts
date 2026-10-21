// Phase 5 — pure parts: voice parsing and planning (no execution here), management texts for every code the
// database can return, CSV exports and the Weekly Management Review assembled only from the rows given.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameMatches, parseCommand, parseDate, READ_ROUTES } from "../src/lib/voice.ts";
import { ATTENTION_PART, CHANGE_KIND, HEALTH_REASON, LOOP_KIND, NEXT_ACTION, attentionWhy, changeText, decisionsCsv, deadlinesCsv, healthReason, loopText, portfolioCsv, say, weeklyReview, workloadCsv } from "../src/lib/mgmt.ts";

const TODAY = "2026-10-21"; // a Wednesday
const P = (s: string) => parseCommand(s, TODAY);
const SQL = readFileSync(new URL("../supabase/update-v22.sql", import.meta.url), "utf8");

test("voice: every required read command is recognised as READ with a route", () => {
  const cases: [string, string][] = [["show today", "show_today"], ["show attention", "show_attention"], ["show risks", "show_risks"], ["show blocked", "show_blocked"], ["show overdue", "show_overdue"],
    ["show waiting", "show_waiting"], ["show decisions", "show_decisions"], ["show notifications", "show_notifications"], ["покажи просроченное", "show_overdue"], ["что требует внимания", "show_attention"]];
  for (const [s, intent] of cases) { const p = P(s); assert.equal(p.intent, intent, s); assert.equal(p.risk, "read", s); assert.ok(p.route && p.route.startsWith("/"), s); }
  for (const [s, intent, q] of [["open project C20", "open_project", "c20"], ["search project Sprinter", "search_project", "sprinter"], ["search document Platinum agreement", "search_document", "platinum agreement"], ["search person Anton", "search_person", "anton"]] as const) {
    const p = P(s); assert.equal(p.intent, intent, s); assert.equal(p.risk, "read"); assert.equal(p.slots.query, q);
  }
  assert.ok(Object.values(READ_ROUTES).every((r) => !String(r).startsWith("/management")), "read routes work for every internal role (not the managers-only page)");
});

test("voice: Scenario 7 — the task command becomes one structured, material proposal", () => {
  const p = P("Create task for Anton to finish Sprinter specification Friday.");
  assert.equal(p.intent, "create_task"); assert.equal(p.risk, "material");
  assert.deepEqual(p.slots, { title: "finish Sprinter specification", person: "Anton", date: "2026-10-23" });
  assert.deepEqual(p.missing, []);
  const ru = P("Создай задачу Антону закончить Sprinter specification в пятницу.");
  assert.equal(ru.intent, "create_task"); assert.equal(ru.slots.date, "2026-10-23"); assert.equal(ru.slots.title, "закончить Sprinter specification"); assert.ok(nameMatches(ru.slots.person!, "Anton Petrov"));
});

test("voice: Scenario 8 — an ambiguous command is never complete", () => {
  const p = P("Move the deadline.");
  assert.equal(p.intent, "change_due_date"); assert.deepEqual(p.missing.sort(), ["date", "task"]);
  assert.equal(P("").intent, "unknown"); assert.equal(P("hmm maybe later").intent, "unknown");
});

test("voice: writes, reminders, notes and controlled actions", () => {
  assert.deepEqual([P("Assign task radar quotation to Anton").intent, P("Assign task radar quotation to Anton").slots.task], ["assign_task", "radar quotation"]);
  const due = P("Change due date of radar quotation to next Monday"); assert.equal(due.intent, "change_due_date"); assert.equal(due.slots.date, "2026-10-26"); assert.equal(due.slots.task, "radar quotation");
  assert.equal(P("Complete task radar quotation").intent, "complete_task");
  const rem = P("Напомни мне завтра проверить документы Platinum."); assert.equal(rem.intent, "create_reminder"); assert.equal(rem.risk, "low"); assert.equal(rem.slots.date, "2026-10-22"); assert.equal(rem.slots.title, "проверить документы Platinum");
  const rem2 = P("Create reminder to call supplier tomorrow"); assert.equal(rem2.intent, "create_reminder"); assert.equal(rem2.slots.title, "call supplier");
  const note = P("Запиши: надо обсудить производство C20 в NJ."); assert.equal(note.intent, "note"); assert.equal(note.slots.title, "надо обсудить производство C20 в NJ");
  for (const s of ["approve the C20 drawing", "delete project C20", "send email to the supplier", "grant access to Anton"]) { const p = P(s); assert.equal(p.intent, "controlled", s); assert.equal(p.risk, "controlled", s); }
});

test("voice: dates relative to today", () => {
  assert.equal(parseDate("tomorrow", TODAY)?.date, "2026-10-22");
  assert.equal(parseDate("Friday", TODAY)?.date, "2026-10-23");
  assert.equal(parseDate("в пятницу", TODAY)?.date, "2026-10-23");
  assert.equal(parseDate("next Monday", TODAY)?.date, "2026-10-26");
  assert.equal(parseDate("no date here", TODAY), null);
});

test("voice: people are matched across scripts, never by a fragment", () => {
  assert.ok(nameMatches("Anton", "Anton Petrov")); assert.ok(nameMatches("Антону", "Anton Petrov")); assert.ok(nameMatches("Антон", "Anton Petrov"));
  assert.ok(!nameMatches("An", "Anton Petrov")); assert.ok(!nameMatches("Boris", "Anton Petrov"));
});

const codesIn = (re: RegExp, src = SQL) => [...new Set([...src.matchAll(re)].map((m) => m[1]))];
const fn = (name: string) => SQL.slice(SQL.indexOf(`create or replace function public.${name}(`), SQL.indexOf("end $$;", SQL.indexOf(`create or replace function public.${name}(`)));
test("texts: every health reason, open-loop kind, next action, attention part and change kind the database returns has words in 4 languages", () => {
  const health = codesIn(/\(\s*'([a-z_]+)', case when b\./g);
  const ol = fn("_open_loops");
  const loops = codesIn(/select (?:distinct on \(a\.chain_id\) )?'([a-z_]+)',? (?:kind, )?'(?:task|project|decision|approval|document|meeting)'/g, ol);
  const next = codesIn(/jsonb_build_object\('code', '[a-z_]+'(?:[^()]|\([^()]*\))*\),\s*'([a-z_]+)'/g, ol).concat(codesIn(/when [^']*'([a-z_]+)'(?= when| else)/g, fn("_attention").slice(fn("_attention").indexOf("'project_health:'"), fn("_attention").indexOf("public.mgmt_link('company.projects'"))), ["review_project"]);
  const pb = SQL.slice(SQL.indexOf("('severity', (sw->>s.sev)"), SQL.indexOf(") x(code, pts, n)"));
  const parts = [...new Set([...pb.matchAll(/^\s*\('([a-z_]+)', /gm)].map((m) => m[1]))];
  const changes = codesIn(/select '([a-z_]+)' k, a\.created_at/g).concat(codesIn(/union all select '([a-z_]+)', (?:a\.created_at|max\(a\.created_at\)|ap\.decided_at|\(public\.mgmt_date|now\(\))/g));
  assert.ok(health.length >= 17, `health codes found: ${health}`); assert.ok(loops.length >= 25, `loop kinds found: ${loops}`); assert.ok(parts.length >= 9, `${parts}`); assert.ok(changes.length >= 12, `${changes}`);
  for (const [map, codes, what] of [[HEALTH_REASON, health, "health"], [LOOP_KIND, loops, "loop"], [NEXT_ACTION, next, "next action"], [ATTENTION_PART, parts, "attention"], [CHANGE_KIND, changes, "change"]] as const)
    for (const c of codes) { const t = (map as any)[c]; assert.ok(t, `${what} ${c} has no text`); for (const l of ["en", "ru", "uk", "ar"]) assert.ok(t[l]?.length, `${what} ${c} ${l}`); }
  for (const c of ["assign_owner", "resolve_blocker", "review_approval", "follow_up", "review_milestone", "complete_approval", "review_project"]) assert.ok(NEXT_ACTION[c], c);
});

test("texts: reasons carry the numbers of their row", () => {
  assert.equal(healthReason({ code: "overdue_tasks", n: 3, penalty: 14 }, "en"), "3 overdue tasks");
  assert.equal(healthReason({ code: "approvals_waiting", n: 2, days: 3, max: 6 }, "en"), "2 approvals waiting more than 3 days (longest 6)");
  assert.equal(healthReason({ code: "milestone_soon", n: 5, title: "Electrical integration" }, "ru"), "Следующая веха «Electrical integration» через 5 дн.");
  assert.equal(loopText({ kind: "task_overdue", reason: { days: 4 } }, "en"), "Overdue task (4 days)");
  assert.equal(changeText({ kind: "health_changed", detail: { from: "attention", to: "risk" } }, "en"), "Health Attention → Risk");
  assert.equal(say(undefined, "en"), "");
  const why = attentionWhy({ kind: "task_blocked", why: { reason: { code: "task_blocked" }, parts: [{ code: "severity", points: 25 }, { code: "deadline", points: 15, n: 2 }, { code: "downstream", points: 10, n: 2 }] } }, "en");
  assert.deepEqual(why, ["Blocked task", "deadline 2 days", "blocks 2 other tasks"]);
  assert.deepEqual(attentionWhy({ kind: "task_overdue", why: { reason: { code: "task_overdue", days: 3 }, parts: [{ code: "deadline", points: 16, n: -3 }] } }, "en"), ["Overdue task (3 days)", "deadline 3 days ago"]);
});

test("reports: CSV rows equal the rows given; workload has counts only", () => {
  const health = [{ project_id: "p1", title: "C20", status: "Active", level: "risk", score: 58, progress: 40, progress_basis: "tasks", manager_id: "u1", target: "2026-12-01", blocked: 1, overdue: 3, next_milestone: { title: "EI", due: "2026-10-26" }, reasons: [{ code: "overdue_tasks", n: 3 }], portfolio_name: "Product" },
    { project_id: "p2", title: "Sprinter", status: "Active", level: "healthy", score: 100, progress: null, progress_basis: "none", manager_id: null, target: null, blocked: 0, overdue: 0, next_milestone: null, reasons: [] }];
  const csv = portfolioCsv(health, (id) => (id === "u1" ? "Anton" : ""), "en").split("\n");
  assert.equal(csv.length, 3); assert.match(csv[1], /^Product,C20,Anton,Active,Risk,58,40,tasks,EI,2026-10-26,2026-12-01,1,3,3 overdue tasks,/);
  const wl = workloadCsv([{ name: "Anton", department: "Engineering", open_tasks: 5, overdue_tasks: 1, blocked_tasks: 0, projects: [{ title: "C20" }], upcoming_14: 2 }]).split("\n");
  assert.equal(wl[0], "Person,Department,Active tasks,Overdue,Blocked,Projects,Upcoming deadlines (14 days)"); assert.equal(wl[1], "Anton,Engineering,5,1,0,C20,2");
  assert.ok(!/score|productiv|rating/i.test(wl[0]));
  const d = deadlinesCsv([{ kind: "task", title: "A", days: -2, due: "2026-10-19", link: "/x" }, { kind: "milestone", title: "B", days: 5, due: "2026-10-26", link: "/y" }, { kind: "project", title: "C", days: 20, due: "2026-11-10", link: "/z" }], "en").split("\n");
  assert.deepEqual(d.slice(1).map((l) => l.split(",")[0]), ["Overdue", "Next 7 days", "Next 30 days"]);
  const x = decisionsCsv([{ title: "Go", status: "Proposed", date: "2026-10-01", age_days: 20, link: "/d" }, { title: "No", status: "Approved", date: "2026-09-01", age_days: 50, link: "/e" }, { title: "Later", status: "Deferred", date: "2026-09-01", age_days: 50, link: "/f" }]).split("\n");
  assert.deepEqual(x.slice(1).map((l) => l.split(",")[3]), ["Pending", "Decided", "Deferred"]);
  assert.match(portfolioCsv([{ ...health[0], title: 'He said "x", ok' }], () => "", "en").split("\n")[1], /"He said ""x"", ok"/);
});

test("review: nine sections, built only from the given rows", () => {
  const r = weeklyReview({ overview: { indicators: { active_projects: 2, overdue_work: 3, blocked_work: 1, pending_decisions: 1, pending_approvals: 0, open_loops: 4 } },
    health: [{ project_id: "p1", title: "C20", level: "risk", score: 58, reasons: [{ code: "overdue_tasks", n: 3 }] }, { project_id: "p2", title: "Sprinter", level: "healthy", score: 100, reasons: [] }],
    attention: [{ title: "C20", kind: "project_health", severity: "high", attention_score: 70, why: { reason: { code: "project_risk", score: 58, reasons: [] }, parts: [] }, link: "/projects/p1" }],
    loops: [{ category: "decision", kind: "decision_pending", title: "Supplier", link: "/d" }], waiting: [{ bucket: "others", party_name: "Anton", title: "Spec", escalation: "aging", age_days: 6, link: "/t" }],
    deadlines: [{ kind: "milestone", title: "EI", due: "2026-10-26", days: 5, link: "/m" }], changes: [{ kind: "tasks_completed", detail: { n: 7 }, project_title: "AGRON 1", title: "AGRON 1", link: "/projects/a" }, { kind: "health_changed", detail: { from: "attention", to: "risk" }, project_title: "C20", title: "C20", link: "/projects/p1" }], sinceLabel: "" }, "en");
  assert.equal(r.sections.length, 9);
  assert.deepEqual(r.sections.map((s) => s.key), ["summary", "health", "critical", "decisions", "waiting", "deadlines", "changes", "completed", "next"]);
  assert.match(r.sections[0].lines[0].text, /2 active projects: 1 healthy, 0 attention, 1 at risk, 0 critical/);
  assert.equal(r.sections[6].lines[0].text, "C20: Health Attention → Risk"); assert.equal(r.sections[7].lines[0].text, "AGRON 1: 7 tasks completed");
  assert.ok(r.sections.every((s) => s.lines.length > 0));
  for (const s of r.sections) for (const l of s.lines) if (l.link) assert.ok(l.link.startsWith("/"));
});
