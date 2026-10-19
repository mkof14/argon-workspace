/**
 * Record writes from the server that never overwrite a change a person made in the meantime.
 *  patchRecord — read, change, write only if the version is still the one read; retried a few times.
 *  applyOps    — several records changed as one step in one database transaction (records_apply).
 */
export class Conflict extends Error { constructor(m = "The record changed while it was being updated") { super(m); this.name = "Conflict"; } }

export async function patchRecord(db: any, id: string, fn: (rec: any) => { status?: string | null; title?: string; data?: Record<string, any> } | null, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const { data: rec, error } = await db.from("records").select("id,section,title,status,data,version,controlled,created_by,company").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message); if (!rec) return null;
    const ch = fn(rec); if (!ch) return rec;
    const { data: upd, error: e2 } = await db.from("records").update(ch).eq("id", id).eq("version", rec.version).select("id,version");
    if (e2) throw new Error(e2.message);
    if (upd?.length) return { ...rec, ...ch, version: upd[0].version };
  }
  throw new Conflict();
}

export type Op = { op: "insert"; row: Record<string, any> } | { op: "update"; id: string; set: { status?: string | null; title?: string; data?: Record<string, any> }; if_version?: number };
export async function applyOps(db: any, ops: Op[]) {
  if (!ops.length) return [];
  const { data, error } = await db.rpc("records_apply", { p_ops: ops });
  if (error) { if (/conflict/i.test(error.message) || error.code === "40001") throw new Conflict(error.message); throw new Error(error.message); }
  return data as { op: string; id: string }[];
}
/** Runs a multi-record step; if a record moved meanwhile, reads again and recomputes (up to 3 times). */
export async function step(db: any, build: () => Promise<Op[]>, tries = 3) {
  for (let i = 0; ; i++) {
    try { return await applyOps(db, await build()); }
    catch (e) { if (!(e instanceof Conflict) || i >= tries - 1) throw e; }
  }
}
