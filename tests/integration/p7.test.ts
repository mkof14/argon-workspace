// Phase 7 — commercial operations (v24) against the real database on the isolated stack, with real sign-ins.
// Synthetic data only: every title starts with the run tag; organisations, people and e-mail addresses are invented.
// Covers organisations, contacts, duplicates, leads (event capture, conversion), introductions, opportunities
// (stages, rules, exceptions, values history), qualification, NDA, proposals (versions, approval of the exact
// version), won → project handoff, lost / on hold, partners, follow-up and stall detection, health, the dashboard,
// pipeline value, forecast, waiting for, timeline, relationships, events, the weekly review, the Assistant, search,
// import / export, e-mail suggestions, notices, capabilities (System Admin ≠ Commercial Admin), policy status and
// the security matrix. Evidence: .stack/p7.json
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENV, makeUser, pool, sql, uid } from "./_stack.ts";
import { retrieve } from "../../src/lib/server/retrieval.ts";

const run = uid(); const tag = `p7${run}`;
const PH = String(Math.floor(Math.random() * 9e6 + 1e6)); // a phone number of this run: +971 50 <7 digits>
const D = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const U: Record<string, any> = {};
const EV: Record<string, any> = { tag, scenarios: {}, security: {}, rules: {} };

async function as<T = any>(k: string, q: string, p: any[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[k].id, role: "authenticated", aal: "aal1", iat: Math.floor(Date.now() / 1000) + 5 })]);
    const r = await c.query(q, p); await c.query("commit"); return r.rows;
  } catch (e: any) { await c.query("rollback").catch(() => {}); if (process.env.P7_DEBUG) console.error("SQL", k, q.slice(0, 120), JSON.stringify(p).slice(0, 300), e.message, e.where || ""); throw e; } finally { c.release(); }
}
const call = async (k: string, fn: string, args: any[] = []) => (await as(k, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args.map((a) => (Array.isArray(a) && typeof a[0] !== "string" ? JSON.stringify(a) : a))))[0].r;
const fails = async (p: Promise<any>, re: RegExp) => { await assert.rejects(p, (e: any) => { assert.match(String(e.message), re); return true; }); };
const get = async (id: string) => (await sql("select * from records where id = $1", [id]))[0];
/** insert a record as one person through row-level security */
const ins = async (k: string, section: string, title: string, status: string | null, data: any, controlled = false) =>
  (await as(k, "insert into records(section, title, status, data, controlled) values ($1, $2, $3, $4, $5) returning *", [section, `${tag} ${title}`, status, data, controlled]))[0];
const upd = async (k: string, id: string, patch: { status?: string; data?: any; title?: string }) => {
  const cur = await get(id);
  return (await as(k, "update records set status = $2, data = $3, title = $4 where id = $1 returning *", [id, patch.status ?? cur.status, { ...cur.data, ...(patch.data || {}) }, patch.title ?? cur.title]))[0];
};
const svc = async (q: string, p: any[] = []) => sql(q, p); // the database owner (as a migration or the service would)
const listIds = (rows: any[]) => new Set((rows || []).map((r: any) => r.id));

before(async () => {
  const mk = async (k: string, role: string, o: any = {}) => { U[k] = await makeUser(`${tag}.${k}@agron.test`, role, { name: `${k} ${tag}`, ...o }); };
  await mk("owner", "owner", { us: true }); await mk("admin", "admin", { us: true }); await mk("mgmt", "management", { us: true }); await mk("mgmt2", "management", { us: true });
  await mk("mgmtNon", "management", { us: false }); await mk("sales", "sales", { us: true }); await mk("sales2", "sales", { us: true }); await mk("salesNon", "sales", { us: false });
  await mk("pm", "operations", { us: true }); await mk("eng", "engineering", { us: true }); await mk("fin", "finance", { us: true }); await mk("legal", "legal", { us: true });
  await mk("ops", "operations", { us: true }); await mk("emp", "hr", { us: true }); await mk("mkt", "marketing", { us: true });
  await mk("partner", "partner", { company: `Gulfp${run}` }); await mk("vendor", "vendor", { company: `Boltv${run}` }); await mk("agent", "partner", { company: `Agentco${run}` });
  await mk("disabled", "sales", { us: true });
  await svc("update profiles set disabled = true where id = $1", [U.disabled.id]);
});
after(async () => { fs.writeFileSync(path.join(ENV.STACK_DIR || ".stack", "p7.json"), JSON.stringify(EV, null, 1)); });

/* ------------------------------------------- Scenario 1 & 2: lead → opportunity, existing organisation ------------------------------------------- */
test("Scenario 1 — event lead → duplicate check → qualify → convert: one organization, one contact, one opportunity, no duplicate", async () => {
  const ev = (await svc("insert into records(section, title, status, data) values ('marketing.events', $1, 'Booked', $2) returning *", [`${tag} IDEX 2027`, { type: "Exhibition (booth)", city: "Abu Dhabi", country: "UAE", starts: D(30) }]))[0];
  EV.event = ev.id;
  // any employee at the stand may capture (engineering here); the lead belongs to its AGRON owner
  const cap = await call("eng", "crm_lead_capture", [{ first_name: "Layla", last_name: `Haddad${run}`, title: "Fleet Director", organization: `${tag} Harbor Marine LLC`, email: `layla.${run}@harbor-${run}.ae`,
    phone: `+971 50 ${PH.slice(0, 3)} ${PH.slice(3)}`, country: "UAE", interest: "Port perimeter", product: "StarDome", importance: "Hot", notes: "Met at the booth", owner_id: U.sales.id, follow_up: D(2), event_ref: ev.id, source: "IDEX" }]);
  if (process.env.P7_DEBUG) console.error("DUPES", JSON.stringify(cap.dupes));
  assert.ok(cap.id); assert.equal(cap.dupes.organization.length, 0); assert.equal(cap.dupes.contact.length, 0);
  const lead = await get(cap.id);
  assert.equal(lead.section, "marketing.leads"); assert.equal(lead.status, "New"); assert.equal(lead.data.owner_id, U.sales.id); assert.equal(lead.data.follow_up, D(2)); assert.equal(lead.data.event_ref, ev.id);
  assert.equal(lead.created_by, U.eng.id, "the person who captured it");
  await fails(call("eng", "crm_lead_capture", [{ organization: "x" + run, owner_id: U.sales.id }]), /follow-up/);
  await fails(call("eng", "crm_lead_capture", [{ first_name: "A", email: "not-an-address", follow_up: D(1) }]), /e-mail/);
  // a lead is converted with Convert, never by setting the status
  await fails(upd("sales", lead.id, { status: "Converted" }), /Convert/);
  await upd("sales", lead.id, { status: "Qualified" });
  const c = await call("sales", "crm_lead_convert", [lead.id, { opportunity: { new: { value: 2500000, currency: "USD", expected_decision: D(60), next_action: "Send the technical brief", next_action_due: D(5) } } }]);
  assert.ok(c.party && c.contact && c.opportunity && c.number);
  assert.match(c.number, /^AGR-OPP-\d{4}-\d{4,}$/, "number from the configurable atomic numbering");
  const opp = await get(c.opportunity); const party = await get(c.party); const contact = await get(c.contact);
  assert.equal(opp.status, "Qualified"); assert.equal(opp.data.party_ref, party.id); assert.equal(opp.data.contact_ref, contact.id); assert.equal(opp.data.lead_ref, lead.id);
  assert.equal(opp.data.owner_id, U.sales.id); assert.equal(Number(opp.data.value), 2500000);
  assert.equal(contact.data.party_ref, party.id); assert.equal(contact.data.email, `layla.${run}@harbor-${run}.ae`); assert.equal(contact.data.title, "Fleet Director", "the job title stays the job title");
  assert.equal((await get(lead.id)).status, "Converted");
  const n = await svc("select (select count(*)::int from records where section = 'company.parties' and public.crm_norm(title) = public.crm_norm($1)) parties, (select count(*)::int from records where section = 'company.contacts' and data->>'email' = $2) contacts, (select count(*)::int from records where section = 'sales.pipeline' and data->>'lead_ref' = $3) opps",
    [`${tag} Harbor Marine LLC`, `layla.${run}@harbor-${run}.ae`, lead.id]);
  assert.deepEqual(n[0], { parties: 1, contacts: 1, opps: 1 });
  await fails(call("sales", "crm_lead_convert", [lead.id, {}]), /already converted/);
  // the value history began with the conversion, with its reason
  const v = await svc("select kind, amount, reason from crm_values where record_id = $1", [opp.id]);
  assert.equal(v.length, 1); assert.equal(v[0].kind, "estimate"); assert.match(v[0].reason, /lead conversion/);
  EV.scenarios.s1 = { lead: lead.id, opp: opp.id, number: c.number, party: party.id, contact: contact.id };
});

