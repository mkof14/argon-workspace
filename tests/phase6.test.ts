// Phase 6 — pure parts: extraction proposals (pattern method and the evidence check for model answers), the
// Assistant's operations intents, the weekly OPERATIONS text, the configuration of the new sections and request
// forms, the job, the procurement role, the access defaults, and the Learning Center / FAQ in four languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isoDate, keepEvidenced, patternExtract, totalOf } from "../src/lib/extract.ts";
import { opsIntent, opsWeeklyText, REQUEST_FORM, REQUEST_TYPES, DASH } from "../src/lib/opsText.ts";
import { allSections, defaultRules, ROLES } from "../src/config/workspace.config.mjs";
import { JOBS } from "../src/lib/jobs.ts";
import { INTERNAL_ROLES } from "../src/lib/roles.ts";
import { HANDBOOK } from "../src/config/handbook.ts";
import { SEED_FAQ, HELP } from "../src/config/learn.ts";
import { UK, AR } from "../src/config/learn-i18n.ts";

test("extraction: dates and totals are read only as written", () => {
  assert.equal(isoDate("Valid until 2026-11-30"), "2026-11-30");
  assert.equal(isoDate("valid until 30/11/2026"), "2026-11-30", "day first, as in the UAE");
  assert.equal(isoDate("by 5 March 2027"), "2027-03-05");
  assert.equal(isoDate("next Tuesday"), null);
  assert.deepEqual(totalOf("Item A 100\nItem B 200\nGrand total: USD 12,500.00"), { amount: 12500, currency: "USD", quote: "Grand total: USD 12,500.00" });
  assert.equal(totalOf("Total AED 3,000")?.currency, "AED");
  assert.equal(totalOf("no amounts here"), null);
});

test("extraction: a quotation proposal carries the line every value came from; nothing is guessed", () => {
  const p = patternExtract("quotation", "Quote Q-77\nLead time: 3 weeks\nValid until: 2026-12-15\nTotal USD 9,800");
  assert.equal(p.length, 1); assert.equal(p[0].target, "operations.quotations");
  assert.equal(p[0].values.amount, 9800); assert.equal(p[0].values.lead_time_days, 21); assert.equal(p[0].values.valid_until, "2026-12-15");
  for (const k of ["amount", "lead_time_days", "valid_until"]) assert.ok(p[0].evidence[k], `${k} has its evidence`);
  assert.deepEqual(patternExtract("quotation", "Thank you for your enquiry."), []);
});

test("extraction: obligations need an obliging verb and a date or a period", () => {
  const t = "1. Definitions apply. 2. The Supplier shall deliver the monthly report each month. 3. The Buyer shall pay within 30 days. 4. Nice weather.";
  const p = patternExtract("obligation", t);
  assert.equal(p.length, 2); assert.equal(p[0].values.frequency, "Monthly"); assert.equal(p[0].target, "legal.contract_obligations");
});

test("model answers are kept only where the quoted evidence is in the document", () => {
  const text = "Grand total USD 4,200. Delivery in 10 days.";
  const ok = keepEvidenced({ kind: "quotation", target: "operations.quotations", values: { amount: 4200, lead_time_days: 10, valid_until: "2027-01-01" }, evidence: { amount: "Grand total USD 4,200", lead_time_days: "Delivery in 10 days", valid_until: "valid until January" } }, text);
  assert.deepEqual(Object.keys(ok!.values).sort(), ["amount", "lead_time_days"], "the invented validity is dropped");
  assert.equal(keepEvidenced({ kind: "invoice", target: "finance.payments", values: { amount: 1 }, evidence: { amount: "Total 1" } }, text), null);
});

test("Assistant: operations questions map to one allow-listed intent", () => {
  assert.deepEqual(opsIntent("What purchases need my approval?"), { intent: "my_approvals", arg: "operations.requests" });
  assert.equal(opsIntent("Какие закупки ждут моего согласования?")?.intent, "my_approvals");
  assert.deepEqual(opsIntent("Where is AGR-PR-2026-0042?"), { intent: "process", arg: "AGR-PR-2026-0042" });
  assert.equal(opsIntent("list late deliveries")?.intent, "deliveries_overdue");
  assert.equal(opsIntent("approved but not paid invoices")?.intent, "payments_unpaid");
  assert.equal(opsIntent("which contracts expire soon")?.intent, "contracts_expiring");
  assert.equal(opsIntent("budget of project Falcon")?.intent, "budget");
  assert.equal(opsIntent("what is the weather")?.intent, undefined);
});

test("weekly review: the OPERATIONS section is built only from the numbers given", () => {
  const w = { started: 3, completed: 2, rejected: 1, approvals_decided: 5, approvals_invalidated: 1, purchases_created: 2, receipts: 1, payments_recorded: { USD: 2500 }, issues_opened: 1, escalations: 0,
    now: { overdue_steps: 1, blocked: 0, overdue_deliveries: 2, waiting_external: 1, unpaid_approved: 1, obligations_overdue: 0 } };
  const en = opsWeeklyText(w, "en"); assert.match(en, /^OPERATIONS/); assert.match(en, /USD 2,500/); assert.match(en, /2 late deliveries/);
  assert.match(opsWeeklyText(w, "ru"), /^ОПЕРАЦИИ/); assert.match(opsWeeklyText(w, "ar"), /العمليات/); assert.equal(opsWeeklyText(null, "en"), "");
});

