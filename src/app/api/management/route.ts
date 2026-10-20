import { adminClient, userClient } from "@/lib/server/supabase";
import { limit, requireUser } from "@/lib/server/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Management dashboard data that ordinary row-level security does not show to a manager: every approval still
 * waiting in the company (who asked, who decides, how long). Management, administrators and owners only, and only
 * for records the caller may open (US-persons-only and partner-only records stay hidden).
 */
export async function POST(req: Request) {
  const u = await requireUser("lead"); if (u instanceof Response) return u;
  { const lim = await limit(`management:${u.me.id}`, 30, 60); if (lim) return lim; }
  const b = await req.json().catch(() => ({}));
  if (b.action !== "approvals") return new Response("Unknown action", { status: 400 });
  const db = adminClient();
  const { data: ap, error } = await db.from("approvals").select("id,record_id,section,requested_by,approver_id,status,created_at,decided_at").in("status", ["pending", "changes_requested"]).order("created_at").limit(500);
  if (error) return new Response(error.message, { status: 500 });
  const ids = [...new Set((ap || []).map((a: any) => a.record_id))];
  const sb = await userClient(); // what the caller may open
  const { data: vis } = ids.length ? await sb.from("records").select("id,title,section,status").in("id", ids) : { data: [] as any[] };
  const byId = new Map((vis || []).map((r: any) => [r.id, r]));
  const now = Date.now();
  return Response.json((ap || []).filter((a: any) => byId.has(a.record_id)).map((a: any) => ({ ...a, title: byId.get(a.record_id).title, record_status: byId.get(a.record_id).status, age_days: Math.floor((now - Date.parse(a.created_at)) / 864e5) })));
}
