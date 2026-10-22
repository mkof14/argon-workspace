// Phase 7 performance (B48) on the isolated stack at the required volume — on top of whatever the stack holds (in the
// full run that includes the Phase 5 and Phase 6 volume): 5,000 organisations, 20,000 contacts, 10,000 leads, 5,000
// opportunities, 10,000 proposal versions, 50,000 activities and 5,000 meetings, all synthetic. Rows are loaded in bulk
// through the ordinary table (the v24 triggers run: numbering, stage and value history). Every number is measured
// through the API with a signed-in person (row-level security and the commercial visibility on): median, p95 and max of
// repeated calls. Targets: p95 < 1 s for common screens and actions, < 3 s for heavy ones. Results: .stack/p7-perf.json.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENV, makeUser, signIn, sql, uid } from "./_stack.ts";

const run = uid(); const N = { users: 40, orgs: 5000, contacts: 20000, leads: 10000, opps: 5000, proposals: 10000, activities: 50000, meetings: 5000 };
const R: Record<string, any> = { volume: {}, timings: {}, targets: { common_p95_ms: 1000, heavy_p95_ms: 3000 } };
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)]); return { median: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1]), n: s.length }; };
async function time(n: number, f: (i: number) => Promise<any>) { const out: number[] = []; for (let i = 0; i < n + 1; i++) { const t = performance.now(); const r = await f(i); if (r?.error) throw new Error(r.error.message); if (i) out.push(performance.now() - t); } return stats(out); }
let people: any[] = []; const C: Record<string, any> = {}; let U: Record<string, any> = {}; let orgs: string[] = []; let opps: string[] = [];

