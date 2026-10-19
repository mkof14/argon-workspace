import { adminClient } from "@/lib/server/supabase";
import { portalData, portalRequest } from "@/lib/server/portal";
import { limit, clientIp } from "@/lib/server/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, for the client's link only: {token} → what the client may see; {token, request} → a service request. */
export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("Not available", { status: 503 });
  const b = await req.json().catch(() => ({}));
  const db = adminClient(); const token = String(b.token || "");
  const lim = await limit(`portal:${clientIp(req)}`, b.request ? 10 : 60, 60, db); if (lim) return lim;
  if (b.request) return Response.json(await portalRequest(db, token, b.request));
  const v = await portalData(db, token);
  return v ? Response.json(v, { headers: { "Cache-Control": "no-store" } }) : new Response("This link is not valid any more", { status: 404 });
}
