import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { ITEM_REVIEW_FORMAT, PROJECT_RULES, deskById } from "@/config/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are the AGRON Workspace assistant for AGRON Inc. (Delaware, 2026), a US company with a planned UAE entity.
AGRON builds StarDome security containers (C20 Base, C20 Enhanced, C40 Base, C40 Advanced, C40 HQ) for superyachts, marinas, ports, private islands, offshore and industrial sites and commercial vessels including tankers in the Gulf, and develops AGRON 1 monitoring and sensor-integration software. Containers are built to order and sold, leased or financed. The pilot is limited to passive detection, monitoring and lawful communications.
You help every department: technical, operations, finance, sales, marketing, security, legal and HR. Be concise, practical and decisive: give one recommended next step.
Rules:
- Use only the context provided and general knowledge. Never invent facts about AGRON's records, contracts, numbers, export classifications (ECCN, USML), HS codes, permits or approvals; say "Pending" or "unknown".
- Legal, export-control, tax and regulatory answers are preliminary, not legal or tax advice; mark them PRELIMINARY and name the official source or the question for counsel.
- Electronic countermeasures, jamming, interceptor drones, dazzlers, directed energy and obscuration systems are restricted: never explain how to obtain, build, configure or operate them; only describe the lawful, government-authorised pathway.
- Import permission, installation permission and operating permission are separate.
- Flag export-control risk when controlled technical data could reach non-US persons, and sanctions screening for vessels, owners, charterers, financiers and Gulf deals.
- Answer in the user's language (given in context). Keep regulation names, codes and authority names in English. Use short markdown.
- When a verified company FAQ answer is provided and fits the question, follow it.`;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const CACHE_DAYS = 14;

export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not signed in", { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return new Response("AI is not configured", { status: 503 });

  const { messages = [], tier = "quick", context = "", who = "", section = "", lang = "en", desk: deskId = "", format = "" } = await req.json();
  const desk = deskById(String(deskId));
  const legal = !!desk || String(section).startsWith("legal.");
  const clean = (messages as any[]).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content)
    .slice(-10).map((m) => ({ role: m.role, content: String(m.content).slice(0, 8000) }));
  if (!clean.length || clean[clean.length - 1].role !== "user") return new Response("Bad request", { status: 400 });

  // Monthly per-user cap
  const admin = adminClient();
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const { data: rows } = await admin.from("ai_usage").select("input_tokens,output_tokens").eq("user_id", me.id).gte("created_at", since.toISOString());
  const used = (rows || []).reduce((a: number, r: any) => a + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
  if (!me.super && used >= (me.ai_monthly_tokens || 0)) return new Response("Monthly AI limit reached", { status: 429 }); // protected owner has no cap

  // 1) Same first question on the same data → reuse the saved answer (no tokens)
  const first = clean.length === 1;
  const q = clean[clean.length - 1].content;
  const key = sha([norm(q), tier, lang, section, desk?.id || "", format, sha(String(context))].join("|"));
  if (first) {
    const { data: hit } = await admin.from("ai_cache").select("answer,created_at,hits").eq("key", key).maybeSingle();
    if (hit && Date.now() - new Date(hit.created_at).getTime() < CACHE_DAYS * 864e5) {
      await admin.from("ai_cache").update({ hits: (hit.hits || 0) + 1, last_hit: new Date().toISOString() }).eq("key", key);
      return new Response(hit.answer, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "x-ai-cache": "hit", "x-ai-usage": `${Math.round(used / 1000)}k / ${Math.round((me.ai_monthly_tokens || 0) / 1000)}k` } });
    }
  }
  // 2) Verified company FAQ answers close to the question go into the prompt
  let faqText = "";
  try {
    const { data: faq } = await (await userClient()).rpc("faq_search", { q, lng: null, n: 3 });
    const good = (faq || []).filter((f: any) => f.sim >= 0.35);
    if (good.length) faqText = "Company FAQ (saved answers; prefer verified):\n" + good.map((f: any) => `Q: ${f.question}\nA: ${f.answer}${f.verified ? " [verified]" : ""}`).join("\n\n");
  } catch {}

  const deep = tier === "deep";
  const model = deep ? process.env.AI_MODEL_DEEP || "claude-sonnet-5-5" : process.env.AI_MODEL_QUICK || "claude-haiku-5-5";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const stream = client.messages.stream({
    model, max_tokens: format === "item" ? 6000 : deep ? 4000 : 1500,
    // The fixed system prompt is cached, so repeated questions cost less.
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } } as any,
      ...(legal ? [{ type: "text", text: `${PROJECT_RULES}${desk ? `\n\nYOUR ROLE: ${desk.persona}\nKey law: ${desk.laws.join("; ")}. Authorities: ${desk.authorities.join(", ")}.` : ""}${format === "item" ? `\n\n${ITEM_REVIEW_FORMAT}` : ""}`, cache_control: { type: "ephemeral" } } as any] : []), { type: "text", text: [String(who).slice(0, 500), String(context).slice(0, 24000), faqText].filter(Boolean).join("\n\n") }],
    messages: clean as any,
  });

  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      let full = "";
      stream.on("text", (d) => { full += d; ctrl.enqueue(enc.encode(d)); });
      try {
        const final = await stream.finalMessage();
        if (first && full && final.stop_reason === "end_turn") {
          await admin.from("ai_cache").upsert({ key, question: q.slice(0, 2000), answer: full, section: section || null, lang, tier, hits: 0, created_at: new Date().toISOString() });
        }
        const u: any = final.usage || {};
        await admin.from("ai_usage").insert({ user_id: me.id, model, input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.round((u.cache_read_input_tokens || 0) * 0.1), output_tokens: u.output_tokens || 0 });
      } catch (e: any) { ctrl.enqueue(enc.encode(`\n\n_Error: ${e?.message || "AI request failed"}_`)); }
      ctrl.close();
    },
    cancel() { stream.abort(); },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "x-ai-cache": "miss", "x-ai-usage": `${Math.round(used / 1000)}k / ${Math.round((me.ai_monthly_tokens || 0) / 1000)}k` } });
}