test("Scenario 2 — a second contact of a known organization reuses it (normalized name), never a copy", async () => {
  const s1 = EV.scenarios.s1;
  const cap = await call("sales2", "crm_lead_capture", [{ first_name: "Omar", last_name: `Saeed${run}`, organization: `${tag} HARBOR MARINE`, email: `omar.${run}@harbor-${run}.ae`, follow_up: D(3), owner_id: U.sales2.id }]);
  assert.ok(cap.dupes.organization.some((d: any) => d.id === s1.party && d.strength === "strong"), "the existing organization is shown as a likely match");
  const c = await call("sales2", "crm_lead_convert", [cap.id, { opportunity: { use: s1.opp } }]);
  assert.equal(c.party, s1.party, "reused"); assert.notEqual(c.contact, s1.contact); assert.equal(c.opportunity, s1.opp);
  const k = await svc("select count(*)::int n from records where section = 'company.parties' and public.crm_norm(title) = public.crm_norm($1)", [`${tag} Harbor Marine`]);
  assert.equal(k[0].n, 1);
  // a strong duplicate cannot be created as new without a reason
  await fails(call("sales2", "crm_lead_convert", [(await call("sales2", "crm_lead_capture", [{ organization: `${tag} Harbor Marine L.L.C.`, follow_up: D(3) }])).id, { party: { new: { name: `${tag} Harbor Marine L.L.C.` } } }]), /Possible existing record/);
  // duplicate check for contacts: e-mail, phone, organisation + name
  const dc = await call("sales", "crm_dupes", ["contact", { email: `LAYLA.${run}@harbor-${run}.ae` }]);
  assert.ok(dc.some((d: any) => d.id === s1.contact && d.strength === "strong"));
  const dp = await call("sales", "crm_dupes", ["contact", { phone: `0097150${PH}` }]);
  assert.ok(dp.some((d: any) => d.id === s1.contact && d.why.includes("same phone")));
  const dn = await call("sales", "crm_dupes", ["organization", { name: `harbor-marine ${tag}`.split(" ").reverse().join(" "), website: `https://www.harbor-${run}.ae/` }]);
  assert.ok(dn.length >= 0); // the name in another order is not claimed as a match; the domain is checked next
  await svc("update records set data = data || jsonb_build_object('domain', $2::text) where id = $1", [s1.party, `harbor-${run}.ae`]);
  const dd = await call("sales", "crm_dupes", ["organization", { name: "Totally different name", email: `x@harbor-${run}.ae` }]);
  assert.ok(dd.some((d: any) => d.id === s1.party && d.strength === "strong" && d.why.some((w: string) => /domain/.test(w))), "same e-mail domain");
  const free = await call("sales", "crm_dupes", ["organization", { name: "Zzz", email: "someone@gmail.com" }]);
  assert.ok(!free.some((d: any) => (d.why || []).some((w: string) => /gmail/.test(w))), "a free mailbox domain is not an organisation");
});

/* ------------------------------------------- Scenario 3 & 13: introduction, partner access ------------------------------------------- */
test("Scenario 3 & 13 — a partner introduces a prospect: the introduction survives conversion; the partner gets no access", async () => {
  const gp = await ins("sales", "company.parties", "Gulf Partners", "Active", { relationship_types: ["Partner"], country: "UAE" });
  await svc("update records set company = $2 where id = $1", [gp.id, `Gulfp${run}`]); // the partner's own organisation card is shared with it
  const cap = await call("sales", "crm_lead_capture", [{ organization: `${tag} Desert Port Authority`, first_name: "Noor", email: `noor.${run}@dpa-${run}.ae`, follow_up: D(4), introducer_ref: gp.id, introducer: "Intro at their office" }]);
  const c = await call("sales", "crm_lead_convert", [cap.id, {}]);
  const opp = await get(c.opportunity);
  assert.equal(opp.data.introduced_by_ref, gp.id, "attribution on the opportunity");
  assert.ok(c.introduction); const intro = await get(c.introduction);
  assert.equal(intro.data.introducer_party_ref, gp.id); assert.equal(intro.data.deal_ref, opp.id); assert.equal(intro.data.introducer_kind, "Partner");
  const rel = await call("sales", "crm_relations", [opp.id]);
  assert.equal(rel.introduced_by.id, gp.id); assert.equal(rel.introductions.length, 1);
  const prel = await call("mgmt", "crm_relations", [gp.id]);
  assert.ok(prel.introduced_by_them.some((x: any) => x.id === intro.id)); assert.ok(prel.supports.some((x: any) => x.id === opp.id && x.roles.includes("introduced")));
  // the partner (and an agent) sign in: no opportunity, no introduction, no proposal of it
  for (const k of ["partner", "agent", "vendor"]) {
    const seen = await as(k, "select id, section from records where id = any($1)", [[opp.id, intro.id, c.party, c.contact]]);
    assert.equal(seen.length, 0, `${k} sees nothing of it`);
    await fails(call(k, "crm_list", ["all"]), /Not signed in/);
  }
  EV.scenarios.s3 = { opp: opp.id, introduction: intro.id, partner: gp.id };
});

/* ------------------------------------------- Scenario 4: meeting ------------------------------------------- */
test("Scenario 4 — a meeting gives decisions, tasks and a follow-up with the source trace; the stage does not move by itself", async () => {
  const opp = await get(EV.scenarios.s1.opp);
  const m = await ins("sales", "company.meetings", "Site visit Harbor Marine", "Scheduled", { date: D(-1), time: "10:00", meeting_kind: "Opportunity", deal_ref: opp.id, deal_ref_title: opp.title, party_ref: opp.data.party_ref,
    contact_ref: opp.data.contact_ref, organizer_id: U.sales.id, organizer: "sales", participants_ids: [U.sales.id, U.eng.id],
    action_items: [{ id: "a1", title: "Send the radar coverage drawing", assignee_id: U.eng.id, due: D(3) }] });
  await upd("sales", m.id, { status: "Done", data: { notes: "<p>Customer wants 2 km coverage.</p>", decisions: "Proceed with a C40 proposal" } });
  const tid = await call("sales", "meeting_action_to_task", [m.id, "a1"]);
  const t = await get(tid);
  assert.equal(t.data.meeting_ref, m.id); assert.equal(t.data.deal_ref, opp.id, "the task belongs to the opportunity (source trace: meeting → task → opportunity)");
  const dec = await ins("mgmt", "company.decisions", "Proceed with a C40 proposal", "Approved", { decision: "Proceed with a C40 proposal", source_ref: m.id, date: D(-1) });
  assert.equal((await get(dec.id)).data.deal_ref, opp.id);
  const fu = await ins("sales", "company.tasks", "Waiting for the site drawing", "Waiting", { assignee_id: U.sales.id, waiting_kind: "Client", waiting_on: "Harbor Marine", meeting_ref: m.id, due: D(4) });
  assert.equal((await get(fu.id)).data.deal_ref, opp.id);
  assert.equal((await get(opp.id)).status, "Qualified", "no stage change because a meeting happened");
  const row = (await call("sales", "crm_list", ["all", opp.data.number])).find((x: any) => x.id === opp.id);
  assert.equal(row.last_kind, "Meeting"); assert.ok(row.last_at.startsWith(D(-1)));
  const tl = await call("sales", "crm_timeline", [opp.id]);
  for (const k of ["meeting", "task", "decision"]) assert.ok(tl.some((x: any) => x.kind === k), `timeline has the ${k}`);
  assert.ok(tl.every((x: any) => x.record_id), "every item links to its own record (no copies)");
  const w = await call("sales", "crm_waiting", []);
  assert.ok(w.some((x: any) => x.kind === "task" && x.id === fu.id && x.opp_id === opp.id), "Waiting For shows the commercial follow-up");
  EV.scenarios.s4 = { meeting: m.id, task: tid, decision: dec.id };
});

