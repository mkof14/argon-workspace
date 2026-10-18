// Approval rules must point to real sections, statuses, fields and roles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allSections, ROLES } from "../src/config/workspace.config.mjs";
import { APPROVALS, canSendForApproval } from "../src/config/approvals.ts";

test("Approval rules match the workspace configuration", () => {
  const secs = allSections() as any[];
  for (const [id, r] of Object.entries(APPROVALS)) {
    const s = secs.find((x) => x.id === id); assert.ok(s, `section ${id}`);
    for (const st of [...r.wait, r.ok, ...(r.no ? [r.no] : [])]) assert.ok(s.statuses.includes(st), `${id}: status ${st}`);
    for (const k of r.key) assert.ok(s.fields.some((f: any) => f.key === k), `${id}: field ${k}`);
    for (const role of r.approvers) assert.ok(role in (ROLES as any), `${id}: role ${role}`);
    assert.ok(!r.wait.includes(r.ok), `${id}: approved status is not a waiting status`);
  }
});
test("Only waiting statuses can be sent", () => {
  assert.ok(canSendForApproval("finance.expenses", "Submitted"));
  assert.ok(!canSendForApproval("finance.expenses", "Paid"));
  assert.ok(!canSendForApproval("legal.claims", "Open"));
  assert.ok(canSendForApproval("legal.contracts", "Drafting")); assert.ok(!canSendForApproval("legal.contracts", "Signed"));
});

import { limitRoles, overLimit, withLimits } from "../src/config/approvals.ts";
test("approval limits: self-approval amount, tiers by amount, currency converted", () => {
  assert.equal(overLimit("finance.expenses", { amount: 400, currency: "USD" }), false);
  assert.equal(overLimit("finance.expenses", { amount: 3000, currency: "AED" }), true); // ≈ 817 USD
  assert.deepEqual(limitRoles("finance.expenses", { amount: 3000, currency: "USD" }), ["finance", "management", "admin", "owner"]);
  assert.deepEqual(limitRoles("operations.procurement", { amount: 20000, currency: "EUR" }), ["management", "admin", "owner"]);
  assert.deepEqual(limitRoles("operations.procurement", { amount: 900000, currency: "USD" }), ["owner"]);
  assert.equal(limitRoles("hr.leave", {}), null);
  const custom = withLimits({ self_usd: 100, tiers: [{ up_to: 1000, roles: ["finance"] }] });
  assert.deepEqual(custom.tiers.at(-1), { up_to: null, roles: ["owner"] });
  assert.deepEqual(limitRoles("finance.expenses", { amount: 5000 }, custom), ["owner"]);
});
