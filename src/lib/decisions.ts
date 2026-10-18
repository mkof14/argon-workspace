// Decision centre: everything that waits for a yes or no, in one list ordered by urgency.
// Pure helpers; the page gathers approvals, agent proposals, ready invoices and red projects.

const RATES: Record<string, number> = { USD: 1, AED: 3.6725, EUR: 0.92, GBP: 0.79 };
export const toUsd = (v: any, cur?: string) => (Number(v) || 0) / (RATES[String(cur || "USD").toUpperCase()] || 1);
export type Kind = "approval" | "agent" | "invoice" | "project";
export type Decision = { kind: Kind; id: string; title: string; section?: string; recordId?: string; amount?: number; currency?: string; usd: number; age: number; urgency: number; data?: Record<string, any> };

const days = (iso: string | undefined, today: string) => (iso ? Math.max(0, Math.round((Date.parse(today) - Date.parse(String(iso).slice(0, 10))) / 864e5)) : 0);
/** Main amount of a record: amount, value or price, with its currency. */
export function amountOf(d: Record<string, any> | undefined) {
  const v = Number(d?.amount ?? d?.value ?? d?.price ?? d?.budget ?? d?.planned); return Number.isFinite(v) && v !== 0 ? { v, cur: String(d?.currency || "USD") } : null;
}
/** Urgency: approvals first (people wait), then agent proposals, money ready to collect, projects at risk; older and larger rise. */
export function urgency(kind: Kind, age: number, usd: number) {
  const base = { approval: 60, agent: 45, invoice: 35, project: 25 }[kind];
  return base + Math.min(30, age * 4) + Math.min(25, Math.log10(1 + Math.abs(usd)) * 4);
}
export function decision(kind: Kind, o: { id: string; title: string; section?: string; recordId?: string; at?: string; data?: Record<string, any> }, today: string): Decision {
  const a = amountOf(o.data); const usd = a ? toUsd(a.v, a.cur) : 0; const age = days(o.at, today);
  return { kind, id: o.id, title: o.title, section: o.section, recordId: o.recordId, amount: a?.v, currency: a?.cur, usd, age, urgency: Math.round(urgency(kind, age, usd)), data: o.data };
}
export const ordered = (xs: Decision[]) => [...xs].sort((a, b) => b.urgency - a.urgency || b.usd - a.usd);
