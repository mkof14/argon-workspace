// Commercial proposal (КП) from a deal: number, totals and the document in English, Russian or Ukrainian.
// Pure functions, used by the proposal builder in a deal and covered by tests.

export type PLang = "en" | "ru" | "uk";

/** Payment schedules offered in proposals. */
export const TERMS = ["30/40/30", "40/50/10", "50/50", "100"] as const;
const TERMS_TEXT: Record<string, Record<PLang, string>> = {
  "30/40/30": { en: "30% advance, 40% before shipping, 30% on acceptance", ru: "30% аванс, 40% до отгрузки, 30% после приёмки", uk: "30% аванс, 40% до відвантаження, 30% після приймання" },
  "40/50/10": { en: "40% advance, 50% before shipping, 10% on acceptance", ru: "40% аванс, 50% до отгрузки, 10% после приёмки", uk: "40% аванс, 50% до відвантаження, 10% після приймання" },
  "50/50": { en: "50% advance, 50% before shipping", ru: "50% аванс, 50% до отгрузки", uk: "50% аванс, 50% до відвантаження" },
  "100": { en: "100% before shipping", ru: "100% до отгрузки", uk: "100% до відвантаження" },
};
export const termsText = (k: string, l: PLang) => TERMS_TEXT[k]?.[l] || k;

