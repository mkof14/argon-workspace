"use client";
// Notification centre: one list per person, written by the database when something happens to them
// (assignment, mention, comment, approval, deadline, milestone, announcement). Each event arrives once.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO, store, type Notice } from "@/lib/store";
import { refreshNotices, useNotices } from "./NavBits";
import { commentText } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
export const KINDS: Record<string, { icon: string; label: T4 }> = {
  assigned: { icon: "bell", label: L("Assigned to you", "Назначено вам", "Призначено вам", "أُسند إليك") },
  reassigned: { icon: "refresh", label: L("Reassigned to you", "Переназначено вам", "Перепризначено вам", "أُعيد إسناده إليك") },
  unassigned: { icon: "x", label: L("No longer yours", "Снято с вас", "Знято з вас", "لم يعد لك") },
  status: { icon: "check", label: L("Status changed", "Статус изменён", "Статус змінено", "تغيّرت الحالة") },
  mgmt_alert: { icon: "alert", label: L("Management alert", "Оповещение руководства", "Сповіщення керівництва", "تنبيه إداري") },
  waiting_remind: { icon: "clock", label: L("Someone is waiting for this", "Этого ждут от вас", "Цього чекають від вас", "شخص ينتظر هذا") },
  waiting_escalated: { icon: "alert", label: L("Escalated", "Эскалировано", "Ескальовано", "تم التصعيد") },
  mention: { icon: "user", label: L("Mentioned you", "Упомянули вас", "Згадали вас", "ذُكرت") },
  comment: { icon: "send", label: L("New comment", "Новый комментарий", "Новий коментар", "تعليق جديد") },
  approval_requested: { icon: "check", label: L("Approval requested", "Нужно ваше согласование", "Потрібне ваше погодження", "مطلوب موافقتك") },
  wf_action: { icon: "git", label: L("A process step needs you", "Шаг процесса ждёт вас", "Крок процесу чекає на вас", "خطوة في عملية تحتاجك") },
  wf_due_soon: { icon: "clock", label: L("Process step due soon", "Скоро срок шага процесса", "Скоро термін кроку процесу", "خطوة قريبة الاستحقاق") },
  wf_overdue: { icon: "alert", label: L("Process step overdue", "Шаг процесса просрочен", "Крок процесу прострочено", "خطوة متأخرة") },
  wf_escalated: { icon: "alert", label: L("Process step escalated to you", "Шаг процесса эскалирован вам", "Крок процесу ескальовано вам", "صُعّدت إليك خطوة") },
  crm_opp_assigned: { icon: "handshake", label: L("An opportunity was assigned to you", "Вам назначена возможность", "Вам призначено можливість", "أُسندت إليك فرصة") },
  crm_lead_assigned: { icon: "target", label: L("A lead was assigned to you", "Вам назначен лид", "Вам призначено лід", "أُسند إليك عميل محتمل") },
  crm_follow_up_due: { icon: "clock", label: L("Commercial follow-up due", "Пора связаться с клиентом", "Час зв'язатися з клієнтом", "حان موعد المتابعة التجارية") },
  crm_follow_up_overdue: { icon: "alert", label: L("Commercial follow-up overdue", "Просрочен контакт с клиентом", "Прострочено контакт із клієнтом", "متابعة تجارية متأخرة") },
  crm_lead_follow_up: { icon: "clock", label: L("Lead follow-up due", "Пора связаться с лидом", "Час зв'язатися з лідом", "حان موعد متابعة العميل المحتمل") },
  crm_event_follow_up: { icon: "flag", label: L("Event leads to follow up", "Лиды с выставки ждут контакта", "Ліди з виставки чекають контакту", "عملاء المعرض بانتظار المتابعة") },
  crm_meeting_soon: { icon: "calendar", label: L("Commercial meeting soon", "Скоро коммерческая встреча", "Скоро комерційна зустріч", "اجتماع تجاري قريب") },
  crm_proposal_expiring: { icon: "receipt", label: L("Proposal validity ends soon", "Скоро истекает срок КП", "Скоро спливає термін КП", "صلاحية العرض تنتهي قريبًا") },
  crm_decision_due: { icon: "stamp", label: L("Customer decision expected", "Ожидается решение клиента", "Очікується рішення клієнта", "قرار العميل متوقع") },
  mfg_work_assigned: { icon: "cpu", label: L("Work order assigned to you", "Вам назначен наряд", "Вам призначено наряд", "أُسند إليك أمر عمل") },
  mfg_work_overdue: { icon: "alert", label: L("Work order overdue", "Наряд просрочен", "Наряд прострочено", "أمر عمل متأخر") },
  mfg_unit_late: { icon: "clock", label: L("Build unit late", "Изделие опаздывает", "Виріб запізнюється", "وحدة بناء متأخرة") },
  mfg_blocked: { icon: "alert", label: L("Build unit blocked", "Изделие заблокировано", "Виріб заблоковано", "وحدة بناء معطلة") },
  mfg_shortage: { icon: "cart", label: L("Material shortage", "Нехватка материалов", "Нестача матеріалів", "نقص المواد") },
  mfg_purchase_late: { icon: "truck", label: L("Purchase for a build is late", "Закупка для сборки опаздывает", "Закупівля для збірки запізнюється", "شراء لبناء متأخر") },
  mfg_inspection_required: { icon: "shield", label: L("Inspection required", "Нужна инспекция", "Потрібна інспекція", "مطلوب فحص") },
  mfg_ecr_decision: { icon: "git", label: L("Engineering change needs a decision", "Инженерное изменение ждёт решения", "Інженерна зміна чекає рішення", "تغيير هندسي يحتاج قرارًا") },
  mfg_ready_acceptance: { icon: "stamp", label: L("Unit ready for acceptance", "Изделие готово к приёмке", "Виріб готовий до приймання", "وحدة جاهزة للقبول") },
  crm_stalled: { icon: "alert", label: L("Opportunity stalled", "Возможность застряла", "Можливість застрягла", "فرصة متوقفة") },
  crm_hold_review: { icon: "clock", label: L("On-hold opportunity due for review", "Пора пересмотреть приостановленную возможность", "Час переглянути призупинену можливість", "حان مراجعة الفرصة المعلقة") },
  wf_done: { icon: "check", label: L("Your request is finished", "Ваша заявка завершена", "Вашу заявку завершено", "اكتمل طلبك") },
  approval_done: { icon: "check", label: L("Approval decided", "Решение по согласованию", "Рішення щодо погодження", "قرار الموافقة") },
  due_soon: { icon: "clock", label: L("Deadline soon", "Скоро срок", "Скоро термін", "موعد قريب") },
  overdue: { icon: "alert", label: L("Overdue", "Просрочено", "Прострочено", "متأخر") },
  milestone: { icon: "flag", label: L("Milestone changed", "Изменилась веха", "Змінилася віха", "تغيّرت مرحلة") },
  project_member: { icon: "users", label: L("Project team", "Команда проекта", "Команда проєкту", "فريق المشروع") },
  announcement: { icon: "megaphone", label: L("Announcement", "Объявление", "Оголошення", "إعلان") },
  announcement_critical: { icon: "alert", label: L("Critical announcement", "Критическое объявление", "Критичне оголошення", "إعلان حرج") },
  reply: { icon: "send", label: L("Replied to you", "Вам ответили", "Вам відповіли", "رد عليك") },
  project_message: { icon: "layers", label: L("Project message", "Сообщение в проекте", "Повідомлення в проєкті", "رسالة في المشروع") },
  decision: { icon: "stamp", label: L("Decision recorded", "Записано решение", "Записано рішення", "سُجّل قرار") },
  doc_version: { icon: "file", label: L("New document version", "Новая версия документа", "Нова версія документа", "نسخة جديدة من مستند") },
  security: { icon: "shield", label: L("Security notice", "Уведомление безопасности", "Сповіщення безпеки", "إشعار أمني") },
};
/** Cannot be switched off: critical company announcements and security notices. */
export const MANDATORY = new Set(["announcement_critical", "security"]);
/** Notification centre tabs. */
export const CATS: { k: string; label: T4; kinds?: string[] }[] = [
  { k: "all", label: L("All", "Все", "Усі", "الكل") }, { k: "unread", label: L("Unread", "Непрочитанные", "Непрочитані", "غير مقروءة") },
  { k: "mentions", label: L("Mentions", "Упоминания", "Згадки", "الإشارات"), kinds: ["mention", "reply"] },
  { k: "tasks", label: L("Tasks", "Задачи", "Задачі", "المهام"), kinds: ["assigned", "reassigned", "unassigned", "status", "due_soon", "overdue"] },
  { k: "projects", label: L("Projects", "Проекты", "Проєкти", "المشاريع"), kinds: ["project_member", "milestone", "project_message", "decision", "comment"] },
  { k: "documents", label: L("Documents", "Документы", "Документи", "المستندات"), kinds: ["doc_version"] },
  { k: "approvals", label: L("Approvals", "Согласования", "Погодження", "الموافقات"), kinds: ["approval_requested", "approval_done"] },
  { k: "company", label: L("Company", "Компания", "Компанія", "الشركة"), kinds: ["announcement", "announcement_critical", "security"] },
  { k: "management", label: L("Management", "Руководство", "Керівництво", "الإدارة"), kinds: ["mgmt_alert", "waiting_remind", "waiting_escalated"] },
  { k: "processes", label: L("Requests & processes", "Заявки и процессы", "Заявки та процеси", "الطلبات والعمليات"), kinds: ["wf_action", "wf_due_soon", "wf_overdue", "wf_escalated", "wf_done"] },
  { k: "manufacturing", label: L("Manufacturing", "Производство", "Виробництво", "التصنيع"), kinds: ["mfg_work_assigned", "mfg_work_overdue", "mfg_unit_late", "mfg_blocked", "mfg_shortage", "mfg_purchase_late", "mfg_inspection_required", "mfg_ecr_decision", "mfg_ready_acceptance"] },
  { k: "commercial", label: L("Commercial", "Коммерция", "Комерція", "التجاري"), kinds: ["crm_opp_assigned", "crm_lead_assigned", "crm_follow_up_due", "crm_follow_up_overdue", "crm_lead_follow_up", "crm_event_follow_up", "crm_meeting_soon", "crm_proposal_expiring", "crm_decision_due", "crm_stalled", "crm_hold_review"] },
];
export const noticeHref = (n: Notice) => n.link || (n.record_id && n.section ? `/${n.section.replace(".", "/")}?r=${n.record_id}` : "/notifications");
const ago = (iso: string, lang: Lang) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? tx(L(`${Math.max(1, m)} min`, `${Math.max(1, m)} мин`, `${Math.max(1, m)} хв`, `${Math.max(1, m)} د`), lang) : m < 1440 ? tx(L(`${Math.round(m / 60)} h`, `${Math.round(m / 60)} ч`, `${Math.round(m / 60)} год`, `${Math.round(m / 60)} س`), lang) : iso.slice(0, 10); };

