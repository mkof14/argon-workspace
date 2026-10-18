import { test } from "node:test";
import assert from "node:assert/strict";
import { milestonePlan, milestoneReady, readyToSend } from "../src/lib/milestones.ts";

test("schedule splits the value and dates the parts", () => {
  const p = milestonePlan({ dealId: "d", client: "Skyline", value: 1000000.01, currency: "USD", terms: "30/40/30", dates: { start: "2026-11-01", fat: "2027-02-01", sat: "2027-03-15" }, lang: "ru", today: "2026-10-20" });
  assert.equal(p.length, 3);
  assert.deepEqual(p.map((x) => x.data.amount), [300000, 400000, 300000.01]);
  assert.equal(p.reduce((a, x) => a + x.data.amount, 0).toFixed(2), "1000000.01");
  assert.equal(p[0].data.ready_on, "2026-10-20"); assert.equal(p[1].data.ready_on, undefined);
  assert.equal(p[1].due, "2027-02-15"); assert.match(p[0].title, /^Аванс 30% — Skyline/);
  assert.equal(milestonePlan({ dealId: "d", client: "x", value: 0, currency: "USD", terms: "100", dates: {} as any, lang: "en", today: "2026-10-20" }).length, 0);
  assert.equal(milestonePlan({ dealId: "d", client: "x", value: 10, currency: "USD", terms: "100", dates: { start: "", fat: "2027-01-01", sat: "" }, lang: "en", today: "2026-10-20" })[0].data.trigger, "fat");
});

test("closing acceptance makes the waiting invoice ready once", () => {
  const inv = [
    { id: "a", section: "finance.invoices", status: "Draft", data: { project: "d", trigger: "fat", milestone: "preship" } },
    { id: "b", section: "finance.invoices", status: "Draft", data: { project: "d", trigger: "sat", milestone: "accept" } },
    { id: "c", section: "finance.invoices", status: "Sent", data: { project: "d", trigger: "fat", milestone: "preship" } },
  ];
  assert.equal(milestoneReady({ section: "operations.quality", status: "Inspection", data: { project: "d", project_step: "fat" } }, inv, "2027-02-03").length, 0);
  const ch = milestoneReady({ section: "operations.quality", status: "Closed", data: { project: "d", project_step: "fat" } }, inv, "2027-02-03");
  assert.deepEqual(ch.map((c) => c.id), ["a"]); assert.equal(ch[0].data.due, "2027-02-17");
  inv[0].data = ch[0].data;
  assert.equal(milestoneReady({ section: "operations.quality", status: "Closed", data: { project: "d", project_step: "fat" } }, inv, "2027-02-04").length, 0);
  assert.equal(readyToSend(inv).length, 1);
});
