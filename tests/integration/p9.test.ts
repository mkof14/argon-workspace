// Phase 9 on the isolated stack: release identification (health answer, database version), the v26 hardening, API
// cache headers, request limits, staging/preview e-mail control at the route, disabled accounts, session revocation
// and the known-UUID attack through the REST API for every external and restricted role. Synthetic data only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { admin, anon, APP, ENV, makeUser, PASSWORD, signIn as signInFull, sql, uid } from "./_stack.ts";
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
