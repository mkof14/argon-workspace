// Row-level security for every role, through the API (PostgREST) and directly in the database, plus Storage,
// external-user isolation, US-persons-only data, ended sessions, switched-off accounts and two-step sign-in.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { admin, anon, asJwt, jwt, makeUser, signIn, sql, totp, uid } from "./_stack.ts";
import { ROLES, allSections } from "../../src/config/workspace.config.mjs";

const SECS: any[] = allSections() as any[];
const ROLE_KEYS = Object.keys(ROLES).filter((r) => r !== "pending");
const EXTERNAL = ["partner", "vendor", "investor"];
const run = uid();
type U = { id: string; email: string; role: string; us: boolean; company: string | null };
const users: Record<string, U> = {};
let access: { section: string; role: string; can_write: boolean }[] = [];
let recs: { id: string; section: string; controlled: boolean; company: string | null }[] = [];

before(async () => {
  const a = admin();
  await makeUser(`first-${run}@agron-stack.test`, "owner"); // the very first account becomes owner by design
  for (const r of ROLE_KEYS) {
    const company = r === "partner" ? "Acme" : r === "vendor" ? "Beta" : r === "investor" ? "Gamma" : null;
    users[r] = { ...(await makeUser(`${r}-${run}@agron-stack.test`, r, { us: false, company })), us: false, company };
  }
  users["engineering-us"] = { ...(await makeUser(`eng-us-${run}@agron-stack.test`, "engineering", { us: true })), us: true, company: null };
  users["pending"] = { ...(await makeUser(`pending-${run}@agron-stack.test`, "pending")), us: false, company: null };
  access = (await a.from("section_access").select("section,role,can_write")).data as any;
  // four synthetic records in every section: ordinary, US-persons-only, shared with one company, shared with all partners
  const rows: any[] = [];
  for (const s of SECS) for (const [controlled, company] of [[false, null], [true, null], [false, "Acme"], [false, "*"]] as const)
    rows.push({ section: s.id, title: `RLS ${s.id} ${controlled ? "C" : ""}${company || ""} ${run}`, status: s.statuses[0], data: { rls: run }, controlled, company });
  const { data, error } = await a.from("records").insert(rows).select("id,section,controlled,company");
  if (error) throw error; recs = data as any;
});

/** What the database rules say a person must see (the reference the tests check against). */
function expected(u: U) {
  const full = u.role === "owner" || u.role === "admin";
  const readable = new Set(access.filter((x) => x.role === u.role).map((x) => x.section));
  const external = EXTERNAL.includes(u.role) || u.role === "pending";
  return new Set(recs.filter((r) => (full || readable.has(r.section)) && (!r.controlled || u.us) && (!external || r.company === "*" || (u.company && r.company === u.company))).map((r) => r.id));
}
async function visibleApi(u: U) {
  const { c } = await signIn(u.email);
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) { const { data, error } = await c.from("records").select("id").eq("data->>rls", run).range(from, from + 999); if (error) throw error; for (const r of data || []) out.add(r.id); if (!data || data.length < 1000) break; }
  return out;
}
async function visibleDb(u: U) {
  // straight to Postgres as the API role with this person's claims — what any direct database request would get
  const c = await (await import("./_stack.ts")).pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, role: "authenticated", aal: "aal1", iat: Math.floor(Date.now() / 1000) })]);
    const r = await c.query("select id from public.records where data->>'rls' = $1", [run]); await c.query("rollback");
    return new Set(r.rows.map((x: any) => x.id));
  } finally { c.release(); }
}

test("every role sees exactly the records the access rules allow — through the API", async () => {
  for (const [k, u] of Object.entries(users)) {
    const want = expected(u), got = await visibleApi(u);
    const extra = [...got].filter((x) => !want.has(x)), missing = [...want].filter((x) => !got.has(x));
    assert.deepEqual({ k, extra: extra.length, missing: missing.length }, { k, extra: 0, missing: 0 });
    if (k === "owner") assert.equal(got.size, recs.length - recs.filter((r) => r.controlled).length, "a non-US owner does not see US-persons-only records");
  }
});

