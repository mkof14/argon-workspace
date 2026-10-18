import { test } from "node:test";
import assert from "node:assert/strict";
import { projectPack } from "../src/lib/projectpack.ts";

test("pack gathers the deal's records", () => {
  const deal = { id: "d", section: "sales.pipeline", title: "Skyline — StarDome", status: "Won", data: { client: "Skyline", value: 1000000, currency: "USD" } };
  const recs = [
    { id: "p", section: "sales.proposals", title: "P", status: "Accepted", data: { deal_ref: "d", number: "P-2026-001", value: 1200000, payment_terms: "30% advance" } },
    { id: "s", section: "security.screening", title: "S", status: "Cleared", data: { deal_ref: "d", party: "Skyline" } },
    { id: "b", section: "operations.builds", title: "Build", status: "Testing", data: { deal_ref: "d", export_check: "Cleared" }, controlled: true },
    { id: "i1", section: "finance.invoices", title: "Advance", status: "Paid", data: { deal_ref: "d", project: "d", amount: 360000, due: "2026-11-01" } },
    { id: "i2", section: "finance.invoices", title: "Before shipping", status: "Draft", data: { deal_ref: "d", project: "d", amount: 480000, due: "2027-02-01" } },
    { id: "q", section: "operations.quality", title: "SAT", status: "Closed", data: { project: "d", project_step: "sat", notes: "All good", date: "2027-03-01" } },
    { id: "z", section: "sales.proposals", title: "Other deal", status: "Draft", data: { deal_ref: "x" } },
  ];
  const p = projectPack({ deal, recs, files: { q: ["sat-photo.jpg"] }, lang: "ru", today: "2026-10-20", photos: 1 });
  assert.match(p.md, /# Пакет проекта: Skyline — StarDome/);
  assert.match(p.md, /USD 1,200,000/); assert.match(p.md, /Оплачено \| USD 360,000/); assert.match(p.md, /Осталось получить \| USD 840,000/);
  assert.match(p.md, /sat-photo\.jpg/); assert.match(p.md, /только для US persons/); assert.match(p.md, /All good/);
  assert.ok(!p.md.includes("Other deal")); assert.equal(p.controlled, true); assert.deepEqual(p.photoRecords, ["q"]);
});
