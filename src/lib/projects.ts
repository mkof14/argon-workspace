// Project templates: a won deal becomes a full plan — build, purchases, export check, shipping, installation,
// acceptance, training and the first service visit — with dates and responsible roles.

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
  { key: "longlead", section: "operations.procurement", title: L("Long-lead items for StarDome {config} ({client})", "Позиции с долгой поставкой для StarDome {config} ({client})", "Позиції з довгим постачанням для StarDome {config} ({client})", "مكونات طويلة التوريد لـ StarDome {config} ({client})"), status: "Draft", day: 14, role: "operations", dateKey: "eta", fields: { item: "Radar, cameras, communications", build: "{client}" } },
  { key: "fat", section: "operations.quality", title: L("Factory acceptance test: {client}", "Заводские приёмочные испытания: {client}", "Заводські приймальні випробування: {client}", "اختبار القبول في المصنع: {client}"), status: "Planned", day: ship - 7, role: "engineering", dateKey: "date", fields: { check_type: "Factory acceptance (FAT)", build: "{client}" } },
  { key: "ship", section: "operations.logistics", title: L("Shipping to {client}", "Отгрузка для {client}", "Відвантаження для {client}", "الشحن إلى {client}"), status: "Planned", day: ship, role: "operations", dateKey: "due", link: "build", fields: { from: assembly === "UAE" ? "AGRON workshop, UAE" : "AGRON workshop, USA", to: "{site}" } },
  { key: "install", section: "operations.installation", title: L("Installation at {site}", "Установка на объекте {site}", "Встановлення на об'єкті {site}", "التركيب في {site}"), status: "Planned", day: ship + k, role: "operations", dateKey: "due", link: "build", fields: { site: "{site}" } },
  { key: "sat", section: "operations.quality", title: L("Site acceptance and handover: {client}", "Приёмка на объекте и передача: {client}", "Приймання на об'єкті та передача: {client}", "القبول في الموقع والتسليم: {client}"), status: "Planned", day: ship + k + 5, role: "engineering", dateKey: "date", fields: { check_type: "Site acceptance (SAT)", build: "{client}" } },
  { key: "training", section: "company.tasks", title: L("Operator training for {client}", "Обучение операторов клиента {client}", "Навчання операторів клієнта {client}", "تدريب مشغلي {client}"), status: "Open", day: ship + k + 7, role: "operations", dateKey: "due", link: "deal", fields: { priority: "Medium" } },
  { key: "final", section: "finance.invoices", title: L("Final payment on acceptance — {client}", "Финальный платёж после приёмки — {client}", "Фінальний платіж після приймання — {client}", "الدفعة النهائية عند القبول — {client}"), status: "Draft", day: ship + k + 10, role: "finance", dateKey: "due", link: "deal", fields: { direction: "Receivable", counterparty: "{client}", currency: "{currency}" } },
  { key: "service", section: "company.tasks", title: L("First service visit: {client}", "Первый сервисный визит: {client}", "Перший сервісний візит: {client}", "أول زيارة صيانة: {client}"), status: "Open", day: ship + k + 90, role: "operations", dateKey: "due", link: "deal", fields: { priority: "Medium" } },
];

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: "stardome-us", name: L("StarDome — assembly in the USA", "StarDome — сборка в США", "StarDome — збирання в США", "StarDome — التجميع في الولايات المتحدة"),
    about: L("About 16 weeks to shipping, sea freight, 2 weeks on site.", "Около 16 недель до отгрузки, морем, 2 недели на объекте.", "Близько 16 тижнів до відвантаження, морем, 2 тижні на об'єкті.", "نحو 16 أسبوعاً حتى الشحن، بحراً، وأسبوعان في الموقع."), steps: base("United States", 112, 35) },
  { id: "stardome-uae", name: L("StarDome — assembly in the UAE", "StarDome — сборка в ОАЭ", "StarDome — збирання в ОАЕ", "StarDome — التجميع في الإمارات"),
    about: L("About 12 weeks to shipping, local delivery, 1 week on site.", "Около 12 недель до отгрузки, местная доставка, 1 неделя на объекте.", "Близько 12 тижнів до відвантаження, місцева доставка, 1 тиждень на об'єкті.", "نحو 12 أسبوعاً حتى الشحن، توصيل محلي، وأسبوع في الموقع."), steps: base("UAE", 84, 10) },
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
