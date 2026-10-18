import { test } from "node:test";
import assert from "node:assert/strict";
import { buildParts, shortages } from "../src/lib/parts.ts";

test("parts for a build: reserved, free in stock, on order, short", () => {
  const all: any[] = [
    { id: "b1", section: "operations.builds", title: "Skyline", status: "Procurement", data: { config: "C40 Advanced", due: "2026-11-20" } },
    { id: "l1", section: "technical.bom", title: "Radar", status: "Approved", data: { config: "C40 Advanced", item: "X-band radar", part_no: "RDR-9", qty: 1 } },
    { id: "l2", section: "technical.bom", title: "Cameras", status: "Approved", data: { config: "C40 Advanced", item: "PTZ camera", part_no: "CAM-4", qty: 4 } },
    { id: "l3", section: "technical.bom", title: "Old", status: "Superseded", data: { config: "C40 Advanced", item: "x", qty: 9 } },
    { id: "i1", section: "operations.inventory", title: "Radar #1", status: "In stock", data: { model: "rdr-9", serial: "1" } },
    { id: "i2", section: "operations.inventory", title: "Cam #1", status: "Reserved", data: { part_no: "CAM-4", build_ref: "b1" } },
    { id: "i3", section: "operations.inventory", title: "Cam #2", status: "In stock", data: { model: "PTZ camera" } },
    { id: "i4", section: "operations.inventory", title: "Cam #3", status: "In stock", data: { part_no: "CAM-4", build_ref: "b9" } },
    { id: "p1", section: "operations.procurement", title: "Cams", status: "Ordered", data: { item: "PTZ camera", qty: 1, build_ref: "b1" } },
  ];
  const p = buildParts(all[0], all);
  assert.equal(p.length, 2);
  const radar = p.find((x) => x.line.id === "l1")!; assert.deepEqual([radar.need, radar.reserved, radar.free, radar.onOrder, radar.short], [1, 0, 1, 0, 1]); assert.deepEqual(radar.freeIds, ["i1"]);
  const cams = p.find((x) => x.line.id === "l2")!; assert.deepEqual([cams.need, cams.reserved, cams.free, cams.onOrder, cams.short], [4, 1, 1, 1, 2]);
  const s = shortages(all, "2026-10-19"); assert.equal(s.length, 1); assert.deepEqual(s[0].lines.map((l) => l.line.id), ["l2"]); // radar is free in stock
});
