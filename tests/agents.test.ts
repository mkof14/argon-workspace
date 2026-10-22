import { clientLang, dunningLetter, stepFor as dunStep } from "../src/lib/dunning.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientEmail, days, financeFindings, hrFindings, legalFindings, marketingFindings, securityFindings, technicalFindings, quarter, addMonths, operationsFindings, salesFindings, stepFor } from "../src/lib/deptAgents.ts";

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
  const f = financeFindings(all as any, T, { ...th, dun: { stepFor: dunStep, langOf: clientLang, letter: dunningLetter } } as any);
  const over = f.find((x) => x.key === "fin-over|I1")!; assert.deepEqual(over.action, { type: "set", field: "status", value: "Overdue" });
  const rem = f.find((x) => x.key.startsWith("fin-remind|I1|"))!; assert.match((rem.action as any).subject, /^Payment reminder|^Second reminder/); assert.equal(rem.action?.type, "email"); assert.equal((rem.action as any).to, "jane@aurora.ae");
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

test("operations: export stop, delivery → installation, commissioned → delivered (v25 lifecycle) + fleet, service ticket, critical ticket", () => {
  const all = [
    r("B1", "operations.builds", "Shipping", { export_check: "In progress" }),
    r("B2", "operations.builds", "Shipping", { export_check: "Cleared", site: "Marina X", owner: "Ann" }),
    r("S2", "operations.logistics", "Delivered", { build_ref: "B2" }),
    r("B3", "operations.builds", "Testing", { export_check: "Cleared", client: "Aurora" }),
    r("I3", "operations.installation", "Commissioned", { build_ref: "B3" }),
    r("U1", "operations.fleet", "Active", { next_service: "2026-10-20" }),
    r("K1", "operations.support", "New", { severity: "Critical" }, { created_at: "2026-10-13T10:00:00Z" }),
  ];
  const f = operationsFindings(all as any, T, th);
  assert.equal(f.find((x) => x.key === "ops-export|B1|Shipping")!.level, "bad");
  assert.equal((f.find((x) => x.key === "ops-inst|B2")!.action as any).link, "build_ref");
  assert.deepEqual(f.find((x) => x.key === "ops-done|B3")!.action, { type: "set", field: "status", value: "Delivered" });
  const fl = f.find((x) => x.key === "ops-fleet|B3")!.action as any; assert.equal(fl.fields.warranty_end, "2026-10-15".replace("2026", "2027")); assert.equal(fl.link, "build_ref");
  assert.equal((f.find((x) => x.key.startsWith("ops-svc|U1"))!.action as any).link, "unit_ref");
  assert.equal(f.find((x) => x.key === "ops-crit|K1")!.level, "bad");
});

test("hr: onboarding, leaver offboarding + access removal, probation task, work authorization, I-9", () => {
  const all = [
    r("P1", "hr.team", "Onboarding", { start: "2026-10-20" }, { title: "Ann Lee" }),
    r("P2", "hr.team", "Left", {}, { title: "Bob Ray" }),
    r("A2", "hr.assets", "Issued", { person: "Bob Ray", item: "Laptop" }),
    r("P3", "hr.team", "Active", { probation: "2026-10-25", manager: "Kate", expires: "2026-11-01", location: "United States", type: "Employee", start: "2026-10-01", ciiaa: true }, { title: "Cy Dee" }),
  ];
  const f = hrFindings(all as any, T, th);
  assert.equal((f.find((x) => x.key === "hr-onb|P1")!.action as any).fields.due, "2026-10-25");
  assert.equal((f.find((x) => x.key === "hr-revoke|P2")!.action as any).section, "security.access");
  assert.ok(f.some((x) => x.key === "hr-off|P2") && f.some((x) => x.key === "hr-assets|P2"));
  assert.equal((f.find((x) => x.key === "hr-prob|P3")!.action as any).fields.assignee, "{manager}");
  assert.equal(f.find((x) => x.key.startsWith("hr-auth|P3"))!.key, "hr-auth|P3|d30");
  assert.equal(f.find((x) => x.key === "hr-i9|P3")!.level, "bad");
  assert.ok(!f.some((x) => x.key === "hr-ciiaa|P3"));
});

