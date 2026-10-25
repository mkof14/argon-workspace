// Voice and typed commands → a structured proposal. Pure and deterministic (no model, no network): the same words
// on the same day always give the same proposal. Adapted from the 1inow voice parser (intent words, relative due
// dates, the read / write split); resolution of people, tasks and projects and every write happen on the server,
// under the person's own rights, after confirmation (src/lib/server/actions.ts).

export type Risk = "read" | "low" | "material" | "controlled";
export type Intent =
  | "show_today" | "show_attention" | "show_risks" | "show_blocked" | "show_overdue" | "show_waiting" | "show_decisions" | "show_notifications"
  | "open_project" | "search_project" | "search_document" | "search_person"
  | "create_task" | "assign_task" | "change_due_date" | "complete_task" | "create_reminder" | "note"
  | "controlled" | "unknown";
export type Parsed = {
  intent: Intent; risk: Risk; confidence: "high" | "medium" | "low";
  slots: { title?: string; person?: string; task?: string; project?: string; date?: string; query?: string };
  missing: ("title" | "person" | "task" | "date" | "query")[];
  route?: string;
};

export const READ_ROUTES: Partial<Record<Intent, string>> = {
  show_today: "/", show_attention: "/control?view=attention", show_risks: "/portfolio?tab=risk", show_blocked: "/control?view=blocked",
  show_overdue: "/control?view=overdue", show_waiting: "/control?view=waiting", show_decisions: "/control?view=decisions", show_notifications: "/notifications",
};

