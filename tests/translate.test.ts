import { test } from "node:test";
import assert from "node:assert/strict";
import { localizeRec, translatable, trFields, trHash, trPending, trText, unlocalize } from "../src/lib/tr.ts";

const fields = [{ key: "notes", type: "long" }, { key: "client", type: "text" }, { key: "amount", type: "money" }, { key: "summary", type: "text" }];

test("only real words are translated, not codes, links or e-mails", () => {
  assert.equal(translatable("Встреча с клиентом"), true);
  assert.equal(translatable("EAR99"), false);
  assert.equal(translatable("SKU-12/4"), false);
  assert.equal(translatable("info@agron1.com"), false);
  assert.equal(translatable("https://agron1.com/x"), false);
  assert.equal(translatable("12 500"), false);
  assert.equal(translatable(42 as any), false);
});

test("names and amounts stay as written; text fields and the title are picked", () => {
  const t = trFields(fields, "Сделка с мариной", { notes: "Клиент просит скидку", client: "Skyline Marina", amount: 120000, summary: "Ждём ответа" });
  assert.deepEqual(Object.keys(t).sort(), ["notes", "summary", "title"]);
});

test("pending: new and changed texts only", () => {
  const texts = { title: "Сделка", notes: "Текст" };
  const tr = { h: { title: trHash("Сделка"), notes: trHash("Старый текст") }, t: { en: { title: "Deal", notes: "Old" }, ru: { title: "Сделка", notes: "Старый" }, uk: { title: "Угода", notes: "Старий" }, ar: { title: "صفقة", notes: "قديم" } } };
  assert.deepEqual(Object.keys(trPending(texts, tr as any)), ["notes"]);
  assert.deepEqual(Object.keys(trPending(texts, null)), ["title", "notes"]);
});

test("reader sees their language; a stale translation is never shown", () => {
  const data = { notes: "Клиент просит скидку", _tr: { h: { title: trHash("Сделка"), notes: trHash("Другой текст") }, s: { title: "ru" }, t: { en: { title: "Deal", notes: "Client asks for a discount" } } } };
  const r = localizeRec({ title: "Сделка", data }, "en")!;
  assert.equal(r.title, "Deal");
  assert.equal(r.data.notes, "Клиент просит скидку"); // translation is out of date → original
  assert.equal(r._src, "ru");
  assert.equal(localizeRec({ title: "Сделка", data }, "uk"), null);
  assert.equal(trText("Привет", { h: trHash("Привет"), t: { en: "Hello" } }, "en"), "Hello");
  assert.equal(trText("Привет!", { h: trHash("Привет"), t: { en: "Hello" } }, "en"), "Привет!");
});

test("saving keeps the original wording of texts the reader did not touch", () => {
  const o = { title: "Сделка", data: { notes: "Клиент просит скидку", summary: "Ждём", amount: 5, _tr: { h: {} } } };
  const l = { title: "Deal", data: { notes: "Client asks for a discount", summary: "Waiting", amount: 5, _tr: { h: {} } } };
  const back = unlocalize("Deal", { notes: "Client asks for a discount", summary: "Signed today", amount: 7, _tr: { h: {} } }, o, l);
  assert.equal(back.title, "Сделка");
  assert.equal(back.data.notes, "Клиент просит скидку");
  assert.equal(back.data.summary, "Signed today"); // the reader's own change stays
  assert.equal(back.data.amount, 7);
});
