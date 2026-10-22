// Phase 5 performance on the isolated stack at the required volume — at least 100 people, 250 projects, 10,000
// tasks, 2,000 decisions, 2,000 approvals, 10,000 comments, 5,000 documents / articles and 100,000 activity rows
// (added on top of whatever the stack already holds). Every number is measured here through the API with a
// signed-in person (row-level security and the engines' own visibility on): median, p95 and max of repeated calls.
// Results: .stack/p5-perf.json. Nothing is estimated.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENV, makeUser, signIn, sql, uid } from "./_stack.ts";
import { retrieve } from "../../src/lib/server/retrieval.ts";

const run = uid(); const N = { users: 100, portfolios: 8, projects: 250, tasks: 10000, milestones: 1000, decisions: 2000, approvals: 2000, comments: 10000, docs: 2500, articles: 2500, activity: 100000 };
const R: Record<string, any> = { volume: {}, timings: {} };
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)]); return { median: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1]), n: s.length }; };
let M: any, E: any, mgmt: any, emp: any, onePid = "";
async function time(n: number, f: () => Promise<any>) { const out: number[] = []; for (let i = 0; i < n + 1; i++) { const t = performance.now(); const r = await f(); if (r?.error) throw new Error(r.error.message); if (i) out.push(performance.now() - t); } return stats(out); } // the first call warms the cache and is not counted

before(async () => {
  const t0 = Date.now();
  // P5PERF_REUSE=1: measure again on the volume an earlier run loaded (the counts below are still checked)
  const prev = ENV.P5PERF_REUSE ? (await sql("select email, id from profiles where email like 'p5perf0-%' order by created_at desc limit 1"))[0] : null;
  if (prev) {
    const run0 = prev.email.replace(/^p5perf0-|@agron-stack\.test$/g, "");
    mgmt = { id: prev.id, email: prev.email }; emp = (await sql("select id, email from profiles where email = $1", [`p5perf7-${run0}@agron-stack.test`]))[0];
    onePid = (await sql("select id from records where section = 'company.projects' and title = $1", [`P5 project 13 ${run0}`]))[0].id;
  } else await load();
  M = (await signIn(mgmt.email)).c; E = (await signIn(emp.email)).c;
  const vol = (await sql(`select (select count(*) from profiles)::int people, (select count(*) from records where section = 'company.projects')::int projects, (select count(*) from records where section = 'company.tasks')::int tasks,
    (select count(*) from records where section = 'company.decisions')::int decisions, (select count(*) from approvals)::int approvals, (select count(*) from comments)::int comments,
    (select count(*) from records where section in ('company.documents', 'company.wiki'))::int docs_articles, (select count(*) from activity)::int activity, (select count(*) from records where section = 'company.milestones')::int milestones`))[0];
  R.volume = { ...vol, added: prev ? "reused" : N, seconds_to_load: Math.round((Date.now() - t0) / 1000) };
  for (const [k, n] of [["people", 100], ["projects", 250], ["tasks", 10000], ["decisions", 2000], ["approvals", 2000], ["comments", 10000], ["docs_articles", 5000], ["activity", 100000]] as const) assert.ok(vol[k] >= n, `${k} ${vol[k]}`);
});

