// Search helpers for "Ask your documents".
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk, tsQuery } from "../src/lib/docsText.ts";

test("tsQuery: prefix OR query, no stop words, no injection characters", () => {
  const q = tsQuery(["Какие радары для C40?", "radar & ' | ! :* (x)"]);
  assert.equal(q, "радары:* | c40:* | radar:*");
  assert.equal(tsQuery(["что как"]), "");
});
test("tsQuery: keeps short codes with digits, caps at 30 terms", () => {
  assert.match(tsQuery(["6A003 UPS"]), /6a003:\* \| ups:\*/);
  assert.equal(tsQuery([Array.from({ length: 50 }, (_, i) => `word${i}x`).join(" ")]).split(" | ").length, 30);
});
test("chunk: splits long text at paragraphs into ~3000-character parts", () => {
  const parts = chunk(Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ` + "x".repeat(200)).join("\n\n"));
  assert.ok(parts.length > 2 && parts.every((p) => p.length <= 3000));
  assert.deepEqual(chunk(""), [""]);
});
