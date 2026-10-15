import Anthropic from "@anthropic-ai/sdk";
import { allSections, DEPARTMENTS } from "@/config/workspace.config.mjs";
import { HELP } from "@/config/learn";

/** Shared by Smart upload and the email intake agent: AI picks the section and fills the fields of one document. */
const SKIP = new Set(["legal.matrix", "legal.desks"]);
export const INTAKE_SECTIONS: any[] = (allSections() as any[]).filter((s) => !SKIP.has(s.id) && s.view !== "mail" && !s.id.startsWith("mail.") && !/\.metrics$/.test(s.id));
const deptLabel = (k: string) => (DEPARTMENTS as any[]).find((d) => d.key === k)?.label?.en || k;

export function catalogue(secs: any[]) {
  return secs.map((s) => {
    const f = s.fields.filter((x: any) => !["html", "checklist"].includes(x.type)).map((x: any) => `${x.key}${x.type && x.type !== "text" ? `:${x.type}` : ""}${x.options ? `[${x.options.join("|")}]` : ""} (${x.label?.en || x.key})`);
    return `- ${s.id} | ${deptLabel(s.dept)} → ${s.label?.en} | statuses: ${s.statuses.join(", ")} | fields: ${f.join("; ")}${HELP[s.id]?.en ? ` | purpose: ${HELP[s.id].en.split("\n")[0]}` : ""}`;
  }).join("\n");
}

export const RULES = `You file company documents into AGRON Workspace, the internal system of AGRON Inc. (US/UAE; StarDome security containers C20 Base, C20 Enhanced, C40 Base, C40 Advanced, C40 HQ and AGRON 1 software).
Read the document and choose the ONE best section from the catalogue. Fill only fields you can support from the document; never invent numbers, prices, ECCN/HS codes, dates or names.
Return ONLY a JSON object, no prose, with keys:
{"section": "<section id from the catalogue>", "title": "<short English title: document number if any + subject>", "status": "<one of that section's statuses, matching the document's maturity; drafts are early statuses>",
 "data": {"<field key>": "<value>"}, "summary": "<2-4 sentence summary in LANG>", "controlled": true|false, "reason": "<one sentence in LANG: why this section>",
 "alternatives": ["<other plausible section id>", "..."], "confidence": 0.0-1.0}
Rules for fields: dates as YYYY-MM-DD; date fields such as due, expires, renewal, eta or warranty_end take the deadline, expiry or end date (if only a start date and a term are given, compute the end date);  numbers and money as plain numbers; select fields must use one of the listed options exactly or be omitted; put the summary also into a notes/description field of the section if it has one (notes, findings, specs, request, body, scope, description).
controlled = true only when the document contains technical data about sensors, radar, RF detection or countermeasures, EO/IR, sonar, UAV/interceptors or AGRON 1 internals that could be export-controlled; commercial, legal, HR, finance and generic documents are false.`;

const parseJson = (s: string) => { const m = s.match(/\{[\s\S]*\}/); if (!m) throw new Error("AI did not return a proposal"); return JSON.parse(m[0]); };

export type Proposal = { section: string; title: string; status: string; data: Record<string, any>; summary: string; reason: string; controlled: boolean; alternatives: string[]; confidence: number; usage: { model: string; tin: number; tout: number } };

/** Asks AI where the content belongs and keeps only valid sections, statuses, fields and options. */
export async function classify(content: any[], secs: any[], opts: { lang?: string; extra?: string } = {}): Promise<Proposal> {
  const lang = ({ ru: "Russian", uk: "Ukrainian", ar: "Arabic" } as any)[opts.lang || ""] || "English";
  const model = process.env.AI_MODEL_DEEP || "claude-sonnet-5-5";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg: any = await client.messages.create({
    model, max_tokens: 1800,
    system: [{ type: "text", text: `${RULES}\n\nSECTION CATALOGUE (id | department → section | statuses | fields):\n${catalogue(secs)}`, cache_control: { type: "ephemeral" } } as any],
    messages: [{ role: "user", content: [...content, { type: "text", text: `Today is ${new Date().toISOString().slice(0, 10)}. Write summary and reason in ${lang}.${opts.extra ? " " + opts.extra : ""} Return the JSON now.` }] as any }],
  });
  const u: any = msg.usage || {};
  const out = parseJson((msg.content || []).map((c: any) => c.text || "").join(""));
  const sec = secs.find((s) => s.id === out.section) || secs.find((s) => s.id === "company.wiki") || secs[0];
  const data: Record<string, any> = {};
  for (const [k, v] of Object.entries(out.data || {})) {
    const f = sec.fields.find((x: any) => x.key === k); if (!f || v === null || v === "" || f.type === "ref") continue;
    if (f.options && !f.options.includes(v)) continue;
    data[k] = f.type === "number" || f.type === "money" ? Number(String(v).replace(/[^\d.\-]/g, "")) || v : f.type === "check" ? !!v : v;
  }
  return {
    section: sec.id, title: String(out.title || "Document").slice(0, 200), status: sec.statuses.includes(out.status) ? out.status : sec.statuses[0],
    data, summary: String(out.summary || ""), reason: String(out.reason || ""), controlled: !!out.controlled,
    alternatives: (out.alternatives || []).filter((x: string) => secs.some((s) => s.id === x) && x !== sec.id).slice(0, 3), confidence: Number(out.confidence) || 0,
    usage: { model, tin: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.round((u.cache_read_input_tokens || 0) * 0.1), tout: u.output_tokens || 0 },
  };
}
