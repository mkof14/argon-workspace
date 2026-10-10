import Anthropic from "@anthropic-ai/sdk";
import { adminClient, currentProfile } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are the AGRON Workspace assistant for AGRON Inc. (Delaware, 2026), a US company with a planned UAE entity.
AGRON builds StarDome security containers (C20 Base, C20 Enhanced, C40 Base, C40 Advanced, C40 HQ) for superyachts, marinas, ports, private islands, offshore and industrial sites and commercial vessels including tankers in the Gulf, and develops AGRON 1 / StarWall monitoring and sensor-integration software. Containers are built to order and sold, leased or financed. The pilot is limited to passive detection, monitoring and lawful communications.
You help every department: technical, operations, finance, sales, marketing, security, legal and HR. Be concise, practical and decisive: give one recommended next step.
Rules:
- Use only the context provided and general knowledge. Never invent facts about AGRON's records, contracts, numbers, export classifications (ECCN, USML), HS codes, permits or approvals; say "Pending" or "unknown".
- Legal, export-control, tax and regulatory answers are preliminary, not legal or tax advice; mark them PRELIMINARY and name the official source or the question for counsel.
- Electronic countermeasures, jamming, interceptor drones, dazzlers, directed energy and obscuration systems are restricted: never explain how to obtain, build, configure or operate them; only describe the lawful, government-authorised pathway.
- Import permission, installation permission and operating permission are separate.
- Flag export-control risk when controlled technical data could reach non-US persons, and sanctions screening for vessels, owners, charterers, financiers and Gulf deals.
- Answer in the user's language (given in context). Keep regulation names, codes and authority names in English. Use short markdown.`;

export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not signed in", { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return new Response("AI is not configured", { status: 503 });

  const { messages = [], tier = "quick", context = "" } = await req.json();
  const clean = (messages as any[]).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content)
    .slice(-10).map((m) => ({ role: m.role, content: String(m.content).slice(0, 8000) }));
  if (!clean.length || clean[clean.length - 1].role !== "user") return new Response("Bad request", { status: 400 });

  // Monthly per-user cap
  const admin = adminClient();
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const { data: rows } = await admin.from("ai_usage").select("input_tokens,output_tokens").eq("user_id", me.id).gte("created_at", since.toISOString());
  const used = (rows || []).reduce((a: number, r: any) => a + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
  if (used >= (me.ai_monthly_tokens || 0)) return new Response("Monthly AI limit reached", { status: 429 });

  const deep = tier === "deep";
  const model = deep ? process.env.AI_MODEL_DEEP || "claude-sonnet-5-5" : process.env.AI_MODEL_QUICK || "claude-haiku-5-5";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const stream = client.messages.stream({
    model, max_tokens: deep ? 4000 : 1500,
    // The fixed system prompt is cached, so repeated questions cost less.
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } } as any, { type: "text", text: String(context).slice(0, 24000) }],
    messages: clean as any,
  });

  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      stream.on("text", (d) => ctrl.enqueue(enc.encode(d)));
      try {
        const final = await stream.finalMessage();
        const u: any = final.usage || {};
        await admin.from("ai_usage").insert({ user_id: me.id, model, input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.round((u.cache_read_input_tokens || 0) * 0.1), output_tokens: u.output_tokens || 0 });
      } catch (e: any) { ctrl.enqueue(enc.encode(`\n\n_Error: ${e?.message || "AI request failed"}_`)); }
      ctrl.close();
    },
    cancel() { stream.abort(); },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "x-ai-usage": `${Math.round(used / 1000)}k / ${Math.round((me.ai_monthly_tokens || 0) / 1000)}k` } });
}
