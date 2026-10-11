// Unit tests for the pure logic the workspace depends on. Run: npm test (Node built-in test runner, no extra packages).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/lib/csv.ts";
import { workingDays } from "../src/config/hr.ts";

test("CSV: commas, quotes, escaped quotes, new lines inside quotes, BOM", () => {
  const rows = parseCsv('﻿Title,Notes\r\n"Acme, Inc.","said ""hi""\nsecond line"\r\nBeta,\r\n');
  assert.deepEqual(rows, [["Title", "Notes"], ["Acme, Inc.", 'said "hi"\nsecond line'], ["Beta", ""]]);
});
test("CSV: semicolon files from European Excel", () => {
  assert.deepEqual(parseCsv("Name;Amount\nA;1,5\n"), [["Name", "Amount"], ["A", "1,5"]]);
});
test("CSV: blank lines are dropped", () => {
  assert.equal(parseCsv("Title\n\nA\n\n").length, 2);
});

for (const tz of ["America/New_York", "UTC", "Asia/Dubai", "Pacific/Auckland"]) {
  test(`Working days are correct in ${tz}`, () => {
    process.env.TZ = tz;
    assert.equal(workingDays("2026-10-12", "2026-10-16"), 5, "Mon–Fri");
    assert.equal(workingDays("2026-10-10", "2026-10-11"), 0, "Sat–Sun");
    assert.equal(workingDays("2026-10-09", "2026-10-12"), 2, "Fri–Mon");
    assert.equal(workingDays("2026-10-12", ""), 1, "single day");
    assert.equal(workingDays("2026-10-16", "2026-10-12"), 0, "reversed");
  });
}
