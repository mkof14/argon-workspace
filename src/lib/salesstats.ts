// Sales analytics: how deals move through the stages, how long they take, what the quarter will bring
// against the target, and why deals are lost. Planning view in USD at approximate rates.

type R = { id: string; section: string; title: string; status: string | null; created_at?: string; updated_at?: string; data: Record<string, any> };
type A = { record_id: string | null; action: string; detail: any; created_at: string };
export const STAGES = ["Lead", "Qualified", "Proposal", "Negotiation", "Won"] as const;
const P: Record<string, number> = { Lead: 0.1, Qualified: 0.25, Proposal: 0.5, Negotiation: 0.75 };
const RATES: Record<string, number> = { USD: 1, AED: 3.6725, EUR: 0.92, GBP: 0.79 };
const usd = (v: any, c?: string) => (Number(v) || 0) / (RATES[String(c || "USD").toUpperCase()] || 1);
const idx = (s: string) => STAGES.indexOf(s as any);

/** Quarter of a date: start and end (inclusive) as YYYY-MM-DD, label like 2026 Q4. */
export function quarterOf(iso: string) {
  const y = Number(iso.slice(0, 4)), q = Math.floor((Number(iso.slice(5, 7)) - 1) / 3);
  const start = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`; const end = new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10);
  return { start, end, label: `${y} Q${q + 1}` };
}

export function salesStats(deals: R[], activity: A[], today: string, target = 0) {
  const ds = deals.filter((d) => d.section === "sales.pipeline");
  const hist = new Map<string, A[]>(); for (const a of activity) if (a.record_id) hist.set(a.record_id, [...(hist.get(a.record_id) || []), a]);
  // Highest stage each deal reached (from its status history, or its current status)
  const reached = (d: R) => {
    let m = d.status === "Lost" ? 0 : Math.max(0, idx(d.status || "Lead"));
    for (const a of hist.get(d.id) || []) for (const s of [a.detail?.from, a.detail?.to, a.detail?.status]) if (s && idx(s) > m) m = idx(s);
    if (d.status === "Lost" && d.data?.lost_stage && idx(d.data.lost_stage) > m) m = idx(d.data.lost_stage);
    return m;
  };
  const funnel = STAGES.map((s, i) => ({ stage: s, n: ds.filter((d) => reached(d) >= i).length, usd: Math.round(ds.filter((d) => reached(d) >= i).reduce((a, d) => a + usd(d.data?.value, d.data?.currency), 0)) }));
  const conv = funnel.slice(1).map((f, i) => ({ from: funnel[i].stage, to: f.stage, pct: funnel[i].n ? Math.round((f.n / funnel[i].n) * 100) : null }));
  // Days from creation to Won (status history date, else last update)
  const wonAt = (d: R) => (hist.get(d.id) || []).filter((a) => a.detail?.to === "Won").map((a) => a.created_at).sort()[0] || d.updated_at || "";
  const won = ds.filter((d) => d.status === "Won"), lost = ds.filter((d) => d.status === "Lost");
  const cyc = won.map((d) => Math.round((Date.parse(wonAt(d).slice(0, 10)) - Date.parse(String(d.created_at || wonAt(d)).slice(0, 10))) / 864e5)).filter((x) => x >= 0).sort((a, b) => a - b);
  const cycle = cyc.length ? { median: cyc[Math.floor((cyc.length - 1) / 2)], avg: Math.round(cyc.reduce((a, x) => a + x, 0) / cyc.length), n: cyc.length } : null;
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  // This quarter: won so far + weighted open deals expected to close in it
  const q = quarterOf(today); const inQ = (iso: any) => typeof iso === "string" && iso.slice(0, 10) >= q.start && iso.slice(0, 10) <= q.end;
  const wonQ = won.filter((d) => inQ(wonAt(d))).reduce((a, d) => a + usd(d.data?.value, d.data?.currency), 0);
  const open = ds.filter((d) => P[d.status || ""] !== undefined && inQ(d.data?.expected_close));
  const weighted = open.reduce((a, d) => a + usd(d.data?.value, d.data?.currency) * P[d.status!], 0);
  const best = open.reduce((a, d) => a + usd(d.data?.value, d.data?.currency), 0);
  const noDate = ds.filter((d) => P[d.status || ""] !== undefined && !d.data?.expected_close).length;
  // Losses by reason and by segment
  const by = (xs: R[], key: (d: R) => string) => Object.entries(xs.reduce((m: Record<string, { n: number; usd: number }>, d) => { const k = key(d) || "—"; m[k] = m[k] || { n: 0, usd: 0 }; m[k].n++; m[k].usd += usd(d.data?.value, d.data?.currency); return m; }, {})).map(([k, v]) => ({ k, n: v.n, usd: Math.round(v.usd) })).sort((a, b) => b.n - a.n || b.usd - a.usd);
  const segments = by([...won, ...lost], (d) => d.data?.segment).map((s) => { const w = won.filter((d) => (d.data?.segment || "—") === s.k).length; return { ...s, won: w, rate: Math.round((w / s.n) * 100) }; });
  return { funnel, conv, cycle, winRate, quarter: { ...q, won: Math.round(wonQ), weighted: Math.round(weighted), best: Math.round(best), forecast: Math.round(wonQ + weighted), target, gap: target ? Math.round(target - wonQ - weighted) : null, noDate },
    lostReasons: by(lost, (d) => d.data?.lost_reason), lostNoReason: lost.filter((d) => !d.data?.lost_reason).length, segments };
}
