"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, SECTIONS } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { portfolio, type Health, type Reason } from "@/lib/portfolio";
import { LIMIT, workload } from "@/lib/workload";
import { projectMoney } from "@/lib/margin";
import { shortages } from "@/lib/parts";
import { shipMissing } from "@/lib/shipgate";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const HEALTH: Record<Health, { cls: string; t: T4 }> = {
  red: { cls: "c-bad", t: L("At risk", "Под угрозой", "Під загрозою", "معرض للخطر") },
  amber: { cls: "c-warn", t: L("Watch", "Внимание", "Увага", "انتباه") },
  green: { cls: "c-ok", t: L("On track", "По плану", "За планом", "وفق الخطة") },
};
const REASON: Record<Reason["k"], (n: any) => T4> = {
  late: (n) => L(`${n} step(s) late`, `просрочено шагов: ${n}`, `прострочено кроків: ${n}`, `خطوات متأخرة: ${n}`),
  overdue: (n) => L(`client invoice ${n} d overdue`, `счёт клиента просрочен на ${n} дн.`, `рахунок клієнта прострочено на ${n} дн.`, `فاتورة العميل متأخرة ${n} يوماً`),
  margin: (n) => L(`margin ${n}% under target`, `маржа ${n}% ниже цели`, `маржа ${n}% нижче цілі`, `الهامش ${n}% أقل من الهدف`),
  cost: () => L("costs above plan", "затраты выше плана", "витрати вищі за план", "التكاليف أعلى من الخطة"),
  compliance: () => L("shipping soon, compliance missing", "скоро отгрузка, нет комплаенса", "скоро відвантаження, немає комплаєнсу", "الشحن قريب والامتثال ناقص"),
  parts: () => L("parts short", "не хватает комплектующих", "бракує комплектуючих", "قطع ناقصة"),
};

