// Phase 8 — the browser's calls to the manufacturing layer (v25). Every function works out the signed-in person on
// the server (auth.uid()) and answers only with what that person may open. Every rule (approved = immutable, pinned
// revisions, stock never negative, one serial in one unit, capabilities) is checked by the database, never only here.
import { DEMO, sb } from "./sb";

const LISTS = new Set(["mfg_list", "mfg_inventory", "mfg_serial_search", "mfg_locations", "mfg_products", "mfg_alternates", "mfg_supplier_performance"]);
const rpc = async <T = any>(fn: string, args: Record<string, any> = {}): Promise<T> => {
  if (DEMO) return (LISTS.has(fn) ? [] : null) as T;
  const { data, error } = await sb().rpc(fn, args); if (error) throw new Error(error.message); return data as T;
};

export const mfg = {
  caps: () => rpc<Record<string, boolean>>("mfg_my_caps"),
  overview: () => rpc<any>("mfg_overview"),
  list: (kind: string, f: Record<string, any> = {}) => rpc<any[]>("mfg_list", { p_kind: kind, p_filter: f }),
  products: () => rpc<any[]>("mfg_products"),
  product: (id: string) => rpc<any>("mfg_product_view", { p_product: id }),
  unit: (id: string) => rpc<any>("mfg_unit_view", { p_unit: id }),
  tab: (id: string, tab: string) => rpc<any>("mfg_unit_tab", { p_unit: id, p_tab: tab }),
  createUnit: (p: Record<string, any>, release = true) => rpc<any>("mfg_unit_create", { p, p_release: release }),
  release: (id: string) => rpc<any>("mfg_unit_release", { p_unit: id }),
  status: (id: string, status: string, reason?: string | null, exception?: string | null) => rpc<any>("mfg_unit_status", { p_unit: id, p_status: status, p_reason: reason || null, p_exception: exception || null }),
  readiness: (id: string) => rpc<any>("mfg_readiness", { p_unit: id }),
  plan: (scope: Record<string, any>) => rpc<any>("mfg_material_plan", { p_scope: scope }),
  shortageRequest: (unit: string, item: string, qty: number, neededBy?: string | null, note?: string | null) => rpc<any>("mfg_shortage_request", { p_unit: unit, p_item: item, p_qty: qty, p_needed_by: neededBy || null, p_note: note || null }),
  // definitions
  bomCreate: (config: string, title?: string | null) => rpc<any>("mfg_bom_create", { p_config: config, p_title: title || null, p_notes: null }),
  bom: (id: string) => rpc<any>("mfg_bom_get", { p_bom: id }),
  bomSave: (id: string, lines: any[]) => rpc<any>("mfg_bom_lines_save", { p_bom: id, p_lines: lines }),
  bomEffectivity: (id: string, eff: Record<string, any>) => rpc<any>("mfg_bom_effectivity", { p_bom: id, p_eff: eff }),
  bomCompare: (a: string, b: string) => rpc<any>("mfg_bom_compare", { p_a: a, p_b: b }),
  submit: (id: string) => rpc<any>("mfg_def_submit", { p_id: id }),
  newVersion: (id: string, reason: string, ecr?: string | null) => rpc<any>("mfg_def_new_version", { p_id: id, p_reason: reason, p_ecr: ecr || null }),
  retire: (id: string, reason: string) => rpc<any>("mfg_def_retire", { p_id: id, p_reason: reason }),
  procedureCheck: (fields: any[]) => rpc<string[]>("mfg_procedure_check", { p_fields: fields }),
  alternates: (item?: string | null) => rpc<any[]>("mfg_alternates", { p_item: item || null }),
  altPropose: (item: string, sub: string, scope: string, target: string | null, units: string[] | null, reason: string) => rpc<any>("mfg_alt_propose", { p_item: item, p_substitute: sub, p_scope: scope, p_target: target, p_units: units, p_reason: reason }),
  altDecide: (id: string, decision: string, note?: string | null) => rpc<any>("mfg_alt_decide", { p_id: id, p_decision: decision, p_note: note || null, p_ecr: null }),
  // inventory
  locations: () => rpc<any[]>("mfg_locations"),
  locationSave: (p: Record<string, any>) => rpc<any>("mfg_location_save", { p }),
  inventory: (q?: string | null, item?: string | null, location?: string | null, state?: string | null) => rpc<any[]>("mfg_inventory", { p_q: q || null, p_item: item || null, p_location: location || null, p_state: state || null, p_limit: 300 }),
  itemStock: (id: string) => rpc<any>("mfg_item_stock", { p_item: id }),
  serials: (q: string) => rpc<any[]>("mfg_serial_search", { p_q: q, p_limit: 50 }),
  serial: (id: string) => rpc<any>("mfg_serial", { p_id: id }),
  receive: (purchase: string, qty: number, rejected: number, condition: string, note: string | null, location: string | null, serials: string[] | null, lot: Record<string, any> | null, key: string) =>
    rpc<any>("mfg_receive", { p_purchase: purchase, p_qty: qty, p_rejected: rejected, p_condition: condition, p_note: note, p_date: null, p_location: location, p_serials: serials, p_lot: lot, p_key: key }),
  move: (item: string, from: string, to: string, qty: number | null, lot: string | null, serials: string[] | null, state = "Available") => rpc<any>("mfg_move", { p_item: item, p_from: from, p_to: to, p_qty: qty, p_lot: lot, p_serials: serials, p_state: state, p_key: crypto.randomUUID() }),
  adjust: (item: string, location: string, state: string, counted: number, reason: string, lot?: string | null) => rpc<any>("mfg_adjust", { p_item: item, p_location: location, p_state: state, p_counted: counted, p_reason: reason, p_lot: lot || null, p_key: crypto.randomUUID() }),
  setState: (item: string, location: string, from: string, to: string, qty: number | null, lot: string | null, serials: string[] | null, reason: string | null) =>
    rpc<any>("mfg_set_state", { p_item: item, p_location: location, p_from: from, p_to: to, p_qty: qty, p_lot: lot, p_serials: serials, p_reason: reason, p_inspection: null, p_key: crypto.randomUUID() }),
  allocate: (target: Record<string, any>, item: string, qty: number | null, serials?: string[] | null, reason?: string | null) => rpc<any>("mfg_allocate", { p_target: target, p_item: item, p_qty: qty, p_location: null, p_lot: null, p_serials: serials || null, p_reason: reason || null, p_key: crypto.randomUUID() }),
  releaseAlloc: (id: string, reason: string) => rpc<any>("mfg_release", { p_alloc: id, p_reason: reason }),
  removeInstall: (id: string, reason: string, to = "Quarantine") => rpc<any>("mfg_remove", { p_install: id, p_reason: reason, p_to: to, p_location: null }),
  value: () => rpc<any>("mfg_inventory_value"),
  suppliers: () => rpc<any[]>("mfg_supplier_performance", { p_vendor: null }),
  // work
  woGenerate: (unit: string) => rpc<any>("mfg_wo_generate", { p_unit: unit }),
  woCreate: (unit: string, p: Record<string, any>) => rpc<any>("mfg_wo_create", { p_unit: unit, p }),
  queue: () => rpc<any>("mfg_queue"),
  wo: (id: string) => rpc<any>("mfg_wo", { p_wo: id }),
  start: (id: string) => rpc<any>("mfg_wo_start", { p_wo: id }),
  complete: (id: string, p: Record<string, any>) => rpc<any>("mfg_wo_complete", { p_wo: id, p: { key: crypto.randomUUID(), ...p } }),
  block: (id: string, blocked: boolean, reason?: string | null) => rpc<any>("mfg_wo_block", { p_wo: id, p_blocked: blocked, p_reason: reason || null }),
  repin: (id: string, reason: string) => rpc<any>("mfg_wo_repin", { p_wo: id, p_reason: reason }),
  software: (unit: string, p: Record<string, any>) => rpc<any>("mfg_software_install", { p_unit: unit, p }),
  // quality
  inspectionCreate: (p: Record<string, any>) => rpc<any>("mfg_inspection_create", { p }),
  inspectionRecord: (id: string, p: Record<string, any>) => rpc<any>("mfg_inspection_record", { p_id: id, p }),
  ncCreate: (p: Record<string, any>) => rpc<any>("mfg_nc_create", { p }),
  ncDisposition: (id: string, d: string, note: string) => rpc<any>("mfg_nc_disposition", { p_issue: id, p_disposition: d, p_note: note }),
  rework: (id: string, p: Record<string, any>) => rpc<any>("mfg_rework_create", { p_issue: id, p }),
  ncClose: (id: string, note: string) => rpc<any>("mfg_nc_close", { p_issue: id, p_note: note }),
  testCreate: (unit: string, procedure: string, p: Record<string, any> = {}) => rpc<any>("mfg_test_create", { p_unit: unit, p_procedure: procedure, p }),
  testRecord: (id: string, p: Record<string, any>) => rpc<any>("mfg_test_record", { p_run: id, p }),
  testApprove: (id: string, note?: string | null) => rpc<any>("mfg_test_approve", { p_run: id, p_note: note || null }),
  // as-built, change, acceptance, shipping, cost
  asbuiltGenerate: (unit: string) => rpc<any>("mfg_asbuilt_generate", { p_unit: unit }),
  asbuilt: (unit: string) => rpc<any>("mfg_asbuilt", { p_unit: unit, p_revision: null }),
  compare: (unit: string) => rpc<any>("mfg_planned_vs_built", { p_unit: unit }),
  ecrCandidates: (ecr: string) => rpc<any>("mfg_ecr_candidates", { p_ecr: ecr }),
  ecrConfirm: (ecr: string, objects: any[]) => rpc<any>("mfg_ecr_confirm", { p_ecr: ecr, p_objects: objects }),
  impact: (ecr: string) => rpc<any>("mfg_change_impact", { p_ecr: ecr }),
  disposition: (bom: string, unit: string, decision: string, note: string) => rpc<any>("mfg_unit_disposition", { p_bom: bom, p_unit: unit, p_decision: decision, p_note: note }),
  accept: (unit: string, p: Record<string, any>) => rpc<any>("mfg_accept", { p_unit: unit, p }),
  shipping: (unit: string, p: Record<string, any>) => rpc<any>("mfg_shipping_save", { p_unit: unit, p }),
  shipRelease: (unit: string, p: Record<string, any>) => rpc<any>("mfg_ship_release", { p_unit: unit, p }),
  cost: (unit: string) => rpc<any>("mfg_unit_cost", { p_unit: unit }),
  docImpact: (doc: string) => rpc<any>("mfg_doc_impact", { p_doc: doc }),
  // read models for other screens
  exec: () => rpc<any>("mfg_exec"),
  weekly: (from?: string | null, to?: string | null) => rpc<any>("mfg_weekly", { p_from: from || null, p_to: to || null }),
  today: () => rpc<any>("mfg_today"),
  assistant: (intent: string, arg?: string | null) => rpc<any>("mfg_assistant", { p_intent: intent, p_arg: arg || null }),
  // QR, labels, import / export, settings
  resolve: (code: string) => rpc<any>("mfg_resolve", { p_code: code }),
  label: (kind: string, id: string) => rpc<any>("mfg_label", { p_kind: kind, p_id: id }),
  importPreview: (kind: string, rows: any[], target?: string | null) => rpc<any>("mfg_import_preview", { p_kind: kind, p_rows: rows, p_target: target || null }),
  importCommit: (kind: string, rows: any[], decisions: Record<string, string>, file?: string | null, target?: string | null) => rpc<any>("mfg_import_commit", { p_kind: kind, p_rows: rows, p_decisions: decisions, p_file: file || null, p_target: target || null }),
  importRollback: (batch: string) => rpc<any>("mfg_import_rollback", { p_batch: batch }),
  export: (kind: string, ref?: string | null) => rpc<any>("mfg_export", { p_kind: kind, p_ref: ref || null }),
  settings: () => rpc<any>("mfg_settings_get"),
  saveSettings: (value: Record<string, any>, version: number) => rpc<any>("mfg_settings_save", { p_value: value, p_version: version }),
  capsList: () => rpc<any>("crm_caps_list"),
  setCap: (user: string, cap: string, on: boolean) => rpc<any>("crm_cap_set", { p_user: user, p_cap: cap, p_on: on }),
};

/** One amount per currency, never added across currencies. */
export const money = (v: any, cur?: string | null) => (v == null || v === "" ? "—" : `${cur || ""} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim());
export const qty = (v: any) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 }));
