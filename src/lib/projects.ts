// Project templates: a won deal becomes a full plan — build, purchases, export check, shipping, installation,
// acceptance, training and the first service visit — with dates and responsible roles.
// Payments are added by lib/milestones from the payment terms (advance, before shipping, on acceptance).

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Rec = { id: string; title: string; status?: string | null; data: Record<string, any> };

export type Step = { key: string; section: string; title: T4; status: string; day: number; role: string; dateKey?: string;
  link?: "deal" | "build"; fields?: Record<string, any> };
export type ProjectTemplate = { id: string; name: T4; about: T4; steps: Step[] };

const base = (assembly: "United States" | "UAE", ship: number, k: number): Step[] => [
  { key: "kickoff", section: "company.tasks", title: L("Kick-off with the client: {client}", "Стартовая встреча с клиентом: {client}", "Стартова зустріч із клієнтом: {client}", "اجتماع الانطلاق مع العميل: {client}"), status: "Open", day: 3, role: "sales", dateKey: "due", link: "deal", fields: { priority: "High" } },
  { key: "screen", section: "security.screening", title: L("End-user and sanctions screening: {client}", "Проверка конечного пользователя и санкций: {client}", "Перевірка кінцевого користувача й санкцій: {client}", "فحص المستخدم النهائي والعقوبات: {client}"), status: "Pending", day: 5, role: "security", dateKey: "date", link: "deal", fields: { party: "{client}", party_type: "Client", country: "{country}" } },
  { key: "build", section: "operations.builds", title: L("StarDome {config} for {client}", "StarDome {config} для {client}", "StarDome {config} для {client}", "StarDome {config} لـ {client}"), status: "Design", day: Math.round(ship * 0.85), role: "operations", dateKey: "due", link: "deal", fields: { client: "{client}", config: "{config}", assembly, export_check: "Not started" } },
  { key: "longlead", section: "operations.procurement", title: L("Long-lead items for StarDome {config} ({client})", "Позиции с долгой поставкой для StarDome {config} ({client})", "Позиції з довгим постачанням для StarDome {config} ({client})", "مكونات طويلة التوريد لـ StarDome {config} ({client})"), status: "Draft", day: 14, role: "operations", dateKey: "eta", link: "build", fields: { item: "Radar, cameras, communications", build: "{client}" } },
  { key: "fat", section: "operations.quality", title: L("Factory acceptance test: {client}", "Заводские приёмочные испытания: {client}", "Заводські приймальні випробування: {client}", "اختبار القبول في المصنع: {client}"), status: "Planned", day: ship - 7, role: "engineering", dateKey: "date", fields: { check_type: "Factory acceptance (FAT)", build: "{client}" } },
  { key: "ship", section: "operations.logistics", title: L("Shipping to {client}", "Отгрузка для {client}", "Відвантаження для {client}", "الشحن إلى {client}"), status: "Planned", day: ship, role: "operations", dateKey: "due", link: "build", fields: { from: assembly === "UAE" ? "AGRON workshop, UAE" : "AGRON workshop, USA", to: "{site}" } },
  { key: "install", section: "operations.installation", title: L("Installation at {site}", "Установка на объекте {site}", "Встановлення на об'єкті {site}", "التركيب في {site}"), status: "Planned", day: ship + k, role: "operations", dateKey: "due", link: "build", fields: { site: "{site}" } },
  { key: "sat", section: "operations.quality", title: L("Site acceptance and handover: {client}", "Приёмка на объекте и передача: {client}", "Приймання на об'єкті та передача: {client}", "القبول في الموقع والتسليم: {client}"), status: "Planned", day: ship + k + 5, role: "engineering", dateKey: "date", fields: { check_type: "Site acceptance (SAT)", build: "{client}" } },
  { key: "training", section: "company.tasks", title: L("Operator training for {client}", "Обучение операторов клиента {client}", "Навчання операторів клієнта {client}", "تدريب مشغلي {client}"), status: "Open", day: ship + k + 7, role: "operations", dateKey: "due", link: "deal", fields: { priority: "Medium" } },
  { key: "service", section: "company.tasks", title: L("First service visit: {client}", "Первый сервисный визит: {client}", "Перший сервісний візит: {client}", "أول زيارة صيانة: {client}"), status: "Open", day: ship + k + 90, role: "operations", dateKey: "due", link: "deal", fields: { priority: "Medium" } },
];