function Row({ n, onOpen, onMute }: { n: Notice; onOpen?: () => void; onMute?: (kind: string) => void }) {
  const { lang, people } = useApp(); const k = KINDS[n.kind] || { icon: "bell", label: L(n.kind, n.kind, n.kind, n.kind) };
  const who = people.find((p) => p.id === n.actor); const sec = n.section ? findSection(n.section) : null;
  const open = async () => { if (!n.read_at) { await store.markNotices([n.id]).catch(() => {}); refreshNotices(); } onOpen?.(); };
  const link = <Link href={noticeHref(n)} onClick={open} className={`notice ${n.read_at ? "" : "unread"} ${n.critical ? "critical" : ""}`} data-kind={n.kind} style={{ ["--dc" as any]: sec?.color }}>
    <span className="dic"><Icon n={k.icon} /></span>
    <span style={{ minWidth: 0 }}><small>{tx(k.label, lang as Lang)}{who ? ` · ${who.full_name || who.email}` : ""}</small><b>{n.title || "—"}</b>{n.body && <span className="faint nb">{commentText(n.body)}</span>}</span>
    <small className="faint mono">{ago(n.created_at, lang as Lang)}</small>
  </Link>;
  if (!onMute) return link;
  return <div className="notice-wrap">{link}<span className="notice-act">
    {!n.read_at && <button type="button" className="btn ghost xs" onClick={async () => { await store.markNotices([n.id]).catch(() => {}); refreshNotices(); }}>{tx(L("Mark read", "Прочитано", "Прочитано", "مقروء"), lang as Lang)}</button>}
    {!MANDATORY.has(n.kind) && <button type="button" className="btn ghost xs" onClick={() => onMute(n.kind)} title={tx(L("Stop notifications of this kind", "Больше не уведомлять о таком", "Більше не сповіщати про таке", "أوقف هذا النوع"), lang as Lang)}>{tx(L("Mute", "Отключить", "Вимкнути", "كتم"), lang as Lang)}</button>}
  </span></div>;
}

