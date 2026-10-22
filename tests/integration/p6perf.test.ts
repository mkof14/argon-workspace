// Phase 6 performance on the isolated stack at the required volume — on top of whatever the stack holds (in the
// full run that includes the Phase 5 volume): 100 people, 250 projects, 1,000 parties, 10,000 process instances,
// 50,000 step runs and as many history events, 5,000 purchase requests, 10,000 quotations, 5,000 purchase records,
// 5,000 payment requests, 2,000 contracts, 5,000 obligations, 2,000 engineering changes and 5,000 issues. Processes are
// loaded in bulk with the same shape the engine writes; a sample is then driven through the engine itself. Every
// number is measured through the API with a signed-in person (row-level security and the engine's visibility on):
// median, p95 and max of repeated calls. Targets: p95 < 1 s for normal screens and actions, < 3 s for heavy ones.
// Results: .stack/p6-perf.json. Nothing is estimated.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENV, makeUser, signIn, sql, uid } from "./_stack.ts";

const run = uid(); const N = { users: 100, projects: 250, parties: 1000, vendors: 200, prs: 5000, quotes: 10000, purchases: 5000, payments: 5000, contracts: 2000, obligations: 5000, ecrs: 2000, issues: 5000, instances: 10000 };
const R: Record<string, any> = { volume: {}, timings: {}, targets: { normal_p95_ms: 1000, heavy_p95_ms: 3000 } };
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)]); return { median: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1]), n: s.length }; };
async function time(n: number, f: (i: number) => Promise<any>) { const out: number[] = []; for (let i = 0; i < n + 1; i++) { const t = performance.now(); const r = await f(i); if (r?.error) throw new Error(r.error.message); if (i) out.push(performance.now() - t); } return stats(out); }
let people: any[] = []; let C: Record<string, any> = {}; let projects: string[] = []; let U: Record<string, any> = {};

