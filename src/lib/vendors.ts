// Vendor performance from purchase orders: delivered on time against the date promised when ordered,
// average delay, share of units rejected on receipt, and how unit prices changed. Pure functions.

type R = { id: string; section: string; title?: string; status?: string | null; created_at?: string; data: Record<string, any> };
const norm = (s: any) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const isDate = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);

/** Dates remembered on a purchase order when its status changes (null = nothing to change). */
export function poStamps(from: string | null | undefined, po: R, today: string) {
  if (po.section !== "operations.procurement" || from === po.status) return null;
  const d = { ...po.data }; let ch = false;
  if (po.status === "Ordered") { if (!d.ordered_on) { d.ordered_on = today; ch = true; } if (!d.eta_promised && isDate(d.eta)) { d.eta_promised = d.eta.slice(0, 10); ch = true; } }
  if (po.status === "Received" && !d.received_on) { d.received_on = today; if (!d.ordered_on) d.ordered_on = today; ch = true; }
  return ch ? d : null;
}

export type Grade = "A" | "B" | "C" | "new";
export type VendorScore = { vendor: string; orders: number; received: number; onTime: number | null; avgDelay: number | null; defectPct: number | null; priceChange: number | null; grade: Grade; late: { id: string; title: string; days: number }[] };

/** Score of one vendor over its purchase orders (matched by name, case-insensitive). */
export function vendorScore(vendor: string, all: R[]): VendorScore {
  const v = norm(vendor);
  const pos = all.filter((r) => r.section === "operations.procurement" && v && norm(r.data?.vendor) === v && r.status !== "Cancelled");
  const rec = pos.filter((p) => isDate(p.data?.received_on) && isDate(p.data?.eta_promised));
  const delays = rec.map((p) => ({ p, d: Math.max(0, days(p.data.eta_promised, p.data.received_on)) }));
  const onTime = rec.length ? Math.round((delays.filter((x) => x.d === 0).length / rec.length) * 100) : null;
  const avgDelay = rec.length ? Math.round((delays.reduce((a, x) => a + x.d, 0) / rec.length) * 10) / 10 : null;
  const got = pos.filter((p) => p.status === "Received"); const qty = got.reduce((a, p) => a + (Number(p.data?.qty) || 0), 0);
  const bad = got.reduce((a, p) => a + (Number(p.data?.defects) || 0), 0);
  const defectPct = qty ? Math.round((bad / qty) * 1000) / 10 : null;
  // Unit price: the latest order of each item against its first one, averaged over items bought more than once
  const byItem = new Map<string, { at: string; unit: number }[]>();
  for (const p of pos) { const q = Number(p.data?.qty) || 0, a = Number(p.data?.amount) || 0; if (!q || !a || !p.data?.item) continue;
    const k = norm(p.data.item); const at = String(p.data?.ordered_on || p.created_at || "").slice(0, 10); byItem.set(k, [...(byItem.get(k) || []), { at, unit: a / q }]); }
  const ch = [...byItem.values()].filter((x) => x.length > 1).map((x) => { const s = x.sort((a, b) => a.at.localeCompare(b.at)); return (s[s.length - 1].unit - s[0].unit) / s[0].unit; });
  const priceChange = ch.length ? Math.round((ch.reduce((a, x) => a + x, 0) / ch.length) * 1000) / 10 : null;
  const grade: Grade = rec.length < 2 ? "new" : (onTime! < 70 || (defectPct ?? 0) > 5) ? "C" : (onTime! >= 90 && (defectPct ?? 0) <= 1) ? "A" : "B";
  return { vendor, orders: pos.length, received: got.length, onTime, avgDelay, defectPct, priceChange, grade,
    late: delays.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3).map((x) => ({ id: x.p.id, title: x.p.title || x.p.data?.item || "", days: x.d })) };
}

/** Vendors that deliver late too often (at least 3 received orders, under 70 % on time). */
export function weakVendors(all: R[]) {
  const names = [...new Set(all.filter((r) => r.section === "operations.procurement" && r.data?.vendor).map((r) => String(r.data.vendor).trim()))];
  return names.map((n) => vendorScore(n, all)).filter((s) => s.grade === "C" && s.received >= 3);
}