/** Bell in the top bar: unread count and the latest notifications. */
export function Bell() {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const { list, unread } = useNotices(); const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open]);
  const n = unread.length;
  return <>
    <button className="iconbtn bell" onClick={() => setOpen(!open)} title={T(L("Notifications", "Уведомления", "Сповіщення", "الإشعارات"))} aria-label={`${T(L("Notifications", "Уведомления", "Сповіщення", "الإشعارات"))}${n ? ` (${n})` : ""}`} aria-expanded={open}>
      <Icon n="bell" />{n > 0 && <span className="badge">{n > 9 ? "9+" : n}</span>}
    </button>
    {open && <><div className="scrim" style={{ background: "transparent" }} onClick={() => setOpen(false)} />
      <div className="inbox" role="dialog" aria-label={T(L("Notifications", "Уведомления", "Сповіщення", "الإشعارات"))}>
        <div className="inbox-h"><b>{T(L("Notifications", "Уведомления", "Сповіщення", "الإشعارات"))}</b>
          <span className="toolbar">{n > 0 && <button className="btn ghost sm" onClick={async () => { await store.markNotices("all").catch(() => {}); refreshNotices(); }}><Icon n="check" />{T(L("Mark all read", "Прочитать все", "Прочитати все", "تعليم الكل كمقروء"))}</button>}
            <Link href="/notifications" className="btn ghost sm" onClick={() => setOpen(false)}>{T(L("All", "Все", "Усі", "الكل"))}</Link></span></div>
        <div className="feed inbox-b">{list.length ? list.slice(0, 25).map((x) => <Row key={x.id} n={x} onOpen={() => setOpen(false)} />)
          : <div className="empty">{DEMO ? T(L("Notifications work on the live site.", "Уведомления работают на живом сайте.", "Сповіщення працюють на живому сайті.", "الإشعارات تعمل على الموقع الفعلي.")) : T(L("Nothing new. You will see assignments, mentions and approvals here.", "Ничего нового. Здесь появятся назначения, упоминания и согласования.", "Нічого нового. Тут з'являться призначення, згадки й погодження.", "لا جديد. ستظهر هنا المهام والإشارات والموافقات."))}</div>}</div>
      </div></>}
  </>;
}

