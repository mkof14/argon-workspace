// Project pack: one document with everything about a won deal — the proposal, contracts, compliance checks,
// the plan with dates, payments, acceptance and the list of attached files. Pure function → Markdown (PDF later).

export type PackLang = "en" | "ru" | "uk";
type R = { id: string; section: string; title: string; status: string | null; controlled?: boolean; data: Record<string, any> };

const W: Record<string, Record<PackLang, string>> = {
  title: { en: "Project pack", ru: "Пакет проекта", uk: "Пакет проєкту" },
  made: { en: "Prepared", ru: "Подготовлено", uk: "Підготовлено" },
  sum: { en: "Summary", ru: "Сводка", uk: "Зведення" },
  client: { en: "Client", ru: "Клиент", uk: "Клієнт" }, config: { en: "Configuration", ru: "Конфигурация", uk: "Конфігурація" },
  value: { en: "Contract value", ru: "Сумма контракта", uk: "Сума контракту" }, status: { en: "Status", ru: "Статус", uk: "Статус" },
  paid: { en: "Paid", ru: "Оплачено", uk: "Сплачено" }, open: { en: "Still to collect", ru: "Осталось получить", uk: "Залишилося отримати" },
  prop: { en: "Commercial proposal", ru: "Коммерческое предложение", uk: "Комерційна пропозиція" },
  contracts: { en: "Contracts", ru: "Договоры", uk: "Договори" },
  comp: { en: "Compliance", ru: "Комплаенс", uk: "Комплаєнс" },
  exp: { en: "Export / end-user check", ru: "Экспортная проверка", uk: "Експортна перевірка" },
  euc: { en: "End-user certificate", ru: "Сертификат конечного пользователя", uk: "Сертифікат кінцевого користувача" },
  plan: { en: "Plan and dates", ru: "План и сроки", uk: "План і строки" },
  pay: { en: "Payments", ru: "Платежи", uk: "Платежі" },
  acc: { en: "Acceptance", ru: "Приёмка", uk: "Приймання" },
  files: { en: "Attached files", ru: "Приложенные файлы", uk: "Прикладені файли" },
  photos: { en: "Photos", ru: "Фото", uk: "Фото" },
  date: { en: "Date", ru: "Дата", uk: "Дата" }, step: { en: "Step", ru: "Шаг", uk: "Крок" }, amount: { en: "Amount", ru: "Сумма", uk: "Сума" },
  party: { en: "Party", ru: "Сторона", uk: "Сторона" }, type: { en: "Type", ru: "Тип", uk: "Тип" }, record: { en: "Record", ru: "Запись", uk: "Запис" }, file: { en: "File", ru: "Файл", uk: "Файл" },
  none: { en: "None recorded.", ru: "Нет записей.", uk: "Немає записів." },
  us: { en: "Contains export-controlled records (US persons only). Do not share outside the cleared team.", ru: "Содержит записи под экспортным контролем (только для US persons). Не передавайте за пределы допущенной команды.", uk: "Містить записи під експортним контролем (лише для US persons). Не передавайте за межі допущеної команди.", },
  notes: { en: "Notes", ru: "Примечания", uk: "Примітки" },
};
const cell = (v: any) => String(v ?? "—").replace(/\|/g, "/").replace(/\n+/g, " ").slice(0, 160) || "—";
const money = (v: any, cur?: string) => Number(v) ? `${cur || "USD"} ${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—";
const sum = (v: number, cur: string) => `${cur} ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const dateOf = (r: R) => String(r.data?.due || r.data?.date || r.data?.eta || r.data?.signed || "").slice(0, 10);

