import { test } from "node:test";
import assert from "node:assert/strict";
import { searchWords, validatePlan } from "../src/lib/command.ts";
import { allSections } from "../src/config/workspace.config.mjs";

const sections = allSections() as any[];
const cands = [
  { id: "D1", section: "sales.pipeline", title: "Aurora superyacht", status: "Proposal", data: {} },
  { id: "H1", section: "hr.team", title: "Ivan Petrov", status: "Active", data: {} },
];

test("plan: only allowed sections, real statuses, fields, options and found records", () => {
  const writable = new Set(["company.tasks", "sales.pipeline", "finance.invoices"]);
  const raw = { ops: [
    { op: "create", section: "company.tasks", title: "Call Aurora", status: "Nope", data: { assignee: "Ivan Petrov", due: "2026-10-16", priority: "Urgent", bogus: 1 } },
    { op: "create", section: "finance.invoices", title: "Invoice — Aurora", status: "Draft", data: { deal_ref: "D1", amount: "120,000", currency: "USD", direction: "Receivable" } },
    { op: "update", id: "D1", status: "Negotiation", data: {} },
    { op: "update", id: "H1", status: "Left" },
    { op: "update", id: "ZZ", status: "Won" },
    { op: "create", section: "legal.contracts", title: "x" },
    { op: "delete", id: "D1" },
    { op: "comment", id: "D1", body: "Client asked for a site visit" },
  ] };
  const { ops, dropped } = validatePlan(raw, { sections, writable, candidates: cands });
  assert.equal(ops.length, 4);
  assert.deepEqual(ops[0], { op: "create", section: "company.tasks", title: "Call Aurora", status: "New", data: { assignee: "Ivan Petrov", due: "2026-10-16" } });
  assert.deepEqual((ops[1] as any).data, { deal_ref: "D1", deal_ref_title: "Aurora superyacht", amount: 120000, currency: "USD", direction: "Receivable" });
  assert.deepEqual(ops[2], { op: "update", id: "D1", section: "sales.pipeline", title: "Aurora superyacht", status: "Negotiation", data: {} });
  assert.equal(ops[3].op, "comment");
  assert.equal(dropped.length, 3); // hr.team not writable, unknown record, legal.contracts not writable
});

test("search words skip command words and keep names", () => {
  assert.deepEqual(searchWords("переведи сделку Aurora в Negotiation"), ["negotiation", "aurora"]);
  assert.ok(searchWords("create a task for Ivan for Friday").includes("ivan"));
});
