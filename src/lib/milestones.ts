// Payments by project milestones: the payment terms of the proposal become draft invoices tied to project steps.
// The advance is ready at once; the next parts become ready when factory acceptance (FAT) or site acceptance (SAT)
// is closed. Workspace only prepares the invoice — a person checks it and sends it.

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

export type Trigger = "start" | "fat" | "sat";
export type Milestone = { key: "advance" | "preship" | "accept"; pct: number; after: Trigger };

/** Payment schedules (the same keys as in proposals). */
export const SCHEDULES: Record<string, Milestone[]> = {
  "30/40/30": [{ key: "advance", pct: 30, after: "start" }, { key: "preship", pct: 40, after: "fat" }, { key: "accept", pct: 30, after: "sat" }],
  "40/50/10": [{ key: "advance", pct: 40, after: "start" }, { key: "preship", pct: 50, after: "fat" }, { key: "accept", pct: 10, after: "sat" }],
  "50/50": [{ key: "advance", pct: 50, after: "start" }, { key: "preship", pct: 50, after: "fat" }],
  "100": [{ key: "preship", pct: 100, after: "fat" }],
};
export const DEFAULT_TERMS = "30/40/30";

export const MS_TITLE: Record<Milestone["key"], T4> = {
  advance: L("Advance {pct}% — {client}", "Аванс {pct}% — {client}", "Аванс {pct}% — {client}", "دفعة مقدمة {pct}% — {client}"),
  preship: L("{pct}% before shipping — {client}", "{pct}% до отгрузки — {client}", "{pct}% до відвантаження — {client}", "{pct}% قبل الشحن — {client}"),
  accept: L("{pct}% on acceptance — {client}", "{pct}% после приёмки — {client}", "{pct}% після приймання — {client}", "{pct}% عند القبول — {client}"),
};
export const TRIGGER_TEXT: Record<Trigger, T4> = {
  start: L("on signing", "при подписании", "під час підписання", "عند التوقيع"),
  fat: L("after factory acceptance", "после заводских испытаний", "після заводських випробувань", "بعد القبول في المصنع"),
  sat: L("after site acceptance", "после приёмки на объекте", "після приймання на об'єкті", "بعد القبول في الموقع"),
};
/** Days given to the client to pay once the part is invoiced. */
export const PAY_DAYS = 14;

const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

export type MilestoneInvoice = { key: string; section: "finance.invoices"; title: string; status: "Draft"; due: string; role: "finance"; link: "deal"; data: Record<string, any> };

/**
 * Draft invoices for a deal: one per part of the schedule. `dates` gives the planned date of each trigger
 * (start = signing, fat, sat); the invoice is due PAY_DAYS later. The last part takes the rounding remainder.
 */
export function milestonePlan(o: { dealId: string; client: string; value: number; currency: string; terms: string; dates: Record<Trigger, string>; lang: keyof T4; today: string }): MilestoneInvoice[] {
  const sch = SCHEDULES[o.terms] || SCHEDULES[DEFAULT_TERMS]; const value = Math.max(0, Number(o.value) || 0); if (!value) return [];
  let left = value;
  return sch.map((m, i) => {
    const amount = i === sch.length - 1 ? r2(left) : r2((value * m.pct) / 100); left = r2(left - amount);
    const at = o.dates[m.after] || o.today; const ready = m.after === "start";
    return { key: `pay-${m.key}`, section: "finance.invoices", title: (MS_TITLE[m.key][o.lang] || MS_TITLE[m.key].en).replace("{pct}", String(m.pct)).replace("{client}", o.client), status: "Draft", due: addDays(at, PAY_DAYS), role: "finance", link: "deal",
      data: { project: o.dealId, project_step: `pay-${m.key}`, deal_ref: o.dealId, direction: "Receivable", counterparty: o.client, amount, currency: o.currency || "USD", due: addDays(at, PAY_DAYS), milestone: m.key, pct: m.pct, trigger: m.after, terms: o.terms, ...(ready ? { ready_on: o.today } : {}) } };
  });
}

const DONE = /^(done|closed|completed|passed)$/i;
/**
 * A project step changed status. When factory or site acceptance is closed, the draft invoices waiting for it
 * become ready: the date is set and the client gets PAY_DAYS to pay. Returns the changes to save.
 */
export function milestoneReady(step: { section: string; status?: string | null; data: Record<string, any> }, invoices: { id: string; section: string; status?: string | null; data: Record<string, any> }[], today: string) {
  const k = step.data?.project_step; const proj = step.data?.project;
  if (!proj || (k !== "fat" && k !== "sat") || !DONE.test(step.status || "")) return [];
  return invoices.filter((i) => i.section === "finance.invoices" && i.data?.project === proj && i.data?.trigger === k && i.status === "Draft" && !i.data?.ready_on)
    .map((i) => ({ id: i.id, data: { ...i.data, ready_on: today, due: addDays(today, PAY_DAYS) } }));
}

/** Draft milestone invoices that are ready to be checked and sent. */
export const readyToSend = (all: { section: string; status?: string | null; data: Record<string, any> }[]) =>
  all.filter((i) => i.section === "finance.invoices" && i.status === "Draft" && i.data?.milestone && i.data?.ready_on);
