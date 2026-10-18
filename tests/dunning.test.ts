import { test } from "node:test";
import assert from "node:assert/strict";
import { clientLang, dso, dunningLetter, stepFor } from "../src/lib/dunning.ts";

test("ladder steps", () => { assert.deepEqual([3, 7, 20, 21, 44, 45, 100].map(stepFor), [0, 1, 1, 2, 2, 3, 3]); });
test("letters in the client's language", () => {
  const v = { title: "INV-7", sum: "120,000 USD", due: "2026-10-01", late: 22, client: "Aurora" };
  assert.match(dunningLetter(2, "ru", v).subject, /Повторное напоминание — INV-7: просрочка 22/);
  assert.match(dunningLetter(3, "ar", v).body, /^السادة Aurora/);
  assert.match(dunningLetter(1, "en", v).body, /Payment reference: INV-7\./);
  const all = [{ id: "c", section: "sales.clients", title: "Aurora", data: { lang: "Українська" } }];
  assert.equal(clientLang({ data: { counterparty: "aurora " } }, all), "uk"); assert.equal(clientLang({ data: {} }, all), "en");
});
test("DSO", () => {
  const inv = [{ status: "Paid", data: { amount: 100, issued: "2026-09-01" } }, { status: "Sent", data: { amount: 50, issued: "2026-10-01" } }, { status: "Draft", data: { amount: 999, issued: "2026-10-01" } }];
  assert.equal(dso(inv, "2026-10-20", (x) => Number(x)), 30); assert.equal(dso([], "2026-10-20", Number), null);
});
