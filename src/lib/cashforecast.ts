// 90-day cash forecast: money that is due to come in and go out week by week, plus probable money from open deals.
// Everything is converted to USD at approximate rates; it is a planning view, not accounting.

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any> };
export const RATES: Record<string, number> = { USD: 1, AED: 3.6725, EUR: 0.92, GBP: 0.79 };
const usd = (v: any, cur?: string) => (Number(v) || 0) / (RATES[String(cur || "USD").toUpperCase()] || 1);
/** Chance that a deal closes, by stage (the same as the weighted pipeline). */
export const STAGE_P: Record<string, number> = { Lead: 0.1, Qualified: 0.25, Proposal: 0.5, Negotiation: 0.75 };
/** When a deal without an expected close date is likely to close, days from today. */
const STAGE_DAYS: Record<string, number> = { Lead: 120, Qualified: 90, Proposal: 60, Negotiation: 30 };
const DAY = 864e5;
const at = (iso: string) => Date.parse(String(iso).slice(0, 10) + "T00:00:00Z");

export type Line = { id: string; section: string; title: string; usd: number; date: string; kind: "in" | "out" | "probable"; late?: boolean };
export type Week = { start: string; in: number; out: number; probable: number; balance: number; withProbable: number };

export function cashForecast(all: R[], today: string, weeks = 13) {
  const t0 = at(today); const end = t0 + weeks * 7 * DAY; const lines: Line[] = [];
  const add = (r: R, amount: number, date: string | undefined, kind: Line["kind"]) => {
    if (!(amount > 0)) return; let d = date && /^\d{4}-\d{2}-\d{2}/.test(date) ? at(date) : t0; const late = d < t0; if (late) d = t0;
    if (d >= end) return; lines.push({ id: r.id, section: r.section, title: r.title, usd: Math.round(amount), date: new Date(d).toISOString().slice(0, 10), kind, late });
  };
  for (const r of all) {
    const d = r.data || {};
    if (r.section === "finance.invoices" && !["Paid", "Draft"].includes(r.status || "")) add(r, usd(d.amount, d.currency), d.due, d.direction === "Payable" ? "out" : "in");
    if (r.section === "finance.expenses" && r.status === "Approved") add(r, usd(d.amount, d.currency), undefined, "out");
    if (r.section === "operations.procurement" && ["Approved", "Ordered"].includes(r.status || "")) add(r, usd(d.amount, d.currency), d.eta, "out");
    if (r.section === "sales.pipeline" && STAGE_P[r.status || ""]) {
      // Weighted value; the advance (30%) when the deal closes, 40% before shipping about 12 weeks later
      const v = usd(d.value, d.currency) * STAGE_P[r.status!]; const close = d.expected_close && /^\d{4}-\d{2}-\d{2}/.test(d.expected_close) ? d.expected_close : new Date(t0 + STAGE_DAYS[r.status!] * DAY).toISOString().slice(0, 10);
      add(r, v * 0.3, close, "probable"); add(r, v * 0.4, new Date(at(close) + 84 * DAY).toISOString().slice(0, 10), "probable");
    }
  }
  // Opening balance: the latest month in Finance → Metrics with cash on hand
  const m = all.filter((r) => r.section === "finance.metrics" && Number(r.data?.cash)).sort((a, b) => String(b.data?.period || b.title).localeCompare(String(a.data?.period || a.title)))[0];
  const opening = m ? Math.round(usd(m.data.cash, m.data.currency)) : null;
  let bal = opening || 0, balP = opening || 0; const out: Week[] = [];
  for (let i = 0; i < weeks; i++) {
    const s = t0 + i * 7 * DAY, e = s + 7 * DAY; const inW = lines.filter((l) => at(l.date) >= s && at(l.date) < e);
    const sum = (k: Line["kind"]) => inW.filter((l) => l.kind === k).reduce((a, l) => a + l.usd, 0);
    const w = { start: new Date(s).toISOString().slice(0, 10), in: sum("in"), out: sum("out"), probable: sum("probable"), balance: 0, withProbable: 0 };
    bal += w.in - w.out; balP += w.in - w.out + w.probable; w.balance = bal; w.withProbable = balP; out.push(w);
  }
  const gap = out.findIndex((w) => w.balance < 0);
  const low = out.reduce((a, w) => (w.balance < a.balance ? w : a), out[0]);
  return { opening, weeks: out, lines, gap: gap < 0 ? null : { week: gap, start: out[gap].start, balance: out[gap].balance }, low,
    totals: { in: out.reduce((a, w) => a + w.in, 0), out: out.reduce((a, w) => a + w.out, 0), probable: out.reduce((a, w) => a + w.probable, 0) } };
}
