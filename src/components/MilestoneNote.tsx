"use client";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { PAY_DAYS, TRIGGER_TEXT, type Trigger } from "@/lib/milestones";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

/** In an invoice made from the payment schedule: which part of the contract it is and whether it can be sent. */
export default function MilestoneNote({ rec }: { rec: Rec }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const d = store.original(rec).data || {}; if (!d.milestone) return null;
  const ready = !!d.ready_on; const sent = rec.status && rec.status !== "Draft";
  return <section className="appr">
    <div className="appr-h"><Icon n="calendar" /><b>{T(L("Payment by milestone", "Платёж по этапу", "Платіж за етапом", "دفعة حسب المرحلة"))} · {d.pct}% {T(TRIGGER_TEXT[d.trigger as Trigger] || TRIGGER_TEXT.start)}</b>
      <span className={`chip ${sent ? "c-ok" : ready ? "c-warn" : ""}`} style={{ marginInlineStart: "auto" }}>{sent ? rec.status : ready ? T(L("Ready to send", "Готов к отправке", "Готовий до надсилання", "جاهزة للإرسال")) : T(L("Waiting for the milestone", "Ждёт этапа", "Чекає етапу", "بانتظار المرحلة"))}</span></div>
    <small className="faint">{ready
      ? `${T(L("Ready since", "Готов с", "Готовий з", "جاهزة منذ"))} ${d.ready_on}. ${T(L(`Check the amount and details, then change the status to Sent; the client has ${PAY_DAYS} days to pay.`, `Проверьте сумму и реквизиты, затем смените статус на Sent; у клиента ${PAY_DAYS} дней на оплату.`, `Перевірте суму й реквізити, потім змініть статус на Sent; клієнт має ${PAY_DAYS} днів на оплату.`, `راجع المبلغ والتفاصيل ثم غيّر الحالة إلى Sent؛ أمام العميل ${PAY_DAYS} يوماً للدفع.`))}`
      : T(L("The invoice becomes ready by itself when the project step is closed. Until then it counts in the cash forecast on its planned date.", "Счёт станет готовым сам, когда шаг проекта будет закрыт. До этого он учитывается в прогнозе денег на плановую дату.", "Рахунок стане готовим сам, коли крок проєкту буде закрито. До того він враховується в прогнозі грошей на планову дату.", "تصبح الفاتورة جاهزة تلقائياً عند إغلاق خطوة المشروع. وحتى ذلك تُحتسب في توقع النقد في موعدها المخطط."))}</small>
  </section>;
}
