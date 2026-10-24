import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { limit } from "@/lib/server/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Access log for export-controlled data (technology control plan).
 * POST {record_id, file?} — written when someone opens a controlled record or one of its files; once per person, record and file per 10 minutes.
 * Readable by owners, administrators and the security role (section "security.log").
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not signed in", { status: 401 });
  const lim = await limit(`log:${me.id}`, 120, 60); if (lim) return lim;
  const b = await req.json().catch(() => ({}));
  const sb = await userClient();
  const { data: r } = await sb.from("records").select("id,section,title,controlled").eq("id", String(b.record_id || "")).maybeSingle();
  if (!r?.controlled) return Response.json({ logged: false });
  const file = b.file ? String(b.file).slice(0, 200) : null;
  const db = adminClient();
  const since = new Date(Date.now() - 10 * 60e3).toISOString();
  let q = db.from("activity").select("id").eq("section", "security.log").eq("actor", me.id).eq("record_id", r.id).gte("created_at", since);
  q = file ? q.eq("detail->>file", file) : q.is("detail->>file", null);
  const { data: recent } = await q.limit(1);
  if (recent?.length) return Response.json({ logged: false, recent: true });
  await db.from("activity").insert({ record_id: r.id, section: "security.log", actor: me.id, action: file ? "file opened" : "viewed",
    detail: { title: r.title, section: r.section, file, email: me.email, name: me.full_name, role: me.role, us_person: !!me.us_person } });
  return Response.json({ logged: true });
}
