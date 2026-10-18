// Planned maintenance and warranty of installed units. The service interval follows the unit's service plan;
// when a planned-service request is resolved, the unit's next service date moves forward by that interval.

type R = { id: string; section: string; title?: string; status?: string | null; data: Record<string, any> };

/** Months between planned services, by service plan. */
export const PM_MONTHS: Record<string, number> = { "Premium 24/7": 3, Standard: 6, Basic: 12 };
export const pmMonths = (sla?: string) => PM_MONTHS[sla || ""] || PM_MONTHS.Standard;
/** Warranty reminder: this many days before the end a service contract is offered. */
export const WARRANTY_NOTICE = 60;

export function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
const isDate = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);

/** The next planned services of a unit (the first is its next_service, or one interval after commissioning). */
export function servicePlan(unit: R, count = 4) {
  const n = pmMonths(unit.data?.sla);
  const first = isDate(unit.data?.next_service) ? unit.data.next_service.slice(0, 10) : isDate(unit.data?.commissioned) ? addMonths(unit.data.commissioned, n) : null;
  if (!first) return [];
  return Array.from({ length: count }, (_, i) => addMonths(first, i * n));
}

export type Warranty = { state: "none" | "ok" | "soon" | "ended"; left: number | null; end: string | null };
export function warranty(unit: R, today: string): Warranty {
  const end = isDate(unit.data?.warranty_end) ? unit.data.warranty_end.slice(0, 10) : null; if (!end) return { state: "none", left: null, end: null };
  const left = days(today, end);
  return { state: left < 0 ? "ended" : left <= WARRANTY_NOTICE ? "soon" : "ok", left, end };
}

/** A planned-service request was resolved: what changes in its unit (null = nothing). */
export function serviceDone(ticket: R, unit: R | null | undefined, today: string) {
  if (!unit || ticket.section !== "operations.support" || !ticket.data?.pm || !/^(resolved|closed)$/i.test(ticket.status || "")) return null;
  if (unit.data?.last_service === today) return null;
  return { id: unit.id, status: unit.status === "Maintenance due" ? "Active" : unit.status, data: { ...unit.data, last_service: today, next_service: addMonths(today, pmMonths(unit.data?.sla)) } };
}

/** Title of the service-contract deal offered when the warranty ends (also used to avoid duplicates). */
export const renewalTitle = (unit: { title?: string }) => `Service contract — ${unit.title || ""}`.trim();
