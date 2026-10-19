// The running application (next start, built against the test stack): secure links (hashed, single use,
// expiry, revocation, request limits), permission checks at the moment of use, server routes behind the
// central role and session gate, two-step sign-in for privileged routes, and the scheduler endpoints.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { admin, APP, ENV, makeUser, PASSWORD, sql, totp, uid } from "./_stack.ts";
import { hashToken, newToken } from "../../src/lib/server/tokens.ts";

const db = admin(); const run = uid();
let owner: any, sales: any, fin: any, rec: any;
const skip = !APP;

/** Signs in the way the browser does and returns the auth cookies the server reads. */
async function cookiesFor(email: string, mfaSecret?: { id: string; secret: string }) {
  const jar = new Map<string, string>();
  const c = createServerClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (error) throw error;
  if (mfaSecret) { const v = await c.auth.mfa.challengeAndVerify({ factorId: mfaSecret.id, code: totp(mfaSecret.secret) }); if (v.error) throw v.error; }
  return { header: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), client: c };
}
const call = (path: string, body: any, cookie = "", ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) =>
  fetch(APP + path, { method: "POST", headers: { "content-type": "application/json", cookie, "x-forwarded-for": ip }, body: JSON.stringify(body) });

before(async () => {
  if (skip) return;
  owner = await makeUser(`po-${run}@agron-stack.test`, "owner", { us: true }); sales = await makeUser(`ps-${run}@agron-stack.test`, "sales"); fin = await makeUser(`pf-${run}@agron-stack.test`, "finance");
  rec = (await db.from("records").insert({ section: "finance.expenses", title: `Laptop ${run}`, status: "Submitted", data: { amount: 900, currency: "USD", requester: "x" }, controlled: false }).select("*").single()).data;
});

test("health and scheduler endpoints", { skip }, async () => {
  const h = await (await fetch(APP + "/api/health")).json(); assert.equal(h.ok, true); assert.equal(h.checks.db, true); assert.equal(h.checks.auth, true);
  assert.equal((await fetch(APP + "/api/cron")).status, 401, "the scheduler needs the secret");
  const r = await fetch(APP + "/api/ops?job=trash", { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } }); assert.equal(r.status, 200);
  const j = await r.json(); assert.ok(["completed", "skipped"].includes(j.status));
  const again = await (await fetch(APP + "/api/ops?job=trash", { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } })).json(); assert.equal(again.status, "skipped", "same slot: not repeated");
});

test("approval links: hashed, single use, expire, and re-check the approver when used", { skip }, async () => {
  const token = newToken();
  const { data: a } = await db.from("approvals").insert({ token_hash: hashToken(token), record_id: rec.id, section: rec.section, requested_by: sales.id, approver_id: fin.id, note: "synthetic" }).select("*").single();
  const [row] = await sql("select token, token_hash from approvals where id = $1", [a.id]); assert.equal(row.token, null); assert.equal(row.token_hash.length, 64);
  assert.equal((await call("/api/approvals", { action: "view", token: newToken() })).status, 404, "an unknown link opens nothing");
  const v = await (await call("/api/approvals", { action: "view", token })).json(); assert.equal(v.status, "pending"); assert.equal(v.title, rec.title);
  const d1 = await call("/api/approvals", { action: "decide", token, decision: "approved" }); assert.equal(d1.status, 200);
  const d2 = await call("/api/approvals", { action: "decide", token, decision: "rejected" }); assert.equal(d2.status, 409, "a used link cannot decide again");
  const [r2] = await sql("select status from records where id = $1", [rec.id]); assert.equal(r2.status, "Approved");
  // expired link
  const t2 = newToken(); await db.from("approvals").insert({ token_hash: hashToken(t2), record_id: rec.id, section: rec.section, requested_by: sales.id, approver_id: fin.id, expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await (await call("/api/approvals", { action: "view", token: t2 })).json()).status, "expired");
  assert.equal((await call("/api/approvals", { action: "decide", token: t2, decision: "approved" })).status, 409);
  // the approver lost the right in the meantime
  const t3 = newToken(); await db.from("approvals").insert({ token_hash: hashToken(t3), record_id: rec.id, section: rec.section, requested_by: sales.id, approver_id: sales.id });
  const d3 = await call("/api/approvals", { action: "decide", token: t3, decision: "approved" }); assert.equal(d3.status, 409); assert.match(await d3.text(), /no longer allowed/);
});

