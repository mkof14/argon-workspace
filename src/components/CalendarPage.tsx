"use client";
// CALENDAR: one view of what is dated in Workspace — meetings (with repeats), project milestones, my task deadlines,
// document review and expiry dates, and approvals waiting for me. Day, week, month and agenda. Items come from the
// database (calendar_items), each only if the person may open its source; nothing is copied into a separate calendar.
// Personal calendars (Google, Outlook, Apple) can subscribe from My profile; Google Calendar sync is two-way.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type CalItem } from "@/lib/store";
import { todayIso } from "@/lib/work";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type View = "day" | "week" | "month" | "agenda";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const add = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monday = (s: string) => { const d = new Date(s + "T00:00:00Z"); return add(s, -((d.getUTCDay() + 6) % 7)); };
const KIND: Record<string, { icon: string; label: T4 }> = {
  meeting: { icon: "calendar", label: L("Meeting", "Встреча", "Зустріч", "اجتماع") }, task: { icon: "bell", label: L("Task deadline", "Срок задачи", "Термін задачі", "موعد مهمة") },
  milestone: { icon: "flag", label: L("Milestone", "Веха", "Віха", "مرحلة") }, review: { icon: "eye", label: L("Document review", "Проверка документа", "Перевірка документа", "مراجعة مستند") },
  expiry: { icon: "alert", label: L("Document expires", "Истекает документ", "Спливає документ", "انتهاء مستند") }, approval: { icon: "check", label: L("Approval due", "Срок согласования", "Термін погодження", "موعد الموافقة") },
};

