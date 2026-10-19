// Which backups to keep: one a day for 14 days, every Monday for 8 weeks, the first of each month for 12 months.
// Pure: takes backup names with their dates (YYYY-MM-DD), returns what stays and what goes. The newest always stays.

export type Kept = { name: string; date: string };
export const RETENTION = { daily: 14, weekly: 8, monthly: 12 };

export function retention(items: Kept[], today: string, r = RETENTION): { keep: string[]; drop: string[] } {
  const t = Date.parse(today + "T00:00:00Z"); const age = (d: string) => Math.round((t - Date.parse(d + "T00:00:00Z")) / 864e5);
  const newestFirst = [...items].sort((a, b) => (a.date === b.date ? b.name.localeCompare(a.name) : b.date.localeCompare(a.date)));
  const keep = new Set<string>(); if (newestFirst[0]) keep.add(newestFirst[0].name);
  const newestOfDay = new Map<string, string>(); for (const it of newestFirst) if (!newestOfDay.has(it.date)) newestOfDay.set(it.date, it.name);
  for (const [d, name] of newestOfDay) {
    const a = age(d); const monday = new Date(d + "T00:00:00Z").getUTCDay() === 1;
    if (a <= r.daily) keep.add(name);
    if (monday && a <= r.weekly * 7) keep.add(name);
  }
  const firstOfMonth = new Map<string, Kept>(); for (const it of [...newestFirst].reverse()) if (!firstOfMonth.has(it.date.slice(0, 7))) firstOfMonth.set(it.date.slice(0, 7), it);
  for (const it of firstOfMonth.values()) if (age(it.date) <= r.monthly * 31) keep.add(it.name);
  return { keep: newestFirst.filter((x) => keep.has(x.name)).map((x) => x.name), drop: newestFirst.filter((x) => !keep.has(x.name)).map((x) => x.name) };
}
