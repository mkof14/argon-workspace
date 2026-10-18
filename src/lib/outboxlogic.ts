// Offline outbox: changes made without a connection wait on the device and are sent in order when it returns.
// Pure queue logic (tested); the browser storage lives in lib/outbox.ts.

export type OutItem =
  | { id: string; kind: "save"; at: string; user: string; rec: Record<string, any>; error?: string }
  | { id: string; kind: "comment"; at: string; user: string; record_id: string; body: string; error?: string }
  | { id: string; kind: "upload"; at: string; user: string; prefix: string; name: string; type: string; file: Blob; error?: string };

export const isTemp = (id: any) => typeof id === "string" && id.startsWith("off-");

/** Adds a record save. A record created offline and changed again stays one item; repeated changes of one record merge. */
export function enqueueSave(q: OutItem[], rec: Record<string, any>, at: string, user: string, newId: () => string): { q: OutItem[]; id: string } {
  const id = rec.id || `off-${newId()}`; const full: Record<string, any> = { ...rec, id };
  const i = q.findIndex((x) => x.kind === "save" && x.rec.id === id && !x.error);
  if (i >= 0) { const old = q[i] as Extract<OutItem, { kind: "save" }>; const merged = { ...old.rec, ...full, data: { ...(old.rec.data || {}), ...(full.data || {}) } }; return { q: q.map((x, k) => (k === i ? { ...old, at, rec: merged } : x)), id }; }
  return { q: [...q, { id: `q-${newId()}`, kind: "save", at, user, rec: full }], id };
}

/** After a temporary record got its real id, later items point to the real one. */
export function remap(q: OutItem[], from: string, to: string): OutItem[] {
  const fix = (s: string) => (s === from ? to : s.startsWith(`${from}`) ? to + s.slice(from.length) : s);
  return q.map((x) => x.kind === "save" ? (x.rec.id === from ? { ...x, rec: { ...x.rec, id: to } } : x)
    : x.kind === "comment" ? { ...x, record_id: fix(x.record_id) } : { ...x, prefix: x.prefix.split("/").map(fix).join("/") });
}

/** The connection is the problem (try later), not the data (show the error). */
export const isNetworkError = (e: any) => /failed to fetch|network|load failed|fetch failed|offline|timeout/i.test(String(e?.message || e || ""));
