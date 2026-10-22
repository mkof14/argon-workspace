// Phase 7 — commercial operations: words for the screens (EN/RU/UK/AR), the Assistant's commercial questions
// (allow-listed intents, answered by the database for the signed-in person) and the business-card / QR parsers.
// Pure functions only: nothing here reads or writes data.
export type T4 = { en: string; ru: string; uk: string; ar: string };
export const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

/** The Assistant's commercial questions → one allow-listed intent (+ argument). */
export function crmIntent(q: string): { intent: string; arg?: string } | null {
  const s = q.toLowerCase().replace(/\s+/g, " ").trim();
  const opp = /(opportunit|deal|pipeline|сделк|возможност|угод|можливост|فرص|صفق)/;
  if (/(commercial review|sales review|коммерческ\w* обзор|комерційн\w* огляд|مراجعة تجارية)/.test(s)) return { intent: "review" };
  if (/(follow.?up|связаться|перезвон|зв'язатися|متابعة)/.test(s) && /(today|who|сегодня|кому|с кем|сьогодні|кому|اليوم|من)/.test(s)) return { intent: "followup_today" };
  if (/(who introduced|кто (нас )?представил|хто (нас )?представив|من عرّف|من قدم)/.test(s)) return { intent: "introduced_by", arg: argAfter(q, /(?:who introduced|кто (?:нас )?представил|хто (?:нас )?представив|من عرّف|من قدم)\s*(?:us to|нам|нас|to)?\s*/i) };
  if (/(when did we last|last (spoke|speak|talk|contact)|когда мы последний|коли ми востаннє|آخر مرة تحدثنا)/.test(s)) return { intent: "last_contact", arg: argAfter(q, /(?:with|с|з|مع)\s+/i) };
  if (/(agree|agreed|договорились|домовилися|اتفقنا)/.test(s) && /(last meeting|последн\w* встреч|останн\w* зустріч|آخر اجتماع)/.test(s)) return { intent: "last_meeting", arg: argAfter(q, /(?:with|с|з|مع)\s+/i) };
  if (/(proposal|кп\b|коммерческ\w* предлож|комерційн\w* пропоз|عرض)/.test(s) && /(wait|response|answer|ждут|ответ|чекають|відповід|بانتظار|رد)/.test(s)) return { intent: "proposals_waiting" };
  if (/\bnda/.test(s) && /(not signed|unsigned|не подпис|не підпис|غير موقع)/.test(s)) return { intent: "nda_unsigned" };
  if (/(no next action|без следующ\w* шаг|без наступн\w* крок|بلا خطوة)/.test(s)) return { intent: "no_next_action" };
  if (/(stalled|stuck|застрял|зависл|застрягл|متوقف)/.test(s) && opp.test(s)) return { intent: "stalled" };
  if (opp.test(s) && /(above|over|more than|больше|свыше|понад|більше|أكثر من)/.test(s)) {
    const m = q.match(/([$€]?\s*\d+(?:[.,]\d+)?)\s*(m\b|mln|million|млн|k\b|thousand|тыс|тис)?\s*(usd|aed|eur|\$|€)?/i);
    if (m) {
      const n = Number(m[1].replace(/[$€\s]/g, "").replace(",", ".")); const mult = /^(m|mln|million|млн)$/i.test(m[2] || "") ? 1e6 : /^(k|thousand|тыс|тис)$/i.test(m[2] || "") ? 1e3 : 1;
      const cur = /€|eur/i.test(m[0]) ? "EUR" : /aed/i.test(m[0]) ? "AED" : /\$|usd/i.test(m[0]) ? "USD" : "";
      return { intent: "above_value", arg: `${n * mult}${cur ? " " + cur : ""}` };
    }
  }
  if (/(idex|monaco|exhibition|event|выставк|ивент|виставк|معرض)/.test(s) && /(came from|from|что дал|что пришло|з|من)/.test(s)) {
    const m = q.match(/\b(IDEX(?:\s*\d{4})?|Monaco[^?.,]*)/i); return { intent: "event", arg: m ? m[1].trim() : undefined };
  }
  const geo = q.match(/(?:with|in|for|по|в|у|في)\s+([A-Za-zА-Яа-яЁёІіЇїЄє\s]{2,30}?)\s+(?:opportunit|deals|сделк|возможност|угод|можливост|فرص)/i);
  if (geo && opp.test(s)) return { intent: "geography", arg: geo[1].trim() };
  if (opp.test(s) && /(need my attention|need attention|attention|внимани|уваги|انتباه)/.test(s)) return { intent: "attention" };
  return null;
}
function argAfter(q: string, re: RegExp) { const m = q.split(re); const tail = m.length > 1 ? m[m.length - 1] : ""; return tail.replace(/[?.!]+$/, "").replace(/^(the|this|that)\s+/i, "").trim() || undefined; }

/** A vCard (BEGIN:VCARD … END:VCARD) or MECARD from a QR code → proposed lead fields. Missing fields stay missing. */
export function parseContactCode(text: string): Record<string, string> {
  const t = String(text || "").replace(/\r\n?/g, "\n"); const out: Record<string, string> = {};
  if (/^MECARD:/i.test(t.trim())) {
    for (const part of t.trim().replace(/^MECARD:/i, "").split(/;(?=[A-Z]+:)/)) {
      const [k, ...v] = part.split(":"); const val = v.join(":").replace(/;+$/, "").trim(); if (!val) continue;
      if (/^N$/i.test(k)) { const [last, first] = val.split(","); if (first) out.first_name = first.trim(); if (last) out.last_name = last.trim(); }
      else if (/^TEL$/i.test(k)) out.phone ||= val; else if (/^EMAIL$/i.test(k)) out.email ||= val.toLowerCase(); else if (/^ORG$/i.test(k)) out.organization = val; else if (/^URL$/i.test(k)) out.website = val;
    }
    return out;
  }
  // unfold continuation lines
  const lines = t.replace(/\n[ \t]/g, "").split("\n");
  for (const raw of lines) {
    const i = raw.indexOf(":"); if (i < 0) continue;
    const key = raw.slice(0, i).split(";")[0].toUpperCase(); const val = raw.slice(i + 1).replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim(); if (!val) continue;
    if (key === "N") { const [last, first] = val.split(";"); if (first) out.first_name = first.trim(); if (last) out.last_name = last.trim(); }
    else if (key === "FN" && !out.first_name && !out.last_name) { const p = val.split(/\s+/); out.first_name = p[0]; if (p.length > 1) out.last_name = p.slice(1).join(" "); }
    else if (key === "ORG") out.organization = val.split(";")[0].trim();
    else if (key === "TITLE") out.title = val;
    else if (key === "EMAIL") out.email ||= val.toLowerCase();
    else if (key === "TEL") out.phone ||= val;
    else if (key === "URL") out.website ||= val;
    else if (key === "ADR") { const parts = val.split(";").map((x) => x.trim()).filter(Boolean); const country = parts[parts.length - 1]; if (country && country.length <= 40) out.country = country; }
  }
  return out;
}

/** Text from a business card (typed, pasted or read by a model) → proposed fields, each only if it is written there. */
export function parseCardText(text: string): Record<string, string> {
  const t = String(text || ""); const out: Record<string, string> = {};
  if (/BEGIN:VCARD|^MECARD:/im.test(t)) return parseContactCode(t);
  const email = t.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/); if (email) out.email = email[0].toLowerCase();
  const phone = t.match(/(?:\+|00)\d[\d\s().-]{7,18}\d/); if (phone) out.phone = phone[0].replace(/\s+/g, " ").trim();
  const web = t.match(/\b(?:https?:\/\/)?(?:www\.)[\w-]+(?:\.[\w-]+)+[^\s]*/i) || t.match(/\bhttps?:\/\/[^\s]+/i); if (web) out.website = web[0];
  const lines = t.split(/\n+/).map((x) => x.trim()).filter((x) => x && !x.includes("@") && !/^(?:\+|00|tel|phone|mob)/i.test(x) && !/www\.|https?:/i.test(x));
  const title = lines.find((x) => /(director|manager|officer|head|founder|ceo|cto|cfo|captain|chief|president|engineer|директор|менеджер|руководител|керівник|مدير)/i.test(x)); if (title) out.title = title;
  const org = lines.find((x) => /\b(llc|ltd|inc|fze|fzco|gmbh|group|holding|marine|port|yacht|authority|company|corp|limited|s\.a\.)\b/i.test(x)); if (org) out.organization = org;
  const name = lines.find((x) => x !== title && x !== org && /^[A-ZА-ЯЁІЇЄ][\p{L}'’-]+(?:\s+[A-ZА-ЯЁІЇЄ][\p{L}'’-]+){1,2}$/u.test(x));
  if (name) { const p = name.split(/\s+/); out.first_name = p[0]; out.last_name = p.slice(1).join(" "); }
  return out;
}

