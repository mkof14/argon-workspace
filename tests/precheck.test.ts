import { test } from "node:test";
import assert from "node:assert/strict";
import { precheck } from "../src/lib/precheck.ts";

const r = (id: string, section: string, status: string, data: any, created_at = "2026-10-15") => ({ id, section, title: id, status, created_at, data });
test("controller checks", () => {
  const all = [
    r("po1", "operations.procurement", "Draft", { vendor: "RadarCo", amount: 50000, currency: "USD" }, "2026-10-18"),
    r("po0", "operations.procurement", "Ordered", { vendor: "radarco ", amount: 50200 }, "2026-10-01"),
    r("v", "operations.vendors", "Approved", { screening: "In progress" }),
    r("b", "finance.budget", "Approved", { department: "Operations", period: "2026 Q4", planned: 100000, actual: 70000 }),
  ];
  all[2].title = "RadarCo";
  const w = precheck(all[0] as any, all as any, "2026-10-20");
  assert.deepEqual(w.map((x) => x.k), ["dup", "budget", "vendor"]); assert.equal(w[1].n, "USD 30,000");
  const e = r("e1", "finance.expenses", "Submitted", { requester: "Anna", amount: 9000, category: "Travel" });
  const hist = [1, 2, 3].map((i) => r(`h${i}`, "finance.expenses", "Paid", { requester: "Bob", amount: 1000 + i, category: "Travel" }, "2026-05-01"));
  const we = precheck(e as any, [e, ...hist] as any, "2026-10-20", () => "sales");
  assert.deepEqual(we.map((x) => x.k), ["nobudget", "large"]); assert.equal(we[1].n, "9×");
  const p = r("p", "sales.proposals", "Draft", { config: "C40", qty: 1, value: 550000, discount: 20 });
  const c = r("c", "finance.costing", "Approved", { config: "C40", bom: 500000, labor: 60000, logistics_cost: 20000 });
  assert.deepEqual(precheck(p as any, [p, c] as any, "2026-10-20").map((x) => x.k), ["underprice", "discount"]);
  assert.deepEqual(precheck(r("x", "finance.expenses", "Submitted", { amount: 0 }) as any, [], "2026-10-20"), []);
});
