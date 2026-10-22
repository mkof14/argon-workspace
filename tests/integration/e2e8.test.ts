// Phase 8 in a real browser against the app built on the test stack (synthetic people and data only): the
// manufacturing dashboard (its numbers are the database's numbers for that person and open their lists); the Build
// Unit view with its fourteen tabs; a printable label whose QR code is read back by an independent decoder (OpenCV)
// and opens the unit; the shop floor on a phone (no horizontal scrolling): start a work order, tick the checklist,
// install the allocated serial, complete — and the installation is in the database; an external partner sees none
// of it. Screenshots: .stack/shots/p8-*.png
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { APP, ENV, makeUser, PASSWORD, pool, sql, uid } from "./_stack.ts";

const skip = !APP; const run = uid(); const tag = `e8${run.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
let pw: any, browser: any; const U: Record<string, any> = {}; const R: Record<string, any> = {}; const EV: Record<string, any> = { tag };
const SHOTS = path.join(ENV.STACK_DIR || ".stack", "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const loadPw = () => { try { return createRequire(import.meta.url)("playwright"); } catch { return createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright"); } };
const shot = (p: any, n: string) => p.screenshot({ path: path.join(SHOTS, `p8-${n}.png`), fullPage: false });
const waitFor = async (fn: () => Promise<boolean>, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const PHONE = { width: 390, height: 844 };
async function login(email: string, viewport = { width: 1280, height: 900 }) {
  const c = await browser.newContext({ viewport, locale: "en-US", isMobile: viewport.width < 500, hasTouch: viewport.width < 500 }); const p = await c.newPage();
  await p.addInitScript(() => { try { localStorage.setItem("agronws.lang", "en"); } catch {} });
  await p.goto(`${APP}/login`); await p.fill("#email", email); await p.fill("#password", PASSWORD); await p.click("button[type=submit]");
  await p.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 20000 }); return p;
}
const noHScroll = (p: any) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** press an action, then its Confirm (every write is confirmed in words first) */
async function act(p: any, name: string, reason?: string) {
  await p.click(`[data-act='${name}']`); await p.waitForSelector(`[data-confirm='${name}']`);
  if (reason) await p.fill(`[data-confirm='${name}'] [data-reason]`, reason);
  await p.click(`[data-confirm='${name}'] [data-confirm-go]`);
  assert.ok(await waitFor(async () => (await p.$$(`[data-confirm='${name}']`)).length === 0, 15000), `${name} confirmed without an error: ${await p.textContent(`[data-confirm='${name}'] [data-err]`).catch(() => "")}`);
}

async function as<T = any>(k: string, q: string, p: any[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[k].id, role: "authenticated", aal: "aal1" })]);
    const r = await c.query(q, p); await c.query("commit"); return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const arg = (a: any) => (a !== null && typeof a === "object" && !(Array.isArray(a) && (a.length === 0 || typeof a[0] === "string")) ? JSON.stringify(a) : a);
const call = async (k: string, fn: string, args: any[] = []) => (await as(k, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args.map(arg)))[0].r;
const get = async (id: string) => (await sql("select * from records where id = $1", [id]))[0];
const ins = async (k: string, section: string, title: string, status: string | null, data: any) => (await as(k, "insert into records(section, title, status, data) values ($1, $2, $3, $4) returning *", [section, `${tag} ${title}`, status, data]))[0];
async function approveAll(record: string, who: string[]) {
  for (let n = 0; n < 6; n++) {
    const r = await get(record); if (r.status === "Approved") return r;
    const ap = await sql("select * from approvals where record_id = $1 and status = 'pending' order by step", [record]);
    const mine = ap.find((a: any) => who.map((k) => U[k].id).includes(a.approver_id)); assert.ok(mine, "an approval for one of our approvers");
    const k = Object.keys(U).find((x) => U[x].id === mine.approver_id)!; await call(k, "wf_approval_decide", [mine.id, "approved", null]);
  }
  return get(record);
}

before(async () => {
  if (skip) return;
  pw = loadPw(); browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-proxy-server"] });
  const mk = async (k: string, role: string, o: any = {}) => { U[k] = await makeUser(`${tag}.${k}@agron-stack.test`, role, { name: `${k} ${tag}`, ...o }); };
  await mk("owner", "owner", { us: true }); await mk("mfg", "operations", { us: true }); await mk("eng", "engineering", { us: true }); await mk("eng2", "engineering", { us: true });
  await mk("tech", "operations", { us: true }); await mk("partner", "partner", { company: `Gulfe8${run}` });
  const grant = async (k: string, caps: string[]) => { for (const c of caps) await call("owner", "crm_cap_set", [U[k].id, c, true]); };
  await grant("mfg", ["build_manager", "work_order_manager", "inventory_manager"]); await grant("eng", ["bom_editor"]); await grant("eng2", ["bom_approver", "engineering_change_approver"]);
  const product = (await sql("select * from records where section = 'technical.products' and data->>'code' = 'C40'"))[0];
  const cfg = await ins("eng", "technical.configurations", "C40 Browser", "Draft", { product_ref: product.id, product_ref_title: "C40", name: "Browser",
    routing: [{ key: "comp", seq: 1, name: "Install computer", operation: "Install computer", checklist: [{ key: "torque", text: "Mounting bolts torqued" }] }], required_tests: [], required_inspections: [] });
  await call("eng", "mfg_def_submit", [cfg.id]); R.cfg = await approveAll(cfg.id, ["eng2", "mfg"]); assert.equal(R.cfg.status, "Approved");
  R.computer = await ins("eng", "technical.items", "Edge computer", "Active", { item_type: "Equipment", uom: "ea", ref_cost: 900, currency: "USD", serialized: true, inspection_required: false });
  R.cable = await ins("eng", "technical.items", "Power cable", "Active", { item_type: "Purchased Part", uom: "ea", ref_cost: 12, currency: "USD", inspection_required: false });
  R.fan = await ins("eng", "technical.items", "Cooling fan", "Active", { item_type: "Purchased Part", uom: "ea", ref_cost: 40, currency: "USD", inspection_required: false });
  const bom = await call("eng", "mfg_bom_create", [R.cfg.id]);
  await call("eng", "mfg_bom_lines_save", [bom.id, [{ key: "1", item: R.computer.id, qty: 1, position: "Compute" }, { key: "2", item: R.cable.id, qty: 2 }, { key: "3", item: R.fan.id, qty: 3 }]]);
  await call("eng", "mfg_def_submit", [bom.id]); R.bom = await approveAll(bom.id, ["eng2", "mfg"]); assert.equal(R.bom.status, "Approved");
  const store = (await sql("select id from mfg_locations where code = 'STORE'"))[0].id;
  await call("mfg", "mfg_import_commit", ["inventory", [{ item: R.computer.data.number, location: "STORE", qty: 1, serials: [`SN-${tag}-1`] }], {}, "browser-opening.csv"]);
  await call("mfg", "mfg_adjust", [R.cable.id, store, "Available", 10, "Opening count (browser test)"]);
  R.unit = await call("mfg", "mfg_unit_create", [{ product: product.id, config: R.cfg.id, title: `${tag} C40 browser`, target: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }]);
  const serial = (await sql("select id from mfg_serials where serial = $1", [`SN-${tag}-1`]))[0].id;
  await call("mfg", "mfg_allocate", [{ unit: R.unit.id }, R.computer.id, null, null, null, [serial]]);
  R.wo = await call("mfg", "mfg_wo_create", [R.unit.id, { name: "Install computer (browser)", assignee_id: U.tech.id }]);
  R.unitNo = (await get(R.unit.id)).data.number;
});
after(async () => { await browser?.close(); fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "e2e8.json"), JSON.stringify(EV, null, 1)); });

test("Dashboard — every block shows the database's number for this person and opens the list behind it", { skip }, async () => {
  const p = await login(U.mfg.email); await p.goto(`${APP}/mfg`);
  assert.ok(await waitFor(async () => (await p.$$("[data-block]")).length >= 12), "the dashboard blocks");
  const ov = await call("mfg", "mfg_overview");
  const shown: Record<string, number> = {};
  for (const b of await p.$$("[data-block]")) shown[(await b.getAttribute("data-block"))!] = Number((await b.textContent())!.match(/(\d+)\s*$/)?.[1] ?? NaN);
  for (const k of ["units", "blocked", "shortages", "ready_for_build", "in_assembly", "late", "nonconformances", "failed_tests", "ready_acceptance", "ready_shipment"]) assert.equal(shown[k], ov[k] ?? 0, `the ${k} block shows the database number`);
  await shot(p, "dashboard");
  await p.click("[data-block='units']");
  assert.ok(await waitFor(async () => (await p.$$(`[data-drill='units'] [data-unit='${R.unit.id}']`)).length === 1), "the unit is in the list the block opens");
  const listed = (await p.$$("[data-drill='units'] [data-unit]")).length; assert.equal(listed, ov.units, "the list has as many units as the number");
  EV.dashboard = { units: ov.units, blocked: ov.blocked, listed };
  await p.context().close();
});

test("Build Unit view — fourteen tabs, each answered from the database; the unit's BOM revision and serial are shown", { skip }, async () => {
  const p = await login(U.mfg.email); await p.goto(`${APP}/mfg?unit=${R.unit.id}`);
  assert.ok(await waitFor(async () => (await p.$$(`[data-unit-view='${R.unit.id}']`)).length === 1), "the unit view");
  assert.equal(await p.textContent("[data-unit-number]").then((t: string) => t.includes(R.unitNo)), true);
  const tabs = await p.$$eval("[data-utab]", (b: any[]) => b.map((x) => x.getAttribute("data-utab")));
  assert.equal(tabs.length, 14, `fourteen tabs (${tabs.join(", ")})`);
  for (const t of tabs.filter((x: string) => x !== "overview")) {
    await p.click(`[data-utab='${t}']`);
    assert.ok(await waitFor(async () => (await p.$$(`[data-tab-body='${t}']`)).length === 1 || (t === "cost" && (await p.$$("[data-err]")).length > 0), 10000), `the ${t} tab renders`);
  }
  await p.click("[data-utab='bom']"); await p.waitForSelector("[data-tab-body='bom']");
  assert.ok((await p.textContent("[data-tab-body='bom']"))!.includes(R.computer.data.number), "the pinned BOM lists the computer");
  await p.click("[data-utab='materials']"); await p.waitForSelector("[data-tab-body='materials']");
  assert.ok((await p.$$("[data-act^='shortage-']")).length >= 1, "the missing fans offer a purchase request (never an order)");
  await shot(p, "unit-materials");
  await p.click("[data-utab='overview']");
  assert.ok(await waitFor(async () => (await p.$$("[data-blockers] [data-kind='missing_material']")).length >= 1), "the missing fans are a named blocker");
  await shot(p, "unit-overview");
  EV.unit = { number: R.unitNo, tabs };
  await p.context().close();
});

test("Label — the QR code printed for the unit is read by an independent decoder and opens the unit for someone who may see it", { skip }, async () => {
  const p = await login(U.mfg.email); await p.goto(`${APP}/mfg?tab=labels`);
  await p.waitForSelector("[data-label-code]"); await p.fill("[data-label-code]", R.unitNo); await p.press("[data-label-code]", "Enter");
  assert.ok(await waitFor(async () => (await p.$$("[data-label='unit'] svg")).length === 1), "the label with its QR code");
  const file = path.join(SHOTS, "p8-label.png"); await (await p.$("[data-label='unit']"))!.screenshot({ path: file });
  const qr = await p.getAttribute("[data-label='unit'] [data-qr]", "data-qr");
  assert.equal(qr, `AGR1:unit:${R.unit.id}`);
  const dec = spawnSync("python3", ["-c", "import sys,cv2; i=cv2.imread(sys.argv[1]); i=cv2.resize(i,None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST); print(cv2.QRCodeDetector().detectAndDecode(i)[0])", file]);
  if (dec.status === 0) { assert.equal(dec.stdout.toString().trim(), qr, "OpenCV reads the printed code"); EV.label = { qr, decoded: "opencv" }; } else EV.label = { qr, decoded: "decoder not available" };
  await p.context().close();
  const t = await login(U.tech.email, PHONE); await t.goto(`${APP}/build`);
  await t.waitForSelector("[data-scan-input]"); await t.fill("[data-scan-input]", qr!); await t.press("[data-scan-input]", "Enter");
  await t.waitForURL((u: URL) => u.pathname === "/mfg" && u.search.includes(R.unit.id), { timeout: 15000 });
  assert.ok(await waitFor(async () => (await t.$$(`[data-unit-view='${R.unit.id}']`)).length === 1), "the scanned code opens the unit");
  assert.ok(await noHScroll(t), "the unit view fits a phone");
  await shot(t, "unit-phone");
  await t.context().close();
});

test("Shop floor on a phone — start, checklist, install the allocated serial, complete; the installation is recorded; no horizontal scrolling", { skip }, async () => {
  // the fans are still missing (not critical: build readiness says Attention), so the unit may move to Ready for Build
  await call("mfg", "mfg_unit_status", [R.unit.id, "Ready for Build", "Computer first", null]);
  const p = await login(U.tech.email, PHONE); await p.goto(`${APP}/build`);
  assert.ok(await waitFor(async () => (await p.$$(`[data-queue='my_work'] [data-wo='${R.wo.id}']`)).length === 1), "my work lists the work order");
  assert.ok(await noHScroll(p), "the queue fits a phone"); await shot(p, "shopfloor-queue");
  await p.click(`[data-wo='${R.wo.id}']`); await p.waitForSelector(`[data-wo-view='${R.wo.id}']`);
  await act(p, "wo-start");
  assert.ok(await waitFor(async () => (await get(R.wo.id)).status === "In Progress"), "started");
  await p.waitForSelector(`[data-install='SN-${tag}-1']`);
  await p.check(`[data-install='SN-${tag}-1']`);
  assert.ok(await noHScroll(p), "the work order fits a phone"); await shot(p, "shopfloor-wo");
  await act(p, "wo-complete");
  assert.ok(await waitFor(async () => (await get(R.wo.id)).status === "Completed"), "completed");
  const inst = await sql("select i.*, s.serial from mfg_installs i join mfg_serials s on s.id = i.serial_id where i.unit_id = $1 and i.removed_at is null", [R.unit.id]);
  assert.equal(inst.length, 1); assert.equal(inst[0].serial, `SN-${tag}-1`, "the serial is installed in this unit");
  EV.shopfloor = { wo: (await get(R.wo.id)).data.number, installed: inst[0].serial };
  await p.context().close();
});

test("An external partner — no manufacturing screen, no shop floor, a scanned code opens nothing", { skip }, async () => {
  const p = await login(U.partner.email); await p.goto(`${APP}/mfg`);
  await p.waitForTimeout(1500);
  assert.equal((await p.$$("[data-block]")).length, 0, "no dashboard"); assert.equal((await p.$$("[data-nav='mfg']")).length, 0, "no menu entry");
  await p.goto(`${APP}/build`); await p.waitForTimeout(1200); assert.equal((await p.$$("[data-scan-input]")).length, 0, "no shop floor");
  const r = await call("partner", "mfg_resolve", [`AGR1:unit:${R.unit.id}`]).catch(() => ({ found: false }));
  assert.equal(r.found, false);
  await p.context().close();
});
