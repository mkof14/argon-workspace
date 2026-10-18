import { test } from "node:test";
import assert from "node:assert/strict";
import { changeOrderEffects, projectMoney } from "../src/lib/margin.ts";

const deal = { id: "d", section: "sales.pipeline", title: "Deal", status: "Won", data: { value: 900000, currency: "USD", config: "C40" } };
const base = [
  { id: "p", section: "sales.proposals", title: "P", status: "Accepted", updated_at: "2026-10-01", data: { deal_ref: "d", value: 1000000, currency: "USD", qty: 1 } },
  { id: "b", section: "operations.builds", title: "B", status: "Assembly", data: { deal_ref: "d", config: "C40" } },
  { id: "c", section: "finance.costing", title: "C40", status: "Approved", data: { config: "C40", bom: 500000, labor: 80000, logistics_cost: 20000, price: 1000000 } },
  { id: "co", section: "legal.contracts", title: "CO-1 extra radar", status: "Signed", data: { deal_ref: "d", type: "Change order", amount: 100000 } },
  { id: "po1", section: "operations.procurement", title: "Radar", status: "Ordered", data: { build_ref: "b", amount: 450000 } },
  { id: "po2", section: "operations.procurement", title: "Draft PO", status: "Draft", data: { build_ref: "b", amount: 999999 } },
  { id: "e", section: "finance.expenses", title: "Travel", status: "Approved", data: { deal_ref: "d", amount: 36725, currency: "AED" } },
  { id: "i1", section: "finance.invoices", title: "Advance", status: "Paid", data: { deal_ref: "d", amount: 300000 } },
  { id: "i2", section: "finance.invoices", title: "Pre", status: "Draft", data: { deal_ref: "d", amount: 400000, milestone: "preship", due: "2027-01-01" } },
  { id: "i3", section: "finance.invoices", title: "Acc", status: "Draft", data: { deal_ref: "d", amount: 300000, milestone: "accept", due: "2027-03-01" } },
];

test("project money", () => {
  const m = projectMoney(deal, base);
  assert.equal(m.contract, 1000000); assert.equal(m.changes, 100000); assert.equal(m.revenue, 1100000);
  assert.equal(m.invoiced, 300000); assert.equal(m.collected, 300000);
  assert.equal(m.committed, 460000); assert.equal(m.planned, 600000); assert.equal(m.forecastCost, 600000);
  assert.equal(m.targetPct, 40); assert.equal(m.forecastPct, 45.5); assert.equal(m.low, false); assert.equal(m.over, false);
  const bad = projectMoney(deal, [...base, { id: "po3", section: "operations.procurement", title: "x", status: "Received", data: { build_ref: "b", amount: 300000 } }]);
  assert.equal(bad.over, true); assert.equal(bad.forecastPct, 30.9); assert.equal(bad.low, true);
});

test("change orders change the payments once", () => {
  const up = changeOrderEffects(base[3], base, "2026-10-20")!;
  assert.equal(up.create!.data.amount, 100000); assert.equal(up.create!.data.ready_on, "2026-10-20"); assert.equal(up.co.applied_on, "2026-10-20");
  assert.equal(changeOrderEffects({ ...base[3], data: { ...base[3].data, applied_on: "2026-10-20" } }, base, "2026-10-21"), null);
  const down = changeOrderEffects({ ...base[3], id: "co2", data: { deal_ref: "d", type: "Change order", amount: -50000 } }, base, "2026-10-20")!;
  assert.deepEqual([down.update!.id, down.update!.data.amount], ["i3", 250000]);
  assert.equal(changeOrderEffects({ ...base[3], status: "Negotiation" }, base, "2026-10-20"), null);
});
