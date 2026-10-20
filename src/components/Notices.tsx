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
  mention: { icon: "user", label: L("Mentioned you", "Упомянули вас", "Згадали вас", "ذُكرت") },
  comment: { icon: "send", label: L("New comment", "Новый комментарий", "Новий коментар", "تعليق جديد") },
  approval_requested: { icon: "check", label: L("Approval requested", "Нужно ваше согласование", "Потрібне ваше погодження", "مطلوب موافقتك") },
  approval_done: { icon: "check", label: L("Approval decided", "Решение по согласованию", "Рішення щодо погодження", "قرار الموافقة") },
  due_soon: { icon: "clock", label: L("Deadline soon", "Скоро срок", "Скоро термін", "موعد قريب") },
  overdue: { icon: "alert", label: L("Overdue", "Просрочено", "Прострочено", "متأخر") },
  milestone: { icon: "flag", label: L("Milestone changed", "Изменилась веха", "Змінилася віха", "تغيّرت مرحلة") },
  project_member: { icon: "users", label: L("Project team", "Команда проекта", "Команда проєкту", "فريق المشروع") },
  announcement: { icon: "megaphone", label: L("Announcement", "Объявление", "Оголошення", "إعلان") },
};
export const noticeHref = (n: Notice) => n.link || (n.record_id && n.section ? `/${n.section.replace(".", "/")}?r=${n.record_id}` : "/notifications");
const ago = (iso: string, lang: Lang) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? tx(L(`${Math.max(1, m)} min`, `${Math.max(1, m)} мин`, `${Math.max(1, m)} хв`, `${Math.max(1, m)} د`), lang) : m < 1440 ? tx(L(`${Math.round(m / 60)} h`, `${Math.round(m / 60)} ч`, `${Math.round(m / 60)} год`, `${Math.round(m / 60)} س`), lang) : iso.slice(0, 10); };