/** The pack in Markdown. `files` maps a record id to the names of its attached files. */
export function projectPack(o: { deal: R; recs: R[]; files: Record<string, string[]>; lang: PackLang; today: string; photos?: number }) {
  const w = (k: string) => W[k][o.lang]; const d = o.deal.data || {}; const id = o.deal.id;
  const of = (sec: string, f = (r: R) => r.data?.deal_ref === id || r.data?.project === id) => o.recs.filter((r) => r.section === sec && f(r));
  const builds = of("operations.builds"); const bIds = new Set(builds.map((b) => b.id));
  const viaBuild = (sec: string) => o.recs.filter((r) => r.section === sec && (r.data?.project === id || bIds.has(r.data?.build_ref)));
  const proposals = of("sales.proposals").sort((a, b) => String(b.data?.number || "").localeCompare(String(a.data?.number || "")));
  const contracts = of("legal.contracts"); const screenings = of("security.screening");
  const invoices = of("finance.invoices").filter((r) => r.data?.direction !== "Payable").sort((a, b) => String(a.data?.due || "").localeCompare(String(b.data?.due || "")));
  const quality = viaBuild("operations.quality").filter((r) => ["fat", "sat"].includes(r.data?.project_step) || /acceptance/i.test(r.data?.check_type || ""));
  const steps = o.recs.filter((r) => r.data?.project === id).sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const all = [o.deal, ...proposals, ...contracts, ...screenings, ...builds, ...steps, ...invoices, ...quality, ...viaBuild("operations.logistics"), ...viaBuild("operations.installation")];
  const uniq = [...new Map(all.map((r) => [r.id, r])).values()];
  const cur = d.currency || "USD"; const value = Number(proposals[0]?.data?.value) || Number(d.value) || 0;
  const paid = invoices.filter((i) => i.status === "Paid").reduce((a, i) => a + (Number(i.data?.amount) || 0), 0);
  const table = (head: string[], rows: string[][]) => rows.length ? `| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n${rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n")}` : `*${w("none")}*`;
  const b0 = builds[0];
  const parts = [
    `**AGRON Inc.** · ${w("made")}: ${o.today}`,
    `# ${w("title")}: ${o.deal.title}`,
    uniq.some((r) => r.controlled) ? `**${w("us")}**` : "",
    `## ${w("sum")}`,
    table(["", ""], [[w("client"), d.client || o.deal.title], [w("config"), d.config || b0?.data?.config || "—"], [w("value"), money(value, cur)], [w("status"), o.deal.status || "—"], [w("paid"), sum(paid, cur)], [w("open"), sum(Math.max(0, value - paid), cur)]]),
    `## ${w("prop")}`,
    proposals.length ? table([w("record"), w("status"), w("value"), w("date")], proposals.map((p) => [`${p.data?.number || p.title}`, p.status || "", money(p.data?.value, p.data?.currency), String(p.data?.valid_until || "")])) : `*${w("none")}*`,
    proposals[0]?.data?.payment_terms ? `${proposals[0].data.payment_terms}` : "",
    `## ${w("contracts")}`,
    table([w("record"), w("type"), w("status"), w("party")], contracts.map((c) => [c.title, c.data?.type, c.status || "", c.data?.counterparty])),
    `## ${w("comp")}`,
    table([w("party"), w("type"), w("status"), w("date")], screenings.map((s) => [s.data?.party || s.title, s.data?.party_type, s.status || "", s.data?.date])),
    builds.length ? table([w("record"), w("exp"), w("euc")], builds.map((b) => [b.title, b.data?.export_check || "Not started", b.data?.euc || "Not requested"])) : "",
    `## ${w("plan")}`,
    table([w("date"), w("step"), w("status")], steps.filter((s) => s.section !== "finance.invoices").map((s) => [dateOf(s), s.title, s.status || ""])),
    `## ${w("pay")}`,
    table([w("date"), w("record"), w("amount"), w("status")], invoices.map((i) => [String(i.data?.due || "").slice(0, 10), i.title, money(i.data?.amount, i.data?.currency), i.status || ""])),
    `## ${w("acc")}`,
    table([w("record"), w("type"), w("status"), w("date")], quality.map((q) => [q.title, q.data?.check_type, q.status || "", q.data?.date])),
    ...quality.filter((q) => q.data?.notes).map((q) => `**${q.title}** — ${w("notes")}: ${String(q.data.notes).slice(0, 800)}`),
    `## ${w("files")}`,
    table([w("record"), w("file")], uniq.flatMap((r) => (o.files[r.id] || []).map((f) => [r.title, f]))),
    o.photos ? `## ${w("photos")}` : "",
  ];
  return { md: parts.filter(Boolean).join("\n\n"), records: uniq, controlled: uniq.some((r) => r.controlled), photoRecords: [...quality, ...viaBuild("operations.installation")].map((r) => r.id) };
}