const norm = (s: string) => s.toLowerCase().replace(/[«»"“”„'`]/g, "").replace(/[.,!?;:]+(\s|$)/g, " ").replace(/\s+/g, " ").trim();
const has = (s: string, words: (string | RegExp)[]) => words.some((w) => (typeof w === "string" ? s.includes(w) : w.test(s)));

/* ------------------------------ dates (relative to "today" in the person's time zone) ------------------------------ */
const WEEKDAYS: [RegExp, number][] = [
  [/\b(sunday|sun)\b|воскресень[еяю]|неділ[яюі]/, 0], [/\b(monday|mon)\b|понедельник|понеділ(ок|ка)/, 1], [/\b(tuesday|tue)\b|вторник|вівтор(ок|ка)/, 2],
  [/\b(wednesday|wed)\b|сред[ауые]|серед[ауи]/, 3], [/\b(thursday|thu)\b|четверг|четвер/, 4], [/\b(friday|fri)\b|пятниц[ауые]|п.ятниц[юяі]/, 5], [/\b(saturday|sat)\b|суббот[ауые]|субот[уаи]/, 6],
];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (base: string, n: number) => iso(new Date(Date.parse(base + "T12:00:00Z") + n * 864e5));
const dow = (base: string) => new Date(base + "T12:00:00Z").getUTCDay();
/** A due date in the words, or null. `today` is YYYY-MM-DD. "Friday" = the next Friday (today if today is Friday? no — the next one). */
export function parseDate(text: string, today: string): { date: string; match: string } | null {
  const s = norm(text);
  const m = (re: RegExp) => s.match(re)?.[0] || "";
  let x: string;
  if ((x = m(/\b(20\d{2}-\d{2}-\d{2})\b/))) return { date: x, match: x };
  if ((x = m(/\b(day after tomorrow)\b|послезавтра|післязавтра/))) return { date: addDays(today, 2), match: x };
  if ((x = m(/\b(today|tonight)\b|сегодня|сьогодні/))) return { date: today, match: x };
  if ((x = m(/\b(tomorrow)\b|завтра/))) return { date: addDays(today, 1), match: x };
  if ((x = m(/\b(next week)\b|на следующей неделе|следующ(ей|ую) недел[еюя]|наступного тижня|наступн(ий|ому) тижн[іь]/))) return { date: addDays(today, 7), match: x };
  if ((x = m(/\b(end of (the )?week)\b|к концу недели|до кінця тижня/))) { const d = dow(today); return { date: addDays(today, ((5 - d + 7) % 7) || 7), match: x }; }
  const inN = s.match(/\b(?:in|через)\s+(\d{1,3})\s+(?:days?|дн(?:я|ей|ень)|дні|днів)\b/);
  if (inN) return { date: addDays(today, Number(inN[1])), match: inN[0] };
  for (const [re, wd] of WEEKDAYS) {
    const mm = s.match(new RegExp(`(?:\\b(?:on|by|next|this)\\s+|\\bв[о]?\\s+|\\bдо\\s+|\\bу\\s+|\\bк\\s+)?(?:${re.source})`));
    if (mm) { const d = dow(today); return { date: addDays(today, ((wd - d + 7) % 7) || 7), match: mm[0] }; }
  }
  return null;
}

/* ------------------------------ the words of each command ------------------------------ */
const CONTROLLED = [/\bapprove\b/, /\bdelete\b/, /\bremove\b/, /grant (me )?access/, /\bsend (an? )?e-?mail\b/, /утверд/, /согласуй/, /удали/, /дай доступ/, /отправь письмо/, /затверд/, /видали/, /надішли лист/];
const READS: [Intent, (string | RegExp)[]][] = [
  ["show_attention", ["attention", "внимани", "уваги", "увага"]],
  ["show_risks", [/\brisks?\b/, "at risk", "риск", "ризик"]],
  ["show_blocked", [/\bblock(ed|ers?)\b/, "заблок", "блокир", "блоку"]],
  ["show_overdue", ["overdue", /\blate\b/, "просроч", "простроч"]],
  ["show_waiting", ["waiting", "wait for", "ждём", "ждем", "ожида", "чекаємо", "очіку"]],
  ["show_decisions", ["decision", "решени", "рішен"]],
  ["show_notifications", ["notification", "уведомлен", "сповіщен"]],
  ["show_today", ["show today", "what's today", "what is today", "my day", /^today$/, "что сегодня", "покажи сегодня", "що сьогодні", "мой день", "мій день"]],
];
const E = "(?=[\\s:,.!?]|$)"; // the end of a word (\\b does not see Cyrillic letters)
const CREATE_TASK = new RegExp(`^(?:please\\s+)?(?:create|add|new|make)\\s+(?:a\\s+)?task${E}|^(?:создай|создать|добавь|поставь|новая)\\s+задач[ау]${E}|^(?:створи|додай|постав|нове)\\s+завдання${E}|^задача${E}`);
const REMIND = new RegExp(`^(?:remind me|(?:create|add|set)(?: a)? reminder|создай напоминание|поставь напоминание|напомни(?: мне)?|нагадай(?: мені)?|створи нагадування)${E}`);
const NOTE = new RegExp(`^(?:note|write down|record|запиши себе|запиши|заметка|запам.ятай|нотатка)${E}`);
const ASSIGN = new RegExp(`^(?:assign|reassign|назначь|переназначь|признач|перепризнач)${E}`);
const DUE = new RegExp(`(?:move|change|shift|push|postpone|reschedule)\\b.*\\b(?:deadline|due(?: date)?)\\b|^(?:перенеси|сдвинь|измени|поменяй)\\s.*(?:срок|дедлайн)|^(?:перенеси|зміни|посунь)\\s.*(?:термін|дедлайн)`);
const COMPLETE = new RegExp(`^(?:complete|finish|close|mark)\\b.*\\btask\\b|\\bmark\\b.*\\b(?:done|complete)\\b|^(?:закрой|заверши|отметь)\\s.*задач|задача .* (?:выполнена|готова)$|^(?:закрий|заверши|познач)\\s.*завдан`);
const OPEN_PROJECT = /^(?:open|show|go to)\s+(?:the\s+)?project\s+(.+)$|^(?:открой|покажи)\s+проект\s+(.+)$|^(?:відкрий|покажи)\s+про[еє]кт\s+(.+)$/;
const SEARCH = /^(?:find|search(?: for)?|look up|найди|поищи|знайди|пошукай)\s+(project|document|doc|person|employee|colleague|проект|документ|человека|сотрудника|коллегу|про[еє]кт|людину|співробітника|колегу)\s+(.+)$/;

const PERSON_EN = /\bfor\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)\b/u;
const PERSON_RU = /^(?:создай|создать|добавь|поставь|новая|створи|додай|постав|нове)\s+(?:задачу|задача|завдання)\s+(?:для\s+)?([А-ЯЁІЇЄҐA-Z][\p{L}'-]+)/u;

const cleanTitle = (s: string) => s.replace(/^[\s:—–-]+|[\s.,;:—–-]+$/g, "").replace(/\s+/g, " ").trim();
const cut = (s: string, part?: string) => (part ? s.replace(part, " ") : s);

export function parseCommand(raw: string, today: string): Parsed {
  const text = raw.trim(); const s = norm(text);
  const out = (p: Partial<Parsed> & Pick<Parsed, "intent" | "risk">): Parsed => ({ confidence: "high", slots: {}, missing: [], ...p, route: p.route ?? READ_ROUTES[p.intent] });
  if (!s) return out({ intent: "unknown", risk: "read", confidence: "low" });

  if (has(s, CONTROLLED)) return out({ intent: "controlled", risk: "controlled", confidence: "high" });

  const op = s.match(OPEN_PROJECT); if (op) { const q = cleanTitle(op[1] || op[2] || op[3] || ""); return out({ intent: "open_project", risk: "read", slots: { query: q }, missing: q ? [] : ["query"] }); }
  const se = s.match(SEARCH);
  if (se) {
    const what = se[1]; const q = cleanTitle(se[2]);
    const intent: Intent = /project|проект|про[еє]кт/.test(what) ? "search_project" : /document|doc|документ/.test(what) ? "search_document" : "search_person";
    return out({ intent, risk: "read", slots: { query: q }, missing: q ? [] : ["query"] });
  }

  if (REMIND.test(s)) {
    const body = text.replace(/^\s*(remind me|(create|add|set)( a)? reminder|создай напоминание|поставь напоминание|напомни( мне)?|нагадай( мені)?|створи нагадування)\s*/i, "");
    const d = parseDate(body, today);
    const title = cleanTitle((d ? dropDate(body, d.match) : body).trim().replace(/^(to|что|чтобы|про|о|щоб|що)\s+/i, ""));
    return out({ intent: "create_reminder", risk: "low", slots: { title, date: d?.date }, missing: [...(title ? [] : ["title" as const]), ...(d ? [] : ["date" as const])] });
  }
  if (NOTE.test(s)) {
    const title = cleanTitle(text.replace(/^\s*(note|write down|record|запиши себе|запиши|заметка|запам.ятай|нотатка)\s*:?\s*/i, ""));
    return out({ intent: "note", risk: "low", slots: { title }, missing: title ? [] : ["title"] });
  }
  if (CREATE_TASK.test(s)) {
    let body = text.replace(/^\s*(please\s+)?(create|add|new|make)\s+(a\s+)?task\s*/i, "").replace(/^\s*(создай|создать|добавь|поставь|новая)\s+задач[ау]\s*/i, "")
      .replace(/^\s*(створи|додай|постав|нове)\s+завдання\s*/i, "").replace(/^\s*задача\s*:?\s*/i, "");
    let person: string | undefined;
    const pe = text.match(PERSON_EN); if (pe && /^(create|add|new|make|please)/i.test(text.trim())) { person = pe[1]; body = body.replace(pe[0], " "); }
    const pr = (text.trim().charAt(0).toLowerCase() + text.trim().slice(1)).match(PERSON_RU); if (!person && pr) { person = pr[1]; body = body.replace(new RegExp(`^\\s*(для\\s+)?${escapeRe(pr[1])}\\s*`), ""); }
    const d = parseDate(body, today);
    if (d) body = dropDate(body, d.match);
    body = body.replace(/^\s*(to|чтобы|чтоб|щоб)\s+/i, "");
    const title = cleanTitle(body);
    return out({ intent: "create_task", risk: "material", slots: { title, person, date: d?.date }, missing: title ? [] : ["title"], confidence: title ? "high" : "low" });
  }
  if (ASSIGN.test(s)) {
    // assign <task> to <person> · назначь задачу <task> <person-dative> / на <person>
    const en = text.match(/^\s*(?:re)?assign\s+(?:the\s+)?(?:task\s+)?(.+?)\s+to\s+(.+?)\s*$/i);
    const lt = text.trim().charAt(0).toLowerCase() + text.trim().slice(1);
    const ru = lt.match(/^\s*(?:пере)?назначь\s+(?:задачу\s+)?(.+?)\s+(?:на\s+)?([А-ЯЁІЇЄҐ][\p{L}'-]+)\s*$/u) || lt.match(/^\s*(?:пере)?признач\s+(?:завдання\s+)?(.+?)\s+(?:на\s+)?([А-ЯЁІЇЄҐ][\p{L}'-]+)\s*$/u);
    const m = en || ru;
    const task = m ? cleanTitle(m[1]) : undefined, person = m ? cleanTitle(m[2]) : undefined;
    return out({ intent: "assign_task", risk: "material", slots: { task, person }, missing: [...(task ? [] : ["task" as const]), ...(person ? [] : ["person" as const])] });
  }
  if (DUE.test(s)) {
    const d = parseDate(text, today);
    let body = text.replace(/^\s*(please\s+)?(move|change|shift|push|postpone|reschedule)\s+(the\s+)?(deadline|due date|due)\s*(of|for|on)?\s*/i, "")
      .replace(/^\s*(перенеси|сдвинь|измени|поменяй)\s+(срок|дедлайн)\s*(задачи|по задаче|для)?\s*/i, "").replace(/^\s*(перенеси|зміни|посунь)\s+(термін|дедлайн)\s*(завдання)?\s*/i, "");
    if (d) body = dropDate(body, d.match, true);
    const task = cleanTitle(body.replace(/^(task|задачи|задача|завдання)\s+/i, "")) || undefined;
    return out({ intent: "change_due_date", risk: "material", slots: { task, date: d?.date }, missing: [...(task ? [] : ["task" as const]), ...(d ? [] : ["date" as const])] });
  }
  if (COMPLETE.test(s)) {
    const task = cleanTitle(text.replace(/^\s*(complete|finish|close|mark)\s+(the\s+)?(task\s+)?/i, "").replace(/(^|\s+)(as\s+)?(done|complete|completed)\s*$/i, "")
      .replace(/^\s*(закрой|заверши|отметь)\s+(задачу\s+)?/i, "").replace(/\s+(как\s+)?(выполненн?ую?|готов[ау]ю?)\s*$/i, "").replace(/^\s*(закрий|заверши|познач)\s+(завдання\s+)?/i, "")
      .replace(/^задача\s+/i, "").replace(/\s+(выполнена|готова)$/i, "")) || undefined;
    return out({ intent: "complete_task", risk: "material", slots: { task }, missing: task ? [] : ["task"] });
  }
  for (const [intent, words] of READS) if (has(s, words)) return out({ intent, risk: "read" });
  return out({ intent: "unknown", risk: "read", confidence: "low" });
}
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
/** The words of a date (and the preposition before it) taken out of a title; `rest` also drops what follows. */
function dropDate(text: string, match: string, rest = false) {
  const core = escapeRe(match.replace(/^(on|by|next|this|в|во|до|у|к|на)\s+/i, ""));
  const re = new RegExp(`(^|\\s)(?:(?:on|by|until|to|на|до|в|во|у|к)\\s+)?(?:next\\s+|this\\s+)?${core}(?=[\\s.,!?;:]|$)${rest ? ".*$" : ""}`, "i");
  return text.replace(re, " ");
}

/* ------------------------------ matching a spoken name to a person ------------------------------ */
const CYR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", ё: "e", є: "ye", ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
export const latin = (s: string) => s.toLowerCase().split("").map((ch) => CYR[ch] ?? ch).join("").replace(/[^a-z\s-]/g, "");
/** Stem of a name in any grammatical case ("Антону", "Антона" → "anton"). */
const stem = (s: string) => latin(s).trim().replace(/(om|oy|ey|ою|yu|u|a|e|i|y)$/u, "");
/** Does a spoken name ("Anton", "Антону", "Anton Petrov") name this person? Whole first name or surname, by stem, at least 3 letters. */
export function nameMatches(spoken: string, fullName: string): boolean {
  const sp = spoken.trim().split(/\s+/).map(stem).filter((x) => x.length >= 3);
  const fn = latin(fullName).split(/[\s-]+/).filter(Boolean);
  if (!sp.length || !fn.length) return false;
  return sp.every((w) => fn.some((p) => p === w || p.startsWith(w) && p.length - w.length <= 2 || stem(p) === w));
}

/** What the server will do, in words (also shown before confirmation). */
export function describe(p: Parsed, lang: "en" | "ru" | "uk" | "ar" = "en") {
  const ru = lang === "ru" || lang === "uk";
  const s = p.slots;
  switch (p.intent) {
    case "create_task": return ru ? `Создать задачу «${s.title || "…"}»${s.person ? ` для ${s.person}` : ""}${s.date ? `, срок ${s.date}` : ""}` : `Create task “${s.title || "…"}”${s.person ? ` for ${s.person}` : ""}${s.date ? `, due ${s.date}` : ""}`;
    case "create_reminder": return ru ? `Напоминание себе: «${s.title || "…"}»${s.date ? `, ${s.date}` : ""}` : `Reminder for me: “${s.title || "…"}”${s.date ? `, ${s.date}` : ""}`;
    case "assign_task": return ru ? `Назначить «${s.task || "…"}» — ${s.person || "…"}` : `Assign “${s.task || "…"}” to ${s.person || "…"}`;
    case "change_due_date": return ru ? `Перенести срок «${s.task || "…"}» на ${s.date || "…"}` : `Move the deadline of “${s.task || "…"}” to ${s.date || "…"}`;
    case "complete_task": return ru ? `Отметить выполненной: «${s.task || "…"}»` : `Mark done: “${s.task || "…"}”`;
    case "note": return ru ? `Заметка: «${s.title || "…"}»` : `Note: “${s.title || "…"}”`;
    case "controlled": return ru ? "Это действие идёт только через согласование или настройки доступа" : "This goes through the approval or access settings only";
    case "unknown": return ru ? "Не понятно, что сделать" : "Not clear what to do";
    default: return ru ? "Открыть" : "Open";
  }
}
