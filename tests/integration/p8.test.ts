// Phase 8 — manufacturing, BOM, inventory and build control (v25) against the real database on the isolated stack,
// with real sign-ins. Synthetic data only: every title starts with the run tag; items, serials and vendors are invented.
// Covers product configurations (approved = immutable), the item master and its numbering, multi-level BOM revisions
// (approval of the exact line set, comparison), build units (pinned configuration and BOM), material requirements and
// the plan, purchase requests from shortages (the P6 purchase process), receiving into inspection, serials, lots,
// allocation (also concurrent), work orders (start, consume, install, complete), inspections, nonconformance and
// rework, test procedures and runs, software, As-Built and planned vs built, engineering change effectivity, build
// blockers and readiness, acceptance, shipment release, cost, search, QR, import / export, capabilities (System
// Admin ≠ manufacturing authority, Policy Approver) and the security matrix. Evidence: .stack/p8.json
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENV, makeUser, pool, sql, uid } from "./_stack.ts";

const run = uid(); const tag = `p8${run}`;
const D = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const U: Record<string, any> = {};
const EV: Record<string, any> = { tag, scenarios: {}, security: {}, rules: {} };
const S: Record<string, any> = {}; // shared objects between the scenarios (they run in order)

async function as<T = any>(k: string, q: string, p: any[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[k].id, role: "authenticated", aal: "aal1", iat: Math.floor(Date.now() / 1000) + 5 })]);
    const r = await c.query(q, p); await c.query("commit"); return r.rows;
  } catch (e: any) { await c.query("rollback").catch(() => {}); if (process.env.P8_DEBUG) console.error("SQL", k, q.slice(0, 120), JSON.stringify(p).slice(0, 300), e.message, e.where || ""); throw e; } finally { c.release(); }
}
const arg = (a: any) => (a !== null && typeof a === "object" && !(Array.isArray(a) && (a.length === 0 || typeof a[0] === "string")) ? JSON.stringify(a) : a);
const call = async (k: string, fn: string, args: any[] = []) => (await as(k, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args.map(arg)))[0].r;
const fails = async (p: Promise<any>, re: RegExp) => { await assert.rejects(p, (e: any) => { assert.match(String(e.message), re); return true; }); };
const get = async (id: string) => (await sql("select * from records where id = $1", [id]))[0];
const ins = async (k: string, section: string, title: string, status: string | null, data: any, controlled = false) =>
  (await as(k, "insert into records(section, title, status, data, controlled) values ($1, $2, $3, $4, $5) returning *", [section, `${tag} ${title}`, status, data, controlled]))[0];
const upd = async (k: string, id: string, patch: { status?: string; data?: any; title?: string }) => {
  const cur = await get(id);
  return (await as(k, "update records set status = $2, data = $3, title = $4 where id = $1 returning *", [id, patch.status ?? cur.status, { ...cur.data, ...(patch.data || {}) }, patch.title ?? cur.title]))[0];
};
const svc = async (q: string, p: any[] = []) => sql(q, p);
const inst = async (record: string) => (await sql("select i.*, s.step_id cur, s.id run from wf_instances i left join wf_step_runs s on s.id = i.current_run where i.record_id = $1 order by i.created_at desc limit 1", [record]))[0];
const act = (k: string, runId: string, outcome: string, note: string | null = null) => call(k, "wf_act", [runId, outcome, note]);
const keyOf = (id: string) => Object.keys(U).find((k) => U[k].id === id);
const stock = async (item: string) => Object.fromEntries((await sql("select state, sum(qty)::float q from mfg_stock where item_id = $1 group by state", [item])).map((r: any) => [r.state, r.q]));

/** approve a definition through its process: each level by one of our approvers (never the submitter) */
async function approveAll(record: string, who: string[]) {
  for (let n = 0; n < 6; n++) {
    const r = await get(record); if (r.status === "Approved") return r;
    const ap = await svc("select * from approvals where record_id = $1 and status = 'pending' order by step", [record]);
    const mine = ap.find((a: any) => who.map((k) => U[k].id).includes(a.approver_id));
    assert.ok(mine, `an approval for one of ${who.join(", ")} (pending: ${ap.map((a: any) => keyOf(a.approver_id) || "other").join(", ")})`);
    await call(keyOf(mine.approver_id)!, "wf_approval_decide", [mine.id, "approved", null]);
  }
  return get(record);
}
async function item(title: string, d: any = {}, controlled = false) {
  return ins("eng", "technical.items", title, "Active", { item_type: "Purchased Part", uom: "ea", ref_cost: 100, currency: "USD", inspection_required: false, ...d }, controlled);
}
/** a purchase request from a shortage, through the P6 purchase process up to the purchase record (no shortcut) */
async function toPurchase(pr: string) {
  let i = await inst(pr); assert.equal(i.cur, "request");
  await act("mfg", i.run, "submit");
  i = await inst(pr); assert.equal(i.cur, "tech_review"); await act("eng", i.run, "approved");
  i = await inst(pr); assert.equal(i.cur, "quotations");
  const r = await get(pr);
  await as("proc", "insert into records(section, title, status, data) values ('operations.quotations', $1, 'Received', $2)", [`${tag} Q ${r.title}`, { request_ref: pr, vendor_ref: S.vendor.id, vendor_ref_title: S.vendor.title, amount: Number(r.data.est_amount || 500), currency: "USD", lead_time_days: 7, valid_until: D(30), delivery_date: D(7) }]);
  await act("proc", i.run, "submit");
  i = await inst(pr); assert.equal(i.cur, "vendor_selection");
  const q = (await svc("select id from records where section = 'operations.quotations' and data->>'request_ref' = $1", [pr]))[0];
  await call("proc", "ops_select_quote", [pr, q.id, "The only quotation for this test"]);
  i = await inst(pr); assert.equal(i.cur, "approval");
  const ap = await svc("select * from approvals where record_id = $1 and status = 'pending'", [pr]);
  const mine = ap.find((a: any) => a.approver_id === U.lead.id); assert.ok(mine, "the department lead approves");
  await call("lead", "wf_approval_decide", [mine.id, "approved", null]);
  i = await inst(pr); assert.equal(i.cur, "order");
  await act("proc", i.run, "done");
  return get((await get(pr)).data.purchase_ref);
}

