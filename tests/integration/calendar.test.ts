// Phase 3 — Google Calendar sync of meetings, against the real database of the isolated stack and a deterministic
// stand-in for Google (OAuth token endpoint + Calendar API). Checks: token refresh with the stored (encrypted)
// refresh token, time zones, no duplicate events, updates, cancelled and deleted meetings, revoked Google access.
// Live Google OAuth is NOT exercised here (no Google credentials in the isolated environment).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { admin, makeUser, uid } from "./_stack.ts";
import { seal, syncUser } from "../../src/lib/server/gcal.ts";

const db = admin(); const run = uid();
let u: any; const real = globalThis.fetch;
const G = { events: new Map<string, any>(), calls: [] as string[], refresh: 0, revoked: false, n: 0 };
before(async () => {
  u = await makeUser(`cal-${run}@agron-stack.test`, "engineering", { us: true, name: `Cal User ${run}` });
  await db.from("gcal_links").upsert({ user_id: u.id, google_email: `cal-${run}@example.test`, refresh_enc: seal("fixture-refresh-token"), calendar_id: "primary" });
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(typeof input === "string" ? input : input.url); const method = (init.method || "GET").toUpperCase();
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      G.refresh++; const body = String(init.body || "");
      if (G.revoked || !body.includes("refresh_token=fixture-refresh-token")) return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 });
      return new Response(JSON.stringify({ access_token: `at-${G.refresh}`, expires_in: 3600 }), { status: 200 });
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/")) {
      if (!String(init.headers?.Authorization || "").startsWith("Bearer at-")) return new Response("{}", { status: 401 });
      G.calls.push(`${method} ${url.split("/calendar/v3/")[1].split("?")[0]}`);
      const m = /events\/([^/?]+)/.exec(url); const id = m ? decodeURIComponent(m[1]) : null;
      if (method === "POST") { const e = { id: `ev${++G.n}`, status: "confirmed", ...JSON.parse(init.body) }; G.events.set(e.id, e); return new Response(JSON.stringify(e), { status: 200 }); }
      if (method === "PATCH" && id) { const e = { ...G.events.get(id), ...JSON.parse(init.body) }; G.events.set(id, e); return new Response(JSON.stringify(e), { status: 200 }); }
      if (method === "DELETE" && id) { G.events.delete(id); return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify({ items: [...G.events.values()] }), { status: 200 });
    }
    return real(input, init);
  }) as any;
});
after(() => { globalThis.fetch = real; });

test("a company meeting goes to the organizer's calendar once, in its own time zone; updates move the event", async () => {
  const { data: m } = await db.from("records").insert({ section: "company.meetings", title: `Design review ${run}`, status: "Planned",
    data: { date: "2026-11-03", time: "09:30", timezone: "America/New_York", duration: 45, organizer_id: u.id, meet_url: "https://meet.google.com/abc-defg-hij", agenda: "Harness rev C" } }).select("*").single();
  const r1 = await syncUser(db, u.id); assert.equal(r1.ok, true, JSON.stringify(r1)); assert.equal(r1.pushed, 1);
  const ev = [...G.events.values()][0];
  assert.deepEqual(ev.start, { dateTime: "2026-11-03T09:30:00", timeZone: "America/New_York" }); assert.deepEqual(ev.end, { dateTime: "2026-11-03T10:15:00", timeZone: "America/New_York" });
  assert.match(ev.description, /meet\.google\.com/); assert.match(ev.description, new RegExp(m.id));
  assert.ok(G.refresh >= 1, "an access token was obtained with the stored refresh token");
  const r2 = await syncUser(db, u.id); assert.equal(r2.pushed, 0); assert.equal(G.events.size, 1, "no duplicate on the next run");
  await db.from("records").update({ data: { ...m.data, time: "23:30", duration: 90 } }).eq("id", m.id);
  await syncUser(db, u.id); const moved = G.events.get(ev.id);
  assert.deepEqual(moved.end, { dateTime: "2026-11-04T01:00:00", timeZone: "America/New_York" }, "crossing midnight in the meeting's zone");
  assert.equal(G.events.size, 1);
  // cancelled: the event is removed
  await db.from("records").update({ status: "Cancelled" }).eq("id", m.id);
  const r3 = await syncUser(db, u.id); assert.equal(r3.removed, 1); assert.equal(G.events.size, 0);
});

test("a deleted meeting leaves the calendar; an all-day meeting without time stays all-day", async () => {
  const { data: m } = await db.from("records").insert({ section: "company.meetings", title: `Offsite ${run}`, status: "Planned", data: { date: "2026-11-10", participants_ids: [u.id] } }).select("id").single();
  await syncUser(db, u.id); const ev = [...G.events.values()].find((e) => e.summary === `Offsite ${run}`);
  assert.deepEqual(ev.start, { date: "2026-11-10" });
  await db.from("records").delete().eq("id", m.id);
  const r = await syncUser(db, u.id); assert.ok(r.removed >= 1); assert.ok(![...G.events.values()].some((e) => e.summary === `Offsite ${run}`));
  const [{ count }] = [await db.from("gcal_map").select("record_id", { count: "exact", head: true }).eq("user_id", u.id).eq("record_id", m.id)];
  assert.equal(count, 0);
});

test("revoked Google access: the sync stops with a visible error, nothing is changed", async () => {
  G.revoked = true; const before = G.calls.length;
  const r = await syncUser(db, u.id); assert.equal(r.ok, false); assert.match(String(r.reason), /revoked/);
  assert.equal(G.calls.length, before, "no calendar call without a valid token");
  const { data: l } = await db.from("gcal_links").select("last_error").eq("user_id", u.id).single(); assert.match(String(l.last_error), /revoked/);
  G.revoked = false;
});
