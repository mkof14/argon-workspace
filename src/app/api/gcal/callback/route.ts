import { adminClient, currentProfile } from "@/lib/server/supabase";
import { connect, stateUser, syncUser } from "@/lib/server/gcal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Google sends the person back here after they agree; the signed state must match the signed-in person. */
export async function GET(req: Request) {
  const u = new URL(req.url); const me = await currentProfile();
  const back = (q: string) => Response.redirect(`${u.origin}/me?gcal=${q}`, 302);
  if (u.searchParams.get("error")) return back("declined");
  const who = stateUser(u.searchParams.get("state") || "");
  if (!me || !who || who !== me.id) return back("expired");
  try { const db = adminClient(); await connect(db, me.id, u.searchParams.get("code") || ""); await syncUser(db, me.id); return back("ok"); }
  catch (e: any) { return back(encodeURIComponent(String(e?.message || "error").slice(0, 120))); }
}
