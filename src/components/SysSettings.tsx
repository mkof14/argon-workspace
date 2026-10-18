"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { ROLES } from "@/config/workspace.config.mjs";
import { L, type useAuto } from "./Automation";
import type { Settings } from "@/lib/automation";

type T4 = { en: string; ru: string; uk: string; ar: string };
const INTERNAL_ROLES = Object.entries(ROLES as any).filter(([, r]: any) => r.internal).map(([k]) => k);
const DAYS = [L("Sun", "Вс", "Нд", "أحد"), L("Mon", "Пн", "Пн", "اثنين"), L("Tue", "Вт", "Вт", "ثلاثاء"), L("Wed", "Ср", "Ср", "أربعاء"), L("Thu", "Чт", "Чт", "خميس"), L("Fri", "Пт", "Пт", "جمعة"), L("Sat", "Сб", "Сб", "سبت")];
const KEY_INFO: Record<string, T4> = {
  SUPABASE_SERVICE_ROLE_KEY: L("Agents, backups, digests", "Агенты, бэкапы, рассылки", "Агенти, бекапи, розсилки", "الوكلاء والنسخ الاحتياطي والملخصات"),
  CRON_SECRET: L("Daily schedule: agents 10:00 UTC, digest 11:00 UTC", "Расписание: агенты в 10:00 UTC, утренняя сводка в 11:00 UTC", "Розклад: агенти о 10:00 UTC, ранкове зведення об 11:00 UTC", "الجدول: الوكلاء 10:00 UTC والملخص 11:00 UTC"),
  SMTP_PASS: L("Emails from info@agron1.com", "Письма с info@agron1.com", "Листи з info@agron1.com", "الرسائل من info@agron1.com"),
  ANTHROPIC_API_KEY: L("AI answers, texts, summaries, brief conclusions", "Ответы ИИ, тексты, выводы, сводка", "Відповіді ШІ, тексти, висновки, зведення", "إجابات الذكاء الاصطناعي والنصوص والملخصات"),
  BACKUP_PASSPHRASE: L("Encrypted weekly backup by email", "Зашифрованный бэкап по почте каждую неделю", "Зашифрований бекап поштою щотижня", "نسخة احتياطية مشفرة أسبوعياً بالبريد"),
  CSL_API_KEY: L("Automatic sanctions screening (Compliance agent)", "Автоматическая санкционная проверка (агент Комплаенс)", "Автоматична санкційна перевірка (агент Комплаєнс)", "فحص العقوبات التلقائي (وكيل الامتثال)"),
  YOUTUBE_API_KEY: L("YouTube statistics in Marketing", "Статистика YouTube в Маркетинге", "Статистика YouTube у Маркетингу", "إحصاءات يوتيوب في التسويق"),
  GOOGLE_CLIENT_ID: L("Google Calendar two-way sync (with GOOGLE_CLIENT_SECRET)", "Двусторонняя синхронизация с Google Calendar (вместе с GOOGLE_CLIENT_SECRET)", "Двостороння синхронізація з Google Calendar (разом із GOOGLE_CLIENT_SECRET)", "مزامنة ثنائية مع تقويم Google (مع GOOGLE_CLIENT_SECRET)"),
  GITHUB_TOKEN: L("Private repository facts in Technical", "Данные приватных репозиториев в Технике", "Дані приватних репозиторіїв у Техніці", "بيانات المستودعات الخاصة في التقني"),
};

type Cx = { ro: boolean; set: (p: string, v: any) => void; T: (x: T4) => string; lang: string };
function Num({ p, v, t, hint, ro, set, T }: Cx & { p: string; v: number; t: T4; hint?: T4 }) {
  return <div className="field"><label>{T(t)}</label><input className="input" type="number" min={0} disabled={ro} value={v} onChange={(e) => set(p, Number(e.target.value))} />{hint && <span className="hint">{T(hint)}</span>}</div>;
}
function Roles({ p, v, t, ro, set, T, lang }: Cx & { p: string; v: string[]; t: T4 }) {
  return <div className="field"><label>{T(t)}</label><div className="toolbar" style={{ gap: 10 }}>{INTERNAL_ROLES.map((r) => <label key={r} className="check" style={{ fontSize: 13.5 }}><input type="checkbox" disabled={ro} checked={v.includes(r)} onChange={(e) => set(p, e.target.checked ? [...v, r] : v.filter((x) => x !== r))} />{tx((ROLES as any)[r].label, lang as Lang)}</label>)}</div></div>;
}

