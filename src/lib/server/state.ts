/**
 * Operational state (last monitoring run, e-mail intake position, agent findings…) in the ops_state table.
 * Before v18 these were JSON files in the private "backups" bucket; a key that is not in the table yet is read
 * once from its old file, so nothing is lost when the new version starts.
 */
export async function readState(db: any, key: string): Promise<any> {
  const { data, error } = await db.from("ops_state").select("value").eq("key", key).maybeSingle();
  if (!error && data) return data.value;
  // the old place (until the first write moves it)
  try { const { data: f } = await db.storage.from("backups").download(`state/${key}.json`); if (f) return JSON.parse(await f.text()); } catch {}
  return null;
}
export async function saveState(db: any, key: string, value: unknown) {
  const { error } = await db.from("ops_state").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`state ${key}: ${error.message}`);
}
/** Read-change-write without losing a parallel change: retries when the version moved in between. */
export async function updateState<T>(db: any, key: string, fn: (cur: T | null) => T, tries = 5): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const { data } = await db.from("ops_state").select("value,version").eq("key", key).maybeSingle();
    const next = fn(data ? (data.value as T) : ((await readState(db, key)) as T | null));
    if (!data) { const { error } = await db.from("ops_state").insert({ key, value: next }); if (!error) return next; continue; }
    const { data: upd } = await db.from("ops_state").update({ value: next, version: data.version + 1, updated_at: new Date().toISOString() }).eq("key", key).eq("version", data.version).select("key");
    if (upd?.length) return next;
  }
  throw new Error(`state ${key}: too many parallel changes`);
}

/** "Already done" keys, claimed atomically: returns the keys this call may act on. repeat = days before the same key may fire again (null = never). */
export async function claimKeys(db: any, items: { key: string; repeat?: number | null }[]): Promise<Set<string>> {
  const uniq = [...new Map(items.map((i) => [i.key, i])).values()];
  if (!uniq.length) return new Set();
  const out = new Set<string>();
  for (let i = 0; i < uniq.length; i += 500) {
    const part = uniq.slice(i, i + 500);
    const { data, error } = await db.rpc("automation_claim_keys", { p_keys: part.map((x) => x.key), p_repeat: part.map((x) => (x.repeat == null ? null : x.repeat)) });
    if (error) throw new Error(`claim keys: ${error.message}`);
    for (const r of data || []) out.add(typeof r === "string" ? r : r.automation_claim_keys ?? Object.values(r)[0]);
  }
  return out;
}
/** Gives a key back (the action it guarded did not happen), so the next run tries again. */
export async function releaseKeys(db: any, keys: string[]) { if (keys.length) await db.from("automation_fired").delete().in("key", keys); }
