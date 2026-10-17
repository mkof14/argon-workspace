"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { t, type Lang } from "@/lib/i18n";
import type { Rec } from "@/lib/store";

type T2 = { en: string; ru: string; uk?: string; ar?: string };
const L = (en: string, ru: string, uk: string, ar: string): T2 => ({ en, ru, uk, ar });
const tt = (x: T2, lang: Lang) => (x as any)[lang] || x.en;

// Which dates go on the calendar, per section, and what each one means
const KINDS: { sec: string; key: string; c: string; what: T2 }[] = [
  { sec: "marketing.social", key: "publish", c: "#E0458B", what: L("Post", "Пост", "Допис", "منشور") },
  { sec: "marketing.press", key: "deadline", c: "#8B5CF6", what: L("Editor deadline", "Срок редакции", "Термін редакції", "موعد المحرر") },
  { sec: "marketing.press", key: "publish", c: "#8B5CF6", what: L("Publication", "Публикация", "Публікація", "نشر") },
  { sec: "marketing.interviews", key: "session", c: "#0FA3A3", what: L("Recording", "Запись", "Запис", "تسجيل") },
  { sec: "marketing.interviews", key: "publish", c: "#0FA3A3", what: L("Episode out", "Выход выпуска", "Вихід випуску", "نشر الحلقة") },
  { sec: "marketing.video", key: "due", c: "#E5484D", what: L("Final cut", "Финальная версия", "Фінальна версія", "النسخة النهائية") },
  { sec: "marketing.video", key: "publish", c: "#E5484D", what: L("Video release", "Выход видео", "Вихід відео", "إطلاق الفيديو") },
  { sec: "marketing.events", key: "starts", c: "#F26B1D", what: L("Event", "Событие", "Подія", "فعالية") },
  { sec: "marketing.events", key: "book_by", c: "#F26B1D", what: L("Booking deadline", "Срок бронирования", "Термін бронювання", "موعد الحجز") },
  { sec: "marketing.campaigns", key: "start_date", c: "#2F7DF6", what: L("Campaign start", "Старт кампании", "Старт кампанії", "بدء الحملة") },
];
const LEGEND: { sec: string; c: string; l: T2 }[] = [
  { sec: "marketing.social", c: "#E0458B", l: L("Social", "Соцсети", "Соцмережі", "التواصل") },
  { sec: "marketing.press", c: "#8B5CF6", l: L("Press", "СМИ", "ЗМІ", "الصحافة") },
  { sec: "marketing.interviews", c: "#0FA3A3", l: L("Interviews", "Интервью", "Інтерв'ю", "المقابلات") },
  { sec: "marketing.video", c: "#E5484D", l: L("Video", "Видео", "Відео", "الفيديو") },
  { sec: "marketing.events", c: "#F26B1D", l: L("Events", "Выставки", "Виставки", "الفعاليات") },
  { sec: "marketing.campaigns", c: "#2F7DF6", l: L("Ads", "Реклама", "Реклама", "الإعلانات") },
];
const OFF = /^(declined|cancelled|archived|dropped)$/i;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const href = (r: Rec) => `/${r.section.replace(".", "/")}?r=${r.id}`;

/** Month view of everything marketing has planned: posts, publications, recordings, videos, events, campaigns. */
export default function MktCalendar({ recs, lang }: { recs: Rec[]; lang: Lang }) {
  const [m, setM] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [only, setOnly] = useState<string>("");
  const byDay = useMemo(() => {
    const out: Record<string, { r: Rec; c: string; what: T2; done: boolean }[]> = {};
    for (const k of KINDS) for (const r of recs) {
      if (r.section !== k.sec || (only && only !== k.sec) || OFF.test(r.status || "")) continue;
      const v = String(r.data?.[k.key] || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
      (out[v] ||= []).push({ r, c: k.c, what: k.what, done: /^(published|done|completed|analyzed|recorded)$/i.test(r.status || "") });
    }
    return out;
  }, [recs, only]);

  const start = new Date(m); const lead = (start.getDay() + 6) % 7; start.setDate(1 - lead); // weeks start on Monday
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const weeks = cells[35].getMonth() !== m.getMonth() ? cells.slice(0, 35) : cells;
  const today = ymd(new Date());
  const loc = lang === "en" ? "en-US" : lang === "ar" ? "ar" : lang === "uk" ? "uk-UA" : "ru-RU";
  const dows = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(loc, { weekday: "short" }));
  const monthItems = Object.entries(byDay).filter(([d]) => d.slice(0, 7) === ymd(m).slice(0, 7)).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="card hub-card wide mcal">
      <div className="card-h"><h2><Icon n="calendar" />{t("mk_calendar", lang)}</h2>
        <div className="mcal-nav">
          <button className="iconbtn" aria-label={tt(L("Previous month", "Предыдущий месяц", "Попередній місяць", "الشهر السابق"), lang)} onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))}><Icon n="chev" className="flip" /></button>
          <b>{m.toLocaleDateString(loc, { month: "long", year: "numeric" })}</b>
          <button className="iconbtn" aria-label={tt(L("Next month", "Следующий месяц", "Наступний місяць", "الشهر التالي"), lang)} onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))}><Icon n="chev" /></button>
          <button className="btn ghost sm" onClick={() => { const d = new Date(); setM(new Date(d.getFullYear(), d.getMonth(), 1)); }}>{t("today", lang)}</button>
        </div></div>
      <div className="mcal-legend">{LEGEND.map((x) => <button key={x.sec} className={only === x.sec ? "on" : ""} onClick={() => setOnly(only === x.sec ? "" : x.sec)}><i style={{ background: x.c }} />{tt(x.l, lang)}</button>)}</div>
      <div className="mcal-grid" role="grid">
        {dows.map((d) => <div key={d} className="mcal-dow">{d}</div>)}
        {weeks.map((d) => { const k = ymd(d); const items = byDay[k] || []; return (
          <div key={k} className={`mcal-day ${d.getMonth() !== m.getMonth() ? "out" : ""} ${k === today ? "today" : ""}`}>
            <span className="mcal-n">{d.getDate()}</span>
            {items.slice(0, 3).map((x, i) => <Link key={i} href={href(x.r)} className={`mcal-it ${x.done ? "done" : ""}`} style={{ ["--ic" as any]: x.c }} title={`${tt(x.what, lang)} · ${x.r.title} · ${x.r.status}`}>{x.r.title}</Link>)}
            {items.length > 3 && <span className="mcal-more">+{items.length - 3}</span>}
          </div>); })}
      </div>
      <div className="mcal-list">{monthItems.length ? monthItems.map(([d, items]) => <div key={d} className="mcal-ld"><b className="mono">{d.slice(8)}</b><div>{items.map((x, i) => <Link key={i} href={href(x.r)} className="mcal-li" style={{ ["--ic" as any]: x.c }}><i />{x.r.title}<small>{tt(x.what, lang)} · {x.r.status}</small></Link>)}</div></div>)
        : <div className="empty" style={{ padding: 14 }}>{t("empty", lang)}</div>}</div>
    </div>
  );
}
