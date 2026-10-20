// Phase 4 through the running application: upload of versions by the server route (hashing, numbering), approval
// of an exact version in a sequential chain configured by document type (Engineering → Management → Legal),
// changes requested, a new version and a fresh approval, the audited download route and revoked sessions.
// Scenario 4 of the Phase 4 plan. Synthetic people and data.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { admin, APP, ENV, makeUser, PASSWORD, sql, uid } from "./_stack.ts";

const db = admin(); const run = uid(); const skip = !APP;
const U: Record<string, any> = {}; const K: Record<string, string> = {};
async function cookiesFor(email: string) {
  const jar = new Map<string, string>();
  const c = createServerClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
const ip = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const post = (path: string, body: any, who: string) => fetch(APP + path, { method: "POST", headers: { "content-type": "application/json", cookie: K[who], "x-forwarded-for": ip() }, body: JSON.stringify(body) });
const upload = async (who: string, record: string, name: string, text: string, extra: Record<string, string> = {}) => {
  const fd = new FormData(); fd.set("record_id", record); fd.set("file", new File([text], name, { type: "text/plain" })); for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fetch(APP + "/api/documents", { method: "POST", headers: { cookie: K[who], "x-forwarded-for": ip() }, body: fd });
};
const decide = async (who: string, record: string, decision: string, comment = "") => {
  const [a] = await sql("select id from approvals where record_id = $1 and approver_id = $2 and status = 'pending'", [record, U[who].id]);
  assert.ok(a, `${who} has a pending step`); return post("/api/approvals", { action: "decide", id: a.id, decision, comment }, who);
};

before(async () => {
  if (skip) return;
  for (const [k, role, us] of [["eng", "engineering", true], ["eng2", "engineering", true], ["mgmt", "management", true], ["legal", "legal", true], ["nonus", "engineering", false], ["ven", "vendor", false]] as const) {
    U[k] = await makeUser(`a${k}-${run}@agron-stack.test`, role, { us, name: `${k} ${run}`, company: k === "ven" ? `V${run}` : undefined }); K[k] = await cookiesFor(U[k].email);
  }
  // the document type is configured by an administrator: three steps in order, roles not hardcoded in the code
  await db.from("taxonomy").upsert({ kind: "doc_type", code: `Chain ${run}`, label: { en: `Chain ${run}` }, meta: { prefix: "CHN", approval: { mode: "sequential", steps: [{ label: "Engineering", roles: ["engineering"] }, { label: "Management", roles: ["management"] }, { label: "Legal", roles: ["legal"] }] } } });
});

test("4. approval belongs to one exact version: V1 sent → changes requested → V2 uploaded → V2 approved in three steps", { skip }, async () => {
  const { data: d } = await db.from("records").insert({ section: "company.documents", title: `Export policy ${run}`, status: "Draft", created_by: U.eng.id, data: { doc_type: `Chain ${run}`, owner_id: U.eng.id } }).select("*").single();
  assert.match(d.data.doc_number, /^AGR-CHN-\d{4}$/);
  assert.equal((await post("/api/approvals", { action: "request", record_id: d.id, approver_ids: [U.eng2.id, U.mgmt.id, U.legal.id] }, "eng")).status, 400, "no version yet → nothing to approve");
  const u1 = await upload("eng", d.id, "policy.txt", "policy v1"); assert.equal(u1.status, 200, await u1.clone().text()); const v1 = (await u1.json()).version;
  assert.equal(v1.sha256, createHash("sha256").update("policy v1").digest("hex"));
  const steps = await (await post("/api/approvals", { action: "approvers", record_id: d.id }, "eng")).json();
  assert.equal(steps.mode, "sequential"); assert.deepEqual(steps.steps.map((s: any) => s.label), ["Engineering", "Management", "Legal"]);
  assert.ok(steps.steps[1].people.every((p: any) => p.role === "management"), "each step offers only its roles");
  assert.equal((await post("/api/approvals", { action: "request", record_id: d.id, approver_ids: [U.legal.id, U.mgmt.id, U.eng2.id] }, "eng")).status, 400, "a person not allowed for the step is refused");
  const r1 = await post("/api/approvals", { action: "request", record_id: d.id, approver_ids: [U.eng2.id, U.mgmt.id, U.legal.id] }, "eng"); assert.equal(r1.status, 200, await r1.clone().text());
  let chain = await sql("select step, status, version_id from approvals where record_id = $1 and status <> 'cancelled' order by step", [d.id]);
  assert.deepEqual(chain.map((c: any) => c.status), ["pending", "queued", "queued"]); assert.ok(chain.every((c: any) => c.version_id === v1.id));
  assert.equal((await sql("select status from records where id = $1", [d.id]))[0].status, "In review");
  assert.equal((await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'approval_requested'", [U.mgmt.id]))[0].n, 0, "a queued step is not a request yet");
  assert.equal((await decide("eng2", d.id, "approved")).status, 200);
  chain = await sql("select step, status from approvals where record_id = $1 and version_id = $2 order by step", [d.id, v1.id]); assert.deepEqual(chain.map((c: any) => c.status), ["approved", "pending", "queued"]);
  assert.equal((await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'approval_requested'", [U.mgmt.id]))[0].n, 1, "the next approver is told");
  assert.equal((await decide("mgmt", d.id, "changes_requested", "Add the ITAR clause")).status, 200);
  chain = await sql("select step, status from approvals where record_id = $1 and version_id = $2 order by step", [d.id, v1.id]); assert.deepEqual(chain.map((c: any) => c.status), ["approved", "changes_requested", "cancelled"]);
  assert.equal((await sql("select status from records where id = $1", [d.id]))[0].status, "Changes requested");
  assert.equal((await sql("select approval_state from document_versions where id = $1", [v1.id]))[0].approval_state, "changes_requested");
  // V2 and a fresh chain
  const v2 = (await (await upload("eng", d.id, "policy.txt", "policy v2 with ITAR clause", { note: "ITAR clause added" })).json()).version;
  assert.equal(v2.label, "0.2"); assert.equal((await sql("select status from records where id = $1", [d.id]))[0].status, "Draft");
  assert.equal((await post("/api/approvals", { action: "request", record_id: d.id, approver_ids: [U.eng2.id, U.mgmt.id, U.legal.id] }, "eng")).status, 200);
  for (const k of ["eng2", "mgmt", "legal"]) assert.equal((await decide(k, d.id, "approved", `ok ${k}`)).status, 200, k);
  const [rec] = await sql("select status, data->>'approved_version' a, data->>'approved_version_id' ai from records where id = $1", [d.id]);
  assert.deepEqual([rec.status, rec.a, rec.ai], ["Approved", "0.2", v2.id]);
  const [vv2] = await sql("select approval_state, approved_by, approved_at from document_versions where id = $1", [v2.id]);
  assert.deepEqual([vv2.approval_state, vv2.approved_by], ["approved", U.legal.id]); assert.ok(vv2.approved_at);
  assert.equal((await sql("select approval_state from document_versions where id = $1", [v1.id]))[0].approval_state, "changes_requested", "V0.1 was never approved");
  // proof: who approved which version and when
  const proof = await sql("select step, decided_by, decided_at, status from approvals where version_id = $1 and status = 'approved' order by step", [v2.id]);
  assert.deepEqual(proof.map((p: any) => p.decided_by), [U.eng2.id, U.mgmt.id, U.legal.id]); assert.ok(proof.every((p: any) => p.decided_at));
  assert.ok((await sql("select count(*)::int n from activity where record_id = $1 and action = 'version_approved' and detail->>'version' = '0.2'", [d.id]))[0].n === 1);
  const [dec] = await sql("select title, data->>'document_ref' doc, data->>'version' v, data->>'doc_number' n from records where section = 'company.decisions' and data->>'source_ref' = $1", [d.id]);
  assert.ok(dec, "the approval is in the decision log"); assert.equal(dec.doc, d.id); assert.equal(dec.v, "0.2"); assert.match(dec.n, /^AGR-DEC-/);
  // the approved V0.2 becomes effective; V0.3 starts a new draft and is not approved by V0.2's approval
  const eff = await fetch(`${ENV.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/records?id=eq.${d.id}`, { method: "PATCH", headers: { apikey: ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json", authorization: `Bearer ${(await (await import("./_stack.ts")).signIn(U.eng.email)).token}` }, body: JSON.stringify({ status: "Effective" }) });
  assert.ok(eff.status < 300, await eff.text());
  const v3 = (await (await upload("eng", d.id, "policy.txt", "policy v3")).json()).version;
  assert.equal((await sql("select approval_state from document_versions where id = $1", [v3.id]))[0].approval_state, "none");
});

test("downloads through the server route: allowed and refused attempts are logged; a revoked session is refused", { skip }, async () => {
  const { data: d } = await db.from("records").insert({ section: "company.documents", title: `Controlled drawing ${run}`, status: "Draft", created_by: U.eng.id, data: { doc_type: "Engineering documentation", classification: "US Persons Only", owner_id: U.eng.id } }).select("*").single();
  const v = (await (await upload("eng", d.id, "drawing.txt", "secret geometry")).json()).version; assert.ok(v?.id);
  const ok = await post("/api/documents", { action: "open", version_id: v.id }, "eng"); assert.equal(ok.status, 200);
  const url = (await ok.json()).url; assert.equal(await (await fetch(url)).text(), "secret geometry");
  for (const k of ["nonus", "ven"]) assert.equal((await post("/api/documents", { action: "open", version_id: v.id }, k)).status, 404, `${k} gets no link`);
  assert.equal((await upload("nonus", d.id, "x.txt", "x")).status, 404, "nor can add a version");
  const log = await sql("select user_id, ok, ip from document_access_log where record_id = $1 order by id", [d.id]);
  assert.ok(log.some((l: any) => l.user_id === U.eng.id && l.ok)); assert.ok(log.some((l: any) => l.user_id === U.nonus.id && !l.ok)); assert.ok(log.every((l: any) => l.ip));
  await new Promise((r) => setTimeout(r, 1100)); await db.rpc("revoke_sessions", { p_user: U.eng.id });
  assert.equal((await post("/api/documents", { action: "open", version_id: v.id }, "eng")).status, 401, "a revoked session is refused");
});