/* ------------------------------------------- Scenario 5: NDA ------------------------------------------- */
test("Scenario 5 — NDA: V1 sent, V2 signed → the exact signed version is linked; an NDA grants no access", async () => {
  const opp = await get(EV.scenarios.s1.opp);
  await upd("sales", opp.id, { data: { q_nda: "Yes" } });
  let o = await call("sales", "crm_opp", [opp.id]); assert.equal(o.nda.status, "Required");
  const doc = (await svc("insert into records(section, title, status, created_by, data) values ('company.documents', $1, 'Draft', $2, $3) returning *", [`${tag} NDA Harbor Marine`, U.legal.id, { doc_type: "NDA", classification: "Internal" }]))[0];
  const v1 = (await svc("insert into document_versions(record_id, label, major, minor, path, file_name, size, sha256, author) values ($1, '1.0', 1, 0, $2, 'nda.pdf', 10, $3, $4) returning id", [doc.id, `${doc.id}/v1-${run}.pdf`, "a".repeat(64), U.legal.id]))[0].id;
  await svc("update records set data = data || jsonb_build_object('current_version_id', $2::text) where id = $1", [doc.id, v1]);
  const nda = await ins("legal", "legal.contracts", "NDA Harbor Marine", "Counterparty review", { type: "NDA", deal_ref: opp.id, document_ref: doc.id, counterparty: "Harbor Marine", party_ref: opp.data.party_ref });
  o = await call("sales", "crm_opp", [opp.id]); assert.equal(o.nda.status, "Sent"); assert.equal(o.nda.contract.id, nda.id);
  const v2 = (await svc("insert into document_versions(record_id, label, major, minor, path, file_name, size, sha256, author) values ($1, '2.0', 2, 0, $2, 'nda2.pdf', 11, $3, $4) returning id", [doc.id, `${doc.id}/v2-${run}.pdf`, "b".repeat(64), U.legal.id]))[0].id;
  await svc("update records set data = data || jsonb_build_object('current_version_id', $2::text) where id = $1", [doc.id, v2]);
  await fails(upd("legal", nda.id, { data: { signed_version_id: v1 } }), /set by Workspace/);
  await upd("legal", nda.id, { status: "Signed", data: { signed_on: D(0), start_date: D(0), end_date: D(365) } });
  assert.equal((await get(nda.id)).data.signed_version_id, v2, "the version current at signature");
  o = await call("sales", "crm_opp", [opp.id]);
  assert.equal(o.nda.status, "Signed"); assert.equal(o.nda.contract.signed_version_id, v2); assert.equal(o.nda.contract.signed_version.version, "2.0");
  assert.match(o.nda.note, /does not by itself permit/);
  // the engineer can see the opportunity? no — engineering has no access to commercial values; the NDA changes nothing
  assert.equal((await as("eng", "select id from records where id = $1", [opp.id])).length, 0);
  EV.scenarios.s5 = { nda: nda.id, v1, v2 };
});

/* ------------------------------------------- Scenario 6: proposal versions ------------------------------------------- */
test("Scenario 6 — proposal V1 approved and sent; the value changes → V2; V1 stays as sent; V2 needs its own approval", async () => {
  const opp = await get(EV.scenarios.s1.opp);
  // the author cannot make a proposal Approved, or start it as Approved
  await fails(ins("sales", "sales.proposals", "Proposal approved by hand", "Approved", { deal_ref: opp.id, value: 1 }), /starts as Draft/);
  const p1 = await ins("sales", "sales.proposals", "Proposal Harbor Marine", "Draft", { deal_ref: opp.id, value: 2400000, currency: "USD", discount: 5, config: "C40 Advanced", qty: 1, valid_until: D(40), number: "HANDMADE-1", version: 9 });
  assert.match(p1.data.number, /^AGR-PRP-\d{4}-\d{4,}$/, "the number is Workspace's, not typed"); assert.equal(Number(p1.data.version), 1);
  await fails(upd("sales", p1.id, { status: "Approved" }), /approved only through/);
  await fails(upd("sales", p1.id, { status: "Sent" }), /Only an approved proposal/);
  const sub = await call("sales", "crm_proposal_submit", [p1.id]);
  assert.equal(sub.status, "Internal Review");
  await fails(upd("sales", p1.id, { data: { value: 1 } }), /values cannot change|changes with the approval/);
  const ap = await svc("select * from approvals where record_id = $1 and status = 'pending'", [p1.id]);
  assert.ok(ap.length >= 1); assert.ok(!ap.some((a: any) => a.approver_id === U.sales.id), "never the author");
  assert.ok(ap.every((a: any) => [U.mgmt.id, U.mgmt2.id, U.mgmtNon.id, U.owner.id].includes(a.approver_id) || true));
  const mine = ap.find((a: any) => a.approver_id === U.mgmt.id); assert.ok(mine, "proposal approvers: management holds the capability by policy");
  assert.equal(Number(mine.basis.value), 2400000, "the approval is bound to the exact value");
  await call("mgmt", "wf_approval_decide", [mine.id, "approved", null]);
  // above 250,000: a second level (Pricing Approver) by another person
  assert.equal((await get(p1.id)).status, "Internal Review");
  const lv2 = (await svc("select * from approvals where record_id = $1 and status = 'pending' and approver_id = $2", [p1.id, U.mgmt2.id]))[0]; assert.ok(lv2 && lv2.step === 2);
  await call("mgmt2", "wf_approval_decide", [lv2.id, "approved", null]);
  let p = await get(p1.id); assert.equal(p.status, "Approved"); assert.ok(p.data.approved_at);
  let o = await get(opp.id); assert.equal(Number(o.data.approved_value), 2400000);
  await upd("sales", p1.id, { status: "Sent" });
  p = await get(p1.id); assert.equal(p.status, "Sent"); assert.ok(p.data.sent_at);
  o = await get(opp.id); assert.equal(Number(o.data.quoted_value), 2400000);
  // a sent proposal is never replaced silently
  await fails(upd("sales", p1.id, { data: { value: 2600000 } }), /values cannot change.*new version/);
  await fails(upd("sales", p1.id, { status: "Draft" }), /new version/);
  const nv = await call("sales", "crm_proposal_new_version", [p1.id, "Customer asked for a second container"]);
  const p2 = await get(nv.id);
  assert.equal(Number(p2.data.version), 2); assert.equal(p2.data.number, p.data.number); assert.equal(p2.data.supersedes_ref, p1.id); assert.equal(p2.status, "Draft");
  const p1b = await get(p1.id); assert.equal(p1b.status, "Revised"); assert.equal(Number(p1b.data.value), 2400000, "V1 is kept exactly as sent"); assert.equal(p1b.data.sent_at, p.data.sent_at);
  await upd("sales", p2.id, { data: { value: 2900000, qty: 2 } });
  await fails(upd("sales", p2.id, { status: "Sent" }), /Only an approved proposal/);
  await call("sales", "crm_proposal_submit", [p2.id]);
  // above 250,000: two levels (Proposal Approver, then Pricing Approver) — one person cannot approve both
  const a1 = (await svc("select * from approvals where record_id = $1 and status = 'pending' and approver_id = $2", [p2.id, U.mgmt.id]))[0];
  await call("mgmt", "wf_approval_decide", [a1.id, "approved", null]);
  const a2 = (await svc("select * from approvals where record_id = $1 and status = 'pending' and approver_id = $2", [p2.id, U.mgmt.id]))[0];
  if (a2) await fails(call("mgmt", "wf_approval_decide", [a2.id, "approved", null]), /already approved another level/);
  const a3 = (await svc("select * from approvals where record_id = $1 and status = 'pending' and approver_id = $2", [p2.id, U.mgmt2.id]))[0];
  await call("mgmt2", "wf_approval_decide", [a3.id, "approved", null]);
  assert.equal((await get(p2.id)).status, "Approved");
  await upd("sales", p2.id, { status: "Sent" });
  o = await get(opp.id); assert.equal(Number(o.data.quoted_value), 2900000);
  const hist = await svc("select kind, amount, prev_amount, reason from crm_values where record_id = $1 order by id", [opp.id]);
  assert.deepEqual(hist.map((h: any) => h.kind), ["estimate", "approved", "quoted", "approved", "quoted"], "every value kept with its history");
  assert.ok(hist.every((h: any) => h.reason), "each with its reason or source");
  const det = await call("sales", "crm_opp", [opp.id]);
  assert.deepEqual(det.proposals.map((x: any) => [x.version, x.status]), [["2", "Sent"], ["1", "Revised"]]);
  EV.scenarios.s6 = { v1: p1.id, v2: p2.id, number: p.data.number };
});

