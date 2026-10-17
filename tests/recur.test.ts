import { test } from "node:test";
import assert from "node:assert/strict";
import { addPeriod, nextOccurrence } from "../src/lib/recur.ts";

test("periods move dates and keep month ends valid", () => {
  assert.equal(addPeriod("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(addPeriod("2026-11-30", "quarterly"), "2027-02-28");
  assert.equal(addPeriod("2028-02-29", "yearly"), "2029-02-28");
  assert.equal(addPeriod("2026-12-29", "weekly"), "2027-01-05");
});

test("a finished repeating record prepares the next one", () => {
  const fields = [{ key: "due", type: "date" }, { key: "notes", type: "long" }];
  const n = nextOccurrence({ id: "a1", title: "Sales tax filing", status: "Filed", data: { repeat: "quarterly", due: "2026-10-15", notes: "x", done_date: "2026-10-14", _tr: { h: {} } } }, fields, "Upcoming")!;
  assert.equal(n.status, "Upcoming"); assert.equal(n.data.due, "2027-01-15"); assert.equal(n.data._prev, "a1");
  assert.equal(n.data.done_date, undefined); assert.equal(n.data._tr, undefined); assert.equal(n.data.repeat, "quarterly");
  assert.equal(nextOccurrence({ id: "a2", title: "x", status: "In progress", data: { repeat: "monthly", due: "2026-10-15" } }, fields, "Open"), null);
  assert.equal(nextOccurrence({ id: "a3", title: "x", status: "Done", data: { due: "2026-10-15" } }, fields, "Open"), null);
  assert.equal(nextOccurrence({ id: "a4", title: "x", status: "Done", data: { repeat: "monthly" } }, fields, "Open"), null);
});

import { localDate, localHour } from "../src/lib/tz.ts";
test("local hour and date follow the person's time zone", () => {
  const d = new Date("2026-10-17T05:30:00Z");
  assert.equal(localHour(d, "Asia/Dubai"), 9); assert.equal(localDate(d, "Asia/Dubai"), "2026-10-17");
  assert.equal(localHour(d, "America/New_York"), 1); assert.equal(localDate(d, "America/Los_Angeles"), "2026-10-16");
  assert.equal(localHour(d, "Not/AZone"), 5);
});

test("the existing 'Repeats' field (Monthly / Quarterly / Annual) also repeats", () => {
  const f = [{ key: "due", type: "date" }];
  assert.equal(nextOccurrence({ id: "b", title: "VAT", status: "Done", data: { frequency: "Quarterly", due: "2026-10-28" } }, f, "Upcoming")!.data.due, "2027-01-28");
  assert.equal(nextOccurrence({ id: "c", title: "x", status: "Done", data: { frequency: "One-time", due: "2026-10-28" } }, f, "Upcoming"), null);
});