/** The notification centre: categories, unread, mark read, open the exact source, mute an event, settings. */
export default function Notices() {
  const { lang, me, toast, reload } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const { list } = useNotices(); const [f, setF] = useState<string>(() => (typeof window !== "undefined" ? new URLSearchParams(location.search).get("f") : null) || "all");
  const cat = CATS.find((c) => c.k === f) || CATS[0];
  const shown = useMemo(() => list.filter((x) => cat.k === "all" || (cat.k === "unread" ? !x.read_at : cat.kinds!.includes(x.kind))), [list, cat]);
  const count = (c: typeof CATS[number]) => list.filter((x) => !x.read_at && (c.k === "all" || c.k === "unread" || c.kinds!.includes(x.kind))).length;
  const mute = async (kind: string) => {
    const p = (me.notify_prefs || {}) as any; const muted: string[] = [...new Set([...(p.muted || []), kind])];
    try { await store.updateProfile(me.id, { notify_prefs: { ...p, muted } } as any); toast(T(L("Switched off. You can turn it on again in Settings.", "Отключено. Включить снова можно в настройках.", "Вимкнено. Увімкнути знову можна в налаштуваннях.", "أُوقف. يمكنك تشغيله مجدداً من الإعدادات."))); reload(); } catch (e: any) { toast(e.message || "Error", true); }
  };
  return <section className="card notices-page">
    <div className="card-h toolbar"><h2><Icon n="bell" />{T(L("Notifications", "Уведомления", "Сповіщення", "الإشعارات"))}</h2>
      <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={async () => { await store.markNotices("all").catch(() => {}); refreshNotices(); }}><Icon n="check" />{T(L("Mark all read", "Прочитать все", "Прочитати все", "تعليم الكل كمقروء"))}</button>
      <Link className="btn ghost sm" href="/me#notify"><Icon n="gear" />{T(L("Settings", "Настройки", "Налаштування", "الإعدادات"))}</Link></div>
    <nav className="tabs notice-tabs" role="tablist">{CATS.map((c) => { const n = count(c); return <button key={c.k} role="tab" aria-selected={f === c.k} className={f === c.k ? "on" : ""} data-cat={c.k} onClick={() => setF(c.k)}>{T(c.label)}{n && c.k !== "all" ? <b className="mono"> {n}</b> : null}</button>; })}</nav>
    <div className="feed" style={{ padding: "0 8px 8px" }}>{shown.length ? shown.map((x) => <Row key={x.id} n={x} onMute={mute} />) : <div className="empty">{T(L("No notifications.", "Уведомлений нет.", "Сповіщень немає.", "لا إشعارات."))}</div>}</div>
  </section>;
}

