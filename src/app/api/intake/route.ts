import Anthropic from "@anthropic-ai/sdk";
import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { allSections, DEPARTMENTS } from "@/config/workspace.config.mjs";
import { HELP } from "@/config/learn";
import { indexFile } from "@/lib/server/docs";

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
const SKIP = new Set(["legal.matrix", "legal.desks"]);
const SECS: any[] = (allSections() as any[]).filter((s) => !SKIP.has(s.id) && s.view !== "mail" && !s.id.startsWith("mail."));
const safe = (n: string) => n.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-120) || "file";
const deptLabel = (k: string) => (DEPARTMENTS as any[]).find((d) => d.key === k)?.label?.en || k;

async function writable(me: any): Promise<any[]> {
  if (["owner", "admin"].includes(me.role)) return SECS;
  const { data } = await (await userClient()).from("section_access").select("section,can_write").eq("role", me.role);
  const ok = new Set((data || []).filter((r: any) => r.can_write).map((r: any) => r.section));
  return SECS.filter((s) => ok.has(s.id));
}

function catalogue(secs: any[]) {
  return secs.map((s) => {
    const f = s.fields.filter((x: any) => !["html", "checklist"].includes(x.type)).map((x: any) => `${x.key}${x.type && x.type !== "text" ? `:${x.type}` : ""}${x.options ? `[${x.options.join("|")}]` : ""} (${x.label?.en || x.key})`);
    return `- ${s.id} | ${deptLabel(s.dept)} → ${s.label?.en} | statuses: ${s.statuses.join(", ")} | fields: ${f.join("; ")}${HELP[s.id]?.en ? ` | purpose: ${HELP[s.id].en.split("\n")[0]}` : ""}`;
  }).join("\n");
}

const RULES = `You file company documents into AGRON Workspace, the internal system of AGRON Inc. (US/UAE; StarDome security containers C20 Base, C20 Enhanced, C40 Base, C40 Advanced, C40 HQ and AGRON 1 software).
Read the document and choose the ONE best section from the catalogue. Fill only fields you can support from the document; never invent numbers, prices, ECCN/HS codes, dates or names.
Return ONLY a JSON object, no prose, with keys:
{"section": "<section id from the catalogue>", "title": "<short English title: document number if any + subject>", "status": "<one of that section's statuses, matching the document's maturity; drafts are early statuses>",
 "data": {"<field key>": "<value>"}, "summary": "<2-4 sentence summary in LANG>", "controlled": true|false, "reason": "<one sentence in LANG: why this section>",
 "alternatives": ["<other plausible section id>", "..."], "confidence": 0.0-1.0}
Rules for fields: dates as YYYY-MM-DD; numbers and money as plain numbers; select fields must use one of the listed options exactly or be omitted; put the summary also into a notes/description field of the section if it has one (notes, findings, specs, request, body, scope, description).
controlled = true only when the document contains technical data about sensors, radar, RF detection or countermeasures, EO/IR, sonar, UAV/interceptors or AGRON 1 internals that could be export-controlled; commercial, legal, HR, finance and generic documents are false.`;

const parseJson = (s: string) => { const m = s.match(/\{[\s\S]*\}/); if (!m) throw new Error("AI did not return a proposal"); return JSON.parse(m[0]); };

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

    const secs = await writable(me);
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
    const lang = ({ ru: "Russian", uk: "Ukrainian", ar: "Arabic" } as any)[b.lang] || "English";
    content.push({ type: "text", text: `Today is ${new Date().toISOString().slice(0, 10)}. Write summary and reason in ${lang}. The user ${me.us_person ? "is" : "is NOT"} a US person. Return the JSON now.` });

    const model = process.env.AI_MODEL_DEEP || "claude-sonnet-5-5";
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    try {
      const msg: any = await client.messages.create({
        model, max_tokens: 1800,
        system: [{ type: "text", text: `${RULES}\n\nSECTION CATALOGUE (id | department → section | statuses | fields):\n${catalogue(secs)}`, cache_control: { type: "ephemeral" } } as any],
        messages: [{ role: "user", content: content as any }],
      });
      const u: any = msg.usage || {};
      await admin.from("ai_usage").insert({ user_id: me.id, model, input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.round((u.cache_read_input_tokens || 0) * 0.1), output_tokens: u.output_tokens || 0 });
      const out = parseJson((msg.content || []).map((c: any) => c.text || "").join(""));
      const sec = secs.find((s) => s.id === out.section) || secs.find((s) => s.id === "company.wiki") || secs[0];
      const data: Record<string, any> = {};
      for (const [k, v] of Object.entries(out.data || {})) {
        const f = sec.fields.find((x: any) => x.key === k); if (!f || v === null || v === "") continue;
        if (f.options && !f.options.includes(v)) continue;
        data[k] = f.type === "number" || f.type === "money" ? Number(String(v).replace(/[^\d.\-]/g, "")) || v : f.type === "check" ? !!v : v;
      }
      return Response.json({
        section: sec.id, title: String(out.title || name).slice(0, 200), status: sec.statuses.includes(out.status) ? out.status : sec.statuses[0],
        data, summary: String(out.summary || ""), reason: String(out.reason || ""), controlled: !!out.controlled && !!me.us_person,
        suggestControlled: !!out.controlled, alternatives: (out.alternatives || []).filter((x: string) => secs.some((s) => s.id === x) && x !== sec.id).slice(0, 3),
        confidence: Number(out.confidence) || 0,
      });
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
