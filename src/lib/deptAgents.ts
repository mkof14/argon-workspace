// Department agents: what each department's agent notices and what it proposes.
// Pure functions over records (no I/O, no local imports), so the rules are tested directly; the server executes the result.
import type { Action } from "./automation";

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any>; controlled?: boolean; created_at?: string; updated_at?: string };
export type Th = { remind_before: number; escalate_after: number; stalled_deal: number };
/**
 * One thing an agent noticed.
 * who: "owner" (the person named in the record), "role:<role>" or "leads"; key: raised once, then again every `repeat` days while still true.
 * action: an optional change (created / set / email) that runs or waits for approval according to the agent's mode.
 */
export type Finding = { rec: R; level: "info" | "warn" | "bad"; text: string; who: string[]; key: string; repeat?: number; action?: Action; why?: string };

export const addDays = (d: string, n: number) => { const t = new Date(String(d).slice(0, 10) + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const days = (from: string, to: string) => Math.round((Date.parse(String(to).slice(0, 10) + "T12:00:00Z") - Date.parse(String(from).slice(0, 10) + "T12:00:00Z")) / 864e5);
const isDate = (v: any) => /^\d{4}-\d{2}-\d{2}/.test(String(v || ""));
const age = (r: R, today: string) => days(String(r.updated_at || r.created_at || today), today);
const created = (r: R, today: string) => days(String(r.created_at || today), today);
export const emailIn = (s: any) => (String(s || "").match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [""])[0];
const money = (n: any, cur?: string) => `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${cur || "USD"}`;
const of = (all: R[], s: string) => all.filter((r) => r.section === s);
/** Warning steps for a coming date: one notice at each step (e.g. 30, 7, 0 days before) and when it passes. */
export function stepFor(d: number, steps: number[]): string | null {
  if (d < 0) return "late";
  const s = [...steps].sort((a, b) => a - b).find((x) => d <= x);
  return s === undefined ? null : `d${s}`;
}

/* ---------------- Finance ---------------- */
/** Finds the client's email for an invoice: invoice → deal → client card, or a client card with the counterparty's name. */
export function clientEmail(inv: R, all: R[]) {
  const deal = all.find((r) => r.id === inv.data?.deal_ref);
  const client = all.find((r) => r.section === "sales.clients" && (r.id === deal?.data?.client_ref || (inv.data?.counterparty && r.title.trim().toLowerCase() === String(inv.data.counterparty).trim().toLowerCase())));
  const lead = all.find((r) => r.id === deal?.data?.lead_ref);
  return emailIn(client?.data?.contact) || emailIn(lead?.data?.email) || "";
}

export function financeFindings(all: R[], today: string, th: Th): Finding[] {
  const out: Finding[] = [];
  // Invoices: mark overdue, remind the client (after approval), warn about payables
  for (const r of of(all, "finance.invoices")) {
    const due = r.data?.due; if (!isDate(due) || ["Paid", "Draft"].includes(r.status || "")) continue;
    const late = days(due, today); const sum = money(r.data?.amount, r.data?.currency); const recv = r.data?.direction !== "Payable";
    if (late > 0 && r.status !== "Overdue") out.push({ rec: r, level: "warn", who: ["role:finance"], key: `fin-over|${r.id}`, text: `Invoice “${r.title}” (${sum}) is overdue since ${due}.`, action: { type: "set", field: "status", value: "Overdue" }, why: "Due date passed" });
    if (recv && late >= 7) {
      const to = clientEmail(r, all);
      out.push({ rec: r, level: late >= 30 ? "bad" : "warn", who: late >= 30 ? ["role:finance", "leads"] : ["role:finance"], key: `fin-remind|${r.id}`, repeat: 14,
        text: `Client has not paid “${r.title}” (${sum}) for ${late} days.${to ? " A polite reminder email is prepared for approval." : " No client email found — add it to the client card."}`,
        action: to ? { type: "email", to_field: "", to, subject: `Payment reminder — ${r.title}`, body: `Dear client,\n\nOur records show that invoice **${r.title}** for **${sum}**, due on ${due}, is still open.\n\nIf the payment has already been sent, please ignore this message and share the payment reference. Otherwise, we would be grateful for payment at your earliest convenience.\n\nThank you.` } : undefined, why: `Receivable ${late} days overdue` });
    }
    if (!recv && late <= 0 && late >= -th.remind_before) out.push({ rec: r, level: "info", who: ["role:finance"], key: `fin-pay|${r.id}`, repeat: 30, text: `We must pay “${r.title}” (${sum}) by ${due}.` });
  }
  // Expenses waiting for a decision or for payment
  for (const r of of(all, "finance.expenses")) {
    if (r.status === "Submitted" && created(r, today) >= 3) out.push({ rec: r, level: "warn", who: ["role:finance"], key: `fin-exp|${r.id}`, text: `Expense “${r.title}” (${money(r.data?.amount, r.data?.currency)}) waits for approval ${created(r, today)} days.` });
    if (r.status === "Approved" && age(r, today) >= 14) out.push({ rec: r, level: "warn", who: ["role:finance"], key: `fin-exppay|${r.id}`, text: `Approved expense “${r.title}” is not paid for ${age(r, today)} days${r.data?.requester ? ` (${r.data.requester})` : ""}.` });
  }
  // Budget lines over plan
  for (const r of of(all, "finance.budget")) {
    const plan = Number(r.data?.planned) || 0, act = Number(r.data?.actual) || 0;
    if (plan > 0 && act > plan && !["Over budget", "Closed"].includes(r.status || "")) out.push({ rec: r, level: "bad", who: ["role:finance", "leads"], key: `fin-budget|${r.id}`, text: `Budget “${r.title}” is over plan by ${Math.round(((act - plan) / plan) * 100)}% (${money(act - plan, r.data?.currency)}).`, action: { type: "set", field: "status", value: "Over budget" }, why: "Actual above planned" });
  }
  // Tax filings and insurance renewals
  for (const r of of(all, "finance.tax")) {
    if (r.status === "Filed" || !isDate(r.data?.due)) continue;
    const st = stepFor(days(today, r.data.due), [30, 14, 3]); if (!st) continue;
    out.push({ rec: r, level: st === "late" || st === "d3" ? "bad" : "warn", who: st === "late" ? ["role:finance", "leads"] : ["role:finance", "owner"], key: `fin-tax|${r.id}|${st}`, repeat: st === "late" ? 3 : 365, text: st === "late" ? `Tax filing “${r.title}” was due on ${r.data.due} and is not filed.` : `Tax filing “${r.title}” (${r.data?.jurisdiction || ""}) is due on ${r.data.due}.` });
  }
  for (const r of of(all, "finance.insurance")) {
    if (!isDate(r.data?.renewal) || ["Expired"].includes(r.status || "")) continue;
    const d = days(today, r.data.renewal); const st = stepFor(d, [60, 30, 7]); if (!st) continue;
    out.push({ rec: r, level: d <= 7 ? "bad" : "warn", who: d <= 7 ? ["role:finance", "leads"] : ["role:finance"], key: `fin-ins|${r.id}|${st}`, repeat: 365, text: d < 0 ? `Insurance “${r.title}” renewal date ${r.data.renewal} has passed — check cover.` : `Insurance “${r.title}” (${r.data?.type || ""}) renews on ${r.data.renewal}.`,
      action: r.status === "Active" && d <= 60 ? { type: "set", field: "status", value: "Renewal due" } : undefined, why: "Renewal within 60 days" });
  }
  // Cash runway from the latest monthly KPIs (cash ÷ net burn)
  const kpi = of(all, "finance.metrics").filter((r) => Number(r.data?.cash) > 0 && Number(r.data?.burn) > 0).sort((a, b) => String(b.data?.period || b.title).localeCompare(String(a.data?.period || a.title)))[0];
  if (kpi) {
    const months = Number(kpi.data.cash) / Number(kpi.data.burn);
    if (months < 6) out.push({ rec: kpi, level: months < 3 ? "bad" : "warn", who: ["leads", "role:finance"], key: `fin-runway|${kpi.id}`, repeat: 30, text: `Cash runway is about ${months.toFixed(1)} months (cash ${money(kpi.data.cash)}, net burn ${money(kpi.data.burn)} a month, ${kpi.title}).` });
  }
  return out;
}
