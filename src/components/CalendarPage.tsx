"use client";
// CALENDAR: meetings, task deadlines and project milestones on one month view and an agenda.
// Personal calendars (Google, Outlook, Apple) can subscribe to the same items from My profile.
import { useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { useWork } from "./useWork";
import { isMineTask, isOpenTask, MS_CLOSED, todayIso } from "@/lib/work";
import type { Rec } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Item = { date: string; time?: string; kind: "meeting" | "task" | "milestone"; r: Rec };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function CalendarPage() {
  const { lang, me, access } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const w = useWork(); const today = todayIso();
  const [mine, setMine] = useState(true);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); });
  const [day, setDay] = useState(today);
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const m of w.meetings) if (m.data?.date && m.status !== "Cancelled" && (!mine || m.created_by === me.id || !Array.isArray(m.data?.participants_ids) || m.data.participants_ids.includes(me.id))) out.push({ date: String(m.data.date).slice(0, 10), time: m.data?.time, kind: "meeting", r: m });
    for (const t of w.tasks) if (t.data?.due && isOpenTask(t) && (!mine || isMineTask(t, me.id))) out.push({ date: String(t.data.due).slice(0, 10), kind: "task", r: t });
    for (const m of w.milestones) if (m.data?.due && !MS_CLOSED.has(m.status || "") && (!mine || m.data?.owner_id === me.id || w.projects.some((p) => p.id === m.data?.project_ref && (p.data?.manager_id === me.id || (p.data?.members_ids || []).includes(me.id))))) out.push({ date: String(m.data.due).slice(0, 10), kind: "milestone", r: m });
    return out.sort((a, b) => `${a.date}${a.time || "99"}`.localeCompare(`${b.date}${b.time || "99"}`));
  }, [w.meetings, w.tasks, w.milestones, w.projects, mine, me.id]);
  const byDay = useMemo(() => { const m = new Map<string, Item[]>(); for (const i of items) m.set(i.date, [...(m.get(i.date) || []), i]); return m; }, [items]);
  const start = new Date(month); const lead = (start.getUTCDay() + 6) % 7; start.setUTCDate(1 - lead);
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); return iso(d); });
  const ic = { meeting: "calendar", task: "bell", milestone: "flag" } as const;
  const href = (i: Item) => (i.kind === "milestone" && i.r.data?.project_ref ? `/projects/${i.r.data.project_ref}?tab=milestones` : `/${i.r.section.replace(".", "/")}?r=${i.r.id}`);
  const agenda = items.filter((i) => i.date >= day).slice(0, 40);
  const overdue = items.filter((i) => i.date < today && i.kind !== "meeting");
  const wk = [L("Mon", "Пн", "Пн", "إث"), L("Tue", "Вт", "Вт", "ث"), L("Wed", "Ср", "Ср", "أر"), L("Thu", "Чт", "Чт", "خ"), L("Fri", "Пт", "Пт", "ج"), L("Sat", "Сб", "Сб", "س"), L("Sun", "Вс", "Нд", "أح")];
  const row = (i: Item) => <Link key={i.kind + i.r.id} href={href(i)} className={`hub-row cal-${i.kind}`}><span className="dic"><Icon n={ic[i.kind]} /></span><span style={{ minWidth: 0, flex: 1 }}><b>{i.r.title}</b><small>{i.date}{i.time ? ` · ${i.time}` : ""}{i.kind === "task" && i.r.data?.project_ref_title ? ` · ${i.r.data.project_ref_title}` : ""}{i.kind === "meeting" && i.r.data?.place ? ` · ${i.r.data.place}` : ""}</small></span></Link>;
  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#7C5CFF" }}>
    <div className="toolbar">
      {access.write.has("company.meetings") && <Link className="btn primary" href={`/company/meetings?new=1&date=${day}`}><Icon n="plus" />{T(L("Create meeting", "Создать встречу", "Створити зустріч", "إنشاء اجتماع"))}</Link>}
      <div className="seg"><button className={mine ? "on" : ""} onClick={() => setMine(true)}>{T(L("Mine", "Мои", "Мої", "خاصتي"))}</button><button className={!mine ? "on" : ""} onClick={() => setMine(false)}>{T(L("Everyone", "Все", "Усі", "الجميع"))}</button></div>
      <span style={{ flex: 1 }} /><Link className="btn ghost sm" href="/me"><Icon n="link" />{T(L("Show in my phone's calendar", "Показать в календаре телефона", "Показати в календарі телефона", "اعرض في تقويم هاتفي"))}</Link></div>
    <div className="cal-grid2">
      <section className="card"><div className="card-h toolbar">
        <button className="iconbtn" aria-label={T(L("Previous month", "Предыдущий месяц", "Попередній місяць", "الشهر السابق"))} onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}><Icon n="back" /></button>
        <h2 style={{ flex: 1, textAlign: "center" }}>{month.toLocaleDateString(lang === "en" ? "en-US" : lang, { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
        <button className="iconbtn" aria-label={T(L("Next month", "Следующий месяц", "Наступний місяць", "الشهر التالي"))} onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}><Icon n="chev" /></button></div>
        <div className="month" role="grid">{wk.map((d, i) => <div key={i} className="mh">{T(d)}</div>)}
          {cells.map((c) => { const list = byDay.get(c) || []; return <button key={c} role="gridcell" className={`md-cell ${c.slice(0, 7) === iso(month).slice(0, 7) ? "" : "out"} ${c === today ? "today" : ""} ${c === day ? "sel" : ""}`} onClick={() => setDay(c)} aria-label={`${c}: ${list.length}`}>
            <span className="d">{+c.slice(8)}</span><span className="dots">{list.slice(0, 4).map((i) => <i key={i.kind + i.r.id} className={`dot-${i.kind}`} />)}</span></button>; })}</div>
        <div className="cal-legend faint"><span><i className="dot-meeting" /> {T(L("Meeting", "Встреча", "Зустріч", "اجتماع"))}</span><span><i className="dot-task" /> {T(L("Task deadline", "Срок задачи", "Термін задачі", "موعد مهمة"))}</span><span><i className="dot-milestone" /> {T(L("Milestone", "Веха", "Віха", "مرحلة"))}</span></div>
      </section>
      <section className="card"><div className="card-h"><h2><Icon n="calendar" />{day === today ? T(L("From today", "С сегодняшнего дня", "Від сьогодні", "من اليوم")) : `${T(L("From", "С", "З", "من"))} ${day}`}</h2></div>
        <div className="feed" style={{ padding: "0 8px 8px" }}>{w.loading ? <div className="empty">…</div> : agenda.length ? agenda.map(row) : <div className="empty">{T(L("Nothing planned.", "Ничего не запланировано.", "Нічого не заплановано.", "لا شيء مخطط."))}</div>}</div></section>
    </div>
    {overdue.length > 0 && <section className="card"><div className="card-h"><h2><Icon n="alert" />{T(L("Past their date", "Срок прошёл", "Термін минув", "تجاوزت موعدها"))}</h2><span className="chip c-bad mono" style={{ marginInlineStart: "auto" }}>{overdue.length}</span></div>
      <div className="feed" style={{ padding: "0 8px 8px" }}>{overdue.slice(0, 20).map(row)}</div></section>}
  </div>;
}
