// Phase 8 performance (B68) on the isolated stack at the required volume — on top of whatever the stack holds (in the
// full run that includes the Phase 5–7 volume): 10 configurations, 50 BOM revisions with 100,000 BOM lines, 25,000
// items, 100 build units, 10,000 work orders, 100,000 inventory transactions, 20,000 serialized assets, 10,000
// inspections, 10,000 test runs and 5,000 nonconformances, all synthetic. Definitions, revisions, approvals, units and
// work orders are made through the v25 functions (the real rules); the bulk rows go through the ordinary tables. Every
// number is measured through the API with a signed-in person (row-level security on): median, p95 and max of repeated
// calls. Targets: p95 < 1 s for common screens, < 3 s for heavy ones. Results: .stack/p8-perf.json.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENV, makeUser, pool, signIn, sql, uid } from "./_stack.ts";

// P8PERF_REUSE=<tag> measures again on a dataset an earlier run of this suite loaded (no second load)
const REUSE = process.env.P8PERF_REUSE || ""; const run = REUSE ? REUSE.replace(/^p8perf/, "") : uid(); const tag = `p8perf${run}`;
const N = { configs: 10, revisions: 5, items: 25000, linesPerBom: 2000, units: 100, woPerUnit: 100, txns: 100000, serials: 20000, inspections: 10000, tests: 10000, issues: 5000 };
const R: Record<string, any> = { volume: {}, timings: {}, targets: { common_p95_ms: 1000, heavy_p95_ms: 3000 } };
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)]); return { median: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1]), n: s.length }; };
async function time(n: number, f: (i: number) => Promise<any>) { const out: number[] = []; for (let i = 0; i < n + 1; i++) { const t = performance.now(); const r = await f(i); if (r?.error) throw new Error(r.error.message); if (i) out.push(performance.now() - t); } return stats(out); }
const U: Record<string, any> = {}; const C: Record<string, any> = {}; const S: Record<string, any> = {};

