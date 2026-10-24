import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import en from "../src/config/guide/en.ts";
import ru from "../src/config/guide/ru.ts";
import uk from "../src/config/guide/uk.ts";
import ar from "../src/config/guide/ar.ts";
import { guideBlocks } from "../src/lib/guidemodel.ts";

const ALL = { en, ru, uk, ar };
test("the guide texts are complete in every language", () => {
  const keys = Object.keys(en.S).sort();
  for (const [l, T] of Object.entries(ALL)) {
    assert.deepEqual(Object.keys(T.S).sort(), keys, `labels in ${l}`);
    assert.equal(T.FLOW.length, en.FLOW.length, `flow in ${l}`); assert.equal(T.ROLES_START.length, en.ROLES_START.length, `roles in ${l}`);
    assert.deepEqual(Object.keys(T.ROLE_DESC).sort(), Object.keys(en.ROLE_DESC).sort(), `role texts in ${l}`);
    for (const k of ["ABOUT", "HOWTO", "UI", "RHYTHM", "RULES", "LAUNCH"] as const) assert.ok((T as any)[k].length > 200, `${k} in ${l}`);
    assert.equal(T.S.flow_boxes.split("|").length, 10); assert.equal(T.S.layers.split("|").length, 6);
    assert.equal(T.S.ph.split("|").length, 4); assert.equal(T.S.ui_zones.split("|").length, 4); assert.equal(T.S.appr_lbl.split("|").length, 4);
    for (const k of ["ui_bar", "ui_nav", "ui_rec"]) assert.equal(T.S[k].split("|").length, 6, `${k} in ${l}`);
    // the visual blocks parse the texts: part list, rhythm table, rules and launch steps
    assert.equal(T.HOWTO.split("\n").filter((x) => /^- \*\*[^*]+\*\* — /.test(x)).length, 8, `parts list in ${l}`);
    assert.equal(T.RULES.split("\n").filter((x) => /^- \*\*/.test(x)).length, 6, `rules in ${l}`);
    assert.ok(T.LAUNCH.split("\n").filter((x) => /^\d+\.\s/.test(x)).length >= 5, `launch steps in ${l}`);
  }
});

test("the PDFs match the app version (rebuild with scripts/guide/make.mjs after every release)", () => {
  const version = fs.readFileSync("src/lib/version.ts", "utf8").match(/APP_VERSION = "([^"]+)"/)![1];
  const man = JSON.parse(fs.readFileSync("guide/manifest.json", "utf8"));
  for (const l of ["en", "ru", "uk", "ar"]) {
    assert.equal(man.langs?.[l]?.version, version, `guide PDF (${l}) is for v${man.langs?.[l]?.version}, the app is v${version} — run node scripts/guide/make.mjs`);
    assert.ok(fs.existsSync(`guide/AGRON-Workspace-Guide-${l}.pdf`));
  }
});

test("the model builds every part from the sources", () => {
  const src: any = { hb: ["overview", "start", "records", "trouble", "newfeature"].map((id) => ({ id, title: { en: id }, body: { en: `**${id}** text` } })),
    help: { "sales.pipeline": { en: "Deals.\n- one\n- two" } }, glossary: { sales: [["RFQ", { en: "Request for quotation" }]] }, faq: [{ q: { en: "Q?" }, a: { en: "A." } }], dict: {},
    depts: [{ key: "sales", label: { en: "Sales" }, read: ["sales"], write: ["sales"] }], secs: [{ id: "sales.pipeline", dept: "sales", label: { en: "Deals pipeline" }, statuses: ["Lead", "Won"], fields: [{ key: "value", label: { en: "Value" } }] }],
    roles: { owner: { label: { en: "Owner" }, internal: true }, sales: { label: { en: "Sales" }, internal: true } }, approvals: {}, configs: ["C20 Base", "Sprinter"] };
  const b = guideBlocks("en", src, en as any, (s) => `<p>${s}</p>`);
  assert.equal(b.filter((x) => x.kind === "part").length, 7); assert.equal(b[b.length - 1].id, "app");
  assert.ok(b.some((x) => x.title === "newfeature"), "a new handbook chapter appears by itself");
  assert.ok(b.some((x) => x.html.includes("Deals pipeline") && x.html.includes('<span class="st">Lead</span>') && x.html.includes('<span class="st">Won</span>')));
  const flow = b.find((x) => x.html.includes('class="phases"'))!; assert.equal((flow.html.match(/class="fl"/g) || []).length, en.FLOW.length, "every step is in a phase");
  assert.ok(b.every((x) => x.icon), "every part and chapter has an icon");
});