test("…and the same directly in the database", async () => {
  for (const [k, u] of Object.entries(users)) assert.deepEqual([k, [...(await visibleDb(u))].sort()], [k, [...expected(u)].sort()]);
});

test("nobody writes where the rules say no; externals never write; US-persons-only data needs a US person", async () => {
  const sec = (role: string, w: boolean) => SECS.find((s) => (role === "owner" || role === "admin") === false && access.some((a) => a.role === role && a.section === s.id && a.can_write) === w)?.id;
  for (const [k, u] of Object.entries(users)) {
    const { c } = await signIn(u.email);
    const no = sec(u.role, false);
    if (no && !["owner", "admin"].includes(u.role)) { const { error } = await c.from("records").insert({ section: no, title: `deny ${k}`, data: {} }); assert.ok(error, `${k} must not create in ${no}`); }
    const yes = sec(u.role, true);
    if (yes && !EXTERNAL.includes(u.role) && u.role !== "pending") {
      const { error } = await c.from("records").insert({ section: yes, title: `allow ${k} ${run}`, data: { rls_w: run } }); assert.ifError(error);
      const { error: e2 } = await c.from("records").insert({ section: yes, title: `ctl ${k}`, data: {}, controlled: true });
      if (u.us) assert.ifError(e2); else assert.ok(e2, `${k} (not a US person) must not create US-persons-only records`);
    }
    // updates of a record the person cannot see change nothing
    const hidden = recs.find((r) => !expected(u).has(r.id));
    if (hidden) { const { data } = await c.from("records").update({ title: "hacked" }).eq("id", hidden.id).select("id"); assert.equal((data || []).length, 0, `${k} updated a hidden record`); }
  }
  for (const r of EXTERNAL) { const { c } = await signIn(users[r].email); const mine = recs.find((x) => x.company === "*"); const { data } = await c.from("records").update({ title: "x" }).eq("id", mine!.id).select("id"); assert.equal((data || []).length, 0, `${r} changed a shared record`); }
});

test("external users are isolated from each other and from internal history", async () => {
  const a = admin(); const acme = recs.find((r) => r.company === "Acme" && r.section === SECS[0].id)!;
  await a.from("comments").insert({ record_id: acme.id, author: users.owner.id, body: `secret note ${run}` });
  const { c: partner } = await signIn(users.partner.email); const { c: vendor } = await signIn(users.vendor.email);
  const p = await partner.from("records").select("id").eq("id", acme.id); const v = await vendor.from("records").select("id").eq("id", acme.id);
  const canPartner = expected(users.partner).has(acme.id);
  assert.equal((p.data || []).length, canPartner ? 1 : 0); assert.equal((v.data || []).length, 0, "Beta must not see Acme's record");
  assert.equal(((await vendor.from("comments").select("id").eq("record_id", acme.id)).data || []).length, 0);
  assert.equal(((await partner.from("activity").select("id").limit(5)).data || []).length, 0, "externals never read the activity history");
  assert.equal(((await partner.from("profiles").select("id")).data || []).length, 1, "externals see only their own profile");
});

test("anonymous callers get nothing", async () => {
  const c = anon();
  const r = await c.from("records").select("id").limit(1); assert.equal((r.data || []).length, 0);
  const p = await c.from("profiles").select("id").limit(1); assert.equal((p.data || []).length, 0);
  const q = await c.from("automation_queue").select("id").limit(1); assert.ok(q.error || !(q.data || []).length);
  const f = await c.rpc("job_start", { p_job: "x", p_slot: null, p_trigger: "anon" }); assert.ok(f.error, "server functions are not callable without the service key");
  const g = await (await signIn(users.sales.email)).c.rpc("automation_claim_keys", { p_keys: ["k"], p_repeat: [null] }); assert.ok(g.error, "…nor by a signed-in employee");
});

