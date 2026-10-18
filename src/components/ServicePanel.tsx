"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { pmMonths, renewalTitle, servicePlan, warranty, WARRANTY_NOTICE } from "@/lib/service";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

/** Inside an installed unit: the planned-service schedule by its service plan, warranty, and a service contract offer. */
export default function ServicePanel({ unit, onChange }: { unit: Rec; onChange?: () => void }) {
  const { lang, access, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [tickets, setTickets] = useState<Rec[]>([]); const [deal, setDeal] = useState<Rec | null | undefined>(undefined); const [busy, setBusy] = useState("");
  const u = store.original(unit); const today = new Date().toISOString().slice(0, 10);
  const load = () => {
    if (access.read.has("operations.support")) store.list("operations.support").then((r) => setTickets(r.filter((t) => t.data?.unit_ref === unit.id))).catch(() => {});
    if (access.read.has("sales.pipeline")) store.list("sales.pipeline").then((r) => setDeal(r.find((d) => store.original(d).title === renewalTitle(u)) || null)).catch(() => setDeal(null)); else setDeal(null);
  };
  useEffect(() => { load(); }, [unit.id]); // eslint-disable-line
  const plan = servicePlan(u as any); const w = warranty(u as any, today); const n = pmMonths(u.data?.sla);
  const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(lang === "en" ? "en-US" : lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const openPm = tickets.find((t) => t.data?.pm && !/^(resolved|closed)$/i.test(t.status || ""));
  const donePm = tickets.filter((t) => t.data?.pm && /^(resolved|closed)$/i.test(t.status || "")).length;

  const ticket = async () => {
    setBusy("t");
    try { const r = await store.save({ section: "operations.support", title: `Scheduled service — ${u.title}`, status: "New", data: { unit_ref: unit.id, unit_ref_title: u.title, client: u.data?.client || "", severity: "Medium", pm: "yes", notes: `Planned maintenance (${u.data?.sla || "Standard"}, every ${n} months). Site: ${u.data?.site || "—"}.` }, controlled: !!unit.controlled });
      toast(T(L("Service request created", "Заявка на ТО создана", "Заявку на ТО створено", "تم إنشاء طلب الصيانة"))); setTickets((x) => [r, ...x]); onChange?.(); } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };
  const offer = async () => {
    setBusy("d");
    try { const r = await store.save({ section: "sales.pipeline", title: renewalTitle(u), status: "Qualified", data: { client: u.data?.client || "", expected_close: w.end || today, next_step: "Offer the service contract before the warranty ends" }, controlled: !!unit.controlled });
      toast(T(L("Deal for a service contract created", "Сделка на сервисный контракт создана", "Угоду на сервісний контракт створено", "تم إنشاء صفقة عقد الخدمة"))); setDeal(r); } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };

  const wChip = w.state === "none" ? null : <span className={`chip ${w.state === "ended" ? "c-bad" : w.state === "soon" ? "c-warn" : "c-ok"}`}>
    {w.state === "ended" ? T(L("Warranty ended", "Гарантия закончилась", "Гарантія закінчилася", "انتهى الضمان")) : `${T(L("Warranty", "Гарантия", "Гарантія", "الضمان"))}: ${w.left} ${T(L("days", "дн.", "дн.", "يوماً"))}`}</span>;

  return <section className="appr">
    <div className="appr-h"><Icon n="calendar" /><b>{T(L("Planned service", "Плановое ТО", "Планове ТО", "الصيانة المخططة"))} · {u.data?.sla || "Standard"} · {T(L(`every ${n} months`, `каждые ${n} мес.`, `кожні ${n} міс.`, `كل ${n} أشهر`))}</b><span style={{ marginInlineStart: "auto" }}>{wChip}</span></div>
    {plan.length ? <div className="svc-dates">{plan.map((d, i) => <span key={d} className={`chip ${i === 0 && d < today ? "c-bad" : i === 0 ? "c-warn" : ""}`}>{fmt(d)}</span>)}</div>
      : <small className="faint">{T(L("Set the commissioning date or the next service date to see the schedule.", "Укажите дату ввода в эксплуатацию или следующего ТО, чтобы увидеть график.", "Вкажіть дату введення в експлуатацію або наступного ТО, щоб побачити графік.", "حدد تاريخ التشغيل أو موعد الخدمة القادمة لرؤية الجدول."))}</small>}
    <small className="faint">{u.data?.last_service ? `${T(L("Last service", "Последнее ТО", "Останнє ТО", "آخر خدمة"))}: ${fmt(u.data.last_service)} · ` : ""}{T(L("Planned services done", "Выполнено плановых ТО", "Виконано планових ТО", "صيانات منجزة"))}: {donePm}. {T(L("When a planned-service request is resolved, the next date moves forward by itself.", "Когда заявка на плановое ТО решена, следующая дата сдвигается сама.", "Коли заявку на планове ТО вирішено, наступна дата зсувається сама.", "عند حل طلب الصيانة المخططة ينتقل الموعد التالي تلقائياً."))}</small>
    <div className="toolbar">
      {openPm ? <Link className="btn sm" href={`/operations/support?r=${openPm.id}`}><Icon n="headset" />{T(L("Open service request", "Открытая заявка на ТО", "Відкрита заявка на ТО", "طلب صيانة مفتوح"))}</Link>
        : access.write.has("operations.support") && <button className="btn sm" disabled={!!busy} onClick={ticket}><Icon n="headset" />{busy === "t" ? "…" : T(L("Create service request", "Создать заявку на ТО", "Створити заявку на ТО", "إنشاء طلب صيانة"))}</button>}
      {deal ? <Link className="btn sm" href={`/sales/pipeline?r=${deal.id}`}><Icon n="funnel" />{T(L("Service contract deal", "Сделка на сервисный контракт", "Угода на сервісний контракт", "صفقة عقد الخدمة"))}</Link>
        : deal === null && (w.state === "soon" || w.state === "ended") && access.write.has("sales.pipeline") && <button className="btn primary sm" disabled={!!busy} onClick={offer}><Icon n="funnel" />{busy === "d" ? "…" : T(L("Offer a service contract", "Предложить сервисный контракт", "Запропонувати сервісний контракт", "اعرض عقد خدمة"))}</button>}
    </div>
    {w.state === "ok" && <small className="faint">{T(L(`${WARRANTY_NOTICE} days before the warranty ends, sales are reminded to offer a service contract.`, `За ${WARRANTY_NOTICE} дней до конца гарантии продажам придёт напоминание предложить сервисный контракт.`, `За ${WARRANTY_NOTICE} днів до кінця гарантії продажам надійде нагадування запропонувати сервісний контракт.`, `قبل ${WARRANTY_NOTICE} يوماً من انتهاء الضمان يُذكَّر فريق المبيعات بعرض عقد خدمة.`))}</small>}
  </section>;
}