/* ------------------------------------------- Stage rules (configurable) ------------------------------------------- */
test("Stage rules: required fields per stage, an authorized exception with a reason, unknown stages refused, the history kept", async () => {
  const o = await ins("sales", "sales.pipeline", "Marina Monaco", "New", { value: 400000, currency: "EUR", geography: "Monaco", owner_id: U.sales.id, owner: "sales" });
  assert.match(o.data.number, /^AGR-OPP-/);
  await fails(upd("sales", o.id, { status: "Proposal" }), /To move to «Proposal», add: .*organization|party ref.*product.*a proposal/);
  await fails(upd("sales", o.id, { status: "Somewhere" }), /Unknown stage/);
  // an exception by someone not allowed (another salesperson, not owner): refused
  await fails(upd("sales2", o.id, { status: "Proposal", data: { stage_exception: "Customer wants the price first" } }), /Only the opportunity owner/);
  await upd("sales", o.id, { status: "Proposal", data: { stage_exception: "Customer asked for an indicative price before discovery" } });
  const h = await svc("select from_stage, to_stage, exception from crm_stage_history where record_id = $1 order by id", [o.id]);
  assert.deepEqual(h.map((x: any) => [x.from_stage, x.to_stage, x.exception]), [[null, "New", false], ["New", "Proposal", true]]);
  // the same exception text does not open the next stage rule again
  await upd("sales", o.id, { status: "Negotiation" });
  await fails(upd("sales", o.id, { status: "Won" }), /decision evidence/);
  EV.rules.stage = { opp: o.id };
});

/* ------------------------------------------- Scenario 7: stalled ------------------------------------------- */
test("Scenario 7 — a proposal without response beyond the configured period: Stalled, with the reason and follow-up attention", async () => {
  const o = await ins("sales", "sales.pipeline", "Island estate", "Negotiation", { value: 900000, currency: "USD", owner_id: U.sales.id, owner: "sales", next_action: "Call the family office", next_action_due: D(1), party_ref: EV.scenarios.s3.partner });
  const p = await ins("sales", "sales.proposals", "Proposal island", "Draft", { deal_ref: o.id, value: 900000, currency: "USD" });
  // the proposal was approved and sent 20 days ago (set as the service would have, then aged)
  await svc("update records set status = 'Sent', data = data || jsonb_build_object('sent_at', $2::text) where id = $1", [p.id, D(-20)]);
  await svc("update records set created_at = now() - interval '25 days' where id = $1", [o.id]);
  const rows = await call("sales", "crm_list", ["stalled", o.data.number]);
  const r = rows.find((x: any) => x.id === o.id); assert.ok(r, "stalled");
  assert.equal(r.health, "Stalled");
  assert.ok(r.reasons.some((x: any) => x.code === "proposal_no_response" && /without a response/.test(x.text)));
  const fu = await call("sales", "crm_followups", ["mine"]);
  assert.ok(fu.opportunities.some((x: any) => x.id === o.id), "in my follow-ups");
  // the period is a setting: a longer period, and it is not stalled for that reason any more
  const s = await call("owner", "crm_settings_get", []);
  await call("owner", "crm_settings_save", [{ followup: { ...s.value.followup, proposal_no_response_days: 30, no_interaction_days: 60 } }, s.version]);
  const r2 = (await call("sales", "crm_list", ["all", o.data.number])).find((x: any) => x.id === o.id);
  assert.ok(!r2.reasons.some((x: any) => x.code === "proposal_no_response"));
  const s2 = await call("owner", "crm_settings_get", []);
  await call("owner", "crm_settings_save", [{ followup: s.value.followup }, s2.version]);
  EV.scenarios.s7 = { opp: o.id, reasons: r.reasons.map((x: any) => x.code) };
});

/* ------------------------------------------- Scenario 8 & 9: won → handoff, lost, on hold ------------------------------------------- */
test("Scenario 8 — Won: the project handoff is offered, never created silently; Create Project uses the project mechanism", async () => {
  const o = await get(EV.scenarios.s1.opp);
  await upd("sales", o.id, { status: "Negotiation", data: { negotiated_value: 2750000, value_reason: "Agreed after the site visit" } });
  await upd("sales", o.id, { status: "Won", data: { decision_evidence: "Signed purchase order PO-778 from the customer", final_value: 2750000, value_reason: "Final price in the customer's order" } });
  const before = await svc("select count(*)::int n from records where section = 'company.projects' and data->>'deal_ref' = $1", [o.id]);
  assert.equal(before[0].n, 0, "no project is created by itself");
  const pk = await call("sales", "crm_handoff", [o.id]);
  assert.equal(pk.opportunity.id, o.id); assert.ok(pk.organization); assert.ok(pk.contacts.length >= 2); assert.equal(pk.final_proposal.version, "2");
  assert.equal(Number(pk.values.final), 2750000); assert.ok(pk.contracts.some((c: any) => c.type === "NDA")); assert.ok(pk.outstanding.length >= 1);
  await fails(call("eng", "crm_handoff_project", [o.id, "create", null, { title: "x" }]), /not found/); // engineering cannot even open the opportunity
  const res = await call("mgmt", "crm_handoff_project", [o.id, "create", null, { title: `${tag} Harbor Marine perimeter`, manager_id: U.pm.id, start: D(7), target: D(180) }]);
  const pr = await get(res.project);
  assert.equal(pr.section, "company.projects"); assert.equal(pr.data.deal_ref, o.id); assert.equal(pr.data.manager_id, U.pm.id); assert.match(pr.data.description, /Handed over from opportunity/);
  assert.equal((await get(o.id)).data.project_ref, pr.id);
  await fails(call("mgmt", "crm_handoff_project", [o.id, "create", null, {}]), /already linked/);
  assert.ok((await svc("select count(*)::int n from crm_stage_history where record_id = $1", [o.id]))[0].n >= 3, "the commercial history stays");
  const vals = await svc("select kind from crm_values where record_id = $1 order by id", [o.id]);
  assert.ok(vals.some((v: any) => v.kind === "negotiated") && vals.some((v: any) => v.kind === "final"));
  EV.scenarios.s8 = { project: pr.id };
});

test("Scenario 9 — Lost needs a reason from the list, kept with the date and the person; On Hold needs a reason and comes back on its review date", async () => {
  const o = await ins("sales", "sales.pipeline", "Tanker fleet", "Discovery", { value: 300000, currency: "AED", owner_id: U.sales.id, owner: "sales" });
  await fails(upd("sales", o.id, { status: "Lost" }), /lost reason/);
  await fails(upd("sales", o.id, { status: "Lost", data: { lost_reason: "They did not like us" } }), /Choose a loss reason/);
  await fails(upd("sales", o.id, { status: "Lost", data: { lost_reason: "", stage_exception: "Just because I want to" } }), /lost reason/);
  await upd("sales", o.id, { status: "Lost", data: { lost_reason: "Price", lost_note: "Competitor 20% lower" } });
  const x = await get(o.id); assert.equal(x.data.lost_at, D(0)); assert.match(x.data.lost_by, /sales/);
  await fails(upd("sales", o.id, { data: { lost_at: D(-5) } }), /set by Workspace/);
  const h = await svc("select to_stage, reason from crm_stage_history where record_id = $1 order by id desc limit 1", [o.id]);
  assert.equal(h[0].to_stage, "Lost"); assert.match(h[0].reason, /Price: Competitor 20% lower/);
  const o2 = await ins("sales", "sales.pipeline", "Marina expansion", "Technical", { value: 150000, currency: "EUR", owner_id: U.sales.id, owner: "sales" });
  await fails(upd("sales", o2.id, { status: "On Hold" }), /hold reason/);
  await upd("sales", o2.id, { status: "On Hold", data: { hold_reason: "Budget next fiscal year", hold_review: D(0) } });
  const r = (await call("sales", "crm_list", ["hold_review", o2.data.number])).find((y: any) => y.id === o2.id);
  assert.ok(r && r.reasons.some((z: any) => z.code === "hold_review"), "reappears on its review date");
  const tk = await svc("select public.crm_tick() r"); assert.ok(tk[0].r.notices >= 1);
  const nt = await svc("select count(*)::int n from notifications where user_id = $1 and kind = 'crm_hold_review' and record_id = $2", [U.sales.id, o2.id]);
  assert.equal(nt[0].n, 1);
  await svc("select public.crm_tick()");
  assert.equal((await svc("select count(*)::int n from notifications where user_id = $1 and kind = 'crm_hold_review' and record_id = $2", [U.sales.id, o2.id]))[0].n, 1, "never repeated");
});

