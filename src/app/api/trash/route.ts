import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { purgeFiles } from "@/lib/server/trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL = ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security"];

/**
 * Recycle bin: deleted records stay 30 days.
 * list            — what this person may see (the database decides)
 * restore {id}    — puts the record and its comments back; needs write access to the section
 * purge {id}      — owner/admin: delete for good now
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || !INTERNAL.includes(me.role)) return new Response("Not allowed", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const sb = await userClient();
  if (b.action === "list") {
    const { data, error } = await sb.from("records_trash").select("id,section,title,controlled,deleted_by,deleted_at,comments").order("deleted_at", { ascending: false }).limit(300);
    if (error) return new Response(error.message, { status: 500 });
    return Response.json((data || []).map((r: any) => ({ ...r, comments: Array.isArray(r.comments) ? r.comments.length : 0 })));
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("Service key missing", { status: 501 });
  const { data: t } = await sb.from("records_trash").select("*").eq("id", String(b.id || "")).maybeSingle();
  if (!t) return new Response("Not found", { status: 404 });
  const db = adminClient();
  if (b.action === "restore") {
    const full = ["owner", "admin"].includes(me.role);
    if (!full) {
      const { data: rule } = await db.from("section_access").select("can_write").eq("role", me.role).eq("section", t.section).maybeSingle();
      if (!rule?.can_write) return new Response("You cannot change this section", { status: 403 });
    }
    const r = t.record || {};
    const { error } = await db.from("records").insert({ id: t.id, section: r.section, title: r.title, status: r.status, data: r.data || {}, company: r.company ?? null, controlled: !!r.controlled, created_by: r.created_by ?? null, created_at: r.created_at });
    if (error) return new Response(error.message, { status: 500 });
    const cs = (Array.isArray(t.comments) ? t.comments : []).map((c: any) => ({ id: c.id, record_id: t.id, author: c.author ?? null, body: c.body, created_at: c.created_at }));
    if (cs.length) await db.from("comments").insert(cs);
    await db.from("records_trash").delete().eq("id", t.id);
    await db.from("activity").insert({ record_id: t.id, section: t.section, actor: me.id, action: "restored", detail: { title: t.title } }).then(() => {}, () => {});
    return Response.json({ ok: true, section: t.section, id: t.id });
  }
  if (b.action === "purge") {
    if (!["owner", "admin"].includes(me.role)) return new Response("Only owners and administrators", { status: 403 });
    await purgeFiles(db, [t]);
    await db.from("records_trash").delete().eq("id", t.id);
    return Response.json({ ok: true });
  }
  return new Response("Unknown action", { status: 400 });
}