export const CRM_KIND: Record<string, T4> = {
  needs_action: L("Needs action", "Требует действий", "Потребує дій", "يتطلب إجراء"),
  active: L("Active opportunities", "Активные возможности", "Активні можливості", "الفرص النشطة"),
  proposals_waiting: L("Proposals waiting", "КП ждут ответа", "КП чекають відповіді", "عروض بانتظار الرد"),
  responses: L("Customer / partner responses", "Ответы клиентов и партнёров", "Відповіді клієнтів і партнерів", "ردود العملاء والشركاء"),
  upcoming_decisions: L("Upcoming decisions", "Ожидаемые решения", "Очікувані рішення", "قرارات قادمة"),
  stalled: L("Stalled opportunities", "Застрявшие возможности", "Застряглі можливості", "فرص متوقفة"),
  wins: L("Recent wins", "Недавние победы", "Нещодавні перемоги", "مكاسب حديثة"),
  losses: L("Recent losses", "Недавние проигрыши", "Нещодавні програші", "خسائر حديثة"),
};
export const HEALTH: Record<string, { t: T4; cls: string }> = {
  Healthy: { t: L("Healthy", "В порядке", "Гаразд", "سليمة"), cls: "c-ok" },
  Attention: { t: L("Attention", "Внимание", "Увага", "انتباه"), cls: "c-warn" },
  Risk: { t: L("Risk", "Риск", "Ризик", "خطر"), cls: "c-bad" },
  Stalled: { t: L("Stalled", "Застряла", "Застрягла", "متوقفة"), cls: "c-bad" },
};
