// Service levels for support requests: how fast AGRON must respond and resolve, by the unit's SLA and the request's severity.
// Calendar hours (Premium 24/7 is around the clock; for the others the clock also runs on weekends — simple and strict).

export const TIERS = ["Premium 24/7", "Standard", "Basic"] as const;
export type Tier = (typeof TIERS)[number];
const H = 3600e3;
/** [response, resolution] in hours. */
export const SLA: Record<Tier, Record<string, [number, number]>> = {
  "Premium 24/7": { Critical: [1, 8], High: [2, 24], Medium: [8, 72], Low: [24, 168] },
  Standard: { Critical: [4, 24], High: [8, 48], Medium: [24, 120], Low: [48, 240] },
  Basic: { Critical: [8, 48], High: [24, 120], Medium: [48, 240], Low: [120, 480] },
};
const DONE = /^(resolved|closed|done)$/i;

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any>; created_at?: string };
export type SlaState = "ok" | "soon" | "late" | "met" | "missed";
export type SlaView = { tier: Tier; severity: string; start: string; respondBy: string; resolveBy: string; respond: SlaState; resolve: SlaState; respondLeft: number; resolveLeft: number };

/** The SLA of one request: its tier comes from the linked unit (Installed base), Standard when unknown. */
export function slaFor(t: R, fleet: R[], now = Date.now()): SlaView | null {
  if (!t.created_at) return null;
  const unit = fleet.find((f) => f.id === t.data?.unit_ref);
  const tier: Tier = (TIERS as readonly string[]).includes(unit?.data?.sla) ? unit!.data.sla : "Standard";
  const severity = ["Critical", "High", "Medium", "Low"].includes(t.data?.severity) ? t.data.severity : "Medium";
  const [rh, xh] = SLA[tier][severity]; const s = Date.parse(t.created_at);
  const rBy = s + rh * H, xBy = s + xh * H;
  const responded = t.data?.responded_at ? Date.parse(t.data.responded_at) : t.status !== "New" ? NaN : null;
  const resolved = t.data?.resolved_at ? Date.parse(t.data.resolved_at) : DONE.test(t.status || "") ? NaN : null;
  const state = (by: number, at: number | null, total: number): SlaState => {
    if (at !== null) return Number.isNaN(at) ? "met" : at <= by ? "met" : "missed";
    return now > by ? "late" : by - now < total * 0.25 ? "soon" : "ok";
  };
  return { tier, severity, start: new Date(s).toISOString(), respondBy: new Date(rBy).toISOString(), resolveBy: new Date(xBy).toISOString(),
    respond: state(rBy, responded, rh * H), resolve: state(xBy, resolved, xh * H), respondLeft: Math.round((rBy - now) / 60e3), resolveLeft: Math.round((xBy - now) / 60e3) };
}

/** "2 h 15 min", "3 d 4 h" — time left (or overdue when negative). */
export function left(min: number, l: "en" | "ru" | "uk" | "ar" = "en") {
  const m = Math.abs(min), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  const U = { en: ["d", "h", "min"], ru: ["д", "ч", "мин"], uk: ["д", "год", "хв"], ar: ["ي", "س", "د"] }[l];
  return d ? `${d} ${U[0]} ${h} ${U[1]}` : h ? `${h} ${U[1]} ${mm} ${U[2]}` : `${mm} ${U[2]}`;
}
