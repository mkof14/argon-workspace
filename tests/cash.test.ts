import { test } from "node:test";
import assert from "node:assert/strict";
import { cashForecast } from "../src/lib/cashforecast.ts";

test("90-day cash: certain money by week, late money in the first week, probable deals apart, the gap found", () => {
  const all: any[] = [
    { id: "m", section: "finance.metrics", title: "2026-09", status: "Final", data: { period: "2026-09", cash: 100000 } },
    { id: "i1", section: "finance.invoices", title: "Client A", status: "Sent", data: { direction: "Receivable", amount: 50000, currency: "USD", due: "2026-10-30" } },
    { id: "i2", section: "finance.invoices", title: "Late client", status: "Overdue", data: { direction: "Receivable", amount: 36725, currency: "AED", due: "2026-10-01" } },
    { id: "p1", section: "finance.invoices", title: "Supplier", status: "Due", data: { direction: "Payable", amount: 180000, currency: "USD", due: "2026-11-10" } },
    { id: "x", section: "finance.invoices", title: "Paid", status: "Paid", data: { direction: "Payable", amount: 999999, due: "2026-10-20" } },
    { id: "e", section: "finance.expenses", title: "Trip", status: "Approved", data: { amount: 5000, currency: "USD" } },
    { id: "o", section: "operations.procurement", title: "Radar", status: "Ordered", data: { amount: 20000, currency: "USD", eta: "2027-03-01" } },
    { id: "d", section: "sales.pipeline", title: "Deal", status: "Negotiation", data: { value: 1000000, currency: "USD", expected_close: "2026-11-02" } },
  ];
  const f = cashForecast(all, "2026-10-19");
  assert.equal(f.opening, 100000);
  assert.equal(f.weeks[0].in, 10000); assert.equal(f.weeks[0].out, 5000);          // the late AED invoice and the approved expense
  assert.equal(f.lines.find((l) => l.id === "i2")!.late, true);
  assert.equal(f.weeks[1].in, 50000);                                               // due 30 Oct
  assert.equal(f.weeks[3].out, 180000);                                             // due 10 Nov
  assert.equal(f.lines.some((l) => l.id === "o" || l.id === "x"), false);           // beyond 90 days / already paid
  assert.equal(f.weeks[2].probable, 225000);                                        // 30% of 75% of 1M at close
  assert.equal(f.gap!.start, "2026-11-09"); assert.equal(f.gap!.balance, -25000);
  assert.ok(f.weeks[3].withProbable > 0);
});

import { financeFindings } from "../src/lib/deptAgents.ts";
test("the finance agent warns about a cash gap ahead", () => {
  const all: any[] = [
    { id: "m", section: "finance.metrics", title: "2026-09", status: "Final", data: { period: "2026-09", cash: 20000, burn: 1000 } },
    { id: "p1", section: "finance.invoices", title: "Radar supplier", status: "Due", data: { direction: "Payable", amount: 50000, currency: "USD", due: "2026-10-28" } },
  ];
  const th = { remind_before: 3, escalate_after: 3, stalled_deal: 14 };
  const f = financeFindings(all, "2026-10-19", { ...th, cash: cashForecast(all, "2026-10-19") }).find((x) => x.key.startsWith("fin-gap"));
  assert.ok(f); assert.equal(f!.level, "bad"); assert.equal(f!.rec.data.gap_from, "2026-10-26"); assert.match(f!.text, /Radar supplier/);
});