test("legal: renewal windows, recurring obligations, won deals without contract, end-user clause", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  const all = [
    r("LC", "legal.licences", "Granted", { expires: "2026-12-01" }),
    r("OB", "legal.obligations", "Done", { due: "2026-09-30", frequency: "Quarterly", area: "Tax" }, { title: "Sales tax return" }),
    r("D1", "sales.pipeline", "Won", {}),
    r("C1", "legal.contracts", "Negotiation", { type: "Sale", deal_ref: "D1" }),
    r("PA", "legal.authority", "Active", { expires: "2026-10-20" }),
  ];
  const f = legalFindings(all as any, T, th);
  const lc = f.find((x) => x.key.startsWith("leg-date|LC"))!; assert.equal(lc.key, "leg-date|LC|d60"); assert.deepEqual(lc.action, { type: "set", field: "status", value: "Renewal due" });
  const pa = f.find((x) => x.key.startsWith("leg-date|PA"))!; assert.equal(pa.level, "bad"); assert.deepEqual(pa.action, { type: "set", field: "status", value: "Expiring" });
  assert.equal((f.find((x) => x.key.startsWith("leg-next|OB"))!.action as any).fields.due, "2026-12-30");
  assert.match(f.find((x) => x.key === "leg-nocontract|D1")!.text, /no signed contract yet/);
  assert.ok(f.some((x) => x.key === "leg-euc|C1"));
  const done = [...all, r("OB2", "legal.obligations", "Upcoming", { due: "2026-12-30" }, { title: "Sales tax return" })];
  assert.ok(!legalFindings(done as any, T, th).some((x) => x.key.startsWith("leg-next")));
});

test("marketing: release check, calendar, interview prep, events, campaigns, account 2FA", () => {
  const all = [
    r("CH", "marketing.channels", "Active", { platform: "LinkedIn", two_fa: "No", as_of: "2026-10-10" }),
    r("S1", "marketing.social", "Approved", { publish: "2026-10-14", check: "Passed (AI check)" }),
    r("S2", "marketing.social", "Review", { publish: "2026-10-30" }),
    r("P1", "marketing.press", "Writing", { deadline: "2026-10-16", check: "Legal review needed" }),
    r("I1", "marketing.interviews", "Confirmed", { session: "2026-10-17" }),
    r("E1", "marketing.events", "Booked", { starts: "2026-11-01" }),
    r("C1", "marketing.campaigns", "Running", { end_date: "2026-10-10", budget: 1000, spent: 1200 }),
  ];
  const f = marketingFindings(all as any, T, th); const k = f.map((x) => x.key.split("|")[0]);
  for (const x of ["mkt-2fa", "mkt-late", "mkt-nock", "mkt-legal", "mkt-press", "mkt-prep", "mkt-evprep", "mkt-camp", "mkt-over", "mkt-empty"]) assert.ok(k.includes(x), x);
  assert.equal(f.find((x) => x.key.startsWith("mkt-2fa"))!.level, "bad");
  assert.deepEqual(f.find((x) => x.key.startsWith("mkt-camp"))!.action, { type: "set", field: "status", value: "Completed" });
  assert.ok(!k.includes("mkt-num"));
});

test("technical: failed test → bug once, critical bug, certification, IT renewal, equipment without matrix", () => {
  const all = [
    r("T1", "technical.testing", "Failed", { type: "Sea trial", config: "C40 HQ", owner: "Ivan" }),
    r("T2", "technical.testing", "Failed", {}),
    r("SW", "technical.software", "Backlog", { type: "Bug" }, { title: "Fix failed test — T2" }),
    r("B1", "technical.software", "In progress", { type: "Bug", priority: "Critical" }, { created_at: "2026-10-13T10:00:00Z" }),
    r("C1", "technical.certification", "In review", { due: "2026-10-20", scheme: "FCC" }),
    r("IT", "technical.it", "Active", { renewal: "2026-11-05", vendor: "Google" }),
    r("EQ", "technical.equipment", "Selected", {}),
  ];
  const f = technicalFindings(all as any, T, th);
  assert.equal((f.find((x) => x.key === "tec-fail|T1")!.action as any).fields.type, "Bug");
  assert.ok(!f.some((x) => x.key === "tec-fail|T2"));
  assert.equal(f.find((x) => x.key === "tec-crit|B1")!.level, "bad");
  assert.equal(f.find((x) => x.key.startsWith("tec-cert|C1"))!.key, "tec-cert|C1|d7");
  assert.deepEqual(f.find((x) => x.key.startsWith("tec-it|IT"))!.action, { type: "set", field: "status", value: "Renewal due" });
  assert.ok(f.some((x) => x.key === "tec-matrix|EQ"));
});

test("security: incidents, quarterly access review once, overdue access removal, cyber, data classification", () => {
  assert.equal(quarter("2026-10-15"), "2026-Q4");
  const all = [
    r("IN", "security.incidents", "Reported", { severity: "High" }, { created_at: "2026-10-13T10:00:00Z" }),
    r("AC", "security.access", "Scheduled", { due: "2026-10-14" }, { title: "Revoke access — Bob Ray" }),
    r("CY", "security.cyber", "Open", { risk: "High" }),
    r("TD", "security.tcp", "EAR controlled", {}),
  ];
  const f = securityFindings(all as any, T, th);
  assert.equal(f.find((x) => x.key === "sec-inc|IN")!.level, "bad");
  assert.equal((f.find((x) => x.key === "sec-qar|2026-Q4")!.action as any).title, "Quarterly access review — 2026-Q4");
  assert.equal(f.find((x) => x.key === "sec-acc|AC")!.level, "bad");
  assert.ok(f.some((x) => x.key === "sec-cyber|CY") && f.some((x) => x.key === "sec-tcpacc|TD"));
  const again = securityFindings([...all, r("Q", "security.access", "Scheduled", {}, { title: "Quarterly access review — 2026-Q4" })] as any, T, th);
  assert.ok(!again.some((x) => x.key.startsWith("sec-qar")));
});

