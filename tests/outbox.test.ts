import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueueSave, isNetworkError, isTemp, remap, type OutItem } from "../src/lib/outboxlogic.ts";

let n = 0; const id = () => String(++n);
test("offline saves merge and get real ids later", () => {
  let { q, id: a } = enqueueSave([], { section: "operations.support", title: "Pump down", data: { severity: "High" } }, "t1", "u", id);
  assert.ok(isTemp(a)); assert.equal(q.length, 1);
  ({ q } = enqueueSave(q, { id: a, section: "operations.support", title: "Pump down", data: { notes: "Seen at 10:00" } }, "t2", "u", id));
  assert.equal(q.length, 1); assert.deepEqual((q[0] as any).rec.data, { severity: "High", notes: "Seen at 10:00" });
  q = [...q, { id: "c", kind: "comment", at: "t3", user: "u", record_id: a, body: "photo attached" } as OutItem,
    { id: "f", kind: "upload", at: "t3", user: "u", prefix: `operations.support/${a}`, name: "p.jpg", type: "image/jpeg", file: new Blob(["x"]) } as OutItem];
  const r = remap(q, a, "real-1");
  assert.equal((r[0] as any).rec.id, "real-1"); assert.equal((r[1] as any).record_id, "real-1"); assert.equal((r[2] as any).prefix, "operations.support/real-1");
  ({ q } = enqueueSave([], { id: "x1", section: "s", title: "t", data: { a: 1 } }, "t", "u", id));
  assert.equal((q[0] as any).rec.id, "x1");
});
test("network errors", () => { assert.ok(isNetworkError(new TypeError("Failed to fetch"))); assert.ok(!isNetworkError(new Error("row-level security"))); });