test("files follow their record: US-persons-only attachments need a US person", async () => {
  const a = admin(); const ctl = recs.find((r) => r.controlled && r.section.startsWith("technical."))!;
  const path = `${ctl.section}/${ctl.id}/1_spec.txt`;
  const up = await a.storage.from("files").upload(path, Buffer.from("controlled technical data (synthetic)"), { contentType: "text/plain" }); assert.ifError(up.error);
  const { c: eng } = await signIn(users.engineering.email); const { c: engUs } = await signIn(users["engineering-us"].email);
  assert.ok((await eng.storage.from("files").download(path)).error, "non-US engineer cannot download it");
  const ok = await engUs.storage.from("files").download(path); assert.ifError(ok.error); assert.equal(await ok.data!.text(), "controlled technical data (synthetic)");
  assert.ok((await (await signIn(users.partner.email)).c.storage.from("files").download(path)).error);
});

test("a switched-off account and an ended session see nothing at once; a new sign-in works again", async () => {
  const a = admin(); const u = users.finance;
  const { c: old, token } = await signIn(u.email);
  assert.ok(((await old.from("records").select("id").eq("data->>rls", run)).data || []).length > 0);
  await sql("select pg_sleep(1.1)"); // tokens issued in the same second as the revocation count as ended
  const { error } = await a.rpc("revoke_sessions", { p_user: u.id }); assert.ifError(error);
  assert.equal(((await asJwt(token).from("records").select("id").eq("data->>rls", run)).data || []).length, 0, "the old token no longer reads data");
  const ref = await old.auth.refreshSession(); assert.ok(ref.error || !ref.data.session, "the old refresh token is gone");
  await sql("select pg_sleep(1.1)");
  const { c: fresh } = await signIn(u.email); assert.ok(((await fresh.from("records").select("id").eq("data->>rls", run)).data || []).length > 0, "signing in again works");
  await a.from("profiles").update({ disabled: true }).eq("id", u.id);
  assert.equal(((await fresh.from("records").select("id").eq("data->>rls", run)).data || []).length, 0, "switched off: nothing");
  assert.equal(((await fresh.from("profiles").select("id,disabled").eq("id", u.id)).data || [])[0]?.disabled, true, "…but they can read that their account is off");
  await a.from("profiles").update({ disabled: false }).eq("id", u.id);
});

test("two-step sign-in: once required, an owner without the code sees nothing; with the code everything", async () => {
  const a = admin(); const u = users.admin;
  const { c } = await signIn(u.email);
  const { data: en, error } = await c.auth.mfa.enroll({ factorType: "totp", friendlyName: `stack ${run}` }); assert.ifError(error);
  const secret = (en as any).totp.secret as string;
  await a.from("security_settings").update({ mfa_required: true }).eq("id", true);
  try {
    const { c: c1 } = await signIn(u.email); // a fresh password sign-in: aal1
    assert.equal(((await c1.from("records").select("id").eq("data->>rls", run)).data || []).length, 0, "aal1 administrator: no data");
    const st = await c1.auth.mfa.getAuthenticatorAssuranceLevel(); assert.equal(st.data?.currentLevel, "aal1");
    const v = await c1.auth.mfa.challengeAndVerify({ factorId: en!.id, code: totp(secret) }); assert.ifError(v.error);
    assert.equal((await c1.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel, "aal2");
    assert.ok(((await c1.from("records").select("id").eq("data->>rls", run)).data || []).length > 0, "aal2 administrator: data");
    const { c: s1 } = await signIn(users.sales.email); assert.ok(((await s1.from("records").select("id").eq("data->>rls", run)).data || []).length > 0, "staff are not affected");
    const forged = asJwt(jwt({ sub: u.id, role: "authenticated", aal: "aal1" })); assert.equal(((await forged.from("records").select("id").eq("data->>rls", run)).data || []).length, 0);
  } finally { await a.from("security_settings").update({ mfa_required: false }).eq("id", true); }
});

test("realtime publishes only tables protected by row-level security", async () => {
  const rows = await sql("select c.relname, c.relrowsecurity from pg_publication_tables p join pg_class c on c.relname = p.tablename join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname where p.pubname = 'supabase_realtime'");
  for (const r of rows) assert.equal(r.relrowsecurity, true, `${r.relname} is published without RLS`);
});
