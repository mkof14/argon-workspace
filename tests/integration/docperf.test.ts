// Phase 4 performance on the isolated stack at the required volume: 100 people, 250 projects, 10,000 register entries,
// 30,000 document versions, 25,000 knowledge / searchable items (5,000 articles + 20,000 indexed document pages) and
// 100,000+ notification / activity rows. Every number is measured here through the API with a signed-in person
// (row-level security on), median and 90th percentile of repeated calls. Nothing is estimated.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeUser, signIn, sql, uid } from "./_stack.ts";
import { retrieve } from "../../src/lib/server/retrieval.ts";

const run = uid(); const N = { users: 100, projects: 250, docs: 10000, versions: 30000, articles: 5000, pages: 20000, notifications: 60000, activity: 40000, decisions: 2000, meetings: 1000 };
const people: any[] = []; let C: any, M: any, me: any, mgmt: any, projects: string[] = [], docs: string[] = [];
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { median: Math.round(s[Math.floor(s.length / 2)]), p90: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]), max: Math.round(s[s.length - 1]), n: s.length }; };
async function time(n: number, f: (i: number) => Promise<any>) { const out: number[] = []; for (let i = 0; i < n; i++) { const t = performance.now(); const r = await f(i); if (r?.error) throw new Error(r.error.message); out.push(performance.now() - t); } return stats(out); }
const R: Record<string, any> = {};

before(async () => {
  const t0 = Date.now();
  const roles = ["engineering", "operations", "finance", "sales", "legal"];
  for (let i = 0; i < N.users; i++) people.push(await makeUser(`p4perf${i}-${run}@agron-stack.test`, i === 0 ? "management" : roles[i % roles.length], { us: i % 7 !== 0, name: `P4 Perf ${i} ${run}` }));
  const ids = people.map((p) => p.id); mgmt = people[0]; me = people[1];
  const depts = ["engineering", "software", "operations", "procurement", "finance", "sales", "legal"];
  await sql("update profiles set department = (array['engineering','software','operations','procurement','finance','sales','legal'])[1 + (abs(hashtext(id::text)) % 7)] where email like $1", [`p4perf%-${run}@agron-stack.test`]);
  projects = (await sql(`insert into records(section, title, status, data, created_by)
      select 'company.projects', 'P4 project ' || g || ' ${run}', 'Active', jsonb_build_object('code', 'P' || g, 'manager_id', ($1::uuid[])[1 + g % $2], 'members_ids', to_jsonb(array[($1::uuid[])[2], ($1::uuid[])[1 + (g + 1) % $2]]::text[])), ($1::uuid[])[1]
      from generate_series(1, ${N.projects}) g returning id`, [ids, ids.length])).map((r: any) => r.id);
  const types = ["Contract", "Policy", "Procedure", "Technical specification", "Engineering documentation", "Purchase order", "Report"];
  docs = (await sql(`insert into records(section, title, status, controlled, data, created_by)
      select 'company.documents', 'P4 doc ' || g || ' torque harness ' || md5(g::text), (array['Draft','In review','Approved','Effective','Archived'])[1 + g % 5], g % 9 = 0,
        jsonb_build_object('doc_type', ($3::text[])[1 + g % 7], 'project_ref', ($4::uuid[])[1 + g % ${N.projects}], 'department', ($5::text[])[1 + g % 7], 'owner_id', ($1::uuid[])[1 + g % $2],
          'classification', case when g % 9 = 0 then 'US Persons Only' when g % 23 = 0 then 'Restricted' when g % 5 = 0 then 'Confidential' else 'Internal' end, 'description', 'Specification of part ' || g),
        ($1::uuid[])[1 + g % $2]
      from generate_series(1, ${N.docs}) g returning id`, [ids, ids.length, types, projects, depts])).map((r: any) => r.id);
  await sql(`insert into document_versions(record_id, label, major, minor, path, file_name, size, mime, sha256, author, created_at, change_note)
      select ($1::uuid[])[1 + (g - 1) / 3], '0.' || (1 + (g - 1) % 3), 0, 1 + (g - 1) % 3, 'company.documents/' || ($1::uuid[])[1 + (g - 1) / 3] || '/' || g || '_v.pdf', 'v.pdf', 1000 + g, 'application/pdf', md5(g::text) || md5((g + 1)::text), ($2::uuid[])[1 + g % 100], now() - make_interval(hours => ${N.versions} - g), 'change ' || g
      from generate_series(1, ${N.versions}) g`, [docs, ids]);
  await sql(`insert into records(section, title, status, data, created_by)
      select 'company.wiki', 'P4 article ' || g || ' procurement procedure ' || md5(g::text), 'Published', jsonb_build_object('category', (array['Procedures','Engineering','Operations','Procurement'])[1 + g % 4], 'summary', 'How to order part ' || g, 'body', 'Steps for torque and harness ' || g, 'language', 'en'), ($1::uuid[])[1]
      from generate_series(1, ${N.articles}) g`, [ids]);
  await sql(`insert into doc_pages(record_id, path, file_name, page, content)
      select ($1::uuid[])[1 + g % ${N.docs}], 'company.documents/' || ($1::uuid[])[1 + g % ${N.docs}] || '/page' || g || '.pdf', 'page.pdf', 1, 'Assembly page ' || g || ' torque values for harness connector ' || md5(g::text) || ' calibration'
      from generate_series(1, ${N.pages}) g`, [docs]);
  await sql(`insert into records(section, title, status, data, created_by)
      select 'company.decisions', 'P4 decision ' || g, 'Approved', jsonb_build_object('decision', 'Use harness rev ' || g, 'project_ref', ($2::uuid[])[1 + g % ${N.projects}], 'date', to_char(now() - make_interval(days => g % 300), 'YYYY-MM-DD')), ($1::uuid[])[1]
      from generate_series(1, ${N.decisions}) g`, [ids, projects]);
  await sql(`insert into records(section, title, status, data, created_by)
      select 'company.meetings', 'P4 meeting ' || g, 'Scheduled', jsonb_build_object('date', to_char(current_date + (g % 60) - 20, 'YYYY-MM-DD'), 'time', '10:00', 'organizer_id', ($1::uuid[])[1 + g % 100], 'participants_ids', to_jsonb(array[($1::uuid[])[2]]::text[]), 'recurrence', case when g % 10 = 0 then 'weekly' else 'none' end), ($1::uuid[])[1 + g % 100]
      from generate_series(1, ${N.meetings}) g`, [ids]);
  await sql(`insert into notifications(user_id, kind, record_id, section, title, body, key, created_at, read_at)
      select ($1::uuid[])[1 + g % $2], 'doc_version', ($3::uuid[])[1 + g % ${N.docs}], 'company.documents', 'P4', 'x', 'p4:${run}:' || g, now() - make_interval(mins => g), case when g % 2 = 0 then now() end
      from generate_series(1, ${N.notifications}) g`, [ids, ids.length, docs]);
  await sql(`insert into activity(record_id, section, actor, action, detail, created_at)
      select ($1::uuid[])[1 + g % ${N.docs}], 'company.documents', ($2::uuid[])[1 + g % 100], 'version_added', jsonb_build_object('version', '0.' || g % 9), now() - make_interval(mins => g)
      from generate_series(1, ${N.activity}) g`, [docs, ids]);
  await sql("analyze records; analyze document_versions; analyze doc_pages; analyze notifications; analyze activity");
  C = (await signIn(me.email)).c; M = (await signIn(mgmt.email)).c;
  R.seed_seconds = Math.round((Date.now() - t0) / 1000);
});

