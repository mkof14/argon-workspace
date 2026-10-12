// Calendar subscription output (RFC 5545 basics).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ics, fold } from "../src/lib/ics.ts";

test("All-day event with escaping, end date next day, CRLF lines", () => {
  const out = ics("AGRON — my deadlines", [{ uid: "a-due@agron1.com", date: "2026-12-31", summary: "NDA, Gulf Marine; expiry", description: "Line 1\nLine 2", url: "https://workspace.agron1.com/legal/contracts?r=1" }], new Date("2026-10-12T10:00:00Z"));
  assert.match(out, /^BEGIN:VCALENDAR\r\n/);
  assert.match(out, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n/);
  assert.match(out, /SUMMARY:NDA\\, Gulf Marine\; expiry\r\n/);
  assert.match(out, /DESCRIPTION:Line 1\\nLine 2\r\n/);
  assert.match(out, /DTSTAMP:20261012T100000Z/);
  assert.ok(out.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(out), "every line ends with CRLF");
});
test("Long lines fold at 75 octets, multi-byte characters stay whole", () => {
  const line = "SUMMARY:" + "Проверка длинной строки ".repeat(8);
  const f = fold(line);
  for (const part of f.split("\r\n")) assert.ok(new TextEncoder().encode(part).length <= 75);
  assert.equal(f.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join(""), line);
});
