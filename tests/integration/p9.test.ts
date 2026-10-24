// Phase 9 on the isolated stack: release identification (health answer, database version), the v26 hardening, API
// cache headers, request limits, staging/preview e-mail control at the route, disabled accounts, session revocation
// and the known-UUID attack through the REST API for every external and restricted role. Synthetic data only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { admin, anon, APP, ENV, makeUser, PASSWORD, pool, signIn as signInFull, sql, uid } from "./_stack.ts";
const signIn = async (email: string) => (await signInFull(email)).c;

const db = admin(); const run = uid();
const skipApp = !APP;
let owner: any, sales: any, partner: any, nonUs: any, restricted: any, opp: any;

async function cookiesFor(email: string) {
  const jar = new Map<string, string>();
  const c = createServerClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

before(async () => {
  owner = await makeUser(`p9o-${run}@agron-stack.test`, "owner", { us: true });
  sales = await makeUser(`p9s-${run}@agron-stack.test`, "sales", { us: true });
  nonUs = await makeUser(`p9n-${run}@agron-stack.test`, "engineering", { us: false });
  partner = await makeUser(`p9p-${run}@agron-stack.test`, "partner", { company: `Partner ${run}` });
  restricted = (await db.from("records").insert({ section: "technical.docs", title: `P9 restricted ${run}`, status: "Draft", data: { doc_type: "synthetic" }, controlled: true }).select("*").single()).data;
  opp = (await db.from("records").insert({ section: "sales.pipeline", title: `P9 opportunity ${run}`, status: "Qualified", data: { value: 1 }, controlled: false }).select("*").single()).data;
});

test("database version: v26 reports 26 to signed-in users and the server, not to anonymous callers", async () => {
  assert.equal((await sql("select public.workspace_db_version() v"))[0].v, 26);
  const a = await anon().rpc("workspace_db_version"); assert.ok(a.error, "anonymous call refused");
  const s = await signIn(sales.email); const r = await s.rpc("workspace_db_version"); assert.equal(r.error, null); assert.equal(r.data, 26);
});

test("v26 hardening: anonymous callers cannot run the classification lookup; signed-in users still can", async () => {
  const a = await anon().rpc("class_meta", { p_code: "x" }); assert.ok(a.error && /permission/i.test(a.error.message), "anon refused");
  const s = await signIn(sales.email); const r = await s.rpc("class_meta", { p_code: "x" }); assert.equal(r.error, null);
  // record triggers still fire for an ordinary user after the revoke (an insert through RLS works)
  const ins = await s.from("records").insert({ section: "sales.pipeline", title: `P9 trigger ${run}`, status: "Qualified", data: {} }).select("id").single();
  assert.equal(ins.error, null);
});

test("known UUID: a restricted record stays invisible by id for anonymous, non-US, sales and partner users", async () => {
  for (const [who, c] of [["anon", anon()], ["non-US engineer", await signIn(nonUs.email)], ["partner", await signIn(partner.email)]] as const) {
    const r = await (c as any).from("records").select("id,title").eq("id", restricted.id); assert.deepEqual(r.data || [], [], `${who} must not see the restricted record`);
    const f = await (c as any).rpc("search_records", { q: `P9 restricted ${run}`, n: 10 });
    assert.ok(!(f.data || []).some((x: any) => x.id === restricted.id), `${who}: search must not return it`);
  }
  const p = await (await signIn(partner.email)).from("records").select("id").eq("id", opp.id); assert.deepEqual(p.data || [], [], "partner does not see an internal opportunity by id");
  const o = await (await signIn(owner.email)).from("records").select("id").eq("id", restricted.id); assert.equal(o.data?.length, 1, "US owner sees it");
});

test("disabled account and revoked sessions: the token stops working", async () => {
  const u = await makeUser(`p9d-${run}@agron-stack.test`, "sales", { us: true });
  const c = await signIn(u.email);
  assert.equal(((await c.from("records").select("id").eq("id", opp.id)).data || []).length, 1, "works before");
  await sql("update public.profiles set disabled = true where id = $1", [u.id]);
  assert.deepEqual((await c.from("records").select("id").eq("id", opp.id)).data || [], [], "a disabled user's existing session reads nothing");
  await sql("update public.profiles set disabled = false, sessions_revoked_at = now() + interval '1 second' where id = $1", [u.id]);
  await new Promise((r) => setTimeout(r, 2600));
  assert.deepEqual((await c.from("records").select("id").eq("id", opp.id)).data || [], [], "a session issued before revocation reads nothing");
  const fresh = await signIn(u.email); assert.equal(((await fresh.from("records").select("id").eq("id", opp.id)).data || []).length, 1, "a new sign-in works");
});

test("health: the public answer has no versions or job details; the authorised answer has release and scheduler", { skip: skipApp }, async () => {
  const pub = await fetch(APP + "/api/health"); const pj = await pub.json();
  assert.equal(pj.ok, true); assert.equal(pj.release, undefined); assert.equal(pj.scheduler, undefined);
  assert.match(pub.headers.get("cache-control") || "", /no-store/);
  const auth = await (await fetch(APP + "/api/health", { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } })).json();
  assert.equal(auth.release.db, 26); assert.equal(auth.release.db_expected, 26); assert.equal(auth.release.db_matches, true); assert.match(auth.release.app, /^\d+\.\d+$/);
  assert.equal(typeof auth.scheduler, "object");
  // support view (R23): storage, operations statistics, integrations as yes/no only
  assert.equal(auth.storage.ok, true); assert.equal(auth.operations.db_version, 26); assert.equal(typeof auth.operations.connections, "number");
  for (const k of ["email", "ai", "calendar", "backup_offsite", "backup_passphrase", "cron_secret"]) assert.equal(typeof auth.integrations[k], "boolean", k);
  assert.equal(auth.release.env, "development");
  const wrong = await (await fetch(APP + "/api/health", { headers: { authorization: "Bearer wrong" } })).json(); assert.equal(wrong.release, undefined);
  const ownerCookie = await cookiesFor(owner.email);
  const asOwner = await (await fetch(APP + "/api/health", { headers: { cookie: ownerCookie } })).json(); assert.equal(asOwner.release?.db, 26, "owner sees release");
  const asSales = await (await fetch(APP + "/api/health", { headers: { cookie: await cookiesFor(sales.email) } })).json(); assert.equal(asSales.release, undefined, "sales does not");
  const body = JSON.stringify(auth); for (const s of [ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.CRON_SECRET, ENV.SMTP_PASS, ENV.BACKUP_PASSPHRASE].filter(Boolean)) assert.ok(!body.includes(s), "no secret in the health answer");
});

