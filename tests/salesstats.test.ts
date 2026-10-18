import { test } from "node:test";
import assert from "node:assert/strict";
import { quarterOf, salesStats } from "../src/lib/salesstats.ts";

test("quarter", () => { assert.deepEqual(quarterOf("2026-11-05"), { start: "2026-10-01", end: "2026-12-31", label: "2026 Q4" }); assert.equal(quarterOf("2027-02-10").end, "2027-03-31"); });
test("funnel, cycle, quarter, losses", () => {
  const d = (id: string, status: string, data: any, created = "2026-07-01", updated = "2026-10-10") => ({ id, section: "sales.pipeline", title: id, status, created_at: created, updated_at: updated, data });
  const deals = [
    d("w1", "Won", { value: 1000000, segment: "Port" }, "2026-06-01", "2026-10-05"),
    d("w2", "Won", { value: 500000, segment: "Marina" }, "2026-01-10", "2026-04-20"),
    d("l1", "Lost", { value: 800000, segment: "Port", lost_reason: "Price" }),
    d("l2", "Lost", { value: 300000, segment: "Marina" }),
    d("n1", "Negotiation", { value: 400000, expected_close: "2026-11-30" }),
    d("p1", "Proposal", { value: 200000, expected_close: "2027-02-01" }),
    d("q1", "Qualified", { value: 100000 }),
  ];
  const act = [{ record_id: "l1", action: "status", detail: { from: "Proposal", to: "Negotiation" }, created_at: "2026-09-01" }, { record_id: "w1", action: "status", detail: { from: "Negotiation", to: "Won" }, created_at: "2026-10-05T10:00:00Z" }];
  const s = salesStats(deals as any, act, "2026-10-20", 2000000);
  assert.deepEqual(s.funnel.map((f) => f.n), [7, 6, 5, 4, 2]);
  assert.equal(s.winRate, 50); assert.deepEqual(s.cycle, { median: 100, avg: 113, n: 2 });
  assert.equal(s.quarter.won, 1000000); assert.equal(s.quarter.weighted, 300000); assert.equal(s.quarter.forecast, 1300000); assert.equal(s.quarter.gap, 700000); assert.equal(s.quarter.noDate, 1);
  assert.deepEqual(s.lostReasons.map((r) => r.k), ["Price", "—"]); assert.equal(s.lostNoReason, 1);
  assert.equal(s.segments.find((x) => x.k === "Port")!.rate, 50);
});
