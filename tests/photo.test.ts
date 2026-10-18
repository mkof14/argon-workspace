import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPO } from "../src/lib/photo.ts";

test("delivery note finds its purchase order", () => {
  const pos = [
    { id: "a", section: "operations.procurement", title: "Radar batch", status: "Ordered", data: { vendor: "RadarCo LLC", item: "Radar RX-1", qty: 2 } },
    { id: "b", section: "operations.procurement", title: "Masts", status: "Ordered", data: { vendor: "Mast Systems", item: "Telescopic mast", qty: 1 } },
    { id: "c", section: "operations.procurement", title: "Radar old", status: "Received", data: { vendor: "RadarCo", item: "Radar RX-1", qty: 2 } },
  ];
  const m = matchPO({ vendor: "RADARCO", item: "RX-1 radar unit", qty: 2 }, pos);
  assert.deepEqual(m.map((x) => x.r.id), ["a"]);
  assert.equal(matchPO({ vendor: "Unknown Ltd", item: "Cables" }, pos).length, 0);
});
