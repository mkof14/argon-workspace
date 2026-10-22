import Anthropic from "@anthropic-ai/sdk";
import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { limit } from "@/lib/server/authz";
import { reportError } from "@/lib/server/errors";
import { isInternal } from "@/lib/roles";
import { keepEvidenced, patternExtract, type Kind, type Proposal } from "@/lib/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 6 — extraction proposals.
 *   extract {source, kind: quotation | obligation | invoice} → reads the indexed text of a document the person may open
 *   and stores proposals. A model is used only when one is configured and the record is not US-persons-only; its
 *   values are kept only when the text it quotes is really in the document. Nothing becomes a record here: a person
 *   confirms each proposal (ops_proposal_decide), and that confirmation is audited.
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || !isInternal(me.role) || (me as any).disabled) return new Response("Not signed in", { status: 401 });
  const db = adminClient(); const sb = await userClient();
  { const lim = await limit(`extract:${me.id}`, 20, 60, db); if (lim) return lim; }
  const b = await req.json().catch(() => ({}));
  if (b.action !== "extract") return new Response("Unknown action", { status: 400 });
  const kind: Kind | null = ["quotation", "obligation", "invoice"].includes(b.kind) ? b.kind : null;
  if (!kind) return new Response("Choose what to extract: quotation, obligation or invoice", { status: 400 });
  // the person must be able to open the source (row-level security decides, not this route)
  const { data: src } = await sb.from("records").select("id,section,title,controlled,data").eq("id", String(b.source || "")).maybeSingle();
  if (!src) return new Response("Record not found", { status: 404 });
  const ids = [src.id, src.data?.document_ref].filter(Boolean);
  const { data: pages } = await db.from("doc_pages").select("record_id,page,content").in("record_id", ids).order("page").limit(400);
  const text = (pages || []).map((p: any) => p.content || "").join("\n").slice(0, 120_000);
  if (!text.trim()) return new Response("No text found in this record's files yet (it is read when a file is uploaded)", { status: 409 });
  let method: "model" | "pattern" = "pattern"; let found: Proposal[] = patternExtract(kind, text);
  if (process.env.ANTHROPIC_API_KEY && !src.controlled && b.method !== "pattern") {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const fields = kind === "obligation" ? "title, description, due (YYYY-MM-DD), frequency (One-time|Monthly|Quarterly|Annual)" : kind === "quotation" ? "amount, currency (USD|AED|EUR), valid_until, lead_time_days, payment_terms" : "amount, currency, due";
      const msg: any = await client.messages.create({ model: process.env.AI_MODEL_QUICK || "claude-haiku-5-5", max_tokens: 1500,
        system: "You read a company document and PROPOSE values for a person to confirm. Never invent or infer: every value must be copied from the text, and for each value give the exact sentence or line it comes from in \"evidence\". If a value is not stated, leave it out. Answer with JSON only: {\"items\":[{\"values\":{...},\"evidence\":{...}}]}.",
        messages: [{ role: "user", content: `Kind: ${kind}. Fields: ${fields}.\n\nDOCUMENT TEXT:\n${text.slice(0, 60_000)}` }] });
      const raw = (msg.content || []).map((c: any) => c.text || "").join("");
      const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      const target = kind === "quotation" ? "operations.quotations" : kind === "obligation" ? "legal.contract_obligations" : "finance.payments";
      const kept = (j.items || []).slice(0, 20).map((it: any) => keepEvidenced({ kind, target, values: it.values || {}, evidence: it.evidence || {} }, text)).filter(Boolean) as Proposal[];
      if (kept.length) { found = kept; method = "model"; }
      const u: any = msg.usage || {}; await db.from("ai_usage").insert({ user_id: me.id, model: process.env.AI_MODEL_QUICK || "claude-haiku-5-5", input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 });
    } catch (e) { await reportError(db, "extract", e, { detail: src.id }); }
  }
  const made: string[] = [];
  for (const p of found.slice(0, 20)) {
    const { data, error } = await db.rpc("ops_proposal_add", { p_actor: me.id, p_source: src.id, p_kind: p.kind, p_target: p.target, p_proposed: { ...p.values, ...(src.section === "operations.requests" ? { request_ref: src.id } : {}) }, p_method: method, p_evidence: p.evidence });
    if (error) return new Response(error.message, { status: error.code === "23514" ? 422 : 409 });
    made.push(data);
  }
  return Response.json({ ok: true, method, proposals: made.length, ids: made });
}
