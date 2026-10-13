import Anthropic from "@anthropic-ai/sdk";
import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { tsQuery } from "@/lib/server/docs";
import { CHECK_FIELDS, bannedHits } from "@/config/marketing";
import { allSections } from "@/config/workspace.config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Marketing studio (AI).
 *  write | pitch | prep | brief → text for one field of the record (brief also returns a script)
 *  check     → compliance review of a public text: verdict, issues with fixes, corrected text
 *  repurpose → social drafts (LinkedIn, X, Instagram) from a press piece, interview or video
 *  ideas     → a 4-week social plan: 8 post ideas with dates, channel and topic type
 * Grounding: Brand center (approved first) and non-controlled company documents. Controlled records are never used for public text.
 */
const LANGS: Record<string, string> = { EN: "English", AR: "Arabic", RU: "Russian", "EN + AR": "English, then the same text in Arabic", en: "English", ru: "Russian", uk: "Ukrainian", ar: "Arabic" };
const SECS: any[] = allSections() as any[];

const RULES = `You are the marketing writer and the public-release reviewer for AGRON Inc. (Delaware; UAE entity), CEO Michael Kofman.
Products: StarDome — containerised detection, surveillance and decision-support stations for superyachts, marinas, ports, tankers and commercial vessels, private islands, offshore and industrial sites (configurations C20 Base, C20 Enhanced, C40 Base, C40 Advanced, C40 HQ; every configuration keeps expansion bays; built to order; sold, leased or financed). AGRON 1 — software that brings radar, cameras, RF detection, sonar and other sensors into one operator picture, with a tamper-evident log, a voice assistant with limited rights, local-first operation with cloud sync. Markets: US and UAE / Gulf.
Voice: confident, clear, calm, specific about the customer's problem and the outcome; no hype, no fear-mongering, no military bravado. Short sentences. Plain words. Every piece ends with one clear call to action (usually: contact info@agron1.com or visit agron1.com / stardome.life).

PUBLIC-RELEASE RULES (this text may be read by anyone in any country):
1. No controlled technical data: no detection or tracking ranges, frequencies, power levels, resolutions, accuracies, speeds, sensor or UAV specifications, component vendors or models per configuration, bills of materials, how detection, tracking, fusion or AI works internally, AGRON 1 architecture, interfaces, data formats, algorithms or security design. Describe purpose and benefit only ("one picture of the sea and air around the vessel", "early warning", "evidence you can trust").
2. Never describe countermeasures: jamming, spoofing, interceptor drones, dazzlers, directed energy, takedown or neutralisation. If asked, say AGRON integrates only lawful, government-authorised responses, and only as a boundary statement.
3. Never invent facts: no prices, lead times, delivery dates, customer names, vessel names, sites, partnerships, certifications, approvals, permits, export classifications, awards or numbers that are not in the provided material. Where a fact is needed, write [TO CONFIRM: …].
4. Quotes from people are drafts: mark them [QUOTE TO CONFIRM].
5. Banned words: "StarWall", "patent", "patented", "patents". Use the trademark AGRON only.
6. No absolute or unprovable claims ("guaranteed", "100%", "undetectable", "the only", "best in the world"); comparative claims need proof. No disparaging competitors.
7. No customer, crew or personal data without written consent. No statements about sanctioned countries, specific governments' threats or ongoing conflicts.
8. UAE audiences: respectful, no political or religious content; Arabic must be natural Modern Standard Arabic.
9. Everything is a draft for human approval; legal clears anything about capabilities, export or regulation.`;

const CHANNEL_RULES: Record<string, string> = {
  LinkedIn: "LinkedIn: 600-1200 characters, the first line is a hook that works alone, short paragraphs, 3-5 hashtags at the end.",
  X: "X: one post up to 270 characters, or a thread of up to 5 numbered posts if the topic needs it; 1-2 hashtags.",
  Instagram: "Instagram: caption up to 1500 characters, first line is the hook, line breaks, 6-10 hashtags at the end; describe the image or video idea in one line at the top as [VISUAL: …].",
  Facebook: "Facebook: 300-800 characters, friendly, 1-3 hashtags.",
  YouTube: "YouTube: a title up to 70 characters, then a description of 600-1000 characters with chapters if relevant, then 5 tags.",
  Telegram: "Telegram: 400-900 characters, bold first line, no hashtags or 1-2.",
  TikTok: "TikTok: caption up to 300 characters plus a 20-second spoken script in [SCRIPT: …].",
};

