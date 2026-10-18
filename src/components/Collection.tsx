"use client";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { STEPS, stepFor } from "@/lib/dunning";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const NAMES: T4[] = [L("Friendly reminder", "Мягкое напоминание", "М'яке нагадування", "تذكير ودي"), L("Second reminder", "Повторное напоминание", "Повторне нагадування", "تذكير ثانٍ"), L("Final notice", "Последнее уведомление", "Останнє повідомлення", "إشعار أخير")];

/** In an unpaid client invoice: the reminder ladder, what was sent and what comes next. */
export default function Collection({ rec }: { rec: Rec }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const d = store.original(rec).data || {}; const due = String(d.due || "").slice(0, 10);
  if (d.direction === "Payable" || !/^\d{4}-\d{2}-\d{2}$/.test(due) || ["Draft", "Paid"].includes(rec.status || "")) return null;
  const today = new Date().toISOString().slice(0, 10); const late = Math.round((Date.parse(today) - Date.parse(due)) / 864e5);
  const sent: { at: string; subject: string }[] = Array.isArray(d.reminders) ? d.reminders : [];
  const now = stepFor(late);
  return <section className="appr">
    <div className="appr-h"><Icon n="coins" /><b>{T(L("Collection", "Сбор оплаты", "Збір оплати", "التحصيل"))}</b>
      <span className={`chip ${late > 30 ? "c-bad" : late > 0 ? "c-warn" : "c-ok"}`} style={{ marginInlineStart: "auto" }}>{late > 0 ? `${T(L("overdue", "просрочено", "прострочено", "متأخر"))} ${late} ${T(L("d", "дн.", "дн.", "يوم"))}` : T(L("not due yet", "срок не наступил", "строк не настав", "لم يستحق بعد"))}</span></div>
    <div className="dun">{STEPS.map((s, i) => { const at = addDays(due, s.days); const done = sent[i]; return <div key={s.step} className={`dun-s ${done ? "done" : now >= s.step ? "now" : ""}`}>
      <b>{s.step}. {T(NAMES[i])}</b><small className="faint">{done ? `${T(L("sent", "отправлено", "надіслано", "أُرسل"))} ${done.at}` : now >= s.step ? T(L("prepared — waiting for approval", "подготовлено — ждёт одобрения", "підготовлено — чекає схвалення", "جاهز — بانتظار الموافقة")) : `${T(L("from", "с", "з", "من"))} ${at}`}</small></div>; })}</div>
    <small className="faint">{T(L("Letters go in the client's language (client card → Language for letters) and only after a person approves them in Waiting for approval. Payment stops the ladder.", "Письма идут на языке клиента (карточка клиента → «Язык писем») и только после одобрения человеком в «Ждут одобрения». Оплата останавливает лестницу.", "Листи йдуть мовою клієнта (картка клієнта → «Мова листів») і лише після схвалення людиною в «Чекають схвалення». Оплата зупиняє драбину.", "تُرسل الرسائل بلغة العميل (بطاقة العميل ← لغة المراسلات) وبعد موافقة شخص في «بانتظار الموافقة» فقط. الدفع يوقف السلسلة."))}</small>
  </section>;
}
