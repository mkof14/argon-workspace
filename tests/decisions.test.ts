import { test } from "node:test";
import assert from "node:assert/strict";
import { amountOf, decision, ordered } from "../src/lib/decisions.ts";

test("amount and order", () => {
  assert.deepEqual(amountOf({ value: 1000, currency: "AED" }), { v: 1000, cur: "AED" }); assert.equal(amountOf({}), null);
  const T = "2026-10-20";
  const a = decision("approval", { id: "a", title: "Small expense", at: "2026-10-19", data: { amount: 600 } }, T);
  const b = decision("approval", { id: "b", title: "Old PO", at: "2026-10-12", data: { amount: 90000 } }, T);
  const c = decision("project", { id: "c", title: "Red project", at: "2026-10-01" }, T);
  const d = decision("agent", { id: "d", title: "Reminder email", at: "2026-10-20" }, T);
  assert.equal(ordered([c, a, d, b])[0].id, "b"); assert.ok(b.urgency > a.urgency); assert.equal(b.age, 8);
  assert.equal(Math.round(decision("approval", { id: "e", title: "", data: { amount: 3672.5, currency: "AED" } }, T).usd), 1000);
});