test("API answers are not cacheable; the access log has a request limit", { skip: skipApp }, async () => {
  const cookie = await cookiesFor(sales.email);
  for (const p of ["/api/health", "/api/fx", "/api/ops"]) { const r = await fetch(APP + p, { headers: { cookie } }); assert.match(r.headers.get("cache-control") || "", /no-store/, p); }
  let limited = 0;
  for (let i = 0; i < 125; i++) { const r = await fetch(APP + "/api/log", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ record_id: opp.id }) }); if (r.status === 429) limited++; }
  assert.ok(limited >= 1, "more than 120 access-log calls a minute are refused");
});

/* ------------------------------ P9-R1 R4: a self-registered account sees nothing and is signed out ------------------------------ */
async function asUser<T = any>(id: string, q: string, p: any[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated", aal: "aal1", iat: Math.floor(Date.now() / 1000) + 5 })]);
    const r = await c.query(q, p); await c.query("commit"); return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const callAs = async (id: string, fn: string, args: any[] = []) => (await asUser(id, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args.map((a) => (Array.isArray(a) || (a && typeof a === "object") ? JSON.stringify(a) : a))))[0].r;
const refusedP = async (p: Promise<any>, re: RegExp) => { await assert.rejects(p, (e: any) => { assert.match(String(e.message), re); return true; }); };

test("registration safety: an uninvited (self-registered) account reads no company data and is signed out by the app", async () => {
  // what a public sign-up produces: an account with role "pending" and no invitation
  const { data: u, error } = await db.auth.admin.createUser({ email: `p9self-${run}@agron-stack.test`, password: PASSWORD, email_confirm: true }); assert.ifError(error);
  const id = u.user!.id;
  assert.equal((await sql("select role from profiles where id = $1", [id]))[0].role, "pending");
  assert.equal(Number((await asUser(id, "select count(*) n from records"))[0].n), 0, "no records");
  assert.deepEqual((await asUser(id, "select id from profiles")).map((r: any) => r.id), [id], "only its own profile — no employee directory");
  assert.equal(Number((await asUser(id, "select count(*) n from departments"))[0].n), 0, "no departments");
  assert.equal(Number((await asUser(id, "select count(*) n from comments"))[0].n), 0, "no comments");
  assert.equal(Number((await asUser(id, "select count(*) n from notifications"))[0].n), 0, "no notifications");
  for (const fn of ["mgmt_dashboard", "crm_dashboard", "mfg_dashboard", "ops_my_processes"]) {
    const exists = (await sql("select exists (select 1 from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace) ok", [fn]))[0].ok; if (!exists) continue;
    const r = await callAs(id, fn, []).catch((e: any) => ({ refused: String(e.message) }));
    assert.ok((r as any)?.refused || !JSON.stringify(r).includes(`P9 restricted ${run}`), `${fn}: nothing restricted`);
  }
  if (!skipApp) {
    const cookie = await cookiesFor(`p9self-${run}@agron-stack.test`);
    const r = await (await fetch(APP + "/api/registration", { method: "POST", headers: { cookie } })).json();
    assert.equal(r.refused, true, "the app signs an uninvited account out");
    const log = await sql("select count(*)::int n from activity where section = 'security.log' and action = 'uninvited_sign_in_refused' and actor = $1", [id]);
    assert.ok(log[0].n >= 1, "the refused attempt is in the security log");
  }
  // an invited person waiting for a role is not refused
  const inv = await db.auth.admin.inviteUserByEmail(`p9inv-${run}@agron-stack.test`); assert.ifError(inv.error);
  assert.ok(inv.data.user?.invited_at, "invitation recorded");
});

/* ------------------------------ P9-R1 R6/R8: business authority and policy approval safety ------------------------------ */
test("policy approval safety: System Admin and Workflow Admin alone cannot approve; Owner and Policy Approver can; an edit returns to Draft; history and running chains keep their version", async () => {
  const sysadmin = await makeUser(`p9a-${run}@agron-stack.test`, "admin", { us: true });
  const wfa = await makeUser(`p9w-${run}@agron-stack.test`, "management", { us: true });
  const pa = await makeUser(`p9pa-${run}@agron-stack.test`, "management", { us: true });
  const titled = await makeUser(`p9t-${run}@agron-stack.test`, "operations", { us: true });
  await sql("update profiles set title = 'Policy Approver and Build Manager' where id = $1", [titled.id]);
  await callAs(owner.id, "crm_cap_set", [wfa.id, "workflow_admin", true]);
  await callAs(owner.id, "crm_cap_set", [pa.id, "policy_approver", true]);
  // capabilities are never inferred from a job title
  for (const cap of ["policy_approver", "build_manager", "workflow_admin"]) assert.equal((await sql("select public.has_cap($1, $2) ok", [titled.id, cap]))[0].ok, false, `title gives no ${cap}`);
  assert.equal((await sql("select public.has_cap($1, 'policy_approver') ok", [sysadmin.id]))[0].ok, false, "System Administrator has no business authority");
  const pol = async () => (await sql("select version, config_status, approved_version, tiers from approval_policies where code = 'TRAVEL'"))[0];
  let p = await pol(); const wasApproved = p.config_status === "Approved";
  await refusedP(callAs(sysadmin.id, "ops_policy_approve", ["TRAVEL", p.version]), /Policy Approver/);
  await refusedP(callAs(wfa.id, "ops_policy_approve", ["TRAVEL", p.version]), /Policy Approver/);
  await refusedP(callAs(titled.id, "ops_policy_approve", ["TRAVEL", p.version]), /Policy Approver/);
  if (!wasApproved) assert.notEqual((await pol()).config_status, "Approved", "nothing approved by the refused calls");
  // the Owner approves
  assert.equal((await callAs(owner.id, "ops_policy_approve", ["TRAVEL", p.version])).status, "Approved");
  const approvedV = (await pol()).version; assert.equal((await pol()).approved_version, approvedV);
  // the Workflow Admin edits (allowed) → a new version in Draft; the approved version stays in the history
  await callAs(wfa.id, "ops_policy_save", ["TRAVEL", "Travel approval", p.tiers, true]);
  p = await pol(); assert.equal(p.config_status, "Draft"); assert.equal(p.version, approvedV + 1);
  const hist = await sql("select config_status, version from approval_policies_history where policy_code = 'TRAVEL' order by id");
  assert.ok(hist.some((h: any) => h.config_status === "Approved" && h.version === approvedV), "the approved version remains in the history");
  // a Policy Approver approves the new version
  assert.equal((await callAs(pa.id, "ops_policy_approve", ["TRAVEL", p.version])).status, "Approved");
  assert.ok((await sql("select config_status from approval_policies_history where policy_code = 'TRAVEL' and config_status = 'Superseded'")).length >= 1, "the earlier approval is marked superseded");
  // a running request keeps the policy version it started with
  const emp = await makeUser(`p9e-${run}@agron-stack.test`, "operations", { us: true });
  const t = await callAs(emp.id, "ops_request_create", ["travel", `P9 trip ${run}`, { destination: "Test City", starts: "2026-12-01", ends: "2026-12-03", purpose: "Synthetic", est_cost: 1000, currency: "USD" }, null]);
  const inst = (await sql("select i.id, s.id run from wf_instances i join wf_step_runs s on s.id = i.current_run where i.record_id = $1", [t.record]))[0];
  await callAs(emp.id, "wf_act", [inst.run, "submit", null]);
  const vAtStart = (await pol()).version;
  const ev = (await sql("select detail from wf_events where instance_id = $1 and kind = 'approval_requested' order by id desc limit 1", [inst.id]))[0];
  assert.equal(Number(ev.detail.policy_version), vAtStart, "the chain records the exact policy version");
  const before = await sql("select id, approver_id, status from approvals where record_id = $1 order by id", [t.record]);
  assert.ok(before.length >= 1, "approvals were opened");
  const changed = JSON.parse(JSON.stringify((await pol()).tiers)); changed[0].steps = [{ kind: "role", role: "finance", label: "Finance" }];
  await callAs(wfa.id, "ops_policy_save", ["TRAVEL", "Travel approval", changed, true]);
  assert.deepEqual(await sql("select id, approver_id, status from approvals where record_id = $1 order by id", [t.record]), before, "editing the policy does not change a running chain");
  // put the seeded tiers back for later suites (stays Draft: nothing is left approved by this test)
  await callAs(wfa.id, "ops_policy_save", ["TRAVEL", "Travel approval", p.tiers, true]);
});