test("volume is in place", async () => {
  const [v] = await sql(`select (select count(*)::int from profiles where email like $1) users, (select count(*)::int from records where section = 'company.projects' and title like $2) projects,
      (select count(*)::int from records where section = 'company.documents' and title like 'P4 doc %') docs, (select count(*)::int from document_versions where record_id = any($3)) versions,
      (select count(*)::int from records where section = 'company.wiki' and title like 'P4 article %') articles, (select count(*)::int from doc_pages where file_name = 'page.pdf') pages,
      (select count(*)::int from notifications) notifications, (select count(*)::int from activity) activity`, [`p4perf%-${run}@agron-stack.test`, `P4 project % ${run}`, docs]);
  R.volume = v;
  assert.ok(v.users >= 100 && v.projects >= 250 && v.docs >= 10000 && v.versions >= 30000 && v.articles + v.pages >= 25000 && v.notifications + v.activity >= 100000, JSON.stringify(v));
});

test("measured: Document Center, document search, versions, global search, calendar, decisions, Assistant retrieval, management filters", async () => {
  const today = new Date().toISOString().slice(0, 10); const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  R.document_center = await time(20, () => C.rpc("document_center", { p_view: "all", p_limit: 50 }));
  R.document_center_recent = await time(10, () => C.rpc("document_center", { p_view: "recent", p_limit: 50 }));
  R.document_search = await time(20, (i) => C.rpc("document_center", { p_q: ["torque", "harness", "part 77", "specification"][i % 4], p_limit: 50 }));
  R.version_history = await time(20, (i) => C.from("document_versions").select("*").eq("record_id", docs[(i * 397) % docs.length]).order("major", { ascending: false }).order("minor", { ascending: false }));
  R.global_search = await time(20, (i) => C.rpc("corp_search", { p_q: ["torque harness", "procurement procedure", "calibration", "rev 12"][i % 4], p_limit: 40 }));
  R.calendar_month = await time(20, () => C.rpc("calendar_items", { p_from: d(-15), p_to: d(27), p_scope: "all" }));
  R.decision_list = await time(20, () => M.rpc("decision_log", { p_limit: 100 }));
  R.assistant_retrieval = await time(10, (i) => retrieve(C, me, { q: ["What is the current procurement procedure?", "Show the latest approved document for P4 project 12", "What decisions were made about P4 project 7?", "What are my overdue tasks?"][i % 4] }));
  R.management_filters = await time(20, (i) => M.rpc("document_center", { p_department: ["engineering", "finance", "legal"][i % 3], p_status: ["Approved", "In review"][i % 2], p_classification: "Confidential", p_sort: "number", p_limit: 50 }));
  const slow = Object.entries(R).filter(([, v]) => v && typeof v === "object" && "p90" in v).sort((a: any, b: any) => b[1].p90 - a[1].p90)[0];
  R.slowest = { op: slow[0], ...slow[1] };
  fs.writeFileSync(path.join(process.cwd(), ".stack", "docs-perf.json"), JSON.stringify(R, null, 1));
  console.log("P4PERF", JSON.stringify(R));
  assert.ok(R.document_center.p90 < 5000 && R.global_search.p90 < 5000, "within 5 s at p90");
  assert.ok((await C.rpc("document_center", { p_view: "all", p_limit: 5 })).data.total > 0);
  void today;
});
