"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO, store, type Rec } from "@/lib/store";
import { salesStats } from "@/lib/salesstats";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const k$ = (v: number) => `$${v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "k" : Math.round(v)}`;
const REASON: Record<string, T4> = { Price: L("Price", "Цена", "Ціна", "السعر"), "Budget / timing": L("Budget / timing", "Бюджет / сроки", "Бюджет / строки", "الميزانية / التوقيت"), Competitor: L("Competitor", "Конкурент", "Конкурент", "منافس"), "Export / regulation": L("Export / regulation", "Экспорт / регулирование", "Експорт / регулювання", "التصدير / التنظيم"), "No decision": L("No decision", "Нет решения", "Немає рішення", "لا قرار"), "Requirements not met": L("Requirements not met", "Не подошли требования", "Не підійшли вимоги", "المتطلبات غير مستوفاة"), Other: L("Other", "Другое", "Інше", "أخرى"), "—": L("Not stated", "Не указана", "Не вказано", "غير محدد") };

/** Sales analytics: stage conversion, deal length, win rate, the quarter against the target, why deals are lost. */
export default function SalesStats() {
  const { lang, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [s, setS] = useState<ReturnType<typeof salesStats> | null>(null);
  useEffect(() => {
    (async () => {
      const [deals, hist, tg] = await Promise.all([store.list("sales.pipeline"), store.dealHistory().catch(() => []),
        DEMO ? Promise.resolve({ sales_target: 0 }) : fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "targets" }) }).then((r) => (r.ok ? r.json() : { sales_target: 0 })).catch(() => ({ sales_target: 0 }))]);
      setS(salesStats(deals.map((d) => ({ ...store.original(d), created_at: d.created_at, updated_at: d.updated_at }) as Rec) as any, hist, new Date().toISOString().slice(0, 10), Number(tg.sales_target) || 0));
    })().catch(() => setS(null));
  }, [tick]);
  if (!s) return null;
  const q = s.quarter; const top = Math.max(1, ...s.funnel.map((f) => f.n));
  const pct = q.target ? Math.min(100, Math.round((q.forecast / q.target) * 100)) : 0, pctWon = q.target ? Math.min(100, Math.round((q.won / q.target) * 100)) : 0;
  return <div className="card hub-card wide ss">
    <div className="card-h"><h2><Icon n="funnel" />{T(L("Sales analytics", "Аналитика продаж", "Аналітика продажів", "تحليلات المبيعات"))}</h2><Link href="/sales/pipeline" className="faint" style={{ marginInlineStart: "auto" }}>→</Link></div>
    <div className="card-b" style={{ display: "grid", gap: 16 }}>
      <div className="vs-grid">
        <div className="vs-t"><small className="faint">{T(L("Win rate (won ÷ closed)", "Доля побед (выиграно ÷ закрыто)", "Частка перемог (виграно ÷ закрито)", "نسبة الفوز"))}</small><b>{s.winRate === null ? "—" : `${s.winRate}%`}</b></div>
        <div className="vs-t"><small className="faint">{T(L("Deal length, median", "Длина сделки, медиана", "Тривалість угоди, медіана", "مدة الصفقة (الوسيط)"))}</small><b>{s.cycle ? `${s.cycle.median} ${T(L("d", "дн.", "дн.", "يوم"))}` : "—"}</b>{s.cycle && <small className="faint">{T(L("average", "среднее", "середнє", "المتوسط"))} {s.cycle.avg} · {s.cycle.n}</small>}</div>
        <div className="vs-t"><small className="faint">{q.label}: {T(L("forecast", "прогноз", "прогноз", "التوقع"))}</small><b>{k$(q.forecast)}</b><small className="faint">{T(L("won", "выиграно", "виграно", "رُبح"))} {k$(q.won)} + {T(L("weighted", "взвешенно", "зважено", "مرجّح"))} {k$(q.weighted)}</small></div>
        <div className="vs-t"><small className="faint">{T(L("Target", "План", "План", "الهدف"))}</small><b className={q.gap && q.gap > 0 ? "neg" : ""}>{q.target ? k$(q.target) : "—"}</b><small className="faint">{q.target ? (q.gap! > 0 ? `${T(L("short by", "не хватает", "бракує", "ينقص"))} ${k$(q.gap!)}` : T(L("covered", "покрыт", "покрито", "مُغطى"))) : T(L("set in System → Settings", "задаётся в «Система» → «Настройки»", "задається в «Система» → «Налаштування»", "يُضبط في النظام ← الإعدادات"))}</small></div>
      </div>
      {q.target > 0 && <div className="ss-goal" title={`${pctWon}% / ${pct}%`}><i className="won" style={{ width: `${pctWon}%` }} /><i className="fc" style={{ width: `${Math.max(0, pct - pctWon)}%` }} /></div>}
      <div className="ss-cols">
        <div><b>{T(L("Funnel: deals that reached each stage", "Воронка: сделки, дошедшие до этапа", "Воронка: угоди, що дійшли до етапу", "القمع: الصفقات التي بلغت كل مرحلة"))}</b>
          {s.funnel.map((f, i) => <div key={f.stage} className="ss-row"><span>{f.stage}</span><span className="ss-bar"><i style={{ width: `${(f.n / top) * 100}%` }} /></span><span className="mono">{f.n}</span>
            {i > 0 && <small className="faint ss-conv">{s.conv[i - 1].pct === null ? "—" : `${s.conv[i - 1].pct}%`}</small>}</div>)}</div>
        <div><b>{T(L("Why deals are lost", "Почему проигрываем", "Чому програємо", "لماذا نخسر الصفقات"))}</b>
          {s.lostReasons.length ? s.lostReasons.map((r) => <div key={r.k} className="ss-row"><span>{T(REASON[r.k] || L(r.k, r.k, r.k, r.k))}</span><span className="ss-bar lost"><i style={{ width: `${(r.n / Math.max(1, s.lostReasons[0].n)) * 100}%` }} /></span><span className="mono">{r.n}</span><small className="faint ss-conv">{k$(r.usd)}</small></div>) : <small className="faint">{T(L("No lost deals yet.", "Проигранных сделок пока нет.", "Програних угод поки немає.", "لا صفقات خاسرة بعد."))}</small>}
          {s.segments.length > 0 && <><b style={{ display: "block", marginTop: 12 }}>{T(L("Win rate by segment", "Доля побед по сегментам", "Частка перемог за сегментами", "نسبة الفوز حسب القطاع"))}</b>
            {s.segments.map((g) => <div key={g.k} className="ss-row"><span>{g.k}</span><span className="ss-bar"><i style={{ width: `${g.rate}%` }} /></span><span className="mono">{g.rate}%</span><small className="faint ss-conv">{g.won}/{g.n}</small></div>)}</>}
        </div>
      </div>
      {(q.noDate > 0 || s.lostNoReason > 0) && <small className="faint">{q.noDate > 0 && T(L(`${q.noDate} open deal(s) without an expected close date are not in the forecast. `, `Открытых сделок без даты закрытия: ${q.noDate} — они не попадают в прогноз. `, `Відкритих угод без дати закриття: ${q.noDate} — вони не потрапляють у прогноз. `, `صفقات مفتوحة دون تاريخ إغلاق: ${q.noDate} — لا تدخل في التوقع. `))}{s.lostNoReason > 0 && T(L(`${s.lostNoReason} lost deal(s) without a reason — fill “Why lost”.`, `Проигранных сделок без причины: ${s.lostNoReason} — заполните «Причина проигрыша».`, `Програних угод без причини: ${s.lostNoReason} — заповніть «Причину програшу».`, `صفقات خاسرة دون سبب: ${s.lostNoReason} — املأ «سبب الخسارة».`))}</small>}
    </div></div>;
}
