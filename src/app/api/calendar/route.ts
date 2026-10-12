import { randomBytes } from "node:crypto";
import { adminClient, currentProfile } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const INTERNAL = ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security"];
const SITE = "https://workspace.agron1.com";
const out = (row: any) => (row ? { url: `${SITE}/api/calendar/feed/${row.token}.ics`, scope: row.scope, last_fetch: row.last_fetch } : null);

/** My calendar link: get / create (or replace) / delete. The link itself is the key, so replacing it cuts off old copies. */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || !INTERNAL.includes(me.role)) return new Response("Not allowed", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  if (b.action === "create") {
    const row = { user_id: me.id, token: randomBytes(24).toString("base64url"), scope: b.scope === "all" ? "all" : "mine", created_at: new Date().toISOString(), last_fetch: null };
    const { error } = await db.from("calendar_feeds").upsert(row, { onConflict: "user_id" });
    if (error) return new Response(error.message, { status: 500 });
    return Response.json(out(row));
  }
  if (b.action === "scope") {
    await db.from("calendar_feeds").update({ scope: b.scope === "all" ? "all" : "mine" }).eq("user_id", me.id);
  }
  if (b.action === "delete") { await db.from("calendar_feeds").delete().eq("user_id", me.id); return Response.json(null); }
  const { data } = await db.from("calendar_feeds").select("token,scope,last_fetch").eq("user_id", me.id).maybeSingle();
  return Response.json(out(data));
}
