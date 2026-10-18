"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { left, slaFor, type SlaState } from "@/lib/sla";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
export const SLA_STATE: Record<SlaState, { t: T4; cls: string; icon: string }> = {
  ok: { t: L("on time", "в срок", "вчасно", "في الوقت"), cls: "", icon: "clock" },
  soon: { t: L("due soon", "скоро срок", "скоро строк", "يقترب الموعد"), cls: "c-warn", icon: "alert" },
  late: { t: L("overdue", "просрочено", "прострочено", "متأخر"), cls: "c-bad", icon: "alert" },
  met: { t: L("met", "выполнено", "виконано", "تحقق"), cls: "c-ok", icon: "check" },
  missed: { t: L("missed", "нарушено", "порушено", "فات"), cls: "c-bad", icon: "alert" },
};

/** Inside a support request: response and resolution deadlines by the unit's SLA and the severity, with time left. */
export default function SlaPanel({ rec }: { rec: Rec }) {
  const { lang, access } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [fleet, setFleet] = useState<Rec[]>([]); const [, tick] = useState(0);
  useEffect(() => { if (access.read.has("operations.fleet")) store.list("operations.fleet").then(setFleet).catch(() => {}); const h = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(h); }, []); // eslint-disable-line
  const v = slaFor(store.original(rec) as any, fleet as any); if (!v) return null;
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "en" ? "en-US" : lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const row = (label: T4, by: string, st: SlaState, min: number) => { const s = SLA_STATE[st]; return <div className="sla-row">
    <span>{T(label)}</span><b>{when(by)}</b>
    <span className={`chip ${s.cls}`}><Icon n={s.icon} className="lockico" /> {T(s.t)}{st === "ok" || st === "soon" ? ` · ${left(min, lang as any)}` : st === "late" ? ` · ${left(min, lang as any)}` : ""}</span></div>; };
  return <section className="appr">
    <div className="appr-h"><Icon n="clock" /><b>SLA · {v.tier} · {v.severity}</b></div>
    {row(L("Respond by", "Ответить до", "Відповісти до", "الرد قبل"), v.respondBy, v.respond, v.respondLeft)}
    {row(L("Resolve by", "Решить до", "Вирішити до", "الحل قبل"), v.resolveBy, v.resolve, v.resolveLeft)}
    <small className="faint">{T(L("The level comes from the linked installed unit (Standard when none is linked). Moving the request out of New counts as the response; Resolved stops the clock.", "Уровень берётся из связанной установленной системы (Standard, если не связана). Перевод заявки из New считается ответом; Resolved останавливает таймер.", "Рівень береться зі зв'язаної встановленої системи (Standard, якщо не зв'язана). Переведення заявки з New вважається відповіддю; Resolved зупиняє таймер.", "يؤخذ المستوى من النظام المركّب المرتبط (Standard إن لم يُربط). نقل الطلب من New يُعد رداً؛ وResolved يوقف المؤقت."))}</small>
  </section>;
}
