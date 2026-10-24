// P9-R2 on the isolated stack: the acceptance evidence store (append-only, PASS needs evidence, recording only by
// the service, attestations and owner-action closure only by an owner), the automatic change log, and the Evidence
// Center API (owners/administrators only, history with superseded rows, the export without secrets). Synthetic data.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { admin, APP, ENV, makeUser, PASSWORD, signIn as signInFull, sql, uid } from "./_stack.ts";
import { containsSecret } from "../../src/lib/acceptance.ts";

const signIn = async (email: string) => (await signInFull(email)).c;
const db = admin(); const run = uid(); const skipApp = !APP;
let owner: any, adminU: any, sales: any;
async function cookiesFor(email: string) {
  const jar = new Map<string, string>();
  const c = createServerClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
const row = (o: Record<string, any> = {}) => ({ check_id: "P9.AUDIT", status: "PASS", environment: "local", app_version: "2.43", git_sha: "c".repeat(40), db_version: 27, migration_hash: "m",
  started_at: new Date().toISOString(), completed_at: new Date().toISOString(), source: "p9r2 test", source_ref: `test ${run}`, metrics: { vulnerabilities: { total: 0 } }, ...o });

before(async () => {
  owner = await makeUser(`r2o-${run}@agron-stack.test`, "owner", { us: true });
  adminU = await makeUser(`r2a-${run}@agron-stack.test`, "admin", { us: true });
  sales = await makeUser(`r2s-${run}@agron-stack.test`, "sales", { us: true });
});

test("evidence store: a PASS without evidence is refused; FAIL needs a reason; the catalog and 22 owner actions exist", async () => {
  const bad = await db.rpc("acceptance_record", { p: row({ source_ref: null }) }); assert.ok(bad.error && /acceptance_pass_needs_evidence/.test(bad.error.message), bad.error?.message);
  const bad2 = await db.rpc("acceptance_record", { p: row({ metrics: {} }) }); assert.ok(bad2.error);
  const bad3 = await db.rpc("acceptance_record", { p: row({ status: "FAIL", summary: null, blocker: null }) }); assert.ok(bad3.error && /fail_needs_reason/.test(bad3.error.message));
  const unknown = await db.rpc("acceptance_record", { p: row({ check_id: "NOPE.CHECK" }) }); assert.ok(unknown.error);
  const ok = await db.rpc("acceptance_record", { p: row() }); assert.equal(ok.error, null); assert.ok(ok.data);
  const n = await sql("select (select count(*) from acceptance_checks)::int c, (select count(*) from acceptance_owner_actions)::int a"); assert.ok(n[0].c >= 40); assert.equal(n[0].a, 22);
});

test("evidence is append-only: no update, delete or truncate; a superseded result stays in the history", async () => {
  const first = (await db.rpc("acceptance_record", { p: row({ status: "FAIL", blocker: "1 vulnerability", metrics: { vulnerabilities: { total: 1 } }, source_ref: `old ${run}` }) })).data;
  await db.rpc("acceptance_record", { p: row({ source_ref: `new ${run}` }) });
  for (const q of [`update public.acceptance_evidence set status = 'PASS' where id = '${first}'`, `delete from public.acceptance_evidence where id = '${first}'`, "truncate public.acceptance_evidence cascade",
                   "update public.acceptance_env_changes set what = 'x'", "truncate public.acceptance_owner_action_events"]) {
    await assert.rejects(sql(q), /append-only/, q);
  }
  const rows = await sql("select status from public.acceptance_evidence where id = $1", [first]); assert.equal(rows[0].status, "FAIL", "the old FAIL is still a FAIL");
});

test("only the service records machine evidence; employees cannot read or write the store", async () => {
  const s = await signIn(sales.email);
  const r = await s.rpc("acceptance_record", { p: row() }); assert.ok(r.error, "an employee cannot record evidence");
  const t = await s.from("acceptance_evidence").select("id").limit(1); assert.ok(t.error || !(t.data || []).length, "an employee reads no evidence");
  const a = await signIn(adminU.email);
  assert.ok((await a.rpc("acceptance_record", { p: row() })).error, "a System Administrator cannot record machine evidence either");
  assert.ok((await a.from("acceptance_evidence").insert({ ...row(), recorded_via: "service" })).error, "nor insert directly");
});

test("attestations and owner-action closure: owner only, and only with evidence of the action's own checks", async () => {
  const a = await signIn(adminU.email), o = await signIn(owner.email), s = await signIn(sales.email);
  const ident = { app_version: "2.43", git_sha: "c".repeat(40), db_version: 27, migration_hash: "m" };
  const att = (c: any) => c.rpc("acceptance_attest", { p_check: "P9.STAGING.RESOURCES", p_status: "PASS", p_environment: "staging", p_identity: ident, p_summary: "kept on Free", p_metrics: { confirmed: true }, p_ref: `r2 ${run}` });
  assert.ok((await att(s)).error, "an employee cannot attest"); assert.ok((await att(a)).error, "a System Administrator cannot attest");
  const mine = await att(o); assert.equal(mine.error, null);
  const notAttestable = await o.rpc("acceptance_attest", { p_check: "P9.REG.FULL", p_status: "PASS", p_environment: "local", p_identity: ident, p_summary: "", p_metrics: { mode: "full_clean" }, p_ref: "x" });
  assert.ok(notAttestable.error, "a regression is measured, never attested");
  const rec = await sql("select recorded_via, recorded_by from public.acceptance_evidence where id = $1", [mine.data]); assert.equal(rec[0].recorded_via, "owner"); assert.equal(rec[0].recorded_by, owner.id);
  // action 3 closes with P9.STAGING.RESOURCES; regression (code) evidence cannot close it
  const code = (await db.rpc("acceptance_record", { p: row({ check_id: "P9.REG.FULL", metrics: { mode: "full_clean" } }) })).data;
  assert.ok((await a.rpc("acceptance_close_action", { p_action: 3, p_evidence: [mine.data], p_note: null })).error, "an administrator cannot close it");
  const wrong = await o.rpc("acceptance_close_action", { p_action: 3, p_evidence: [code], p_note: null }); assert.ok(wrong.error && /does not belong/.test(wrong.error.message), wrong.error?.message);
  const none = await o.rpc("acceptance_close_action", { p_action: 4, p_evidence: [], p_note: null }); assert.ok(none.error && /still missing/.test(none.error.message), "nothing closes without evidence");
  const right = await o.rpc("acceptance_close_action", { p_action: 3, p_evidence: [mine.data], p_note: "decided" }); assert.equal(right.error, null);
  const ev = await sql("select event, actor from public.acceptance_owner_action_events where action_id = 3 order by id desc limit 1"); assert.equal(ev[0].event, "closed"); assert.equal(ev[0].actor, owner.id);
  assert.equal((await o.rpc("acceptance_comment", { p_target: "OA-3", p_body: "owner note" })).error, null);
  assert.ok((await a.rpc("acceptance_comment", { p_target: "OA-3", p_body: "admin note" })).error, "comments are the owner's");
  assert.ok((await a.rpc("acceptance_setting_save", { p_key: "freshness", p_value: { environment_days: 365 } })).error, "only an owner changes freshness");
});

test("change log: policy approval, capability grants and role changes are recorded automatically, without secrets", async () => {
  const before = Number((await sql("select count(*) c from public.acceptance_env_changes"))[0].c);
  const o = await signIn(owner.email);
  const pol = (await sql("select code, version from public.approval_policies where config_status <> 'Approved' order by code limit 1"))[0];
  assert.equal((await o.rpc("ops_policy_approve", { p_code: pol.code, p_version: pol.version })).error, null);
  await sql("insert into public.crm_caps(user_id, cap, granted_by) values ($1, 'policy_approver', $2) on conflict (user_id, cap) do update set revoked_at = null", [sales.id, owner.id]);
  await sql("update public.profiles set role = 'operations' where id = $1", [sales.id]); await sql("update public.profiles set role = 'sales' where id = $1", [sales.id]);
  const rows = await sql("select category, what from public.acceptance_env_changes order by id desc limit 10");
  assert.ok(Number((await sql("select count(*) c from public.acceptance_env_changes"))[0].c) >= before + 4);
  assert.ok(rows.some((r: any) => r.category === "policy_approval" && r.what.includes(pol.code)));
  assert.ok(rows.some((r: any) => r.category === "role_change" && r.what.includes("policy_approver")));
  assert.ok(rows.some((r: any) => r.category === "role_change" && r.what.includes("sales → operations")));
  await sql("update public.crm_caps set revoked_at = now() where user_id = $1 and cap = 'policy_approver'", [sales.id]);
});

test("Evidence Center: owners and administrators only; history shows superseded rows; the export has 15 sections and no secrets", { skip: skipApp }, async () => {
  for (const [who, code] of [[sales.email, 403], [adminU.email, 200], [owner.email, 200]] as const) {
    const r = await fetch(`${APP}/api/acceptance`, { headers: { cookie: await cookiesFor(who) } }); assert.equal(r.status, code, `${who} → ${code}`);
  }
  assert.equal((await fetch(`${APP}/api/acceptance`)).status, 403, "anonymous");
  const ck = await cookiesFor(owner.email);
  const page = await (await fetch(`${APP}/api/acceptance`, { headers: { cookie: ck } })).json();
  assert.equal(page.readiness.production_live, false); assert.equal(page.readiness.production_ready, false);
  assert.ok(page.gates.production.unmet.length > 0); assert.equal(page.identity.environment, "local"); assert.equal(page.identity.db_version, 27);
  assert.equal(page.production.backup, "REAL BACKUP: NO");
  const h = await (await fetch(`${APP}/api/acceptance?history=P9.AUDIT`, { headers: { cookie: ck } })).json();
  assert.ok(h.rows.length >= 3 && h.rows.some((r: any) => r.status === "FAIL"), "superseded FAIL still visible");
  const ex = await fetch(`${APP}/api/acceptance`, { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: JSON.stringify({ op: "export" }) });
  assert.equal(ex.status, 200); const pkg = await ex.json();
  const heads = pkg.md.split("\n").filter((l: string) => l.startsWith("## ")); assert.equal(heads.length, 15);
  const text = JSON.stringify(pkg.json) + pkg.md;
  assert.equal(containsSecret(text, [ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, ENV.STACK_PG_URL, PASSWORD].filter(Boolean)), false, "no keys, passwords or connection strings");
  assert.equal(pkg.json.package.name, "agron-acceptance");
  const salesEx = await fetch(`${APP}/api/acceptance`, { method: "POST", headers: { cookie: await cookiesFor(sales.email), "content-type": "application/json" }, body: JSON.stringify({ op: "export" }) });
  assert.equal(salesEx.status, 403);
  // an administrator sees the evidence but gains no business authority through it
  const adm = await fetch(`${APP}/api/acceptance`, { method: "POST", headers: { cookie: await cookiesFor(adminU.email), "content-type": "application/json" }, body: JSON.stringify({ op: "close", action: 3, evidence: [] }) });
  assert.equal(adm.status, 403);
});