before(async () => {
  const t0 = Date.now();
  const roles = ["engineering", "operations", "finance", "sales", "legal", "procurement", "hr"];
  for (let i = 0; i < N.users; i++) people.push(await makeUser(`p6perf${i}-${run}@agron-stack.test`, i === 0 ? "management" : i === 1 ? "procurement" : i === 2 ? "finance" : roles[i % roles.length], { us: i % 7 !== 0, name: `P6 Perf ${i} ${run}` }));
  U = { mgmt: people[0], proc: people[1], fin: people[2], emp: people[3], non: people[7] }; // people[7]: a non-US person
  const ids = people.map((p) => p.id);
  projects = (await sql(`insert into records(section, title, status, controlled, data, created_by) select 'company.projects', 'P6 project ' || g || ' ${run}', 'Active', g % 11 = 0,
      jsonb_build_object('manager_id', ($1::uuid[])[1 + g % 100]), $2::uuid from generate_series(1, ${N.projects}) g returning id`, [ids, ids[0]])).map((r: any) => r.id);
  const parties = (await sql(`insert into records(section, title, status, data, created_by) select 'company.parties', 'P6 party ' || g || ' ${run}', 'Active', jsonb_build_object('country', (array['US','AE','DE'])[1 + g % 3]), $1::uuid from generate_series(1, ${N.parties}) g returning id`, [ids[0]])).map((r: any) => r.id);
  const vendors = (await sql(`insert into records(section, title, status, data, created_by) select 'operations.vendors', 'P6 vendor ' || g || ' ${run}', (array['Approved','Active','Prospect'])[1 + g % 3], jsonb_build_object('party_ref', ($1::uuid[])[g]), $2::uuid from generate_series(1, ${N.vendors}) g returning id`, [parties, ids[0]])).map((r: any) => r.id);
  await sql(`insert into records(section, title, status, data, created_by) select 'finance.budget', 'P6 budget ' || g || ' ${run}', 'Approved', jsonb_build_object('project_ref', ($1::uuid[])[g], 'planned', 100000, 'currency', 'USD'), $2::uuid from generate_series(1, ${N.projects}) g`, [projects, ids[0]]);
  // purchase requests (requester = creator), two quotations each, a purchase record each
  const prs = (await sql(`insert into records(section, title, status, controlled, data, created_by)
      select 'operations.requests', 'P6 PR ' || g || ' ${run}', (array['Submitted','Technical review','Quotations','Vendor selection','Approval','Ordered','Receiving','Closed'])[1 + g % 8], ($3::uuid[])[1 + g % ${N.projects}] = any($4::uuid[]),
        jsonb_build_object('number', 'P6-${run}-PR-' || g, 'requester_id', ($1::uuid[])[1 + g % 100], 'item', 'Item ' || g, 'qty', 1 + g % 5, 'est_amount', 500 + (g % 50) * 700, 'currency', 'USD', 'project_ref', ($3::uuid[])[1 + g % ${N.projects}],
          'vendor_ref', ($2::uuid[])[1 + g % ${N.vendors}], 'needed_by', to_char(current_date + (g % 60) - 20, 'YYYY-MM-DD')), ($1::uuid[])[1 + g % 100]
      from generate_series(1, ${N.prs}) g returning id`, [ids, vendors, projects, projects.filter((_, i) => (i + 1) % 11 === 0)])).map((r: any) => r.id);
  await sql(`insert into records(section, title, status, controlled, data, created_by)
      select 'operations.quotations', 'P6 quote ' || g || ' ${run}', 'Received', p.controlled, jsonb_build_object('request_ref', p.id, 'vendor_ref', ($2::uuid[])[1 + g % ${N.vendors}], 'amount', 400 + (g % 70) * 650, 'currency', 'USD', 'lead_time_days', 5 + g % 30, 'valid_until', to_char(current_date + 30, 'YYYY-MM-DD')), $3::uuid
      from generate_series(1, ${N.quotes}) g join records p on p.id = ($1::uuid[])[1 + (g - 1) / 2]`, [prs, vendors, ids[1]]);
  await sql(`insert into records(section, title, status, controlled, data, created_by)
      select 'operations.procurement', 'P6 PO ' || g || ' ${run}', (array['Approved','Ordered','Partially delivered','Received','Closed'])[1 + g % 5], p.controlled,
        jsonb_build_object('number', 'P6-${run}-PO-' || g, 'request_ref', p.id, 'vendor_ref', p.data->>'vendor_ref', 'amount', p.data->'est_amount', 'currency', 'USD', 'qty', p.data->'qty', 'qty_received', 0, 'project_ref', p.data->>'project_ref',
          'eta', to_char(current_date + (g % 40) - 15, 'YYYY-MM-DD')), $2::uuid
      from generate_series(1, ${N.purchases}) g join records p on p.id = ($1::uuid[])[g]`, [prs, ids[1]]);
  const pays = (await sql(`insert into records(section, title, status, data, created_by) select 'finance.payments', 'P6 payment ' || g || ' ${run}', (array['Requested','Review','Approval','Ready for payment','Paid','Reconciled'])[1 + g % 6],
      jsonb_build_object('number', 'P6-${run}-PAY-' || g, 'requester_id', ($1::uuid[])[1 + g % 100], 'payee', 'Payee ' || g, 'amount', 100 + g % 9000, 'currency', 'USD', 'project_ref', ($2::uuid[])[1 + g % ${N.projects}], 'due', to_char(current_date + g % 30, 'YYYY-MM-DD')) ||
        case when g % 6 >= 4 then jsonb_build_object('paid_on', to_char(current_date - g % 20, 'YYYY-MM-DD'), 'paid_amount', 100 + g % 9000, 'approved_amount', 100 + g % 9000) else '{}'::jsonb end, ($1::uuid[])[1 + g % 100]
      from generate_series(1, ${N.payments}) g returning id`, [ids, projects])).map((r: any) => r.id);
  const ctrs = (await sql(`insert into records(section, title, status, data, created_by) select 'legal.contracts', 'P6 contract ' || g || ' ${run}', (array['Drafting','Internal review','Approval','Signature','Active'])[1 + g % 5],
      jsonb_build_object('number', 'P6-${run}-CTR-' || g, 'counterparty', 'Party ' || g, 'type', 'Supply', 'end_date', to_char(current_date + g % 400, 'YYYY-MM-DD')), $1::uuid from generate_series(1, ${N.contracts}) g returning id`, [ids[0]])).map((r: any) => r.id);
  await sql(`insert into records(section, title, status, data, created_by) select 'legal.contract_obligations', 'P6 obligation ' || g || ' ${run}', (array['Open','Open','Completed','Waived'])[1 + g % 4],
      jsonb_build_object('contract_ref', ($1::uuid[])[1 + g % ${N.contracts}], 'description', 'Obligation ' || g, 'due', to_char(current_date + (g % 90) - 30, 'YYYY-MM-DD')), $2::uuid from generate_series(1, ${N.obligations}) g`, [ctrs, ids[0]]);
  const ecrs = (await sql(`insert into records(section, title, status, controlled, data, created_by) select 'technical.changes', 'P6 ECR ' || g || ' ${run}', (array['Requested','Impact review','Technical review','Approval','Implementation'])[1 + g % 5], g % 9 = 0,
      jsonb_build_object('number', 'P6-${run}-ECR-' || g, 'reason', 'Reason ' || g, 'project_ref', ($2::uuid[])[1 + g % ${N.projects}], 'requester_id', ($1::uuid[])[1 + g % 100]), ($1::uuid[])[1 + g % 100]
      from generate_series(1, ${N.ecrs}) g returning id`, [ids, projects])).map((r: any) => r.id);
  await sql(`insert into records(section, title, status, data, created_by) select 'company.issues', 'P6 issue ' || g || ' ${run}', (array['Open','Investigating','Action required','Verification','Closed'])[1 + g % 5],
      jsonb_build_object('number', 'P6-${run}-ISS-' || g, 'type', (array['Quality','Delivery','Technical','Supplier'])[1 + g % 4], 'due', to_char(current_date + (g % 30) - 10, 'YYYY-MM-DD'), 'owner_id', ($1::uuid[])[1 + g % 100]), $2::uuid
      from generate_series(1, ${N.issues}) g`, [ids, ids[0]]);
  // 10,000 instances on those records (purchase 5,000 · payment 3,000 · change 1,000 · contract 1,000), each with its step runs and history
  const defs = Object.fromEntries((await sql("select code, id, version, steps from wf_definitions where state = 'published' and code in ('PURCHASE', 'PAYMENT', 'ECR', 'CONTRACT')")).map((d: any) => [d.code, d]));
  const plan: [string, string[]][] = [["PURCHASE", prs.slice(0, 5000)], ["PAYMENT", pays.slice(0, 3000)], ["ECR", ecrs.slice(0, 1000)], ["CONTRACT", ctrs.slice(0, 1000)]];
  for (const [code, recs] of plan) {
    const d = defs[code]; const steps = d.steps.map((s: any) => s.id); const types = d.steps.map((s: any) => s.type); const names = d.steps.map((s: any) => s.name);
    await sql(`with src as (select r.id rid, r.section, row_number() over () g, coalesce(public.as_uuid(r.data->>'requester_id'), r.created_by) req from records r where r.id = any($1::uuid[])),
      ins as (insert into wf_instances(definition_id, def_code, def_version, record_id, section, requester, status, priority, started_at)
        select $2::uuid, $3, $4, s.rid, s.section, s.req, case when s.g % 10 < 7 then 'active' else 'completed' end, (array['Normal','High','Low','Critical'])[1 + s.g % 4], now() - make_interval(days => (s.g % 30)::int)
        from src s returning id, record_id, status, started_at),
      k as (select i.*, row_number() over () g from ins i),
      runs as (insert into wf_step_runs(instance_id, seq, step_id, step_type, step_name, status, outcome, assignee, assignee_role, started_at, due_at, completed_at)
        select k.id, n, ($5::text[])[n], ($6::text[])[n], ($7::text[])[n],
          case when k.status = 'active' and n = least(1 + k.g % array_length($5::text[], 1), 5) then 'open' else 'done' end,
          case when k.status = 'active' and n = least(1 + k.g % array_length($5::text[], 1), 5) then null else 'success' end,
          case when ($6::text[])[n] in ('APPROVAL', 'AUTOMATION', 'CHECK') then null else ($8::uuid[])[1 + (k.g * n) % 100] end, null,
          k.started_at + make_interval(hours => n * 6), k.started_at + make_interval(hours => n * 6 + 48), case when k.status = 'active' and n = least(1 + k.g % array_length($5::text[], 1), 5) then null else k.started_at + make_interval(hours => n * 6 + 5) end
        from k, generate_series(1, 12) n where n <= case when k.status = 'active' then least(1 + k.g % array_length($5::text[], 1), 5) else array_length($5::text[], 1) end returning id, instance_id, step_id, status, seq)
      insert into wf_events(instance_id, run_id, record_id, section, kind, step_id, to_state, at)
        select r.instance_id, r.id, i.record_id, $9, case when r.status = 'open' then 'step_entered' else 'step_completed' end, r.step_id, case when r.status = 'open' then 'open' else 'success' end, now() - make_interval(hours => (r.seq * 3)::int)
        from runs r join ins i on i.id = r.instance_id
        union all select i.id, null, i.record_id, $9, 'started', null, 'active', i.started_at from ins i`,
      [recs, d.id, code, d.version, steps, types, names, ids, code === "PURCHASE" ? "operations.requests" : code === "PAYMENT" ? "finance.payments" : code === "ECR" ? "technical.changes" : "legal.contracts"]);
    await sql("update wf_instances i set current_run = s.id, current_step = s.step_id from wf_step_runs s where s.instance_id = i.id and s.status = 'open' and i.def_code = $1 and i.current_run is null", [code]);
  }
  // pending approvals on the processes standing at an approval step (one level, two candidates each)
  await sql(`insert into approvals(record_id, section, requested_by, approver_id, status, step, chain_id, chain_mode, wf_run, basis, basis_hash, expires_at)
    select i.record_id, i.section, i.requester, ($1::uuid[])[1 + (abs(hashtext(i.id::text)) + c) % 100], 'pending', 1, i.id, 'sequential', s.id, '{}'::jsonb, md5('{}'), now() + interval '30 days'
    from wf_instances i join wf_step_runs s on s.id = i.current_run, generate_series(0, 1) c
    where s.step_type = 'APPROVAL' and i.record_id in (select id from records where title like $2) and ($1::uuid[])[1 + (abs(hashtext(i.id::text)) + c) % 100] is distinct from i.requester`, [ids, `P6 % ${run}`]);
  const vol = (await sql(`select (select count(*) from profiles)::int people, (select count(*) from records where section = 'company.projects')::int projects, (select count(*) from records where section = 'company.parties')::int parties,
    (select count(*) from wf_instances)::int instances, (select count(*) from wf_step_runs)::int step_runs, (select count(*) from wf_events)::int events,
    (select count(*) from records where section = 'operations.requests')::int purchase_requests, (select count(*) from records where section = 'operations.quotations')::int quotations,
    (select count(*) from records where section = 'operations.procurement')::int purchases, (select count(*) from records where section = 'finance.payments')::int payment_requests,
    (select count(*) from records where section = 'legal.contracts')::int contracts, (select count(*) from records where section = 'legal.contract_obligations')::int obligations,
    (select count(*) from records where section = 'technical.changes')::int engineering_changes, (select count(*) from records where section = 'company.issues')::int issues,
    (select count(*) from records)::int all_records, (select count(*) from approvals)::int approvals, (select count(*) from records where section = 'company.tasks')::int tasks`))[0];
  R.volume = { ...vol, added: N, seconds_to_load: Math.round((Date.now() - t0) / 1000) };
  for (const [k, n] of [["people", 100], ["projects", 250], ["parties", 1000], ["instances", 10000], ["step_runs", 40000], ["events", 50000], ["purchase_requests", 5000], ["quotations", 10000], ["purchases", 5000],
    ["payment_requests", 5000], ["contracts", 2000], ["obligations", 5000], ["engineering_changes", 2000], ["issues", 5000]] as const) assert.ok(vol[k] >= n, `${k} ${vol[k]}`);
  await sql("analyze records; analyze wf_instances; analyze wf_step_runs; analyze wf_events; analyze approvals");
  for (const k of Object.keys(U)) C[k] = (await signIn(U[k].email)).c;
});