/** Next number of the year: P-2026-001, -002 … (numbers of other years and other formats are ignored). */
export function nextNumber(used: string[], year: number) {
  const re = new RegExp(`^P-${year}-(\\d+)$`);
  const max = used.reduce((m, n) => { const x = re.exec(String(n || "")); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `P-${year}-${String(max + 1).padStart(3, "0")}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Price per unit after discount, total for the quantity, and the monthly lease for all units. */
export function totals(o: { qty: number; unit: number; discount: number; lease: { month: number; term: number } | null }) {
  const qty = Math.max(0, Math.floor(Number(o.qty) || 0)); const d = Math.min(100, Math.max(0, Number(o.discount) || 0));
  const net = r2((Number(o.unit) || 0) * (1 - d / 100));
  return { qty, net, total: r2(net * qty), lease: o.lease ? r2((Number(o.lease.month) || 0) * qty) : 0 };
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const money = (v: number, cur: string, l: PLang) => `${cur} ${v.toLocaleString(l === "en" ? "en-US" : l === "ru" ? "ru-RU" : "uk-UA", { maximumFractionDigits: 2 })}`.replace(/ | /g, " ");
const date = (iso: string, l: PLang) => { const [y, m, d] = iso.slice(0, 10).split("-"); return l === "en" ? `${new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}` : `${d}.${m}.${y}`; };

const W: Record<string, Record<PLang, string>> = {
  title: { en: "Commercial proposal", ru: "Коммерческое предложение", uk: "Комерційна пропозиція" },
  date: { en: "Date", ru: "Дата", uk: "Дата" }, to: { en: "To", ru: "Кому", uk: "Кому" }, attn: { en: "Attn", ru: "Вниманию", uk: "До уваги" }, site: { en: "Site", ru: "Объект", uk: "Об'єкт" },
  intro: { en: "Thank you for your interest in AGRON. We are pleased to propose the following solution.", ru: "Благодарим за интерес к AGRON. Предлагаем следующее решение.", uk: "Дякуємо за інтерес до AGRON. Пропонуємо таке рішення." },
  need: { en: "Your request", ru: "Ваш запрос", uk: "Ваш запит" },
  sol: { en: "Solution", ru: "Решение", uk: "Рішення" },
  solt: { en: "**StarDome {c}** — a self-contained security and monitoring unit: detection sensors, cameras, communications and the **AGRON 1** monitoring and operator-assistance software in one container, built to order and installed in days.", ru: "**StarDome {c}** — автономный модуль безопасности и мониторинга: датчики обнаружения, камеры, связь и ПО мониторинга и помощи оператору **AGRON 1** в одном контейнере; собирается под заказ и устанавливается за дни.", uk: "**StarDome {c}** — автономний модуль безпеки та моніторингу: датчики виявлення, камери, зв'язок і ПЗ моніторингу та допомоги оператору **AGRON 1** в одному контейнері; збирається під замовлення й встановлюється за дні." },
  price: { en: "Price", ru: "Стоимость", uk: "Вартість" },
  item: { en: "Item", ru: "Позиция", uk: "Позиція" }, qty: { en: "Qty", ru: "Кол-во", uk: "К-сть" }, unit: { en: "Unit price", ru: "Цена за ед.", uk: "Ціна за од." },
  disc: { en: "Discount", ru: "Скидка", uk: "Знижка" }, net: { en: "Net unit price", ru: "Цена со скидкой", uk: "Ціна зі знижкою" }, tot: { en: "Total", ru: "Итого", uk: "Разом" },
  lease: { en: "Lease option", ru: "Вариант лизинга", uk: "Варіант лізингу" }, leaset: { en: "{m} per month for {t} months", ru: "{m} в месяц на {t} мес.", uk: "{m} на місяць на {t} міс." },
  terms: { en: "Terms", ru: "Условия", uk: "Умови" }, pay: { en: "Payment", ru: "Оплата", uk: "Оплата" }, del: { en: "Delivery", ru: "Поставка", uk: "Постачання" },
  weeks: { en: "{n} weeks after order and approvals", ru: "{n} недель после заказа и разрешений", uk: "{n} тижнів після замовлення та дозволів" },
  war: { en: "Warranty", ru: "Гарантия", uk: "Гарантія" }, valid: { en: "Valid until", ru: "Действует до", uk: "Діє до" },
  legal: { en: "Prices exclude taxes, duties and site works unless stated. Delivery is subject to export control and import approvals, site permits and the completion of end-user and sanctions screening.", ru: "Цены не включают налоги, пошлины и работы на объекте, если не указано иное. Поставка возможна при соблюдении требований экспортного контроля и импортных разрешений, наличии разрешений на объект и после проверки конечного пользователя и санкционной проверки.", uk: "Ціни не включають податки, мита й роботи на об'єкті, якщо не зазначено інше. Постачання можливе за дотримання вимог експортного контролю та імпортних дозволів, наявності дозволів на об'єкт і після перевірки кінцевого користувача та санкційної перевірки." },
  next: { en: "Next steps", ru: "Следующие шаги", uk: "Наступні кроки" },
  steps: { en: "1. A short call to confirm requirements.\n2. Site survey and final configuration.\n3. Contract, end-user certificate and order.", ru: "1. Короткий звонок для уточнения требований.\n2. Осмотр объекта и финальная конфигурация.\n3. Договор, сертификат конечного пользователя и заказ.", uk: "1. Короткий дзвінок для уточнення вимог.\n2. Огляд об'єкта та фінальна конфігурація.\n3. Договір, сертифікат кінцевого користувача та замовлення." },
  regards: { en: "Best regards", ru: "С уважением", uk: "З повагою" },
};

export type ProposalInput = {
  number: string; date: string; client: string; contact?: string; site?: string; country?: string;
  config: string; qty: number; unit: number; discount: number; currency: string; lease: { month: number; term: number } | null;
  terms: string; delivery_weeks: number; valid_days: number; warranty?: string; need?: string; notes?: string;
  sender: { name: string; title?: string; email?: string };
};

/** The proposal document (Markdown, turned into PDF) and its key numbers. */
export function proposalMarkdown(p: ProposalInput, l: PLang) {
  const w = (k: string) => W[k][l]; const t = totals({ qty: p.qty, unit: p.unit, discount: p.discount, lease: p.lease });
  const valid_until = addDays(p.date, Math.max(1, Number(p.valid_days) || 30));
  const head = [`${w("date")}: ${date(p.date, l)}`, `${w("to")}: **${p.client}**`, p.contact ? `${w("attn")}: ${p.contact}` : "", p.site ? `${w("site")}: ${p.site}${p.country ? `, ${p.country}` : ""}` : ""].filter(Boolean).join("  \n");
  const md = [
    `**AGRON Inc.** · info@agron1.com · agron1.com`,
    `# ${w("title")} ${p.number}`,
    head, w("intro"),
    p.need ? `## ${w("need")}\n\n${p.need}` : "",
    `## ${w("sol")}`, w("solt").replace("{c}", p.config), p.notes || "",
    `## ${w("price")}`,
    `| ${w("item")} | ${w("qty")} | ${w("unit")} | ${w("disc")} | ${w("net")} | ${w("tot")} |\n|---|---|---|---|---|---|\n| StarDome ${p.config} | ${t.qty} | ${money(Number(p.unit) || 0, p.currency, l)} | ${p.discount ? `${p.discount}%` : "—"} | ${money(t.net, p.currency, l)} | **${money(t.total, p.currency, l)}** |`,
    p.lease ? `**${w("lease")}:** ${w("leaset").replace("{m}", money(t.lease, p.currency, l)).replace("{t}", String(p.lease.term))}` : "",
    `## ${w("terms")}`,
    `| | |\n|---|---|\n| **${w("pay")}** | ${termsText(p.terms, l)} |\n| **${w("del")}** | ${w("weeks").replace("{n}", String(p.delivery_weeks))} |${p.warranty ? `\n| **${w("war")}** | ${p.warranty} |` : ""}\n| **${w("valid")}** | ${date(valid_until, l)} |`,
    w("legal"),
    `## ${w("next")}`, w("steps"),
    `${w("regards")},\n\n**${p.sender.name}**${p.sender.title ? `  \n${p.sender.title}` : ""}  \nAGRON Inc.${p.sender.email ? `  \n${p.sender.email}` : ""}`,
  ].filter(Boolean).join("\n\n");
  return { md, total: t.total, lease: t.lease, valid_until };
}
