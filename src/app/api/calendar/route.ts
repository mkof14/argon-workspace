import { adminClient } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/authz";
import { hashToken, newToken } from "@/lib/server/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://workspace.agron1.com").replace(/\/+$/, ""); // production sets the same address; a staging preview sets its own

/**
 * My calendar link: get / create (or replace) / scope / delete. The link itself is the key; the database keeps only
 * its SHA-256, so the full link is shown once, right after it is made. Replacing it cuts off old copies.
 * A link is valid for a year; making a new one starts a new year.
 */
export async function POST(req: Request) {
  const g = await requireUser("internal"); if (g instanceof Response) return g; const me = g.me;
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  if (b.action === "create") {
    const token = newToken();
    const row = { user_id: me.id, token: null, token_hash: hashToken(token), scope: b.scope === "all" ? "all" : "mine", created_at: new Date().toISOString(), last_fetch: null, revoked_at: null, expires_at: new Date(Date.now() + 365 * 864e5).toISOString() };
    const { error } = await db.from("calendar_feeds").upsert(row, { onConflict: "user_id" });
    if (error) return new Response(error.message, { status: 500 });
    return Response.json({ url: `${SITE}/api/calendar/feed/${token}.ics`, scope: row.scope, last_fetch: null, expires_at: row.expires_at, shown_once: true });
  }
  if (b.action === "scope") await db.from("calendar_feeds").update({ scope: b.scope === "all" ? "all" : "mine" }).eq("user_id", me.id);
  if (b.action === "delete") { await db.from("calendar_feeds").delete().eq("user_id", me.id); return Response.json(null); }
  const { data } = await db.from("calendar_feeds").select("scope,last_fetch,expires_at,revoked_at,token").eq("user_id", me.id).maybeSingle();
  if (!data || data.revoked_at) return Response.json(null);
  // links made before v18 still show once more; new ones are never readable again
  return Response.json({ url: data.token ? `${SITE}/api/calendar/feed/${data.token}.ics` : null, scope: data.scope, last_fetch: data.last_fetch, expires_at: data.expires_at });
}
