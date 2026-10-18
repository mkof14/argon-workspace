import { test } from "node:test";
import assert from "node:assert/strict";
import { poStamps, vendorScore, weakVendors } from "../src/lib/vendors.ts";

const po = (id: string, o: Record<string, any>, status = "Received") => ({ id, section: "operations.procurement", status, data: { vendor: "RadarCo", ...o } });

test("dates are remembered on order and receipt", () => {
  assert.deepEqual(poStamps("Approved", po("a", { eta: "2026-11-01" }, "Ordered"), "2026-10-20"), { vendor: "RadarCo", eta: "2026-11-01", ordered_on: "2026-10-20", eta_promised: "2026-11-01" });
  assert.equal(poStamps("Ordered", po("a", { eta_promised: "2026-11-01", ordered_on: "2026-10-20" }), "2026-11-03")?.received_on, "2026-11-03");
  assert.equal(poStamps("Ordered", po("a", {}, "Ordered"), "2026-11-03"), null);
});

test("score: on time, delay, rejects, price", () => {
  const all = [
    po("1", { item: "Radar", qty: 2, amount: 80000, eta_promised: "2026-01-10", received_on: "2026-01-10", ordered_on: "2025-12-01" }),
    po("2", { item: "Radar", qty: 2, amount: 88000, eta_promised: "2026-03-10", received_on: "2026-03-20", ordered_on: "2026-02-01", defects: 1 }),
    po("3", { item: "Mast", qty: 4, amount: 4000, eta_promised: "2026-04-10", received_on: "2026-04-09" }),
    po("4", { item: "Mast", qty: 1, amount: 1000 }, "Cancelled"),
    { id: "x", section: "operations.procurement", status: "Received", data: { vendor: "Other" } },
  ];
  const s = vendorScore("radarco ", all);
  assert.equal(s.orders, 3); assert.equal(s.onTime, 67); assert.equal(s.avgDelay, 3.3);
  assert.equal(s.defectPct, 12.5); assert.equal(s.priceChange, 10); assert.equal(s.grade, "C");
  assert.deepEqual(s.late.map((l) => l.days), [10]);
  assert.equal(weakVendors(all).length, 1);
  assert.equal(vendorScore("Other", all).grade, "new");
});
