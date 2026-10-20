// Phase 3 pure rules: delivery decisions (quiet hours across midnight and time zones, daily summary, e-mail off,
// mandatory events), the meeting flow, calendar events with time zones, and the new configuration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emailDecision, inQuietHours, localTime, pushDecision, MANDATORY } from "../src/lib/notifyprefs.ts";
import { toEvent, calendarRecords } from "../src/lib/gcalmatch.ts";
import { allSections } from "../src/config/workspace.config.mjs";

const at = (iso: string) => new Date(iso);
test("local time follows the person's time zone; an unknown zone falls back to UTC", () => {
  assert.deepEqual(localTime("America/New_York", at("2026-10-20T03:30:00Z")), { day: "2026-10-19", minutes: 23 * 60 + 30, zone: "America/New_York" });
  assert.equal(localTime("Asia/Dubai", at("2026-10-20T20:00:00Z")).day, "2026-10-21");
  assert.equal(localTime("Not/AZone", at("2026-10-20T12:00:00Z")).zone, "UTC");
});

test("quiet hours: a window across midnight, in local time; a same-day window; no window", () => {
  const p = { quiet: { from: "22:00", to: "07:00" }, tz: "America/New_York" };
  assert.equal(inQuietHours(p, at("2026-10-20T03:00:00Z")), true, "23:00 in New York");
  assert.equal(inQuietHours(p, at("2026-10-20T10:30:00Z")), true, "06:30 in New York");
  assert.equal(inQuietHours(p, at("2026-10-20T11:00:00Z")), false, "07:00 — the window has ended");
  assert.equal(inQuietHours({ quiet: { from: "12:00", to: "13:00" }, tz: "UTC" }, at("2026-10-20T12:30:00Z")), true);
  assert.equal(inQuietHours({}, at("2026-10-20T03:00:00Z")), false);
  assert.equal(inQuietHours({ quiet: { from: "25:00", to: "07:00" } }, at("2026-10-20T03:00:00Z")), false, "a broken time is ignored");
});

test("e-mail decision: immediately, held in quiet hours, daily summary at 8:00 once, off; mandatory events always go", () => {
  const noon = at("2026-10-20T12:00:00Z"), early = at("2026-10-20T06:00:00Z"), night = at("2026-10-20T23:00:00Z");
  assert.equal(emailDecision({}, "mention", noon, false), "send");
  assert.equal(emailDecision({ quiet: { from: "22:00", to: "07:00" }, tz: "UTC" }, "mention", night, false), "hold");
  assert.equal(emailDecision({ email_mode: "daily", tz: "UTC" }, "mention", early, false), "hold", "before 8:00");
  assert.equal(emailDecision({ email_mode: "daily", tz: "UTC" }, "mention", noon, false), "digest");
  assert.equal(emailDecision({ email_mode: "daily", tz: "UTC" }, "mention", noon, true), "hold", "one summary a day");
  assert.equal(emailDecision({ email_mode: "off" }, "mention", noon, false), "skip");
  for (const k of MANDATORY) { assert.equal(emailDecision({ email_mode: "off", quiet: { from: "00:00", to: "23:59" } }, k, noon, true), "send", k); assert.equal(pushDecision({ quiet: { from: "00:00", to: "23:59" } }, k, noon), "send"); }
  assert.equal(pushDecision({ quiet: { from: "00:00", to: "23:59" }, tz: "UTC" }, "mention", noon), "hold");
});