/** Personal settings: which events reach me by e-mail and on the phone, quiet hours in my time zone, and the
 *  e-mail mode. In Workspace I always see everything; the server applies these rules when it delivers. */
export function NotifyPrefs() {
  const { lang, me, toast, reload } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const DEF = ["assigned", "reassigned", "mention", "reply", "approval_requested", "approval_done", "due_soon", "overdue", "announcement", "decision"];
  const p = (me.notify_prefs || {}) as any;
  const [email, setEmail] = useState<string[]>(p.email || DEF); const [push, setPush] = useState<string[]>(p.push || DEF); const [muted, setMuted] = useState<string[]>(p.muted || []);
  const [mode, setMode] = useState<string>(p.email_mode || "immediate");
  const [quiet, setQuiet] = useState<boolean>(!!p.quiet?.from); const [qf, setQf] = useState<string>(p.quiet?.from || "22:00"); const [qt, setQt] = useState<string>(p.quiet?.to || "07:00");
  const [tz, setTz] = useState<string>(p.tz || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })());
  const keys = Object.keys(KINDS).filter((k) => k !== "unassigned");
  const flip = (l: string[], set: (x: string[]) => void, k: string) => set(l.includes(k) ? l.filter((x) => x !== k) : [...l, k]);
  const zones = (() => { try { return (Intl as any).supportedValuesOf("timeZone") as string[]; } catch { return ["UTC", "America/New_York", "Europe/Kyiv", "Asia/Dubai"]; } })();
  const save = async () => { try { await store.updateProfile(me.id, { notify_prefs: { ...p, email, push, muted: muted.filter((k) => !MANDATORY.has(k)), email_mode: mode, quiet: quiet ? { from: qf, to: qt } : null, tz } } as any); toast(T(L("Saved", "Сохранено", "Збережено", "حُفظ"))); reload(); } catch (e: any) { toast(e.message || "Error", true); } };
  return <section className="card" id="notify"><div className="card-h"><h2><Icon n="bell" />{T(L("Notifications", "Уведомления", "Сповіщення", "الإشعارات"))}</h2></div>
    <div className="card-b" style={{ display: "grid", gap: 12 }}>
      <p className="faint" style={{ margin: 0 }}>{T(L("Everything appears in Workspace (the bell). Choose what also comes by e-mail or to your phone, or switch an event off.", "Всё появляется в Workspace (колокольчик). Выберите, что дополнительно приходит на почту или на телефон, или отключите событие.", "Усе з'являється у Workspace (дзвіночок). Виберіть, що додатково надходить поштою чи на телефон, або вимкніть подію.", "يظهر كل شيء في مساحة العمل (الجرس). اختر ما يصل أيضاً بالبريد أو إلى هاتفك، أو أوقف حدثاً."))}</p>
      <div className="notify-grid">
        <label className="field"><span>{T(L("E-mail", "Почта", "Пошта", "البريد"))}</span><select className="input" value={mode} onChange={(e) => setMode(e.target.value)} data-pref="email_mode">
          <option value="immediate">{T(L("Immediately", "Сразу", "Одразу", "فوراً"))}</option><option value="daily">{T(L("One daily summary (8:00)", "Одна сводка в день (8:00)", "Один підсумок на день (8:00)", "ملخص يومي واحد (8:00)"))}</option><option value="off">{T(L("Off — only in Workspace", "Выкл. — только в Workspace", "Вимк. — лише у Workspace", "إيقاف — في مساحة العمل فقط"))}</option></select></label>
        <label className="field"><span>{T(L("Time zone", "Часовой пояс", "Часовий пояс", "المنطقة الزمنية"))}</span><select className="input" value={tz} onChange={(e) => setTz(e.target.value)} data-pref="tz">{(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z}>{z}</option>)}</select></label>
        <div className="field"><label className="chk"><input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} data-pref="quiet" /> {T(L("Quiet hours", "Тихие часы", "Тихі години", "ساعات الهدوء"))}</label>
          {quiet && <div className="toolbar"><input className="input" type="time" value={qf} onChange={(e) => setQf(e.target.value)} aria-label={T(L("From", "С", "З", "من"))} /> — <input className="input" type="time" value={qt} onChange={(e) => setQt(e.target.value)} aria-label={T(L("To", "До", "До", "إلى"))} /></div>}
          <small className="faint">{T(L("E-mail and phone wait until the quiet hours end. Workspace still shows everything at once. Critical announcements always come through.", "Почта и телефон ждут конца тихих часов. В Workspace всё видно сразу. Критические объявления приходят всегда.", "Пошта й телефон чекають кінця тихих годин. У Workspace усе видно одразу. Критичні оголошення надходять завжди.", "ينتظر البريد والهاتف انتهاء ساعات الهدوء. تُظهر مساحة العمل كل شيء فوراً. الإعلانات الحرجة تصل دائماً."))}</small></div>
      </div>
      <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("Event", "Событие", "Подія", "الحدث"))}</th><th>{T(L("E-mail", "Почта", "Пошта", "البريد"))}</th><th>{T(L("Phone", "Телефон", "Телефон", "الهاتف"))}</th><th>{T(L("Off", "Выкл.", "Вимк.", "إيقاف"))}</th></tr></thead>
        <tbody>{keys.map((k) => { const must = MANDATORY.has(k); return <tr key={k}><td><Icon n={KINDS[k].icon} /> {tx(KINDS[k].label, lang as Lang)}{must && <small className="faint"> · {T(L("always on", "всегда включено", "завжди ввімкнено", "مفعّل دائماً"))}</small>}</td>
          <td><input type="checkbox" aria-label={`${tx(KINDS[k].label, lang as Lang)}: e-mail`} disabled={must || muted.includes(k) || mode === "off"} checked={must || (email.includes(k) && !muted.includes(k))} onChange={() => flip(email, setEmail, k)} /></td>
          <td><input type="checkbox" aria-label={`${tx(KINDS[k].label, lang as Lang)}: push`} disabled={must || muted.includes(k)} checked={must || (push.includes(k) && !muted.includes(k))} onChange={() => flip(push, setPush, k)} /></td>
          <td><input type="checkbox" aria-label={`${tx(KINDS[k].label, lang as Lang)}: off`} disabled={must} checked={!must && muted.includes(k)} onChange={() => flip(muted, setMuted, k)} /></td></tr>; })}</tbody></table></div>
      <div className="toolbar"><button className="btn primary sm" onClick={save}>{T(L("Save", "Сохранить", "Зберегти", "حفظ"))}</button></div>
    </div></section>;
}
