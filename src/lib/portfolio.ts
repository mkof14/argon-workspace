// Project portfolio: every won deal with a project, its progress, next step, dates, money and a traffic light.
// Red: a step is more than 14 days late, a client invoice is more than 30 days overdue, the margin is low,
// or shipping is within 14 days and compliance is missing. Amber: anything late, overdue, missing or short.

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any> };
export type Health = "green" | "amber" | "red";
export type Reason = { k: "late" | "overdue" | "margin" | "cost" | "compliance" | "parts"; n?: number | string };
export type Helpers = {
  money?: (deal: any, all: any[]) => { forecastPct: number | null; targetPct: number | null; low: boolean; over: boolean; revenue: number; collected: number };
  ship?: (build: any) => string[];
  parts?: (all: any[], today: string) => { b: { id: string } }[];
};
export type Row = { deal: R; health: Health; reasons: Reason[]; done: number; total: number; next: R | null; nextDate: string; ship: string; finish: string; money: ReturnType<NonNullable<Helpers["money"]>> | null };

const DONE = /^(done|closed|completed|installed|commissioned|delivered|received|paid|cleared|passed|resolved|signed)$/i;
const dateOf = (r: R) => String(r.data?.due || r.data?.date || r.data?.eta || "").slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

export function portfolio(all: R[], today: string, h: Helpers = {}): Row[] {
  const short = new Set((h.parts ? h.parts(all, today) : []).map((x) => x.b.id));
  const deals = all.filter((d) => d.section === "sales.pipeline" && d.status === "Won" && all.some((r) => r.data?.project === d.id || (r.section === "operations.builds" && r.data?.deal_ref === d.id)));
  const rank: Record<Health, number> = { red: 0, amber: 1, green: 2 };
  return deals.map((deal) => {
    const steps = all.filter((r) => r.data?.project === deal.id && r.section !== "finance.invoices");
    const open = steps.filter((s) => !DONE.test(s.status || "")).sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    const late = open.filter((s) => isDate(dateOf(s)) && dateOf(s) < today); const maxLate = late.reduce((m, s) => Math.max(m, days(dateOf(s), today)), 0);
    const ship = dateOf(steps.find((s) => s.data?.project_step === "ship") || ({ data: {} } as R));
    const finish = steps.map(dateOf).filter(isDate).sort().pop() || "";
    const over = all.filter((i) => i.section === "finance.invoices" && i.data?.deal_ref === deal.id && i.data?.direction !== "Payable" && !["Paid", "Draft"].includes(i.status || "") && isDate(String(i.data?.due || "").slice(0, 10)) && String(i.data.due).slice(0, 10) < today);
    const maxOver = over.reduce((m, i) => Math.max(m, days(String(i.data.due).slice(0, 10), today)), 0);
    const builds = all.filter((b) => b.section === "operations.builds" && b.data?.deal_ref === deal.id);
    const shipSoon = isDate(ship) && days(today, ship) <= 45; const shipVerySoon = isDate(ship) && days(today, ship) <= 14;
    const missing = shipSoon && h.ship ? builds.flatMap((b) => DONE.test(b.status || "") || b.status === "Shipping" ? [] : h.ship!(b)) : [];
    const money = h.money ? h.money(deal, all) : null;
    const reasons: Reason[] = [];
    if (late.length) reasons.push({ k: "late", n: late.length });
    if (over.length) reasons.push({ k: "overdue", n: maxOver });
    if (money?.low) reasons.push({ k: "margin", n: money.forecastPct ?? "" }); else if (money?.over) reasons.push({ k: "cost" });
    if (missing.length) reasons.push({ k: "compliance", n: [...new Set(missing)].length });
    if (builds.some((b) => short.has(b.id))) reasons.push({ k: "parts" });
    const red = maxLate > 14 || maxOver > 30 || !!money?.low || (shipVerySoon && missing.length > 0);
    const health: Health = red ? "red" : reasons.length ? "amber" : "green";
    return { deal, health, reasons, done: steps.length - open.length, total: steps.length, next: open[0] || null, nextDate: open[0] ? dateOf(open[0]) : "", ship, finish, money };
  }).sort((a, b) => rank[a.health] - rank[b.health] || (a.nextDate || "9").localeCompare(b.nextDate || "9"));
}
