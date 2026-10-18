// Team workload: open items with a person and a date (tasks, project steps, requests, purchases…), counted per
// person per week. More than LIMIT items in one week is an overload.

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any> };
export const LIMIT = 8;
const DONE = /^(done|closed|completed|installed|commissioned|delivered|received|paid|cleared|passed|resolved|signed|filed|cancelled|rejected|expired|lost|won|published|archived|retired|decommissioned)$/i;
const SKIP = /\.(metrics)$/;
const who = (r: R) => String(r.data?.assignee || r.data?.owner || "").trim();
const when = (r: R) => String(r.data?.due || r.data?.date || r.data?.eta || "").slice(0, 10);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Monday of the week of a date. */
export const weekOf = (iso: string) => { const t = Date.parse(iso.slice(0, 10) + "T00:00:00Z"); const d = new Date(t).getUTCDay(); return new Date(t - ((d + 6) % 7) * 864e5).toISOString().slice(0, 10); };

export type Person = { full_name?: string | null; email?: string | null };
export type WRow = { who: string; overdue: R[]; weeks: R[][]; total: number; peak: number };

export function workload(all: R[], people: Person[], today: string, weeks = 6): { starts: string[]; rows: WRow[] } {
  const w0 = weekOf(today); const starts = Array.from({ length: weeks }, (_, i) => new Date(Date.parse(w0) + i * 7 * 864e5).toISOString().slice(0, 10));
  const end = new Date(Date.parse(w0) + weeks * 7 * 864e5).toISOString().slice(0, 10);
  // A name or an email in the field → the person's display name
  const label = (raw: string) => { const k = norm(raw); const p = people.find((x) => norm(x.full_name || "") === k || norm(x.email || "") === k || (!!x.email && k.includes(norm(x.email)))); return p?.full_name || p?.email || raw; };
  const map = new Map<string, WRow>();
  for (const r of all) {
    if (SKIP.test(r.section) || DONE.test(r.status || "")) continue;
    const p = who(r), d = when(r); if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= end) continue;
    const name = label(p); const row = map.get(norm(name)) || { who: name, overdue: [], weeks: starts.map(() => []), total: 0, peak: 0 };
    if (d < today) row.overdue.push(r); else row.weeks[starts.findIndex((s, i) => d >= s && (i === starts.length - 1 || d < starts[i + 1]))].push(r);
    row.total++; map.set(norm(name), row);
  }
  const rows = [...map.values()].map((r) => ({ ...r, peak: Math.max(...r.weeks.map((w) => w.length)) })).sort((a, b) => b.peak - a.peak || b.total - a.total);
  return { starts, rows };
}
