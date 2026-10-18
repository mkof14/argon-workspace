"use client";
import { useMemo, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import type { Rec } from "@/lib/store";
import { cashForecast } from "@/lib/cashforecast";
import { applyScenario, finishDates, type Change } from "@/lib/whatif";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Kind = Change["kind"];
const KINDS: Record<Kind, T4> = {
  delay: L("Project slips by … days", "Проект сдвигается на … дней", "Проєкт зсувається на … днів", "يتأخر المشروع … يوماً"),
  pay: L("Client pays … days later", "Клиент платит на … дней позже", "Клієнт платить на … днів пізніше", "يدفع العميل متأخراً … يوماً"),
  deal: L("Deal closes on another date", "Сделка закрывается в другую дату", "Угода закривається в іншу дату", "تُغلق الصفقة في تاريخ آخر"),
  po: L("Purchase is paid on another date", "Закупка оплачивается в другую дату", "Закупівля оплачується в іншу дату", "تُدفع المشتريات في تاريخ آخر"),
};
const k$ = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? Math.round(Math.abs(v) / 1e3) + "k" : Math.round(Math.abs(v))}`;

/** What if: plan changes before deciding — see the cash for 13 weeks and the project finish dates, now and with the change. */
export default function WhatIf({ all }: { all: Rec[] }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const today = new Date().toISOString().slice(0, 10);
  const [changes, setChanges] = useState<Change[]>([]);
  const [draft, setDraft] = useState<{ kind: Kind; id: string; v: string }>({ kind: "delay", id: "", v: "30" });
  const opts: Record<Kind, Rec[]> = useMemo(() => ({
    delay: all.filter((r) => r.section === "sales.pipeline" && r.status === "Won" && all.some((x) => x.data?.project === r.id)),
    pay: all.filter((r) => r.section === "finance.invoices" && r.data?.direction !== "Payable" && r.status !== "Paid" && r.data?.due),
    deal: all.filter((r) => r.section === "sales.pipeline" && ["Lead", "Qualified", "Proposal", "Negotiation"].includes(r.status || "")),
    po: all.filter((r) => r.section === "operations.procurement" && ["Approved", "Ordered"].includes(r.status || "")),
  }), [all]);
  const base = useMemo(() => cashForecast(all as any, today), [all, today]);
  const scen = useMemo(() => applyScenario(all as any, changes) as any[], [all, changes]);
  const after = useMemo(() => cashForecast(scen, today), [scen, today]);
  const fin0 = useMemo(() => finishDates(all as any), [all]), fin1 = useMemo(() => finishDates(scen), [scen]);
  const moved = Object.keys(fin1).filter((p) => fin0[p] && fin0[p] !== fin1[p]);
  const name = (id: string) => all.find((r) => r.id === id)?.title || id;
  const add = () => {
    if (!draft.id) return;
    const c: Change = draft.kind === "delay" || draft.kind === "pay" ? { kind: draft.kind, id: draft.id, days: Number(draft.v) || 0 } : { kind: draft.kind, id: draft.id, to: draft.v };
    setChanges([...changes.filter((x) => !(x.kind === c.kind && x.id === c.id)), c]); setDraft({ ...draft, id: "" });
  };
  const describe = (c: Change) => c.kind === "delay" ? `${name(c.id)}: +${c.days} ${T(L("days", "дн.", "дн.", "يوم"))}` : c.kind === "pay" ? `${name(c.id)}: ${T(L("paid", "оплата", "оплата", "الدفع"))} +${c.days} ${T(L("days", "дн.", "дн.", "يوم"))}` : `${name(c.id)} → ${c.to}`;

  // Chart: balance of certain money, now (dashed) and with the changes (solid)
  const W = 720, H = 200, P = { l: 52, r: 16, t: 12, b: 24 };
  const vals = [...base.weeks.map((w) => w.balance), ...after.weeks.map((w) => w.balance), 0];
  const lo = Math.min(...vals), hi = Math.max(...vals) || 1, span = hi - lo || 1;
  const x = (i: number) => P.l + (i / Math.max(1, base.weeks.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / span) * (H - P.t - P.b);
  const path = (ws: { balance: number }[]) => ws.map((w, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(w.balance).toFixed(1)}`).join(" ");
  const wk = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString(lang === "en" ? "en-US" : lang, { day: "numeric", month: "short", timeZone: "UTC" });
  const gapText = (f: typeof base) => f.gap ? `${T(L("from", "с", "з", "من"))} ${wk(f.gap.start)}` : T(L("none", "нет", "немає", "لا يوجد"));
  const tile = (l: T4, a: string, b: string, worse: boolean) => <div className="vs-t"><small className="faint">{T(l)}</small><b className={changes.length && worse ? "neg" : ""}>{changes.length ? b : a}</b>{changes.length > 0 && a !== b && <small className="faint">{T(L("now", "сейчас", "зараз", "الآن"))} {a}</small>}</div>;

  return <div style={{ display: "grid", gap: 14 }}>
    <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
      <b>{T(L("Add a change", "Добавьте изменение", "Додайте зміну", "أضف تغييراً"))}</b>
      <div className="fgrid">
        <div className="field"><label>{T(L("What changes", "Что меняется", "Що змінюється", "ما الذي يتغير"))}</label><select className="input" value={draft.kind} onChange={(e) => { const k = e.target.value as Kind; setDraft({ kind: k, id: "", v: k === "delay" || k === "pay" ? "30" : today }); }}>{(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{T(KINDS[k])}</option>)}</select></div>
        <div className="field"><label>{T(L("Which one", "Что именно", "Що саме", "أيّها"))}</label><select className="input" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })}><option value="">—</option>{opts[draft.kind].map((r) => <option key={r.id} value={r.id}>{r.title}{r.data?.amount || r.data?.value ? ` · ${k$(Number(r.data.amount || r.data.value))}` : ""}</option>)}</select></div>
        <div className="field"><label>{draft.kind === "delay" || draft.kind === "pay" ? T(L("Days", "Дней", "Днів", "أيام")) : T(L("New date", "Новая дата", "Нова дата", "تاريخ جديد"))}</label>
          <input className="input" type={draft.kind === "delay" || draft.kind === "pay" ? "number" : "date"} value={draft.v} onChange={(e) => setDraft({ ...draft, v: e.target.value })} /></div>
      </div>
      <div className="toolbar"><button className="btn primary sm" disabled={!draft.id} onClick={add}><Icon n="check" />{T(L("Add to the scenario", "Добавить в сценарий", "Додати до сценарію", "أضف إلى السيناريو"))}</button>
        {changes.length > 0 && <button className="btn ghost sm" onClick={() => setChanges([])}>{T(L("Clear", "Очистить", "Очистити", "مسح"))}</button>}</div>
      {changes.length > 0 && <div className="toolbar" style={{ gap: 6 }}>{changes.map((c) => <button key={c.kind + c.id} className="chip" style={{ cursor: "pointer" }} title="×" onClick={() => setChanges(changes.filter((x) => x !== c))}>{describe(c)} ×</button>)}</div>}
    </div>
    <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
      <b>{T(L("Cash for 13 weeks (certain money)", "Деньги на 13 недель (точные)", "Гроші на 13 тижнів (точні)", "النقد لـ13 أسبوعاً (المؤكد)"))}</b>
      <div className="vs-grid">
        {tile(L("Lowest balance", "Минимальный остаток", "Мінімальний залишок", "أدنى رصيد"), k$(base.low.balance), k$(after.low.balance), after.low.balance < base.low.balance)}
        {tile(L("Cash gap", "Кассовый разрыв", "Касовий розрив", "عجز نقدي"), gapText(base), gapText(after), !!after.gap && (!base.gap || after.gap.week < base.gap.week))}
        {tile(L("In 13 weeks", "Через 13 недель", "Через 13 тижнів", "بعد 13 أسبوعاً"), k$(base.weeks[base.weeks.length - 1].balance), k$(after.weeks[after.weeks.length - 1].balance), after.weeks[after.weeks.length - 1].balance < base.weeks[base.weeks.length - 1].balance)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="wi-chart" role="img" aria-label={T(L("Balance by week, now and with the changes", "Остаток по неделям: сейчас и с изменениями", "Залишок по тижнях: зараз і зі змінами", "الرصيد أسبوعياً: الآن ومع التغييرات"))}>
        {[lo, (lo + hi) / 2, hi].map((v, i) => <g key={i}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="wi-grid" /><text x={P.l - 6} y={y(v) + 4} textAnchor="end" className="wi-ax">{k$(v)}</text></g>)}
        {lo < 0 && <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="wi-zero" />}
        {base.weeks.map((w, i) => i % 3 === 0 && <text key={w.start} x={x(i)} y={H - 6} textAnchor="middle" className="wi-ax">{wk(w.start)}</text>)}
        <path d={path(base.weeks)} className="wi-base" />
        {changes.length > 0 && <path d={path(after.weeks)} className="wi-scen" />}
      </svg>
      <div className="toolbar" style={{ gap: 14 }}><span className="wi-key base">{T(L("now", "сейчас", "зараз", "الآن"))}</span>{changes.length > 0 && <span className="wi-key scen">{T(L("with the changes", "с изменениями", "зі змінами", "مع التغييرات"))}</span>}</div>
    </div>
    {moved.length > 0 && <div className="card" style={{ padding: 14, display: "grid", gap: 6 }}>
      <b>{T(L("Project finish dates", "Финиш проектов", "Фініш проєктів", "تواريخ انتهاء المشاريع"))}</b>
      {moved.map((p) => <span key={p}>{name(p)}: {fin0[p]} → <b>{fin1[p]}</b></span>)}</div>}
    <small className="faint">{T(L("Nothing is saved: this is a sandbox. Certain money only (invoices, approved expenses and purchases, milestone invoices); a slipping project moves its unfinished steps and the milestone invoices that are not ready yet. To apply a change for real, move the step on the project timeline or change the date in the record.", "Ничего не сохраняется — это песочница. Учитываются только точные деньги (счета, одобренные расходы и закупки, счета по этапам); сдвиг проекта переносит незавершённые шаги и ещё не готовые счета по этапам. Чтобы применить изменение по-настоящему, перенесите шаг на таймлайне проекта или поменяйте дату в записи.", "Нічого не зберігається — це пісочниця. Враховуються лише точні гроші (рахунки, схвалені витрати й закупівлі, рахунки за етапами); зсув проєкту переносить незавершені кроки й ще не готові рахунки за етапами. Щоб застосувати зміну насправді, перенесіть крок на таймлайні проєкту або змініть дату в записі.", "لا يُحفظ شيء: هذه مساحة تجربة. يُحتسب النقد المؤكد فقط (الفواتير والمصروفات والمشتريات المعتمدة وفواتير المراحل)؛ وتأخير المشروع ينقل خطواته غير المنجزة وفواتير المراحل غير الجاهزة. لتطبيق التغيير فعلياً انقل الخطوة على مخطط المشروع أو غيّر التاريخ في السجل."))}</small>
  </div>;
}