test("calendar: timed events keep the meeting's time zone and duration; meetings found by account", () => {
  const r: any = { id: "m1", section: "company.meetings", title: "Review", status: "Planned", data: { date: "2026-11-03", time: "9:05", timezone: "Europe/Kyiv", duration: 30, organizer_id: "u1", meet_url: "https://meet.google.com/x" } };
  const ev: any = toEvent(r, "https://ws.test");
  assert.deepEqual(ev.start, { dateTime: "2026-11-03T09:05:00", timeZone: "Europe/Kyiv" }); assert.deepEqual(ev.end, { dateTime: "2026-11-03T09:35:00", timeZone: "Europe/Kyiv" });
  assert.equal(ev.location, "https://meet.google.com/x");
  const bad: any = toEvent({ ...r, data: { ...r.data, timezone: "Mars/Base" } }, "https://ws.test"); assert.equal(bad.start.timeZone, "UTC");
  const allDay: any = toEvent({ ...r, data: { date: "2026-11-03" } }, "https://ws.test"); assert.deepEqual([allDay.start, allDay.end], [{ date: "2026-11-03" }, { date: "2026-11-04" }]);
  assert.deepEqual(calendarRecords([r, { ...r, id: "m2", data: { date: "2026-11-04", participants_ids: ["u1"] } }, { ...r, id: "m3", data: { date: "2026-11-05", participants_ids: ["u2"] } }], { id: "u1", email: "x@agron1.com" }).map((x) => x.id), ["m1", "m2"]);
});

test("configuration: announcements (management writes), meetings with structured fields, projects visible to partners", () => {
  const S = allSections() as any[]; const sec = (id: string) => S.find((s) => s.id === id);
  const a = sec("company.announcements"); assert.ok(a); assert.deepEqual(a.write, ["management"]);
  for (const k of ["message", "priority", "audience_type", "audience", "publish_at", "expires", "ack_required"]) assert.ok(a.fields.some((f: any) => f.key === k), k);
  assert.deepEqual(a.fields.find((f: any) => f.key === "priority").options, ["Normal", "Important", "Critical"]);
  const m = sec("company.meetings"); for (const k of ["date", "time", "timezone", "organizer", "participants", "project_ref", "meet_url", "agenda", "notes", "decisions"]) assert.ok(m.fields.some((f: any) => f.key === k), k);
  assert.ok(sec("company.projects").external.includes("partner"));
});

test("incoming e-mail: supplier, project, order and thread are suggested, never guessed from a free mailbox", async () => {
  const { suggestLinks } = await import("../src/lib/mailLinks.ts");
  const c = { vendors: [{ id: "v1", title: "Volta Cables", data: { email: "sales@voltacables.com", website: "https://www.voltacables.com" } }, { id: "v2", title: "Gmailers", data: { email: "bob@gmail.com" } }],
    projects: [{ id: "p1", title: "StarDome C40", status: "Active" }, { id: "p2", title: "Old Pilot Site", status: "Completed" }],
    procurement: [{ id: "o1", title: "Harness cables PO-10422", data: { vendor: "Volta Cables" } }],
    outbound: [{ id: "x1", provider_id: "<abc123@agron1.com>", to_addr: "anna@voltacables.com", subject: "Delivery dates" }] };
  const h = suggestLinks({ from: "Anna <anna@voltacables.com>", subject: "Re: Delivery dates — StarDome C40", text: "Regarding PO-10422, shipping Friday.", inReplyTo: "<abc123@agron1.com>" }, c);
  const k = Object.fromEntries(h.map((x) => [x.kind, x]));
  assert.equal(k.thread.id, "x1"); assert.equal(k.thread.strength, "strong");
  assert.equal(k.supplier.id, "v1"); assert.match(k.supplier.why, /domain/);
  assert.equal(k.procurement.id, "o1"); assert.equal(k.project.id, "p1");
  const free = suggestLinks({ from: "someone@gmail.com", subject: "Hello", text: "Old Pilot Site question" }, c);
  assert.ok(!free.some((x) => x.kind === "supplier"), "a gmail sender is not matched to a supplier by domain");
  assert.ok(!free.some((x) => x.kind === "project"), "closed projects are not suggested");
  const exact = suggestLinks({ from: "bob@gmail.com", subject: "Invoice" }, c); assert.equal(exact.find((x) => x.kind === "supplier")?.id, "v2", "an exact address in the card still counts");
});
