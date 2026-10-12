// Text extraction from Word, Excel and PowerPoint files used by Smart upload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { officeText, isOffice } from "../src/lib/office.ts";

const blob = (f: string) => new Blob([readFileSync(new URL(`./fixtures/${f}`, import.meta.url))]);

test("Word: paragraphs, tabs and entities", async () => {
  const t = await officeText(blob("sample.docx"), "sample.docx");
  assert.match(t, /Purchase Order PO-0042\nVendor: Furuno & Co\tTotal 12500 USD/);
});
test("Excel: shared strings, rich text, numbers, inline strings, all sheets in order", async () => {
  const t = await officeText(blob("sample.xlsx"), "sample.xlsx");
  assert.match(t, /Name\tRole\tYear/); assert.match(t, /Anna Lee\tEngineer\t2026/); assert.match(t, /# Sheet 2\nSecond/);
});
test("PowerPoint: slides in order (stored without compression)", async () => {
  const t = await officeText(blob("sample.pptx"), "sample.pptx");
  assert.ok(t.indexOf("StarDome C40 HQ") < t.indexOf("Roadmap"));
});
test("isOffice", () => { assert.ok(isOffice("a.DOCX")); assert.ok(!isOffice("a.pdf")); });
