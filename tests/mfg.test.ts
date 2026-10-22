import { test } from "node:test";
import assert from "node:assert/strict";
import { mfgIntent } from "../src/lib/mfgText.ts";
import { qrMatrix, qrSvg } from "../src/lib/qr.ts";

test("the Assistant's manufacturing questions (B55) map to allow-listed intents", () => {
  const I = (q: string, c?: any) => mfgIntent(q, c);
  assert.equal(I("What are we building?")?.intent, "building");
  assert.deepEqual(I("What is the status of C20-0001?"), { intent: "status", arg: "C20-0001" });
  assert.deepEqual(I("What is blocking the C40?"), { intent: "blocking", arg: "C40" });
  assert.equal(I("What materials are missing?")?.intent, "missing");
  assert.equal(I("What has not arrived?")?.intent, "not_arrived");
  assert.deepEqual(I("What purchase orders are late for this unit?", { unit: "AGR-C40-0004" }), { intent: "late_pos", arg: "AGR-C40-0004" });
  assert.equal(I("What inspections failed?")?.intent, "failed_inspections");
  assert.equal(I("What tests failed?")?.intent, "failed_tests");
  assert.deepEqual(I("What changed from BOM AGR-BOM-0001 revision A to B?"), { intent: "bom_diff", arg: "What changed from BOM AGR-BOM-0001 revision A to B" });
  assert.equal(I("What is installed in this unit?", { unit: "C20-0002" })?.arg, "C20-0002");
  assert.equal(I("Which serial number is installed?")?.intent, "serials");
  assert.equal(I("What software version is on this unit?")?.intent, "software");
  assert.equal(I("What is different from the approved BOM?")?.intent, "diff_bom");
  assert.equal(I("Is this unit ready for acceptance?")?.intent, "ready_acceptance");
  assert.equal(I("Is this unit ready for shipment?")?.intent, "ready_shipment");
  assert.equal(I("What are the major manufacturing risks this week?")?.intent, "risks");
  assert.equal(I("Что блокирует C40-0004?")?.intent, "blocking");
  assert.equal(I("Готово ли изделие C20-0001 к отгрузке?")?.intent, "ready_shipment");
  assert.equal(I("What is the weather?"), null);
});

test("label QR codes: size grows with the payload; too long is refused", () => {
  assert.equal(qrMatrix("LOC:STORE").length, 21);
  assert.equal(qrMatrix("AGR1:unit:3f2a9c1e-0000-4000-8000-000000000001").length, 33);
  assert.throws(() => qrMatrix("x".repeat(400)), /Too long/);
  assert.match(qrSvg("AGR1:unit:1"), /^<svg[^>]+viewBox="0 0 29 29"/);
});
