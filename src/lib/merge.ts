// Three-way merge of a record: what I opened (base), what I changed (mine) and what is in the database now (theirs).
// Fields only one side changed are taken from that side; a field both sides changed differently is a conflict
// the person decides. Pure.

export type RecLike = { title?: string; status?: string | null; company?: string | null; controlled?: boolean; data?: Record<string, any> };
export type Conflict = { field: string; base: any; mine: any; theirs: any };
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const TOP = ["title", "status", "company", "controlled"] as const;

export function merge3(base: RecLike, mine: RecLike, theirs: RecLike): { merged: RecLike; conflicts: Conflict[]; auto: string[] } {
  const merged: RecLike = { ...theirs, data: { ...(theirs.data || {}) } }; const conflicts: Conflict[] = []; const auto: string[] = [];
  const take = (field: string, b: any, m: any, t: any, set: (v: any) => void) => {
    if (same(m, b)) return;                        // I did not change it: keep theirs
    if (same(t, b) || same(m, t)) { set(m); if (!same(m, t)) auto.push(field); return; } // only I changed it
    conflicts.push({ field, base: b, mine: m, theirs: t });
  };
  for (const k of TOP) take(k, (base as any)[k], (mine as any)[k], (theirs as any)[k], (v) => ((merged as any)[k] = v));
  const keys = new Set([...Object.keys(base.data || {}), ...Object.keys(mine.data || {}), ...Object.keys(theirs.data || {})]);
  for (const k of keys) {
    if (k === "_tr") continue; // translations follow the newest text and are rebuilt by the server
    take(`data.${k}`, base.data?.[k], mine.data?.[k], theirs.data?.[k], (v) => { if (v === undefined) delete merged.data![k]; else merged.data![k] = v; });
  }
  return { merged, conflicts, auto };
}

/** Applies the person's choices: for each conflicting field "mine" or "theirs". */
export function resolve(merged: RecLike, conflicts: Conflict[], choice: Record<string, "mine" | "theirs">): RecLike {
  const out: RecLike = { ...merged, data: { ...(merged.data || {}) } };
  for (const c of conflicts) {
    const v = (choice[c.field] || "theirs") === "mine" ? c.mine : c.theirs;
    if (c.field.startsWith("data.")) { const k = c.field.slice(5); if (v === undefined) delete out.data![k]; else out.data![k] = v; }
    else (out as any)[c.field] = v;
  }
  return out;
}