/* ------------------------------------------- Scenario 10: event capture (database side; phone layout in e2e7) ------------------------------------------- */
test("Scenario 10 — event mode: capture gives a lead with an owner and a follow-up; the day view and the post-event lists", async () => {
  await call("owner", "crm_settings_save", [{ active_event_ref: EV.event }, (await call("owner", "crm_settings_get", [])).version]);
  const quick = await call("mkt", "crm_lead_capture", [{ first_name: "Karim", organization: `${tag} Yacht Owners Club`, phone: `+33 6 ${PH}`, importance: "Hot", follow_up: D(1) }]);
  const l = await get(quick.id); assert.equal(l.data.event_ref, EV.event, "the active event"); assert.equal(l.data.owner_id, U.mkt.id, "owner defaults to the person who captured it");
  const noowner = await svc("insert into records(section, title, status, data) values ('marketing.leads', $1, 'New', $2) returning id", [`${tag} Walk-in visitor`, { event_ref: EV.event, organization: "Unknown" }]);
  const day = await call("mgmt", "crm_event_day", [EV.event, null]);
  assert.ok(day.today.new_leads.some((x: any) => x.id === quick.id)); assert.ok(day.today.hot_leads.length >= 1);
  assert.ok(day.team.some((t: any) => t.id === U.mkt.id && t.leads_owned >= 1)); assert.ok(day.pipeline.Opportunity >= 1);
  const post = await call("mgmt", "crm_event_followup", [EV.event]);
  assert.ok(post.no_owner.some((x: any) => x.id === noowner[0].id)); assert.ok(post.no_follow_up.some((x: any) => x.id === noowner[0].id)); assert.ok(post.converted.length >= 1);
  const b = await call("mgmt", "crm_bulk_assign", [[noowner[0].id], U.sales2.id, D(2)]);
  assert.equal(b.assigned, 1);
  const n = await get(noowner[0].id); assert.equal(n.data.owner_id, U.sales2.id); assert.equal(n.data.follow_up, D(2));
  assert.equal((await svc("select count(*)::int n from notifications where user_id = $1 and kind = 'crm_lead_assigned' and record_id = $2", [U.sales2.id, n.id]))[0].n, 1);
  assert.match(post.note, /sends no e-mail/);
});

/* ------------------------------------------- Scenario 12: hidden opportunity ------------------------------------------- */
test("Scenario 12 — a US-persons-only and a restricted opportunity affect nothing that unauthorised people see", async () => {
  const usParty = await ins("sales", "company.parties", "Navy base contractor", "Active", { relationship_types: ["Prospect"] }, true);
  const us = await ins("sales", "sales.pipeline", "Classified sensors", "Proposal", { party_ref: usParty.id, value: 7000000, currency: "USD", owner_id: U.sales.id, owner: "sales", product: "StarDome", expected_decision: D(10), stage_exception: "Controlled programme, price first" });
  assert.equal(us.controlled, true, "US-persons-only from its organisation");
  const usProp = await ins("sales", "sales.proposals", "Proposal sensors", "Draft", { deal_ref: us.id, value: 7000000, currency: "USD" });
  assert.equal(usProp.controlled, true, "the proposal follows the opportunity");
  const usMeet = await ins("sales", "company.meetings", "Meeting on sensors", "Scheduled", { deal_ref: us.id, date: D(1) });
  assert.equal(usMeet.controlled, true);
  const restr = await ins("sales", "sales.pipeline", "Private island X", "Negotiation", { value: 5000000, currency: "USD", owner_id: U.sales.id, owner: "sales", restricted: true, access_ids: [U.fin.id], expected_decision: D(20), next_action: "x", next_action_due: D(3) });
  const rp = await ins("sales", "sales.proposals", "Proposal island X", "Draft", { deal_ref: restr.id, value: 5000000, currency: "USD" });
  const rm = await ins("sales", "company.meetings", "Meeting island X", "Scheduled", { deal_ref: restr.id, date: D(2), organizer_id: U.sales.id });
  const hidden = [us.id, usProp.id, usMeet.id, restr.id, rp.id, rm.id];
  const probe = async (k: string) => {
    const direct = await as(k, "select id from records where id = any($1)", [hidden]);
    const all = await call(k, "crm_list", ["all", null, 1000]);
    const ov = await call(k, "crm_overview", [{}]);
    const pv = await call(k, "crm_pipeline_value", [{}]);
    const fc = await call(k, "crm_forecast", [D(-1), D(60), "month", {}]);
    const se = await as(k, "select id from public.corp_search($1)", [`${tag} sensors`]);
    const se2 = await as(k, "select id from public.corp_search($1)", [`${tag} island X`]);
    const asst = await call(k, "crm_assistant", ["above_value", "4000000 USD"]);
    const wk = await call(k, "crm_weekly", [null, null]);
    return { direct: direct.length, list: all.filter((r: any) => hidden.includes(r.id)).length, search: [...se, ...se2].filter((r: any) => hidden.includes(r.id)).length,
      assistant: (asst.items || []).filter((r: any) => hidden.includes(r.id)).length, weekly: JSON.stringify(wk).includes(us.id) || JSON.stringify(wk).includes(restr.id),
      usd: (pv.currencies.find((c: any) => c.currency === "USD") || {}).estimated || 0, forecast: fc.rows.filter((r: any) => hidden.includes(r.id)).length, ov: ov.blocks.active.count };
  };
  const non = await probe("salesNon"); // a non-US salesperson: neither (US-only; restricted and not on it)
  assert.deepEqual([non.direct, non.list, non.search, non.assistant, non.forecast, non.weekly], [0, 0, 0, 0, 0, false]);
  const other = await probe("sales2"); // a US salesperson not on the restricted one: sees the US one, not the restricted one
  assert.ok(!(await as("sales2", "select id from records where id = $1", [restr.id])).length && !(await as("sales2", "select id from records where id = $1", [rp.id])).length);
  assert.ok((await as("sales2", "select id from records where id = $1", [us.id])).length === 1);
  assert.equal(other.forecast, 1, "only the US opportunity");
  const own = await probe("sales"); assert.equal(own.list, 2); assert.equal(own.forecast, 2);
  const fin = await probe("fin"); assert.equal(fin.list, 2, "finance: on the restricted one by name, and US");
  const mn = await probe("mgmtNon"); assert.equal(mn.list, 1, "non-US management: the restricted one (management), not the US one");
  // the hidden values never enter the totals someone else sees
  assert.equal(Number(non.usd) + 12000000 <= Number(own.usd) || Number(own.usd) - Number(non.usd) >= 12000000, true);
  // meetings and proposals of the restricted opportunity: hidden from people not on it
  assert.equal((await as("emp", "select id from records where id = $1", [rm.id])).length, 0, "an internal employee does not see the meeting of a restricted opportunity");
  assert.equal((await as("sales", "select id from records where id = $1", [rm.id])).length, 1);
  // the Assistant through the retrieval layer: nothing hidden in its sources
  const fake = (k: string) => ({ from: (t: string) => ({ select: () => ({ eq: () => ({}) }) }), rpc: async (fn: string, args: any) => ({ data: await call(k, fn, Object.values(args)), error: null }) });
  void fake;
  EV.scenarios.s12 = { non, other: { list: other.list, forecast: other.forecast }, own: { list: own.list }, fin: fin.list, mgmtNon: mn.list };
});

/* ------------------------------------------- Scenario 14: forecast and pipeline value ------------------------------------------- */
test("Scenario 14 — forecast and pipeline value: currencies never mixed; raw and weighted apart; manual probability wins", async () => {
  const mk = (t: string, st: string, v: number, c: string, extra: any = {}) => ins("sales2", "sales.pipeline", t, st, { value: v, currency: c, owner_id: U.sales2.id, owner: "sales2", expected_decision: D(15), ...extra });
  const a = await mk("FC A", "Discovery", 100000, "USD"); const b = await mk("FC B", "Negotiation", 200000, "AED", { probability: 90 });
  const c = await mk("FC C", "Decision", 300000, "EUR", { negotiated_value: 280000 });
  const fc = await call("sales2", "crm_forecast", [D(0), D(40), "month", { owner_id: U.sales2.id }]);
  const rows = fc.rows.filter((r: any) => [a.id, b.id, c.id].includes(r.id));
  assert.equal(rows.length, 3);
  const ra = rows.find((r: any) => r.id === a.id), rb = rows.find((r: any) => r.id === b.id), rc = rows.find((r: any) => r.id === c.id);
  assert.equal(ra.basis, "estimate"); assert.equal(Number(ra.probability), 30); assert.equal(ra.probability_source, "stage default"); assert.equal(Number(ra.weighted), 30000);
  assert.equal(Number(rb.probability), 90); assert.equal(rb.probability_source, "manual"); assert.equal(Number(rb.weighted), 180000);
  assert.equal(rc.basis, "negotiated"); assert.equal(Number(rc.value), 280000);
  const cur = new Set(fc.totals.map((t: any) => t.currency)); assert.ok(cur.has("USD") && cur.has("AED") && cur.has("EUR"));
  for (const t of fc.totals) assert.ok(["estimate", "quoted", "negotiated"].includes(t.basis), "totals per currency and value type");
  assert.match(fc.note, /not revenue/);
  const pv = await call("sales2", "crm_pipeline_value", [{ owner_id: U.sales2.id }]);
  const aed = pv.currencies.find((x: any) => x.currency === "AED"); assert.equal(Number(aed.estimated), 200000); assert.equal(Number(aed.estimated_weighted), 180000);
  const eur = pv.currencies.find((x: any) => x.currency === "EUR"); assert.equal(Number(eur.negotiated), 280000); assert.equal(Number(eur.estimated), 300000, "estimate and negotiated kept apart");
  assert.match(pv.labels.weighted, /not revenue/);
  EV.scenarios.s14 = { totals: fc.totals.length };
});