const PRESS_RULES: Record<string, string> = {
  "Press release": "Press release: HEADLINE, subheadline, dateline (CITY, Month Day, Year —), lead paragraph with who/what/why, 3-4 body paragraphs, one [QUOTE TO CONFIRM] from Michael Kofman, CEO, the About AGRON paragraph, media contact info@agron1.com, ###.",
  "Bylined article": "Bylined article: 800-1100 words, by Michael Kofman, CEO of AGRON; an industry problem, what good looks like, practical advice, a short mention of how AGRON approaches it, no sales pitch until the last paragraph.",
  "Case study": "Case study: challenge, approach, outcome, with every customer detail as [TO CONFIRM].",
  "Opinion column": "Opinion column: 600-800 words, one clear argument, three supporting points, a call to the industry.",
};

async function budget(me: any, admin: any) {
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const { data: rows } = await admin.from("ai_usage").select("input_tokens,output_tokens").eq("user_id", me.id).gte("created_at", since.toISOString());
  const used = (rows || []).reduce((a: number, r: any) => a + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
  return me.super || used < (me.ai_monthly_tokens || 0);
}
const json = (s: string) => { const m = s.match(/\{[\s\S]*\}/); if (!m) throw new Error("The AI answer was not readable, please try again"); return JSON.parse(m[0]); };

function recordText(sec: any, title: string, data: Record<string, any>) {
  const lines = [`Section: ${sec?.label?.en || ""}`, `Title: ${title}`];
  for (const f of sec?.fields || []) { const v = data?.[f.key]; if (v !== undefined && v !== null && v !== "" && !["check_note", "post_url", "reach", "engagement", "clicks", "views"].includes(f.key)) lines.push(`${f.label?.en || f.key}: ${String(v).slice(0, 6000)}`); }
  return lines.join("\n");
}

export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending" || ["partner", "vendor", "investor"].includes(me.role)) return new Response("Not allowed", { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return new Response("AI is not configured", { status: 503 });
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "");
  const section = String(b.section || "");
  const sec = SECS.find((s) => s.id === section);
  if (!sec || sec.dept !== "marketing") return new Response("Unknown section", { status: 400 });
  const sb = await userClient(); const admin = adminClient();
  if (!(await budget(me, admin))) return new Response("Monthly AI limit reached", { status: 429 });

  const data: Record<string, any> = b.data && typeof b.data === "object" ? b.data : {};
  const title = String(b.title || "").slice(0, 300);
  const outLang = LANGS[data.language] || LANGS[b.lang] || "English";
  const uiLang = LANGS[b.lang] || "English";

  // Brand center: approved items first, drafts only when nothing is approved
  const { data: brandRows } = await sb.from("records").select("title,status,data").eq("section", "marketing.brand").neq("status", "Retired").limit(60);
  const approved = (brandRows || []).filter((r: any) => r.status === "Approved");
  const brand = (approved.length ? approved : brandRows || []).map((r: any) => `- [${r.data?.kind || "Note"}${r.status !== "Approved" ? ", draft" : ""}] ${r.title}: ${String(r.data?.text || "").slice(0, 1500)}`).join("\n");

  // Company documents the user may see, never controlled ones, matched on the record's words
  let docs = "";
  if (["write", "pitch", "prep", "brief", "ideas"].includes(action)) {
    try {
      const words = [title, data.topic, data.product, data.segment, data.pillar, data.type, data.kind].filter(Boolean).join(" ");
      const tsq = tsQuery([words || "StarDome AGRON"]);
      if (tsq) {
        const { data: hits } = await sb.rpc("doc_search", { q: tsq, n: 12 });
        const ids = [...new Set((hits || []).map((h: any) => h.record_id))];
        const { data: recs } = ids.length ? await sb.from("records").select("id,controlled").in("id", ids) : { data: [] as any[] };
        const ok = new Set((recs || []).filter((r: any) => !r.controlled).map((r: any) => r.id));
        let size = 0;
        for (const h of hits || []) { if (!ok.has(h.record_id) || !h.content?.trim() || size > 14000) continue; docs += `\n[${h.title} — ${h.file_name} p.${h.page}]\n${h.content.slice(0, 3500)}\n`; size += Math.min(3500, h.content.length); }
      }
    } catch {}
  }

  const grounding = [brand && `BRAND CENTER (follow it; "Do not say" items are forbidden):\n${brand}`, docs && `COMPANY DOCUMENTS (non-controlled excerpts; use facts only from here or the record, still follow the public-release rules):${docs}`].filter(Boolean).join("\n\n");
  const rec = recordText(sec, title, data);
  let task = ""; let max = 1800; let wantJson = false;

  if (action === "write") {
    if (section === "marketing.social") task = `Write the post for ${data.channel || "LinkedIn"} (${data.account || "Company page"}). ${CHANNEL_RULES[data.channel] || CHANNEL_RULES.LinkedIn} Audience: ${data.segment || "decision makers"}. Topic type: ${data.pillar || "Product"}. If the record already has text, improve it. Return only the post text with hashtags at the end.`;
    else if (section === "marketing.press") task = `Write the ${data.format || "Bylined article"} for ${data.outlet || "an industry magazine"} on: ${data.topic || title}. ${PRESS_RULES[data.format] || "Clear structure with a headline, a strong lead and short sections."} Return markdown only.`, max = 3500;
    else if (section === "marketing.media") task = `Draft the content of this ${data.kind || "Presentation"} for ${data.audience || "clients"} (${data.segment || "general"}). For a presentation: 10-14 slides, each with a title, 2-4 bullet points and a [VISUAL: …] note. For a one-pager or brochure: headline, problem, solution, three benefits, how it works at a high level, call to action. Return markdown only.`, max = 3000;
    else if (section === "marketing.campaigns") task = `Write the copy for this ${data.channel || "Email"} campaign, goal: ${data.goal || "Leads"}, audience: ${data.audience || data.segment || "decision makers"}. Email: Subject (under 60 characters, 2 options), Preview text, Body (120-200 words), CTA. Ads: 5 headlines (under 30 characters), 3 descriptions (under 90 characters), CTA. Return markdown only.`;
    else if (section === "marketing.events") task = `Write for this ${data.type || "event"} in ${data.city || "the city"}: if it is a talk or panel, a talk title, a 120-word abstract and a 60-word speaker bio for ${data.speaker || "Michael Kofman, CEO of AGRON"}; if it is a booth, the booth headline, three messages and the demo story. Return markdown only.`;
    else if (section === "marketing.brand") task = `Draft this brand element: ${data.kind || "Company description"}. Company description: give 25-, 50- and 100-word versions. Key message: one line plus three proof points (facts as [TO CONFIRM]). Tone of voice: 6 do / don't rules with examples. Spokesperson bio: 50 and 120 words (facts as [TO CONFIRM]). Return markdown only.`;
    else return new Response("No writer for this section", { status: 400 });
  } else if (action === "pitch") {
    task = section === "marketing.interviews"
      ? `Write a guest pitch email to ${data.host || "the host"} of ${data.outlet || "the show"} (${data.type || "Podcast"}): why ${data.spokesperson || "Michael Kofman, CEO of AGRON"} is a relevant guest, three concrete episode ideas, availability [TO CONFIRM], signature "Best regards, AGRON Inc. · info@agron1.com". Under 200 words. Return the email with a Subject line first.`
      : `Write a pitch email to the editor of ${data.outlet || "the magazine"} offering a ${data.format || "Bylined article"} on: ${data.topic || title}. Why it matters to their readers now, the angle, what we can provide (author, images, interview), signature "Best regards, AGRON Inc. · info@agron1.com". Under 180 words. Return the email with a Subject line first.`;
  } else if (action === "prep" && section === "marketing.interviews") {
    task = `Prepare ${data.spokesperson || "the speaker"} for a ${data.type || "Podcast"} with ${data.outlet || "the outlet"}${data.host ? `, host ${data.host}` : ""}. Write markdown with: 1) Three key messages; 2) 12 likely questions, each with a short approved answer (2-4 sentences) that respects the public-release rules; 3) Difficult questions (price, export, weapons, specific customers, competitors) with a safe bridging answer; 4) Topics and words to avoid; 5) One story or example to tell (facts as [TO CONFIRM]); 6) Closing call to action.`;
    max = 3500;
  } else if (action === "brief" && section === "marketing.video") {
    wantJson = true; max = 3500;
    task = `Create the brief and the script for this ${data.type || "Product presentation"} video, ${data.length || 90} seconds, for ${data.platform || "YouTube"}, audience ${data.segment || "decision makers"}. Return ONLY JSON: {"brief":"markdown: goal, audience, key message, tone, must-show, must-not-show (controlled technical details, weapons, real customers without consent), call to action, deliverables (formats, subtitles, languages)","script":"markdown table: Time | Scene / what we see | Voice-over | On-screen text — covering the full length, ending with the call to action"}`;
  } else if (action === "check") {
    wantJson = true; max = 3000;
    const fields = CHECK_FIELDS[section] || [];
    const text = [`Title: ${title}`, ...fields.filter((k) => data[k]).map((k) => `${k.toUpperCase()}:\n${data[k]}`)].join("\n\n");
    if (text.length < 20) return new Response("Nothing to check yet: write the text first", { status: 400 });
    const banned = bannedHits(text);
    task = `Review the material below against the public-release rules and the brand center. Be strict about rules 1-3 and 5, practical about style.
Return ONLY JSON: {"verdict":"pass"|"fix","summary":"one or two sentences in ${uiLang}","issues":[{"quote":"exact words from the text","problem":"why, in ${uiLang}","fix":"suggested wording in the text's language"}],"needs_legal":true|false,"revised":"the full corrected text of the main field, same language and format, or empty if verdict is pass"}
needs_legal = true when the text discusses capabilities in a way a lawyer should confirm, export, regulation, government customers, or anything close to countermeasures.${banned.length ? `\nAlready detected banned words: ${banned.join(", ")} — this alone means verdict "fix".` : ""}

MATERIAL:
${text}`;
  } else if (action === "repurpose") {
    wantJson = true; max = 2500;
    task = `Turn this material into social drafts. Return ONLY JSON: {"posts":[{"channel":"LinkedIn","title":"short internal title","text":"…","hashtags":"#…"},{"channel":"X",…},{"channel":"Instagram",…}${section === "marketing.video" ? ',{"channel":"YouTube",…}' : ""}]}. ${Object.values(CHANNEL_RULES).slice(0, 3).join(" ")}${section === "marketing.video" ? " " + CHANNEL_RULES.YouTube : ""}`;
  } else if (action === "ideas") {
    wantJson = true; max = 3000;
    const today = new Date().toISOString().slice(0, 10);
    const { data: soon } = await sb.from("records").select("section,title,status,data").in("section", ["marketing.events", "marketing.press", "marketing.interviews", "marketing.video", "marketing.plan"]).limit(80);
    const ctx = (soon || []).map((r: any) => `- ${r.section.split(".")[1]}: ${r.title} [${r.status}] ${r.data?.starts || r.data?.publish || r.data?.session || r.data?.period || ""}`).join("\n");
    task = `Plan the next 4 weeks of social media from ${today}: 8 posts, mostly LinkedIn, some X and Instagram, a balanced mix of topic types (Product, Use case, Company news, Thought leadership, Events, Team & culture, Trust & compliance, Partners), tied to upcoming events and publications when there are any. Return ONLY JSON: {"posts":[{"title":"short title","channel":"LinkedIn|X|Instagram","pillar":"one of the topic types","segment":"Superyachts|Marinas|Ports & terminals|Tankers & commercial vessels|Private islands & estates|Offshore & industrial|Government|Investors & partners|General","product":"AGRON (company)|StarDome|AGRON 1|StarDome + AGRON 1","publish":"YYYY-MM-DD (Tue-Thu)","text":"2-3 sentence idea of the post"}]}\n\nUPCOMING AND RECENT MARKETING WORK:\n${ctx || "none yet"}`;
  } else return new Response("Unknown action", { status: 400 });

  const model = process.env.AI_MODEL_DEEP || "claude-sonnet-5-5";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let out = "";
  try {
    const m: any = await client.messages.create({
      model, max_tokens: max,
      system: [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } } as any, { type: "text", text: grounding || "No brand center items or documents yet: keep facts generic and mark specifics [TO CONFIRM]." }],
      messages: [{ role: "user", content: `${task}\n\nWrite the content in ${action === "check" ? "the language of the material" : outLang}.${wantJson ? " JSON string values must escape quotes and newlines." : ""}\n\nRECORD:\n${rec}` }],
    });
    out = (m.content || []).map((c: any) => c.text || "").join("");
    const u: any = m.usage || {};
    await admin.from("ai_usage").insert({ user_id: me.id, model, input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.round((u.cache_read_input_tokens || 0) * 0.1), output_tokens: u.output_tokens || 0 });
  } catch (e: any) { return new Response(e?.message || "AI request failed", { status: 502 }); }

  try {
    if (!wantJson) return Response.json({ text: out.trim() });
    const j = json(out);
    if (action === "check") {
      const banned = bannedHits([title, ...(CHECK_FIELDS[section] || []).map((k) => String(data[k] || ""))].join("\n"));
      if (banned.length && j.verdict === "pass") j.verdict = "fix";
      return Response.json({ verdict: j.verdict === "pass" ? "pass" : "fix", summary: String(j.summary || ""), issues: Array.isArray(j.issues) ? j.issues.slice(0, 20) : [], needs_legal: !!j.needs_legal, revised: String(j.revised || "") });
    }
    if (action === "brief") return Response.json({ brief: String(j.brief || ""), script: String(j.script || "") });
    return Response.json({ posts: (Array.isArray(j.posts) ? j.posts : []).slice(0, 10) });
  } catch (e: any) { return new Response(e.message, { status: 502 }); }
}
