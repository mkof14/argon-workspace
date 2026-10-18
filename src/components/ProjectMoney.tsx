"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { CHANGE_ORDER, projectMoney } from "@/lib/margin";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
export const MONEY_SECS = ["sales.proposals", "operations.builds", "finance.costing", "legal.contracts", "operations.procurement", "finance.expenses", "finance.invoices"];
const usd = (v: number) => `USD ${Math.round(v).toLocaleString("en-US")}`;

/** In a won deal: contract and change orders, invoiced and collected, costs against the approved costing, margin. */
export default function ProjectMoney({ deal }: { deal: Rec }) {
  const { lang, access, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [all, setAll] = useState<Rec[] | null>(null); const [form, setForm] = useState<null | { title: string; amount: string; days: string; scope: string }>(null); const [busy, setBusy] = useState(false);
  const load = () => store.listMany(MONEY_SECS.filter((s) => access.read.has(s))).then((r) => setAll(r.map((x) => store.original(x) as Rec))).catch(() => setAll([]));
  useEffect(() => { load(); }, [deal.id]); // eslint-disable-line
  if (!all) return null;
  const d = store.original(deal) as Rec; const m = projectMoney(d as any, all as any);
  const cos = all.filter((r) => r.section === "legal.contracts" && r.data?.deal_ref === deal.id && r.data?.type === CHANGE_ORDER);
  const tile = (l: T4, v: string, cls = "", sub?: string) => <div className="vs-t"><small className="faint">{T(l)}</small><b className={cls}>{v}</b>{sub && <small className="faint">{sub}</small>}</div>;
  const mCls = m.low ? "neg" : "";
  const add = async () => {
    if (!form?.title.trim() || !Number(form.amount)) return; setBusy(true);
    try { await store.save({ section: "legal.contracts", title: form.title.trim(), status: "Drafting", data: { deal_ref: deal.id, deal_ref_title: d.title, type: CHANGE_ORDER, counterparty: d.data?.client || d.title, amount: Number(form.amount), currency: d.data?.currency || "USD", schedule_days: Number(form.days) || 0, scope: form.scope }, controlled: !!deal.controlled });
      toast(T(L("Change order created — send it for approval", "Изменение создано — отправьте на согласование", "Зміну створено — надішліть на погодження", "تم إنشاء أمر التغيير — أرسله للموافقة"))); setForm(null); load(); } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(false); }
  };
  return <section className="appr">
    <div className="appr-h"><Icon n="coins" /><b>{T(L("Project money", "Деньги проекта", "Гроші проєкту", "أموال المشروع"))}</b>
      {m.forecastPct !== null && <span className={`chip ${m.low ? "c-bad" : m.targetPct !== null ? "c-ok" : ""}`} style={{ marginInlineStart: "auto" }}>{T(L("Margin", "Маржа", "Маржа", "الهامش"))} {m.forecastPct}%{m.targetPct !== null ? ` / ${m.targetPct}%` : ""}</span>}</div>
    <div className="vs-grid">
      {tile(L("Contract", "Контракт", "Контракт", "العقد"), usd(m.revenue), "", m.changes ? `${T(L("incl. changes", "вкл. изменения", "вкл. зміни", "يشمل التغييرات"))} ${m.changes > 0 ? "+" : ""}${usd(m.changes)}` : undefined)}
      {tile(L("Invoiced / collected", "Выставлено / получено", "Виставлено / отримано", "مُفوتر / محصّل"), `${usd(m.invoiced)}`, "", `${T(L("collected", "получено", "отримано", "محصّل"))} ${usd(m.collected)}`)}
      {tile(L("Costs so far", "Затраты сейчас", "Витрати зараз", "التكاليف حتى الآن"), usd(m.committed), m.over ? "neg" : "", m.planned !== null ? `${T(L("plan", "план", "план", "الخطة"))} ${usd(m.planned)}` : T(L("no approved costing", "нет утверждённой себестоимости", "немає затвердженої собівартості", "لا تكلفة معتمدة")))}
      {tile(L("Expected margin", "Ожидаемая маржа", "Очікувана маржа", "الهامش المتوقع"), m.forecastPct === null ? "—" : `${m.forecastPct}%`, mCls, m.targetPct !== null ? `${T(L("target", "цель", "ціль", "الهدف"))} ${m.targetPct}%` : undefined)}
    </div>
    {(m.over || m.low) && <small className="neg">{m.over ? T(L("Costs are above the approved costing by more than 5%.", "Затраты выше утверждённой себестоимости более чем на 5%.", "Витрати перевищують затверджену собівартість більш ніж на 5%.", "التكاليف أعلى من التكلفة المعتمدة بأكثر من 5%.")) + " " : ""}{m.low ? T(L("Expected margin is more than 5 points under the target.", "Ожидаемая маржа ниже цели более чем на 5 пунктов.", "Очікувана маржа нижча за ціль більш ніж на 5 пунктів.", "الهامش المتوقع أقل من الهدف بأكثر من 5 نقاط.")) : ""}</small>}
    <div className="eyebrow" style={{ marginTop: 6 }}>{T(L("Change orders", "Изменения к контракту", "Зміни до контракту", "أوامر التغيير"))}</div>
    {cos.length ? <div className="co-list">{cos.map((c) => <div key={c.id} className="co-row"><span><Link href={`/legal/contracts?r=${c.id}`}>{c.title}</Link>{Number(c.data?.schedule_days) ? <small className="faint"> · {c.data.schedule_days > 0 ? "+" : ""}{c.data.schedule_days} {T(L("days", "дн.", "дн.", "يوم"))}</small> : null}</span>
      <span className="mono" style={{ whiteSpace: "nowrap" }}>{Number(c.data?.amount) > 0 ? "+" : ""}{Number(c.data?.amount || 0).toLocaleString("en-US")} {c.data?.currency || ""}</span><span className={`chip ${c.status === "Signed" ? "c-ok" : ""}`}>{c.status}</span></div>)}</div>
      : <small className="faint">{T(L("None. A signed change order changes the contract value and the payments by itself.", "Нет. Подписанное изменение само меняет сумму контракта и платежи.", "Немає. Підписана зміна сама змінює суму контракту й платежі.", "لا يوجد. أمر التغيير الموقّع يغيّر قيمة العقد والدفعات تلقائياً."))}</small>}
    {form ? <div className="fgrid" style={{ marginTop: 8 }}>
      <div className="field wide"><label>{T(L("Title", "Название", "Назва", "العنوان"))}</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="CO-1 …" /></div>
      <div className="field"><label>{T(L("Amount change (+ / −)", "Изменение суммы (+ / −)", "Зміна суми (+ / −)", "تغيير المبلغ (+ / −)"))} {d.data?.currency || "USD"}</label><input className="input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
      <div className="field"><label>{T(L("Schedule impact, days", "Влияние на сроки, дней", "Вплив на строки, днів", "الأثر على الجدول (أيام)"))}</label><input className="input" type="number" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></div>
      <div className="field wide"><label>{T(L("Scope of the change", "Суть изменения", "Суть зміни", "نطاق التغيير"))}</label><textarea className="input" rows={2} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} /></div>
      <div className="toolbar"><button className="btn primary sm" disabled={busy || !form.title.trim() || !Number(form.amount)} onClick={add}><Icon n="check" />{busy ? "…" : T(L("Create", "Создать", "Створити", "إنشاء"))}</button><button className="btn ghost sm" onClick={() => setForm(null)}>{T(L("Cancel", "Отмена", "Скасувати", "إلغاء"))}</button></div>
    </div> : access.write.has("legal.contracts") && <div className="toolbar"><button className="btn sm" onClick={() => setForm({ title: `CO-${cos.length + 1} `, amount: "", days: "", scope: "" })}><Icon n="pen" />{T(L("New change order", "Новое изменение", "Нова зміна", "أمر تغيير جديد"))}</button></div>}
  </section>;
}