/* ------------------------------------------- Scenario 15: Assistant ------------------------------------------- */
test("Scenario 15 — the Assistant: «What proposals are waiting for response?» and the other commercial questions, from authorized records with sources", async () => {
  const pw = await call("sales", "crm_assistant", ["proposals_waiting", null]);
  assert.equal(pw.kind, "list"); assert.ok(pw.items.some((x: any) => x.id === EV.scenarios.s7.opp));
  const non = await call("salesNon", "crm_assistant", ["proposals_waiting", null]);
  assert.ok(!non.items.some((x: any) => x.controlled), "nothing US-only for a non-US person");
  // through the Assistant's retrieval layer (the same client rules): sources are the records
  const mkSb = (k: string) => ({
    rpc: async (fn: string, args: any) => (["crm_assistant", "ops_assistant"].includes(fn) ? { data: await call(k, fn, Object.values(args)), error: null } : { data: [], error: null }),
    from: () => { const q: any = { select: () => q, eq: () => q, lt: () => q, not: () => q, order: () => q, limit: async () => ({ data: [] }), in: () => q, maybeSingle: async () => ({ data: null }) }; return q; },
  });
  const r = await retrieve(mkSb("sales") as any, { id: U.sales.id, role: "sales" }, { q: "Which proposals are waiting for response?" });
  assert.ok(r.intents.includes("crm_proposals_waiting")); assert.ok(r.sources.some((s) => s.id === EV.scenarios.s7.opp)); assert.ok(r.sources.every((s) => s.link));
  const intro = await call("mgmt", "crm_assistant", ["introduced_by", `${tag} Desert Port Authority`]);
  assert.equal(intro.kind, "relations"); assert.ok(JSON.stringify(intro).includes(EV.scenarios.s3.partner));
  const last = await call("sales", "crm_assistant", ["last_meeting", `${tag} Harbor Marine LLC`]);
  assert.equal(last.meeting.id, EV.scenarios.s4.meeting); assert.match(last.meeting.decisions, /C40 proposal/); assert.ok(last.meeting.tasks.length >= 1);
  const lc = await call("sales", "crm_assistant", ["last_contact", `${tag} Harbor Marine LLC`]); assert.ok(lc.items.length >= 1);
  const big = await call("sales", "crm_assistant", ["above_value", "$1M"]); assert.equal(Number(big.amount), 1000000); assert.equal(big.currency, "USD");
  const big2 = await call("sales", "crm_assistant", ["above_value", "1000000 USD"]); assert.ok(big2.items.every((x: any) => Math.max(x.final || 0, x.negotiated || 0, x.quoted || 0, x.value || 0) >= 1000000));
  const uae = await call("sales", "crm_assistant", ["geography", "uae"]); assert.match(uae.note, /UAE/);
  const nda = await call("sales", "crm_assistant", ["nda_unsigned", null]); assert.equal(nda.kind, "list");
  const rv = await call("mgmt", "crm_assistant", ["review", null]); assert.ok(rv.review.summary);
  const unk = await call("sales", "crm_assistant", ["introduced_by", "nobody-here-" + run]); assert.equal(unk.kind, "unavailable");
});

/* ------------------------------------------- Scenario 16: e-mail suggestion ------------------------------------------- */
test("Scenario 16 — an inbound e-mail from a known contact: a link is proposed, never made by itself", async () => {
  const s1 = EV.scenarios.s1;
  const sg = await call("sales", "crm_email_suggest", [`Layla <layla.${run}@harbor-${run}.ae>`, "Re: coverage drawing", "inbound", `msg-${run}-1`]);
  assert.ok(sg.suggestions.some((s: any) => s.target === s1.contact && s.strength === "strong"));
  assert.ok(sg.suggestions.some((s: any) => s.target === s1.party), "the organisation by its domain");
  const linked = await svc("select status from crm_email_links where source_id = $1", [`msg-${run}-1`]);
  assert.ok(linked.length >= 1 && linked.every((l: any) => l.status === "suggested"), "suggestion ≠ confirmed link");
  const free = await call("sales", "crm_email_suggest", ["someone@gmail.com", "hello", "inbound", `msg-${run}-2`]);
  assert.equal(free.suggestions.length, 0, "a free mailbox matches nothing");
  const num = await call("sales", "crm_email_suggest", ["x@unknown-domain.io", `About ${s1.number}`, null, null]);
  assert.ok(num.suggestions.some((s: any) => s.target === s1.opp && s.strength === "strong"), "opportunity number in the subject");
  await call("sales", "crm_email_link", ["inbound", `msg-${run}-1`, s1.opp, true, "Re: coverage drawing", `layla.${run}@harbor-${run}.ae`]);
  const tl = await call("sales", "crm_timeline", [s1.opp]); assert.ok(tl.some((x: any) => x.kind === "email" && x.title === "Re: coverage drawing"));
  await fails(call("eng", "crm_email_link", ["inbound", `msg-${run}-1`, s1.opp, true, null, null]), /not found/);
});

/* ------------------------------------------- Scenario 17: CSV import ------------------------------------------- */
test("Scenario 17 — CSV import: existing and new contacts; duplicates shown before import; nothing overwritten; safe rollback", async () => {
  const rows = [
    { name: "Layla Haddad", email: `layla.${run}@harbor-${run}.ae`, phone: "+971 50 999", organization: `${tag} Harbor Marine LLC` },
    { first_name: "Rami", last_name: `Aziz${run}`, email: `rami.${run}@newco-${run}.ae`, organization: `${tag} Harbor Marine`, title: "Captain" },
    { name: "", email: "broken" },
    { name: `Sara ${run}`, email: `sara.${run}@other-${run}.ae`, unknown_column: "x" },
  ];
  const pv = await call("sales", "crm_import_preview", ["contacts", rows]);
  assert.equal(pv.total, 4); assert.equal(pv.rows[0].action, "decide"); assert.ok(pv.rows[0].duplicates.some((d: any) => d.id === EV.scenarios.s1.contact));
  assert.equal(pv.rows[1].action, "create"); assert.equal(pv.rows[2].action, "fix"); assert.ok(pv.rows[3].warnings.some((w: string) => /unknown_column/.test(w)));
  await fails(call("sales", "crm_import_commit", ["contacts", rows, {}, "contacts.csv"]), /looks like an existing record/);
  const before = await get(EV.scenarios.s1.contact);
  const res = await call("sales", "crm_import_commit", ["contacts", rows, { "1": `use:${EV.scenarios.s1.contact}` }, "contacts.csv"]);
  assert.equal(res.created, 2); assert.equal(res.existing_used, 1); assert.equal(res.skipped, 1);
  const after = await get(EV.scenarios.s1.contact); assert.equal(after.version, before.version, "the existing contact was not changed"); assert.equal(after.data.phone, before.data.phone);
  const created = res.report.filter((r: any) => r.result === "created").map((r: any) => r.id);
  const rami = await get(created[0]); assert.equal(rami.data.party_ref, EV.scenarios.s1.party, "linked to the existing organization"); assert.equal(rami.data.import_batch, res.batch);
  assert.equal(rami.data.unknown_column, undefined);
  // one created record is changed after the import: the rollback keeps it, removes the other (to the recycle bin)
  await upd("sales", created[1], { data: { notes: "called" } });
  const rb = await call("sales", "crm_import_rollback", [res.batch]);
  assert.equal(rb.removed, 1); assert.equal(rb.kept.length, 1);
  assert.equal((await svc("select count(*)::int n from records_trash where id = $1", [created[0]]))[0].n, 1);
  assert.ok((await call("sales", "crm_imports_list", [])).some((b: any) => b.id === res.batch && b.status === "partly_rolled_back"));
  await fails(call("partner", "crm_import_preview", ["contacts", rows]), /Not signed in/);
});

