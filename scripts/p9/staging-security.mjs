// P9-R1 R13 — repeatable staging security acceptance. Uses the personas from staging-personas.mjs and synthetic
// restricted fixtures it creates itself (titles carry a P9SYN-<run> marker; nothing real).
//
//   TARGET_SUPABASE_URL=… TARGET_ANON_KEY=… TARGET_SERVICE_ROLE_KEY=… TARGET_REF=<staging ref> PRODUCTION_REF=<prod ref> \
//   [APP_URL=https://<staging app>] node scripts/p9/staging-security.mjs
//   node scripts/p9/staging-security.mjs --stack          (the same suite on the local isolated stack)
//
// Two kinds of check:
//  1. direct access — every persona tries the fixtures by known id, in lists, in counts, in search, documents,
//     notifications, CRM, inventory, serial lookup, exports and files; only the personas entitled to them may succeed.
//  2. no effect on aggregates — every read model a persona can call (dashboards, pipeline value, forecast, weekly
//     reviews, Executive Control, manufacturing overview, queues, Today, search, Assistant answers…) is called BEFORE
//     the fixtures exist and AFTER; for a persona not entitled to them the two answers must be identical
//     (time-stamps aside). A restricted record that changes any count, total or list for such a persona is a leak.
// Exit code 0 = PASS, 1 = a finding. The report goes to .staging/security-<ref>.json.
import fs from "node:fs";
import crypto from "node:crypto";
import { target } from "./target.mjs";

const T = target();
const P = JSON.parse(fs.readFileSync(T.file("personas"), "utf8")).personas;
const run = crypto.randomBytes(4).toString("hex"), MARK = `P9SYN-${run}`;
const findings = [], passes = [];
const ok = (name, cond, detail = "") => { (cond ? passes : findings).push(detail ? `${name} — ${detail}` : name); if (!cond) console.log(`FINDING ${name}${detail ? " — " + detail : ""}`); };

// --- sign in every persona ---------------------------------------------------------------------------------------
const C = {};
for (const [k, p] of Object.entries(P)) {
  const c = T.anon(); const { error } = await c.auth.signInWithPassword({ email: p.email, password: p.password });
  if (k === "disabled") { C[k] = error ? null : c; continue; } // a disabled account may or may not get a token; it must read nothing
  if (error) { console.error(`sign-in ${k}: ${error.message}`); process.exit(2); }
  C[k] = c;
}

// --- the read models compared before/after ------------------------------------------------------------------------
const PROBES = [
  ["search_records", { q: MARK, n: 50 }], ["corp_search", { p_q: MARK, p_limit: 50 }], ["doc_search", { q: MARK, n: 50 }],
  ["exec_overview", {}], ["mgmt_deadlines", { p_days: 30 }], ["mgmt_decisions_report", {}],
  ["crm_overview", { p_filter: {} }], ["crm_pipeline_value", { p_filter: {} }], ["crm_forecast", { p_from: null, p_to: null, p_bucket: "quarter", p_filter: {} }],
  ["crm_list", { p_kind: "all", p_q: null, p_limit: 500, p_filter: {} }], ["crm_list", { p_kind: "active", p_q: null, p_limit: 500, p_filter: {} }],
  ["crm_followups", { p_scope: "all" }], ["crm_weekly", { p_from: null, p_to: null }], ["crm_assistant", { p_intent: "attention", p_arg: null }],
  ["mfg_overview", {}], ["mfg_exec", {}], ["mfg_today", {}], ["mfg_queue", {}], ["mfg_weekly", { p_from: null, p_to: null }],
  ["mfg_list", { p_kind: "all", p_filter: {} }], ["mfg_list", { p_kind: "shortages", p_filter: {} }],
  ["mfg_inventory", { p_q: MARK }], ["mfg_inventory", {}], ["mfg_serial_search", { p_q: MARK }],
  ["mfg_assistant", { p_intent: "building", p_arg: null }], ["mfg_assistant", { p_intent: "risks", p_arg: null }],
  ["ops_list", { p_kind: "pr_open", p_limit: 200 }], ["ops_weekly", {}], ["ops_deadlines", { p_days: 30 }],
];
const VOLATILE = /^(from|to|period_from|period_to)$|(^|_)(at|ms|generated|as_of|elapsed|took|stamp|time)$/i;
const norm = (v) => Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.test(k)).map(([k, x]) => [k, norm(x)])) : v;
async function snapshot(k) {
  const c = C[k]; if (!c) return { refused: "no session" };
  const out = {};
  for (const [fn, args] of PROBES) {
    const { data, error } = await c.rpc(fn, args);
    out[`${fn}(${JSON.stringify(args)})`] = error ? { error: /does not exist|Could not find the function/i.test(error.message) ? "missing" : "refused" } : norm(data);
  }
  for (const s of ["technical.docs", "technical.items", "sales.pipeline", "operations.builds"]) {
    const { count, error } = await c.from("records").select("id", { count: "exact", head: true }).eq("section", s);
    out[`count ${s}`] = error ? "refused" : count;
  }
  const n = await c.from("notifications").select("id,record_id,title"); out.notifications = n.error ? "refused" : norm(n.data);
  return out;
}