async function load() {
  const roles = ["engineering", "operations", "finance", "sales", "legal"]; const people: any[] = [];
  for (let i = 0; i < N.users; i++) people.push(await makeUser(`p5perf${i}-${run}@agron-stack.test`, i === 0 ? "management" : roles[i % roles.length], { us: i % 7 !== 0, name: `P5 Perf ${i} ${run}` }));
  const ids = people.map((p) => p.id); mgmt = people[0]; emp = people[7]; // emp: a non-US engineer
  await sql("update profiles set timezone = (array['America/New_York','Asia/Dubai','Europe/Kyiv'])[1 + (abs(hashtext(id::text)) % 3)], availability = (array['available','busy','away'])[1 + (abs(hashtext(id::text)) % 3)] where email like $1", [`p5perf%-${run}@agron-stack.test`]);
  const pf = (await sql(`insert into records(section, title, status, data, created_by) select 'company.portfolios', 'P5 portfolio ' || g || ' ${run}', 'Active', jsonb_build_object('owner_id', ($1::uuid[])[1]), ($1::uuid[])[1] from generate_series(1, ${N.portfolios}) g returning id`, [ids])).map((r: any) => r.id);
  const projects = (await sql(`insert into records(section, title, status, controlled, data, created_by, created_at)
      select 'company.projects', 'P5 project ' || g || ' ${run}', (array['Active','Active','Active','Planned','On hold','Completed'])[1 + g % 6], g % 11 = 0,
        jsonb_build_object('manager_id', case when g % 17 = 0 then null else ($1::uuid[])[1 + g % $2] end, 'members_ids', to_jsonb(array[($1::uuid[])[1 + (g + 3) % $2], ($1::uuid[])[1 + (g + 5) % $2]]::text[]),
          'portfolio_ref', case when g % 5 = 0 then null else ($3::uuid[])[1 + g % ${N.portfolios}] end, 'priority', (array['Normal','High','Critical','Low'])[1 + g % 4], 'target', to_char(current_date + (g % 120) - 30, 'YYYY-MM-DD')),
        ($1::uuid[])[1], now() - make_interval(days => g % 40)
      from generate_series(1, ${N.projects}) g returning id`, [ids, ids.length, pf])).map((r: any) => r.id);
  onePid = projects[12];
  const tasks = (await sql(`insert into records(section, title, status, controlled, data, created_by, updated_at)
      select 'company.tasks', 'P5 task ' || g || ' ${run}', (array['New','In progress','In progress','Blocked','Waiting','Review','Completed','Completed','Cancelled'])[1 + g % 9], g % 23 = 0,
        jsonb_build_object('project_ref', ($3::uuid[])[1 + g % ${N.projects}], 'assignee_id', case when g % 31 = 0 then null else ($1::uuid[])[1 + g % $2] end,
          'requested_by', ($1::uuid[])[1 + (g * 7) % $2], 'due', case when g % 13 = 0 then null else to_char(current_date + (g % 90) - 30, 'YYYY-MM-DD') end,
          'priority', (array['Normal','Normal','High','Critical','Low'])[1 + g % 5], 'waiting_kind', case when g % 9 = 4 then (array['Supplier','Partner','Colleague'])[1 + g % 3] end, 'waiting_on', case when g % 9 = 4 then 'Vendor ' || g end),
        ($1::uuid[])[1 + g % $2], now() - make_interval(days => g % 25)
      from generate_series(1, ${N.tasks}) g returning id`, [ids, ids.length, projects])).map((r: any) => r.id);
  await sql(`update records set data = data || jsonb_build_object('blocked_by', ($1::uuid[])[1 + (abs(hashtext(id::text)) % 10000)]) where section = 'company.tasks' and title like $2 and abs(hashtext(id::text)) % 20 = 0`, [tasks, `P5 task % ${run}`]);
  await sql(`insert into records(section, title, status, data, created_by)
      select 'company.milestones', 'P5 milestone ' || g || ' ${run}', (array['Planned','In progress','Reached','Missed'])[1 + g % 4],
        jsonb_build_object('project_ref', ($2::uuid[])[1 + g % ${N.projects}], 'due', to_char(current_date + (g % 100) - 30, 'YYYY-MM-DD'), 'owner_id', case when g % 7 = 0 then null else ($1::uuid[])[1 + g % 100] end), ($1::uuid[])[1]
      from generate_series(1, ${N.milestones}) g`, [ids, projects]);
  await sql(`insert into records(section, title, status, data, created_by, created_at)
      select 'company.decisions', 'P5 decision ' || g || ' ${run}', (array['Proposed','In review','Deferred','Approved','Rejected'])[1 + g % 5],
        jsonb_build_object('project_ref', ($2::uuid[])[1 + g % ${N.projects}], 'date', to_char(current_date - (g % 60), 'YYYY-MM-DD'), 'responsible_id', ($1::uuid[])[1 + g % 100], 'reconsider', case when g % 5 = 2 then to_char(current_date - (g % 5), 'YYYY-MM-DD') end),
        ($1::uuid[])[1 + g % 100], now() - make_interval(days => g % 60)
      from generate_series(1, ${N.decisions}) g`, [ids, projects]);
  await sql(`insert into records(section, title, status, controlled, data, created_by)
      select 'company.documents', 'P5 doc ' || g || ' ${run}', (array['Draft','In review','Approved','Effective','Archived'])[1 + g % 5], g % 9 = 0,
        jsonb_build_object('doc_type', 'Procedure', 'project_ref', ($2::uuid[])[1 + g % ${N.projects}], 'owner_id', ($1::uuid[])[1 + g % 100], 'reviewer_id', ($1::uuid[])[1 + (g + 1) % 100],
          'classification', case when g % 9 = 0 then 'US Persons Only' when g % 23 = 0 then 'Restricted' else 'Internal' end, 'expiration_date', case when g % 10 = 3 then to_char(current_date + (g % 40), 'YYYY-MM-DD') end), ($1::uuid[])[1 + g % 100]
      from generate_series(1, ${N.docs}) g`, [ids, projects]);
  await sql(`insert into records(section, title, status, data, created_by) select 'company.wiki', 'P5 article ' || g || ' ${run}', 'Published', jsonb_build_object('summary', 'How to ' || g), ($1::uuid[])[1] from generate_series(1, ${N.articles}) g`, [ids]);
  await sql(`insert into approvals(record_id, section, requested_by, approver_id, status, created_at, decided_at)
      select ($1::uuid[])[1 + (g * 3) % ${N.tasks}], 'company.tasks', ($2::uuid[])[1 + g % 100], ($2::uuid[])[1 + (g + 11) % 100], case when g % 3 = 0 then 'pending' else 'approved' end, now() - make_interval(days => g % 20), case when g % 3 = 0 then null else now() - make_interval(days => g % 5) end
      from generate_series(1, ${N.approvals}) g`, [tasks, ids]);
  await sql(`insert into comments(record_id, body, author, created_at) select ($1::uuid[])[1 + g % ${N.tasks}], 'P5 comment ' || g, ($2::uuid[])[1 + g % 100], now() - make_interval(hours => g % 500) from generate_series(1, ${N.comments}) g`, [tasks, ids]);
  await sql(`insert into activity(record_id, section, actor, action, detail, created_at)
      select ($1::uuid[])[1 + g % ${N.tasks}], 'company.tasks', ($2::uuid[])[1 + g % 100], (array['updated','status','status','owner_changed','deadline_changed'])[1 + g % 5],
        case when g % 5 in (1, 2) then jsonb_build_object('from', 'In progress', 'to', (array['Completed','Blocked','Review'])[1 + g % 3]) when g % 5 = 4 then jsonb_build_object('field', 'due', 'from', '2026-10-01', 'to', '2026-11-01') else jsonb_build_object('field', 'assignee_id') end,
        now() - make_interval(mins => g % 20000)
      from generate_series(1, ${N.activity}) g`, [tasks, ids]);
  await sql("vacuum (analyze) records"); await sql("vacuum (analyze) activity"); await sql("vacuum (analyze) approvals"); await sql("vacuum (analyze) comments") /* steady state after the bulk load: no autovacuum racing the timings */;
}