export default function CalendarPage() {
  const { lang, access, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang); const today = todayIso();
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem("agron.cal.view") as View) || "month"; } catch { return "month"; } });
  const [scope, setScope] = useState<"mine" | "all">("mine"); const [day, setDay] = useState(today);
  const [items, setItems] = useState<CalItem[]>([]); const [busy, setBusy] = useState(true); const [err, setErr] = useState("");
  const [show, setShow] = useState<Record<string, boolean>>({});
  const range = useMemo(() => {
    if (view === "day") return [day, day];
    if (view === "week") { const m = monday(day); return [m, add(m, 6)]; }
    if (view === "agenda") return [day, add(day, 45)];
    const first = day.slice(0, 7) + "-01"; const s = monday(first); return [s, add(s, 41)];
  }, [view, day]);
  useEffect(() => { try { localStorage.setItem("agron.cal.view", view); } catch {} }, [view]);
  useEffect(() => { setBusy(true); setErr(""); store.calendarItems(range[0], range[1], scope).then(setItems).catch((e) => setErr(e.message || "Error")).finally(() => setBusy(false)); }, [range[0], range[1], scope, tick]); // eslint-disable-line
  const shown = items.filter((i) => show[i.kind] !== false);
  const byDay = useMemo(() => { const m = new Map<string, CalItem[]>(); for (const i of shown) m.set(i.day, [...(m.get(i.day) || []), i]); return m; }, [shown]); // eslint-disable-line
  const move = (n: number) => setDay(view === "day" ? add(day, n) : view === "week" ? add(day, 7 * n) : view === "agenda" ? add(day, 30 * n) : (() => { const d = new Date(day.slice(0, 7) + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); })());
  const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Date(s + "T00:00:00Z").toLocaleDateString(lang === "en" ? "en-US" : lang, { timeZone: "UTC", ...o });
  const title = view === "month" ? fmt(day, { month: "long", year: "numeric" }) : view === "week" ? `${fmt(range[0], { day: "numeric", month: "short" })} – ${fmt(range[1], { day: "numeric", month: "short", year: "numeric" })}` : view === "day" ? fmt(day, { weekday: "long", day: "numeric", month: "long" }) : `${fmt(range[0], { day: "numeric", month: "short" })} →`;
  const row = (i: CalItem) => <Link key={i.kind + i.record_id + i.day} href={i.link} className={`hub-row cal-${i.kind}`} data-cal={i.kind}><span className="dic"><Icon n={KIND[i.kind]?.icon || "calendar"} /></span>
    <span style={{ minWidth: 0, flex: 1 }}><b>{i.title}</b><small>{T(KIND[i.kind]?.label || KIND.meeting.label)} · {i.day}{i.at_time ? ` · ${i.at_time}${i.tz ? ` ${i.tz}` : ""}` : ""}{i.meta?.recurring ? ` · ${T(L("repeats", "повтор", "повтор", "متكرر"))}` : ""}</small></span>
    {i.meta?.meet_url && /^https:\/\//.test(i.meta.meet_url) && <a className="btn ghost xs" href={i.meta.meet_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><Icon n="video" /></a>}</Link>;
  const wk = [L("Mon", "Пн", "Пн", "إث"), L("Tue", "Вт", "Вт", "ث"), L("Wed", "Ср", "Ср", "أر"), L("Thu", "Чт", "Чт", "خ"), L("Fri", "Пт", "Пт", "ج"), L("Sat", "Сб", "Сб", "س"), L("Sun", "Вс", "Нд", "أح")];
  const cells = view === "month" ? Array.from({ length: 42 }, (_, i) => add(range[0], i)) : view === "week" ? Array.from({ length: 7 }, (_, i) => add(range[0], i)) : [];
  return <div className="cal-page" style={{ display: "grid", gap: 16, ["--dc" as any]: "#7C5CFF" }}>
    <div className="toolbar">
      {access.write.has("company.meetings") && <Link className="btn primary" href={`/company/meetings?new=1&date=${day}`}><Icon n="plus" />{T(L("Create meeting", "Создать встречу", "Створити зустріч", "إنشاء اجتماع"))}</Link>}
      <div className="seg" role="tablist">{(["day", "week", "month", "agenda"] as View[]).map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} data-calview={v} onClick={() => setView(v)}>{T({ day: L("Day", "День", "День", "يوم"), week: L("Week", "Неделя", "Тиждень", "أسبوع"), month: L("Month", "Месяц", "Місяць", "شهر"), agenda: L("Agenda", "Список", "Список", "جدول") }[v])}</button>)}</div>
      <div className="seg"><button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>{T(L("Mine", "Мои", "Мої", "خاصتي"))}</button><button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>{T(L("Everything I can see", "Всё доступное", "Усе доступне", "كل ما أراه"))}</button></div>
      <span style={{ flex: 1 }} /><Link className="btn ghost sm" href="/me"><Icon n="link" />{T(L("Show in my phone's calendar", "Показать в календаре телефона", "Показати в календарі телефона", "اعرض في تقويم هاتفي"))}</Link></div>
    <section className="card">
      <div className="card-h toolbar"><button className="iconbtn" aria-label={T(L("Earlier", "Раньше", "Раніше", "السابق"))} onClick={() => move(-1)}><Icon n="back" /></button>
        <h2 style={{ flex: 1, textAlign: "center" }}>{title}</h2><button className="btn ghost sm" onClick={() => setDay(today)}>{T(L("Today", "Сегодня", "Сьогодні", "اليوم"))}</button>
        <button className="iconbtn" aria-label={T(L("Later", "Позже", "Пізніше", "التالي"))} onClick={() => move(1)}><Icon n="chev" /></button></div>
      <div className="cal-legend faint">{Object.entries(KIND).map(([k, v]) => <label key={k} className="chk"><input type="checkbox" checked={show[k] !== false} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /><i className={`dot-${k}`} /> {T(v.label)}</label>)}</div>
      {err && <div className="empty">{err}</div>}
      {view === "month" && <div className="month" role="grid">{wk.map((d, i) => <div key={i} className="mh">{T(d)}</div>)}
        {cells.map((c) => { const list = byDay.get(c) || []; return <button key={c} role="gridcell" className={`md-cell ${c.slice(0, 7) === day.slice(0, 7) ? "" : "out"} ${c === today ? "today" : ""} ${c === day ? "sel" : ""}`} onClick={() => { setDay(c); }} onDoubleClick={() => { setDay(c); setView("day"); }} aria-label={`${c}: ${list.length}`}>
          <span className="d">{+c.slice(8)}</span><span className="dots">{list.slice(0, 5).map((i) => <i key={i.kind + i.record_id + i.day} className={`dot-${i.kind}`} />)}</span></button>; })}</div>}
      {view === "week" && <div className="week-grid">{cells.map((c, i) => <div key={c} className={`week-day ${c === today ? "today" : ""}`}><div className="wd-h"><b>{T(wk[i])}</b> {+c.slice(8)}</div>{(byDay.get(c) || []).map(row)}{!(byDay.get(c) || []).length && <div className="faint" style={{ fontSize: 12 }}>—</div>}</div>)}</div>}
      {(view === "day" || view === "agenda") && <div className="feed" style={{ padding: "0 8px 8px" }}>{busy ? <div className="empty">…</div> : shown.length ? (view === "agenda" ? [...byDay.entries()].map(([d, l]) => <div key={d}><div className="eyebrow" style={{ padding: "8px 8px 2px" }}>{fmt(d, { weekday: "short", day: "numeric", month: "short" })}</div>{l.map(row)}</div>) : shown.map(row)) : <div className="empty">{T(L("Nothing planned.", "Ничего не запланировано.", "Нічого не заплановано.", "لا شيء مخطط."))}</div>}</div>}
    </section>
    {view === "month" && <section className="card"><div className="card-h"><h2><Icon n="calendar" />{fmt(day, { weekday: "long", day: "numeric", month: "long" })}</h2></div>
      <div className="feed" style={{ padding: "0 8px 8px" }}>{(byDay.get(day) || []).length ? (byDay.get(day) || []).map(row) : <div className="empty">{T(L("Nothing on this day.", "В этот день ничего нет.", "Цього дня нічого немає.", "لا شيء في هذا اليوم."))}</div>}</div></section>}
  </div>;
}
