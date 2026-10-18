// "What if": a copy of the records with planned changes applied — a deal closes later, a project slips,
// a client pays late, a purchase moves — so the cash forecast and project dates can be compared before deciding.

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any> };
export type Change =
  | { kind: "deal"; id: string; to: string }   // open deal: new expected close date
  | { kind: "delay"; id: string; days: number } // won deal: every unfinished project step (and waiting milestone invoices) slips
  | { kind: "pay"; id: string; days: number }   // client invoice paid this many days later
  | { kind: "po"; id: string; to: string };     // purchase order: new date

const DONE = /^(done|closed|completed|installed|commissioned|delivered|received|paid|cleared|passed|resolved|signed)$/i;
const KEYS = ["due", "date", "eta"];
const shift = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const isDate = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

export function applyScenario<T extends R>(all: T[], changes: Change[]): T[] {
  const out = all.map((r) => ({ ...r, data: { ...r.data } }));
  const byId = new Map(out.map((r) => [r.id, r]));
  for (const c of changes) {
    if (c.kind === "deal") { const r = byId.get(c.id); if (r && isDate(c.to)) r.data.expected_close = c.to; }
    if (c.kind === "po") { const r = byId.get(c.id); if (r && isDate(c.to)) r.data.eta = c.to; }
    if (c.kind === "pay") { const r = byId.get(c.id); if (r && isDate(r.data.due) && c.days) r.data.due = shift(r.data.due, c.days); }
    if (c.kind === "delay" && c.days) for (const r of out) {
      if (r.data?.project !== c.id) continue;
      if (r.section === "finance.invoices") { if (r.status === "Draft" && !r.data.ready_on && isDate(r.data.due)) r.data.due = shift(r.data.due, c.days); continue; }
      if (DONE.test(r.status || "")) continue;
      for (const k of KEYS) if (isDate(r.data[k])) { r.data[k] = shift(r.data[k], c.days); break; }
    }
  }
  return out;
}

/** Last date of each won project (to show how the finish moves). */
export function finishDates(all: R[]) {
  const m: Record<string, string> = {};
  for (const r of all) { const p = r.data?.project; if (!p || r.section === "finance.invoices") continue; const d = KEYS.map((k) => r.data?.[k]).find(isDate); if (d && (!m[p] || d.slice(0, 10) > m[p])) m[p] = d.slice(0, 10); }
  return m;
}
