import { test } from "node:test";
import assert from "node:assert/strict";
import { portalView } from "../src/lib/portal.ts";

test("the portal shows only this client's orders, sent proposals and invoices — never controlled or internal data", () => {
  const client = { id: "c1", section: "sales.clients", title: "Skyline Marina", status: "Active", data: {} };
  const all: any[] = [
    { id: "d1", section: "sales.pipeline", title: "Deal", status: "Won", data: { client_ref: "c1", notes: "internal margin 40%" } },
    { id: "d2", section: "sales.pipeline", title: "Other", status: "Won", data: { client_ref: "c9" } },
    { id: "b1", section: "operations.builds", title: "StarDome C40", status: "Testing", data: { deal_ref: "d1", config: "C40 Advanced", notes: "supplier issue" } },
    { id: "b2", section: "operations.builds", title: "Secret", status: "Design", controlled: true, data: { deal_ref: "d1" } },
    { id: "l1", section: "operations.logistics", title: "Ship", status: "In transit", data: { build_ref: "b1", carrier: "Maersk", tracking: "MAEU123", due: "2026-12-01" } },
    { id: "p1", section: "sales.proposals", title: "P", status: "Sent", data: { deal_ref: "d1", number: "P-2026-001", value: 1000, currency: "USD" } },
    { id: "p2", section: "sales.proposals", title: "Draft", status: "Draft", data: { deal_ref: "d1", number: "P-2026-002" } },
    { id: "i1", section: "finance.invoices", title: "Advance", status: "Due", data: { deal_ref: "d1", direction: "Receivable", amount: 300 } },
    { id: "i2", section: "finance.invoices", title: "Supplier", status: "Due", data: { deal_ref: "d1", direction: "Payable", amount: 50 } },
    { id: "i3", section: "finance.invoices", title: "Other client", status: "Due", data: { deal_ref: "d2", direction: "Receivable", amount: 9 } },
    { id: "s1", section: "operations.support", title: "Camera offline", status: "New", data: { client: "skyline marina", severity: "High" } },
  ];
  const v = portalView(client, all);
  assert.deepEqual(v.orders.map((o) => o.id), ["b1"]);
  assert.equal(v.orders[0].step, 4); assert.equal(v.orders[0].shipping!.tracking, "MAEU123");
  assert.deepEqual(v.proposals.map((p) => p.number), ["P-2026-001"]);
  assert.deepEqual(v.invoices.map((i) => i.id), ["i1"]);
  assert.deepEqual(v.requests.map((r) => r.id), ["s1"]);
  assert.doesNotMatch(JSON.stringify(v), /internal margin|supplier issue|Secret/);
});
