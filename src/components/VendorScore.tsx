"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { vendorScore, type Grade } from "@/lib/vendors";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
export const GRADE: Record<Grade, { cls: string; t: T4 }> = {
  A: { cls: "c-ok", t: L("A · reliable", "A · надёжный", "A · надійний", "A · موثوق") },
  B: { cls: "c-warn", t: L("B · watch", "B · под наблюдением", "B · під наглядом", "B · تحت المراقبة") },
  C: { cls: "c-bad", t: L("C · unreliable", "C · ненадёжный", "C · ненадійний", "C · غير موثوق") },
  new: { cls: "", t: L("new · too few orders", "новый · мало заказов", "новий · мало замовлень", "جديد · طلبات قليلة") },
};

/** Vendor performance from its purchase orders: on time, delay, rejects, price trend. */
export default function VendorScore({ vendor }: { vendor: string }) {
  const { lang, access } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [pos, setPos] = useState<Rec[] | null>(null);
  useEffect(() => { if (access.read.has("operations.procurement") && vendor) store.list("operations.procurement").then((r) => setPos(r.map((x) => store.original(x) as Rec))).catch(() => setPos([])); }, [vendor]); // eslint-disable-line
  if (!vendor || !pos) return null;
  const s = vendorScore(vendor, pos as any); if (!s.orders) return null;
  const g = GRADE[s.grade]; const pct = (n: number | null, sign = false) => n === null ? "—" : `${sign && n > 0 ? "+" : ""}${n}%`;
  const tile = (l: T4, v: string, bad?: boolean) => <div className="vs-t"><small className="faint">{T(l)}</small><b className={bad ? "neg" : ""}>{v}</b></div>;
  return <section className="appr">
    <div className="appr-h"><Icon n="store" /><b>{T(L("Vendor performance", "Оценка поставщика", "Оцінка постачальника", "أداء المورّد"))} · {vendor}</b><span className={`chip ${g.cls}`} style={{ marginInlineStart: "auto" }}>{T(g.t)}</span></div>
    <div className="vs-grid">
      {tile(L("Orders / received", "Заказов / получено", "Замовлень / отримано", "طلبات / مستلمة"), `${s.orders} / ${s.received}`)}
      {tile(L("On time", "Вовремя", "Вчасно", "في الموعد"), pct(s.onTime), s.onTime !== null && s.onTime < 70)}
      {tile(L("Average delay", "Средняя задержка", "Середня затримка", "متوسط التأخير"), s.avgDelay === null ? "—" : `${s.avgDelay} ${T(L("d", "дн.", "дн.", "يوم"))}`, (s.avgDelay || 0) > 7)}
      {tile(L("Rejected on receipt", "Брак при приёмке", "Брак під час приймання", "مرفوض عند الاستلام"), pct(s.defectPct), (s.defectPct || 0) > 5)}
      {tile(L("Unit price change", "Изменение цены за ед.", "Зміна ціни за од.", "تغير سعر الوحدة"), pct(s.priceChange, true), (s.priceChange || 0) > 10)}
    </div>
    {s.late.length > 0 && <small className="faint">{T(L("Latest delays", "Последние задержки", "Останні затримки", "آخر التأخيرات"))}: {s.late.map((l, i) => <span key={l.id}>{i ? ", " : ""}<Link href={`/operations/procurement?r=${l.id}`}>{l.title}</Link> (+{l.days})</span>)}</small>}
    <small className="faint">{T(L("On time means received by the date promised when the order was placed. Grade A: 90%+ on time and up to 1% rejects; C: under 70% on time or over 5% rejects.", "Вовремя — получено к дате, обещанной при заказе. Оценка A: 90%+ вовремя и до 1% брака; C: меньше 70% вовремя или больше 5% брака.", "Вчасно — отримано до дати, обіцяної під час замовлення. Оцінка A: 90%+ вчасно й до 1% браку; C: менше 70% вчасно або понад 5% браку.", "في الموعد يعني الاستلام بحلول التاريخ الموعود عند الطلب. الدرجة A: ‏90%+ في الموعد وحتى 1% مرفوض؛ C: أقل من 70% أو أكثر من 5% مرفوض."))}</small>
  </section>;
}
