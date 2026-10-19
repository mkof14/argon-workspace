import Anthropic from "@anthropic-ai/sdk";
import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { limit } from "@/lib/server/authz";
import { indexFile, tsQuery } from "@/lib/server/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ask your documents.
 *  status → how many files/pages are searchable for this user and how many still wait to be read
 *  index  → read the next waiting files (or one given path) into the page index; stops after ~40 s
 *  remove → drop a deleted file from the index
 *  ask    → find the most relevant pages the user may see, answer with numbered sources [1], [2]…
 */
const LANGS: Record<string, string> = { ru: "Russian", uk: "Ukrainian", ar: "Arabic", en: "English" };

async function budget(me: any, admin: any) {
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const { data: rows } = await admin.from("ai_usage").select("input_tokens,output_tokens").eq("user_id", me.id).gte("created_at", since.toISOString());
  const used = (rows || []).reduce((a: number, r: any) => a + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
  return me.super || used < (me.ai_monthly_tokens || 0);
}
const usage = (admin: any, me: any, model: string, u: any) => admin.from("ai_usage").insert({ user_id: me.id, model, input_tokens: (u?.input_tokens || 0) + (u?.cache_creation_input_tokens || 0) + Math.round((u?.cache_read_input_tokens || 0) * 0.1), output_tokens: u?.output_tokens || 0 });

export async function POST(req: Request) {
  const t0 = Date.now();
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not signed in", { status: 401 });
  { const lim = await limit(`docs:${me.id}`, 30, 60); if (lim) return lim; }
  const b = await req.json().catch(() => ({}));
  const sb = await userClient();
  const admin = adminClient();

  if (b.action === "status") {
    const [{ data: st }, { data: pend }] = await Promise.all([sb.rpc("docs_stats"), sb.rpc("docs_pending", { n: 200 })]);
    return Response.json({ files: Number(st?.[0]?.files || 0), pages: Number(st?.[0]?.pages || 0), pending: (pend || []).length });
  }

  if (b.action === "index") {
    let paths: string[] = [];
    if (b.path) {
      const recordId = String(b.path).split("/")[1];
      const { data: rec } = await sb.from("records").select("id").eq("id", recordId).maybeSingle(); // visible to this user?
      if (!rec || String(b.path).startsWith("_intake/")) return new Response("Not allowed", { status: 403 });
      paths = [String(b.path)];
    } else {
      const { data } = await sb.rpc("docs_pending", { n: 20 });
      paths = (data || []).map((r: any) => r.path);
    }
    let done = 0, failed = 0;
    for (const p of paths) {
      if (Date.now() - t0 > 40_000) break;
      try { await indexFile(admin, p); done++; } catch { failed++; }
    }
    const { data: left } = await sb.rpc("docs_pending", { n: 200 });
    return Response.json({ done, failed, pending: (left || []).length });
  }

  if (b.action === "remove") {
    const recordId = String(b.path || "").split("/")[1];
    const { data: rec } = await sb.from("records").select("id").eq("id", recordId).maybeSingle();
    if (rec) await admin.from("doc_pages").delete().eq("path", String(b.path));
    return Response.json({ ok: true });
  }

  if (b.action === "ask") {
    const q = String(b.q || "").trim().slice(0, 1000);
    if (q.length < 3) return new Response("Ask a question", { status: 400 });
    if (!process.env.ANTHROPIC_API_KEY) return new Response("AI is not configured", { status: 503 });
    if (!(await budget(me, admin))) return new Response("Monthly AI limit reached", { status: 429 });
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const quick = process.env.AI_MODEL_QUICK || "claude-haiku-5-5";
    const deep = process.env.AI_MODEL_DEEP || "claude-sonnet-5-5";

    // 1) Search terms in Russian and English (documents are in both), with synonyms and product codes
    let terms: string[] = [q];
    try {
      const m: any = await client.messages.create({ model: quick, max_tokens: 300, messages: [{ role: "user", content:
        `Question about company documents (AGRON StarDome security containers, AGRON 1 software): "${q}"\nReturn ONLY a JSON array of 8-16 search keywords: the key nouns and codes from the question, their Russian and English equivalents, singular base forms and close synonyms. Example: ["радар","radar","3D","обнаружение","detection"]` }] });
      await usage(admin, me, quick, m.usage);
      const arr = JSON.parse(((m.content?.[0]?.text || "").match(/\[[\s\S]*\]/) || ["[]"])[0]);
      if (Array.isArray(arr) && arr.length) terms = [q, ...arr.map(String)];
    } catch {}
    const tsq = tsQuery(terms);
    if (!tsq) return Response.json({ answer: "", sources: [], none: true });
    const { data: hits, error } = await sb.rpc("doc_search", { q: tsq, n: 14 });
    if (error) return new Response(error.message, { status: 500 });
    if (!hits?.length) return Response.json({ answer: "", sources: [], none: true });

    // 2) Keep the best pages, at most 3 per file, within ~60k characters
    const per: Record<string, number> = {}; const picked: any[] = []; let size = 0;
    for (const h of hits) {
      if ((per[h.path] || 0) >= 3 || !h.content?.trim()) continue;
      if (size + h.content.length > 60_000) break;
      per[h.path] = (per[h.path] || 0) + 1; picked.push(h); size += h.content.length;
    }
    const sources = picked.map((h, i) => ({ n: i + 1, record_id: h.record_id, section: h.section, title: h.title, file: h.file_name, page: h.page, path: h.path, snippet: h.content.replace(/\s+/g, " ").slice(0, 220) }));
    const ctx = picked.map((h, i) => `[${i + 1}] ${h.title} — ${h.file_name}, page ${h.page}\n${h.content}`).join("\n\n---\n\n");

    // 3) Answer only from these pages, with numbered references
    try {
      const m: any = await client.messages.create({
        model: deep, max_tokens: 1400,
        system: [{ type: "text", text: `You answer questions for AGRON Inc. staff using ONLY the document excerpts provided. Rules:
- Answer in ${LANGS[b.lang] || "English"}, short and concrete: first the direct answer, then key details as a short list if useful.
- After every fact add its source number in square brackets, e.g. [2]. Use only the numbers given.
- If the excerpts do not contain the answer, say so plainly in one sentence and suggest what document to upload. Never guess numbers, prices, models or dates.
- Keep model names, codes and units as written. Mark design assumptions as such when the document says they are preliminary (TBD, RFQ, not confirmed).
- Never give instructions for jamming, interception or other countermeasure use.` } as any],
        messages: [{ role: "user", content: `Document excerpts:\n\n${ctx}\n\nQuestion: ${q}` }],
      });
      await usage(admin, me, deep, m.usage);
      const answer = (m.content || []).map((c: any) => c.text || "").join("").trim();
      const used = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1])));
      return Response.json({ answer, sources: sources.map((s) => ({ ...s, cited: used.has(s.n) })) });
    } catch (e: any) { return new Response(e?.message || "AI request failed", { status: 502 }); }
  }
  return new Response("Unknown action", { status: 400 });
}
