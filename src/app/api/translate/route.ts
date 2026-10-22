import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { limit } from "@/lib/server/authz";
import { localizeTexts, pendingRecords, sweep, translateFaq, translateRecord, trConfigured } from "@/lib/server/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Automatic translation into EN / RU / UK / AR.
 * {id}            — after a record or its comment is saved: translates the new texts (the person must be able to see the record)
 * {faq}           — after a FAQ entry is saved: creates or refreshes its other language versions
 * {action:"status"} — owner/admin: how many records still wait for translation
 * {action:"sweep"}  — owner/admin: translate the next batch of existing records now
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not allowed", { status: 403 });
  { const lim = await limit(`translate:${me.id}`, 60, 60); if (lim) return lim; }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("Service key missing", { status: 501 });
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  try {
    if (b.id) {
      // The person's own rights decide: a record they cannot see is not touched
      const { data: rec } = await (await userClient()).from("records").select("id").eq("id", String(b.id)).maybeSingle();
      if (!rec) return Response.json({ ok: false, reason: "not visible" });
      if (!trConfigured()) return Response.json({ ok: false, reason: "AI is not configured" });
      return Response.json(await translateRecord(db, rec.id, { by: me.id }));
    }
    if (b.faq) {
      const { data: f } = await (await userClient()).from("faq").select("id").eq("id", String(b.faq)).maybeSingle();
      if (!f) return Response.json({ ok: false, reason: "not visible" });
      if (!trConfigured()) return Response.json({ ok: false, reason: "AI is not configured" });
      return Response.json(await translateFaq(db, f.id, me.id));
    }
    if (Array.isArray(b.texts) && ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security", "procurement"].includes(me.role)) {
      // Texts the person already sees on screen (agent proposals, log lines), shown in their language
      const texts = b.texts.slice(0, 80).map((x: any) => String(x ?? "").slice(0, 2000));
      return Response.json({ texts: await localizeTexts(db, String(b.lang || me.lang || "en"), texts) });
    }
    if (!["owner", "admin"].includes(me.role)) return new Response("Only owners and administrators", { status: 403 });
    if (b.action === "status") { const p = await pendingRecords(db, 0); return Response.json({ left: p.total, configured: trConfigured() }); }
    if (b.action === "sweep") { if (!trConfigured()) return new Response("AI is not configured", { status: 503 }); return Response.json(await sweep(db, 45000)); }
  } catch (e: any) { return new Response(e?.message || "Failed", { status: 500 }); }
  return new Response("Unknown action", { status: 400 });
}
