import { test } from "node:test";
import assert from "node:assert/strict";
import { left, slaFor } from "../src/lib/sla.ts";

test("SLA: tier from the unit, deadlines by severity, states over time", () => {
  const fleet: any[] = [{ id: "u1", section: "operations.fleet", title: "Unit", status: "Active", data: { sla: "Premium 24/7" } }];
  const t: any = { id: "t", section: "operations.support", title: "Camera offline", status: "New", created_at: "2026-10-18T10:00:00Z", data: { unit_ref: "u1", severity: "Critical" } };
  const now = Date.parse("2026-10-18T10:50:00Z");
  const v = slaFor(t, fleet, now)!;
  assert.equal(v.tier, "Premium 24/7"); assert.equal(v.respondBy, "2026-10-18T11:00:00.000Z"); assert.equal(v.resolveBy, "2026-10-18T18:00:00.000Z");
  assert.equal(v.respond, "soon"); assert.equal(v.resolve, "ok"); assert.equal(v.respondLeft, 10);
  assert.equal(slaFor(t, fleet, Date.parse("2026-10-18T11:30:00Z"))!.respond, "late");
  const answered = { ...t, status: "In progress", data: { ...t.data, responded_at: "2026-10-18T10:40:00Z" } };
  assert.equal(slaFor(answered, fleet, Date.parse("2026-10-18T19:00:00Z"))!.respond, "met");
  assert.equal(slaFor(answered, fleet, Date.parse("2026-10-18T19:00:00Z"))!.resolve, "late");
  const plain = { ...t, data: { severity: "Low" } };
  assert.equal(slaFor(plain, fleet, now)!.tier, "Standard");
  assert.equal(left(135, "ru"), "2 ч 15 мин"); assert.equal(left(-1500, "en"), "1 d 1 h");
});

import { operationsFindings } from "../src/lib/deptAgents.ts";
test("the operations agent raises late responses", () => {
  const all: any[] = [{ id: "t1", section: "operations.support", title: "Radar down", status: "New", created_at: new Date(Date.now() - 6 * 3600e3).toISOString(), data: { severity: "Critical" } }];
  const f = operationsFindings(all, new Date().toISOString().slice(0, 10), { remind_before: 3, escalate_after: 3, stalled_deal: 14, sla: (t, fl) => slaFor(t, fl) });
  const x = f.find((y) => y.key === "sla-resp|t1"); assert.ok(x); assert.equal(x!.level, "bad"); assert.ok(x!.who.includes("leads"));
});