test("configuration: the new sections exist with statuses, labels in four languages and the fields the forms use", () => {
  const secs = allSections() as any[];
  const want = ["operations.requests", "operations.quotations", "operations.receipts", "finance.payments", "legal.contract_obligations", "company.issues", "company.travel", "company.requests", "company.parties"];
  for (const id of want) {
    const s = secs.find((x) => x.id === id); assert.ok(s, id);
    for (const l of ["en", "ru", "uk", "ar"]) assert.ok(s.label[l], `${id} label ${l}`);
    assert.ok(s.statuses.length >= 2); for (const f of s.fields) for (const l of ["en", "ru", "uk", "ar"]) assert.ok(f.label?.[l], `${id}.${f.key} label ${l}`);
  }
  const map: Record<string, string> = { purchase: "operations.requests", payment: "finance.payments", contract: "legal.contracts", change: "technical.changes", travel: "company.travel", general: "company.requests" };
  for (const [k, sec] of Object.entries(map)) {
    const s = secs.find((x) => x.id === sec); for (const f of REQUEST_FORM[k]) assert.ok(s.fields.some((x: any) => x.key === f), `${k} form field ${f} exists in ${sec}`);
    assert.ok(REQUEST_TYPES[k]);
  }
  // process-controlled values are read-only in forms
  const pr = secs.find((x) => x.id === "operations.requests");
  for (const k of ["number", "selected_amount", "approved_amount", "purchase_ref"]) assert.equal(pr.fields.find((f: any) => f.key === k)?.auto, true, k);
  assert.ok(secs.find((x) => x.id === "legal.contracts").statuses.includes("Signature")); assert.ok(secs.find((x) => x.id === "technical.changes").statuses.includes("Impact review"));
  assert.ok(secs.find((x) => x.id === "operations.procurement").statuses.includes("Partially delivered"));
  // legacy statuses are kept (records from v18–v22 stay valid)
  assert.ok(secs.find((x) => x.id === "legal.contracts").statuses.includes("Counsel review")); assert.ok(secs.find((x) => x.id === "operations.vendors").statuses.includes("Blocked"));
  assert.equal(DASH.length, 8);
});

test("procurement role, access defaults and the workflow job", () => {
  assert.ok((ROLES as any).procurement.internal); assert.ok((INTERNAL_ROLES as readonly string[]).includes("procurement"));
  const rules = defaultRules();
  const has = (s: string, r: string, w?: boolean) => rules.some((x: any) => x.section === s && x.role === r && (w === undefined || x.can_write === w));
  assert.ok(has("operations.quotations", "procurement", true)); assert.ok(!has("operations.quotations", "sales"));
  assert.ok(has("legal.contract_obligations", "legal", true)); assert.ok(!has("legal.contract_obligations", "hr"));
  assert.ok(has("finance.payments", "engineering", true), "everyone may raise a payment request (seeing it is decided per record)");
  assert.ok(!rules.some((x: any) => ["partner", "vendor", "investor"].includes(x.role) && ["operations.requests", "finance.payments", "company.travel", "company.requests"].includes(x.section)));
  const j = JOBS.find((x) => x.id === "workflow"); assert.ok(j); assert.equal(j!.every, "15m");
});

test("Learning Center and FAQ: the processes chapter and every new FAQ and section help in EN/RU/UK/AR", () => {
  const ch = (HANDBOOK as any[]).find((c) => c.id === "processes"); assert.ok(ch);
  for (const l of ["en", "ru", "uk", "ar"]) { assert.ok(ch.title[l]); assert.ok(ch.body[l].length > 2000, `chapter ${l}`); }
  assert.match(ch.body.en, /never says which is best/); assert.match(ch.body.en, /moves no money/);
  const faq = (SEED_FAQ as any[]).filter((f) => /purchase|approval was cancelled|pay invoices|quotation is best|damaged|read from a document|change a process/i.test(f.q.en));
  assert.ok(faq.length >= 8);
  for (const f of faq) { assert.ok(f.q.ru && f.a.ru); assert.ok(UK[f.q.en] && UK[f.a.en], `UK ${f.q.en}`); assert.ok(AR[f.q.en] && AR[f.a.en], `AR ${f.q.en}`); }
  for (const id of ["operations.requests", "operations.quotations", "operations.receipts", "finance.payments", "legal.contract_obligations", "company.issues", "company.travel", "company.requests", "company.parties"]) {
    const h = (HELP as any)[id]; assert.ok(h?.en && h?.ru, id); assert.ok(UK[h.en] && AR[h.en], `help ${id} uk/ar`);
  }
});