function Row({ n, onOpen }: { n: Notice; onOpen?: () => void }) {
  const { lang, people } = useApp(); const k = KINDS[n.kind] || { icon: "bell", label: L(n.kind, n.kind, n.kind, n.kind) };
  const who = people.find((p) => p.id === n.actor); const sec = n.section ? findSection(n.section) : null;
  const open = async () => { if (!n.read_at) { await store.markNotices([n.id]).catch(() => {}); refreshNotices(); } onOpen?.(); };
  return <Link href={noticeHref(n)} onClick={open} className={`notice ${n.read_at ? "" : "unread"}`} data-kind={n.kind} style={{ ["--dc" as any]: sec?.color }}>
    <span className="dic"><Icon n={k.icon} /></span>
    <span style={{ minWidth: 0 }}><small>{tx(k.label, lang as Lang)}{who ? ` · ${who.full_name || who.email}` : ""}</small><b>{n.title || "—"}</b>{n.body && <span className="faint nb">{commentText(n.body)}</span>}</span>
    <small className="faint mono">{ago(n.created_at, lang as Lang)}</small>
  </Link>;
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

/** Full history with filters. */
export default function Notices() {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const { list } = useNotices(); const [f, setF] = useState<"all" | "unread" | string>("all");
  const shown = useMemo(() => list.filter((x) => f === "all" || (f === "unread" ? !x.read_at : x.kind === f)), [list, f]);
  const kinds = [...new Set(list.map((x) => x.kind))];
  return <section className="card">
    <div className="card-h toolbar"><h2><Icon n="bell" />{T(L("Notifications", "Уведомления", "Сповіщення", "الإشعارات"))}</h2>
      <select className="input" style={{ width: "auto", marginInlineStart: "auto" }} value={f} onChange={(e) => setF(e.target.value)} aria-label={T(L("Show", "Показать", "Показати", "عرض"))}>
        <option value="all">{T(L("All", "Все", "Усі", "الكل"))}</option><option value="unread">{T(L("Unread", "Непрочитанные", "Непрочитані", "غير مقروءة"))}</option>
        {kinds.map((k) => <option key={k} value={k}>{tx(KINDS[k]?.label || L(k, k, k, k), lang as Lang)}</option>)}</select>
      <button className="btn ghost sm" onClick={async () => { await store.markNotices("all").catch(() => {}); refreshNotices(); }}><Icon n="check" />{T(L("Mark all read", "Прочитать все", "Прочитати все", "تعليم الكل كمقروء"))}</button>
      <Link className="btn ghost sm" href="/me#notify"><Icon n="gear" />{T(L("Settings", "Настройки", "Налаштування", "الإعدادات"))}</Link></div>
    <div className="feed" style={{ padding: "0 8px 8px" }}>{shown.length ? shown.map((x) => <Row key={x.id} n={x} />) : <div className="empty">{T(L("No notifications.", "Уведомлений нет.", "Сповіщень немає.", "لا إشعارات."))}</div>}</div>
  </section>;
}

/** Personal settings: which events reach me by e-mail and on the phone (in Workspace I always see them). */
export function NotifyPrefs() {
  const { lang, me, toast, reload } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const DEF = ["assigned", "reassigned", "mention", "approval_requested", "approval_done", "due_soon", "overdue", "announcement"];
  const p = (me.notify_prefs || {}) as Record<string, string[]>;
  const [email, setEmail] = useState<string[]>(p.email || DEF); const [push, setPush] = useState<string[]>(p.push || DEF); const [muted, setMuted] = useState<string[]>(p.muted || []);
  const keys = Object.keys(KINDS).filter((k) => k !== "unassigned");
  const flip = (l: string[], set: (x: string[]) => void, k: string) => set(l.includes(k) ? l.filter((x) => x !== k) : [...l, k]);
  const save = async () => { try { await store.updateProfile(me.id, { notify_prefs: { email, push, muted } } as any); toast(T(L("Saved", "Сохранено", "Збережено", "حُفظ"))); reload(); } catch (e: any) { toast(e.message || "Error", true); } };
  return <section className="card" id="notify"><div className="card-h"><h2><Icon n="bell" />{T(L("Notifications", "Уведомления", "Сповіщення", "الإشعارات"))}</h2></div>
    <div className="card-b" style={{ display: "grid", gap: 10 }}>
      <p className="faint" style={{ margin: 0 }}>{T(L("Everything appears in Workspace (the bell). Choose what also comes by e-mail or to your phone, or switch an event off.", "Всё появляется в Workspace (колокольчик). Выберите, что дополнительно приходит на почту или на телефон, или отключите событие.", "Усе з'являється у Workspace (дзвіночок). Виберіть, що додатково надходить поштою чи на телефон, або вимкніть подію.", "يظهر كل شيء في مساحة العمل (الجرس). اختر ما يصل أيضاً بالبريد أو إلى هاتفك، أو أوقف حدثاً."))}</p>
      <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("Event", "Событие", "Подія", "الحدث"))}</th><th>{T(L("E-mail", "Почта", "Пошта", "البريد"))}</th><th>{T(L("Phone", "Телефон", "Телефон", "الهاتف"))}</th><th>{T(L("Off", "Выкл.", "Вимк.", "إيقاف"))}</th></tr></thead>
        <tbody>{keys.map((k) => <tr key={k}><td><Icon n={KINDS[k].icon} /> {tx(KINDS[k].label, lang as Lang)}</td>
          <td><input type="checkbox" aria-label={`${tx(KINDS[k].label, lang as Lang)}: e-mail`} disabled={muted.includes(k)} checked={email.includes(k) && !muted.includes(k)} onChange={() => flip(email, setEmail, k)} /></td>
          <td><input type="checkbox" aria-label={`${tx(KINDS[k].label, lang as Lang)}: push`} disabled={muted.includes(k)} checked={push.includes(k) && !muted.includes(k)} onChange={() => flip(push, setPush, k)} /></td>
          <td><input type="checkbox" aria-label={`${tx(KINDS[k].label, lang as Lang)}: off`} checked={muted.includes(k)} onChange={() => flip(muted, setMuted, k)} /></td></tr>)}</tbody></table></div>
      <div className="toolbar"><button className="btn primary sm" onClick={save}>{T(L("Save", "Сохранить", "Зберегти", "حفظ"))}</button></div>
    </div></section>;
}
