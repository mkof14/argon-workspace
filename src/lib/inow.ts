// 1inow — the deterministic intelligence layer over AGRON Workspace (P10). Pure functions: no I/O, no model.
//
// The server (src/lib/server/inow.ts) reads the person's work from the existing Workspace engines with the person's
// own rights — tasks, meetings, approvals, workflow steps, Attention, Waiting For, Open Loops, commercial follow-ups,
// shop-floor work, detected commitments — and turns each into an Item with SIGNALS (facts such as "overdue 3 days",
// "meeting in 40 minutes", "customer waiting 4 days"). This module ranks the items with fixed rules and explains
// every rank with the signals that produced it ("HIGH because: due today · blocks a colleague · assigned to you").
// There is no score a person cannot read, and no AI decides the order. AI may only phrase an explanation.
//
// Personal state (pin, snooze, dismiss, not relevant, remind at) is applied here too. A controlled item — an
// approval or a decision that waits for this person — can be pinned but never hidden: personal preference does not
// remove a mandatory action.

export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type Src = "task" | "meeting" | "approval" | "workflow" | "attention" | "waiting" | "loop" | "commitment" | "followup" | "lead" | "work_order" | "unit" | "process" | "reminder";
export type SignalCode =
  | "meeting_soon" | "meeting_today" | "overdue" | "due_today" | "due_tomorrow" | "due_soon" | "approval_waiting" | "decision_waiting" | "blocks_others" | "blocked"
  | "customer_waiting" | "vendor_waiting" | "partner_waiting" | "waiting_on_person" | "external_commitment" | "escalation_due" | "project_at_risk" | "critical"
  | "build_blocked" | "manufacturing_impact" | "procurement_impact" | "commercial_followup" | "no_followup" | "stalled" | "unanswered" | "priority_high"
  | "assigned_to_me" | "promised" | "reminder_due" | "pinned" | "sla_overdue";
export type Signal = { code: SignalCode; n?: number; text?: string };
export type Suggest = { id: string; kind: "open" | "complete" | "followup_task" | "reminder" | "reschedule" | "snooze" | "pin" | "dismiss" | "brief" | "blockers" | "assign" | "confirm_commitment" | "resolve"; label: string; controlled?: boolean };
export type Item = {
  key: string; src: Src; kind: string; title: string; link: string;
  record_id?: string | null; section?: string | null; project?: { id: string; title: string } | null; owner_id?: string | null;
  due?: string | null; at?: string | null; since?: string | null; status?: string | null;
  signals: Signal[]; controlled?: boolean;
  /** my own work (assigned to me, my meeting, my approval, my follow-up, an item I own) — ranks before company-wide items of the same priority */ mine?: boolean;
  waiting?: { on?: string | null; party?: string | null; age_days?: number | null; last_activity?: string | null; escalation?: string | null; expected?: string | null } | null;
  /** REQUIRED next step: defined by a workflow/approval/control (never by a guess) */ required_next?: string | null;
  /** a SUGGESTED next action text from a deterministic engine (open loops, attention) — shown as a suggestion */ hint?: string | null;
  evidence?: { excerpt: string; confidence: "high" | "medium" | "low"; source_link: string } | null;
};
export type State = { item_key: string; pinned?: boolean; dismissed_at?: string | null; not_relevant?: boolean; snooze_until?: string | null; remind_at?: string | null };
export type Ranked = Item & { priority: Priority; reasons: Signal[]; pinned: boolean; suggested: Suggest[]; hidden_reason?: string };
export type Section = "now" | "today" | "attention" | "waiting" | "decisions" | "loops" | "next";
export type MyDay = { now: Ranked[]; today: Ranked[]; attention: Ranked[]; waiting: Ranked[]; decisions: Ranked[]; loops: Ranked[]; next: { item: Ranked; required?: string | null; hint?: string | null; suggested: Suggest[] }[]; hidden: number; counts: Record<string, number> };

// strength of each signal: decides HIGH / MEDIUM and the order of reasons (fixed, documented, tested)
const HIGH: SignalCode[] = ["meeting_soon", "critical", "blocks_others", "build_blocked", "overdue", "approval_waiting", "customer_waiting", "escalation_due", "sla_overdue", "reminder_due"];
const MEDIUM: SignalCode[] = ["decision_waiting", "due_today", "external_commitment", "project_at_risk", "vendor_waiting", "partner_waiting", "manufacturing_impact", "procurement_impact",
  "commercial_followup", "no_followup", "blocked", "stalled", "unanswered", "promised", "meeting_today", "due_tomorrow", "waiting_on_person", "priority_high"];