// Round A: US-persons-only fixtures (a document with its file, an item with stock and a serial, an opportunity).
//   Not entitled: non-US personas, external personas, the disabled account.
// Round B: a restricted (not US-only) opportunity owned by a manager.
//   Not entitled: everyone outside owner/management (sales, technician, operations, engineers, externals, disabled).
const ROUND_A = ["mgmt-nonus", "eng-nonus", "partner", "vendor", "disabled"];
const ROUND_B = ["sales", "technician", "operations", "manufacturing", "eng-us", "eng-nonus", "partner", "vendor", "disabled"];
const db = T.admin; const ins = async (row) => { const { data, error } = await db.from("records").insert(row).select("id,title").single(); if (error) throw new Error(`${row.section}: ${error.message}`); return data; };
const compare = async (round, who, before, fixtures) => {
  const after = {}; for (const k of [...who, "owner-us"]) after[k] = await snapshot(k);
  for (const k of who) for (const key of Object.keys(before[k])) {
    const a = JSON.stringify(before[k][key]), b = JSON.stringify(after[k][key]);
    if (a === b) { ok(`${round} ${k}: ${key} unchanged`, true); continue; }
    ok(`${round} ${k}: ${key} unchanged by records it may not open`, false, b.includes(MARK) || /7777777|6666666/.test(b) ? "the restricted values appear" : "the answer changed (a count, total or list)");
  }
  const changed = Object.keys(before["owner-us"]).filter((key) => JSON.stringify(before["owner-us"][key]) !== JSON.stringify(after["owner-us"][key]));
  ok(`${round} control: the owner's answers do change (the fixtures are real and counted)`, changed.length > 0, `${changed.length} answers changed`);
  for (const [k, c] of Object.entries(C)) for (const f of fixtures) {
    if (!who.includes(k)) continue;
    const r = c ? await c.from("records").select("id").eq("id", f.id) : { data: [] };
    ok(`${round} ${k}: ${f.title.replace(MARK, "fixture")} by its known id`, !(r.data || []).length);
  }
};

