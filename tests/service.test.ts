import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, serviceDone, servicePlan, warranty } from "../src/lib/service.ts";

test("months add to the end of shorter months", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28"); assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
});
test("schedule follows the plan", () => {
  assert.deepEqual(servicePlan({ id: "u", section: "operations.fleet", data: { sla: "Premium 24/7", next_service: "2026-12-01" } }, 3), ["2026-12-01", "2027-03-01", "2027-06-01"]);
  assert.deepEqual(servicePlan({ id: "u", section: "operations.fleet", data: { sla: "Basic", commissioned: "2026-01-10" } }, 2), ["2027-01-10", "2028-01-10"]);
  assert.deepEqual(servicePlan({ id: "u", section: "operations.fleet", data: {} }), []);
});
test("warranty states", () => {
  const u = (e: string) => ({ id: "u", section: "operations.fleet", data: { warranty_end: e } });
  assert.equal(warranty(u("2027-06-01"), "2026-10-20").state, "ok");
  assert.equal(warranty(u("2026-12-01"), "2026-10-20").state, "soon");
  assert.equal(warranty(u("2026-10-01"), "2026-10-20").state, "ended");
});
test("a resolved planned service moves the next date", () => {
  const unit = { id: "u", section: "operations.fleet", status: "Maintenance due", data: { sla: "Standard", next_service: "2026-10-10" } };
  const t = { id: "t", section: "operations.support", status: "Resolved", data: { pm: "yes", unit_ref: "u" } };
  const ch = serviceDone(t, unit, "2026-10-20")!;
  assert.equal(ch.status, "Active"); assert.equal(ch.data.next_service, "2027-04-20"); assert.equal(ch.data.last_service, "2026-10-20");
  assert.equal(serviceDone({ ...t, data: { unit_ref: "u" } }, unit, "2026-10-20"), null);
  assert.equal(serviceDone({ ...t, status: "In progress" }, unit, "2026-10-20"), null);
});