/** Projects: the portfolio of won deals with a traffic light, and the team's workload by week. */
export default function Projects() {
  const { lang, access, people } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [tab, setTab] = useState<"pf" | "wl">("pf"); const [all, setAll] = useState<Rec[] | null>(null); const [only, setOnly] = useState<Health | "">(""); const [open, setOpen] = useState<{ who: string; i: number } | null>(null);
  useEffect(() => { const q = new URLSearchParams(window.location.search).get("tab"); if (q === "wl") setTab("wl");
    const secs = SECTIONS.map((s) => s.id).filter((id: string) => access.read.has(id) && !id.endsWith(".metrics"));
    store.listMany(secs).then((r) => setAll(r.map((x) => ({ ...store.original(x), controlled: x.controlled }) as Rec))).catch(() => setAll([])); }, []); // eslint-disable-line
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => all ? portfolio(all as any, today, { money: projectMoney as any, parts: shortages as any, ship: (b: any) => shipMissing("operations.builds", "Shipping", b.data, null, all as any) }) : [], [all, today]);
  const wl = useMemo(() => all ? workload(all as any, people, today) : null, [all, people, today]);
  const go = (k: "pf" | "wl") => { setTab(k); try { const u = new URL(window.location.href); u.searchParams.set("tab", k); window.history.replaceState(window.history.state, "", u.toString()); } catch {} };
  const fmt = (d: string) => d ? new Date(d + "T00:00:00Z").toLocaleDateString(lang === "en" ? "en-US" : lang, { day: "numeric", month: "short", timeZone: "UTC" }) : "—";
  const count = (h: Health) => rows.filter((r) => r.health === h).length;
  const href = (r: { section: string; id: string }) => `/${r.section.replace(".", "/")}?r=${r.id}`;

  return <div style={{ display: "grid", gap: 16 }}>
    <div className="tabs card" role="tablist" style={{ ["--dc" as any]: "#0E9F6E" }}>
      <button role="tab" aria-selected={tab === "pf"} className={tab === "pf" ? "on" : ""} onClick={() => go("pf")}><Icon n="layers" />{T(L("Portfolio", "Портфель", "Портфель", "المحفظة"))}</button>
      <button role="tab" aria-selected={tab === "wl"} className={tab === "wl" ? "on" : ""} onClick={() => go("wl")}><Icon n="users" />{T(L("Team workload", "Загрузка команды", "Завантаження команди", "عبء عمل الفريق"))}</button></div>
    {!all ? <div className="card" style={{ padding: 24 }}>…</div> : tab === "pf" ? <>
      <div className="toolbar">{(["red", "amber", "green"] as Health[]).map((h) => <button key={h} className={`chip ${HEALTH[h].cls} ${only === h ? "on" : ""}`} style={{ cursor: "pointer", outline: only === h ? "2px solid currentColor" : "none" }} onClick={() => setOnly(only === h ? "" : h)}>{T(HEALTH[h].t)} · {count(h)}</button>)}</div>
      {!rows.length ? <div className="card" style={{ padding: 24 }}><small className="faint">{T(L("No projects yet. Unfold a project in a won deal (Project plan) and it appears here.", "Проектов пока нет. Разверните проект в выигранной сделке («План проекта») — он появится здесь.", "Проєктів поки немає. Розгорніть проєкт у виграній угоді («План проєкту») — він з'явиться тут.", "لا مشاريع بعد. أنشئ مشروعاً في صفقة رابحة (خطة المشروع) وسيظهر هنا."))}</small></div>
        : <div className="pf">{rows.filter((r) => !only || r.health === only).map((r) => <div key={r.deal.id} className={`card pf-row h-${r.health}`}>
          <div className="pf-h"><span className={`chip ${HEALTH[r.health].cls}`}>{T(HEALTH[r.health].t)}</span><Link href={href(r.deal)} className="pf-t">{r.deal.title}</Link>{r.deal.data?.client && <small className="faint">{r.deal.data.client}</small>}</div>
          <div className="pf-bar" title={`${r.done}/${r.total}`}><i style={{ width: `${r.total ? Math.round((r.done / r.total) * 100) : 0}%` }} /></div>
          <div className="pf-g">
            <div><small className="faint">{T(L("Next step", "Следующий шаг", "Наступний крок", "الخطوة التالية"))}</small>{r.next ? <Link href={href(r.next)}>{fmt(r.nextDate)} · {r.next.title}</Link> : <span>—</span>}</div>
            <div><small className="faint">{T(L("Shipping / finish", "Отгрузка / финиш", "Відвантаження / фініш", "الشحن / الانتهاء"))}</small><span>{fmt(r.ship)} / {fmt(r.finish)}</span></div>
            <div><small className="faint">{T(L("Margin", "Маржа", "Маржа", "الهامش"))}</small><span className={r.money?.low ? "neg" : ""}>{r.money?.forecastPct ?? "—"}{r.money?.forecastPct !== null && r.money?.forecastPct !== undefined ? "%" : ""}{r.money?.targetPct !== null && r.money?.targetPct !== undefined ? ` / ${r.money.targetPct}%` : ""}</span></div>
            <div><small className="faint">{T(L("Collected", "Получено", "Отримано", "المحصّل"))}</small><span>{r.money && r.money.revenue ? `${Math.round((r.money.collected / r.money.revenue) * 100)}%` : "—"}</span></div>
          </div>
          {r.reasons.length > 0 && <div className="toolbar" style={{ gap: 6 }}>{r.reasons.map((x) => <span key={x.k} className="chip">{T(REASON[x.k](x.n))}</span>)}</div>}
        </div>)}</div>}
      <small className="faint">{T(L("Red: a step more than 14 days late, a client invoice more than 30 days overdue, margin more than 5 points under target, or shipping within 14 days without compliance. Amber: anything late, overdue, short or missing.", "Красный: шаг просрочен больше чем на 14 дней, счёт клиента — больше чем на 30 дней, маржа ниже цели больше чем на 5 пунктов или отгрузка через 14 дней без комплаенса. Жёлтый: что-то просрочено, не хватает или не сделано.", "Червоний: крок прострочено понад 14 днів, рахунок клієнта — понад 30 днів, маржа нижча за ціль понад 5 пунктів або відвантаження за 14 днів без комплаєнсу. Жовтий: щось прострочено, бракує чи не зроблено.", "أحمر: خطوة متأخرة أكثر من 14 يوماً، أو فاتورة عميل متأخرة أكثر من 30 يوماً، أو هامش أقل من الهدف بأكثر من 5 نقاط، أو شحن خلال 14 يوماً دون امتثال. أصفر: أي تأخر أو نقص."))}</small>
    </> : wl && <>
      {!wl.rows.length ? <div className="card" style={{ padding: 24 }}><small className="faint">{T(L("No open items with a person and a date in the next 6 weeks.", "Нет открытых дел с ответственным и датой на ближайшие 6 недель.", "Немає відкритих справ із відповідальним і датою на найближчі 6 тижнів.", "لا مهام مفتوحة بمسؤول وتاريخ في الأسابيع الستة القادمة."))}</small></div>
        : <div className="card tablewrap"><table className="tb wl"><thead><tr><th>{T(L("Person", "Сотрудник", "Співробітник", "الشخص"))}</th><th>{T(L("Overdue", "Просрочено", "Прострочено", "متأخر"))}</th>{wl.starts.map((s) => <th key={s} className="mono">{fmt(s)}</th>)}</tr></thead>
          <tbody>{wl.rows.map((r) => <tr key={r.who}><td>{r.who}{r.peak > LIMIT && <span className="chip c-bad" style={{ marginInlineStart: 6 }}>{T(L("overloaded", "перегруз", "перевантаження", "حمل زائد"))}</span>}</td>
            {[r.overdue, ...r.weeks].map((items, i) => { const n = items.length; const lv = i === 0 ? (n ? "late" : "0") : n === 0 ? "0" : n <= 3 ? "1" : n <= LIMIT ? "2" : "3"; return <td key={i}><button className={`wl-c wl${lv} ${open?.who === r.who && open.i === i ? "on" : ""}`} disabled={!n} onClick={() => setOpen(open?.who === r.who && open.i === i ? null : { who: r.who, i })}>{n || ""}</button></td>; })}</tr>)}</tbody></table></div>}
      {open && (() => { const r = wl.rows.find((x) => x.who === open.who); const items = r ? [r.overdue, ...r.weeks][open.i] : []; return <div className="card" style={{ padding: 14, display: "grid", gap: 6 }}>
        <b>{open.who} · {open.i === 0 ? T(L("Overdue", "Просрочено", "Прострочено", "متأخر")) : `${T(L("week of", "неделя с", "тиждень з", "أسبوع"))} ${fmt(wl.starts[open.i - 1])}`}</b>
        {items.map((x: any) => <Link key={x.id} href={href(x)}>{String(x.data?.due || x.data?.date || x.data?.eta || "").slice(0, 10)} · {x.title} <small className="faint">· {tx(SECTIONS.find((s) => s.id === x.section)?.label, lang as Lang)}</small></Link>)}</div>; })()}
      <small className="faint">{T(L(`Counted: open tasks, project steps, requests, purchases and any record with a person (assignee or owner) and a date. More than ${LIMIT} items in a week is an overload — move dates or share the work.`, `Учитываются открытые задачи, шаги проектов, заявки, закупки и любые записи с ответственным и датой. Больше ${LIMIT} дел в неделю — перегруз: перенесите сроки или распределите работу.`, `Враховуються відкриті завдання, кроки проєктів, заявки, закупівлі та будь-які записи з відповідальним і датою. Понад ${LIMIT} справ на тиждень — перевантаження: перенесіть строки або розподіліть роботу.`, `تُحتسب المهام المفتوحة وخطوات المشاريع والطلبات والمشتريات وأي سجل له مسؤول وتاريخ. أكثر من ${LIMIT} مهام في الأسبوع حمل زائد — غيّر المواعيد أو وزّع العمل.`))}</small>
    </>}
  </div>;
}
