import { adminClient, currentProfile } from "@/lib/server/supabase";
import { authUrl, disconnect, gcalConfigured, syncUser } from "@/lib/server/gcal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INTERNAL = ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security"];

/** GET ?start=1 — go to Google to connect; GET — status. POST {action: sync | disconnect}. */
export async function GET(req: Request) {
  const me = await currentProfile();
  if (!me || !INTERNAL.includes(me.role)) return new Response("Not allowed", { status: 403 });
  if (new URL(req.url).searchParams.get("start")) {
    if (!gcalConfigured()) return new Response("Google Calendar is not set up yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)", { status: 503 });
    return Response.redirect(authUrl(me.id), 302);
  }
  const { data } = await adminClient().from("gcal_links").select("google_email,last_sync,last_error,connected_at").eq("user_id", me.id).maybeSingle();
  return Response.json({ configured: gcalConfigured(), link: data || null });
}

export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || !INTERNAL.includes(me.role)) return new Response("Not allowed", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  if (b.action === "sync") return Response.json(await syncUser(db, me.id));
  if (b.action === "disconnect") { await disconnect(db, me.id); return Response.json({ ok: true }); }
  return new Response("Unknown action", { status: 400 });
}
