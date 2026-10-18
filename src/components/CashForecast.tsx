"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { cashForecast } from "@/lib/cashforecast";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const SECS = ["finance.invoices", "finance.expenses", "finance.metrics", "operations.procurement", "sales.pipeline"];
const k = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? Math.round(Math.abs(v) / 1e3) + "k" : Math.round(Math.abs(v))}`;

/** Finance overview: cash for the next 13 weeks — certain money, plus probable money from open deals. */
export default function CashForecast() {
  const { lang, access, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => { store.listMany(SECS.filter((s) => access.read.has(s))).then(setRecs).catch(() => setRecs([])); }, [tick, access]); // eslint-disable-line
  const f = useMemo(() => (recs ? cashForecast(recs, new Date().toISOString().slice(0, 10)) : null), [recs]);
  if (!f) return null;
  const W = 720, H = 220, P = { l: 52, r: 74, t: 14, b: 26 };
  const vals = f.weeks.flatMap((w) => [w.balance, w.withProbable]).concat(f.opening ?? 0, 0);
  const lo = Math.min(...vals), hi = Math.max(...vals) || 1; const span = hi - lo || 1;
  const x = (i: number) => P.l + (i / (f.weeks.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / span) * (H - P.t - P.b);
  const path = (key: "balance" | "withProbable") => f.weeks.map((w, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(w[key]).toFixed(1)}`).join(" ");
  const ticks = [lo, lo + span / 2, hi];
  const wk = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString(lang === "en" ? "en-US" : lang, { day: "numeric", month: "short", timeZone: "UTC" });
  const last = f.weeks[f.weeks.length - 1]; const h = hover != null ? f.weeks[hover] : null;
  return <div className="card hub-card wide cashf">
    <div className="card-h toolbar"><h2><Icon n="trend" />{T(L("Cash for the next 90 days", "Деньги на 90 дней вперёд", "Гроші на 90 днів уперед", "النقد للأيام الـ90 القادمة"))}</h2>
      <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setTable(!table)}>{table ? T(L("Chart", "График", "Графік", "رسم")) : T(L("Table", "Таблица", "Таблиця", "جدول"))}</button></div>
    <div className="card-b" style={{ display: "grid", gap: 12 }}>
      <div className="cashf-tiles">
        <div><small>{T(L("Cash today", "Деньги сегодня", "Гроші сьогодні", "النقد اليوم"))}</small><b>{f.opening == null ? "—" : k(f.opening)}</b></div>
        <div><small>{T(L("Coming in", "Поступит", "Надійде", "وارد"))}</small><b>{k(f.totals.in)}</b></div>
        <div><small>{T(L("Going out", "Уйдёт", "Піде", "صادر"))}</small><b>{k(f.totals.out)}</b></div>
        <div><small>{T(L("In 90 days", "Через 90 дней", "Через 90 днів", "بعد 90 يوماً"))}</small><b>{k(last.balance)}</b></div>
        <div className={f.gap ? "bad" : "ok"}><small>{f.gap ? T(L("Cash gap from", "Кассовый разрыв с", "Касовий розрив з", "عجز نقدي من")) : T(L("Lowest balance", "Минимальный остаток", "Мінімальний залишок", "أدنى رصيد"))}</small>
          <b>{f.gap ? <><Icon n="alert" className="lockico" /> {wk(f.gap.start)} · {k(f.gap.balance)}</> : k(f.low.balance)}</b></div>
      </div>
      {f.opening == null && <div className="hint">{T(L("Add cash on hand in Finance → Metrics (field “Cash”) to start from the real balance; now the forecast starts from 0.", "Укажите остаток денег в «Финансы» → «Показатели» (поле «Деньги»), чтобы прогноз начинался с реального остатка; сейчас он начинается с 0.", "Вкажіть залишок грошей у «Фінанси» → «Показники» (поле «Гроші»), щоб прогноз починався з реального залишку; зараз він починається з 0.", "أضف النقد المتوفر في المالية ← المقاييس (حقل «النقد») ليبدأ التوقع من الرصيد الفعلي؛ يبدأ الآن من 0."))} <Link href="/finance/metrics">→</Link></div>}
      {!table ? <div className="cashf-chart" onMouseLeave={() => setHover(null)}>
        <div className="legend"><span><i style={{ background: "var(--cf-a)" }} />{T(L("Certain money", "Точные деньги", "Точні гроші", "نقد مؤكد"))}</span><span><i className="dash" style={{ borderColor: "var(--cf-b)" }} />{T(L("With probable deals", "С учётом вероятных сделок", "З урахуванням імовірних угод", "مع الصفقات المحتملة"))}</span></div>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={T(L("Cash balance by week", "Остаток денег по неделям", "Залишок грошей за тижнями", "الرصيد النقدي حسب الأسبوع"))}>
          {ticks.map((v, i) => <g key={i}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="grid" /><text x={P.l - 6} y={y(v) + 4} textAnchor="end" className="ax">{k(v)}</text></g>)}
          {lo < 0 && <><line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="zero" /><text x={P.l - 6} y={y(0) + 4} textAnchor="end" className="ax">0</text></>}
          {f.weeks.map((w, i) => i % 3 === 0 && <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="ax">{wk(w.start)}</text>)}
          <path d={path("withProbable")} className="lp" /><path d={path("balance")} className="la" />
          <text x={x(f.weeks.length - 1) + 6} y={y(last.withProbable) + 4} className="dl b">{k(last.withProbable)}</text>
          <text x={x(f.weeks.length - 1) + 6} y={y(last.balance) + (Math.abs(y(last.balance) - y(last.withProbable)) < 14 ? 16 : 4)} className="dl a">{k(last.balance)}</text>
          {hover != null && <><line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="cross" /><circle cx={x(hover)} cy={y(f.weeks[hover].balance)} r="5" className="pa" /><circle cx={x(hover)} cy={y(f.weeks[hover].withProbable)} r="5" className="pb" /></>}
          {f.weeks.map((w, i) => <rect key={i} x={x(i) - (W - P.l - P.r) / (f.weeks.length - 1) / 2} y={0} width={(W - P.l - P.r) / (f.weeks.length - 1)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />)}
        </svg>
        {h && <div className="tip" style={{ insetInlineStart: `${(x(hover!) / W) * 100}%` }}><b>{T(L("Week of", "Неделя с", "Тиждень з", "أسبوع"))} {wk(h.start)}</b>
          <span>{T(L("In", "Приход", "Надходження", "وارد"))}: {k(h.in)} · {T(L("Out", "Расход", "Витрати", "صادر"))}: {k(h.out)}</span>
          <span>{T(L("Balance", "Остаток", "Залишок", "الرصيد"))}: <b>{k(h.balance)}</b> · {T(L("with deals", "со сделками", "з угодами", "مع الصفقات"))}: {k(h.withProbable)}</span></div>}
      </div> : <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("Week of", "Неделя с", "Тиждень з", "أسبوع"))}</th><th>{T(L("In", "Приход", "Надходження", "وارد"))}</th><th>{T(L("Out", "Расход", "Витрати", "صادر"))}</th><th>{T(L("Probable", "Вероятно", "Імовірно", "محتمل"))}</th><th>{T(L("Balance", "Остаток", "Залишок", "الرصيد"))}</th><th>{T(L("With deals", "Со сделками", "З угодами", "مع الصفقات"))}</th></tr></thead>
        <tbody>{f.weeks.map((w) => <tr key={w.start} className={w.balance < 0 ? "neg" : ""}><td>{wk(w.start)}</td><td className="mono">{k(w.in)}</td><td className="mono">{k(w.out)}</td><td className="mono">{k(w.probable)}</td><td className="mono"><b>{k(w.balance)}</b></td><td className="mono">{k(w.withProbable)}</td></tr>)}</tbody></table></div>}
      <small className="faint">{T(L("Certain: unpaid invoices by due date (late ones in this week), approved expenses, ordered purchases by arrival date. Probable: open deals × chance by stage — 30% advance at the expected close, 40% about 12 weeks later. Amounts in USD at approximate rates.", "Точные: неоплаченные счета по сроку (просроченные — в этой неделе), одобренные расходы, заказанные закупки по дате прихода. Вероятные: открытые сделки × вероятность по стадии — 30% аванс при ожидаемом закрытии, 40% примерно через 12 недель. Суммы в USD по примерным курсам.", "Точні: неоплачені рахунки за строком (прострочені — на цьому тижні), схвалені витрати, замовлені закупівлі за датою надходження. Імовірні: відкриті угоди × імовірність за стадією — 30% аванс під час очікуваного закриття, 40% приблизно через 12 тижнів. Суми в USD за приблизними курсами.", "المؤكد: الفواتير غير المدفوعة حسب الاستحقاق (المتأخرة في هذا الأسبوع)، والمصروفات المعتمدة، والمشتريات المطلوبة حسب تاريخ الوصول. المحتمل: الصفقات المفتوحة × احتمال المرحلة — دفعة 30٪ عند الإغلاق المتوقع و40٪ بعد نحو 12 أسبوعاً. المبالغ بالدولار بأسعار تقريبية."))}</small>
    </div>
  </div>;
}
