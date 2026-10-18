import { test } from "node:test";
import assert from "node:assert/strict";
import { shipMissing, shipMsg } from "../src/lib/shipgate.ts";

const build = { id: "b", section: "operations.builds", status: "Testing", data: { deal_ref: "d", export_check: "Cleared", euc: "Signed" } };
const ok = [{ id: "s", section: "security.screening", status: "Cleared", data: { deal_ref: "d" } }];

test("other statuses are free", () => {
  assert.deepEqual(shipMissing("operations.builds", "Testing", {}, null, []), []);
  assert.deepEqual(shipMissing("operations.logistics", "Docs in prep", {}, null, []), []);
});
test("a build ships only with export, screening and certificate", () => {
  assert.deepEqual(shipMissing("operations.builds", "Shipping", build.data, null, ok), []);
  assert.deepEqual(shipMissing("operations.builds", "Shipping", { ...build.data, euc: "Requested", export_check: "In progress" }, null, ok), ["export", "euc"]);
  assert.deepEqual(shipMissing("operations.builds", "Shipping", build.data, null, []), ["screening"]);
  assert.deepEqual(shipMissing("operations.builds", "Shipping", build.data, null, [...ok, { id: "s2", section: "security.screening", status: "Flagged", data: { deal_ref: "d" } }]), ["screening"]);
  assert.deepEqual(shipMissing("operations.builds", "Shipping", { ...build.data, euc: "Not required" }, null, ok), []);
});
test("a shipment follows its build", () => {
  assert.deepEqual(shipMissing("operations.logistics", "In transit", {}, null, ok), ["build"]);
  assert.deepEqual(shipMissing("operations.logistics", "Delivered", { build_ref: "b" }, build, ok), []);
  assert.match(shipMsg(["euc"], "ru"), /^Отгружать пока нельзя/);
});