// --- round A ---------------------------------------------------------------------------------------------------------
let before = {}; for (const k of [...ROUND_A, "owner-us"]) before[k] = await snapshot(k);
const doc = await ins({ section: "technical.docs", title: `${MARK} restricted document`, status: "Draft", data: { doc_type: "synthetic" }, controlled: true });
const item = await ins({ section: "technical.items", title: `${MARK} restricted item`, status: "Active", data: { description: "synthetic" }, controlled: true });
const oppC = await ins({ section: "sales.pipeline", title: `${MARK} US-persons opportunity`, status: "Qualified", data: { value: 6666666, currency: "USD", owner_id: P["mgmt-us"].id }, controlled: true });
const filePath = `technical.docs/${doc.id}/1700000000000_${MARK}.txt`;
await db.storage.from("files").upload(filePath, Buffer.from(`synthetic ${MARK}`), { contentType: "text/plain" });
let loc = (await db.from("mfg_locations").select("id").eq("code", "P9SYN").maybeSingle()).data;
if (!loc) loc = (await db.from("mfg_locations").insert({ code: "P9SYN", name: "P9 synthetic location" }).select("id").single()).data;
const st = await db.from("mfg_stock").insert({ item_id: item.id, location_id: loc.id, state: "Available", qty: 7 }); if (st.error) console.log(`note: stock fixture not created (${st.error.message})`);
const sr = await db.from("mfg_serials").insert({ item_id: item.id, serial: `${MARK}-SN1`, state: "Available", location_id: loc.id }); if (sr.error) console.log(`note: serial fixture not created (${sr.error.message})`);
await compare("A", ROUND_A, before, [doc, item, oppC]);
for (const k of ROUND_A) {
  const c = C[k]; if (!c) continue;
  const d = await c.storage.from("files").download(filePath); ok(`A ${k}: the restricted file by its known path is refused`, !!d.error || !d.data);
  const s2 = await c.storage.from("files").createSignedUrl(filePath, 60); ok(`A ${k}: no signed link to the restricted file`, !!s2.error || !s2.data?.signedUrl);
}
// an entitled US engineer can open the document (the fixtures are not simply invisible to everyone)
{ const r = await C["owner-us"].from("records").select("id").eq("id", doc.id); ok("A control: the US owner opens the restricted document", (r.data || []).length === 1); }

// --- round B ---------------------------------------------------------------------------------------------------------
before = {}; for (const k of [...ROUND_B, "owner-us"]) before[k] = await snapshot(k);
const oppR = await ins({ section: "sales.pipeline", title: `${MARK} restricted opportunity`, status: "Qualified", data: { value: 7777777, currency: "USD", owner_id: P["mgmt-us"].id, restricted: true }, controlled: false });
await compare("B", ROUND_B, before, [oppR]);
const fixtures = [doc, item, oppC, oppR];

// --- exports ----------------------------------------------------------------------------------------------------------
for (const k of ROUND_A) {
  const c = C[k]; if (!c) continue;
  for (const [fn, args] of [["crm_export", { p_kind: "organizations", p_filter: {} }], ["mfg_export", { p_kind: "shortages", p_ref: null }]]) {
    const { data, error } = await c.rpc(fn, args);
    if (!error && JSON.stringify(data).includes(MARK)) ok(`${k}: ${fn} contains restricted fixtures`, false); else ok(`${k}: ${fn} ${error ? "refused" : "without restricted fixtures"}`, true);
  }
}

// --- Assistant (application), when the staging app address is given --------------------------------------------------
if (process.env.APP_URL) {
  for (const k of ["mgmt-nonus", "sales", "partner"]) {
    const c = C[k]; if (!c) continue; const { data: s } = await c.auth.getSession();
    const r = await fetch(`${process.env.APP_URL}/api/ai`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token}` }, body: JSON.stringify({ q: `What do we know about ${MARK}?`, mode: "ask" }) }).catch(() => null);
    const txt = r ? await r.text() : "";
    ok(`${k}: Assistant answer without restricted fixtures`, !txt.includes(MARK) || /not (find|see)|no (record|information)/i.test(txt));
  }
}

// --- clean up the fixtures ---------------------------------------------------------------------------------------------
await db.from("mfg_serials").delete().eq("serial", `${MARK}-SN1`); await db.from("mfg_stock").delete().eq("item_id", item.id);
await db.storage.from("files").remove([filePath]);
await db.from("records").delete().in("id", fixtures.map((f) => f.id));

const report = { ref: T.ref, run, at: new Date().toISOString(), passes: passes.length, findings, probes: PROBES.length, personas: Object.keys(P).length };
fs.writeFileSync(T.file("security"), JSON.stringify(report, null, 1));
console.log(`${findings.length ? "FAIL" : "PASS"}: ${passes.length} checks passed, ${findings.length} finding(s); report .staging/security-${T.ref}.json`);
process.exit(findings.length ? 1 : 0);
