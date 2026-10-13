// Channel statistics import, report builders and the server's private-address guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateExport as agg, monthOf, delta, prevMonth } from "../src/lib/channels.ts";
import { parseCsv } from "../src/lib/csv.ts";
const aggregateExport = (t: string) => agg(parseCsv(t));
import { privateIp } from "../src/lib/server/safefetch.ts";

test("Dates from platform exports become months", () => {
  assert.equal(monthOf("2026-10-03"), "2026-10");
  assert.equal(monthOf("10/03/2026"), "2026-10");
  assert.equal(monthOf("03.10.2026"), "2026-10");
  assert.equal(monthOf("Oct 3, 2026"), "2026-10");
  assert.equal(monthOf("Total"), "");
  assert.equal(prevMonth("2026-01"), "2025-12");
});

test("A LinkedIn-style daily export is summed by month", () => {
  const csv = "Aggregate engagement metrics\nDate,Impressions (total),Clicks (total),Reactions (total),Comments (total),Reposts (total),Total followers\n10/01/2026,100,5,4,1,0,2\n10/02/2026,200,7,6,0,1,3\n11/01/2026,50,1,1,0,0,1\nTotal,350,13,11,1,1,6\n";
  const { months, found } = aggregateExport(csv);
  assert.equal(months.length, 2);
  assert.deepEqual([months[0].period, months[0].impressions, months[0].clicks, months[0].engagements, months[0].new_followers], ["2026-10", 300, 12, 12, 5]);
  assert.equal(months[1].impressions, 50);
  assert.ok(found.includes("impressions"));
});

test("An export with an engagements column uses it directly", () => {
  const { months } = aggregateExport("Date,Engagements,Views\n2026-09-01,10,300\n2026-09-02,5,200\n");
  assert.deepEqual([months[0].engagements, months[0].video_views], [15, 500]);
  assert.equal(aggregateExport("Name,Value\nA,1\n").months.length, 0);
});

test("Change text and private addresses", () => {
  assert.equal(delta(110, 100), "+10%");
  assert.equal(delta(90, 100), "−10%");
  assert.equal(delta(5, 0), "new");
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "100.64.0.1"]) assert.equal(privateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "76.76.21.21", "2606:4700::1111"]) assert.equal(privateIp(ip), false, ip);
});