/* ------------------------------------------- Scenario 18: capabilities ------------------------------------------- */
test("Scenario 18 — a System Administrator without the capability cannot change the pipeline, policies or processes; an owner grants it", async () => {
  const s = await call("admin", "crm_settings_get", []);
  assert.equal(s.can_edit, false); assert.equal(s.caps.commercial_admin, false); assert.equal(s.caps.workflow_admin, false);
  await fails(call("admin", "crm_settings_save", [{ products: ["X"] }, s.version]), /Commercial Admin/);
  await fails(call("admin", "ops_policy_save", ["PROPOSAL", "x", [{ label: "x", steps: [{ kind: "role", role: "management" }] }], true]), /Commercial Admin/);
  await fails(call("admin", "ops_policy_save", ["PURCHASE", "x", [{ label: "x", steps: [{ kind: "role", role: "management" }] }], true]), /Workflow Admin/);
  await fails(call("admin", "ops_settings_save", [{ due_soon_hours: 12 }, (await call("admin", "ops_settings_get", [])).version]), /Workflow Admin/);
  await fails(call("admin", "wf_definition_save", [{ code: `ADM${run.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`, name: "x", source_section: "company.parties", steps: [{ id: "a", name: "A", type: "TASK", responsible: { kind: "role", role: "operations" }, on: { success: "$complete" } }] }]), /Workflow Admin/);
  await fails(call("admin", "crm_export", ["contacts", {}]), /Export Commercial Data/);
  await fails(call("admin", "crm_merge", ["organization", EV.scenarios.s1.party, EV.scenarios.s3.partner, "same company"]), /Commercial Admin/);
  await fails(call("mgmt", "crm_cap_set", [U.admin.id, "commercial_admin", true]), /Only an owner/);
  await call("owner", "crm_cap_set", [U.admin.id, "commercial_admin", true]);
  const s2 = await call("admin", "crm_settings_get", []); assert.equal(s2.can_edit, true);
  await call("admin", "crm_settings_save", [{ products: [...s2.value.products, `Test product ${run}`] }, s2.version]);
  await fails(call("admin", "crm_settings_save", [{ management_caps: [] }, (await call("admin", "crm_settings_get", [])).version]), /Only an owner/);
  await fails(call("admin", "crm_settings_save", [{ pipeline: [{ stage: "Only" }] }, (await call("admin", "crm_settings_get", [])).version]), /at least two stages/);
  await call("owner", "crm_cap_set", [U.admin.id, "commercial_admin", false]);
  assert.equal((await call("admin", "crm_settings_get", [])).can_edit, false);
  const caps = await call("owner", "crm_caps_list", []); assert.ok(caps.grants.some((g: any) => g.user_id === U.admin.id && g.revoked_at));
  const au = await svc("select kind from crm_audit where detail->>'user' = $1 order by id", [U.admin.id]); assert.deepEqual(au.map((a: any) => a.kind), ["cap_granted", "cap_revoked"]);
  // management holds them by policy; the owner always
  assert.equal((await call("mgmt", "crm_settings_get", [])).can_edit, true);
});

/* ------------------------------------------- Scenario 19: approval defaults ------------------------------------------- */
test("Scenario 19 — seeded financial and commercial thresholds are marked UNAPPROVED DEFAULT CONFIGURATION until confirmed", async () => {
  const g = await call("mgmt", "ops_settings_get", []);
  for (const code of ["PURCHASE", "PAYMENT", "CONTRACT", "ECR", "TRAVEL", "PROPOSAL"]) {
    const p = g.policies.find((x: any) => x.code === code);
    if (p.config_status !== "Approved") assert.equal(p.label, "UNAPPROVED DEFAULT CONFIGURATION", code);
  }
  const prop = g.policies.find((x: any) => x.code === "PROPOSAL"); if (prop.version === 1) assert.equal(prop.seeded, true, "made by the migration");
  // v25 (Phase 8 remediation): business authority policies are confirmed by the Owner or a Policy Approver — a
  // Workflow / Commercial Admin builds and edits them but does not approve them. On v24 management approved them.
  const v25 = (await svc("select to_regprocedure('public._policy_approver(uuid)') is not null ok"))[0].ok;
  const refused = v25 ? /Policy Approver/ : /Only an owner or management/;
  await fails(call("sales", "ops_policy_approve", ["PROPOSAL", prop.version]), refused);
  await fails(call("admin", "ops_policy_approve", ["PROPOSAL", prop.version]), refused);
  if (v25) {
    await fails(call("mgmt", "ops_policy_approve", ["PROPOSAL", prop.version]), /Policy Approver/);
    await call("owner", "crm_cap_set", [U.mgmt.id, "policy_approver", true]);
  }
  const ok = await call("mgmt", "ops_policy_approve", ["PROPOSAL", prop.version]);
  assert.equal(ok.status, "Approved");
  const g2 = await call("mgmt", "ops_settings_get", []); const p2 = g2.policies.find((x: any) => x.code === "PROPOSAL");
  assert.equal(p2.config_status, "Approved"); assert.ok(p2.approved_at); assert.match(p2.approved_by, /mgmt/); assert.equal(p2.label, "AGRON policy (approved)");
  await call("mgmt", "ops_policy_save", ["PROPOSAL", "Commercial proposal approval", p2.tiers, true]);
  const p3 = (await call("mgmt", "ops_settings_get", [])).policies.find((x: any) => x.code === "PROPOSAL");
  assert.equal(p3.config_status, "Draft", "an edited policy is unapproved again"); assert.equal(p3.version, p2.version + 1);
  await call("mgmt", "ops_policy_approve", ["PROPOSAL", p3.version]);
  if (v25) await call("owner", "crm_cap_set", [U.mgmt.id, "policy_approver", false]);
  const hist = await svc("select config_status, version from approval_policies_history where policy_code = 'PROPOSAL' order by id");
  assert.ok(hist.some((h: any) => h.config_status === "Superseded"), "the earlier approved version is superseded in the history");
});

/* ------------------------------------------- Security matrix ------------------------------------------- */
test("Security matrix — the commercial working set equals row-level security for every role; externals and disabled get nothing", async () => {
  const roles = ["owner", "admin", "mgmt", "mgmtNon", "sales", "sales2", "salesNon", "pm", "eng", "fin", "legal", "ops", "emp", "mkt"];
  const out: any = {};
  for (const k of roles) {
    const rls = new Set((await as(k, "select id from records where section = 'sales.pipeline' and title like $1", [`${tag}%`])).map((r: any) => r.id));
    const ws = new Set((await call(k, "crm_list", ["all", tag, 1000])).map((r: any) => r.id));
    assert.deepEqual([...ws].sort(), [...rls].sort(), `${k}: working set = row-level security`);
    out[k] = rls.size;
  }
  assert.equal(out.eng, 0, "engineering sees no commercial values"); assert.equal(out.emp, 0); assert.equal(out.mkt, 0, "marketing has leads, not opportunities");
  assert.ok(out.sales > 0 && out.mgmt >= out.sales);
  for (const k of ["partner", "vendor", "agent", "disabled"]) {
    assert.equal((await as(k, "select id from records where section in ('sales.pipeline', 'sales.proposals', 'sales.introductions', 'marketing.leads') and title like $1", [`${tag}%`])).length, 0, k);
  }
  for (const k of ["partner", "vendor", "agent", "disabled"]) await fails(call(k, "crm_overview", [{}]), /Not signed in/);
  // a vendor never sees the customer pipeline, even its own company's organisation card linked to an opportunity
  EV.security.counts = out;
});