before(async () => {
  const t0 = Date.now();
  const roles = ["sales", "sales", "marketing", "sales", "engineering"];
  for (let i = 0; i < N.users; i++) people.push(await makeUser(`p7perf${i}-${run}@agron-stack.test`, i === 0 ? "management" : i === 1 ? "partner" : roles[i % roles.length], { us: i % 9 !== 0, name: `P7 Perf ${i} ${run}`, company: i === 1 ? "P7 Perf Partner" : null }));
  U = { mgmt: people[0], partner: people[1], sales: people[3], mkt: people[2], eng: people[4], nonus: people[9] };
  const sales = people.filter((p) => p.role === "sales").map((p) => p.id); const owner0 = people[0].id;
  // organisations (one record each, relationship types), contacts at them
  orgs = (await sql(`insert into records(section, title, status, data, created_by) select 'company.parties', 'P7 Org ' || g || ' ${run}', 'Active',
      jsonb_build_object('country', (array['UAE','Saudi Arabia','France','Monaco','USA'])[1 + g % 5], 'domain', 'org' || g || '-${run}.example', 'relationship_types', jsonb_build_array((array['Prospect','Customer','Partner','Agent','Vendor'])[1 + g % 5]),
        'owner_id', ($1::uuid[])[1 + g % array_length($1::uuid[], 1)]), $2::uuid from generate_series(1, ${N.orgs}) g returning id`, [sales, owner0])).map((r: any) => r.id);
  await sql(`insert into records(section, title, status, data, created_by) select 'company.contacts', 'P7 Contact ' || g || ' ${run}', 'Active',
      jsonb_build_object('party_ref', ($1::uuid[])[1 + g % ${N.orgs}], 'email', 'c' || g || '@org' || (1 + g % ${N.orgs}) || '-${run}.example', 'phone', '+9715' || lpad((g % 100000000)::text, 8, '0'), 'title', 'Manager'),
      $2::uuid from generate_series(1, ${N.contacts}) g`, [orgs, owner0]);
  await sql(`insert into records(section, title, status, data, created_by) select 'marketing.leads', 'P7 Lead ' || g || ' ${run}', (array['New','Reviewing','Qualified','Disqualified'])[1 + g % 4],
      jsonb_build_object('organization', 'Lead Org ' || g, 'email', 'l' || g || '@lead-${run}.example', 'owner_id', ($1::uuid[])[1 + g % array_length($1::uuid[], 1)], 'follow_up', to_char(current_date + (g % 20) - 8, 'YYYY-MM-DD'),
        'source', (array['IDEX','Website','Referral','E-mail'])[1 + g % 4], 'importance', (array['Hot','Warm','Cold'])[1 + g % 3]), $2::uuid from generate_series(1, ${N.leads}) g`, [sales, owner0]);
  // opportunities: open stages mostly; values in three currencies; every 10th restricted to its owner and team
  opps = (await sql(`insert into records(section, title, status, data, created_by)
      select 'sales.pipeline', 'P7 Opp ' || g || ' ${run}', (array['New','Qualified','Discovery','Technical','NDA / Information Exchange','Proposal','Negotiation','Decision','Won','Lost','On Hold'])[1 + g % 11],
        jsonb_build_object('party_ref', ($1::uuid[])[1 + g % ${N.orgs}], 'owner_id', ($2::uuid[])[1 + g % array_length($2::uuid[], 1)], 'value', 50000 + (g % 200) * 25000, 'currency', (array['USD','AED','EUR'])[1 + g % 3],
          'product', (array['StarDome','C20','C40','Sprinter'])[1 + g % 4], 'geography', (array['UAE','GCC','Europe','USA'])[1 + g % 4], 'source', (array['IDEX','Website','Referral'])[1 + g % 3],
          'next_action', case when g % 4 = 0 then null else 'Call ' || g end, 'next_action_due', to_char(current_date + (g % 30) - 10, 'YYYY-MM-DD'), 'expected_decision', to_char(current_date + (g % 180) - 30, 'YYYY-MM-DD'),
          'decision_evidence', case when g % 11 = 8 then 'PO ' || g end, 'final_value', case when g % 11 = 8 then 60000 + g end, 'lost_reason', case when g % 11 = 9 then 'Price' end, 'hold_reason', case when g % 11 = 10 then 'Budget' end,
          'restricted', g % 10 = 0), ($2::uuid[])[1 + g % array_length($2::uuid[], 1)]
      from generate_series(1, ${N.opps}) g returning id`, [orgs, sales])).map((r: any) => r.id);
  // two proposal versions per opportunity (V1 superseded, V2 current)
  await sql(`insert into records(section, title, status, data, created_by) select 'sales.proposals', 'P7 Proposal ' || ((g + 1) / 2) || ' v' || (1 + (g + 1) % 2) || ' ${run}', case when g % 2 = 1 then 'Superseded' else (array['Draft','Sent','Approved'])[1 + g % 3] end,
      jsonb_build_object('deal_ref', ($1::uuid[])[1 + ((g - 1) / 2) % ${N.opps}], 'amount', 100000 + g, 'currency', 'USD', 'version', 1 + (g + 1) % 2, 'valid_until', to_char(current_date + 30, 'YYYY-MM-DD')),
      $2::uuid from generate_series(1, ${N.proposals}) g`, [opps, sales[0]]).catch(async (e) => { // a status the database refuses outside the engine is loaded as Draft (the rule stays on)
        await sql(`insert into records(section, title, status, data, created_by) select 'sales.proposals', 'P7 Proposal ' || g || ' ${run}', 'Draft', jsonb_build_object('deal_ref', ($1::uuid[])[1 + ((g - 1) / 2) % ${N.opps}], 'amount', 100000 + g, 'currency', 'USD'), $2::uuid from generate_series(1, ${N.proposals}) g`, [opps, sales[0]]);
        R.volume.proposals_note = `loaded as Draft: ${String(e.message).slice(0, 120)}`; });
  await sql(`insert into records(section, title, status, data, created_by) select 'sales.activities', 'P7 Activity ' || g || ' ${run}', 'Done',
      jsonb_build_object('deal_ref', ($1::uuid[])[1 + g % ${N.opps}], 'type', (array['Call','E-mail','Meeting','Demo'])[1 + g % 4], 'date', to_char(current_date - g % 120, 'YYYY-MM-DD'), 'outcome', 'Spoke ' || g),
      ($2::uuid[])[1 + g % array_length($2::uuid[], 1)] from generate_series(1, ${N.activities}) g`, [opps, sales]);
  await sql(`insert into records(section, title, status, data, created_by) select 'company.meetings', 'P7 Meeting ' || g || ' ${run}', 'Held',
      jsonb_build_object('deal_ref', ($1::uuid[])[1 + g % ${N.opps}], 'date', to_char(current_date + (g % 40) - 30, 'YYYY-MM-DD'), 'organizer_id', ($2::uuid[])[1 + g % array_length($2::uuid[], 1)]),
      ($2::uuid[])[1 + g % array_length($2::uuid[], 1)] from generate_series(1, ${N.meetings}) g`, [opps, sales]);
  const vol = (await sql(`select (select count(*) from records where section = 'company.parties')::int organizations, (select count(*) from records where section = 'company.contacts')::int contacts,
    (select count(*) from records where section = 'marketing.leads')::int leads, (select count(*) from records where section = 'sales.pipeline')::int opportunities,
    (select count(*) from records where section = 'sales.proposals')::int proposals, (select count(*) from records where section = 'sales.activities')::int activities,
    (select count(*) from records where section = 'company.meetings')::int meetings, (select count(*) from records)::int all_records, (select count(*) from crm_stage_history)::int stage_history, (select count(*) from crm_values)::int value_history`))[0];
  R.volume = { ...R.volume, ...vol, added: N, seconds_to_load: Math.round((Date.now() - t0) / 1000) };
  for (const [k, n] of [["organizations", 5000], ["contacts", 20000], ["leads", 10000], ["opportunities", 5000], ["proposals", 10000], ["activities", 50000], ["meetings", 5000]] as const) assert.ok(vol[k] >= n, `${k} ${vol[k]}`);
  for (const t of ["records", "crm_stage_history", "crm_values"]) await sql(`vacuum (analyze) ${t}`); // steady state after the bulk load
  for (const k of Object.keys(U)) C[k] = (await signIn(U[k].email)).c;
});

