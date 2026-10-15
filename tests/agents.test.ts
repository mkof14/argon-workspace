import { test } from "node:test";
import assert from "node:assert/strict";
import { clientEmail, days, financeFindings, salesFindings, stepFor } from "../src/lib/deptAgents.ts";

const T = "2026-10-15";
const th = { remind_before: 3, escalate_after: 3, stalled_deal: 14 };
const r = (id: string, section: string, status: string, data: any = {}, extra: any = {}) => ({ id, section, title: id, status, data, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", ...extra });
const keys = (f: any[]) => f.map((x) => x.key.split("|")[0]);

test("date helpers", () => {
  assert.equal(days("2026-10-15", "2026-10-20"), 5);
  assert.equal(stepFor(25, [30, 7]), "d30");
  assert.equal(stepFor(5, [30, 7]), "d7");
  assert.equal(stepFor(40, [30, 7]), null);
  assert.equal(stepFor(-1, [30, 7]), "late");
});

test("finance: overdue invoices, client reminder with the email from the client card", () => {
  const all = [
    r("C1", "sales.clients", "Active", { contact: "Jane Roe, jane@aurora.ae, +971" }),
    r("D1", "sales.pipeline", "Won", { client_ref: "C1" }),
    r("I1", "finance.invoices", "Sent", { direction: "Receivable", amount: 120000, currency: "USD", due: "2026-10-01", deal_ref: "D1" }),
    r("I2", "finance.invoices", "Paid", { direction: "Receivable", due: "2026-09-01" }),
    r("I3", "finance.invoices", "Due", { direction: "Payable", amount: 5000, due: "2026-10-17" }),
  ];
  assert.equal(clientEmail(all[2] as any, all as any), "jane@aurora.ae");
  const f = financeFindings(all as any, T, th);
  const over = f.find((x) => x.key === "fin-over|I1")!; assert.deepEqual(over.action, { type: "set", field: "status", value: "Overdue" });
  const rem = f.find((x) => x.key === "fin-remind|I1")!; assert.equal(rem.action?.type, "email"); assert.equal((rem.action as any).to, "jane@aurora.ae");
  assert.ok(f.some((x) => x.key === "fin-pay|I3"));
  assert.ok(!f.some((x) => x.rec.id === "I2"));
});

test("finance: expenses, budget, tax, insurance, runway", () => {
  const all = [
    r("E1", "finance.expenses", "Submitted", { amount: 900 }),
    r("B1", "finance.budget", "Approved", { planned: 10000, actual: 12500 }),
    r("X1", "finance.tax", "Upcoming", { due: "2026-10-25" }),
    r("N1", "finance.insurance", "Active", { renewal: "2026-11-20", type: "Cyber" }),
    r("M1", "finance.metrics", null as any, { period: "2026-09", cash: 400000, burn: 100000 }, { title: "2026-09" }),
  ];
  const f = financeFindings(all as any, T, th);
  assert.deepEqual(keys(f).sort(), ["fin-budget", "fin-exp", "fin-ins", "fin-runway", "fin-tax"].sort());
  assert.equal(f.find((x) => x.key.startsWith("fin-budget"))!.level, "bad");
  assert.equal(f.find((x) => x.key.startsWith("fin-tax"))!.key, "fin-tax|X1|d14");
  assert.deepEqual(f.find((x) => x.key.startsWith("fin-ins"))!.action, { type: "set", field: "status", value: "Renewal due" });
  assert.match(f.find((x) => x.key.startsWith("fin-runway"))!.text, /4\.0 months/);
});

test("sales: stalled deals get one follow-up task, qualified leads become deals, accepted proposals move the deal", () => {
  const old = { updated_at: "2026-09-01T10:00:00Z", created_at: "2026-09-01T10:00:00Z" };
  const all = [
    r("D1", "sales.pipeline", "Qualified", { owner: "Ann" }, old),
    r("D2", "sales.pipeline", "Proposal", { owner: "Bob" }, { ...old, title: "D2" }),
    r("T1", "company.tasks", "Open", {}, { title: "Follow up — D2" }),
    r("L1", "marketing.leads", "Qualified", { country: "UAE" }),
    r("L2", "marketing.leads", "New", {}, { created_at: "2026-10-10T10:00:00Z" }),
    r("P1", "sales.proposals", "Accepted", { deal_ref: "D3" }),
    r("D3", "sales.pipeline", "Proposal", {}),
    r("P2", "sales.proposals", "Sent", { valid_until: "2026-10-18" }),
    r("A1", "sales.activities", "Done", { next_step: "Send the C40 spec", client: "Aurora" }, { updated_at: "2026-10-14T10:00:00Z" }),
    r("W1", "sales.pipeline", "Won", { value: 0 }),
  ];
  const f = salesFindings(all as any, T, th);
  const st1 = f.find((x) => x.key === "sal-stall|D1")!; assert.equal(st1.action?.type, "create"); assert.equal((st1.action as any).fields.due, "2026-10-17");
  assert.equal(f.find((x) => x.key === "sal-stall|D2")!.action, undefined); // task already open
  const deal = f.find((x) => x.key === "sal-todeal|L1")!; assert.equal((deal.action as any).link, "lead_ref");
  assert.ok(f.some((x) => x.key === "sal-lead|L2"));
  assert.deepEqual(f.find((x) => x.key === "sal-acc|P1")!.action, { type: "set", field: "status", value: "Negotiation" });
  assert.ok(f.some((x) => x.key === "sal-valid|P2"));
  assert.match((f.find((x) => x.key === "sal-next|A1")!.action as any).title, /^Next step: Send the C40 spec — Aurora$/);
  assert.ok(f.some((x) => x.key === "sal-noval|W1"));
});
