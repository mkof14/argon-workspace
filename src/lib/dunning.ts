// Collecting receivables: three polite steps after the due date, in the client's language.
// Every letter waits for a person's approval before it goes out; the invoice remembers what was sent.

export type DLang = "en" | "ru" | "uk" | "ar";
export const STEPS = [{ step: 1, days: 7 }, { step: 2, days: 21 }, { step: 3, days: 45 }] as const;
/** Client card language value → letter language. */
export const LANG_OF: Record<string, DLang> = { English: "en", "Русский": "ru", "Українська": "uk", "العربية": "ar" };
export const CLIENT_LANGS = Object.keys(LANG_OF);

/** Which step is due for an invoice this many days late (0 = none yet). */
export const stepFor = (late: number) => STEPS.filter((s) => late >= s.days).reduce((a, s) => s.step, 0 as number);

const T: Record<DLang, { subj: string[]; hi: string; body: string[]; ref: string; bye: string }> = {
  en: { subj: ["Payment reminder — {title}", "Second reminder — {title} is {late} days overdue", "Final notice — {title}"], hi: "Dear {client},",
    body: ["Our records show that invoice **{title}** for **{sum}**, due on {due}, is still open. If the payment has already been sent, please ignore this message and share the payment reference. Otherwise we would be grateful for payment at your earliest convenience.",
      "We have not yet received payment of invoice **{title}** for **{sum}**, due on {due} ({late} days ago). Please let us know the expected payment date, or tell us if anything in the invoice needs to be clarified.",
      "Invoice **{title}** for **{sum}** is now {late} days overdue. Please arrange payment within 7 days or contact us to agree a schedule. Without payment we may need to pause further deliveries and services under the contract."],
    ref: "Payment reference: {title}.", bye: "Kind regards,\nAGRON Inc. — Finance" },
  ru: { subj: ["Напоминание об оплате — {title}", "Повторное напоминание — {title}: просрочка {late} дн.", "Последнее уведомление — {title}"], hi: "Уважаемые коллеги из {client}!",
    body: ["По нашим данным, счёт **{title}** на **{sum}** со сроком оплаты {due} ещё не оплачен. Если оплата уже отправлена, пожалуйста, не обращайте внимания на это письмо и сообщите номер платежа. В противном случае будем признательны за оплату в ближайшее время.",
      "Мы пока не получили оплату по счёту **{title}** на **{sum}** со сроком {due} ({late} дн. назад). Пожалуйста, сообщите ожидаемую дату оплаты или напишите, если что-то в счёте требует уточнения.",
      "Счёт **{title}** на **{sum}** просрочен уже на {late} дн. Просим оплатить его в течение 7 дней или связаться с нами, чтобы согласовать график. Без оплаты нам, возможно, придётся приостановить дальнейшие поставки и услуги по договору."],
    ref: "Назначение платежа: {title}.", bye: "С уважением,\nAGRON Inc. — финансовый отдел" },
  uk: { subj: ["Нагадування про оплату — {title}", "Повторне нагадування — {title}: прострочення {late} дн.", "Останнє повідомлення — {title}"], hi: "Шановні колеги з {client}!",
    body: ["За нашими даними, рахунок **{title}** на **{sum}** зі строком оплати {due} ще не сплачено. Якщо оплату вже надіслано, будь ласка, не зважайте на цей лист і повідомте номер платежу. В іншому разі будемо вдячні за оплату найближчим часом.",
      "Ми ще не отримали оплату за рахунком **{title}** на **{sum}** зі строком {due} ({late} дн. тому). Будь ласка, повідомте очікувану дату оплати або напишіть, якщо щось у рахунку потребує уточнення.",
      "Рахунок **{title}** на **{sum}** прострочено вже на {late} дн. Просимо сплатити його протягом 7 днів або зв'язатися з нами, щоб погодити графік. Без оплати нам, можливо, доведеться призупинити подальші постачання й послуги за договором."],
    ref: "Призначення платежу: {title}.", bye: "З повагою,\nAGRON Inc. — фінансовий відділ" },
  ar: { subj: ["تذكير بالدفع — {title}", "تذكير ثانٍ — {title} متأخرة {late} يوماً", "إشعار أخير — {title}"], hi: "السادة {client} المحترمون،",
    body: ["تشير سجلاتنا إلى أن الفاتورة **{title}** بمبلغ **{sum}** المستحقة في {due} ما زالت مفتوحة. إذا كان الدفع قد أُرسل بالفعل فيرجى تجاهل هذه الرسالة وإرسال مرجع الدفع. وإلا فنكون شاكرين للسداد في أقرب وقت ممكن.",
      "لم نستلم بعد دفعة الفاتورة **{title}** بمبلغ **{sum}** المستحقة في {due} (منذ {late} يوماً). يرجى إعلامنا بموعد الدفع المتوقع، أو إخبارنا إن كان أي شيء في الفاتورة يحتاج إلى توضيح.",
      "الفاتورة **{title}** بمبلغ **{sum}** متأخرة الآن {late} يوماً. يرجى ترتيب الدفع خلال 7 أيام أو التواصل معنا للاتفاق على جدول. وبدون الدفع قد نضطر إلى إيقاف التوريدات والخدمات اللاحقة بموجب العقد."],
    ref: "مرجع الدفع: {title}.", bye: "مع أطيب التحيات،\nAGRON Inc. — الإدارة المالية" },
};

/** The letter for a step: subject and body in the client's language. */
export function dunningLetter(step: number, lang: DLang, v: { title: string; sum: string; due: string; late: number; client: string }) {
  const t = T[lang] || T.en; const i = Math.min(3, Math.max(1, step)) - 1;
  const f = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => String((v as any)[k] ?? ""));
  return { subject: f(t.subj[i]), body: `${f(t.hi)}\n\n${f(t.body[i])}\n\n${f(t.ref)}\n\n${t.bye}` };
}

/** Days sales outstanding: open receivables against invoiced revenue of the last 90 days (null without revenue). */
export function dso(invoices: { status?: string | null; created_at?: string; data: Record<string, any> }[], today: string, usd: (v: any, c?: string) => number) {
  const recv = invoices.filter((i) => i.data?.direction !== "Payable" && i.status !== "Draft");
  const open = recv.filter((i) => i.status !== "Paid").reduce((a, i) => a + usd(i.data?.amount, i.data?.currency), 0);
  const t0 = Date.parse(today) - 90 * 864e5;
  const billed = recv.filter((i) => Date.parse(String(i.data?.issued || i.created_at || i.data?.due || "").slice(0, 10)) >= t0).reduce((a, i) => a + usd(i.data?.amount, i.data?.currency), 0);
  return billed ? Math.round((open / billed) * 90) : null;
}

/** Letter language from the client card (invoice → deal → client, or a client with the counterparty's name); English otherwise. */
export function clientLang(inv: { data: Record<string, any> }, all: { id: string; section: string; title: string; data: Record<string, any> }[]): DLang {
  const deal = all.find((r) => r.id === inv.data?.deal_ref);
  const c = all.find((r) => r.section === "sales.clients" && (r.id === deal?.data?.client_ref || (inv.data?.counterparty && r.title.trim().toLowerCase() === String(inv.data.counterparty).trim().toLowerCase())));
  return LANG_OF[c?.data?.lang] || "en";
}