/** Mobile StarDome on a Sprinter van: no container freight; the van is driven or trucked to the client and handed over. */
const sprinter = (): Step[] => base("United States", 70, 3).map((s) => s.key === "ship" ? { ...s, title: L("Delivery of the van to {client}", "Доставка вэна для {client}", "Доставка вена для {client}", "تسليم الشاحنة إلى {client}"), fields: { ...s.fields, from: "AGRON workshop, USA" } }
  : s.key === "install" ? { ...s, title: L("Handover and on-site deployment at {site}", "Передача и развёртывание на объекте {site}", "Передача й розгортання на об'єкті {site}", "التسليم والنشر في {site}") } : s);

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: "stardome-us", name: L("StarDome — assembly in the USA", "StarDome — сборка в США", "StarDome — збирання в США", "StarDome — التجميع في الولايات المتحدة"),
    about: L("About 16 weeks to shipping, sea freight, 2 weeks on site.", "Около 16 недель до отгрузки, морем, 2 недели на объекте.", "Близько 16 тижнів до відвантаження, морем, 2 тижні на об'єкті.", "نحو 16 أسبوعاً حتى الشحن، بحراً، وأسبوعان في الموقع."), steps: base("United States", 112, 35) },
  { id: "stardome-uae", name: L("StarDome — assembly in the UAE", "StarDome — сборка в ОАЭ", "StarDome — збирання в ОАЕ", "StarDome — التجميع في الإمارات"),
    about: L("About 12 weeks to shipping, local delivery, 1 week on site.", "Около 12 недель до отгрузки, местная доставка, 1 неделя на объекте.", "Близько 12 тижнів до відвантаження, місцева доставка, 1 тиждень на об'єкті.", "نحو 12 أسبوعاً حتى الشحن، توصيل محلي، وأسبوع في الموقع."), steps: base("UAE", 84, 10) },,
  { id: "stardome-sprinter", name: L("StarDome Sprinter — mobile, on a van", "StarDome Sprinter — мобильный, на вэне", "StarDome Sprinter — мобільний, на вені", "StarDome Sprinter — متنقل على شاحنة"),
    about: L("About 10 weeks to delivery, the van is driven or trucked to the client, 3 days of handover on site.", "Около 10 недель до доставки, вэн перегоняют или везут автовозом, 3 дня передачи на объекте.", "Близько 10 тижнів до доставки, вен переганяють або везуть автовозом, 3 дні передачі на об'єкті.", "نحو 10 أسابيع حتى التسليم، تُقاد الشاحنة أو تُنقل إلى العميل، و3 أيام تسليم في الموقع."), steps: sprinter() }
];

const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] || "—");

export type PlannedRecord = { key: string; section: string; title: string; status: string; due: string; role: string; link?: "deal" | "build"; data: Record<string, any> };

/** The records a template creates for a deal, starting on a date; owners are filled per role from the team list. */
export function projectPlan(deal: Rec, tpl: ProjectTemplate, start: string, lang: keyof T4, owners: Record<string, string> = {}): PlannedRecord[] {
  const d = deal.data || {};
  const v: Record<string, string> = { client: d.client || deal.title, config: d.config || "", country: d.country || "", site: d.site || d.client || deal.title, currency: d.currency || "USD" };
  return tpl.steps.map((s) => {
    const due = addDays(start, s.day); const data: Record<string, any> = { project: deal.id, project_step: s.key };
    for (const [k, x] of Object.entries(s.fields || {})) data[k] = typeof x === "string" ? fill(x, v) : x;
    if (s.dateKey) data[s.dateKey] = due;
    const who = owners[s.role]; if (who) data[s.section === "company.tasks" ? "assignee" : "owner"] = who;
    if (s.link === "deal") data[s.section === "company.tasks" ? "related" : "deal_ref"] = s.section === "company.tasks" ? `/sales/pipeline?r=${deal.id}` : deal.id;
    return { key: s.key, section: s.section, title: fill(s.title[lang] || s.title.en, v), status: s.status, due, role: s.role, link: s.link, data };
  });
}

/** The date field of a project record (the one its template step sets). */
export function stepDateKey(r: { section: string; data: Record<string, any> }) {
  for (const t of PROJECT_TEMPLATES) { const s = t.steps.find((x) => x.key === r.data?.project_step && x.section === r.section); if (s?.dateKey) return s.dateKey; }
  return ["due", "date", "eta"].find((k) => typeof r.data?.[k] === "string") || "due";
}
export const stepDate = (r: { section: string; data: Record<string, any> }) => String(r.data?.[stepDateKey(r)] || "").slice(0, 10);
const DONE = /^(done|closed|completed|installed|commissioned|delivered|received|paid|cleared|passed)$/i;
export const stepDone = (status: string | null | undefined) => DONE.test(status || "");

/** Moving one step: it and every later step that is not finished move by the same number of days. */
export function shiftPlan<R extends { id: string; section: string; status?: string | null; data: Record<string, any> }>(recs: R[], id: string, newDate: string) {
  const r = recs.find((x) => x.id === id); if (!r) return [];
  const from = stepDate(r); if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return [];
  const delta = Math.round((Date.parse(newDate) - Date.parse(from)) / 864e5); if (!delta) return [];
  return recs.filter((x) => x.id === id || (!stepDone(x.status) && stepDate(x) > from))
    .map((x) => { const k = stepDateKey(x); const d = stepDate(x); return { id: x.id, key: k, from: d, to: new Date(Date.parse(d) + delta * 864e5).toISOString().slice(0, 10) }; })
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.from));
}