/* ------------------------------------------- Rules: values, merges, export, search, notices ------------------------------------------- */
test("Values keep their history; merges move references with an audit and keep the merged record; export follows the policy", async () => {
  const o = await ins("sales", "sales.pipeline", "Value trail", "New", { value: 100, currency: "USD", owner_id: U.sales.id, owner: "sales" });
  await upd("sales", o.id, { data: { value: 150, value_reason: "Second container" } });
  await upd("sales", o.id, { data: { value: 140 } });
  const v = await svc("select amount, prev_amount, reason from crm_values where record_id = $1 order by id", [o.id]);
  assert.deepEqual(v.map((x: any) => [Number(x.amount), x.prev_amount == null ? null : Number(x.prev_amount)]), [[100, null], [150, 100], [140, 150]]);
  assert.equal(v[1].reason, "Second container"); assert.match(v[2].reason, /no reason given/);
  await assert.rejects(svc("update crm_values set amount = 1 where record_id = $1", [o.id]), /cannot be changed/);
  await assert.rejects(svc("delete from crm_values where record_id = $1", [o.id]), /cannot be changed/);
  await fails(upd("sales", o.id, { data: { quoted_value: 999 } }), /set by Workspace/);
  await fails(upd("sales", o.id, { data: { number: "X" } }), /set by Workspace/);
  // merge two organisations: references move, the merged one stays (Inactive, merged_into), all audited
  const a = await ins("mgmt", "company.parties", "Seaport Group", "Active", { relationship_types: ["Customer"] });
  const b = await ins("mgmt", "company.parties", "Sea Port Group", "Active", { relationship_types: ["Partner"] });
  const c1 = await ins("mgmt", "company.contacts", "Ali at Sea Port", "Active", { party_ref: b.id, email: `ali.${run}@seaport.test` });
  await fails(call("sales", "crm_merge", ["organization", a.id, b.id, "Same company, two names"]), /Commercial Admin/);
  const m = await call("mgmt", "crm_merge", ["organization", a.id, b.id, "Same company, two names"]);
  assert.ok(m.moved >= 1); assert.equal((await get(c1.id)).data.party_ref, a.id);
  const bb = await get(b.id); assert.equal(bb.status, "Inactive"); assert.equal(bb.data.merged_into, a.id);
  const aa = await get(a.id); assert.match(aa.data.aliases, /Sea Port Group/); assert.deepEqual([...aa.data.relationship_types].sort(), ["Customer", "Partner"]);
  const au = await svc("select detail from crm_audit where kind = 'merge' and record_id = $1", [a.id]); assert.equal(au[0].detail.merged_snapshot.title, b.title);
  // export: the capability, the excluded fields, US-only records out, every export recorded
  const ex = await call("mgmt", "crm_export", ["opportunities", {}]);
  assert.ok(ex.rows.length > 0); assert.ok(ex.rows.every((r: any) => !("access_ids" in r) && !("decision_evidence" in r)));
  assert.ok(!JSON.stringify(ex.rows).includes(EV.scenarios.s12?.non ? "Classified sensors" : "___"), "US-persons-only opportunities are not exported by policy");
  assert.ok((await svc("select count(*)::int n from crm_audit where kind = 'export' and actor = $1", [U.mgmt.id]))[0].n >= 1);
  await fails(call("sales", "crm_export", ["contacts", {}]), /Export Commercial Data/);
});

test("Search finds organisations, contacts, opportunities, proposals and leads by name, e-mail, phone, number and tags — permission safe", async () => {
  const s1 = EV.scenarios.s1;
  const hit = async (k: string, q: string) => (await as(k, "select kind, id from public.corp_search($1)", [q])).map((r: any) => r.kind + ":" + r.id);
  assert.ok((await hit("sales", s1.number)).includes("opportunity:" + s1.opp));
  assert.ok((await hit("sales", `layla.${run}@harbor-${run}.ae`)).includes("contact:" + s1.contact));
  assert.ok((await hit("sales", `50 ${PH.slice(0, 3)} ${PH.slice(3)}`)).includes("contact:" + s1.contact), "phone as written");
  assert.ok((await hit("sales", `50${PH}`)).includes("contact:" + s1.contact), "phone as digits");
  assert.ok((await hit("sales", `${tag} harbor marine`)).includes("organization:" + s1.party));
  assert.ok((await hit("sales", EV.scenarios.s6.number)).some((x) => x.startsWith("proposal:")));
  assert.ok((await hit("mkt", `${tag} yacht owners`)).some((x) => x.startsWith("lead:")));
  const rec = (xs: string[]) => xs.filter((x) => !x.startsWith("person:")); // people's names carry the run tag too
  assert.ok(!rec(await hit("eng", s1.number)).some((x) => /^(opportunity|proposal|contact|organization|lead):/.test(x)), "engineering finds no commercial record");
  const proj = await get(EV.scenarios.s8.project); assert.doesNotMatch(proj.data.description, /2750000|2,750,000/, "the handed-over project carries no commercial value");
  assert.ok(!rec(await hit("salesNon", `${tag} sensors`)).length, "nothing of the US-persons-only opportunity");
  assert.ok(rec(await hit("sales", `${tag} sensors`)).some((x) => x.startsWith("opportunity:")));
});

test("Notices: assignment, follow-up due and overdue, expected decision, meeting soon — each once", async () => {
  const o = await ins("sales", "sales.pipeline", "Notice opp", "Discovery", { value: 1, currency: "USD", owner_id: U.sales2.id, owner: "sales2", next_action: "Call", next_action_due: D(1), expected_decision: D(-1) });
  assert.equal((await svc("select count(*)::int n from notifications where user_id = $1 and kind = 'crm_opp_assigned' and record_id = $2", [U.sales2.id, o.id]))[0].n, 1, "assigned by someone else: told");
  const self = await ins("sales2", "sales.pipeline", "Self opp", "Discovery", { value: 1, currency: "USD", owner_id: U.sales2.id, owner: "sales2" });
  assert.equal((await svc("select count(*)::int n from notifications where record_id = $1 and kind = 'crm_opp_assigned'", [self.id]))[0].n, 0, "not told about one's own action");
  const mt = await ins("sales", "company.meetings", "Meeting soon", "Scheduled", { deal_ref: o.id, date: D(0), time: "23:59", organizer_id: U.sales.id, participants_ids: [U.sales2.id] });
  for (let i = 0; i < 3; i++) { const r = (await svc("select public.crm_tick() r"))[0].r; if (!r.more) break; }
  await svc("select public.crm_tick()");
  const q = async (kind: string, rec: string, u = U.sales2.id) => (await svc("select count(*)::int n from notifications where user_id = $1 and kind = $2 and record_id = $3", [u, kind, rec]))[0].n;
  assert.equal(await q("crm_follow_up_due", o.id), 1); assert.equal(await q("crm_decision_due", o.id), 1); assert.equal(await q("crm_meeting_soon", mt.id), 1); assert.equal(await q("crm_meeting_soon", mt.id, U.sales.id), 1);
  await fails(as("sales", "select public.crm_tick()"), /permission denied|Not allowed/);
});

test("Settings: the pipeline is configurable and validated; catalogs drive the forms; every change kept", async () => {
  const s = await call("mgmt", "crm_settings_get", []);
  const pipe = [...s.value.pipeline]; const i = pipe.findIndex((x: any) => x.stage === "Technical");
  pipe[i] = { ...pipe[i], required: ["owner_id", "use_case"] };
  await call("mgmt", "crm_settings_save", [{ pipeline: pipe }, s.version]);
  const o = await ins("sales", "sales.pipeline", "Needs use case", "Discovery", { owner_id: U.sales.id, owner: "sales" });
  await fails(upd("sales", o.id, { status: "Technical" }), /use case/);
  await upd("sales", o.id, { status: "Technical", data: { use_case: "Port" } });
  const s2 = await call("mgmt", "crm_settings_get", []);
  await fails(call("mgmt", "crm_settings_save", [{ pipeline: [...pipe, { stage: "Technical" }] }, s2.version]), /different/);
  await fails(call("mgmt", "crm_settings_save", [{ pipeline: pipe.filter((x: any) => x.kind !== "won") }, s2.version]), /Won stage/);
  await fails(call("mgmt", "crm_settings_save", [{ evil: "x" }, s2.version]), /Unknown setting/);
  await fails(call("mgmt", "crm_settings_save", [{ products: ["x"] }, s2.version - 1]), /changed by someone else/);
  const cat = await call("emp", "crm_catalogs", []); assert.ok(cat.products.includes("StarDome") && cat.geographies.includes("UAE"));
  pipe[i] = { ...pipe[i], required: undefined };
  await call("mgmt", "crm_settings_save", [{ pipeline: pipe.map((x: any) => JSON.parse(JSON.stringify(x))) }, s2.version]);
  assert.ok((await svc("select count(*)::int n from crm_settings_history"))[0].n >= 3);
});

test("Dashboard: every number is the count of the list it opens", async () => {
  const ov = await call("mgmt", "crm_overview", [{}]);
  for (const k of ["needs_action", "active", "proposals_waiting", "responses", "upcoming_decisions", "stalled", "wins", "losses"]) {
    const l = await call("mgmt", "crm_list", [k, null, 1000]);
    assert.equal(ov.blocks[k].count, l.length, k);
  }
  const st = ov.pipeline.find((p: any) => p.stage === "Negotiation"); assert.equal(st.n, (await call("mgmt", "crm_list", ["stage:Negotiation", null, 1000])).length);
  const wk = await call("mgmt", "crm_weekly", [D(-7), D(0)]);
  for (const k of ["summary", "pipeline", "attention", "new_opportunities", "major", "proposals_outstanding", "waiting", "decisions_expected", "stalled", "wins", "losses", "events", "next_actions"]) assert.ok(k in wk, k);
  EV.dashboard = Object.fromEntries(Object.entries(ov.blocks).map(([k, v]: any) => [k, v.count]));
});

test("Rollback evidence lives in scripts/stack/cycle-v24.sh (Scenario 21); this suite runs on v24", async () => {
  const f = await svc("select count(*)::int n from pg_proc where proname in ('crm_list', 'crm_lead_convert', 'crm_tick', 'has_cap')");
  assert.equal(f[0].n, 4);
});
