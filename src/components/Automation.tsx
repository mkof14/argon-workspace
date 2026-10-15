"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO } from "@/lib/sb";
import { allSections, ROLES } from "@/config/workspace.config.mjs";
import { REFS } from "@/config/links";
import { AGENTS, DEFAULT_RULES, DEFAULT_SETTINGS, describe, type Action, type AgentId, type Cond, type Mode, type Rule, type Settings } from "@/lib/automation";

type T4 = { en: string; ru: string; uk: string; ar: string };
export const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const SECS: any[] = allSections() as any[];
const INTERNAL_ROLES = Object.entries(ROLES as any).filter(([, r]: any) => r.internal).map(([k]) => k);

export type AutoState = {
  settings: Settings; rules: Rule[]; queue: any[]; log: any[]; agents: any; quality: any; brief: any; owner: boolean;
  usage: { month: string; requests: number; tin: number; tout: number; usd: number; budget: number; by: { id: string; tin: number; tout: number; n: number; usd: number }[]; models: Record<string, number> };
  integrations: { key: string; on: boolean; what: string; need: boolean }[];
};
const demoState = (): AutoState => ({ settings: DEFAULT_SETTINGS, rules: DEFAULT_RULES, queue: [], log: [], agents: null, quality: null, brief: null, owner: true,
  usage: { month: new Date().toISOString().slice(0, 7), requests: 0, tin: 0, tout: 0, usd: 0, budget: 50, by: [], models: {} },
  integrations: ["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "SMTP_PASS", "ANTHROPIC_API_KEY", "BACKUP_PASSPHRASE", "CSL_API_KEY", "YOUTUBE_API_KEY", "GITHUB_TOKEN"].map((key, i) => ({ key, on: i < 4, what: "", need: i < 4 })) });

/** Loads the automation state once and gives a helper to call the API. */
export function useAuto() {
  const { toast } = useApp();
  const [s, setS] = useState<AutoState | null>(null);
  const call = async (action: string, body: any = {}) => {
    if (DEMO) { toast("Demo mode: changes are not saved", true); return null; }
    const r = await fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
    if (!r.ok) { toast(await r.text(), true); return null; }
    return r.json();
  };
  const load = async () => { if (DEMO) { setS(demoState()); return; } const j = await call("state"); if (j) setS(j); };
  useEffect(() => { load(); }, []); // eslint-disable-line
  return { s, setS, load, call };
}

export const AGENT_INFO: Record<AgentId, { icon: string; name: T4; what: T4 }> = {
  rules: { icon: "git", name: L("Rules", "Правила", "Правила", "القواعد"), what: L("Runs your “when → then” rules: on save, and every morning for dates.", "Выполняет правила «если → то»: при сохранении записи и каждое утро — по датам.", "Виконує правила «якщо → то»: під час збереження і щоранку — за датами.", "ينفذ قواعد «إذا ← فإن»: عند الحفظ وكل صباح حسب التواريخ.") },
  deadlines: { icon: "clock", name: L("Deadlines", "Сроки", "Терміни", "المواعيد"), what: L("Escalates overdue items to leaders and finds work with nobody responsible.", "Передаёт руководству просрочки и находит дела без ответственного.", "Передає керівництву прострочення та знаходить справи без відповідального.", "يصعّد المتأخرات للقيادة ويكشف الأعمال بلا مسؤول.") },
  compliance: { icon: "shield", name: L("Compliance", "Комплаенс", "Комплаєнс", "الامتثال"), what: L("Every deal from Proposal, every vendor and partner gets a sanctions screening; checks the US list automatically when the key is set.", "Каждой сделке с этапа Proposal, поставщику и партнёру — санкционная проверка; с ключом проверяет по списку США сам.", "Кожній угоді з етапу Proposal, постачальнику й партнеру — санкційна перевірка; з ключем перевіряє за списком США сам.", "فحص عقوبات لكل صفقة من مرحلة العرض ولكل مورد وشريك؛ ويفحص القائمة الأمريكية تلقائياً عند توفر المفتاح.") },
  quality: { icon: "check", name: L("Data quality", "Качество данных", "Якість даних", "جودة البيانات"), what: L("Finds gaps that cause mistakes: no owner, no date, broken links, duplicates, forgotten records. Fixes link names itself.", "Находит пробелы, из-за которых бывают ошибки: нет ответственного, даты, битые связи, дубли, забытые записи. Названия связей чинит сам.", "Знаходить прогалини, через які бувають помилки: немає відповідального, дати, биті зв'язки, дублі, забуті записи. Назви зв'язків виправляє сам.", "يكشف الثغرات المسببة للأخطاء: بلا مسؤول، بلا تاريخ، روابط معطلة، تكرار، سجلات منسية. ويصلح أسماء الروابط بنفسه.") },
  finance: { icon: "coins", name: L("Finance agent", "Агент финансов", "Агент фінансів", "وكيل المالية"), what: L("Marks overdue invoices, prepares payment reminders to clients, watches expenses, budgets, tax dates, insurance renewals and cash runway.", "Отмечает просроченные счета, готовит клиентам напоминания об оплате, следит за расходами, бюджетами, налоговыми сроками, продлением страховок и запасом денег.", "Позначає прострочені рахунки, готує клієнтам нагадування про оплату, стежить за витратами, бюджетами, податковими строками, продовженням страховок і запасом грошей.", "يعلّم الفواتير المتأخرة ويجهّز تذكيرات الدفع للعملاء ويراقب المصروفات والميزانيات ومواعيد الضرائب وتجديد التأمين والسيولة.") },
  sales: { icon: "handshake", name: L("Sales agent", "Агент продаж", "Агент продажів", "وكيل المبيعات"), what: L("Turns qualified leads into deals, creates follow-up tasks for stalled deals and next steps, moves deals when a proposal is accepted, watches proposal validity, tenders and new leads.", "Превращает квалифицированные лиды в сделки, ставит задачи по стоящим сделкам и следующим шагам, двигает сделку при принятом КП, следит за сроком КП, тендерами и новыми лидами.", "Перетворює кваліфіковані ліди на угоди, ставить задачі щодо угод без руху й наступних кроків, рухає угоду при прийнятій КП, стежить за строком КП, тендерами й новими лідами.", "يحوّل العملاء المؤهلين إلى صفقات، وينشئ مهام متابعة للصفقات المتوقفة والخطوات التالية، وينقل الصفقة عند قبول العرض، ويراقب صلاحية العروض والمناقصات والعملاء الجدد.") },
  operations: { icon: "factory", name: L("Operations agent", "Агент операций", "Агент операцій", "وكيل العمليات"), what: L("Stops shipping without export clearance, plans installation after delivery, marks builds installed and adds units to the fleet, opens service tickets, chases late shipments, purchases, tickets and quality issues.", "Не даёт отгрузить без экспортного разрешения, планирует монтаж после доставки, отмечает сборку установленной и добавляет систему в парк, открывает сервисные заявки, следит за опозданиями грузов, закупок, заявок и проблемами качества.", "Не дає відвантажити без експортного дозволу, планує монтаж після доставки, позначає збирання встановленим і додає систему до парку, відкриває сервісні заявки, стежить за запізненнями вантажів, закупівель, заявок і проблемами якості.", "يمنع الشحن دون تصريح تصدير، ويخطط للتركيب بعد التسليم، ويعلّم التجميع مركّباً ويضيف الوحدة للأسطول، ويفتح تذاكر الصيانة، ويتابع تأخر الشحنات والمشتريات والتذاكر ومشكلات الجودة.") },
  hr: { icon: "users", name: L("HR agent", "Агент HR", "Агент HR", "وكيل الموارد البشرية"), what: L("Prepares onboarding and offboarding checklists, access removal for leavers and probation reviews; watches work authorizations, I-9 and IP agreements, NDA and export briefing, trainings, leave requests, candidates and reviews.", "Готовит чек-листы онбординга и увольнения, отзыв доступов у ушедших и ревью испытательного срока; следит за разрешениями на работу, I-9 и соглашениями об ИС, NDA и экспортным инструктажем, обучением, отпусками, кандидатами и ревью.", "Готує чек-листи онбордингу й звільнення, відкликання доступів у тих, хто пішов, і рев'ю випробувального строку; стежить за дозволами на роботу, I-9 та угодами про ІВ, NDA й експортним інструктажем, навчанням, відпустками, кандидатами й рев'ю.", "يجهّز قوائم التأهيل وإنهاء الخدمة وإلغاء صلاحيات المغادرين ومراجعات فترة التجربة؛ ويراقب تصاريح العمل ونموذج I-9 واتفاقيات الملكية الفكرية واتفاقية السرية وإحاطة التصدير والتدريب والإجازات والمرشحين والتقييمات.") },
  legal: { icon: "scale", name: L("Legal agent", "Агент юристов", "Агент юристів", "الوكيل القانوني"), what: L("Warns 60, 30 and 7 days before licences, permits, powers of attorney, filings, trademarks, obligations and reviews; creates the next recurring obligation; chases requests, issues, minutes and contracts behind won deals.", "Предупреждает за 60, 30 и 7 дней о лицензиях, разрешениях, доверенностях, подачах, товарных знаках, обязательствах и пересмотрах; создаёт следующее повторяющееся обязательство; следит за запросами, проблемами, протоколами и договорами по выигранным сделкам.", "Попереджає за 60, 30 і 7 днів про ліцензії, дозволи, довіреності, подання, торговельні марки, зобов'язання й перегляди; створює наступне повторюване зобов'язання; стежить за запитами, проблемами, протоколами й договорами за виграними угодами.", "ينبّه قبل 60 و30 و7 أيام إلى التراخيص والتصاريح والوكالات والإيداعات والعلامات التجارية والالتزامات والمراجعات؛ وينشئ الالتزام الدوري التالي؛ ويتابع الطلبات والقضايا والمحاضر وعقود الصفقات الرابحة.") },
  marketing: { icon: "megaphone", name: L("Marketing agent", "Агент маркетинга", "Агент маркетингу", "وكيل التسويق"), what: L("Holds back anything without the release check, watches the publishing calendar, article deadlines, interview briefings, events, campaigns and budgets, two-step verification on accounts and agency NDAs.", "Не пропускает материалы без проверки к публикации, следит за календарём публикаций, сроками статей, подготовкой к интервью, событиями, кампаниями и бюджетом, двухэтапной защитой аккаунтов и NDA с агентствами.", "Не пропускає матеріали без перевірки до публікації, стежить за календарем публікацій, строками статей, підготовкою до інтерв'ю, подіями, кампаніями й бюджетом, двоетапним захистом акаунтів і NDA з агенціями.", "يمنع أي مادة دون فحص النشر، ويراقب تقويم النشر ومواعيد المقالات وتحضير المقابلات والفعاليات والحملات والميزانية والتحقق بخطوتين للحسابات واتفاقيات السرية مع الوكالات.") },
  brief: { icon: "trend", name: L("Monday brief", "Сводка по понедельникам", "Зведення щопонеділка", "ملخص الاثنين"), what: L("Every Monday: pipeline, money, overdue items, risks and AI conclusions — one email to the CEO.", "Каждый понедельник: воронка, деньги, просрочки, риски и выводы ИИ — одно письмо CEO.", "Щопонеділка: воронка, гроші, прострочення, ризики й висновки ШІ — один лист CEO.", "كل اثنين: المبيعات والمال والمتأخرات والمخاطر واستنتاجات الذكاء الاصطناعي — رسالة واحدة للرئيس التنفيذي.") },
};
const MODES: { k: Mode; t: T4 }[] = [
  { k: "off", t: L("Off", "Выкл.", "Вимк.", "متوقف") },
  { k: "suggest", t: L("Suggest", "Предлагает", "Пропонує", "يقترح") },
  { k: "auto", t: L("Auto", "Сам", "Сам", "تلقائي") },
];
const KIND: Record<string, string> = { run: "c-info", action: "c-ok", queued: "c-warn", error: "c-bad", decision: "" };

/** Administration → System → Automation: agents, the approval queue, rules and the agent log. */
export default function Automation({ a }: { a: ReturnType<typeof useAuto> }) {
  const { lang, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const { s, setS, load, call } = a;
  const [busy, setBusy] = useState("");
  const [hist, setHist] = useState(false);
  const [edit, setEdit] = useState<Rule | null>(null);
  const [agentF, setAgentF] = useState("");
  if (!s) return <div className="card"><div className="empty">…</div></div>;
  const secLabel = (id: string) => tx(SECS.find((x) => x.id === id)?.label, lang as Lang) || id;

  const setMode = async (ag: AgentId, m: Mode) => {
    const settings = { ...s.settings, agents: { ...s.settings.agents, [ag]: m } };
    setS({ ...s, settings }); const j = await call("settings", { settings }); if (j) toast(T(L("Saved", "Сохранено", "Збережено", "تم الحفظ")));
  };
  const run = async (ag?: AgentId) => {
    setBusy(ag || "all"); const j = await call("run", { agent: ag }); setBusy("");
    if (j) { toast(Object.entries(j).filter(([k]) => k !== "emails").map(([k, v]) => `${k}: ${v}`).join(" · ") || "OK"); load(); }
  };
  const decideOne = async (id: string, approve: boolean) => { setBusy(id); const j = await call("decide", { id, approve }); setBusy(""); if (j) { toast(j.status === "failed" ? j.result : T(approve ? L("Done", "Сделано", "Зроблено", "تم") : L("Rejected", "Отклонено", "Відхилено", "مرفوض")), j.status === "failed"); load(); } };
  const approveAll = async () => { setBusy("all-q"); for (const q of pending) await call("decide", { id: q.id, approve: true }); setBusy(""); load(); };
  const saveRules = async (rules: Rule[]) => { setS({ ...s, rules }); const j = await call("rules", { rules }); if (j) toast(T(L("Rules saved", "Правила сохранены", "Правила збережено", "تم حفظ القواعد"))); };

  const pending = s.queue.filter((q) => q.status === "pending");
  const done = s.queue.filter((q) => q.status !== "pending");
  const last = s.agents?.result || {};
  const log = s.log.filter((l: any) => !agentF || l.agent === agentF);

  return (<div style={{ display: "grid", gap: 16 }}>
    <section className="card">
      <div className="card-h toolbar"><h2><Icon n="cpu" />{T(L("Agents", "Агенты", "Агенти", "الوكلاء"))}</h2>
        <span className="faint" style={{ fontSize: 13 }}>{s.agents?.at ? `${T(L("Last run", "Последний запуск", "Останній запуск", "آخر تشغيل"))}: ${s.agents.at.slice(0, 16).replace("T", " ")} UTC` : T(L("Runs every working day at 10:00 UTC", "Работают каждый рабочий день в 10:00 UTC", "Працюють щороботи дня о 10:00 UTC", "تعمل كل يوم عمل الساعة 10:00 UTC"))}</span>
        <button className="btn primary sm" style={{ marginInlineStart: "auto" }} disabled={!!busy} onClick={() => run()}><Icon n="play" />{busy === "all" ? "…" : T(L("Run all now", "Запустить всех", "Запустити всіх", "تشغيل الكل الآن"))}</button></div>
      <p className="faint" style={{ margin: "0 20px 12px", fontSize: 13.5 }}>{T(L("Suggest — the agent prepares changes and waits for your one-click approval below. Auto — it acts itself and logs everything. Team notifications go out in both modes; emails to outside addresses always wait for approval.", "«Предлагает» — агент готовит изменения и ждёт вашего одобрения ниже одним кликом. «Сам» — действует сам и всё записывает в журнал. Уведомления команде уходят в обоих режимах; письма на внешние адреса всегда ждут одобрения.", "«Пропонує» — агент готує зміни й чекає вашого схвалення нижче одним кліком. «Сам» — діє сам і все записує в журнал. Сповіщення команді йдуть в обох режимах; листи на зовнішні адреси завжди чекають схвалення.", "«يقترح» — يجهّز الوكيل التغييرات وينتظر موافقتك بنقرة واحدة أدناه. «تلقائي» — يعمل بنفسه ويسجل كل شيء. إشعارات الفريق تُرسل في الحالتين؛ والرسائل للعناوين الخارجية تنتظر الموافقة دائماً."))}</p>
      <div className="card-b auto-grid">{AGENTS.map((ag) => { const i = AGENT_INFO[ag]; const m = s.settings.agents[ag]; return (
        <div key={ag} className={`auto-card ${m}`}>
          <div className="toolbar" style={{ gap: 8 }}><span className="auto-ic"><Icon n={i.icon} /></span><b>{T(i.name)}</b>
            <span className={`chip ${m === "auto" ? "c-ok" : m === "suggest" ? "c-warn" : ""}`} style={{ marginInlineStart: "auto" }}>{T(MODES.find((x) => x.k === m)!.t)}</span></div>
          <p>{T(i.what)}</p>
          {last[ag] && <div className="faint mono" style={{ fontSize: 12.5 }}>{last[ag]}</div>}
          <div className="toolbar" style={{ gap: 8 }}>
            <div className="seg" role="group">{MODES.map((x) => <button key={x.k} className={m === x.k ? "on" : ""} disabled={!s.owner} onClick={() => setMode(ag, x.k)}>{T(x.t)}</button>)}</div>
            <button className="btn ghost sm" disabled={!!busy || m === "off"} onClick={() => run(ag)}><Icon n="play" />{busy === ag ? "…" : T(L("Run", "Запустить", "Запустити", "تشغيل"))}</button></div>
        </div>); })}</div>
    </section>

    <section className="card" id="queue">
      <div className="card-h toolbar"><h2><Icon n="check" />{T(L("Waiting for approval", "Ждут одобрения", "Чекають схвалення", "بانتظار الموافقة"))}</h2>
        <span className={`chip ${pending.length ? "c-warn" : "c-ok"}`}>{pending.length}</span>
        <label className="check" style={{ marginInlineStart: "auto", fontSize: 14 }}><input type="checkbox" checked={hist} onChange={(e) => setHist(e.target.checked)} />{T(L("History", "История", "Історія", "السجل"))}</label>
        {pending.length > 1 && <button className="btn sm" disabled={!!busy} onClick={approveAll}><Icon n="check" />{T(L("Approve all", "Одобрить все", "Схвалити все", "الموافقة على الكل"))}</button>}</div>
      {(hist ? [...pending, ...done] : pending).length ? <div className="feed">{(hist ? [...pending, ...done] : pending).slice(0, 80).map((q: any) => (
        <div key={q.id} className="feed-row auto-q">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="toolbar" style={{ gap: 8 }}><span className="chip">{T(AGENT_INFO[q.agent as AgentId]?.name || L(q.agent, q.agent, q.agent, q.agent))}</span><b style={{ overflowWrap: "anywhere" }}>{q.title}</b></div>
            <div className="faint" style={{ fontSize: 13 }}>{q.detail} · {q.at.slice(0, 16).replace("T", " ")}{q.section && q.record_id ? <> · <a href={`/${q.section.replace(".", "/")}?r=${q.record_id}`}>{secLabel(q.section)}</a></> : null}</div>
            {q.status !== "pending" && <div className="faint" style={{ fontSize: 12.5 }}>{q.status} · {q.decided_by} · {q.result || ""}</div>}
          </div>
          {q.status === "pending" ? <div className="toolbar" style={{ gap: 6 }}>
            <button className="btn primary sm" disabled={!!busy} onClick={() => decideOne(q.id, true)}><Icon n="check" />{busy === q.id ? "…" : T(L("Approve", "Одобрить", "Схвалити", "موافقة"))}</button>
            <button className="btn ghost sm" disabled={!!busy} onClick={() => decideOne(q.id, false)}><Icon n="x" />{T(L("Reject", "Отклонить", "Відхилити", "رفض"))}</button></div>
            : <span className={`chip ${q.status === "approved" ? "c-ok" : q.status === "failed" ? "c-bad" : ""}`}>{q.status}</span>}
        </div>))}</div> : <div className="empty">{T(L("Nothing waiting. Agents in “Suggest” mode put their proposals here.", "Ничего не ждёт. Агенты в режиме «Предлагает» кладут сюда свои предложения.", "Нічого не чекає. Агенти в режимі «Пропонує» кладуть сюди свої пропозиції.", "لا شيء بالانتظار. يضع الوكلاء في وضع «يقترح» اقتراحاتهم هنا."))}</div>}
    </section>

    <section className="card">
      <div className="card-h toolbar"><h2><Icon n="git" />{T(L("Rules “when → then”", "Правила «если → то»", "Правила «якщо → то»", "قواعد «إذا ← فإن»"))}</h2>
        <span className="chip">{s.rules.filter((r) => r.enabled).length}/{s.rules.length}</span>
        <button className="btn sm" style={{ marginInlineStart: "auto" }} onClick={() => setEdit({ id: crypto.randomUUID(), name: "", enabled: true, mode: "suggest", on: "status", section: "sales.pipeline", actions: [{ type: "notify", to: "owner", message: "“{title}” is now {status}." }] })}><Icon n="plus" />{T(L("New rule", "Новое правило", "Нове правило", "قاعدة جديدة"))}</button>
        <button className="btn ghost sm" onClick={async () => { if (!confirm(T(L("Replace all rules with the ready-made set?", "Заменить все правила готовым набором?", "Замінити всі правила готовим набором?", "استبدال كل القواعد بالمجموعة الجاهزة؟")))) return; const j = await call("reset_rules"); if (j) setS({ ...s, rules: j.rules }); }}><Icon n="refresh" />{T(L("Ready-made set", "Готовый набор", "Готовий набір", "مجموعة جاهزة"))}</button></div>
      <div className="feed">{s.rules.map((r, i) => (
        <div key={r.id} className="feed-row auto-rule" style={{ opacity: r.enabled ? 1 : 0.55 }}>
          <label className="check" title={T(L("On / off", "Вкл. / выкл.", "Увім. / вимк.", "تشغيل / إيقاف"))}><input type="checkbox" checked={r.enabled} onChange={(e) => saveRules(s.rules.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} /></label>
          <div style={{ minWidth: 0, flex: 1 }}><b>{r.name}</b><div className="faint" style={{ fontSize: 13 }}>{describe(r, secLabel)}</div></div>
          <div className="seg" role="group">{(["suggest", "auto"] as const).map((k) => <button key={k} className={r.mode === k ? "on" : ""} onClick={() => saveRules(s.rules.map((x, j) => (j === i ? { ...x, mode: k } : x)))}>{T(MODES.find((x) => x.k === k)!.t)}</button>)}</div>
          <button className="iconbtn" aria-label="edit" onClick={() => setEdit(JSON.parse(JSON.stringify(r)))}><Icon n="edit" /></button>
        </div>))}</div>
      {s.settings.agents.rules !== "auto" && <p className="faint" style={{ margin: "10px 20px 16px", fontSize: 13 }}>{T(L("The Rules agent is in “Suggest” mode, so every rule waits for approval. Switch the agent to “Auto” to let rules marked “Auto” act on their own.", "Агент «Правила» в режиме «Предлагает», поэтому любое правило ждёт одобрения. Переключите агента в «Сам», чтобы правила с отметкой «Сам» действовали без вас.", "Агент «Правила» в режимі «Пропонує», тому кожне правило чекає схвалення. Перемкніть агента в «Сам», щоб правила з позначкою «Сам» діяли без вас.", "وكيل «القواعد» في وضع «يقترح»، لذا تنتظر كل قاعدة الموافقة. حوّله إلى «تلقائي» لتعمل القواعد المعلّمة «تلقائي» بنفسها."))}</p>}
    </section>

    <section className="card">
      <div className="card-h toolbar"><h2><Icon n="clipboard" />{T(L("Agent log", "Журнал агентов", "Журнал агентів", "سجل الوكلاء"))}</h2>
        <select className="input" style={{ width: "auto", marginInlineStart: "auto", padding: "6px 10px" }} value={agentF} onChange={(e) => setAgentF(e.target.value)}>
          <option value="">{T(L("All agents", "Все агенты", "Усі агенти", "كل الوكلاء"))}</option>{AGENTS.map((g) => <option key={g} value={g}>{T(AGENT_INFO[g].name)}</option>)}</select></div>
      {log.length ? <div className="feed">{log.slice(0, 80).map((l: any, i: number) => (
        <div key={i} className="feed-row"><span className={`chip ${KIND[l.kind] || ""}`}>{l.kind}</span><span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{l.section && l.record ? <a href={`/${l.section.replace(".", "/")}?r=${l.record}`}>{l.text}</a> : l.text}</span><small className="faint mono">{l.agent} · {l.at.slice(5, 16).replace("T", " ")}</small></div>))}</div>
        : <div className="empty">{T(L("No entries yet.", "Записей пока нет.", "Записів поки немає.", "لا توجد إدخالات بعد."))}</div>}
    </section>

    {edit && <RuleEditor rule={edit} onClose={() => setEdit(null)} onSave={(r) => { const has = s.rules.some((x) => x.id === r.id); saveRules(has ? s.rules.map((x) => (x.id === r.id ? r : x)) : [...s.rules, r]); setEdit(null); }}
      onDelete={() => { saveRules(s.rules.filter((x) => x.id !== edit.id)); setEdit(null); }} />}
  </div>);
}

/* ---------------- Rule editor ---------------- */
function RuleEditor({ rule, onClose, onSave, onDelete }: { rule: Rule; onClose: () => void; onSave: (r: Rule) => void; onDelete: () => void }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [r, setR] = useState<Rule>(rule);
  const sec = SECS.find((x) => x.id === r.section);
  const fields: any[] = sec?.fields || [];
  const secOpts = useMemo(() => SECS.filter((x) => !/\.(metrics|outbox|templates)$/.test(x.id)).map((x) => ({ id: x.id, t: `${x.id.split(".")[0]} · ${tx(x.label, lang as Lang)}` })), [lang]);
  const up = (p: Partial<Rule>) => setR({ ...r, ...p });
  const upA = (i: number, p: Partial<Action>) => up({ actions: r.actions.map((x, j) => (j === i ? ({ ...x, ...p } as Action) : x)) });
  const upC = (i: number, p: Partial<Cond>) => up({ when: (r.when || []).map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const SecSel = ({ v, on }: { v: string; on: (v: string) => void }) => <select className="input" value={v} onChange={(e) => on(e.target.value)}>{secOpts.map((o) => <option key={o.id} value={o.id}>{o.t}</option>)}</select>;
  const fieldOpts = (fs: any[]) => [{ key: "status", t: "status" }, { key: "title", t: "title" }, ...fs.map((f) => ({ key: f.key, t: `${f.key} — ${tx(f.label, lang as Lang)}` }))];
  const ok = r.name.trim() && r.actions.length && (r.on !== "date" || r.date_key);
  return (<>
    <div className="scrim" style={{ zIndex: 64 }} onClick={onClose} />
    <aside className="drawer" role="dialog" aria-modal="true" style={{ zIndex: 65 }}>
      <div className="drawer-h"><div style={{ flex: 1 }}><div className="eyebrow">{T(L("Rule", "Правило", "Правило", "قاعدة"))}</div><h2 style={{ fontSize: 18 }}>{r.name || T(L("New rule", "Новое правило", "Нове правило", "قاعدة جديدة"))}</h2></div>
        <button className="iconbtn" onClick={onClose} aria-label="close"><Icon n="x" /></button></div>
      <div className="drawer-b" style={{ display: "grid", gap: 14 }}>
        <div className="field"><label>{T(L("Name", "Название", "Назва", "الاسم"))}</label><input className="input" value={r.name} onChange={(e) => up({ name: e.target.value })} /></div>
        <div className="fgrid">
          <div className="field"><label>{T(L("When", "Когда", "Коли", "متى"))}</label>
            <select className="input" value={r.on} onChange={(e) => up({ on: e.target.value as Rule["on"] })}>
              <option value="status">{T(L("Status changes to…", "Статус меняется на…", "Статус змінюється на…", "تتغير الحالة إلى…"))}</option>
              <option value="created">{T(L("A record is added", "Добавлена запись", "Додано запис", "أضيف سجل"))}</option>
              <option value="date">{T(L("A date comes", "Наступает дата", "Настає дата", "يحين تاريخ"))}</option></select></div>
          <div className="field"><label>{T(L("Section", "Раздел", "Розділ", "القسم"))}</label>{SecSel({ v: r.section, on: (v) => up({ section: v, status: undefined, date_key: undefined, when: [] }) })}</div>
          {r.on === "status" && <div className="field"><label>{T(L("Status", "Статус", "Статус", "الحالة"))}</label>
            <select className="input" value={r.status || ""} onChange={(e) => up({ status: e.target.value || undefined })}><option value="">{T(L("Any", "Любой", "Будь-який", "أي"))}</option>{(sec?.statuses || []).map((x: string) => <option key={x}>{x}</option>)}</select></div>}
          {r.on === "date" && <>
            <div className="field"><label>{T(L("Date field", "Поле даты", "Поле дати", "حقل التاريخ"))}</label>
              <select className="input" value={r.date_key || ""} onChange={(e) => up({ date_key: e.target.value })}><option value="">—</option>{fields.filter((f) => f.type === "date").map((f) => <option key={f.key} value={f.key}>{tx(f.label, lang as Lang)}</option>)}</select></div>
            <div className="field"><label>{T(L("Days (−3 = three days before, 1 = day after)", "Дней (−3 = за три дня, 1 = на следующий день)", "Днів (−3 = за три дні, 1 = наступного дня)", "أيام (−3 = قبل ثلاثة أيام، 1 = بعد يوم)"))}</label>
              <input className="input" type="number" value={r.offset ?? 0} onChange={(e) => up({ offset: Number(e.target.value) })} /></div></>}
        </div>

        <div className="field"><label>{T(L("Only if", "Только если", "Тільки якщо", "فقط إذا"))}</label>
          {(r.when || []).map((c, i) => <div key={i} className="toolbar" style={{ gap: 6 }}>
            <select className="input" style={{ flex: 2 }} value={c.field} onChange={(e) => upC(i, { field: e.target.value })}>{fieldOpts(fields).map((o) => <option key={o.key} value={o.key}>{o.t}</option>)}</select>
            <select className="input" style={{ flex: 1 }} value={c.op} onChange={(e) => upC(i, { op: e.target.value as Cond["op"] })}>
              {[["eq", "="], ["neq", "≠"], ["in", "∈ (a, b)"], ["nin", "∉ (a, b)"], ["empty", "∅"], ["filled", "✓"], ["gt", ">"], ["lt", "<"]].map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
            {!["empty", "filled"].includes(c.op) && <input className="input" style={{ flex: 2 }} value={c.value || ""} onChange={(e) => upC(i, { value: e.target.value })} />}
            <button className="iconbtn" onClick={() => up({ when: (r.when || []).filter((_, j) => j !== i) })} aria-label="remove"><Icon n="x" /></button></div>)}
          <button className="linkbtn" style={{ justifySelf: "start" }} onClick={() => up({ when: [...(r.when || []), { field: "status", op: "eq", value: "" }] })}>+ {T(L("condition", "условие", "умова", "شرط"))}</button></div>

        <div className="field"><label>{T(L("Then", "Тогда", "Тоді", "عندها"))}</label>
          <div className="hint">{T(L("Text can use {title}, {status}, {today} and any field name in braces, e.g. {client}.", "В тексте можно писать {title}, {status}, {today} и любое поле в фигурных скобках, например {client}.", "У тексті можна писати {title}, {status}, {today} і будь-яке поле у фігурних дужках, напр. {client}.", "يمكن استخدام {title} و{status} و{today} وأي حقل بين أقواس، مثل {client}."))}</div>
          {r.actions.map((a, i) => <div key={i} className="auto-act">
            <div className="toolbar" style={{ gap: 6 }}>
              <select className="input" style={{ width: "auto" }} value={a.type} onChange={(e) => { const t = e.target.value; upA(i, t === "notify" ? { type: "notify", to: "owner", message: "" } as any : t === "create" ? { type: "create", section: "company.tasks", title: "{title}", status: "Open", fields: {} } as any : t === "set" ? { type: "set", field: "status", value: "" } as any : { type: "email", to_field: "", subject: "", body: "" } as any); }}>
                <option value="notify">{T(L("Notify people", "Уведомить людей", "Сповістити людей", "إشعار الأشخاص"))}</option>
                <option value="create">{T(L("Create a record", "Создать запись", "Створити запис", "إنشاء سجل"))}</option>
                <option value="set">{T(L("Change a field", "Изменить поле", "Змінити поле", "تغيير حقل"))}</option>
                <option value="email">{T(L("Email outside (after approval)", "Письмо наружу (после одобрения)", "Лист назовні (після схвалення)", "بريد خارجي (بعد الموافقة)"))}</option></select>
              <button className="iconbtn" style={{ marginInlineStart: "auto" }} onClick={() => up({ actions: r.actions.filter((_, j) => j !== i) })} aria-label="remove"><Icon n="x" /></button></div>
            {a.type === "notify" && <div className="fgrid">
              <select className="input" value={a.to} onChange={(e) => upA(i, { to: e.target.value } as any)}>
                <option value="owner">{T(L("Person responsible in the record", "Ответственный в записи", "Відповідальний у записі", "المسؤول في السجل"))}</option>
                <option value="leads">{T(L("Leaders (Settings)", "Руководство (из Настроек)", "Керівництво (з Налаштувань)", "القيادة (الإعدادات)"))}</option>
                {INTERNAL_ROLES.map((x) => <option key={x} value={`role:${x}`}>{T(L("Role", "Роль", "Роль", "دور"))}: {tx((ROLES as any)[x].label, lang as Lang) || x}</option>)}</select>
              <input className="input" placeholder="“{title}” …" value={a.message} onChange={(e) => upA(i, { message: e.target.value } as any)} /></div>}
            {a.type === "create" && (() => { const ts = SECS.find((x) => x.id === a.section); const links = Object.entries(REFS[a.section] || {}).filter(([, to]) => to === r.section).map(([k]) => k); return <div style={{ display: "grid", gap: 8 }}>
              <div className="fgrid">{SecSel({ v: a.section, on: (v) => upA(i, { section: v, status: SECS.find((x) => x.id === v)?.statuses?.[0], link: undefined, fields: {} } as any) })}
                <select className="input" value={a.status || ""} onChange={(e) => upA(i, { status: e.target.value } as any)}>{(ts?.statuses || []).map((x: string) => <option key={x}>{x}</option>)}</select>
                <input className="input wide" placeholder={T(L("Title, e.g. Invoice — {title}", "Название, напр. Invoice — {title}", "Назва, напр. Invoice — {title}", "العنوان، مثل Invoice — {title}"))} value={a.title} onChange={(e) => upA(i, { title: e.target.value } as any)} />
                {links.length > 0 && <label className="check wide"><input type="checkbox" checked={!!a.link} onChange={(e) => upA(i, { link: e.target.checked ? links[0] : undefined } as any)} />{T(L("Link the new record to this one (no duplicates)", "Связать новую запись с этой (без дублей)", "Зв'язати новий запис з цим (без дублів)", "اربط السجل الجديد بهذا (بلا تكرار)"))}</label>}</div>
              {Object.entries(a.fields || {}).map(([k, v]) => <div key={k} className="toolbar" style={{ gap: 6 }}><span className="chip mono">{k}</span><input className="input" style={{ flex: 1 }} value={v} onChange={(e) => upA(i, { fields: { ...a.fields, [k]: e.target.value } } as any)} /><button className="iconbtn" onClick={() => { const f = { ...a.fields }; delete f[k]; upA(i, { fields: f } as any); }} aria-label="remove"><Icon n="x" /></button></div>)}
              <select className="input" value="" onChange={(e) => e.target.value && upA(i, { fields: { ...a.fields, [e.target.value]: "" } } as any)}><option value="">+ {T(L("fill a field of the new record", "заполнить поле новой записи", "заповнити поле нового запису", "تعبئة حقل في السجل الجديد"))}</option>{(ts?.fields || []).filter((f: any) => f.type !== "ref" && !(a.fields || {})[f.key]).map((f: any) => <option key={f.key} value={f.key}>{tx(f.label, lang as Lang)}</option>)}</select></div>; })()}
            {a.type === "set" && <div className="fgrid">
              <select className="input" value={a.field} onChange={(e) => upA(i, { field: e.target.value } as any)}>{fieldOpts(fields).filter((o) => o.key !== "title").map((o) => <option key={o.key} value={o.key}>{o.t}</option>)}</select>
              {a.field === "status" ? <select className="input" value={a.value} onChange={(e) => upA(i, { value: e.target.value } as any)}><option value="">—</option>{(sec?.statuses || []).map((x: string) => <option key={x}>{x}</option>)}</select>
                : <input className="input" value={a.value} onChange={(e) => upA(i, { value: e.target.value } as any)} />}</div>}
            {a.type === "email" && <div style={{ display: "grid", gap: 8 }}>
              <select className="input" value={a.to_field} onChange={(e) => upA(i, { to_field: e.target.value } as any)}><option value="">{T(L("Field with the email address", "Поле с адресом", "Поле з адресою", "حقل البريد"))}</option>{fields.filter((f) => ["text", "long"].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{tx(f.label, lang as Lang)}</option>)}</select>
              <input className="input" placeholder={T(L("Subject", "Тема", "Тема", "الموضوع"))} value={a.subject} onChange={(e) => upA(i, { subject: e.target.value } as any)} />
              <textarea className="input" rows={4} placeholder={T(L("Text", "Текст", "Текст", "النص"))} value={a.body} onChange={(e) => upA(i, { body: e.target.value } as any)} /></div>}
          </div>)}
          <button className="linkbtn" style={{ justifySelf: "start" }} onClick={() => up({ actions: [...r.actions, { type: "notify", to: "owner", message: "" }] })}>+ {T(L("action", "действие", "дія", "إجراء"))}</button></div>

        <div className="toolbar" style={{ gap: 12 }}>
          <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => up({ enabled: e.target.checked })} />{T(L("On", "Включено", "Увімкнено", "مفعّل"))}</label>
          <div className="seg" role="group">{(["suggest", "auto"] as const).map((k) => <button key={k} className={r.mode === k ? "on" : ""} onClick={() => up({ mode: k })}>{T(MODES.find((x) => x.k === k)!.t)}</button>)}</div></div>
      </div>
      <div className="drawer-f toolbar">
        <button className="btn primary" disabled={!ok} onClick={() => onSave({ ...r, name: r.name.trim() })}><Icon n="check" />{T(L("Save", "Сохранить", "Зберегти", "حفظ"))}</button>
        <button className="btn ghost" onClick={onClose}>{T(L("Cancel", "Отмена", "Скасувати", "إلغاء"))}</button>
        <button className="btn ghost" style={{ marginInlineStart: "auto", color: "var(--bad)" }} onClick={() => confirm(T(L("Delete this rule?", "Удалить правило?", "Видалити правило?", "حذف هذه القاعدة؟"))) && onDelete()}><Icon n="x" />{T(L("Delete", "Удалить", "Видалити", "حذف"))}</button>
      </div>
    </aside></>);
}