test("every agent notice type has Russian, Ukrainian and Arabic text", async () => {
  const { readFileSync } = await import("node:fs");
  const { AGENT_TEXT, agentText } = await import("../src/lib/agentText.ts");
  const src = readFileSync(new URL("../src/lib/deptAgents.ts", import.meta.url), "utf8");
  const kinds = [...new Set([...src.matchAll(/key: `([a-z0-9-]+)\|/g)].map((m) => m[1]))];
  assert.ok(kinds.length > 100);
  for (const k of kinds) { assert.ok(AGENT_TEXT[k], k); assert.ok(AGENT_TEXT[k].every((x: string) => x.length > 10), k); }
  const f = { key: "fin-over|I1", text: "EN", rec: { title: "INV-7", status: "Sent", data: { amount: 120000, currency: "USD", due: "2026-10-01" } } };
  assert.equal(agentText(f, "ru"), "Счёт «INV-7» (120,000 USD) просрочен, срок был 2026-10-01.");
  assert.equal(agentText(f, "en"), "EN");
  assert.equal(agentText({ ...f, rec: { ...f.rec, data: {} } }, "uk"), "Рахунок «INV-7» прострочено, строк був.");
});

test("email intake: skips newsletters, auto-replies and own mail; keeps documents; strips quoted history", async () => {
  const { skipReason, keepFiles, cleanBody } = await import("../src/lib/mailRules.ts");
  const own = ["info@agron1.com"];
  assert.equal(skipReason({ subject: "Quote for C40" }, "buyer@port.ae", own), null);
  assert.equal(skipReason({ subject: "News", "list-unsubscribe": "<x>" }, "news@media.com", own), "newsletter or mailing list");
  assert.equal(skipReason({ subject: "Out of office" }, "a@b.com", own), "automatic reply");
  assert.equal(skipReason({ subject: "x" }, "no-reply@bank.com", own), "automatic sender");
  assert.equal(skipReason({ subject: "Digest", "x-agron-workspace": "1" }, "info@agron1.com", own), "sent by Workspace");
  assert.equal(skipReason({ subject: "Fwd: invoice" }, "info@agron1.com", own), null);
  const files = keepFiles([{ filename: "Invoice 12.pdf", contentType: "application/pdf", size: 1000 }, { filename: "image001.png", contentType: "image/png", size: 500, related: true }, { filename: "big.pdf", contentType: "application/pdf", size: 20e6 }, { filename: "x.exe", contentType: "application/x-msdownload", size: 10 }]);
  assert.deepEqual(files.map((f) => f.filename), ["Invoice 12.pdf"]);
  assert.equal(cleanBody("Hello,\nplease see attached.\n\nOn Mon, Oct 12, 2026 at 9:00 John wrote:\n> old"), "Hello,\nplease see attached.");
});

test("deal email: client card, then lead, then notes", async () => {
  const { dealEmail } = await import("../src/lib/deptAgents.ts");
  const all = [r("C1", "sales.clients", "Active", { contact: "Ann <ann@port.ae>" }), r("L1", "marketing.leads", "New", { email: "lead@x.com" })];
  assert.equal(dealEmail(r("D", "sales.pipeline", "Proposal", { client_ref: "C1", lead_ref: "L1" }) as any, all as any), "ann@port.ae");
  assert.equal(dealEmail(r("D", "sales.pipeline", "Proposal", { lead_ref: "L1" }) as any, all as any), "lead@x.com");
  assert.equal(dealEmail(r("D", "sales.pipeline", "Proposal", { notes: "write to bob@yacht.mc" }) as any, all as any), "bob@yacht.mc");
});

test("agent notices fill missing values with a word, never empty quotes", async () => {
  const { agentText } = await import("../src/lib/agentText.ts");
  const f = { key: "mkt-2fa|C", text: "EN", rec: { title: "AGRON on LinkedIn", status: "Active", data: { platform: "LinkedIn" } } };
  assert.equal(agentText(f, "ru"), "У аккаунта «AGRON on LinkedIn» (LinkedIn) двухэтапная защита: не указано — включите её.");
  assert.match(agentText({ key: "mkt-num|C", text: "", rec: f.rec }, "uk"), /оновлювали: ніколи/);
});
