import { adminClient } from "@/lib/server/supabase";
import { allSections, defaultRules } from "@/config/workspace.config.mjs";
import { dueItems, isMine } from "@/lib/insights";
import { ics } from "@/lib/ics";
import { tx } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECS: any[] = allSections() as any[];
const SITE = "https://workspace.agron1.com";
const INTERNAL = ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security"];

/** Private calendar subscription: GET /api/calendar/feed/<token>.ics — the person's open deadlines as all-day events. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return new Response("Not found", { status: 404 });
  const db = adminClient();
  const { data: feed } = await db.from("calendar_feeds").select("user_id,scope").eq("token", token).maybeSingle();
  if (!feed) return new Response("Not found", { status: 404 });
  const { data: p } = await db.from("profiles").select("*").eq("id", feed.user_id).single();
  if (!p || !INTERNAL.includes(p.role)) return new Response("Not found", { status: 404 });

  // Same visibility the database enforces for this user (as in the morning digest)
  const [{ data: rules }, { data: recs }] = await Promise.all([
    db.from("section_access").select("section,role"),
    db.from("records").select("id,section,title,status,data,controlled,created_by").neq("section", "legal.matrix").neq("section", "mail.outbox").limit(10000),
  ]);
  const full = p.role === "owner" || p.role === "admin";
  const rr = (rules?.length ? rules : defaultRules()) as any[];
  const readable = new Set(full ? SECS.map((s) => s.id) : rr.filter((r) => r.role === p.role).map((r) => r.section));
  const visible = (recs || []).filter((r: any) => readable.has(r.section) && (!r.controlled || p.us_person));
  let items = dueItems(visible as any, 730).filter((x) => x.d >= -60);
  if (feed.scope !== "all") items = items.filter((x) => isMine(x.r, p));
  const lang = p.lang || "en";
  const events = items.slice(0, 1000).map(({ r, k }) => {
    const s = SECS.find((x) => x.id === r.section); const f = s?.fields.find((x: any) => x.key === k);
    const url = `${SITE}/${r.section.replace(".", "/")}?r=${r.id}`;
    return { uid: `${r.id}-${k}@agron1.com`, date: String(r.data[k]), summary: `${r.title} · ${tx(f?.label, lang) || k}`,
      description: [tx(s?.label, lang), r.status, r.data?.owner || r.data?.assignee || "", url].filter(Boolean).join("\n"), url };
  });
  db.from("calendar_feeds").update({ last_fetch: new Date().toISOString() }).eq("token", token).then(() => {}, () => {});
  return new Response(ics(feed.scope === "all" ? "AGRON — all deadlines" : "AGRON — my deadlines", events), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="agron.ics"', "Cache-Control": "private, max-age=900" },
  });
}
