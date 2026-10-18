import { test } from "node:test";
import assert from "node:assert/strict";
import { portfolio } from "../src/lib/portfolio.ts";
import { weekOf, workload } from "../src/lib/workload.ts";

const T = "2026-10-20";
test("traffic light", () => {
  const all = [
    { id: "a", section: "sales.pipeline", title: "A", status: "Won", data: {} },
    { id: "a1", section: "company.tasks", title: "Kick-off", status: "Done", data: { project: "a", due: "2026-10-01" } },
    { id: "a2", section: "operations.builds", title: "Build A", status: "Assembly", data: { project: "a", deal_ref: "a", due: "2026-12-30" } },
    { id: "b", section: "sales.pipeline", title: "B", status: "Won", data: {} },
    { id: "b1", section: "company.tasks", title: "Late step", status: "Open", data: { project: "b", due: "2026-10-15" } },
    { id: "c", section: "sales.pipeline", title: "C", status: "Won", data: {} },
    { id: "c1", section: "company.tasks", title: "Very late", status: "Open", data: { project: "c", due: "2026-09-01" } },
    { id: "c2", section: "finance.invoices", title: "Adv", status: "Sent", data: { deal_ref: "c", project: "c", due: "2026-10-10" } },
    { id: "d", section: "sales.pipeline", title: "No project", status: "Won", data: {} },
  ];
  const rows = portfolio(all as any, T);
  assert.deepEqual(rows.map((r) => `${r.deal.id}:${r.health}`), ["c:red", "b:amber", "a:green"]);
  assert.deepEqual(rows[0].reasons.map((r) => r.k), ["late", "overdue"]); assert.equal(rows[2].done, 1); assert.equal(rows[2].total, 2);
  const withShip = portfolio([...all, { id: "s", section: "operations.logistics", title: "Ship", status: "Planned", data: { project: "a", project_step: "ship", due: "2026-10-28" } }] as any, T, { ship: () => ["euc"] });
  assert.equal(withShip.find((r) => r.deal.id === "a")!.health, "red");
});

test("workload per week", () => {
  assert.equal(weekOf("2026-10-20"), "2026-10-19"); assert.equal(weekOf("2026-10-25"), "2026-10-19");
  const all = [
    { id: "1", section: "company.tasks", title: "t1", status: "Open", data: { assignee: "Anna K", due: "2026-10-21" } },
    { id: "2", section: "company.tasks", title: "t2", status: "Open", data: { assignee: "anna@agron1.com", due: "2026-10-28" } },
    { id: "3", section: "operations.builds", title: "b", status: "Assembly", data: { owner: "Anna K", due: "2026-10-10" } },
    { id: "4", section: "company.tasks", title: "done", status: "Done", data: { assignee: "Anna K", due: "2026-10-21" } },
    { id: "5", section: "company.tasks", title: "far", status: "Open", data: { assignee: "Ivan", due: "2027-03-01" } },
    { id: "6", section: "sales.metrics", title: "m", status: "Draft", data: { owner: "Ivan", date: "2026-10-21" } },
  ];
  const w = workload(all as any, [{ full_name: "Anna K", email: "anna@agron1.com" }], T);
  assert.equal(w.starts[0], "2026-10-19"); assert.equal(w.rows.length, 1);
  assert.equal(w.rows[0].who, "Anna K"); assert.equal(w.rows[0].overdue.length, 1); assert.deepEqual(w.rows[0].weeks.slice(0, 2).map((x) => x.length), [1, 1]);
});
