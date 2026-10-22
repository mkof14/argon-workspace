import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { PUSH, pushTo, vapid } from "@/lib/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL = ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security", "procurement"];

/**
 * Notifications on phones and computers.
 * GET                               — the public key a device needs to subscribe
 * subscribe {sub} / unsubscribe {endpoint} / test
 * mention {record_id, body}         — after a comment: tells the people named with @Name who may read the record
 */
export async function GET() {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not allowed", { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("Service key missing", { status: 501 });
  return Response.json({ key: (await vapid(adminClient())).pub });
}

export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not allowed", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const sb = await userClient();
  if (b.action === "subscribe") {
    const s = b.sub || {};
    if (!/^https:\/\//.test(s.endpoint || "") || !s.keys?.p256dh || !s.keys?.auth) return new Response("Bad subscription", { status: 400 });
    const { error } = await sb.from("push_subs").upsert({ endpoint: s.endpoint, user_id: me.id, p256dh: s.keys.p256dh, auth: s.keys.auth, ua: String(req.headers.get("user-agent") || "").slice(0, 200) });
    return error ? new Response(error.message, { status: 500 }) : Response.json({ ok: true });
  }
  if (b.action === "unsubscribe") { await sb.from("push_subs").delete().eq("endpoint", String(b.endpoint || "")); return Response.json({ ok: true }); }
  const db = adminClient();
  if (b.action === "test") return Response.json({ sent: await pushTo(db, [me.id], (l) => ({ title: PUSH.test_t[l], body: PUSH.test_b[l], url: "/today", tag: "test" })) });
  if (b.action === "mention" && INTERNAL.includes(me.role)) {
    // The comment must exist and be the person's own
    const { data: c } = await sb.from("comments").select("id,body,record_id").eq("record_id", String(b.record_id || "")).eq("author", me.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!c) return Response.json({ sent: 0 });
    const { data: rec } = await db.from("records").select("id,section,title,controlled").eq("id", c.record_id).maybeSingle();
    if (!rec) return Response.json({ sent: 0 });
    const names = [...c.body.matchAll(/@([\p{L}][\p{L}'-]+)/gu)].map((m: any) => m[1].toLowerCase());
    if (!names.length) return Response.json({ sent: 0 });
    const [{ data: people }, { data: rules }] = await Promise.all([db.from("profiles").select("id,full_name,email,role,us_person"), db.from("section_access").select("role").eq("section", rec.section)]);
    const can = new Set((rules || []).map((r: any) => r.role));
    const to = (people || []).filter((p: any) => p.id !== me.id && INTERNAL.includes(p.role) && (["owner", "admin"].includes(p.role) || can.has(p.role)) && (!rec.controlled || p.us_person)
      && names.some((n) => String(p.full_name || "").toLowerCase().split(/\s+/).includes(n) || String(p.email || "").toLowerCase().startsWith(n)));
    const who = String(me.full_name || me.email).split(" ")[0];
    const sent = await pushTo(db, to.map((p: any) => p.id), (l) => ({ title: PUSH.mention_t[l].replace("{n}", who), body: `${rec.controlled ? "US-persons-only record" : rec.title}: ${c.body}`.slice(0, 200), url: `/${rec.section.replace(".", "/")}?r=${rec.id}`, tag: `m-${c.id}` }));
    return Response.json({ sent });
  }
  return new Response("Unknown action", { status: 400 });
}
