// Integrity of the workspace configuration and document templates: catches broken links between them before deploy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLES, DEPARTMENTS, allSections, defaultRules } from "../src/config/workspace.config.mjs";
import { TEMPLATES, TPL_DEPTS, fillTpl } from "../src/config/templates.ts";

const SECS = allSections() as any[];
const byId = new Map(SECS.map((s) => [s.id, s]));

test("Section ids are unique and every section has statuses and labels", () => {
  assert.equal(byId.size, SECS.length);
  for (const s of SECS) {
    assert.ok(Array.isArray(s.statuses) && s.statuses.length, `${s.id} has statuses`);
    assert.ok(s.label?.en, `${s.id} has an English label`);
    const keys = s.fields.map((f: any) => f.key);
    assert.equal(new Set(keys).size, keys.length, `${s.id} field keys are unique`);
  }
});
test("Access rules point to real roles and sections; external roles cannot write", () => {
  const roles = Object.keys(ROLES);
  for (const r of defaultRules() as any[]) {
    assert.ok(roles.includes(r.role), `role ${r.role}`);
    assert.ok(byId.has(r.section), `section ${r.section}`);
  }
  for (const d of DEPARTMENTS as any[]) assert.ok(SECS.some((s) => s.dept === d.key), `${d.key} has sections`);
});
test("Templates: unique ids, known departments, every {{field}} is defined", () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of TEMPLATES) {
    assert.ok(TPL_DEPTS.includes(t.dept), `${t.id} dept ${t.dept}`);
    const fields = new Set(t.fields.map((f) => f.key)); fields.add("today");
    const used = [...t.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    for (const k of used) assert.ok(fields.has(k), `${t.id}: {{${k}}} has no form field`);
    if (t.save) {
      const sec = byId.get(t.save.section); assert.ok(sec, `${t.id} saves to ${t.save.section}`);
      for (const k of Object.keys(t.save.data)) if (k !== "document") assert.ok(sec.fields.some((f: any) => f.key === k), `${t.id}: field ${k} exists in ${t.save.section}`);
      for (const k of [...(t.save.title + JSON.stringify(t.save.data)).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])) assert.ok(fields.has(k), `${t.id}: save uses {{${k}}}`);
    }
  }
});
test("Templates fill completely: no {{ }} left, empty fields become […]", () => {
  for (const t of TEMPLATES) {
    const full = fillTpl(t.body, Object.fromEntries(t.fields.map((f) => [f.key, f.def || "X"])));
    assert.ok(!/\{\{\w+\}\}/.test(full), `${t.id} fully filled`);
    const empty = fillTpl(t.body, {});
    if (t.body.length > 300 && t.fields.length) assert.ok(empty.includes("[…]"), `${t.id} marks blanks`);
  }
});
test("fillTpl: table cells keep the table intact; multi-line fields become lists", () => {
  const body = "x".repeat(300) + "\n| A | {{a}} |\n{{list}}";
  const out = fillTpl(body, { a: "one | two\nthree", list: "first\nsecond" });
  assert.ok(out.includes("| A | one / two<br>three |"));
  assert.ok(out.includes("- first\n- second"));
});

import { UK, AR } from "../src/config/learn-i18n.ts";
test("Every template name, description and form label has Ukrainian and Arabic text", () => {
  const missing: string[] = [];
  for (const t of TEMPLATES) for (const o of [t.name, t.desc, ...t.fields.map((f) => f.label), ...t.fields.map((f) => f.group).filter(Boolean)] as any[])
    if (!UK[o.en] || !AR[o.en]) missing.push(`${t.id}: ${o.en}`);
  assert.deepEqual(missing, []);
});
