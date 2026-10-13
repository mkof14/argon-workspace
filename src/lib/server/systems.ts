import { timedGet } from "./safefetch";

/** Opens each system's health or main link and saves status and response time. `db` decides what may be read and saved. */
export async function checkSystems(db: any, ids?: string[]) {
  let q = db.from("records").select("id,title,status,data").eq("section", "technical.systems").neq("status", "Retired");
  if (ids?.length) q = q.in("id", ids.slice(0, 40));
  const { data: rows } = await q.limit(40);
  const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return Promise.all((rows || []).map(async (r: any) => {
    const url = r.data?.health_url || r.data?.url;
    if (!url) return { id: r.id, title: r.title, status: r.status, skipped: true };
    const res = await timedGet(url);
    const status = !res.ok ? (res.status >= 500 || !res.status ? "Down" : "Degraded") : res.ms > 3000 ? "Degraded" : "Operational";
    const last = `${now} · ${res.ok ? `HTTP ${res.status}` : res.error || `HTTP ${res.status}`}`;
    await db.from("records").update({ status, data: { ...r.data, last_check: last, latency: res.ms }, updated_at: new Date().toISOString() }).eq("id", r.id);
    return { id: r.id, title: r.title, url, status, http: res.status, ms: res.ms, error: res.error || null, last_check: last, was: r.status };
  }));
}
