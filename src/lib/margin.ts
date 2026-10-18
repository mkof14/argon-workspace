// Project money: what the client pays (contract + signed change orders), what we invoiced and collected,
// what the project costs so far (approved, ordered and received purchases, approved expenses, supplier invoices)
// against the approved costing of its configuration. Planning view in USD at approximate rates, not accounting.

type R = { id: string; section: string; title: string; status: string | null; updated_at?: string; data: Record<string, any> };
const RATES: Record<string, number> = { USD: 1, AED: 3.6725, EUR: 0.92, GBP: 0.79 };
const usd = (v: any, cur?: string) => (Number(v) || 0) / (RATES[String(cur || "USD").toUpperCase()] || 1);
const n = (v: any) => Number(v) || 0;
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / a) * 1000) / 10 : null);

export const CHANGE_ORDER = "Change order";
/** Margin may fall this many percentage points under the costing target before it is flagged. */
export const MARGIN_SLACK = 5;

export type ProjectMoney = {
  contract: number; changes: number; revenue: number; invoiced: number; collected: number;
  committed: number; planned: number | null; forecastCost: number; targetPct: number | null; marginPct: number | null; forecastPct: number | null;
  qty: number; over: boolean; low: boolean;
};

export function projectMoney(deal: R, all: R[]): ProjectMoney {
  const id = deal.id; const d = deal.data || {};
  const builds = all.filter((r) => r.section === "operations.builds" && r.data?.deal_ref === id); const bIds = new Set(builds.map((b) => b.id));
  const prop = all.filter((r) => r.section === "sales.proposals" && r.data?.deal_ref === id && r.status !== "Rejected").sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0];
  const contract = prop ? usd(prop.data?.value, prop.data?.currency) : usd(d.value, d.currency);
  const changes = all.filter((r) => r.section === "legal.contracts" && r.data?.deal_ref === id && r.data?.type === CHANGE_ORDER && r.status === "Signed").reduce((a, r) => a + usd(r.data?.amount, r.data?.currency || d.currency), 0);
  const revenue = contract + changes;
  const recv = all.filter((r) => r.section === "finance.invoices" && r.data?.deal_ref === id && r.data?.direction !== "Payable");
  const invoiced = recv.filter((r) => r.status !== "Draft").reduce((a, r) => a + usd(r.data?.amount, r.data?.currency), 0);
  const collected = recv.filter((r) => r.status === "Paid").reduce((a, r) => a + usd(r.data?.amount, r.data?.currency), 0);
  const po = all.filter((r) => r.section === "operations.procurement" && bIds.has(r.data?.build_ref) && ["Approved", "Ordered", "Received"].includes(r.status || "")).reduce((a, r) => a + usd(r.data?.amount, r.data?.currency), 0);
  const exp = all.filter((r) => r.section === "finance.expenses" && r.data?.deal_ref === id && ["Approved", "Paid"].includes(r.status || "")).reduce((a, r) => a + usd(r.data?.amount, r.data?.currency), 0);
  const pay = all.filter((r) => r.section === "finance.invoices" && r.data?.deal_ref === id && r.data?.direction === "Payable" && r.status !== "Draft").reduce((a, r) => a + usd(r.data?.amount, r.data?.currency), 0);
  const committed = po + exp + pay;
  // Approved costing of the configuration: planned cost per unit and the target margin
  const cfg = d.config || builds[0]?.data?.config; const qty = Math.max(1, n(prop?.data?.qty) || builds.length || 1);
  const cost = all.find((r) => r.section === "finance.costing" && r.status === "Approved" && (r.data?.config === cfg || r.title === cfg));
  const unit = cost ? usd(n(cost.data?.bom) + n(cost.data?.labor) + n(cost.data?.logistics_cost), cost.data?.currency) : 0;
  const planned = cost && unit ? unit * qty : null;
  const targetPct = cost && n(cost.data?.price) ? pct(n(cost.data.price), n(cost.data.bom) + n(cost.data.labor) + n(cost.data.logistics_cost)) : null;
  const forecastCost = Math.max(committed, planned || 0);
  const r0 = (x: number) => Math.round(x);
  return {
    contract: r0(contract), changes: r0(changes), revenue: r0(revenue), invoiced: r0(invoiced), collected: r0(collected),
    committed: r0(committed), planned: planned === null ? null : r0(planned), forecastCost: r0(forecastCost), targetPct, qty,
    marginPct: revenue ? pct(revenue, committed) : null, forecastPct: revenue ? pct(revenue, forecastCost) : null,
    over: planned !== null && committed > planned * 1.05,
    low: targetPct !== null && revenue > 0 && (pct(revenue, forecastCost) ?? 100) < targetPct - MARGIN_SLACK,
  };
}

/** Effects of a signed change order: an extra draft invoice for an increase, or a lower last unsent invoice for a decrease. */
export function changeOrderEffects(co: R, invoices: R[], today: string) {
  if (co.section !== "legal.contracts" || co.data?.type !== CHANGE_ORDER || co.status !== "Signed" || co.data?.applied_on || !co.data?.deal_ref) return null;
  const amount = Math.round(n(co.data?.amount) * 100) / 100; const stamp = { ...co.data, applied_on: today };
  if (!amount) return { co: stamp };
  const due = new Date(Date.parse(today) + 14 * 864e5).toISOString().slice(0, 10);
  if (amount > 0) return { co: stamp, create: { section: "finance.invoices", title: `${co.title}`, status: "Draft", data: { deal_ref: co.data.deal_ref, project: co.data.deal_ref, project_step: `pay-co-${co.id}`, direction: "Receivable", counterparty: co.data?.counterparty || "", amount, currency: co.data?.currency || "USD", due, milestone: "change", trigger: "start", ready_on: today, change_ref: co.id } } };
  const last = invoices.filter((i) => i.section === "finance.invoices" && i.data?.deal_ref === co.data.deal_ref && i.status === "Draft" && i.data?.milestone && i.data?.milestone !== "change")
    .sort((a, b) => String(b.data?.due || "").localeCompare(String(a.data?.due || "")))[0];
  if (!last) return { co: { ...stamp, apply_note: "No unsent milestone invoice to reduce — issue a credit note." } };
  const left = Math.max(0, Math.round((n(last.data?.amount) + amount) * 100) / 100);
  return { co: stamp, update: { id: last.id, data: { ...last.data, amount: left, change_note: `${amount} (${co.title})` } } };
}