/** Administration → System → Settings: company calendar, thresholds, who gets which email, AI budget; keys and AI usage. */
export default function SysSettings({ a }: { a: ReturnType<typeof useAuto> }) {
  const { lang, toast, people } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const { s, setS, call } = a;
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => { if (s) setF(s.settings); }, [s]);
  if (!s || !f) return <div className="card"><div className="empty">…</div></div>;
  const ro = !s.owner;
  const set = (path: string, v: any) => { const n: any = JSON.parse(JSON.stringify(f)); const ks = path.split("."); let o = n; for (const k of ks.slice(0, -1)) o = o[k]; o[ks.at(-1)!] = v; setF(n); };
  const save = async () => { const j = await call("settings", { settings: f }); if (j) { setS({ ...s, settings: j.settings }); toast(T(L("Settings saved", "Настройки сохранены", "Налаштування збережено", "تم حفظ الإعدادات"))); } };
  const cx = { ro, set, T, lang };
  const u = s.usage; const pct = u.budget ? Math.min(100, (u.usd / u.budget) * 100) : 0;
  const who = (id: string) => id === "automation" ? T(L("Automation", "Автоматизация", "Автоматизація", "الأتمتة")) : (people.find((p) => p.id === id)?.full_name || people.find((p) => p.id === id)?.email || id.slice(0, 8));

  return (<div style={{ display: "grid", gap: 16 }}>
    <section className="card">
      <div className="card-h toolbar"><h2><Icon n="gear" />{T(L("Company settings", "Настройки компании", "Налаштування компанії", "إعدادات الشركة"))}</h2>
        {ro ? <span className="chip" style={{ marginInlineStart: "auto" }}>{T(L("Only the owner can change", "Менять может только владелец", "Змінювати може лише власник", "يمكن للمالك فقط التغيير"))}</span>
          : <button className="btn primary sm" style={{ marginInlineStart: "auto" }} onClick={save}><Icon n="check" />{T(L("Save", "Сохранить", "Зберегти", "حفظ"))}</button>}</div>
      <div className="card-b" style={{ display: "grid", gap: 18 }}>
        <div className="fgrid">
          <div className="field"><label>{T(L("Company name", "Название компании", "Назва компанії", "اسم الشركة"))}</label><input className="input" disabled={ro} value={f.company.name} onChange={(e) => set("company.name", e.target.value)} /></div>
          <div className="field"><label>{T(L("Time zone", "Часовой пояс", "Часовий пояс", "المنطقة الزمنية"))}</label>
            <select className="input" disabled={ro} value={f.company.timezone} onChange={(e) => set("company.timezone", e.target.value)}>{["America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Asia/Dubai", "Europe/Kyiv", "UTC"].map((z) => <option key={z}>{z}</option>)}</select></div>
          <div className="field"><label>{T(L("Main currency", "Основная валюта", "Основна валюта", "العملة الرئيسية"))}</label>
            <select className="input" disabled={ro} value={f.company.currency} onChange={(e) => set("company.currency", e.target.value)}>{["USD", "AED", "EUR", "GBP"].map((z) => <option key={z}>{z}</option>)}</select></div>
          <div className="field"><label>{T(L("Working days", "Рабочие дни", "Робочі дні", "أيام العمل"))}</label>
            <div className="toolbar" style={{ gap: 8 }}>{DAYS.map((d, i) => <label key={i} className="check" style={{ fontSize: 13.5 }}><input type="checkbox" disabled={ro} checked={f.company.workdays.includes(i)} onChange={(e) => set("company.workdays", e.target.checked ? [...f.company.workdays, i].sort() : f.company.workdays.filter((x) => x !== i))} />{T(d)}</label>)}</div>
            <span className="hint">{T(L("Agents rest on other days and on holidays.", "В другие дни и праздники агенты отдыхают.", "В інші дні та свята агенти відпочивають.", "يستريح الوكلاء في الأيام الأخرى والعطل."))}</span></div>
          <div className="field wide"><label>{T(L("Company holidays (one date per line, YYYY-MM-DD)", "Праздники компании (дата на строку, ГГГГ-ММ-ДД)", "Свята компанії (дата на рядок, РРРР-ММ-ДД)", "عطل الشركة (تاريخ في كل سطر)"))}</label>
            <textarea className="input mono" rows={3} disabled={ro} value={f.company.holidays.join("\n")} onChange={(e) => set("company.holidays", e.target.value.split(/\s+/).filter(Boolean))} /></div>
        </div>
        <div><div className="eyebrow" style={{ marginBottom: 8 }}>{T(L("Thresholds", "Пороги", "Пороги", "الحدود"))}</div>
          <div className="fgrid">
            <Num {...cx} p="thresholds.escalate_after" v={f.thresholds.escalate_after} t={L("Escalate overdue items after, days", "Передавать просрочку руководству через, дней", "Передавати прострочення керівництву через, днів", "تصعيد المتأخرات بعد (أيام)")} />
            <Num {...cx} p="thresholds.stalled_deal" v={f.thresholds.stalled_deal} t={L("Deal without movement, days", "Сделка без движения, дней", "Угода без руху, днів", "صفقة متوقفة (أيام)")} />
            <Num {...cx} p="thresholds.screening_wait" v={f.thresholds.screening_wait} t={L("Screening may wait, days", "Проверка может ждать, дней", "Перевірка може чекати, днів", "يمكن أن ينتظر الفحص (أيام)")} />
            <Num {...cx} p="thresholds.stale_record" v={f.thresholds.stale_record} t={L("Open record is forgotten after, days", "Открытая запись «забыта» через, дней", "Відкритий запис «забутий» через, днів", "السجل المفتوح منسي بعد (أيام)")} />
          </div></div>
        <div style={{ display: "grid", gap: 12 }}><div className="eyebrow">{T(L("Who gets which email", "Кто какие письма получает", "Хто які листи отримує", "من يتلقى أي بريد"))}</div>
          <label className="check"><input type="checkbox" disabled={ro} checked={f.notify.digest} onChange={(e) => set("notify.digest", e.target.checked)} />{T(L("Morning digest to every employee (11:00 UTC)", "Утренняя сводка каждому сотруднику (11:00 UTC)", "Ранкове зведення кожному співробітнику (11:00 UTC)", "الملخص الصباحي لكل موظف (11:00 UTC)"))}</label>
          <Roles {...cx} p="notify.escalate_roles" v={f.notify.escalate_roles} t={L("Leaders: escalations and urgent alerts", "Руководство: эскалации и срочные сигналы", "Керівництво: ескалації й термінові сигнали", "القيادة: التصعيد والتنبيهات العاجلة")} />
          <Roles {...cx} p="notify.monitor_roles" v={f.notify.monitor_roles} t={L("Monitoring alerts", "Сигналы мониторинга", "Сигнали моніторингу", "تنبيهات المراقبة")} />
          <Roles {...cx} p="notify.report_roles" v={f.notify.report_roles} t={L("Monthly department reports", "Ежемесячные отчёты департаментов", "Щомісячні звіти департаментів", "تقارير الأقسام الشهرية")} />
          <Roles {...cx} p="notify.brief_roles" v={f.notify.brief_roles} t={L("Monday brief", "Сводка по понедельникам", "Зведення щопонеділка", "ملخص الاثنين")} /></div>
        <div style={{ display: "grid", gap: 12 }}><div className="eyebrow">{T(L("Languages", "Языки", "Мови", "اللغات"))}</div>
          <label className="check"><input type="checkbox" disabled={ro} checked={f.translate.auto} onChange={(e) => set("translate.auto", e.target.checked)} />{T(L("Translate everything people write into English, Russian, Ukrainian and Arabic", "Переводить всё, что пишут люди, на английский, русский, украинский и арабский", "Перекладати все, що пишуть люди, англійською, російською, українською та арабською", "ترجمة كل ما يكتبه الناس إلى الإنجليزية والروسية والأوكرانية والعربية"))}</label>
          <label className="check"><input type="checkbox" disabled={ro} checked={f.translate.emails} onChange={(e) => set("translate.emails", e.target.checked)} />{T(L("Send system e-mails in each person's language", "Отправлять системные письма на языке каждого человека", "Надсилати системні листи мовою кожної людини", "إرسال رسائل النظام بلغة كل شخص"))}</label>
          <span className="hint">{T(L("Originals are never changed; translations are stored next to them. Translation uses the AI budget below.", "Оригиналы не меняются; переводы хранятся рядом с ними. Перевод расходует бюджет ИИ ниже.", "Оригінали не змінюються; переклади зберігаються поруч із ними. Переклад витрачає бюджет ШІ нижче.", "لا تتغير النصوص الأصلية؛ تُحفظ الترجمات بجانبها. تستهلك الترجمة ميزانية الذكاء الاصطناعي أدناه."))}</span></div>
        <div><div className="eyebrow" style={{ marginBottom: 8 }}>{T(L("AI budget", "Бюджет ИИ", "Бюджет ШІ", "ميزانية الذكاء الاصطناعي"))}</div>
          <div className="fgrid">
            <Num {...cx} p="ai.monthly_usd" v={f.ai.monthly_usd} t={L("Monthly limit for agents, USD (0 = no limit)", "Месячный лимит для агентов, USD (0 = без лимита)", "Місячний ліміт для агентів, USD (0 = без ліміту)", "الحد الشهري للوكلاء بالدولار (0 = بلا حد)")} hint={L("Over the limit agents keep working without AI conclusions.", "При превышении агенты работают дальше, но без выводов ИИ.", "Після перевищення агенти працюють далі, але без висновків ШІ.", "عند التجاوز يواصل الوكلاء العمل دون استنتاجات الذكاء الاصطناعي.")} />
            <Num {...cx} p="ai.price_in" v={f.ai.price_in} t={L("Price per 1M input tokens, USD", "Цена за 1 млн входящих токенов, USD", "Ціна за 1 млн вхідних токенів, USD", "سعر مليون رمز إدخال")} />
            <Num {...cx} p="ai.price_out" v={f.ai.price_out} t={L("Price per 1M output tokens, USD", "Цена за 1 млн исходящих токенов, USD", "Ціна за 1 млн вихідних токенів, USD", "سعر مليون رمز إخراج")} />
          </div></div>
      </div>
    </section>

    <TranslateNow T={T} />

    <section className="card">
      <div className="card-h toolbar"><h2><Icon n="spark" />{T(L("AI usage this month", "Расход ИИ за месяц", "Витрати ШІ за місяць", "استخدام الذكاء الاصطناعي هذا الشهر"))}</h2><span className="chip mono">{u.month}</span></div>
      <div className="card-b" style={{ display: "grid", gap: 12 }}>
        <div className="toolbar" style={{ gap: 18 }}>
          <div><div className="faint" style={{ fontSize: 13 }}>{T(L("Requests", "Запросов", "Запитів", "الطلبات"))}</div><b style={{ fontSize: 22 }}>{u.requests}</b></div>
          <div><div className="faint" style={{ fontSize: 13 }}>{T(L("Tokens in / out", "Токены вход / выход", "Токени вхід / вихід", "الرموز دخول / خروج"))}</div><b style={{ fontSize: 22 }} className="mono">{(u.tin / 1000).toFixed(0)}k / {(u.tout / 1000).toFixed(0)}k</b></div>
          <div><div className="faint" style={{ fontSize: 13 }}>{T(L("Estimated cost", "Оценка стоимости", "Оцінка вартості", "التكلفة التقديرية"))}</div><b style={{ fontSize: 22 }}>${u.usd.toFixed(2)}{u.budget ? <span className="faint" style={{ fontSize: 14 }}> / ${u.budget}</span> : null}</b></div></div>
        {u.budget > 0 && <div className="bar" style={{ height: 8, borderRadius: 6, background: "var(--surface-2)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: pct > 90 ? "var(--bad)" : pct > 70 ? "#A15C00" : "var(--ok, #1F7A4D)" }} /></div>}
        {u.by.length > 0 && <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("Who", "Кто", "Хто", "من"))}</th><th>{T(L("Requests", "Запросов", "Запитів", "الطلبات"))}</th><th>{T(L("Tokens", "Токены", "Токени", "الرموز"))}</th><th>USD</th></tr></thead>
          <tbody>{u.by.slice(0, 12).map((b) => <tr key={b.id}><td>{who(b.id)}</td><td className="mono">{b.n}</td><td className="mono">{((b.tin + b.tout) / 1000).toFixed(1)}k</td><td className="mono">{b.usd.toFixed(2)}</td></tr>)}</tbody></table></div>}
      </div>
    </section>

    <section className="card">
      <div className="card-h"><h2><Icon n="plug" />{T(L("Connections and keys", "Подключения и ключи", "Підключення та ключі", "الاتصالات والمفاتيح"))}</h2></div>
      <p className="faint" style={{ margin: "0 20px 10px", fontSize: 13.5 }}>{T(L("Only whether a key is set is shown, never its value. Keys are added by the owner in Vercel → Settings → Environment Variables, then redeploy.", "Показывается только, задан ли ключ, — значение никогда. Ключи добавляет владелец в Vercel → Settings → Environment Variables, затем Redeploy.", "Показується лише, чи задано ключ, — значення ніколи. Ключі додає власник у Vercel → Settings → Environment Variables, потім Redeploy.", "يُعرض فقط ما إذا كان المفتاح مضبوطاً، وليس قيمته. يضيف المالك المفاتيح في Vercel ثم يعيد النشر."))}</p>
      <div className="card-b sys-grid">{s.integrations.map((k) => (
        <div key={k.key} className={`sys-tile ${k.on ? "ok" : k.need ? "bad" : "warn"}`}><span className="sys-dot" aria-hidden="true" /><b className="mono" style={{ fontSize: 12.5 }}>{k.key}</b>
          <span className="faint">{k.on ? T(L("Set", "Задан", "Задано", "مضبوط")) : k.need ? T(L("Missing — needed", "Нет — нужен", "Немає — потрібен", "مفقود — مطلوب")) : T(L("Not set — optional", "Не задан — по желанию", "Не задано — за бажанням", "غير مضبوط — اختياري"))}</span>
          <span className="faint" style={{ fontSize: 12.5 }}>{T(KEY_INFO[k.key] || L(k.what, k.what, k.what, k.what))}</span></div>))}</div>
    </section>
  </div>);
}

