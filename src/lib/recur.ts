// Repeating records: when a repeating task, filing or check is completed, the next one is prepared with new dates.

export const REPEATS = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type Repeat = (typeof REPEATS)[number];
/** Statuses that mean "this occurrence is finished". */
export const DONE = /^(done|closed|completed|filed|filed \/ approved|paid|resolved|answered|submitted|signed|delivered|passed|implemented|commissioned|renewed|held|minutes signed|training done|certified|adopted|issued|registered|granted|cleared)$/i;

export function addPeriod(iso: string, r: Repeat): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); if (!m) return iso;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  if (r === "weekly") { const t = new Date(Date.UTC(y, mo, d + 7)); return t.toISOString().slice(0, 10); }
  const add = r === "monthly" ? 1 : r === "quarterly" ? 3 : 12;
  const last = new Date(Date.UTC(y, mo + add + 1, 0)).getUTCDate(); // 31 Jan + 1 month → 28/29 Feb
  return new Date(Date.UTC(y, mo + add, Math.min(d, last))).toISOString().slice(0, 10);
}

type Field = { key: string; type: string };
/** The next occurrence of a completed repeating record, or null when it should not repeat. */
export function nextOccurrence(rec: { id: string; title: string; status: string | null; data: Record<string, any> }, fields: Field[], firstStatus: string) {
  // Our own "Repeat" setting, or the "Repeats" field some sections already have (Monthly / Quarterly / Annual)
  const FREQ: Record<string, Repeat> = { Weekly: "weekly", Monthly: "monthly", Quarterly: "quarterly", Annual: "yearly", Yearly: "yearly" };
  const r = (rec.data?.repeat || FREQ[rec.data?.frequency]) as Repeat;
  if (!REPEATS.includes(r) || !DONE.test(rec.status || "")) return null;
  const data: Record<string, any> = { ...rec.data, _prev: rec.id };
  for (const k of Object.keys(data)) if (/^(done|completed|closed|paid_on|filed_on|resolved_on|done_date|completed_on|paid_date)$/.test(k)) delete data[k];
  let moved = 0;
  for (const f of fields) if (f.type === "date" && typeof data[f.key] === "string" && /^\d{4}-\d{2}-\d{2}/.test(data[f.key])) { data[f.key] = addPeriod(data[f.key], r); moved++; }
  if (!moved) return null; // nothing to move forward: no date, no new occurrence
  delete data._tr; // texts are the same; translations come back on the next pass
  return { title: rec.title, status: firstStatus, data };
}
