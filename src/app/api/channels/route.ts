import { currentProfile, userClient } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Channel statistics from platform APIs.
 *  status  → which APIs are configured on the server (no secrets returned)
 *  youtube {id} → public subscriber, view and video counts for the channel record (needs YOUTUBE_API_KEY in Vercel);
 *                 updates the channel card and this month's statistics record
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending" || ["partner", "vendor", "investor"].includes(me.role)) return new Response("Not allowed", { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (b.action === "status") return Response.json({ youtube: !!process.env.YOUTUBE_API_KEY });
  const sb = await userClient();

  if (b.action === "youtube") {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return new Response("YouTube is not connected yet: add YOUTUBE_API_KEY in Vercel (see FAQ)", { status: 503 });
    const { data: ch } = await sb.from("records").select("id,title,data").eq("id", b.id).eq("section", "marketing.channels").maybeSingle();
    if (!ch) return new Response("Channel not found", { status: 404 });
    const idv = String(ch.data?.api_id || "").trim(), handle = String(ch.data?.handle || "").trim().replace(/^@?/, "@");
    const q = /^UC[\w-]{20,}$/.test(idv) ? `id=${encodeURIComponent(idv)}` : handle.length > 1 ? `forHandle=${encodeURIComponent(handle)}` : "";
    if (!q) return new Response("Add the channel ID (UC…) or @handle to the channel card", { status: 400 });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&${q}&key=${key}`, { cache: "no-store" });
    if (!r.ok) return new Response(`YouTube answered ${r.status}: check the API key`, { status: 502 });
    const it = (await r.json())?.items?.[0];
    if (!it) return new Response("YouTube channel not found: check the ID or @handle", { status: 404 });
    const st = it.statistics || {}; const subs = Number(st.subscriberCount) || 0, views = Number(st.viewCount) || 0, videos = Number(st.videoCount) || 0;
    const today = new Date().toISOString().slice(0, 10), period = today.slice(0, 7);
    await sb.from("records").update({ data: { ...ch.data, api_id: it.id, followers: subs, as_of: today, connection: "API" }, updated_at: new Date().toISOString() }).eq("id", ch.id);
    // This month's statistics record: create or refresh the totals the API gives
    const { data: ex } = await sb.from("records").select("id,data").eq("section", "marketing.metrics").eq("data->>account", ch.title).eq("data->>period", period).maybeSingle();
    const data = { ...(ex?.data || {}), channel: "YouTube", account: ch.title, period, followers: subs, source: "API", notes: `API ${today}: ${views.toLocaleString("en-US")} total views, ${videos} videos` };
    if (ex) await sb.from("records").update({ data, updated_at: new Date().toISOString() }).eq("id", ex.id);
    else await sb.from("records").insert({ section: "marketing.metrics", title: `${ch.title} · ${period}`, status: "Draft", data, created_by: me.id });
    return Response.json({ title: it.snippet?.title, subscribers: subs, views, videos, as_of: today });
  }
  return new Response("Unknown action", { status: 400 });
}