/** Existing records written before translation was on: shows how many wait and translates them batch by batch. */
function TranslateNow({ T }: { T: (x: T4) => string }) {
  const { toast } = useApp();
  const [left, setLeft] = useState<number | null>(null); const [run, setRun] = useState(false); const [done, setDone] = useState(0);
  const api = async (action: string) => { const r = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
  useEffect(() => { api("status").then((j) => setLeft(j.left)).catch(() => setLeft(null)); }, []);
  const go = async () => {
    setRun(true); setDone(0);
    try { for (let i = 0; i < 200; i++) { const j = await api("sweep"); setDone((d) => d + (j.done || 0)); setLeft(j.left); if (!j.left || (!j.done && !j.faq)) break; } toast(T(L("Translation finished", "Перевод завершён", "Переклад завершено", "اكتملت الترجمة"))); }
    catch (e: any) { toast(e.message || "Error", true); } finally { setRun(false); }
  };
  return <section className="card">
    <div className="card-h toolbar"><h2><Icon n="globe" />{T(L("Translation of existing data", "Перевод существующих данных", "Переклад наявних даних", "ترجمة البيانات الموجودة"))}</h2>
      <button className="btn primary sm" style={{ marginInlineStart: "auto" }} disabled={run || left === 0} onClick={go}><Icon n="play" />{run ? `${done}…` : T(L("Translate now", "Перевести сейчас", "Перекласти зараз", "ترجم الآن"))}</button></div>
    <p className="faint" style={{ margin: "0 20px 16px", fontSize: 14 }}>{left === null ? "…" : left === 0 ? T(L("All records are available in all four languages.", "Все записи доступны на всех четырёх языках.", "Усі записи доступні всіма чотирма мовами.", "كل السجلات متاحة باللغات الأربع.")) : `${T(L("Records waiting for translation", "Записей ждут перевода", "Записів чекають перекладу", "سجلات بانتظار الترجمة"))}: ${left}. ${T(L("New and changed texts are translated automatically within seconds; this button translates older ones now.", "Новые и изменённые тексты переводятся автоматически за секунды; эта кнопка переводит старые сейчас.", "Нові та змінені тексти перекладаються автоматично за секунди; ця кнопка перекладає старі зараз.", "تُترجم النصوص الجديدة والمعدلة تلقائياً خلال ثوانٍ؛ وهذا الزر يترجم القديمة الآن."))}`}</p>
  </section>;
}
