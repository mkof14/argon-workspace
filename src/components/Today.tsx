"use client";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { useInbox } from "./Inbox";
import { tx, type Lang } from "@/lib/i18n";
import { OPEN, isMine } from "@/lib/insights";
import { tone } from "@/lib/format";
import { useEffect, useState } from "react";
import { DEMO } from "@/lib/sb";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const href = (r: { id?: string; record_id?: string; section?: string }) => `/${String(r.section).replace(".", "/")}?r=${r.record_id || r.id}`;

/** My day: what needs me today — approvals, my deadlines, tasks, mentions; leaders also see company-wide overdue items. */
export default function Today() {
  const { lang, me, openIntake } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const d = useInbox();
  // Owners and administrators also see what the agents prepared for approval
  const [auto, setAuto] = useState<{ n: number; items: { id: string; agent: string; title: string; at: string }[] } | null>(null);
  useEffect(() => { if (DEMO || !["owner", "admin"].includes(me.role)) return; fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pending" }) }).then((r) => (r.ok ? r.json() : null)).then(setAuto).catch(() => {}); }, [me.role]);
  const hour = new Date().getHours();
  const hello = hour < 12 ? L("Good morning", "Доброе утро", "Доброго ранку", "صباح الخير") : hour < 18 ? L("Good afternoon", "Добрый день", "Доброго дня", "مساء الخير") : L("Good evening", "Добрый вечер", "Доброго вечора", "مساء الخير");
  const tasks = d.recs.filter((r) => r.section === "company.tasks" && OPEN(r) && isMine(r, me)).sort((a, b) => String(a.data?.due || "9").localeCompare(String(b.data?.due || "9")));
  const late = d.mine.filter((x) => x.d < 0), soon = d.mine.filter((x) => x.d >= 0);
  const rel = (n: number) => (n < 0 ? T(L(`${-n} d late`, `просрочено ${-n} дн.`, `прострочено ${-n} дн.`, `متأخر ${-n} يوم`)) : n === 0 ? T(L("today", "сегодня", "сьогодні", "اليوم")) : T(L(`in ${n} d`, `через ${n} дн.`, `через ${n} дн.`, `بعد ${n} يوم`)));
  const Box = ({ icon, title, n, children, empty }: { icon: string; title: T4; n: number; children: React.ReactNode; empty: T4 }) => (
    <div className="card hub-card"><div className="card-h"><h2><Icon n={icon} />{T(title)}</h2><span className="chip mono" style={{ marginInlineStart: "auto" }}>{n}</span></div>
      <div className="feed">{n ? children : <div className="empty" style={{ padding: 16 }}>{T(empty)}</div>}</div></div>);
  const name = (me.full_name || me.email || "").split(/\s+/)[0];
  const total = d.approvals.length + late.length + soon.filter((x) => x.d <= 2).length + tasks.length + d.newMentions.length;
  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#FF6A2B" }}>
      <section className="dhero"><div className="dhero-top"><span className="dhero-ic"><Icon n="sun" /></span>
        <div style={{ minWidth: 0 }}><div className="dhero-kicker">{new Date().toLocaleDateString(lang === "en" ? "en-US" : lang, { weekday: "long", day: "numeric", month: "long" })}</div>
          <h2>{T(hello)}, {name}</h2>
          <p>{total ? T(L(`${total} things need you. Approvals and late items first.`, `Вас ждут дела: ${total}. Сначала согласования и просроченное.`, `На вас чекають справи: ${total}. Спершу погодження та прострочене.`, `${total} أمور تنتظرك. ابدأ بالموافقات والمتأخر.`)) : T(L("Nothing urgent. A good day to move a project forward.", "Ничего срочного. Хороший день, чтобы продвинуть проект.", "Нічого термінового. Гарний день, щоб просунути проєкт.", "لا شيء عاجل. يوم جيد للتقدم في مشروع."))}</p></div></div>
        <div className="dhero-stats">
          <Link href="#appr" className={`dstat ${d.approvals.length ? "bad" : ""}`}><b>{d.approvals.length}</b><span>{T(L("Waiting for my approval", "Ждут моего согласования", "Чекають мого погодження", "بانتظار موافقتي"))}</span></Link>
          <Link href="#due" className={`dstat ${late.length ? "bad" : ""}`}><b>{late.length}</b><span>{T(L("My overdue items", "Мои просрочки", "Мої прострочення", "متأخراتي"))}</span><small>{soon.length} {T(L("due in 14 days", "в ближайшие 14 дней", "у найближчі 14 днів", "خلال 14 يوماً"))}</small></Link>
          <Link href="#tasks" className="dstat"><b>{tasks.length}</b><span>{T(L("My open tasks", "Мои открытые задачи", "Мої відкриті задачі", "مهامي المفتوحة"))}</span></Link>
          <Link href="#men" className="dstat"><b>{d.newMentions.length}</b><span>{T(L("New mentions", "Новые упоминания", "Нові згадки", "إشارات جديدة"))}</span><small>{d.mentions.length} {T(L("in 30 days", "за 30 дней", "за 30 днів", "خلال 30 يوماً"))}</small></Link>
        </div></section>
      <div className="toolbar"><button className="btn primary sm" onClick={() => openIntake()}><Icon n="upload" />{T(L("Smart upload", "Умная загрузка", "Розумне завантаження", "رفع ذكي"))}</button>
        <Link href="/company/tasks?new=1" className="btn sm"><Icon n="plus" />{T(L("New task", "Новая задача", "Нова задача", "مهمة جديدة"))}</Link>
        <Link href="/ask" className="btn ghost sm"><Icon n="spark" />{T(L("Ask documents", "Спросить документы", "Запитати документи", "اسأل المستندات"))}</Link></div>
      <div className="hub-grid">
        <div id="appr"><Box icon="check" title={L("Approvals waiting for me", "Согласования, которые ждут меня", "Погодження, що чекають на мене", "موافقات بانتظاري")} n={d.approvals.length} empty={L("No approvals waiting.", "Согласований нет.", "Погоджень немає.", "لا موافقات.")}>
          {d.approvals.map((a) => <Link key={a.id} href={href(a)} className="hub-row"><span><b>{a.title || T(L("Record", "Запись", "Запис", "سجل"))}</b><small>{tx(findSection(a.section)?.label, lang as Lang)} · {a.created_at.slice(0, 10)}</small></span><span className="chip c-warn">{T(L("Decide", "Решить", "Вирішити", "قرّر"))}</span></Link>)}</Box></div>
        <div id="due"><Box icon="clock" title={L("My deadlines", "Мои сроки", "Мої терміни", "مواعيدي")} n={d.mine.length} empty={L("No deadlines in the next 14 days.", "Сроков в ближайшие 14 дней нет.", "Термінів у найближчі 14 днів немає.", "لا مواعيد خلال 14 يوماً.")}>
          {d.mine.slice(0, 12).map((x) => <Link key={x.r.id + x.k} href={href(x.r)} className="hub-row"><span><b>{x.r.title}</b><small>{tx(findSection(x.r.section)?.label, lang as Lang)}</small></span><span className={`chip ${x.d < 0 ? "c-bad" : x.d <= 2 ? "c-warn" : "c-info"}`}>{rel(x.d)}</span></Link>)}</Box></div>
        <div id="tasks"><Box icon="bell" title={L("My tasks", "Мои задачи", "Мої задачі", "مهامي")} n={tasks.length} empty={L("No open tasks assigned to you.", "Открытых задач на вас нет.", "Відкритих задач на вас немає.", "لا مهام مفتوحة.")}>
          {tasks.slice(0, 12).map((r) => <Link key={r.id} href={href(r)} className="hub-row"><span><b>{r.title}</b><small>{r.data?.due || ""}</small></span><span className={`chip ${tone(r.status)}`}>{r.status}</span></Link>)}</Box></div>
        <div id="men"><Box icon="user" title={L("Mentions of me", "Упоминания меня", "Згадки про мене", "الإشارات إليّ")} n={d.mentions.length} empty={L("Nobody mentioned you in 30 days.", "За 30 дней вас не упоминали.", "За 30 днів вас не згадували.", "لم يُشر إليك أحد.")}>
          {d.mentions.slice(0, 10).map((m) => <Link key={m.id} href={href({ record_id: m.record_id, section: m.section })} className="hub-row"><span><b>{m.title}</b><small>{m.body.slice(0, 120)}</small></span><small className="faint">{m.created_at.slice(0, 10)}</small></Link>)}</Box></div>
        {auto && auto.n > 0 && <div className="wide"><Box icon="cpu" title={L("Prepared by agents — approve in one click", "Подготовлено агентами — одобрите одним кликом", "Підготовлено агентами — схваліть одним кліком", "أعدّه الوكلاء — وافق بنقرة واحدة")} n={auto.n} empty={L("", "", "", "")}>
          {auto.items.map((q) => <Link key={q.id} href="/admin/system?tab=auto" className="hub-row"><span><b>{q.title}</b><small>{q.agent} · {q.at.slice(0, 10)}</small></span><span className="chip c-warn">{T(L("Review", "Посмотреть", "Переглянути", "مراجعة"))}</span></Link>)}</Box></div>}
        {d.company.length > 0 && <div className="wide"><Box icon="alert" title={L("Company: overdue items (leaders)", "Компания: просрочено (для руководства)", "Компанія: прострочено (для керівництва)", "الشركة: متأخرات")} n={d.company.length} empty={L("", "", "", "")}>
          {d.company.slice(0, 15).map((x) => <Link key={x.r.id + x.k} href={href(x.r)} className="hub-row"><span><b>{x.r.title}</b><small>{tx(findSection(x.r.section)?.label, lang as Lang)}{x.r.data?.owner ? ` · ${x.r.data.owner}` : ""}</small></span><span className="chip c-bad">{rel(x.d)}</span></Link>)}</Box></div>}
      </div>
    </div>
  );
}