const rpc = (k: string, fn: string, args: any = {}) => C[k].rpc(fn, args);
test("normal screens and actions under 1 s (p95), heavy ones under 3 s, at volume", async () => {
  const T = R.timings;
  T.my_processes_employee = await time(10, () => rpc("emp", "ops_my_processes"));
  T.my_processes_procurement = await time(10, () => rpc("proc", "ops_my_processes"));
  T.request_types = await time(10, () => rpc("emp", "ops_request_types"));
  const one = (await sql("select i.id from wf_instances i join records r on r.id = i.record_id where r.title like $1 and i.status = 'active' limit 1", [`P6 PR % ${run}`]))[0].id;
  T.process_detail = await time(10, () => rpc("mgmt", "ops_instance", { p_id: one }));
  T.overview_management = await time(10, () => rpc("mgmt", "ops_overview"));
  T.overview_non_us = await time(10, () => rpc("non", "ops_overview"));
  T.drill_down_list = await time(10, () => rpc("mgmt", "ops_list", { p_kind: "pr_open", p_limit: 200 }));
  T.attention = await time(10, () => rpc("mgmt", "ops_attention"));
  T.deadlines = await time(10, () => rpc("mgmt", "ops_deadlines", { p_days: 30 }));
  T.budgets_all_projects = await time(10, () => rpc("fin", "ops_budget", { p_project: null }));
  T.budget_one_project = await time(10, () => rpc("fin", "ops_budget", { p_project: projects[3] }));
  T.weekly_operations = await time(5, () => rpc("mgmt", "ops_weekly", {}));
  T.assistant_my_approvals = await time(10, () => rpc("mgmt", "ops_assistant", { p_intent: "my_approvals", p_arg: null }));
  // actions through the engine at volume: raise a purchase request and submit its first step; approve
  T.request_create_and_submit = await time(10, async () => {
    const { data, error } = await rpc("emp", "ops_request_create", { p_type: "purchase", p_title: `P6 perf live ${run} ${Math.random()}`, p_data: { item: "x", qty: 1, est_amount: 100, currency: "USD" }, p_priority: null });
    if (error) return { error };
    const i = (await sql("select current_run from wf_instances where id = $1", [data.instance]))[0];
    return rpc("emp", "wf_act", { p_run: i.current_run, p_outcome: "submit", p_note: null });
  });
  const ap = await sql(`select a.id, a.approver_id from approvals a join records r on r.id = a.record_id join wf_instances i on i.id = (select instance_id from wf_step_runs where id = a.wf_run)
    where a.status = 'pending' and r.title like $1 and a.approver_id = $2 and i.requester <> $2 and not r.controlled limit 12`, [`P6 PR % ${run}`, U.mgmt.id]);
  if (ap.length >= 6) T.approval_decision = await time(Math.min(10, ap.length - 1), (i) => rpc("mgmt", "wf_approval_decide", { p_id: ap[i].id, p_decision: "rejected", p_comment: "perf test" }));
  T.sla_tick_service = await time(3, async () => { await sql("select public.wf_sla_tick()"); return null; });
  fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p6-perf.json"), JSON.stringify(R, null, 1));
  const heavy = ["overview_management", "overview_non_us", "budgets_all_projects", "weekly_operations", "sla_tick_service"];
  for (const [k, v] of Object.entries(T) as [string, any][]) assert.ok(v.p95 < (heavy.includes(k) ? 3000 : 1000), `${k}: p95 ${v.p95} ms`);
});
