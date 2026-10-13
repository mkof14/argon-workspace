// Marketing: compliance gate, approval precondition, AI button targets, calendar reminders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allSections, gateBlocks, CHECK_OPTIONS, CHECK_OK } from "../src/config/workspace.config.mjs";
import { APPROVALS, approvalNeeds } from "../src/config/approvals.ts";
import { MKT_BUTTONS, CHECK_FIELDS, MAIN_FIELD, textHash, bannedHits } from "../src/config/marketing.ts";
import { dueItems } from "../src/lib/insights.ts";

const SECS = allSections() as any[];
const sec = (id: string) => SECS.find((s) => s.id === id);

test("Publishing needs a passed compliance check", () => {
  const s = sec("marketing.social");
  assert.equal(gateBlocks(s.gate, "Published", { check: "Not checked" }), true);
  assert.equal(gateBlocks(s.gate, "Approved", { check: "Legal review needed" }), true);
  assert.equal(gateBlocks(s.gate, "Published", { check: "Passed (AI check)" }), false);
  assert.equal(gateBlocks(s.gate, "Draft", {}), false);
  // the old single-status gate still works
  const b = sec("operations.builds");
  assert.equal(gateBlocks(b.gate, "Shipping", { export_check: "Pending" }), true);
  assert.equal(gateBlocks(b.gate, "Shipping", { export_check: "Cleared" }), false);
  for (const ok of CHECK_OK) assert.ok(CHECK_OPTIONS.includes(ok));
});

test("Gated statuses exist in each section and approvals wait for the check", () => {
  for (const s of SECS.filter((x) => x.gate?.statuses)) {
    assert.ok(s.gate.statuses.some((st: string) => s.statuses.includes(st)), s.id);
    assert.ok(s.fields.some((f: any) => f.key === s.gate.field), s.id);
  }
  assert.equal(approvalNeeds("marketing.press", { check: "Fix needed" }), "check");
  assert.equal(approvalNeeds("marketing.press", { check: "Cleared by legal" }), null);
  assert.equal(approvalNeeds("finance.expenses", {}), null);
  for (const [id, r] of Object.entries(APPROVALS)) if (r.need) assert.ok(sec(id).fields.some((f: any) => f.key === r.need!.field), id);
});

test("AI buttons write into real fields", () => {
  for (const [id, btns] of Object.entries(MKT_BUTTONS)) {
    const s = sec(id); assert.ok(s, id);
    for (const b of btns) if (b.field) assert.ok(s.fields.some((f: any) => f.key === b.field), `${id}.${b.field}`);
  }
  for (const [id, keys] of Object.entries(CHECK_FIELDS)) for (const k of keys) assert.ok(sec(id).fields.some((f: any) => f.key === k), `${id}.${k}`);
  for (const [id, k] of Object.entries(MAIN_FIELD)) assert.ok(sec(id).fields.some((f: any) => f.key === k), `${id}.${k}`);
});

test("Text fingerprint changes with the text; banned words are caught", () => {
  const a = textHash("marketing.social", "T", { text: "Hello" });
  assert.equal(a, textHash("marketing.social", "T", { text: "Hello", reach: 5 }));
  assert.notEqual(a, textHash("marketing.social", "T", { text: "Hello!" }));
  assert.deepEqual(bannedHits("Our StarWall is patented"), ["StarWall", "patented"]);
  assert.deepEqual(bannedHits("AGRON StarDome"), []);
});

test("Marketing dates remind until the right status", () => {
  const d = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const r = (section: string, status: string, data: any) => ({ id: section + status, section, title: "x", status, data } as any);
  assert.equal(dueItems([r("marketing.social", "Approved", { publish: d })]).length, 1); // approved post still has a date ahead
  assert.equal(dueItems([r("marketing.social", "Published", { publish: d })]).length, 0);
  assert.equal(dueItems([r("marketing.interviews", "Recorded", { session: d })]).length, 0);
  assert.equal(dueItems([r("marketing.events", "Booked", { book_by: d, starts: d })]).length, 1); // only the event date
});
