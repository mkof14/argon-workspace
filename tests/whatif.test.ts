import { test } from "node:test";
import assert from "node:assert/strict";
import { applyScenario, finishDates } from "../src/lib/whatif.ts";
import { cashForecast } from "../src/lib/cashforecast.ts";

const T = "2026-10-20";
const all = [
  { id: "m", section: "finance.metrics", title: "2026-09", status: "Final", data: { period: "2026-09", cash: 100000 } },
  { id: "d", section: "sales.pipeline", title: "Deal", status: "Won", data: {} },
  { id: "s1", section: "company.tasks", title: "Done", status: "Done", data: { project: "d", due: "2026-10-01" } },
  { id: "s2", section: "operations.quality", title: "FAT", status: "Planned", data: { project: "d", date: "2026-11-20" } },
  { id: "i1", section: "finance.invoices", title: "Pre", status: "Draft", data: { project: "d", milestone: "preship", amount: 200000, due: "2026-12-04" } },
  { id: "i2", section: "finance.invoices", title: "Adv", status: "Sent", data: { project: "d", direction: "Receivable", amount: 50000, due: "2026-10-30" } },
  { id: "po", section: "operations.procurement", title: "Radar", status: "Ordered", data: { amount: 120000, eta: "2026-11-10" } },
  { id: "pay", section: "finance.invoices", title: "Supplier", status: "Due", data: { direction: "Payable", amount: 150000, due: "2026-12-15" } },
];

test("scenario moves only what it should, original untouched", () => {
  const s = applyScenario(all as any, [{ kind: "delay", id: "d", days: 30 }, { kind: "pay", id: "i2", days: 20 }]);
  const g = (id: string) => s.find((r) => r.id === id)!.data;
  assert.equal(g("s1").due, "2026-10-01"); assert.equal(g("s2").date, "2026-12-20"); assert.equal(g("i1").due, "2027-01-03"); assert.equal(g("i2").due, "2026-11-19");
  assert.equal(all[3].data.date, "2026-11-20");
  assert.equal(finishDates(s as any).d, "2026-12-20");
});

test("a delay creates a cash gap the base plan does not have", () => {
  const base = cashForecast(all as any, T); const scen = cashForecast(applyScenario(all as any, [{ kind: "delay", id: "d", days: 60 }]) as any, T);
  assert.equal(base.gap, null); assert.ok(scen.gap); assert.ok(scen.low.balance < base.low.balance);
});