const rpc = (k: string, fn: string, args: any = {}) => C[k].rpc(fn, args);
test("common commercial screens and actions under 1 s (p95), heavy ones under 3 s, at volume", async () => {
  const T = R.timings; const myOpp = (await sql("select id from records where section = 'sales.pipeline' and title like $1 and data->>'owner_id' = $2 and status = 'Qualified' limit 1", [`P7 Opp % ${run}`, U.sales.id]))[0]?.id || opps[1];
  const org = (await sql("select data->>'party_ref' p from records where id = $1", [myOpp]))[0].p;
  T.dashboard_sales = await time(10, () => rpc("sales", "crm_overview", { p_filter: {} }));
  T.dashboard_management = await time(10, () => rpc("mgmt", "crm_overview", { p_filter: {} }));
  T.pipeline_list_active = await time(10, () => rpc("mgmt", "crm_list", { p_kind: "active", p_q: null, p_limit: 200, p_filter: {} }));
  T.needs_my_action = await time(10, () => rpc("sales", "crm_list", { p_kind: "needs_action", p_q: null, p_limit: 200, p_filter: {} }));
  T.search_in_pipeline = await time(10, () => rpc("mgmt", "crm_list", { p_kind: "all", p_q: "Opp 12", p_limit: 50, p_filter: {} }));
  T.pipeline_value = await time(10, () => rpc("mgmt", "crm_pipeline_value", { p_filter: {} }));
  T.forecast = await time(10, () => rpc("mgmt", "crm_forecast", { p_from: null, p_to: null, p_bucket: "quarter", p_filter: {} }));
  T.opportunity_detail = await time(10, () => rpc("sales", "crm_opp", { p_id: myOpp }));
  T.opportunity_timeline = await time(10, () => rpc("sales", "crm_timeline", { p_id: myOpp, p_limit: 200 }));
  T.organization_history = await time(10, () => rpc("sales", "crm_timeline", { p_id: org, p_limit: 200 }));
  T.organization_relations = await time(10, () => rpc("sales", "crm_relations", { p_id: org }));
  T.leads_list = await time(10, () => rpc("mkt", "crm_leads", { p_filter: {}, p_limit: 300 }));
  T.duplicate_check = await time(10, (i) => rpc("sales", "crm_dupes", { p_kind: "contact", p: { email: `c${i + 5}@org${i + 6}-${run}.example`, phone: "+97150000123" } }));
  T.followups_mine = await time(10, () => rpc("sales", "crm_followups", { p_scope: "mine" }));
  T.waiting_for = await time(10, () => rpc("sales", "crm_waiting"));
  T.assistant_attention = await time(10, () => rpc("sales", "crm_assistant", { p_intent: "attention", p_arg: null }));
  T.assistant_introduced_by = await time(10, () => rpc("sales", "crm_assistant", { p_intent: "introduced_by", p_arg: "P7 Org 17" }));
  T.event_day = await time(10, () => rpc("mkt", "crm_event_day", { p_event: null, p_day: null }));
  T.commercial_review = await time(5, () => rpc("mgmt", "crm_weekly", { p_from: null, p_to: null }));
  T.corporate_search = await time(10, () => rpc("sales", "corp_search", { p_q: "P7 Org 42", p_limit: 20 }));
  // actions at volume: capture a lead (with duplicate detection), convert it (organisation + contact + opportunity in one transaction)
  T.lead_capture = await time(10, (i) => rpc("mkt", "crm_lead_capture", { p: { first_name: "Perf", last_name: `L${i}${run}`, organization: `P7 Capture Org ${i} ${run}`, email: `cap${i}.${run}@cap-${run}-${i}.example`, follow_up: new Date(Date.now() + 864e5).toISOString().slice(0, 10), owner_id: U.sales.id } }));
  const caps = (await sql("select id from records where section = 'marketing.leads' and data->>'email' like $1 order by created_at limit 11", [`cap%.${run}@%`])).map((r: any) => r.id);
  if (caps.length >= 6) T.lead_convert = await time(Math.min(10, caps.length - 1), (i) => rpc("sales", "crm_lead_convert", { p_lead: caps[i], p: { opportunity: { new: { value: 100000, currency: "USD", next_action: "Call", next_action_due: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) } } } }));
  T.stage_change = await time(10, async (i) => { const id = opps[100 + i * 11]; return C.mgmt.from("records").update({ status: "Discovery" }).eq("id", id).select("id"); });
  fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p7-perf.json"), JSON.stringify(R, null, 1)); // the screens' numbers first, then the notices backlog
  T.notices_tick_service = await time(3, async () => { await sql("select public.crm_tick()"); return null; });
  { const t0 = Date.now(); let calls = 0, more = true; while (more && calls < 60) { more = !!(await sql("select public.crm_tick() r"))[0].r?.more; calls++; } R.notices_drain = { calls, total_ms: Date.now() - t0, drained: !more }; }
  // the partner sees no customer pipeline at all
  // the partner (external) is refused by the commercial read models: no counts, no lists
  const pv = await rpc("partner", "crm_overview", { p_filter: {} }); R.partner = pv.error ? `refused: ${pv.error.message}` : `active ${pv.data?.blocks?.active?.count ?? 0}`;
  assert.ok(pv.error || !(pv.data?.blocks?.active?.count), "a partner sees no opportunity that was not shared");
  fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p7-perf.json"), JSON.stringify(R, null, 1));
  const heavy = ["dashboard_management", "pipeline_value", "forecast", "commercial_review", "notices_tick_service"];
  for (const [k, v] of Object.entries(T) as [string, any][]) assert.ok(v.p95 < (heavy.includes(k) ? 3000 : 1000), `${k}: p95 ${v.p95} ms`);
});