test("management views at volume: p95 under 1 s (normal views) and under 3 s (heavy reports), through the API with row-level security", async () => {
  const views: [string, () => Promise<any>, number, "normal" | "heavy"][] = [
    ["Executive overview (management)", () => M.rpc("exec_overview"), 15, "normal"],
    ["Executive overview (non-US engineer)", () => E.rpc("exec_overview"), 15, "normal"],
    ["Portfolio", () => M.rpc("portfolio_overview"), 15, "normal"],
    ["Project health — all projects", () => M.rpc("project_health", { p_project: null }), 15, "normal"],
    ["Project health — one project (Advisor)", () => M.rpc("project_health", { p_project: onePid }), 20, "normal"],
    ["Open loops — one project (Advisor)", () => M.rpc("open_loops", { p_project: onePid }), 20, "normal"],
    ["Open loops — company", () => M.rpc("open_loops", { p_project: null }), 15, "normal"],
    ["Waiting For", () => M.rpc("waiting_for"), 15, "normal"],
    ["Attention (50)", () => M.rpc("attention_items", { p_limit: 50 }), 15, "normal"],
    ["Deadlines 30 days", () => M.rpc("mgmt_deadlines", { p_days: 30 }), 15, "normal"],
    ["Team Status", () => M.rpc("team_status"), 15, "normal"],
    ["Changes — since yesterday", () => M.rpc("management_changes", { p_window: "day" }), 15, "normal"],
    ["Changes — 7 days (report)", () => M.rpc("management_changes", { p_window: "week" }), 10, "heavy"],
    ["Decision report", () => M.rpc("mgmt_decisions_report"), 10, "heavy"],
    ["Weekly Management Review (all its queries)", () => Promise.all([M.rpc("exec_overview"), M.rpc("project_health", { p_project: null }), M.rpc("attention_items", { p_limit: 50 }), M.rpc("open_loops", { p_project: null }), M.rpc("waiting_for"), M.rpc("mgmt_deadlines", { p_days: 30 }), M.rpc("management_changes", { p_window: "review" })]).then((rs) => rs.find((r) => r.error) || null), 8, "heavy"],
    ["Assistant retrieval — “What needs my attention?”", () => retrieve(M, { id: mgmt.id, role: "management" }, { q: "What needs my attention?" }), 10, "normal"],
    ["Assistant retrieval — “Prepare my management review”", () => retrieve(M, { id: mgmt.id, role: "management" }, { q: "Prepare my management review" }), 6, "heavy"],
  ];
  const fails: string[] = [];
  for (const [name, f, n, kind] of views) {
    const s = await time(n, f); R.timings[name] = { ...s, target_ms: kind === "normal" ? 1000 : 3000 };
    if (s.p95 >= (kind === "normal" ? 1000 : 3000)) fails.push(`${name}: p95 ${s.p95} ms`);
  }
  // the engines return real data at this volume
  const ov = (await M.rpc("exec_overview")).data; R.sample = { indicators: ov.indicators, portfolio_health: ov.portfolio_health, attention: ov.attention.length };
  assert.ok(ov.indicators.active_projects > 100 && ov.indicators.overdue_work > 100);
  fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p5-perf.json"), JSON.stringify(R, null, 1));
  assert.deepEqual(fails, [], "targets met");
});
