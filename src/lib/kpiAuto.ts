// "Collect the month": monthly KPIs counted from Workspace records. Only what the records can tell is filled;
// numbers that live outside Workspace (cash in the bank, phishing tests, deploys) stay for a person to enter.
import type { Rec } from "./store";

export type Auto = { values: Record<string, number>; how: Record<string, string> };
const n = (v: any) => Number(v) || 0;
const inM = (d: any, p: string) => !!d && String(d).slice(0, 7) === p;
const usdOnly = (r: Rec) => !r.data?.currency || r.data.currency === "USD";
const endOf = (p: string) => { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export function collectMonth(dept: string, all: Rec[], p: string): Auto {
  const of = (s: string) => all.filter((r) => r.section === s);
  const v: Record<string, number> = {}; const how: Record<string, string> = {};
  const put = (k: string, x: number, why: string) => { v[k] = Math.round(x * 100) / 100; how[k] = why; };
  // Status reached in the month: the record changed in that month and now has the status
  const reached = (s: string, st: string[]) => of(s).filter((r) => st.includes(r.status || "") && inM(r.updated_at, p));

  if (dept === "security") {
    const scr = of("security.screening").filter((r) => inM(r.data?.date || r.created_at, p));
    put("screenings", scr.length, "Restricted-party screening records dated this month");
    put("flagged", scr.filter((r) => ["Flagged", "Escalated"].includes(r.status || "")).length, "…of them Flagged or Escalated");
    put("incidents", of("security.incidents").filter((r) => inM(r.data?.date || r.created_at, p)).length, "Incidents dated this month");
    put("access_reviews", reached("security.access", ["Done"]).length, "Access reviews marked Done this month");
  }
  if (dept === "finance") {
    put("expenses", of("finance.expenses").filter((r) => usdOnly(r) && r.status !== "Rejected" && inM(r.data?.date || r.created_at, p)).reduce((a, r) => a + n(r.data?.amount), 0), "Expenses this month, USD, not rejected");
    put("revenue", reached("finance.invoices", ["Paid"]).filter((r) => usdOnly(r) && r.data?.direction === "Receivable").reduce((a, r) => a + n(r.data?.amount), 0), "Receivable invoices paid this month, USD");
    const open = of("finance.invoices").filter((r) => usdOnly(r) && !["Paid", "Draft"].includes(r.status || ""));
    put("receivables", open.filter((r) => r.data?.direction === "Receivable").reduce((a, r) => a + n(r.data?.amount), 0), "Open receivable invoices now, USD");
    put("payables", open.filter((r) => r.data?.direction === "Payable").reduce((a, r) => a + n(r.data?.amount), 0), "Open payable invoices now, USD");
    put("invoices_overdue", open.filter((r) => r.data?.due && r.data.due < endOf(p)).length, "Open invoices past due at month end");
    const cf = of("finance.cashflow").find((r) => r.status === "Actual" && (r.data?.month === p || String(r.title).includes(p)));
    if (cf) put("burn", n(cf.data?.outflow) - n(cf.data?.inflow), "Cash flow Actual: outflow − inflow");
  }
  if (dept === "sales") {
    put("new_leads", of("marketing.leads").filter((r) => inM(r.created_at, p) && r.status !== "Disqualified").length + of("sales.pipeline").filter((r) => inM(r.created_at, p)).length, "New leads and new deals this month");
    put("meetings", of("sales.activities").filter((r) => inM(r.data?.date, p) && r.status === "Done").length, "Activities done this month");
    const sent = of("sales.proposals").filter((r) => ["Sent", "Accepted", "Rejected"].includes(r.status || "") && inM(r.data?.date || r.updated_at, p));
    put("proposals_sent", sent.length, "Proposals sent this month"); put("proposals_value", sent.filter(usdOnly).reduce((a, r) => a + n(r.data?.value), 0), "…their value, USD");
    const won = reached("sales.pipeline", ["Won"]); put("won_deals", won.length, "Deals moved to Won this month"); put("won_value", won.filter(usdOnly).reduce((a, r) => a + n(r.data?.value), 0), "…their value, USD");
    put("lost_deals", reached("sales.pipeline", ["Lost"]).length, "Deals moved to Lost this month");
    put("pipeline_value", of("sales.pipeline").filter((r) => !["Won", "Lost"].includes(r.status || "") && usdOnly(r)).reduce((a, r) => a + n(r.data?.value), 0), "Open pipeline now, USD");
  }
  if (dept === "operations") {
    const done = reached("operations.builds", ["Installed", "Delivered"]);
    put("builds_completed", done.length, "Builds moved to Installed this month");
    if (done.length) put("on_time_pct", (done.filter((r) => !r.data?.due || String(r.updated_at).slice(0, 10) <= r.data.due).length / done.length) * 100, "…finished by their due date");
    put("shipments", of("operations.logistics").filter((r) => ["In transit", "Customs", "Delivered"].includes(r.status || "") && inM(r.updated_at, p)).length, "Shipments moving or delivered this month");
    put("installs", reached("operations.installation", ["Commissioned"]).length, "Installations commissioned this month");
    put("open_tickets", of("operations.support").filter((r) => r.status !== "Resolved").length, "Support tickets open now");
    const solved = reached("operations.support", ["Resolved"]);
    if (solved.length) put("resolution_days", solved.reduce((a, r) => a + (Date.parse(r.updated_at || "") - Date.parse(r.created_at || "")) / 864e5, 0) / solved.length, "Average days from new to resolved");
    put("ncr_open", of("operations.quality").filter((r) => ["Non-conformance", "Corrective action"].includes(r.status || "")).length, "Open non-conformances now");
    put("po_value", of("operations.procurement").filter((r) => usdOnly(r) && ["Approved", "Ordered", "Received"].includes(r.status || "") && inM(r.created_at, p)).reduce((a, r) => a + n(r.data?.amount), 0), "Purchase orders created this month, USD");
  }
  if (dept === "hr") {
    const team = of("hr.team");
    put("headcount", team.filter((r) => ["Active", "On leave"].includes(r.status || "")).length, "People Active or On leave now");
    put("hires", team.filter((r) => inM(r.data?.start, p)).length, "Start date this month");
    put("leavers", reached("hr.team", ["Left"]).length, "Marked Left this month");
    put("open_positions", of("hr.hiring").filter((r) => ["Open", "Interviewing", "Offer"].includes(r.status || "")).length, "Open, interviewing or offer now");
    put("reviews_done", reached("hr.reviews", ["Done"]).length, "Reviews marked Done this month");
  }
  if (dept === "legal") {
    put("contracts_signed", reached("legal.contracts", ["Signed"]).length, "Contracts moved to Signed this month");
    put("open_matters", of("legal.issues").filter((r) => r.status !== "Resolved").length + of("legal.requests").filter((r) => !["Answered", "Closed"].includes(r.status || "")).length, "Open issues and requests now");
    const ans = reached("legal.requests", ["Answered", "Closed"]);
    put("requests_answered", ans.length, "Requests answered this month");
    if (ans.length) put("turnaround_days", ans.reduce((a, r) => a + (Date.parse(r.updated_at || "") - Date.parse(r.created_at || "")) / 864e5, 0) / ans.length, "Average days from request to answer");
    const today = Date.now(), limit = today + 60 * 864e5;
    put("filings_due", all.filter((r) => r.section.startsWith("legal.") && r.section !== "legal.matrix" && !/^(signed|answered|closed|resolved|filed|registered|done|expired)$/i.test(r.status || "") && ["due", "deadline", "expires", "renewal", "valid_until", "next_review"].some((k) => { const t = Date.parse(String(r.data?.[k] || "")); return t >= today - 864e5 && t <= limit; })).length, "Open legal items with a date in the next 60 days");
    put("matrix_cleared", of("legal.matrix").filter((r) => r.status === "Counsel approved").length, "Equipment items approved by counsel");
  }
  if (dept === "technical") {
    put("open_bugs", of("technical.software").filter((r) => r.data?.type === "Bug" && r.status !== "Done").length, "Open software bugs now");
    put("closed_tasks", reached("technical.software", ["Done"]).length, "Software items moved to Done this month");
    const tests = of("technical.testing").filter((r) => inM(r.data?.date, p));
    put("tests_passed", tests.filter((r) => r.status === "Passed").length, "Tests dated this month: passed");
    put("tests_failed", tests.filter((r) => r.status === "Failed").length, "…failed");
    put("incidents", of("security.incidents").filter((r) => inM(r.data?.date || r.created_at, p)).length, "Incidents dated this month");
    const sys = of("technical.systems").filter((r) => n(r.data?.latency));
    if (sys.length) put("response_ms", sys.reduce((a, r) => a + n(r.data.latency), 0) / sys.length, "Average response of monitored systems (last check)");
  }
  return { values: v, how };
}