async function as<T = any>(k: string, q: string, p: any[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated"); await c.query("set local statement_timeout = '600s'");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[k].id, role: "authenticated", aal: "aal1" })]);
    const r = await c.query(q, p); await c.query("commit"); return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const arg = (a: any) => (a !== null && typeof a === "object" && !(Array.isArray(a) && (a.length === 0 || typeof a[0] === "string")) ? JSON.stringify(a) : a);
const call = async (k: string, fn: string, args: any[] = []) => (await as(k, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args.map(arg)))[0].r;
const get = async (id: string) => (await sql("select * from records where id = $1", [id]))[0];
async function approveAll(record: string) {
  for (let n = 0; n < 6; n++) {
    const r = await get(record); if (r.status === "Approved") return r;
    const ap = await sql("select * from approvals where record_id = $1 and status = 'pending' order by step", [record]);
    const mine = ap.find((a: any) => [U.eng2.id, U.mfg.id].includes(a.approver_id)); assert.ok(mine, "an approval for one of our approvers");
    await call(mine.approver_id === U.eng2.id ? "eng2" : "mfg", "wf_approval_decide", [mine.id, "approved", null]);
  }
  return get(record);
}

async function reuse() {
  for (const k of ["owner", "mfg", "eng", "eng2", "tech", "mgmt", "nonus"]) U[k] = (await sql("select id, email from profiles where email = $1", [`${tag}.${k}@agron-stack.test`]))[0];
  S.units = (await sql("select id from records where section = 'operations.builds' and title like $1 order by data->>'number'", [`%${tag} unit %`])).map((r: any) => r.id);
  S.boms = (await sql("select id from records where section = 'technical.boms' and data->>'config_code' in (select data->>'code' from records where section = 'technical.configurations' and title like $1) order by data->>'number', data->>'revision'", [`${tag} Config %`])).map((r: any) => r.id);
  R.volume = { reused: tag, ...(await sql(`select (select count(*) from records where section = 'technical.items')::int items, (select count(*) from mfg_bom_lines)::int bom_lines, (select count(*) from records where section = 'operations.work_orders')::int work_orders,
    (select count(*) from mfg_txns)::int inventory_transactions, (select count(*) from mfg_serials)::int serials, (select count(*) from records)::int all_records`))[0] };
  for (const k of ["mfg", "tech", "mgmt", "nonus", "eng"]) C[k] = (await signIn(U[k].email)).c;
}
before(async () => {
  if (REUSE) return reuse();
  const t0 = Date.now();
  const mk = async (k: string, role: string, o: any = {}) => { U[k] = await makeUser(`${tag}.${k}@agron-stack.test`, role, { name: `${k} ${tag}`, ...o }); };
  await mk("owner", "owner", { us: true }); await mk("mfg", "operations", { us: true }); await mk("eng", "engineering", { us: true }); await mk("eng2", "engineering", { us: true });
  await mk("tech", "operations", { us: true }); await mk("mgmt", "management", { us: true }); await mk("nonus", "engineering", { us: false });
  for (const [k, caps] of [["mfg", ["build_manager", "work_order_manager", "inventory_manager", "quality_inspector"]], ["eng", ["bom_editor"]], ["eng2", ["bom_approver", "engineering_change_approver"]]] as const)
    for (const c of caps) await call("owner", "crm_cap_set", [U[k].id, c, true]);
  const product = (await sql("select * from records where section = 'technical.products' and data->>'code' = 'C20'"))[0];
  // 25,000 items (the numbering trigger gives each its AGRON number); every 10th serialized; every 50th a subassembly
  const items: string[] = (await sql(`insert into records(section, title, status, data, created_by) select 'technical.items', '${tag} Item ' || g, 'Active',
      jsonb_build_object('item_type', case when g > 20000 then 'Subassembly' else 'Purchased Part' end, 'uom', 'ea', 'ref_cost', 10 + g % 90, 'currency', (array['USD','AED','EUR'])[1 + g % 3],
        'serialized', g % 10 = 0, 'manufacturer', 'Acme', 'mpn', 'ACM-${run}-' || g, 'inspection_required', false), $1::uuid from generate_series(1, ${N.items}) g returning id`, [U.eng.id])).map((r: any) => r.id);
  S.items = items;
  // routing: 100 steps (so 100 units make 10,000 work orders)
  const routing = Array.from({ length: N.woPerUnit }, (_, i) => ({ key: `s${i + 1}`, seq: i + 1, name: `Step ${i + 1}`, operation: `Step ${i + 1}`, ...(i ? { prerequisites: [`s${i}`] } : {}) }));
  S.configs = []; S.boms = [];
  for (let c = 0; c < N.configs; c++) {
    const cfg = (await as("eng", "insert into records(section, title, status, data) values ('technical.configurations', $1, 'Draft', $2) returning *", [`${tag} Config ${c}`, { product_ref: product.id, product_ref_title: "C20", name: `Perf ${c}`, routing, required_tests: [], required_inspections: [] }]))[0];
    await call("eng", "mfg_def_submit", [cfg.id]); S.configs.push((await approveAll(cfg.id)).id);
    // 2,000 lines in two levels: 20 subassemblies with 99 parts each
    const lines: any[] = []; let n = 0;
    for (let a = 0; a < 20; a++) { const ak = String(++n); lines.push({ key: ak, item: items[20000 + c * 20 + a], qty: 1 }); for (let p = 0; p < 99; p++) lines.push({ key: String(++n), parent: ak, item: items[c * 1980 + a * 99 + p], qty: 1 + (p % 4), position: `P${a}.${p}` }); }
    let bom = await call("eng", "mfg_bom_create", [S.configs[c]]); await call("eng", "mfg_bom_lines_save", [bom.id, lines]);
    await call("eng", "mfg_def_submit", [bom.id]); await approveAll(bom.id); S.boms.push(bom.id);
    for (let r = 1; r < N.revisions; r++) { // a quantity change on one line per revision
      const nv = await call("eng", "mfg_def_new_version", [bom.id, `Revision ${r} for the performance data`]);
      const cur = await call("eng", "mfg_bom_get", [nv.id]);
      const next = cur.lines.map((l: any) => ({ key: String(l.line), parent: l.parent ? String(cur.lines.find((x: any) => x.id === l.parent)?.line) : null, item: l.item.id, qty: l.line === 2 + r ? Number(l.qty) + 1 : Number(l.qty), position: l.position }));
      await call("eng", "mfg_bom_lines_save", [nv.id, next]); await call("eng", "mfg_def_submit", [nv.id]); await approveAll(nv.id); bom = nv; S.boms.push(bom.id);
    }
  }
  // 100 build units (10 per configuration, released: configuration and BOM pinned) and their 10,000 work orders
  S.units = [];
  for (let u = 0; u < N.units; u++) {
    const unit = await call("mfg", "mfg_unit_create", [{ product: product.id, config: S.configs[u % N.configs], title: `${tag} unit ${u}`, target: new Date(Date.now() + (10 + u) * 864e5).toISOString().slice(0, 10), restricted: u % 10 === 9 }]);
    await call("mfg", "mfg_wo_generate", [unit.id]); S.units.push(unit.id);
  }
  await sql("update records set data = data || jsonb_build_object('assignee_id', $1::text) where section = 'operations.work_orders' and data->>'build_ref' = any($2::text[]) and (data->>'sequence')::int % 7 = 0", [U.tech.id, S.units]);
  // stock and the ledger: 100,000 transactions, 20,000 serials, stock lines for the items in the BOMs
  const store = (await sql("select id from mfg_locations where code = 'STORE'"))[0].id;
  await sql(`insert into mfg_stock(item_id, location_id, state, qty) select i, $1, 'Available', 5 + (row_number() over ()) % 40 from unnest($2::uuid[]) i where (select data->>'serialized' from records where id = i) <> 'true'`, [store, items.slice(0, 12000)]);
  await sql(`insert into mfg_txns(kind, item_id, qty, to_location, to_state, actor, reason, idem_key) select (array['receive','move','adjust','consume'])[1 + g % 4], ($1::uuid[])[1 + g % 12000], 1 + g % 5, $2, 'Available', $3, 'perf load', 'perf-${run}-' || g from generate_series(1, ${N.txns}) g`, [items, store, U.mfg.id]);
  const serialized = items.filter((_, i) => (i + 1) % 10 === 0);
  await sql(`insert into mfg_serials(item_id, serial, location_id, state, created_by) select ($1::uuid[])[1 + g % array_length($1::uuid[], 1)], 'SN-${run}-' || lpad(g::text, 6, '0'), $2, 'Available', $3 from generate_series(1, ${N.serials}) g`, [serialized, store, U.mfg.id]);
  // 10,000 inspections, 10,000 test runs, 5,000 nonconformances, linked to the units
  await sql(`insert into records(section, title, status, data, created_by) select 'operations.quality', '${tag} Inspection ' || g, case when g % 5 = 0 then 'Planned' else 'Closed' end,
      jsonb_build_object('inspection_kind', (array['In-Process Inspection','Final Inspection','Receiving Inspection'])[1 + g % 3], 'build_ref', ($1::text[])[1 + g % ${N.units}], 'result', case when g % 5 = 0 then null when g % 17 = 0 then 'Fail' else 'Pass' end, 'date', to_char(current_date - g % 60, 'YYYY-MM-DD')),
      $2::uuid from generate_series(1, ${N.inspections}) g`, [S.units, U.mfg.id]);
  await sql(`insert into records(section, title, status, data, created_by) select 'technical.testing', '${tag} Test ' || g, case when g % 13 = 0 then 'Failed' else 'Passed' end,
      jsonb_build_object('build_ref', ($1::text[])[1 + g % ${N.units}], 'procedure_code', 'TP-PERF', 'procedure_version', '1', 'outcome', case when g % 13 = 0 then 'Fail' else 'Pass' end, 'date', to_char(current_date - g % 60, 'YYYY-MM-DD')),
      $2::uuid from generate_series(1, ${N.tests}) g`, [S.units, U.mfg.id]);
  await sql(`insert into records(section, title, status, data, created_by) select 'company.issues', '${tag} Nonconformance ' || g, case when g % 3 = 0 then 'Closed' else 'Investigating' end,
      jsonb_build_object('type', 'Nonconformance', 'build_ref', ($1::text[])[1 + g % ${N.units}], 'severity', (array['Low','Medium','High'])[1 + g % 3]), $2::uuid from generate_series(1, ${N.issues}) g`, [S.units, U.mfg.id]);
  const vol = (await sql(`select (select count(*) from records where section = 'technical.items')::int items, (select count(*) from records where section = 'technical.boms')::int bom_revisions,
    (select count(*) from mfg_bom_lines)::int bom_lines, (select count(*) from records where section = 'technical.configurations')::int configurations, (select count(*) from records where section = 'operations.builds')::int build_units,
    (select count(*) from records where section = 'operations.work_orders')::int work_orders, (select count(*) from mfg_txns)::int inventory_transactions, (select count(*) from mfg_serials)::int serials,
    (select count(*) from records where section = 'operations.quality')::int inspections, (select count(*) from records where section = 'technical.testing')::int test_runs,
    (select count(*) from records where section = 'company.issues')::int issues, (select count(*) from records)::int all_records`))[0];
  R.volume = { ...vol, added: N, seconds_to_load: Math.round((Date.now() - t0) / 1000) };
  for (const [k, n] of [["items", 25000], ["bom_revisions", 50], ["bom_lines", 100000], ["configurations", 10], ["build_units", 100], ["work_orders", 10000], ["inventory_transactions", 100000], ["serials", 20000], ["inspections", 10000], ["test_runs", 10000], ["issues", 5000]] as const)
    assert.ok(vol[k] >= n, `${k} ${vol[k]}`);
  for (const t of ["records", "mfg_bom_lines", "mfg_txns", "mfg_serials", "mfg_stock", "mfg_allocs", "mfg_installs"]) await sql(`vacuum (analyze) ${t}`);
  for (const k of ["mfg", "tech", "mgmt", "nonus", "eng"]) C[k] = (await signIn(U[k].email)).c;
});

const rpc = (k: string, fn: string, args: any = {}) => C[k].rpc(fn, args);
test("manufacturing screens under 1 s (p95), heavy ones under 3 s, at the B68 volume", { timeout: 1_800_000 }, async () => {
  const T = R.timings; const unit = S.units[3]; const bomA = S.boms[0], bomE = S.boms[4];
  const wo = (await sql("select id from records where section = 'operations.work_orders' and data->>'build_ref' = $1 order by (data->>'sequence')::int limit 1", [unit]))[0].id;
  T.dashboard = await time(10, () => rpc("mfg", "mfg_overview"));
  T.dashboard_management = await time(10, () => rpc("mgmt", "mfg_overview"));
  T.build_list = await time(10, () => rpc("mfg", "mfg_list", { p_kind: "all", p_filter: {} }));
  T.blocked_list = await time(10, () => rpc("mfg", "mfg_list", { p_kind: "blocked", p_filter: {} }));
  T.unit_view = await time(10, () => rpc("mfg", "mfg_unit_view", { p_unit: unit }));
  for (const t of ["bom", "materials", "work", "inspections", "tests", "issues", "asbuilt", "history"]) T[`unit_tab_${t}`] = await time(5, () => rpc("mfg", "mfg_unit_tab", { p_unit: unit, p_tab: t }));
  T.bom_view = await time(10, () => rpc("eng", "mfg_bom_get", { p_bom: bomE }));
  T.bom_compare = await time(10, () => rpc("eng", "mfg_bom_compare", { p_a: bomA, p_b: bomE }));
  T.material_plan_unit = await time(10, () => rpc("mfg", "mfg_material_plan", { p_scope: { unit } }));
  T.material_plan_100_units = await time(5, () => rpc("mfg", "mfg_material_plan", { p_scope: { units: S.units } }));
  T.shortage_list = await time(10, () => rpc("mfg", "mfg_list", { p_kind: "shortages", p_filter: {} }));
  T.inventory_search = await time(10, (i) => rpc("mfg", "mfg_inventory", { p_q: `Item ${100 + i}`, p_item: null, p_location: null, p_state: null, p_limit: 300 }));
  T.serial_search = await time(10, (i) => rpc("mfg", "mfg_serial_search", { p_q: `SN-${run}-00${1000 + i}`, p_limit: 50 }));
  T.work_queue = await time(10, () => rpc("tech", "mfg_queue"));
  T.work_order = await time(10, () => rpc("tech", "mfg_wo", { p_wo: wo }));
  T.inspections_due = await time(10, () => rpc("mfg", "mfg_list", { p_kind: "inspections_required", p_filter: {} }));
  T.failed_tests = await time(10, () => rpc("mfg", "mfg_list", { p_kind: "failed_tests", p_filter: {} }));
  T.nonconformances = await time(10, () => rpc("mfg", "mfg_list", { p_kind: "nonconformances", p_filter: {} }));
  T.asbuilt = await time(10, () => rpc("mfg", "mfg_planned_vs_built", { p_unit: unit }));
  T.executive_control = await time(10, () => rpc("mgmt", "mfg_exec"));
  T.weekly_review = await time(5, () => rpc("mgmt", "mfg_weekly", { p_from: null, p_to: null }));
  T.today = await time(10, () => rpc("tech", "mfg_today"));
  T.assistant_building = await time(10, () => rpc("mfg", "mfg_assistant", { p_intent: "building", p_arg: null }));
  const unitNo = (await get(unit)).data.number;
  T.assistant_blocking = await time(10, () => rpc("mfg", "mfg_assistant", { p_intent: "blocking", p_arg: unitNo }));
  T.assistant_risks = await time(5, () => rpc("mgmt", "mfg_assistant", { p_intent: "risks", p_arg: null }));
  T.search = await time(10, (i) => rpc("mfg", "corp_search", { p_q: `ACM-${run}-${200 + i}`, p_limit: 20 }));
  T.dashboard_non_us = await time(10, () => rpc("nonus", "mfg_overview"));
  fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p8-perf.json"), JSON.stringify(R, null, 1));
  T.notices_tick_service = await time(3, async () => { await sql("select public.mfg_tick()"); return null; });
  fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p8-perf.json"), JSON.stringify(R, null, 1));
  const heavy = ["dashboard_management", "material_plan_100_units", "weekly_review", "assistant_risks", "bom_compare", "notices_tick_service", "unit_tab_materials"];
  for (const [k, v] of Object.entries(T) as [string, any][]) assert.ok(v.p95 < (heavy.includes(k) ? 3000 : 1000), `${k}: p95 ${v.p95} ms`);
});