const ORDER: SignalCode[] = ["pinned", ...HIGH, ...MEDIUM, "due_soon", "assigned_to_me"];
const rank = (c: SignalCode) => { const i = ORDER.indexOf(c); return i < 0 ? 99 : i; };

/** A signal that makes an item HIGH, given its strength (thresholds are part of the rule, not tuned per person). */
function isHigh(s: Signal): boolean {
  switch (s.code) {
    case "meeting_soon": return (s.n ?? 0) <= 60;
    case "overdue": return (s.n ?? 1) >= 1;
    case "approval_waiting": return (s.n ?? 0) >= 24; // hours
    case "customer_waiting": return (s.n ?? 0) >= 2;  // days
    case "critical": case "blocks_others": case "build_blocked": case "escalation_due": case "sla_overdue": case "reminder_due": return true;
    default: return false;
  }
}
export function priorityOf(signals: Signal[]): Priority {
  if (signals.some(isHigh)) return "HIGH";
  // due today together with a strong context is also HIGH
  const codes = new Set(signals.map((s) => s.code));
  if (codes.has("due_today") && (codes.has("priority_high") || codes.has("external_commitment") || codes.has("customer_waiting"))) return "HIGH";
  if (signals.some((s) => MEDIUM.includes(s.code) || (s.code === "approval_waiting"))) return "MEDIUM";
  return "LOW";
}
const PORDER: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** The context-sensitive actions an item allows (what the person may actually do is checked again on the server). */
export function suggestionsFor(it: Item): Suggest[] {
  const s: Suggest[] = [{ id: "open", kind: "open", label: "open" }];
  const codes = new Set(it.signals.map((x) => x.code));
  if (it.src === "task") {
    s.push({ id: "complete", kind: "complete", label: "complete" });
    if (codes.has("overdue") || codes.has("due_today")) s.push({ id: "reschedule", kind: "reschedule", label: "move_tomorrow" });
  }
  if (it.src === "approval" || it.src === "workflow" || it.controlled) s.push({ id: "decide", kind: "open", label: "decide", controlled: true });
  if (it.src === "waiting" || codes.has("vendor_waiting") || codes.has("customer_waiting") || codes.has("partner_waiting") || codes.has("waiting_on_person"))
    s.push({ id: "followup", kind: "followup_task", label: "follow_up" }, { id: "remind", kind: "reminder", label: "remind_me" }, { id: "resolved", kind: "resolve", label: "resolved" });
  if (it.src === "followup" || it.src === "lead" || codes.has("no_followup") || codes.has("commercial_followup")) s.push({ id: "followup", kind: "followup_task", label: "schedule_follow_up" });
  if (it.src === "meeting") s.push({ id: "brief", kind: "brief", label: "meeting_brief" });
  if (codes.has("project_at_risk") || codes.has("build_blocked") || codes.has("blocked")) s.push({ id: "blockers", kind: "blockers", label: "show_blockers" });
  if (it.src === "commitment") s.push({ id: "confirm", kind: "confirm_commitment", label: "make_task" });
  if (it.src === "attention" || it.src === "loop") s.push({ id: "followup", kind: "followup_task", label: "create_follow_up" });
  if (!it.controlled) s.push({ id: "snooze", kind: "snooze", label: "snooze" }, { id: "dismiss", kind: "dismiss", label: "not_relevant" });
  s.push({ id: "pin", kind: "pin", label: "pin" });
  const seen = new Set<string>(); return s.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** Rank one item: priority, the reasons in their order of strength, pin, suggestions. */
export function rankItem(it: Item, st?: State): Ranked {
  const signals = [...it.signals];
  if (st?.pinned) signals.push({ code: "pinned" });
  const reasons = signals.filter((s) => s.code !== "assigned_to_me" || signals.length === 1).sort((a, b) => rank(a.code) - rank(b.code));
  if (signals.some((s) => s.code === "assigned_to_me") && !reasons.some((r) => r.code === "assigned_to_me")) reasons.push({ code: "assigned_to_me" });
  return { ...it, signals, priority: priorityOf(signals), reasons: reasons.slice(0, 5), pinned: !!st?.pinned, suggested: suggestionsFor(it) };
}

const strongest = (r: Ranked) => Math.min(...r.reasons.map((x) => rank(x.code)), 99);
/** Deterministic order: pinned, priority, strongest reason, earliest time, oldest waiting, title (for stability). */
export function compare(a: Ranked, b: Ranked) {
  return Number(b.pinned) - Number(a.pinned) || PORDER[a.priority] - PORDER[b.priority] || Number(!!b.mine) - Number(!!a.mine) || strongest(a) - strongest(b)
    || String(a.at || a.due || "9999").localeCompare(String(b.at || b.due || "9999")) || String(a.since || "9999").localeCompare(String(b.since || "9999"))
    || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

/** Personal state: hidden (dismissed, not relevant, snoozed) unless the item is controlled; a due reminder resurfaces it. */
export function applyState(items: Item[], states: State[], now: number): { visible: { it: Item; st?: State }[]; hidden: number } {
  const by = new Map(states.map((s) => [s.item_key, s])); let hidden = 0; const visible: { it: Item; st?: State }[] = [];
  for (const it of items) {
    const st = by.get(it.key);
    const remind = st?.remind_at && Date.parse(st.remind_at) <= now;
    const snoozed = st?.snooze_until && Date.parse(st.snooze_until) > now;
    const gone = st?.dismissed_at || st?.not_relevant;
    if (!it.controlled && !remind && (snoozed || gone)) { hidden++; continue; }
    visible.push({ it: remind ? { ...it, signals: [...it.signals, { code: "reminder_due" }] } : it, st });
  }
  return { visible, hidden };
}

/** Merge duplicates (the same record from several engines): one item, the union of its signals, the strongest source. */
export function dedupe(items: Item[]): Item[] {
  const out = new Map<string, Item>(); const srcRank: Src[] = ["approval", "workflow", "meeting", "task", "waiting", "attention", "loop", "followup", "lead", "work_order", "unit", "process", "commitment", "reminder"];
  for (const it of items) {
    const k = it.record_id ? `${it.record_id}` : it.key;
    const cur = out.get(k);
    if (!cur) { out.set(k, { ...it, signals: [...it.signals] }); continue; }
    const keep = srcRank.indexOf(cur.src) <= srcRank.indexOf(it.src) ? cur : it, other = keep === cur ? it : cur;
    const sig = [...keep.signals]; for (const s of other.signals) if (!sig.some((x) => x.code === s.code)) sig.push(s);
    out.set(k, { ...keep, signals: sig, controlled: keep.controlled || other.controlled, mine: keep.mine || other.mine, waiting: keep.waiting || other.waiting, required_next: keep.required_next || other.required_next, hint: keep.hint || other.hint, due: keep.due || other.due, evidence: keep.evidence || other.evidence });
  }
  return [...out.values()];
}

const sectionOf = (r: Ranked, today: string): Section => {
  const c = new Set(r.signals.map((s) => s.code));
  if (r.src === "approval" || (r.src === "workflow" && r.controlled) || c.has("decision_waiting")) return "decisions";
  if (r.src === "waiting") return "waiting";
  if (r.src === "loop" || r.src === "commitment") return "loops";
  if (r.src === "meeting" || r.due === today || c.has("due_today") || r.src === "workflow" || r.src === "work_order" || r.src === "followup" || r.src === "lead" || c.has("reminder_due")) return "today";
  return "attention";
};

/**
 * My Day. NOW holds the few things that truly need action now: pinned items and HIGH items, at most `nowMax`.
 * Every other item appears once, in the section its kind belongs to. NEXT lists the next step of the first items:
 * a REQUIRED step when the workflow/engine defines one, otherwise a SUGGESTED action — never mixed up.
 */
export function buildMyDay(items: Item[], states: State[], o: { now: number; today: string; nowMax?: number; perSection?: number }): MyDay {
  const { visible, hidden } = applyState(dedupe(items), states, o.now);
  const ranked = visible.map(({ it, st }) => rankItem(it, st)).sort(compare);
  const nowMax = o.nowMax ?? 5, per = o.perSection ?? 25;
  const now = ranked.filter((r) => r.pinned || r.priority === "HIGH").slice(0, nowMax);
  const inNow = new Set(now.map((r) => r.key));
  const sec: Record<Exclude<Section, "now" | "next">, Ranked[]> = { today: [], attention: [], waiting: [], decisions: [], loops: [] };
  for (const r of ranked) { if (inNow.has(r.key)) continue; (sec[sectionOf(r, o.today) as keyof typeof sec] ||= []).push(r); }
  const next = [...now, ...sec.decisions, ...sec.today, ...sec.attention, ...sec.waiting].slice(0, 6)
    .map((item) => ({ item, required: item.required_next || null, hint: item.required_next ? null : item.hint || null, suggested: item.required_next ? [] : item.suggested.filter((s) => !["open", "pin", "snooze", "dismiss"].includes(s.kind)).slice(0, 2) }));
  const counts = { now: now.length, today: sec.today.length, attention: sec.attention.length, waiting: sec.waiting.length, decisions: sec.decisions.length, loops: sec.loops.length };
  return { now, today: sec.today.slice(0, per), attention: sec.attention.slice(0, per), waiting: sec.waiting.slice(0, per), decisions: sec.decisions.slice(0, per), loops: sec.loops.slice(0, per), next, hidden, counts };
}

/* ------------------------------- explanations (localized in the UI by code) ------------------------------- */
type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
export const SIGNAL_TEXT: Record<SignalCode, T4> = {
  meeting_soon: L("Meeting in {n} min", "Встреча через {n} мин", "Зустріч за {n} хв", "اجتماع بعد {n} دقيقة"),
  meeting_today: L("Meeting today", "Встреча сегодня", "Зустріч сьогодні", "اجتماع اليوم"),
  overdue: L("Overdue {n} d", "Просрочено {n} дн.", "Прострочено {n} дн.", "متأخر {n} يوم"),
  due_today: L("Due today", "Срок сегодня", "Термін сьогодні", "مستحق اليوم"),
  due_tomorrow: L("Due tomorrow", "Срок завтра", "Термін завтра", "مستحق غدًا"),
  due_soon: L("Due in {n} d", "Срок через {n} дн.", "Термін через {n} дн.", "مستحق خلال {n} يوم"),
  approval_waiting: L("Approval waiting {n} h", "Согласование ждёт {n} ч", "Погодження чекає {n} год", "موافقة تنتظر {n} ساعة"),
  decision_waiting: L("Needs your decision", "Нужно ваше решение", "Потрібне ваше рішення", "يتطلب قرارك"),
  blocks_others: L("Blocks {text}", "Блокирует: {text}", "Блокує: {text}", "يعيق: {text}"),
  blocked: L("Blocked", "Заблокировано", "Заблоковано", "معطّل"),
  customer_waiting: L("Customer waiting {n} d", "Клиент ждёт {n} дн.", "Клієнт чекає {n} дн.", "العميل ينتظر {n} يوم"),
  vendor_waiting: L("Waiting on vendor {n} d", "Ждём поставщика {n} дн.", "Чекаємо постачальника {n} дн.", "بانتظار المورّد {n} يوم"),
  partner_waiting: L("Waiting on partner {n} d", "Ждём партнёра {n} дн.", "Чекаємо партнера {n} дн.", "بانتظار الشريك {n} يوم"),
  waiting_on_person: L("Waiting on {text} {n} d", "Ждём: {text}, {n} дн.", "Чекаємо: {text}, {n} дн.", "بانتظار {text} {n} يوم"),
  external_commitment: L("External commitment", "Внешнее обязательство", "Зовнішнє зобов’язання", "التزام خارجي"),
  escalation_due: L("Escalation due", "Пора эскалировать", "Час ескалювати", "حان التصعيد"),
  project_at_risk: L("Project at risk", "Проект под угрозой", "Проєкт під загрозою", "المشروع في خطر"),
  critical: L("Critical", "Критично", "Критично", "حرج"),
  build_blocked: L("Blocks build {text}", "Блокирует сборку {text}", "Блокує збірку {text}", "يعيق البناء {text}"),
  manufacturing_impact: L("Manufacturing impact", "Влияет на производство", "Впливає на виробництво", "أثر على التصنيع"),
  procurement_impact: L("Procurement impact", "Влияет на закупку", "Впливає на закупівлю", "أثر على المشتريات"),
  commercial_followup: L("Follow-up due", "Пора связаться", "Час зв’язатися", "حان موعد المتابعة"),
  no_followup: L("No follow-up {n} d", "Нет связи {n} дн.", "Немає зв’язку {n} дн.", "لا متابعة منذ {n} يوم"),
  stalled: L("No movement {n} d", "Без движения {n} дн.", "Без руху {n} дн.", "بلا تقدم {n} يوم"),
  unanswered: L("Unanswered {n} d", "Без ответа {n} дн.", "Без відповіді {n} дн.", "بلا رد {n} يوم"),
  priority_high: L("High priority", "Высокий приоритет", "Високий пріоритет", "أولوية عالية"),
  assigned_to_me: L("Assigned to you", "Назначено вам", "Призначено вам", "مُسند إليك"),
  promised: L("You promised it", "Вы обещали", "Ви обіцяли", "وعدت به"),
  reminder_due: L("Your reminder", "Ваше напоминание", "Ваше нагадування", "تذكيرك"),
  pinned: L("Pinned by you", "Закреплено вами", "Закріплено вами", "مثبّت بواسطتك"),
  sla_overdue: L("Past its deadline in the process", "Срок шага процесса истёк", "Термін кроку процесу минув", "تجاوز موعد خطوة العملية"),
};
export function explain(s: Signal, lang: keyof T4 = "en") {
  return SIGNAL_TEXT[s.code][lang].replace("{n}", String(s.n ?? "")).replace("{text}", s.text || "").replace(/\s+/g, " ").trim();
}
/** "HIGH because: due today · blocks C20 assembly · assigned to you" */
export function why(r: Ranked, lang: keyof T4 = "en") {
  const word = { HIGH: L("HIGH", "ВЫСОКИЙ", "ВИСОКИЙ", "عالٍ"), MEDIUM: L("MEDIUM", "СРЕДНИЙ", "СЕРЕДНІЙ", "متوسط"), LOW: L("LOW", "НИЗКИЙ", "НИЗЬКИЙ", "منخفض") }[r.priority][lang];
  const because = L("because", "потому что", "тому що", "لأن")[lang];
  return `${word} ${because}: ${r.reasons.map((s) => explain(s, lang)).join(" · ")}`;
}

/* --------------------------------------- Ask 1inow: deterministic intents --------------------------------------- */
export type AskIntent = "attention" | "waiting_me" | "waiting_others" | "changes" | "stalled" | "approvals" | "decisions" | "project" | "blockers" | "followups" | "proposals_no_response"
  | "vendors_late" | "next" | "open_loops" | "promises" | "important" | "today" | "unknown";
const has = (s: string, w: (string | RegExp)[]) => w.some((x) => (typeof x === "string" ? s.includes(x) : x.test(s)));
/** Question → a deterministic intent answered from records (no model needed); "unknown" goes to the Assistant. */
export function askIntent(q: string): { intent: AskIntent; subject?: string } {
  const s = q.toLowerCase().replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
  const subj = (s.match(/\b(c ?\d{2,3}(?: ?#? ?\d{2,4})?|sprinter|idex)\b/i)?.[1] || "").replace(/\s+/g, " ").trim() || undefined;
  // a named subject after "happening with / status of / blocking": any project, build unit, customer or vendor name
  const free = (s.match(/(?:happening with|status of|blocking|что с|що з|как дела с|як справи з|что блокирует|що блокує)\s+(?:the\s+)?(.{2,60})$/)?.[1] || "").trim() || undefined;
  if (has(s, ["blocking", "blocked", "блокир", "блокує", "мешает", "заблок"]) && (subj || free)) return { intent: "blockers", subject: subj || free };
  if (has(s, ["happening with", "status of", "что с ", "що з ", "как дела с", "як справи з"]) && (subj || free)) return { intent: "project", subject: subj || free };
  if (has(s, ["waiting for me", "waiting on me", "ждут от меня", "чекають від мене", "what is waiting for me"])) return { intent: "waiting_me" };
  if (has(s, ["waiting for from", "from others", "we waiting", "are we waiting", "чего мы ждём", "чего ждём", "на что ждём", "чого ми чекаємо", "кого ждём", "who are we waiting"])) return { intent: "waiting_others" };
  if (has(s, ["changed", "what's new", "изменил", "что нового", "змінил", "що нового"])) return { intent: "changes" };
  if (has(s, ["stalled", "stuck", "застрял", "буксует", "застряг"])) return { intent: "stalled" };
  if (has(s, ["approval", "approve", "согласован", "утверд", "погоджен"])) return { intent: "approvals" };
  if (has(s, ["decision", "решени", "рішен"])) return { intent: "decisions" };
  if (has(s, ["proposal", "предложени", "пропозиц", "кп "]) && has(s, ["no response", "without response", "без ответа", "без відповіді", "not answered"])) return { intent: "proposals_no_response" };
  if (has(s, ["vendor", "supplier", "поставщик", "постачальник"]) && has(s, ["late", "overdue", "опаздыва", "просроч", "запізн"])) return { intent: "vendors_late" };
  if (has(s, ["follow-up", "follow up", "followup", "связаться", "перезвонить", "зв’язатися", "зв'язатися"])) return { intent: "followups", subject: subj };
  if (has(s, ["promise", "promised", "обещал", "обіцяв"])) return { intent: "promises" };
  if (has(s, ["open loop", "незакрыт", "незакрит", "хвост"])) return { intent: "open_loops" };
  if (has(s, ["what should i do", "do next", "next step", "что делать дальше", "что мне делать", "що робити далі"])) return { intent: "next" };
  if (has(s, ["most important", "главн", "найважливіш", "самое важное"])) return { intent: "important" };
  if (has(s, ["attention", "внимани", "уваги", "уваг"])) return { intent: "attention" };
  if (has(s, ["today", "сегодня", "сьогодні", "my day", "мой день"])) return { intent: "today" };
  if (subj) return { intent: "project", subject: subj };
  return { intent: "unknown" };
}

/* ----------------------------- the inbox: quick capture classified into Workspace objects ----------------------------- */
export type CaptureKind = "task" | "reminder" | "call" | "followup" | "note" | "proposal_due" | "review" | "unresolved";
/** "Call John tomorrow about IDEX pricing" → call · John · IDEX · tomorrow. Deterministic; unresolved stays in the Inbox. */
export function classifyCapture(text: string): { kind: CaptureKind; person?: string; context?: string; confidence: "high" | "medium" | "low" } {
  const s = text.trim(); const l = s.toLowerCase();
  const lt = s.charAt(0).toLowerCase() + s.slice(1); // "Call John" → the verb matches, the name keeps its capital
  const person = (lt.match(/(?<![\p{L}])(?:call|talk to|email|ask|remind|позвонить|позвони|поговорить с|поговори с|написать|зателефонувати|поговорити з)\s+([A-ZА-ЯЁІЇЄ][\p{L}'-]+)/u) || [])[1];
  const context = (s.match(/(?<![\p{L}])(?:about|re|regarding|по поводу|про|насчёт|щодо)\s+(.+?)(?:\s+(?:tomorrow|today|next week|by \w+|on \w+|завтра|сегодня|на следующей неделе|до \w+|сьогодні))?$/iu) || [])[1]?.trim();
  // word edges that also work for Cyrillic and Arabic (\b only knows ASCII letters)
  const w = (alts: string) => new RegExp(`(?<![\\p{L}])(?:${alts})(?![\\p{L}])`, "u");
  const kind: CaptureKind = w("call|позвонить|позвони|зателефонувати|зателефонуй|перезвонить|перезвони").test(l) ? "call"
    : w("remind|remember|напомни|напомнить|не забыть|нагадай|нагадати").test(l) ? "reminder"
    : w("follow up|follow-up|связаться|напомнить клиенту|зв'язатися|зв’язатися").test(l) ? "followup"
    : w("proposal|предложение|кп|пропозиці[юя]").test(l) && w("by|до|к").test(l) ? "proposal_due"
    : w("review|check|проверить|посмотреть|переглянути|перевірити").test(l) ? "review"
    : w("need|нужно|надо|треба|потрібно|todo|сделать|зробити").test(l) ? "task" : "unresolved";
  const confidence = kind === "unresolved" ? "low" : person || context ? "high" : "medium";
  return { kind, person, context, confidence };
}
