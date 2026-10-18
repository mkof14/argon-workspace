// Checks before approving: what a careful controller would look at first.
// Possible duplicate, department budget, vendor screening, unusually large amount, deep discount or price under costing.

type R = { id: string; section: string; title: string; status: string | null; created_at?: string; updated_at?: string; data: Record<string, any> };
export type Warn = { level: "bad" | "warn" | "info"; k: "dup" | "budget" | "nobudget" | "vendor" | "novendor" | "large" | "discount" | "underprice"; ref?: { id: string; section: string; title: string }; n?: string };
const RATES: Record<string, number> = { USD: 1, AED: 3.6725, EUR: 0.92, GBP: 0.79 };
const usd = (v: any, c?: string) => (Number(v) || 0) / (RATES[String(c || "USD").toUpperCase()] || 1);
const norm = (s: any) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const day = (r: R) => String(r.created_at || r.updated_at || "").slice(0, 10);
const money = (v: number) => `USD ${Math.round(v).toLocaleString("en-US")}`;
const DEAD = ["Cancelled", "Rejected"];

/** Department names a budget line may use for a department key (English and Russian labels, the key itself). */
const DEPT: Record<string, string[]> = {
  operations: ["operations", "операции", "ops"], finance: ["finance", "финансы"], sales: ["sales", "продажи"], marketing: ["marketing", "маркетинг"],
  engineering: ["technical", "engineering", "технический", "инженеры", "r&d"], technical: ["technical", "engineering", "технический"], hr: ["hr", "персонал", "кадры"],
  legal: ["legal", "юридический", "юристы"], security: ["security", "безопасность"], management: ["management", "руководство", "company", "компания"],
};

export function precheck(rec: R, all: R[], today: string, deptOf: (r: R) => string = () => ""): Warn[] {
  const d = rec.data || {}; const out: Warn[] = []; const amt = usd(d.amount ?? d.value, d.currency);
  const who = norm(d.vendor || d.counterparty || d.requester || d.client);
  // 1. Possible duplicate: same section, same party, amount within 1 %, within 30 days
  if (amt > 0) {
    const dup = all.find((x) => x.id !== rec.id && x.section === rec.section && !DEAD.includes(x.status || "") && norm(x.data?.vendor || x.data?.counterparty || x.data?.requester || x.data?.client) === who
      && Math.abs(usd(x.data?.amount ?? x.data?.value, x.data?.currency) - amt) <= amt * 0.01 && Math.abs(Date.parse(day(x) || today) - Date.parse(day(rec) || today)) <= 30 * 864e5);
    if (dup) out.push({ level: "bad", k: "dup", ref: { id: dup.id, section: dup.section, title: dup.title } });
  }
  // 2. Budget of the department for spending
  if (["finance.expenses", "operations.procurement"].includes(rec.section) && amt > 0) {
    const dep = rec.section === "operations.procurement" ? "operations" : deptOf(rec);
    const names = DEPT[dep] || (dep ? [dep] : []);
    const b = all.filter((x) => x.section === "finance.budget" && ["Approved", "Over budget"].includes(x.status || "") && names.some((n) => norm(x.data?.department).includes(n)))
      .sort((a, z) => String(z.data?.period || "").localeCompare(String(a.data?.period || "")))[0];
    if (!b) { if (dep) out.push({ level: "info", k: "nobudget", n: dep }); }
    else { const left = usd(b.data?.planned, b.data?.currency) - usd(b.data?.actual, b.data?.currency); if (amt > left) out.push({ level: left <= 0 ? "bad" : "warn", k: "budget", ref: { id: b.id, section: b.section, title: b.title }, n: money(Math.max(0, left)) }); }
  }
  // 3. Vendor: blocked, not screened, or unknown
  if (rec.section === "operations.procurement" && d.vendor) {
    const v = all.find((x) => x.section === "operations.vendors" && norm(x.title) === norm(d.vendor));
    if (!v) out.push({ level: "warn", k: "novendor", n: String(d.vendor) });
    else if (v.status === "Blocked" || v.data?.screening === "Flagged") out.push({ level: "bad", k: "vendor", ref: { id: v.id, section: v.section, title: v.title }, n: v.status === "Blocked" ? "Blocked" : "Flagged" });
    else if (v.data?.screening !== "Cleared") out.push({ level: "warn", k: "vendor", ref: { id: v.id, section: v.section, title: v.title }, n: String(v.data?.screening || "Not started") });
  }
  // 4. Unusually large against the history of the same party or category (3× the median, at least 3 earlier records)
  if (amt > 0) {
    const peers = all.filter((x) => x.id !== rec.id && x.section === rec.section && !DEAD.includes(x.status || "") && ((who && norm(x.data?.vendor || x.data?.requester) === who) || (d.category && x.data?.category === d.category)))
      .map((x) => usd(x.data?.amount ?? x.data?.value, x.data?.currency)).filter((v) => v > 0).sort((a, b) => a - b);
    if (peers.length >= 3) { const med = peers[Math.floor(peers.length / 2)]; if (amt > med * 3) out.push({ level: "info", k: "large", n: `${Math.round(amt / med)}×` }); }
  }
  // 5. Proposals: deep discount, or price under the approved costing
  if (rec.section === "sales.proposals") {
    if (Number(d.discount) > 15) out.push({ level: "warn", k: "discount", n: `${d.discount}%` });
    const c = all.find((x) => x.section === "finance.costing" && x.status === "Approved" && (x.data?.config === d.config || x.title === d.config));
    const unit = c ? usd(Number(c.data?.bom || 0) + Number(c.data?.labor || 0) + Number(c.data?.logistics_cost || 0), c.data?.currency) : 0;
    const qty = Math.max(1, Number(d.qty) || 1);
    if (unit && amt && amt < unit * qty) out.push({ level: "bad", k: "underprice", n: money(unit * qty) });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
export const PRECHECK_SECS = ["finance.expenses", "operations.procurement", "operations.vendors", "finance.budget", "finance.costing", "sales.proposals"];
