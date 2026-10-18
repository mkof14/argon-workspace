"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { buildParts } from "@/lib/parts";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const SECS = ["technical.bom", "operations.inventory", "operations.procurement"];

/** Inside a build: parts from the configuration's bill of materials — reserve from stock, order what is missing. */
export default function BuildParts({ build }: { build: Rec }) {
  const { lang, access, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [all, setAll] = useState<Rec[] | null>(null); const [busy, setBusy] = useState("");
  const load = () => store.listMany(SECS.filter((s) => access.read.has(s))).then(setAll).catch(() => setAll([]));
  useEffect(() => { load(); }, [build.id]); // eslint-disable-line
  if (!all) return null;
  const b = store.original(build);
  const lines = buildParts(b as any, all.map((r) => store.original(r)) as any);
  const head = <div className="appr-h"><Icon n="box" /><b>{T(L("Parts for this build", "Комплектующие для сборки", "Комплектуючі для збирання", "قطع هذا التجميع"))}</b>{b.data?.config && <span className="chip" style={{ marginInlineStart: 8 }}>{b.data.config}</span>}</div>;
  if (!b.data?.config) return <section className="appr">{head}<small className="faint">{T(L("Choose the configuration to see the parts.", "Выберите конфигурацию, чтобы увидеть комплектующие.", "Оберіть конфігурацію, щоб побачити комплектуючі.", "اختر التهيئة لرؤية القطع."))}</small></section>;
  if (!lines.length) return <section className="appr">{head}<small className="faint">{T(L("No approved bill of materials for this configuration yet (Technical → Bill of materials).", "Для этой конфигурации ещё нет согласованной спецификации (Технический → Спецификация BOM).", "Для цієї конфігурації ще немає погодженої специфікації (Технічний → Специфікація BOM).", "لا توجد قائمة مواد معتمدة لهذه التهيئة بعد (التقني ← قائمة المواد)."))} <Link href="/technical/bom">→</Link></small></section>;
  const canInv = access.write.has("operations.inventory"), canPo = access.write.has("operations.procurement");
  const free = lines.flatMap((l) => l.freeIds); const short = lines.filter((l) => l.short - l.free > 0);
  const reserve = async () => {
    setBusy("res");
    try { for (const id of free) { const r = all.find((x) => x.id === id)!; const o = store.original(r); await store.save({ ...o, status: "Reserved", data: { ...o.data, build_ref: b.id, build: b.title } }); }
      toast(`${T(L("Reserved", "Зарезервировано", "Зарезервовано", "تم الحجز"))}: ${free.length}`); await load(); } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };
  const order = async () => {
    setBusy("po");
    try { for (const l of short) { const qty = l.short - l.free; await store.save({ section: "operations.procurement", title: `${l.line.data?.item || l.line.title} × ${qty} — ${b.title}`.slice(0, 200), status: "Draft",
        data: { item: l.line.data?.item || l.line.title, part_no: l.line.data?.part_no, vendor: l.line.data?.supplier || "", qty, amount: Math.round((Number(l.line.data?.unit_cost) || 0) * qty * 100) / 100 || undefined, currency: "USD", build: b.title, build_ref: b.id } }); }
      toast(`${T(L("Purchase orders drafted", "Черновики заказов созданы", "Чернетки замовлень створено", "تمت صياغة أوامر الشراء"))}: ${short.length}`); await load(); } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };
  return <section className="appr">{head}
    <div className="tablewrap"><table className="tb"><thead><tr>
      <th>{T(L("Part", "Позиция", "Позиція", "القطعة"))}</th><th>{T(L("Need", "Нужно", "Потрібно", "المطلوب"))}</th><th>{T(L("Reserved", "В резерве", "У резерві", "محجوز"))}</th><th>{T(L("Free in stock", "Свободно на складе", "Вільно на складі", "متاح في المخزون"))}</th><th>{T(L("On order", "Заказано", "Замовлено", "قيد الطلب"))}</th><th>{T(L("Short", "Не хватает", "Бракує", "النقص"))}</th></tr></thead>
      <tbody>{lines.map((l) => { const s = Math.max(0, l.short - l.free); return <tr key={l.line.id}><td>{l.line.data?.item || l.line.title}{l.line.data?.part_no ? <small className="faint mono"> · {l.line.data.part_no}</small> : null}</td>
        <td className="mono">{l.need}</td><td className="mono">{l.reserved}</td><td className="mono">{l.free}</td><td className="mono">{l.onOrder}</td>
        <td>{s ? <span className="chip c-bad"><Icon n="alert" className="lockico" /> {s}</span> : l.short ? <span className="chip c-warn">{T(L("reserve from stock", "взять со склада", "взяти зі складу", "احجز من المخزون"))}</span> : <span className="chip c-ok">✓</span>}</td></tr>; })}</tbody></table></div>
    <div className="toolbar">
      {canInv && free.length > 0 && <button className="btn primary sm" disabled={!!busy} onClick={reserve}><Icon n="lock" />{busy === "res" ? "…" : `${T(L("Reserve from stock", "Зарезервировать со склада", "Зарезервувати зі складу", "احجز من المخزون"))} (${free.length})`}</button>}
      {canPo && short.length > 0 && <button className="btn sm" disabled={!!busy} onClick={order}><Icon n="cart" />{busy === "po" ? "…" : `${T(L("Draft orders for the shortage", "Создать заказы на нехватку", "Створити замовлення на нестачу", "صياغة طلبات للنقص"))} (${short.length})`}</button>}
    </div>
  </section>;
}
