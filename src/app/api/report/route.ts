import Anthropic from "@anthropic-ai/sdk";
import { adminClient, currentProfile } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LANGS: Record<string, string> = { en: "English", ru: "Russian", uk: "Ukrainian", ar: "Arabic" };

/** Executive summary for a department report built in the browser from the user's own records (no extra data is read). */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending" || ["partner", "vendor", "investor"].includes(me.role)) return new Response("Not allowed", { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return new Response("AI is not configured", { status: 503 });
  const b = await req.json().catch(() => ({}));
  const report = String(b.report || "").slice(0, 40000);
  if (report.length < 50) return new Response("The report is empty", { status: 400 });
  const admin = adminClient();
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const { data: rows } = await admin.from("ai_usage").select("input_tokens,output_tokens").eq("user_id", me.id).gte("created_at", since.toISOString());
  const used = (rows || []).reduce((a: number, r: any) => a + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
  if (!me.super && used >= (me.ai_monthly_tokens || 0)) return new Response("Monthly AI limit reached", { status: 429 });
  const model = process.env.AI_MODEL_DEEP || "claude-sonnet-5-5";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const m: any = await client.messages.create({
      model, max_tokens: 1200,
      system: "You write the executive summary for an AGRON Inc. internal department report. Use only the numbers in the report; never invent figures. Be short, concrete and decisive.",
      messages: [{ role: "user", content: `Write in ${LANGS[b.lang] || "English"}, markdown, under 220 words:\n## Summary\n3-5 bullets: what changed and why it matters.\n## Attention\nup to 3 bullets: risks, gaps, missing data.\n## Next steps\n3 numbered actions with an owner role.\n\nREPORT (${String(b.dept || "")}):\n${report}` }],
    });
    const u: any = m.usage || {};
    await admin.from("ai_usage").insert({ user_id: me.id, model, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 });
    return Response.json({ summary: (m.content || []).map((c: any) => c.text || "").join("").trim() });
  } catch (e: any) { return new Response(e?.message || "AI request failed", { status: 502 }); }
}
