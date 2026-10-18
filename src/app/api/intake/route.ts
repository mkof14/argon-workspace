import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { indexFile } from "@/lib/server/docs";
import { classify, INTAKE_SECTIONS } from "@/lib/server/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Smart upload: the user drops any document, AI reads it and proposes where it belongs.
 *  sign    → a one-time upload URL into the private staging area `_intake/<user>/…` (files up to 25 MB go straight to storage)
 *  analyze → AI reads the staged file (PDF, image, text, or text extracted in the browser from Word/Excel/PowerPoint)
 *            and returns a proposal: section, title, status, fields, summary, controlled
 *  save    → creates the record as the user (row-level security applies) and moves the file to the record
 *  discard → removes the staged file
 */
const BUCKET = "files";
const MAX = 25 * 1024 * 1024;
const SECS: any[] = INTAKE_SECTIONS;
const safe = (n: string) => n.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-120) || "file";

async function writable(me: any): Promise<any[]> {
  if (["owner", "admin"].includes(me.role)) return SECS;
  const { data } = await (await userClient()).from("section_access").select("section,can_write").eq("role", me.role);
  const ok = new Set((data || []).filter((r: any) => r.can_write).map((r: any) => r.section));
  return SECS.filter((s) => ok.has(s.id));
}

export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not signed in", { status: 401 });
  if (["partner", "vendor", "investor"].includes(me.role)) return new Response("Not allowed", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const admin = adminClient();
  const own = (p: string) => typeof p === "string" && p.startsWith(`_intake/${me.id}/`) && !p.includes("..");

  if (b.action === "sign") {
    const size = Number(b.size) || 0;
    if (size > MAX) return new Response("File is larger than 25 MB", { status: 413 });
    const path = `_intake/${me.id}/${Date.now()}_${safe(String(b.name || "file"))}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) return new Response(error.message, { status: 500 });
    return Response.json({ path, token: data.token });
  }

  if (b.action === "discard") {
    if (own(b.path)) await admin.storage.from(BUCKET).remove([b.path]);
    return Response.json({ ok: true });
  }

  if (b.action === "analyze") {
    if (!own(b.path)) return new Response("Bad path", { status: 400 });
    if (!process.env.ANTHROPIC_API_KEY) return new Response("AI is not configured", { status: 503 });
    const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
    const { data: rows } = await admin.from("ai_usage").select("input_tokens,output_tokens").eq("user_id", me.id).gte("created_at", since.toISOString());
    const used = (rows || []).reduce((a: number, r: any) => a + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
    if (!me.super && used >= (me.ai_monthly_tokens || 0)) return new Response("Monthly AI limit reached", { status: 429 });

    let secs = await writable(me);
    // Photo modes: a receipt becomes an expense, a business card a lead, a delivery note is read as a purchase to match
    const MODE: Record<string, { sec: string; hint: string }> = {
      receipt: { sec: "finance.expenses", hint: "This is a photo of a receipt or a supplier invoice paid by an employee. Section must be finance.expenses. Title: vendor + what was bought. Fill amount (total incl. tax) and currency exactly as printed, category, and put date, vendor and items into notes. Status Submitted." },
      card: { sec: "marketing.leads", hint: "This is a photo of a business card. Section must be marketing.leads. Title: company name. contact = person name, position and phone; email as printed; country from the address; source Event unless the card says otherwise. Status New." },
      delivery: { sec: "operations.procurement", hint: "This is a photo of a delivery note / packing list from a supplier. Section must be operations.procurement. Fill vendor (supplier name), item (main item or part number), qty (delivered quantity) and put every line (item, part number, qty) and the delivery note number into notes. Status Received." },
    };
    const mode = MODE[String(b.mode || "")];
    if (mode) { secs = secs.filter((s) => s.id === mode.sec); if (!secs.length && !(mode.sec === "operations.procurement")) return new Response("Your role cannot add records here", { status: 403 }); if (!secs.length) secs = SECS.filter((s) => s.id === mode.sec); }
    if (!secs.length) return new Response("Your role cannot add records", { status: 403 });
    const name = String(b.name || b.path.split("/").pop());
    const type = String(b.type || "");
    const content: any[] = [];
    const text = typeof b.text === "string" ? b.text.slice(0, 120_000) : "";
    if (text) content.push({ type: "text", text: `File: ${name}\n\n${text}` });
    else {
      const { data: blob, error } = await admin.storage.from(BUCKET).download(b.path);
      if (error || !blob) return new Response("Uploaded file not found", { status: 404 });
      const buf = Buffer.from(await blob.arrayBuffer());
      if (type === "application/pdf" || /\.pdf$/i.test(name)) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } });
      else if (/^image\/(png|jpe?g|gif|webp)$/.test(type)) content.push({ type: "image", source: { type: "base64", media_type: type === "image/jpg" ? "image/jpeg" : type, data: buf.toString("base64") } });
      else if (/^text\/|json|csv|xml|markdown/.test(type) || /\.(txt|md|csv|json|xml|tsv)$/i.test(name)) content.push({ type: "text", text: `File: ${name}\n\n${buf.toString("utf8").slice(0, 120_000)}` });
      else return Response.json({ unsupported: true });
      content.push({ type: "text", text: `File name: ${name}` });
    }
    try {
      const p = await classify(content, secs, { lang: b.lang, extra: `The user ${me.us_person ? "is" : "is NOT"} a US person.${mode ? " " + mode.hint : ""}` });
      await admin.from("ai_usage").insert({ user_id: me.id, model: p.usage.model, input_tokens: p.usage.tin, output_tokens: p.usage.tout });
      return Response.json({ section: p.section, title: p.title, status: p.status, data: p.data, summary: p.summary, reason: p.reason,
        controlled: p.controlled && !!me.us_person, suggestControlled: p.controlled, alternatives: p.alternatives, confidence: p.confidence });
    } catch (e: any) { return new Response(e?.message || "AI request failed", { status: 502 }); }
  }

  if (b.action === "save") {
    if (b.path && !own(b.path)) return new Response("Bad path", { status: 400 });
    const sec = SECS.find((s) => s.id === b.section);
    if (!sec) return new Response("Unknown section", { status: 400 });
    const data: Record<string, any> = {};
    for (const [k, v] of Object.entries(b.data || {})) if (sec.fields.some((f: any) => f.key === k) && v !== "" && v !== null) data[k] = v;
    const controlled = !!b.controlled && !!me.us_person;
    const sb = await userClient();
    const { data: rec, error } = await sb.from("records").insert({ section: sec.id, title: String(b.title || "Document").slice(0, 200), status: sec.statuses.includes(b.status) ? b.status : sec.statuses[0], data, controlled, created_by: me.id }).select("id").single();
    if (error) return new Response(error.message.includes("row-level") ? "You cannot add records to this section" : error.message, { status: 403 });
    if (b.path) {
      const to = `${sec.id}/${rec.id}/${Date.now()}_${safe(String(b.name || b.path.split("/").pop()).replace(/^\d+_/, ""))}`;
      const { error: mv } = await admin.storage.from(BUCKET).move(b.path, to);
      if (mv) return Response.json({ id: rec.id, section: sec.id, warning: "Record saved, but the file could not be attached: " + mv.message });
      try { await indexFile(admin, to); } catch {} // make it searchable in "Ask your documents"
    }
    return Response.json({ id: rec.id, section: sec.id });
  }
  return new Response("Unknown action", { status: 400 });
}
