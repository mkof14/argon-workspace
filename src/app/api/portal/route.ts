import { adminClient, currentProfile } from "@/lib/server/supabase";
import { hashToken, newToken } from "@/lib/server/portal";
import { SITE } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client portal links, managed from the client's record (sales.clients).
 * list {client_id} · create {client_id, days, lang} → the link (shown once) · revoke {id}
 * Who: owner/admin, or roles that may change Sales → Clients.
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me) return new Response("Not allowed", { status: 403 });
  const db = adminClient(); const b = await req.json().catch(() => ({}));
  if (!["owner", "admin"].includes(me.role)) {
    const { data: rule } = await db.from("section_access").select("can_write").eq("role", me.role).eq("section", "sales.clients").maybeSingle();
    if (!rule?.can_write) return new Response("You cannot manage client links", { status: 403 });
  }
  if (b.action === "list") {
    const { data } = await db.from("client_portal").select("id,label,lang,created_at,expires_at,revoked_at,last_seen,created_by").eq("client_id", String(b.client_id || "")).order("created_at", { ascending: false });
    return Response.json(data || []);
  }
  if (b.action === "create") {
    const { data: c } = await db.from("records").select("id,section,controlled").eq("id", String(b.client_id || "")).maybeSingle();
    if (!c || c.section !== "sales.clients") return new Response("Client not found", { status: 404 });
    if (c.controlled) return new Response("US-persons-only clients cannot have a portal link", { status: 400 });
    const token = newToken(); const days = Math.min(365, Math.max(7, Number(b.days) || 180));
    const { error } = await db.from("client_portal").insert({ client_id: c.id, token_hash: hashToken(token), label: String(b.label || "").slice(0, 80) || null, lang: ["en", "ru", "uk", "ar"].includes(b.lang) ? b.lang : "en", created_by: me.id, expires_at: new Date(Date.now() + days * 864e5).toISOString() });
    if (error) return new Response(error.message, { status: 500 });
    await db.from("activity").insert({ record_id: c.id, section: "sales.clients", actor: me.id, action: "portal link", detail: { days } }).then(() => {}, () => {});
    return Response.json({ url: `${SITE}/portal/${token}` });
  }
  if (b.action === "revoke") {
    await db.from("client_portal").update({ revoked_at: new Date().toISOString() }).eq("id", String(b.id || ""));
    return Response.json({ ok: true });
  }
  return new Response("Unknown action", { status: 400 });
}