before(async () => {
  const mk = async (k: string, role: string, o: any = {}) => { U[k] = await makeUser(`${tag}.${k}@agron.test`, role, { name: `${k} ${tag}`, ...o }); };
  await mk("owner", "owner", { us: true }); await mk("admin", "admin", { us: true }); await mk("mgmt", "management", { us: true });
  await mk("mfg", "operations", { us: true }); await mk("eng", "engineering", { us: true }); await mk("eng2", "engineering", { us: true }); await mk("proc", "procurement", { us: true });
  await mk("quality", "operations", { us: true }); await mk("qapp", "operations", { us: true }); await mk("tester", "engineering", { us: true }); await mk("tapp", "engineering", { us: true });
  await mk("fin", "finance", { us: true }); await mk("sales", "sales", { us: true }); await mk("pm", "operations", { us: true }); await mk("tech", "operations", { us: true });
  await mk("emp", "marketing", { us: true }); await mk("nonus", "engineering", { us: false }); await mk("acceptor", "operations", { us: true }); await mk("shipper", "operations", { us: true });
  await mk("policy", "management", { us: true }); await mk("lead", "operations", { us: true });
  await mk("partner", "partner", { company: `Gulfp${run}` }); await mk("vendor", "vendor", { company: `Boltv${run}` }); await mk("contractor", "partner", { company: `Contractco${run}` });
  await mk("disabled", "operations", { us: true });
  await svc("update profiles set disabled = true where id = $1", [U.disabled.id]);
  const DEPT = (await sql("insert into departments(code, key, name, manager_id) values ($1, $2, $3, $4) returning id", [`P8${run.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`, `p8${run}`, `Manufacturing ${tag}`, U.lead.id]))[0].id;
  await sql("update profiles set department_id = $1 where id = any($2)", [DEPT, [U.mfg.id, U.lead.id]]);
  // the business capabilities, granted by an owner (never inferred from the System Administrator role)
  const grant = async (k: string, caps: string[]) => { for (const c of caps) await call("owner", "crm_cap_set", [U[k].id, c, true]); };
  await grant("mfg", ["build_manager", "work_order_manager", "inventory_manager"]); await grant("eng", ["bom_editor"]); await grant("eng2", ["bom_approver", "engineering_change_approver"]);
  await grant("quality", ["quality_inspector"]); await grant("qapp", ["quality_approver"]); await grant("tester", ["test_operator"]); await grant("tapp", ["test_approver"]);
  await grant("acceptor", ["unit_acceptance_approver"]); await grant("shipper", ["shipment_release_approver"]); await grant("policy", ["policy_approver"]); await grant("lead", ["build_manager"]);
  S.vendor = (await sql("insert into records(section, title, status, data) values ('operations.vendors', $1, 'Approved', $2) returning *", [`${tag} Vendor Bolt`, { country: "US" }]))[0];
  S.product = (await sql("select * from records where section = 'technical.products' and data->>'code' = 'C20'"))[0];
  S.product40 = (await sql("select * from records where section = 'technical.products' and data->>'code' = 'C40'"))[0];
  assert.ok(S.product && S.product40, "the product families are starting data of v25");
});
after(async () => { fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p8.json"), JSON.stringify(EV, null, 1)); });

/* ------------------------------------------- Scenario 1: product configuration ------------------------------------------- */
test("Scenario 1 — a product configuration is approved through its process and then never edited: a new version is made", async () => {
  const routing = [
    { key: "prep", seq: 1, name: "Container preparation", operation: "Container preparation", checklist: [{ key: "clean", text: "Container cleaned" }] },
    { key: "elec", seq: 2, name: "Electrical", operation: "Electrical", prerequisites: ["prep"], inspection: "In-Process Inspection" },
    { key: "integ", seq: 3, name: "Integration", operation: "Integration", prerequisites: ["elec"] }];
  const cfg = await ins("eng", "technical.configurations", "C20 Pilot", "Draft", { product_ref: S.product.id, product_ref_title: "C20", name: "Pilot", routing, required_tests: [], required_inspections: ["Final Inspection"] });
  assert.ok(cfg.data.code, "a configuration code from the numbering"); assert.equal(Number(cfg.data.version), 1);
  await fails(ins("eng", "technical.configurations", "C20 sneaky", "Approved", { product_ref: S.product.id }), /starts as Draft/);
  await fails(upd("eng", cfg.id, { status: "Approved" }), /changes through/);
  await fails(call("sales", "mfg_def_submit", [cfg.id]), /not found|BOM Editor/i);
  const sub = await call("eng", "mfg_def_submit", [cfg.id]);
  assert.equal(sub.status, "Review");
  await fails(upd("eng", cfg.id, { data: { name: "changed in review" } }), /in approval/);
  const ok = await approveAll(cfg.id, ["eng2", "mfg"]);
  assert.equal(ok.status, "Approved"); assert.ok(ok.data.approved_at);
  // the approved configuration is immutable — for everyone, the System Administrator included
  await fails(upd("eng", cfg.id, { data: { name: "silent edit" } }), /is Approved and cannot be edited/);
  await fails(upd("admin", cfg.id, { title: `${tag} renamed` }), /is Approved and cannot be edited/);
  await fails(call("eng", "mfg_def_new_version", [cfg.id, "x"]), /change reason/);
  const v2 = await call("eng", "mfg_def_new_version", [cfg.id, "Add the communications step"]);
  assert.equal(Number(v2.version), 2);
  const c2 = await get(v2.id); assert.equal(c2.status, "Draft"); assert.equal(c2.data.supersedes_ref, cfg.id); assert.equal(c2.data.code, cfg.data.code);
  assert.equal((await get(cfg.id)).status, "Approved", "version 1 stays approved until version 2 is approved");
  S.cfg = await get(cfg.id); S.cfgV2 = c2;
  EV.scenarios.s1 = { code: cfg.data.code, v1: "Approved", v2: c2.status };
});

/* ------------------------------------------- Item master and numbering ------------------------------------------- */
test("Item master — AGRON item numbers from the atomic numbering (concurrency safe), the manufacturer part number kept apart, classification entered", async () => {
  const items = await Promise.all(Array.from({ length: 12 }, (_, n) => item(`Part ${n}`, { manufacturer: "Acme", mpn: `ACM-${run}-${n}`, number: "HANDMADE" })));
  const nums = items.map((i: any) => i.data.number);
  assert.equal(new Set(nums).size, 12, "no duplicate item numbers under concurrency");
  for (const n of nums) assert.match(n, /^AGR-ITM-\d{6,}$/);
  assert.ok(items.every((i: any) => i.data.mpn.startsWith("ACM-")), "the manufacturer part number is the manufacturer's");
  await fails(as("eng", "update records set data = data || '{\"number\": \"AGR-ITM-999999\"}' where id = $1", [items[0].id]), /set by Workspace/);
  const us = await item("Restricted sensor", { classification: "US Persons Only", serialized: true });
  assert.equal(us.controlled, true, "an entered US Persons Only classification makes the item US-persons-only");
  S.items = items; S.usItem = us;
  EV.rules.item_numbers = { first: nums.sort()[0], count: 12 };
});

/* ------------------------------------------- Scenario 2: multi-level BOM ------------------------------------------- */
test("Scenario 2 — a multi-level BOM: the exact revision is approved; a quantity change is a new revision; comparison is deterministic", async () => {
  const [p0, p1, p2, p3, p4, p5] = S.items;
  const asm = await item("Power assembly", { item_type: "Assembly" });
  const sub = await item("Battery subassembly", { item_type: "Subassembly" });
  const serial = await item("Edge computer", { item_type: "Equipment", serialized: true, critical: true });
  S.asm = asm; S.sub = sub; S.serialItem = serial;
  await fails(call("sales", "mfg_bom_create", [S.cfg.id]), /BOM Editor/);
  const b = await call("eng", "mfg_bom_create", [S.cfg.id]);
  assert.match(b.number, /^AGR-BOM-\d{4,}$/); assert.equal(b.revision, "A");
  const lines = [
    { key: "1", item: p0.id, qty: 10, position: "Rack A" },
    { key: "2", item: asm.id, qty: 1, position: "Power" },
    { key: "3", parent: "2", item: sub.id, qty: 2, position: "Battery bay" },
    { key: "4", parent: "3", item: p1.id, qty: 4, position: "Cell" },
    { key: "5", parent: "2", item: p2.id, qty: 3, position: "Breaker" },
    { key: "6", item: serial.id, qty: 1, position: "Compute" },
    { key: "7", item: p3.id, qty: 2, alt_group: "FAN" }, { key: "8", item: p4.id, qty: 2, alt_group: "FAN" },
    { key: "9", item: p5.id, qty: 1, required: false, position: "Spare" }];
  // no item contains itself
  await fails(call("eng", "mfg_bom_lines_save", [b.id, [...lines, { key: "10", parent: "3", item: asm.id, qty: 1 }]]), /contain itself/);
  await fails(call("eng", "mfg_bom_lines_save", [b.id, [{ key: "1", parent: "9", item: p0.id, qty: 1 }]]), /parent line must come before/);
  const saved = await call("eng", "mfg_bom_lines_save", [b.id, lines]);
  assert.equal(saved.lines, 9);
  const tree = await call("eng", "mfg_bom_get", [b.id]);
  const cell = tree.lines.find((l: any) => l.item.id === p1.id);
  assert.equal(cell.level, 3); assert.equal(Number(cell.ext_qty), 8, "4 cells × 2 batteries × 1 assembly per unit");
  await call("eng", "mfg_def_submit", [b.id]);
  await fails(call("eng", "mfg_bom_lines_save", [b.id, lines]), /cannot change/);
  const ap = await approveAll(b.id, ["eng2", "mfg"]);
  assert.equal(ap.status, "Approved"); assert.equal(ap.data.lines_hash, saved.lines_hash, "the approval is for this exact line set");
  const appr = await svc("select basis from approvals where record_id = $1 and status = 'approved'", [b.id]);
  assert.ok(appr.length >= 1 && appr.every((a: any) => a.basis.lines_hash === saved.lines_hash), "the approval basis carries the line hash");
  // never silently modified
  await fails(call("eng", "mfg_bom_lines_save", [b.id, lines.map((l) => (l.key === "1" ? { ...l, qty: 12 } : l))]), /Approved.*new revision/);
  await fails(upd("eng", b.id, { data: { notes: "x" } }), /cannot be edited/);
  await fails(as("admin", "update records set status = 'Draft' where id = $1", [b.id]), /changes through|cannot be edited/);
  const nb = await call("eng", "mfg_def_new_version", [b.id, "Ten more racks — quantity change"]);
  assert.equal(nb.revision, "B");
  const rb = await get(nb.id); assert.equal(rb.data.lines_hash, saved.lines_hash, "a new revision starts identical");
  const cur = await call("eng", "mfg_bom_get", [nb.id]);
  const nl = cur.lines.map((l: any) => ({ key: l.id, parent: l.parent || undefined, item: l.item.id, qty: l.item.id === p0.id ? 12 : Number(l.qty), position: l.position || undefined, alt_group: l.alt_group || undefined, required: l.required }));
  nl.push({ key: "x", item: p5.id, qty: 1, position: "Breaker", parent: cur.lines.find((l: any) => l.item.id === asm.id).id }); // p5 now also under the assembly (a move/addition)
  const s2 = await call("eng", "mfg_bom_lines_save", [nb.id, nl.filter((l: any) => l.item !== p2.id)]); // p2 removed from the assembly; p5 sits at its position: a substitution
  assert.notEqual(s2.lines_hash, saved.lines_hash);
  const cmp = await call("eng", "mfg_bom_compare", [b.id, nb.id]);
  assert.ok(cmp.quantity.some((q: any) => q.item.id === p0.id && Number(q.from) === 10 && Number(q.to) === 12), "quantity change");
  assert.ok(cmp.substituted.some((s: any) => s.from.id === p2.id && s.to.id === p5.id), "same place, another item: a substitution");
  assert.match(cmp.method, /Deterministic/);
  const cmp2 = await call("eng", "mfg_bom_compare", [b.id, nb.id]);
  assert.deepEqual(cmp2, cmp, "the same comparison every time");
  S.bomA = await get(b.id); S.bomB = await get(nb.id); S.lines = lines;
  EV.scenarios.s2 = { number: b.number, a_hash: saved.lines_hash, b_hash: s2.lines_hash, diff: { quantity: cmp.quantity.length, substituted: cmp.substituted.length, added: cmp.added.length, removed: cmp.removed.length } };
});

/* ------------------------------------------- Scenario 3: build unit ------------------------------------------- */
test("Scenario 3 — a C20 build unit: the exact product, configuration and BOM revision are pinned at release", async () => {
  await fails(call("admin", "mfg_unit_create", [{ product: S.product.id, config: S.cfg.id }]), /Build Manager/);
  const u = await call("mfg", "mfg_unit_create", [{ product: S.product.id, config: S.cfg.id, target: D(40), destination: "Abu Dhabi marina (synthetic)", title: `${tag} C20 pilot` }]);
  assert.match(u.number, /^AGR-C20-\d{4,}$/); assert.equal(u.released, true); assert.equal(u.bom, S.bomA.id, "revision A: B is still Draft"); assert.equal(u.bom_revision, "A");
  const r = await get(u.id);
  assert.equal(r.data.config_ref, S.cfg.id); assert.equal(r.data.product_ref, S.product.id); assert.equal(r.data.bom_lines_hash, S.bomA.data.lines_hash); assert.ok(r.data.unit_seq > 0);
  await fails(upd("mfg", u.id, { data: { bom_ref: S.bomB.id } }), /pinned/);
  await fails(upd("admin", u.id, { data: { config_ref: S.cfgV2.id } }), /pinned/);
  // no arbitrary jump: prerequisites, or a Build Manager's exception with the reason
  await fails(upd("mfg", u.id, { status: "Assembly" }), /build readiness|first:/);
  await fails(upd("mfg", u.id, { status: "Shipped" }), /no exception replaces/);
  await fails(upd("mfg", u.id, { status: "Shipped", data: { status_exception: "Customer is waiting at the dock" } }), /no exception replaces/);
  await fails(upd("mfg", u.id, { status: "Hold" }), /reason/);
  S.unit = await get(u.id);
  EV.scenarios.s3 = { number: u.number, bom: `${S.bomA.data.number} rev A`, hash: S.bomA.data.lines_hash };
});

/* ------------------------------------------- Scenario 4: material plan ------------------------------------------- */
test("Scenario 4 — material plan: 10 required, 6 in stock of which 2 allocated to another unit → 4 free, shortage 6", async () => {
  const p0 = S.items[0];
  const other = await call("mfg", "mfg_unit_create", [{ product: S.product.id, config: S.cfg.id, title: `${tag} C20 other` }]);
  S.other = await get(other.id);
  const store = (await svc("select id from mfg_locations where code = 'STORE'"))[0].id; S.store = store;
  await fails(call("tech", "mfg_adjust", [p0.id, store, "Available", 6, "Opening count"]), /Inventory Manager/);
  await call("mfg", "mfg_adjust", [p0.id, store, "Available", 6, "Opening count for the test"]);
  await call("mfg", "mfg_allocate", [{ unit: other.id }, p0.id, 2]);
  assert.deepEqual(await stock(p0.id), { Available: 4, Allocated: 2 });
  const plan = await call("mfg", "mfg_material_plan", [{ unit: S.unit.id }]);
  const row = plan.rows.find((r: any) => r.item === p0.id);
  assert.equal(Number(row.required), 10); assert.equal(Number(row.available), 4, "allocated stock is not free"); assert.equal(Number(row.allocated), 0);
  assert.equal(Number(row.shortage), 6); assert.equal(Number(row.purchase_required), 6); assert.equal(row.blocked, true);
  // the assembly explodes into its lines: 4 cells × 2 batteries = 8; the optional spare is not required; the alternate is not a second requirement
  const cells = plan.rows.find((r: any) => r.item === S.items[1].id); assert.equal(Number(cells.required), 8);
  assert.ok(!plan.rows.some((r: any) => r.item === S.asm.id), "an assembly is built from its lines, not bought");
  const fanA = plan.rows.find((r: any) => r.item === S.items[3].id), fanB = plan.rows.find((r: any) => r.item === S.items[4].id);
  assert.equal(Number(fanA.required), 2); assert.equal(Number(fanB?.required || 0), 0, "only the primary of an alternate group is required");
  assert.equal(Number(plan.rows.find((r: any) => r.item === S.items[5].id)?.required || 0), 0, "optional line");
  // two units together share the free stock in order of their target date
  const both = await call("mfg", "mfg_material_plan", [{ units: [S.unit.id, other.id] }]);
  const offered = both.rows.filter((r: any) => r.item === p0.id).reduce((a: number, r: any) => a + Number(r.allocate), 0);
  assert.equal(offered, 4, "the same free stock is never offered twice");
  EV.scenarios.s4 = { required: 10, in_stock: 6, allocated_elsewhere: 2, free: Number(row.available), shortage: Number(row.shortage) };
});

/* ------------------------------------------- Scenario 5 & 6: procurement and receiving ------------------------------------------- */
test("Scenario 5 & 6 — shortage → purchase request through the P6 purchase process; partial receipt → inspection → available", async () => {
  const p0 = S.items[0];
  const before = (await svc("select count(*)::int n from records where section = 'operations.procurement'"))[0].n;
  const pr = await call("mfg", "mfg_shortage_request", [S.unit.id, p0.id, 6, D(10), null]);
  assert.match(pr.number, /^AGR-PR-/);
  const prr = await get(pr.record);
  assert.equal(prr.section, "operations.requests"); assert.equal(prr.data.item_ref, p0.id); assert.equal(prr.data.build_ref, S.unit.id); assert.equal(Number(prr.data.qty), 6);
  assert.ok(prr.data.mfg_source && Number(prr.data.mfg_source.required) === 10, "the request carries its source requirement");
  assert.equal((await svc("select count(*)::int n from records where section = 'operations.procurement'"))[0].n, before, "nothing is ordered by the shortage itself");
  assert.equal((await inst(pr.record)).def_code, "PURCHASE", "the normal P6 purchase process");
  const plan1 = await call("mfg", "mfg_material_plan", [{ unit: S.unit.id }]);
  const r1 = plan1.rows.find((r: any) => r.item === p0.id); assert.equal(Number(r1.requested), 6); assert.equal(Number(r1.purchase_required), 0);
  const po = await toPurchase(pr.record);
  assert.equal(po.section, "operations.procurement"); assert.equal(po.status, "Ordered");
  // partial delivery: 4 of 6 arrive, 1 refused at the dock; the item needs inspection
  await svc("update records set data = data || '{\"inspection_required\": true}' where id = $1", [p0.id]);
  const key = `rcv-${run}`;
  const rc = await call("proc", "mfg_receive", [po.id, 4, 1, "Damaged", "one box crushed", null, null, null, null, key]);
  assert.equal(rc.status, "Partially delivered"); assert.equal(rc.state, "Inspection", "received material is not available before inspection"); assert.equal(Number(rc.qty), 3);
  assert.ok(rc.issue, "a refused unit opens a P6 discrepancy issue");
  const again = await call("proc", "mfg_receive", [po.id, 4, 1, "Damaged", "one box crushed", null, null, null, null, key]);
  assert.equal(again.duplicate, true, "the same receipt twice is recorded once");
  const po2 = await get(po.id); assert.equal(Number(po2.data.qty_received), 3); assert.equal(Number(po2.data.qty) - Number(po2.data.qty_received), 3, "the rest stays open");
  assert.equal((await stock(p0.id)).Inspection, 3);
  // receiving inspection: 2 pass, 1 rejected
  const insp = await call("mfg", "mfg_inspection_create", [{ kind: "Receiving Inspection", item: p0.id, qty: 3, location: rc.location, receipt: rc.receipt }]);
  await fails(call("mfg", "mfg_inspection_record", [insp.id, { result: "Pass" }]), /Quality Inspector/);
  const ir = await call("quality", "mfg_inspection_record", [insp.id, { result: "Fail", qty_fail: 1, notes: "One unit with a bent bracket", fail_state: "Rejected" }]);
  assert.ok(ir.issue, "a failed inspection is a nonconformance");
  const st = await stock(p0.id); assert.equal(st.Available, 6, "4 free + 2 passed"); assert.equal(st.Rejected, 1); assert.equal(st.Inspection || 0, 0);
  const nc = await get(ir.issue); assert.equal(nc.data.type, "Nonconformance"); assert.equal(nc.data.item_ref, p0.id); assert.equal(nc.data.inspection_ref, insp.id);
  assert.equal(nc.data.vendor_ref, S.vendor.id, "the supplier of the delivery is linked");
  const tx = await svc("select kind, qty::float, to_state from mfg_txns where receipt_id = $1", [rc.receipt]);
  assert.equal(tx.length, 1); assert.equal(tx[0].to_state, "Inspection");
  S.po = po;
  EV.scenarios.s5 = { request: pr.number, process: "PURCHASE", po: po.data.number };
  EV.scenarios.s6 = { received: 4, refused: 1, accepted_to_inspection: 3, passed: 2, rejected: 1, open_remaining: Number(po2.data.qty) - Number(po2.data.qty_received) };
});

/* ------------------------------------------- Scenario 7: serials ------------------------------------------- */
test("Scenario 7 — serial S100 received, installed in the C20; the same serial is refused in a C40", async () => {
  const ser = S.serialItem;
  const loc = (await svc("select id from mfg_locations where code = 'STORE'"))[0].id;
  // an opening balance through the controlled import (one serial per unit)
  const rows = [{ item: (await get(ser.id)).data.number, location: "STORE", qty: 2, serials: [`S100-${run}`, `S101-${run}`] }];
  const pv = await call("mfg", "mfg_import_preview", ["inventory", rows]);
  assert.equal(pv.summary.ok, 1);
  await call("mfg", "mfg_import_commit", ["inventory", rows, {}, "opening.csv"]);
  const s100 = (await svc("select * from mfg_serials where serial = $1", [`S100-${run}`]))[0];
  assert.equal(s100.state, "Available");
  await fails(call("mfg", "mfg_import_commit", ["inventory", rows, {}, "opening.csv"]), /recorded already|duplicate|unique/i);
  await call("mfg", "mfg_allocate", [{ unit: S.unit.id }, ser.id, null, null, null, [s100.id]]);
  // a C40 unit with its own approved configuration and BOM that also uses the edge computer
  const cfg40 = await ins("eng", "technical.configurations", "C40 Pilot", "Draft", { product_ref: S.product40.id, name: "Pilot 40", routing: [{ key: "one", seq: 1, name: "Install computer" }] });
  await call("eng", "mfg_def_submit", [cfg40.id]); await approveAll(cfg40.id, ["eng2", "mfg"]);
  const b40 = await call("eng", "mfg_bom_create", [cfg40.id]);
  await call("eng", "mfg_bom_lines_save", [b40.id, [{ key: "1", item: ser.id, qty: 1 }]]);
  await call("eng", "mfg_def_submit", [b40.id]); await approveAll(b40.id, ["eng2", "mfg"]);
  const u40 = await call("mfg", "mfg_unit_create", [{ product: S.product40.id, config: cfg40.id, title: `${tag} C40 pilot` }]);
  assert.match(u40.number, /^AGR-C40-\d{4,}$/);
  await call("mfg", "mfg_wo_generate", [S.unit.id]); await call("mfg", "mfg_wo_generate", [u40.id]);
  await upd("mfg", u40.id, { status: "Ready for Build" }); await upd("mfg", S.unit.id, { status: "Ready for Build" });
  const wo20 = (await svc("select * from records where section = 'operations.work_orders' and data->>'build_ref' = $1 and data->>'routing_key' = 'prep'", [S.unit.id]))[0];
  const wo40 = (await svc("select * from records where section = 'operations.work_orders' and data->>'build_ref' = $1", [u40.id]))[0];
  await call("tech", "mfg_wo_start", [wo20.id]);
  await fails(call("tech", "mfg_wo_complete", [wo20.id, { installed: [{ item: ser.id, serial: `S100-${run}` }] }]), /checklist/);
  const done = await call("tech", "mfg_wo_complete", [wo20.id, { checklist: [{ key: "clean", done: true }], installed: [{ item: ser.id, serial: `S100-${run}`, position: "Compute" }] }]);
  assert.equal(done.installed.length, 1);
  assert.equal((await svc("select state, unit_id from mfg_serials where id = $1", [s100.id]))[0].unit_id, S.unit.id);
  await call("tech", "mfg_wo_start", [wo40.id]);
  await fails(call("tech", "mfg_wo_complete", [wo40.id, { installed: [{ item: ser.id, serial: `S100-${run}` }] }]), /installed in AGR-C20|one serial is installed in one unit/);
  // even the database refuses a second active installation
  await fails(svc("insert into mfg_installs(unit_id, item_id, serial_id) values ($1, $2, $3)", [u40.id, ser.id, s100.id]), /duplicate key|unique/);
  S.u40 = await get(u40.id); S.wo40 = wo40; S.s100 = s100; S.b40 = b40;
  EV.scenarios.s7 = { serial: `S100-${run}`, installed_in: S.unit.data.number, refused_in: u40.number };
});

/* ------------------------------------------- Scenario 8 & 23: concurrency ------------------------------------------- */
test("Scenario 8 — two builds allocate the same stock at the same moment: no double allocation", async () => {
  const it = await item("Concurrent part", {});
  const store = S.store;
  await call("mfg", "mfg_adjust", [it.id, store, "Available", 5, "Count for the race test"]);
  // two units needing 5 each (BOM of the C40 pilot extended with a new draft revision would change pins — use project allocations instead)
  const prj = (await sql("insert into records(section, title, status, data) values ('company.projects', $1, 'Active', '{}') returning id", [`${tag} race project`]))[0];
  const res = await Promise.allSettled([call("mfg", "mfg_allocate", [{ project: prj.id }, it.id, 5]), call("mfg", "mfg_allocate", [{ project: prj.id }, it.id, 5]), call("mfg", "mfg_allocate", [{ project: prj.id }, it.id, 5])]);
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1, "exactly one allocation of the 5 succeeds");
  assert.ok(res.filter((r) => r.status === "rejected").every((r: any) => /Only 0 free|not free/.test(r.reason.message)));
  assert.deepEqual(await stock(it.id), { Allocated: 5, Available: 0 });
  assert.equal((await svc("select coalesce(sum(qty), 0)::float q from mfg_allocs where item_id = $1 and status = 'active'", [it.id]))[0].q, 5);
  EV.scenarios.s8 = { concurrent: 3, succeeded: 1, allocated: 5 };
});

test("Scenario 23 — eight concurrent completions consume from an allocation of 5: never negative, an exact history", async () => {
  const it = await item("Race consumable", { item_type: "Consumable" });
  // a draft C20 revision would not change the unit: allocate to the unit with an Inventory Manager's reason (not in its BOM is refused)
  await fails(call("mfg", "mfg_allocate", [{ unit: S.unit.id }, it.id, 1]), /not in the unit's BOM/);
  const p3 = S.items[4]; // the alternate fan of the C20 BOM (not required on its own)
  await call("mfg", "mfg_adjust", [p3.id, S.store, "Available", 5, "Count for the consumption race"]);
  await call("mfg", "mfg_allocate", [{ unit: S.unit.id }, p3.id, 5, null, null, null, "Five for the race test (more than the BOM needs)"]);
  const wos = [];
  for (let n = 0; n < 8; n++) { const w = await call("mfg", "mfg_wo_create", [S.unit.id, { name: `Race ${n}`, assignee_id: U.tech.id }]); await call("tech", "mfg_wo_start", [w.id]); wos.push(w.id); }
  const res = await Promise.allSettled(wos.map((w) => call("tech", "mfg_wo_complete", [w, { consumed: [{ item: p3.id, qty: 1 }] }])));
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 5);
  assert.ok(res.filter((r) => r.status === "rejected").every((r: any) => /allocated to this unit|Not enough/.test(r.reason.message)), "the rest are refused with the reason");
  assert.equal((await stock(p3.id)).Allocated || 0, 0); assert.ok(((await stock(p3.id)).Available || 0) >= 0);
  const tx = await svc("select count(*)::int n, sum(qty)::float q from mfg_txns where item_id = $1 and kind = 'consume' and unit_id = $2", [p3.id, S.unit.id]);
  assert.equal(tx[0].n, 5); assert.equal(tx[0].q, 5);
  assert.equal((await svc("select count(*)::int n from mfg_stock where qty < 0"))[0].n, 0);
  assert.equal((await svc("select count(*)::int n from records where id = any($1) and status = 'In Progress'", [wos]))[0].n, 3, "the refused completions stay in progress (all or nothing)");
  EV.scenarios.s23 = { concurrent: 8, allocated: 5, consumed: 5, refused: 3 };
});

/* ------------------------------------------- Scenario 9: work order ------------------------------------------- */
test("Scenario 9 — work order: start → consume material → install serial → complete; inventory and As-Built trace it", async () => {
  const p0 = S.items[0];
  await call("mfg", "mfg_allocate", [{ unit: S.unit.id }, p0.id, 6]);
  const elec = (await svc("select * from records where section = 'operations.work_orders' and data->>'build_ref' = $1 and data->>'routing_key' = 'elec'", [S.unit.id]))[0];
  assert.equal(elec.status, "Ready", "its prerequisite is completed");
  await fails(call("emp", "mfg_wo_start", [elec.id]), /not found|assigned/);
  await call("tech", "mfg_wo_start", [elec.id]);
  const e2 = await get(elec.id); assert.equal(e2.data.started_by_id, U.tech.id); assert.ok(e2.data.started_at);
  await fails(call("tech", "mfg_wo_complete", [elec.id, { consumed: [{ item: p0.id, qty: 7 }] }]), /allocated to this unit/);
  const c = await call("tech", "mfg_wo_complete", [elec.id, { consumed: [{ item: p0.id, qty: 6 }], software: [{ component: "AGRON 1 release", version: "1.0.0", checksum: "sha256:abcdef0123456789" }], notes: "Done" }]);
  assert.equal(c.status, "Completed"); assert.ok(c.inspection, "an inspection step leaves an inspection to record");
  const st = await stock(p0.id); assert.equal(st.Allocated || 0, 2, "only the other unit's 2 stay allocated");
  const led = await svc("select kind, qty::float, wo_id from mfg_txns where unit_id = $1 and item_id = $2 and kind = 'consume'", [S.unit.id, p0.id]);
  assert.equal(led.reduce((a: number, r: any) => a + Number(r.qty), 0), 6); assert.ok(led.every((r: any) => r.wo_id === elec.id));
  await fails(upd("tech", elec.id, { data: { notes: "rewrite history" } }), /completed work order/);
  await fails(call("tech", "mfg_wo_complete", [elec.id, {}]), /completed already/);
  S.elec = await get(elec.id); S.inspElec = c.inspection;
  EV.scenarios.s9 = { work_order: e2.data.number, consumed: 6, inspection: c.inspection };
});

/* ------------------------------------------- Scenario 10 & 11: failed inspection, rework ------------------------------------------- */
test("Scenario 10 & 11 — a failed inspection opens a linked nonconformance; rework → reinspection; the failure stays as recorded", async () => {
  const insp = await get(S.inspElec);
  assert.equal(insp.data.work_order_ref, S.elec.id); assert.equal(insp.data.build_ref, S.unit.id);
  await fails(call("tech", "mfg_inspection_record", [insp.id, { result: "Pass" }]), /Quality Inspector/);
  const r = await call("quality", "mfg_inspection_record", [insp.id, { result: "Fail", notes: "Torque below specification on two lugs", severity: "High" }]);
  const nc = await get(r.issue);
  assert.equal(nc.section, "company.issues"); assert.equal(nc.data.type, "Nonconformance");
  assert.equal(nc.data.build_ref, S.unit.id); assert.equal(nc.data.work_order_ref, S.elec.id); assert.equal(nc.data.inspection_ref, insp.id);
  await fails(call("quality", "mfg_inspection_record", [insp.id, { result: "Pass" }]), /recorded already/);
  await fails(upd("quality", insp.id, { data: { result: "Pass" } }), /stays as recorded|Record result/);
  // Use As Is needs the Quality Approver — not a technician, not an inspector
  await fails(call("tech", "mfg_nc_disposition", [nc.id, "Use As Is", "Looks fine to me"]), /Quality Approver/);
  await fails(call("quality", "mfg_nc_disposition", [nc.id, "Use As Is", "Looks fine to me"]), /Quality Approver/);
  await call("quality", "mfg_nc_disposition", [nc.id, "Rework", "Re-torque the lugs to specification"]);
  const rw = await call("mfg", "mfg_rework_create", [nc.id, { assignee_id: U.tech.id }]);
  const rwo = await get(rw.id); assert.equal(rwo.data.rework_of, nc.id); assert.equal(rwo.data.original_wo, S.elec.id); assert.equal(rwo.data.reinspection_of, insp.id);
  await call("tech", "mfg_wo_start", [rw.id]);
  const rc = await call("tech", "mfg_wo_complete", [rw.id, { notes: "Re-torqued" }]);
  const re = await get(rc.inspection); assert.ok(re, "the rework leaves a reinspection");
  assert.equal(re.data.reinspection_of, insp.id, "the reinspection links back to the original inspection"); assert.equal(re.data.issue_ref, nc.id);
  await fails(call("qapp", "mfg_nc_close", [nc.id, "Closing early"]), /not passed reinspection/);
  await call("quality", "mfg_inspection_record", [re.id, { result: "Pass" }]);
  assert.equal((await get(nc.id)).status, "Verification");
  await call("qapp", "mfg_nc_close", [nc.id, "Reinspection passed"]);
  const orig = await get(insp.id); assert.equal(orig.data.result, "Fail", "the original failure is kept"); assert.equal(orig.status, "Non-conformance");
  assert.equal((await get(nc.id)).status, "Closed");
  EV.scenarios.s10 = { inspection: insp.data.number, issue: nc.data.number };
  EV.scenarios.s11 = { rework: rwo.data.number, reinspection: re.data.number, original_result: orig.data.result };
});

/* ------------------------------------------- Scenario 12: tests ------------------------------------------- */
test("Scenario 12 — a required test fails: deterministic limits, a person's result, and the unit cannot become Ready for Shipment", async () => {
  const fields = [{ key: "voltage", name: "Output voltage", type: "number", unit: "V", min: 228, max: 232 }, { key: "ups_ok", name: "UPS switch-over", type: "boolean", expected: "true" }, { key: "note", name: "Observations", type: "text", required: false }];
  assert.deepEqual(await call("eng", "mfg_procedure_check", [[{ key: "Bad Key", type: "number" }]]), ["a field key is 1–40 lower-case letters, digits or _"]);
  const tp = await ins("eng", "technical.test_procedures", "Power test", "Draft", { category: "Power", fields });
  await call("eng", "mfg_def_submit", [tp.id]); await approveAll(tp.id, ["tapp"]);
  S.tp = await get(tp.id);
  // the configuration v2 requires the power test (approved below); the unit keeps v1 — so a dedicated unit on v2
  await upd("eng", S.cfgV2.id, { data: { required_tests: [S.tp.data.code], required_inspections: ["Final Inspection"] } });
  await call("eng", "mfg_def_submit", [S.cfgV2.id]); await approveAll(S.cfgV2.id, ["eng2", "mfg"]);
  assert.equal((await get(S.cfg.id)).status, "Superseded", "the earlier version is superseded when the new one is approved");
  const u = await call("mfg", "mfg_unit_create", [{ product: S.product.id, config: S.cfgV2.id, title: `${tag} C20 tested` }]);
  S.unitT = await get(u.id);
  const t = await call("tester", "mfg_test_create", [u.id, tp.id, { operator_id: U.tester.id }]);
  await fails(call("tester", "mfg_test_record", [t.id, { values: { voltage: 240, ups_ok: true }, outcome: "Pass" }]), /cannot be Pass.*outside the limits/);
  await fails(call("tester", "mfg_test_record", [t.id, { values: { voltage: 230 }, outcome: "Pass" }]), /values missing/);
  await fails(call("tester", "mfg_test_record", [t.id, { values: { voltage: 230, ups_ok: true } }]), /never assumed/);
  const rec = await call("tester", "mfg_test_record", [t.id, { values: { voltage: 240, ups_ok: true }, outcome: "Fail", notes: "Voltage above the limit at full load" }]);
  assert.equal(rec.outcome, "Fail"); assert.equal(rec.check, "Fail"); assert.ok(rec.issue);
  const vals = await svc("select key, pass, rule from mfg_test_values where run_id = $1 order by id", [t.id]);
  assert.equal(vals.find((v: any) => v.key === "voltage").pass, false); assert.equal(vals.find((v: any) => v.key === "ups_ok").pass, true);
  await fails(call("tester", "mfg_test_record", [t.id, { values: { voltage: 230, ups_ok: true }, outcome: "Pass" }]), /recorded already/);
  const rd = await call("mfg", "mfg_readiness", [u.id]);
  assert.equal(rd.acceptance.status, "Not Ready");
  assert.ok(rd.acceptance.reasons.some((x: any) => /Required test .* failed/.test(x.text)));
  await fails(call("acceptor", "mfg_accept", [u.id, {}]), /Not ready for acceptance/);
  await fails(upd("mfg", u.id, { status: "Ready for Shipment" }), /acceptance|no exception replaces/);
  await fails(call("mfg", "mfg_unit_status", [u.id, "Ready for Shipment"]), /Unit acceptance/);
  // a passing retest is a new run; it still needs a Test Approver who is not the operator
  const t2 = await call("tester", "mfg_test_create", [u.id, tp.id, {}]);
  await call("tester", "mfg_test_record", [t2.id, { values: { voltage: 230.5, ups_ok: true }, outcome: "Pass" }]);
  await fails(call("tester", "mfg_test_approve", [t2.id]), /Test Approver/);
  await call("tapp", "mfg_test_approve", [t2.id]);
  const rd2 = await call("mfg", "mfg_readiness", [u.id]);
  assert.ok(!rd2.acceptance.reasons.some((x: any) => /test/.test(x.text) && x.level === "block" && !/Issue/.test(x.text)), "the test rule is met after the approved retest");
  EV.scenarios.s12 = { procedure: S.tp.data.code, failed: t.number, readiness: rd.acceptance.status, retest: t2.number };
});

/* ------------------------------------------- Scenario 15, 16, 17: alternates, As-Built, software ------------------------------------------- */
test("Scenario 15 & 16 & 17 — an approved alternate installed shows in the As-Built; planned vs built is deterministic; software history", async () => {
  const [p0, , , p3, p4] = S.items;
  // procurement proposes, engineering authority approves (procurement cannot)
  const alt = await call("proc", "mfg_alt_propose", [p3.id, S.items[6].id, "units", null, [S.unit.id], "Primary fan out of stock for months"]);
  await fails(call("proc", "mfg_alt_decide", [alt.id, "Approved", null]), /Engineering Change Approver|BOM Approver/);
  await fails(call("mfg", "mfg_alt_decide", [alt.id, "Approved", null]), /Engineering Change Approver|BOM Approver/);
  await call("eng2", "mfg_alt_decide", [alt.id, "Approved", "Same airflow; checked"]);
  await call("mfg", "mfg_adjust", [S.items[6].id, S.store, "Available", 2, "Alternate fans counted"]);
  await call("mfg", "mfg_allocate", [{ unit: S.unit.id }, S.items[6].id, 2, null, null, null, "Approved alternate for the fans"]);
  const w = await call("mfg", "mfg_wo_create", [S.unit.id, { name: "Fans", assignee_id: U.tech.id }]);
  await call("tech", "mfg_wo_start", [w.id]);
  await call("tech", "mfg_wo_complete", [w.id, { installed: [{ item: S.items[6].id, qty: 2, position: "Fan bay" }], software: [{ component: "AGRON 1 release", version: "1.1.0" }] }]);
  await fails(call("mfg", "mfg_software_install", [S.unit.id, { component: "Configuration profile", version: "p1", config_ref: "password=hunter2" }]), /secrets are not stored/);
  const g = await call("mfg", "mfg_asbuilt_generate", [S.unit.id]);
  assert.equal(g.revision, 1);
  const ab = await call("eng", "mfg_asbuilt", [S.unit.id]);
  assert.equal(ab.stale, false);
  const snap = ab.snapshot;
  assert.ok(snap.installed.some((x: any) => x.item === S.items[6].id && Number(x.qty) === 2), "the alternate actually installed");
  assert.ok(!snap.installed.some((x: any) => x.item === p3.id), "not the BOM's original fan");
  assert.ok(snap.substitutions.some((x: any) => x.original === p3.data.number), "the approved substitution is listed");
  assert.ok(snap.installed.some((x: any) => x.serial === `S100-${run}`), "the serial installed");
  const sw = snap.software.find((x: any) => x.component === "AGRON 1 release");
  assert.equal(sw.version, "1.1.0", "the current version"); assert.equal(Number(sw.previous), 1, "the earlier version is kept in the history");
  assert.equal((await svc("select count(*)::int n from mfg_software where unit_id = $1 and component = 'AGRON 1 release'", [S.unit.id]))[0].n, 2);
  const cmp = await call("eng", "mfg_planned_vs_built", [S.unit.id]);
  const fan = cmp.rows.find((r: any) => r.expected.id === p3.id); assert.equal(fan.status, "substitute");
  const comp = cmp.rows.find((r: any) => r.expected.id === S.serialItem.id); assert.equal(comp.status, "match"); assert.deepEqual(comp.serials, [`S100-${run}`]);
  const rack = cmp.rows.find((r: any) => r.expected.id === p0.id); assert.equal(rack.status, "quantity difference"); assert.equal(Number(rack.difference), -4);
  const cells = cmp.rows.find((r: any) => r.expected.id === S.items[1].id); assert.equal(cells.status, "missing");
  assert.deepEqual(await call("eng", "mfg_planned_vs_built", [S.unit.id]), cmp, "deterministic");
  // a change after generation makes the As-Built out of date
  await call("mfg", "mfg_software_install", [S.unit.id, { component: "Edge Runtime release", version: "2.0" }]);
  assert.equal((await call("eng", "mfg_asbuilt", [S.unit.id])).stale, true);
  EV.scenarios.s15 = { alternate: alt.id, installed: S.items[6].data.number };
  EV.scenarios.s16 = { rows: cmp.rows.length, substitute: 1, missing: cmp.rows.filter((r: any) => r.status === "missing").length };
  EV.scenarios.s17 = { versions: ["1.0.0", "1.1.0"], current: sw.version };
});

/* ------------------------------------------- Scenario 13 & 14: engineering change and effectivity ------------------------------------------- */
test("Scenario 13 & 14 — an approved change applies from unit 5: units 1–4 keep their revision, completed units are never retrofitted", async () => {
  // five units of the C40 pilot (revision A of its BOM)
  const cfg40 = (await get(S.u40.id)).data.config_ref;
  const units = [S.u40.id];
  for (let n = 0; n < 4; n++) units.push((await call("mfg", "mfg_unit_create", [{ product: S.product40.id, config: cfg40, title: `${tag} C40 #${n + 2}` }])).id);
  const seqs = await Promise.all(units.map(async (id) => Number((await get(id)).data.unit_seq)));
  const ecr = await get((await call("eng", "ops_request_create", ["change", `${tag} Edge computer gets a second unit`, { reason: "Redundancy for C40" }, "High"])).record);
  const nb = await call("eng", "mfg_def_new_version", [S.b40.id, "Redundant edge computer (ECR)", ecr.id]);
  await call("eng", "mfg_bom_lines_save", [nb.id, [{ key: "1", item: S.serialItem.id, qty: 2 }]]);
  await call("eng", "mfg_bom_effectivity", [nb.id, { kind: "after_unit", from_seq: seqs[4] }]);
  const cand = await call("eng", "mfg_ecr_candidates", [ecr.id]);
  assert.ok(cand.unit.length >= 5 && cand.note.match(/Suggestions only/));
  await call("eng2", "mfg_ecr_confirm", [ecr.id, [{ kind: "bom", id: S.b40.id }, ...units.map((id) => ({ kind: "unit", id }))]]);
  await call("eng", "mfg_def_submit", [nb.id]); await approveAll(nb.id, ["eng2", "mfg"]);
  const imp = await call("eng2", "mfg_change_impact", [ecr.id]);
  const st = (id: string) => imp.affected_builds.find((x: any) => x.unit === id)?.state;
  assert.equal(st(units[4]), "needs a decision", "unit 5 is reached by the change");
  for (const id of units.slice(0, 4)) assert.equal(st(id), undefined, "units 1–4 are outside the effectivity");
  for (const id of units.slice(0, 4)) assert.equal((await get(id)).data.bom_ref, S.b40.id, "units 1–4 keep revision A");
  assert.ok((await call("mfg", "mfg_readiness", [units[4]])).blockers.some((b: any) => b.kind === "ecr_impact"), "an undecided change blocks unit 5");
  await fails(call("mfg", "mfg_unit_disposition", [nb.id, units[4], "Incorporate", "Build with redundancy"]), /Engineering Change Approver/);
  await fails(call("eng2", "mfg_unit_disposition", [nb.id, units[0], "Incorporate", "Retrofit the first"]), /does not reach/);
  await call("eng2", "mfg_unit_disposition", [nb.id, units[4], "Incorporate", "Build with redundancy"]);
  const u5 = await get(units[4]); assert.equal(u5.data.bom_ref, nb.id); assert.equal(u5.data.pin_history.length, 2, "the re-pin is in the unit's history");
  const u6 = await call("mfg", "mfg_unit_create", [{ product: S.product40.id, config: cfg40, title: `${tag} C40 #6` }]);
  assert.equal(u6.bom, nb.id, "a new unit takes the revision that applies to it");
  EV.scenarios.s14 = { from_seq: seqs[4], units_1_4: "revision A", unit_5: "Incorporate → new revision", unit_6: "new revision" };
  // Scenario 13: a completed (accepted) unit is unchanged by an approved change for all future units
  S.ecr = ecr; S.units40 = units;
});

/* ------------------------------------------- Scenario 18, 19 and 13: acceptance, shipment, completed unit unchanged ------------------------------------------- */
test("Scenario 18, 19 & 13 — acceptance readiness says exactly what is missing; shipment release needs its authority; an accepted unit keeps its As-Built", async () => {
  const u = S.u40.id;
  // finish the work of the unit (the edge computer is the C40 BOM)
  const s101 = (await svc("select * from mfg_serials where serial = $1", [`S101-${run}`]))[0];
  await call("mfg", "mfg_allocate", [{ unit: u }, S.serialItem.id, null, null, null, [s101.id]]);
  await call("tech", "mfg_wo_complete", [S.wo40.id, { installed: [{ item: S.serialItem.id, serial_id: s101.id, position: "Compute" }] }]);
  let rd = await call("mfg", "mfg_readiness", [u]);
  assert.equal(rd.acceptance.status, "Not Ready");
  assert.ok(rd.acceptance.reasons.some((x: any) => x.text === "Required Final Inspection not recorded"), "the exact reason");
  assert.ok(rd.acceptance.reasons.some((x: any) => x.text === "As-Built not generated"));
  const fi = await call("mfg", "mfg_inspection_create", [{ kind: "Final Inspection", unit: u }]);
  await call("quality", "mfg_inspection_record", [fi.id, { result: "Pass" }]);
  await call("mfg", "mfg_asbuilt_generate", [u]);
  await call("mfg", "mfg_shipping_save", [u, { destination: "Jebel Ali (synthetic)" }]);
  await upd("mfg", u, { data: { export_check: "Cleared" } });
  rd = await call("mfg", "mfg_readiness", [u]);
  assert.equal(rd.acceptance.status, "Ready", JSON.stringify(rd.acceptance.reasons));
  await fails(call("mfg", "mfg_accept", [u, {}]), /Unit Acceptance Approver/);
  const acc = await call("acceptor", "mfg_accept", [u, { checklist: [{ key: "visual", ok: true }] }]);
  assert.equal(acc.status, "Accepted"); assert.match(acc.note, /not an external certification/);
  assert.equal((await get(u)).status, "Ready for Shipment");
  await fails(call("mfg", "mfg_asbuilt_generate", [u]), /stays as accepted/);
  await fails(call("mfg", "mfg_software_install", [u, { component: "Firmware", version: "9" }]), /not modified/);
  // Scenario 19: acceptance complete, but releasing the shipment needs the Shipment Release Approver
  await fails(call("acceptor", "mfg_ship_release", [u, {}]), /Shipment Release Approver/);
  await fails(call("mfg", "mfg_ship_release", [u, {}]), /Shipment Release Approver/);
  await fails(call("shipper", "mfg_ship_release", [u, {}]), /Not ready to ship: .*requested ship date/);
  await call("mfg", "mfg_shipping_save", [u, { requested_date: D(5), packing: "Packed", logistics_owner_id: U.mfg.id, documents: { "Packing list": true, "Commercial invoice": true, "As-Built configuration": true } }]);
  const rel = await call("shipper", "mfg_ship_release", [u, { carrier: "Synthetic Line", reference: `SHP-${run}` }]);
  assert.equal(rel.status, "Shipped"); assert.equal((await get(u)).status, "Shipped");
  await fails(call("shipper", "mfg_ship_release", [u, {}]), /released already/);
  // Scenario 13: an approved change for all future units does not touch this completed unit
  const before = await call("eng", "mfg_asbuilt", [u]);
  const bomNow = (await get(u)).data.bom_ref;
  const ecr2 = await get((await call("eng", "ops_request_create", ["change", `${tag} Future units: one more cable`, { reason: "Cable management" }, null])).record);
  const latest = (await svc("select id from records where section = 'technical.boms' and data->>'number' = $1 and status = 'Approved' order by data->>'approved_at' desc limit 1", [(await get(S.b40.id)).data.number]))[0].id;
  const nb = await call("eng", "mfg_def_new_version", [latest, "One more cable for future units", ecr2.id]);
  await call("eng", "mfg_bom_effectivity", [nb.id, { kind: "immediate" }]);
  await call("eng", "mfg_def_submit", [nb.id]); await approveAll(nb.id, ["eng2", "mfg"]);
  const imp = await call("eng2", "mfg_change_impact", [ecr2.id]);
  assert.match(imp.affected_builds.find((x: any) => x.unit === u).state, /completed — not changed/);
  await fails(call("eng2", "mfg_unit_disposition", [nb.id, u, "Incorporate", "Retrofit it"]), /completed: it keeps its configuration/);
  assert.equal((await get(u)).data.bom_ref, bomNow, "the completed unit keeps its revision");
  const after = await call("eng", "mfg_asbuilt", [u]);
  assert.equal(after.hash, before.hash, "its As-Built is unchanged"); assert.equal(after.accepted_revision, before.revision);
  EV.scenarios.s18 = { first: "Not Ready", reason: "Required Final Inspection not recorded", then: "Ready" };
  EV.scenarios.s19 = { acceptor_release: "refused", shipper_release: "Shipped" };
  EV.scenarios.s13 = { unit: (await get(u)).data.number, revision_kept: true, asbuilt_hash: after.hash };
});

/* ------------------------------------------- Scenario 20: restricted build ------------------------------------------- */
test("Scenario 20 — a US-persons-only build and a restricted build leak nothing: no unit, count, item, serial, cost, shortage or Assistant answer", async () => {
  const uc = await call("mfg", "mfg_unit_create", [{ product: S.product.id, config: S.cfgV2.id, title: `${tag} US-only unit`, controlled: true }]);
  const ur = await call("mfg", "mfg_unit_create", [{ product: S.product.id, config: S.cfgV2.id, title: `${tag} restricted unit`, restricted: true, team_ids: [U.mfg.id] }]);
  // a US-only item with a serial installed in the US-only unit
  await svc("insert into mfg_serials(item_id, serial, state, unit_id) values ($1, $2, 'Installed', $3)", [S.usItem.id, `USX-${run}`, uc.id]);
  const nonusOv = await call("nonus", "mfg_overview", []);
  const ownerOv = await call("owner", "mfg_overview", []);
  assert.ok(ownerOv.units >= nonusOv.units + 1);
  const list = await call("nonus", "mfg_list", ["all", {}]);
  assert.ok(!list.some((x: any) => x.id === uc.id), "no US-only unit in the lists");
  await fails(call("nonus", "mfg_unit_view", [uc.id]), /not found/);
  await fails(call("nonus", "mfg_unit_cost", [uc.id]), /not found|cost policy/);
  assert.equal((await call("nonus", "mfg_serial_search", [`USX-${run}`])).length, 0, "no serial");
  assert.equal((await call("nonus", "mfg_inventory", [S.usItem.data.number])).length, 0, "no item stock");
  const plan = await call("nonus", "mfg_material_plan", [{ unit: uc.id }]); assert.equal(plan.units.length, 0, "no shortage");
  const a = await call("nonus", "mfg_assistant", ["status", (await get(uc.id)).data.number]); assert.equal(a.kind, "unavailable");
  const cs = await as("nonus", "select * from corp_search($1)", [(await get(uc.id)).data.number]); assert.equal(cs.length, 0, "search finds nothing");
  assert.equal((await call("nonus", "mfg_resolve", [`AGR1:unit:${uc.id}`])).found, false, "a scanned code opens nothing");
  // the restricted (not US-only) unit: the technician outside its team does not see it; its team member does
  await fails(call("tech", "mfg_unit_view", [ur.id]), /not found/);
  assert.ok(await call("mfg", "mfg_unit_view", [ur.id]));
  const pr = await call("mfg", "mfg_shortage_request", [ur.id, S.items[0].id, 1, null, null]);
  assert.equal((await get(pr.record)).data.build_ref_title, undefined, "the purchase request does not name the restricted unit");
  EV.security.restricted = { nonus_units: nonusOv.units, owner_units: ownerOv.units, serial: 0, search: 0, assistant: a.kind };
});

/* ------------------------------------------- Scenario 21 & 22: System Administrator, Policy Approver ------------------------------------------- */
test("Scenario 21 — a System Administrator without manufacturing capabilities cannot approve a BOM, adjust inventory, accept a unit or release a shipment", async () => {
  const caps = await call("admin", "mfg_my_caps", []);
  assert.ok(Object.values(caps).every((v) => v === false), "no manufacturing capability by role");
  await fails(call("admin", "mfg_adjust", [S.items[0].id, S.store, "Available", 99, "Admin count"]), /Inventory Manager/);
  await fails(call("admin", "mfg_accept", [S.unitT.id, {}]), /Unit Acceptance Approver/);
  await fails(call("admin", "mfg_ship_release", [S.unitT.id, {}]), /Shipment Release Approver/);
  await fails(call("admin", "mfg_def_new_version", [S.bomB.id, "Admin revision"]), /BOM Editor/);
  await fails(call("admin", "mfg_settings_save", [{ late_purchase_grace_days: 3 }, 1]), /Manufacturing Admin/);
  const b = await call("eng", "mfg_bom_create", [S.cfgV2.id]);
  await call("eng", "mfg_bom_lines_save", [b.id, [{ key: "1", item: S.items[0].id, qty: 1 }]]);
  await call("eng", "mfg_def_submit", [b.id]);
  const ap = await svc("select approver_id from approvals where record_id = $1 and status = 'pending'", [b.id]);
  assert.ok(!ap.some((a: any) => a.approver_id === U.admin.id), "no approval is ever given to the System Administrator by role");
  await fails(as("admin", "update records set status = 'Approved' where id = $1", [b.id]), /changes through|in approval/);
  EV.scenarios.s21 = { admin_caps: 0, refused: ["adjust", "accept", "ship_release", "bom_revision", "settings", "approve"] };
});

test("Scenario 22 — a Workflow Admin without the Policy Approver capability cannot confirm a business authority policy", async () => {
  let g = await call("mgmt", "ops_settings_get", []);
  // an earlier run on this database may have confirmed it: an edit makes it a Draft again (the rule under test)
  const b0 = g.policies.find((x: any) => x.code === "BOM");
  if (b0.config_status === "Approved") { await call("owner", "ops_policy_save", ["BOM", b0.name, b0.tiers, true]); g = await call("mgmt", "ops_settings_get", []); }
  const bom = g.policies.find((x: any) => x.code === "BOM"); assert.equal(bom.label, "UNAPPROVED DEFAULT CONFIGURATION");
  const pur = g.policies.find((x: any) => x.code === "PURCHASE");
  assert.equal(g.can_edit, true, "management holds Workflow Admin by policy");
  await fails(call("mgmt", "ops_policy_approve", ["PURCHASE", pur.version]), /Policy Approver/);
  await fails(call("mgmt", "ops_policy_approve", ["BOM", bom.version]), /Policy Approver/);
  await fails(call("admin", "ops_policy_approve", ["BOM", bom.version]), /Policy Approver/);
  const ok = await call("policy", "ops_policy_approve", ["BOM", bom.version]);
  assert.equal(ok.status, "Approved");
  const g2 = await call("policy", "ops_settings_get", []); assert.equal(g2.policies.find((x: any) => x.code === "BOM").label, "AGRON policy (approved)");
  assert.equal(g2.can_approve_policies, true);
  EV.scenarios.s22 = { workflow_admin: "refused", policy_approver: "approved" };
});

/* ------------------------------------------- Scenario 24: QR ------------------------------------------- */
test("Scenario 24 — scanning a unit, a serial or a work order opens the right record for an authorized person only", async () => {
  const lu = await call("mfg", "mfg_label", ["unit", S.unit.id]);
  assert.equal(lu.qr, `AGR1:unit:${S.unit.id}`); assert.equal(lu.footer, "AGRON internal label");
  const r1 = await call("tech", "mfg_resolve", [lu.qr]); assert.equal(r1.found, true); assert.equal(r1.link, `/mfg?unit=${S.unit.id}`);
  const r2 = await call("tech", "mfg_resolve", [`S100-${run}`]); assert.equal(r2.kind, "serial");
  const r3 = await call("tech", "mfg_resolve", [S.elec.data.number]); assert.equal(r3.kind, "work_order"); assert.equal(r3.link, `/build?wo=${S.elec.id}`);
  const r4 = await call("tech", "mfg_resolve", ["LOC:STORE"]); assert.equal(r4.kind, "location");
  assert.equal((await call("partner", "mfg_resolve", [lu.qr]).catch(() => ({ found: false }))).found, false, "an external partner opens nothing");
  assert.equal((await call("nonus", "mfg_resolve", [`AGR1:item:${S.usItem.id}`])).found, false, "a US-persons-only item stays closed to a non-US person");
  assert.equal((await call("tech", "mfg_resolve", ["AGR1:unit:00000000-0000-0000-0000-000000000000"])).found, false);
  const ls = await call("mfg", "mfg_label", ["serial", S.s100.id]); assert.equal(ls.big, `S100-${run}`);
  EV.scenarios.s24 = { unit: r1.kind, serial: r2.kind, work_order: r3.kind, unauthorized: false };
});

/* ------------------------------------------- read models, import/export, settings, notices ------------------------------------------- */
test("Dashboard numbers are the counts of the lists they open; Executive Control, weekly review, Today and the product view", async () => {
  const ov = await call("mfg", "mfg_overview", []);
  for (const k of ["units", "ready_for_build", "in_assembly", "blocked", "shortages", "late_purchases", "ready_acceptance", "ready_shipment", "inspections_required", "failed_tests", "nonconformances"]) {
    const l = await call("mfg", "mfg_list", [k, {}]);
    assert.equal(l.length, Number(ov[k]), `${k}: number = list`);
  }
  const ex = await call("mfg", "mfg_exec", []);
  assert.equal(ex.blocked, ov.blocked); assert.equal(ex.links.blocked, "/mfg?list=blocked");
  const wk = await call("mfg", "mfg_weekly", []);
  for (const k of ["active", "progress", "blockers", "shortages", "procurement_risk", "engineering_changes", "nonconformance", "testing", "acceptance", "shipment", "next_actions"]) assert.ok(k in wk, k);
  const td = await call("tech", "mfg_today", []); assert.ok(Array.isArray(td.work));
  const pv = await call("mfg", "mfg_product_view", [S.product.id]);
  assert.ok(pv.configurations.length >= 2 && pv.units.length >= 2);
  assert.ok(Array.isArray(pv.cost), "a Build Manager is named by the cost policy");
  const tp = await call("tech", "mfg_product_view", [S.product.id]); assert.equal(tp.cost, null, "a technician gets no costs");
  EV.rules.dashboard = ov;
});

test("Cost and value: operational only, currencies never added, labels say so; supplier facts without scores", async () => {
  await fails(call("tech", "mfg_unit_cost", [S.unit.id]), /cost policy/);
  const c = await call("fin", "mfg_unit_cost", [S.unit.id]);
  assert.match(c.label, /Operational build cost — not accounting cost/);
  const usd = c.by_currency.find((x: any) => x.currency === "USD"); assert.ok(usd && Number(usd.planned) > 0 && Number(usd.consumed) > 0);
  const eurItem = await item("Euro part", { ref_cost: 50, currency: "EUR" });
  await call("mfg", "mfg_adjust", [eurItem.id, S.store, "Available", 3, "EUR stock"]);
  const v = await call("fin", "mfg_inventory_value", []);
  assert.match(v.label, /Operational Inventory Value — not an accounting inventory valuation/);
  assert.ok(v.by_currency.some((x: any) => x.currency === "EUR") && v.by_currency.some((x: any) => x.currency === "USD"), "currencies apart");
  const sp = await call("proc", "mfg_supplier_performance", [S.vendor.id]);
  assert.equal(sp[0].orders >= 1, true); assert.ok(sp[0].rejected_receipts >= 1); assert.match(sp[0].note, /no score/);
  EV.rules.cost = usd;
});

test("Import / export: preview, duplicates, confirmation, report and rollback; export authorized and audited", async () => {
  const rows = [{ description: `${tag} Imported cable`, manufacturer: "Acme", mpn: `ACM-${run}-0` }, { description: `${tag} New gland`, manufacturer: "Acme", mpn: `GL-${run}`, item_type: "Material" }, { description: "", mpn: "x" }];
  await fails(call("tech", "mfg_import_preview", ["items", rows]), /Manufacturing Admin/);
  const pv = await call("eng", "mfg_import_preview", ["items", rows]);
  assert.equal(pv.rows[0].status, "duplicate"); assert.equal(pv.rows[1].status, "ok"); assert.equal(pv.rows[2].status, "error");
  const cm = await call("eng", "mfg_import_commit", ["items", rows, { "1": "use" }, "items.csv"]);
  assert.equal(cm.created, 1); assert.equal(cm.linked, 1); assert.equal(cm.skipped, 1);
  const created = (await svc("select * from records where data->>'import_batch' = $1", [cm.batch]))[0];
  assert.match(created.data.number, /^AGR-ITM-/);
  await fails(call("eng", "mfg_import_rollback", [cm.batch]), /Manufacturing Admin/);
  const rb = await call("owner", "mfg_import_rollback", [cm.batch]); assert.equal(rb.removed, 1);
  // a BOM draft import never touches an approved revision
  await fails(call("eng", "mfg_import_commit", ["bom", [{ item: S.items[0].data.number, qty: 1 }], {}, "bom.csv", S.bomA.id]), /Draft revision only/);
  await fails(call("tech", "mfg_export", ["inventory", null]), /Build Manager/);
  const ex = await call("mfg", "mfg_export", ["units", null]); assert.ok(ex.rows.length > 0);
  assert.ok((await svc("select count(*)::int n from mfg_audit where kind = 'export' and actor = $1", [U.mfg.id]))[0].n >= 1, "exports are audited");
  EV.rules.import = cm;
});

test("Settings are validated and kept in history; notices are sent once per occasion", async () => {
  const s = await call("mgmt", "mfg_settings_get", []);
  assert.equal(s.can_edit, false, "management holds no manufacturing capability by default");
  await call("owner", "crm_cap_set", [U.mgmt.id, "manufacturing_admin", true]);
  await fails(call("mgmt", "mfg_settings_save", [{ evil: 1 }, s.version]), /Unknown setting/);
  await fails(call("mgmt", "mfg_settings_save", [{ dispositions: ["Rework"] }, s.version]), /Use As Is stays/);
  await fails(call("mgmt", "mfg_settings_save", [{ build_statuses: [{ status: "A" }, { status: "B" }, { status: "Shipped", kind: "done" }] }, s.version]), /needs the unit acceptance|used by a unit/);
  const ok = await call("mgmt", "mfg_settings_save", [{ late_purchase_grace_days: 2 }, s.version]); assert.equal(ok.version, s.version + 1);
  await fails(call("mgmt", "mfg_settings_save", [{ late_purchase_grace_days: 0 }, s.version]), /changed by someone else/);
  await call("mgmt", "mfg_settings_save", [{ late_purchase_grace_days: 0 }, ok.version]);
  await call("owner", "crm_cap_set", [U.mgmt.id, "manufacturing_admin", false]);
  // the work order of the race test is planned in the past: one notice, not two
  const w = await call("mfg", "mfg_wo_create", [S.unitT.id, { name: "Late work", assignee_id: U.tech.id, planned: D(-3) }]);
  await svc("select public.mfg_tick()"); await svc("select public.mfg_tick()");
  const n = await svc("select count(*)::int n from notifications where user_id = $1 and kind = 'mfg_work_overdue' and record_id = $2", [U.tech.id, w.id]);
  assert.equal(n[0].n, 1);
  assert.equal((await svc("select count(*)::int n from notifications where user_id = $1 and kind = 'mfg_work_assigned' and record_id = $2", [U.tech.id, w.id]))[0].n, 1, "the assignment notice");
});

test("Search and the Assistant: numbers, part numbers and serials; answers cite records", async () => {
  const s1 = await as("tech", "select kind, record_id, link from corp_search($1)", [S.items[0].data.mpn]);
  assert.ok(s1.some((r: any) => r.kind === "item" && r.record_id === S.items[0].id), "by manufacturer part number");
  const s2 = await as("tech", "select kind, link from corp_search($1)", [`S100-${run}`]); assert.ok(s2.some((r: any) => r.kind === "serial"));
  const s3 = await as("tech", "select kind from corp_search($1)", [S.unit.data.number]); assert.ok(s3.some((r: any) => r.kind === "build_unit"));
  const s4 = await as("partner", "select kind from corp_search($1)", [S.unit.data.number]); assert.equal(s4.length, 0, "an external partner finds no build");
  const a1 = await call("mfg", "mfg_assistant", ["building", null]); assert.ok(a1.items.some((x: any) => x.id === S.unit.id));
  const a2 = await call("mfg", "mfg_assistant", ["blocking", S.unit.data.number]); assert.equal(a2.kind, "blockers");
  const a3 = await call("mfg", "mfg_assistant", ["bom_diff", `${S.bomA.data.number} revision A to B`]); assert.equal(a3.kind, "bom_diff"); assert.ok(a3.diff.quantity.length >= 1);
  const a4 = await call("mfg", "mfg_assistant", ["serials", S.unit.data.number]); assert.ok(a4.installed.some((x: any) => x.serial === `S100-${run}`));
  const a5 = await call("mfg", "mfg_assistant", ["software", S.unit.data.number]); assert.ok(a5.items.some((x: any) => x.version === "1.1.0"));
  const a6 = await call("mfg", "mfg_assistant", ["ready_acceptance", S.unit.data.number]); assert.equal(a6.readiness.status, "Not Ready");
  const a7 = await call("mfg", "mfg_assistant", ["status", "C40"]); assert.equal(a7.kind, "unit");
  EV.rules.assistant = ["building", "blocking", "bom_diff", "serials", "software", "ready_acceptance", "status"];
});

/* ------------------------------------------- Security matrix ------------------------------------------- */
test("Security matrix — the manufacturing working set equals row-level security for every role; externals, disabled and admins get no authority", async () => {
  const roles = ["owner", "admin", "mgmt", "mfg", "eng", "proc", "quality", "fin", "sales", "pm", "tech", "emp", "nonus", "partner", "vendor", "contractor", "disabled"];
  const out: Record<string, any> = {};
  for (const k of roles) {
    // what row-level security lets this person read (the API's view)
    let rls: Set<string>;
    try { rls = new Set((await as(k, "select id from records where section = 'operations.builds' and title like $1", [`%${tag}%`])).map((r: any) => r.id)); } catch { rls = new Set(); }
    let mine: Set<string> = new Set();
    try { mine = new Set((await call(k, "mfg_list", ["all", { q: tag }])).map((r: any) => r.id)); } catch (e: any) { assert.match(String(e.message), /Not allowed|Not signed in/); }
    if (["partner", "vendor", "contractor", "disabled"].includes(k)) assert.equal(mine.size, 0, `${k} sees no build`);
    for (const id of mine) assert.ok(rls.has(id), `${k}: the list shows only what row-level security allows`);
    if (!["partner", "vendor", "contractor", "disabled"].includes(k) && rls.size) for (const id of rls) assert.ok(mine.has(id), `${k}: every readable build is in the list`);
    out[k] = { rls: rls.size, list: mine.size };
  }
  // externals and disabled: no inventory, no serial, no item, no dashboard
  for (const k of ["partner", "vendor", "contractor", "disabled"]) {
    await fails(call(k, "mfg_inventory", [null]), /Not allowed|Not signed in/);
    await fails(call(k, "mfg_overview", []), /Not allowed|Not signed in/);
  }
  assert.equal((await as("sales", "select count(*)::int n from records where section = 'technical.boms'"))[0].n, 0, "sales does not read BOMs by default");
  const sv = await call("sales", "mfg_unit_view", [S.unit.id]);
  assert.equal(sv.tabs.bom, false); assert.equal(sv.header.bom, undefined, "sales sees the unit, not its engineering detail");
  const tv = await call("tech", "mfg_unit_view", [S.unit.id]); assert.equal(tv.tabs.cost, false, "a technician sees the work, not the costs");
  assert.equal((await as("proc", "select count(*)::int n from records where section = 'technical.items' and id = $1", [S.usItem.id]))[0].n, 1, "a US-person buyer reads the US-only item");
  assert.equal((await as("nonus", "select count(*)::int n from records where section = 'technical.items' and id = $1", [S.usItem.id]))[0].n, 0);
  // direct table access is closed: only the functions read and write the ledger
  await fails(as("mfg", "select * from mfg_stock limit 1"), /permission denied/);
  await fails(as("admin", "insert into mfg_txns(kind, item_id, qty) values ('adjust', $1, 1)", [S.items[0].id]), /permission denied/);
  await fails(svc("update mfg_txns set qty = 0 where id = (select min(id) from mfg_txns)"), /cannot be changed/);
  EV.security.matrix = out;
});

test("Audit — every manufacturing authority action is in the append-only audit, without document content or secrets", async () => {
  const kinds = (await svc("select distinct kind from mfg_audit")).map((r: any) => r.kind);
  for (const k of ["bom_approved", "bom_revision", "substitution_proposed", "substitution_approved", "inventory_adjustment", "allocation", "work_completed", "inspection", "test", "nonconformance_disposition",
                   "ecr_effectivity", "asbuilt_generated", "unit_acceptance", "shipment_release", "cap_granted", "received", "unit_released", "ecr_disposition", "export", "import"]) assert.ok(kinds.includes(k), `audit of ${k}`);
  await fails(svc("delete from mfg_audit where id = (select min(id) from mfg_audit)"), /cannot be changed/);
  assert.equal((await svc("select count(*)::int n from mfg_audit where detail::text ~* 'password|hunter2'"))[0].n, 0, "no secrets in the audit");
  EV.rules.audit = kinds.length;
});