test("public links have request limits", { skip }, async () => {
  const ip = `10.99.${Math.floor(Math.random() * 200)}.1`; let limited = 0;
  for (let i = 0; i < 34; i++) if ((await call("/api/approvals", { action: "view", token: newToken() }, "", ip)).status === 429) limited++;
  assert.ok(limited >= 3, `after 30 requests a minute the address is slowed down (${limited})`);
  assert.equal((await call("/api/approvals", { action: "view", token: newToken() }, "", `10.98.0.${Math.floor(Math.random() * 200)}`)).status, 404, "other addresses are not affected");
});

test("calendar links: shown once, stored as a hash, revoked or expired links stop", { skip }, async () => {
  const t = newToken(); await db.from("calendar_feeds").upsert({ user_id: sales.id, token: null, token_hash: hashToken(t), scope: "mine" }, { onConflict: "user_id" });
  const ok = await fetch(`${APP}/api/calendar/feed/${t}.ics`); assert.equal(ok.status, 200); assert.match(await ok.text(), /BEGIN:VCALENDAR/);
  await db.from("calendar_feeds").update({ revoked_at: new Date().toISOString() }).eq("user_id", sales.id); assert.equal((await fetch(`${APP}/api/calendar/feed/${t}.ics`)).status, 404);
  await db.from("calendar_feeds").update({ revoked_at: null, expires_at: new Date(Date.now() - 1000).toISOString() }).eq("user_id", sales.id); assert.equal((await fetch(`${APP}/api/calendar/feed/${t}.ics`)).status, 404);
  const { header } = await cookiesFor(sales.email);
  const made = await (await call("/api/calendar", { action: "create" }, header)).json(); assert.match(made.url, /\/api\/calendar\/feed\/[\w-]{32,}\.ics$/); assert.equal(made.shown_once, true);
  const later = await (await call("/api/calendar", { action: "get" }, header)).json(); assert.equal(later.url, null, "never readable again");
  const [row] = await sql("select token from calendar_feeds where user_id = $1", [sales.id]); assert.equal(row.token, null);
});

test("server routes: role gate, ended sessions and two-step sign-in for privileged work", { skip }, async () => {
  const s = await cookiesFor(sales.email);
  assert.equal((await call("/api/ops", { action: "ops" }, s.header)).status, 403, "staff cannot open Operations");
  assert.equal((await call("/api/ops", { action: "ops" }, "")).status, 401);
  // owner, then the requirement is switched on
  const { client } = await cookiesFor(owner.email);
  const { data: en } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `api ${run}` }); const f = { id: en!.id, secret: (en as any).totp.secret };
  const o2 = await cookiesFor(owner.email, f); // verifies the factor: aal2
  assert.equal((await call("/api/admin/users", { action: "mfa_required", on: true }, (await cookiesFor(owner.email)).header)).status, 409, "an aal1 session cannot switch it on (it would lock the owner out)");
  assert.equal((await call("/api/admin/users", { action: "mfa_required", on: true }, o2.header)).status, 200);
  try {
    const plain = await cookiesFor(owner.email);
    const r = await call("/api/ops", { action: "ops" }, plain.header); assert.equal(r.status, 403); assert.equal((await r.json()).code, "mfa_required");
    const r2 = await call("/api/ops", { action: "ops" }, (await cookiesFor(owner.email, f)).header); assert.equal(r2.status, 200);
    const ops = await r2.json(); assert.ok(Array.isArray(ops.jobs) && ops.jobs.length >= 10);
    assert.equal((await call("/api/automation", { action: "state" }, s.header)).status, 403, "staff do not see the automation state");
    // end the sales person's sessions: their cookie stops working at once
    await sql("select pg_sleep(1.1)");
    assert.equal((await call("/api/admin/users", { action: "revoke", user: sales.id }, (await cookiesFor(owner.email, f)).header)).status, 200);
    const after = await call("/api/automation", { action: "targets" }, s.header); assert.equal(after.status, 401);
  } finally { await db.from("security_settings").update({ mfa_required: false }).eq("id", true); }
});

test("AI and other expensive routes are limited per person", { skip }, async () => {
  const { header } = await cookiesFor(fin.email); let limited = 0;
  for (let i = 0; i < 33; i++) if ((await call("/api/ai", { messages: [{ role: "user", content: "hi" }] }, header)).status === 429) limited++;
  assert.ok(limited >= 2, `limited ${limited}`);
});
