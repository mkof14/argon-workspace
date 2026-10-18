import crypto from "node:crypto";
import { portalView } from "@/lib/portal";
import { PUSH, pushTo } from "./push";

// Client portal links: a long random token (only its hash is stored), valid 180 days, can be revoked any time.
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const newToken = () => crypto.randomBytes(24).toString("base64url");
const SECS = ["sales.pipeline", "operations.builds", "operations.logistics", "operations.installation", "operations.fleet", "sales.proposals", "finance.invoices", "operations.support"];

export async function resolve(db: any, token: string) {
  if (!/^[\w-]{20,64}$/.test(token || "")) return null;
  const { data: link } = await db.from("client_portal").select("*").eq("token_hash", hashToken(token)).maybeSingle();
  if (!link || link.revoked_at || Date.parse(link.expires_at) < Date.now()) return null;
  const { data: client } = await db.from("records").select("id,section,title,status,data,controlled").eq("id", link.client_id).maybeSingle();
  if (!client || client.controlled) return null;
  return { link, client };
}

/** Everything the client may see, with short-lived download links for proposal PDFs. */
export async function portalData(db: any, token: string) {
  const r = await resolve(db, token); if (!r) return null;
  const { data: recs } = await db.from("records").select("id,section,title,status,data,controlled,updated_at").in("section", SECS).limit(5000);
  const v = portalView(r.client, recs || []);
  const st = db.storage.from("files");
  const proposals = await Promise.all(v.proposals.map(async (p) => {
    const { data: files } = await st.list(`sales.proposals/${p.id}`, { limit: 20 });
    const pdf = (files || []).filter((f: any) => f.id && /\.pdf$/i.test(f.name)).sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)))[0];
    let url: string | null = null;
    if (pdf) { const { data } = await st.createSignedUrl(`sales.proposals/${p.id}/${pdf.name}`, 3600, { download: pdf.name.replace(/^\d+_/, "") }); url = data?.signedUrl || null; }
    return { ...p, pdf: url };
  }));
  await db.from("client_portal").update({ last_seen: new Date().toISOString() }).eq("id", r.link.id);
  return { ...v, proposals, lang: r.link.lang || "en", expires: r.link.expires_at };
}

/** A service request from the client: a new support record, and a signal to the operations team. At most 5 a day per link. */
export async function portalRequest(db: any, token: string, req: { title: string; severity: string; notes: string; unit_id?: string; contact?: string }) {
  const r = await resolve(db, token); if (!r) return { ok: false, reason: "expired" };
  const day = new Date().toISOString().slice(0, 10);
  const n = r.link.requests_day === day ? r.link.requests_today : 0;
  if (n >= 5) return { ok: false, reason: "limit" };
  const title = String(req.title || "").trim().slice(0, 160); if (title.length < 3) return { ok: false, reason: "title" };
  const severity = ["Low", "Medium", "High", "Critical"].includes(req.severity) ? req.severity : "Medium";
  let unit: string | undefined;
  if (req.unit_id) { const { data: u } = await db.from("records").select("id,data,controlled").eq("id", req.unit_id).eq("section", "operations.fleet").maybeSingle(); if (u && !u.controlled) unit = u.id; }
  const notes = [`From the client portal (${r.client.title})`, req.contact ? `Contact: ${String(req.contact).slice(0, 200)}` : "", String(req.notes || "").slice(0, 4000)].filter(Boolean).join("\n\n");
  const { data: rec, error } = await db.from("records").insert({ section: "operations.support", title, status: "New", data: { client: r.client.title, severity, notes, unit_ref: unit, source: "portal" } }).select("id").single();
  if (error) return { ok: false, reason: error.message };
  await db.from("client_portal").update({ requests_today: n + 1, requests_day: day }).eq("id", r.link.id);
  const { data: ops } = await db.from("profiles").select("id").in("role", ["operations", "owner", "admin"]);
  await pushTo(db, (ops || []).map((p: any) => p.id), (l) => ({ title: PUSH.portal_t[l], body: `${r.client.title}: ${title} (${severity})`, url: `/operations/support?r=${rec.id}`, tag: `portal-${rec.id}` })).catch(() => 0);
  return { ok: true };
}
