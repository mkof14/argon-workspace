// Nothing leaves the workshop without compliance: a build cannot go to Shipping and a shipment cannot be
// in transit, at customs or delivered until the export check, the sanctions and end-user screening of the
// deal and the end-user certificate are done. Checked on every way of changing the status.

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type R = { id: string; section: string; status?: string | null; data: Record<string, any> };

/** Statuses that mean "the goods leave". */
export const SHIP_GUARD: Record<string, string[]> = {
  "operations.builds": ["Ready for Shipment", "Shipped", "Delivered", "Shipping", "Installed"],
  "operations.logistics": ["In transit", "Customs", "Delivered"],
};
/** End-user certificate states that allow shipping. */
export const EUC_OK = ["Signed", "Not required"];

export type Missing = "export" | "screening" | "euc" | "build";
export const MISSING_TEXT: Record<Missing, T4> = {
  build: L("link the shipment to its build", "свяжите отгрузку со сборкой", "пов'яжіть відвантаження зі збиранням", "اربط الشحنة بالتجميع"),
  export: L("export / end-user check of the build is Cleared", "экспортная проверка сборки — Cleared", "експортна перевірка збирання — Cleared", "فحص التصدير للتجميع Cleared"),
  screening: L("sanctions and end-user screening of the deal is Cleared", "санкционная проверка сделки — Cleared", "санкційна перевірка угоди — Cleared", "فحص العقوبات للصفقة Cleared"),
  euc: L("end-user certificate is Signed (or Not required)", "сертификат конечного пользователя — Signed (или Not required)", "сертифікат кінцевого користувача — Signed (або Not required)", "شهادة المستخدم النهائي Signed (أو Not required)"),
};

/** What is still missing before this record may take this status ([] = allowed). */
export function shipMissing(section: string, status: string | null | undefined, data: Record<string, any>, build: R | null, screenings: R[]): Missing[] {
  if (!status || !SHIP_GUARD[section]?.includes(status)) return [];
  const b = section === "operations.builds" ? { id: "", section, data } as R : build;
  if (!b) return ["build"];
  const out: Missing[] = [];
  if (b.data?.export_check !== "Cleared") out.push("export");
  const deal = b.data?.deal_ref, scr = b.data?.screening_ref;
  const mine = screenings.filter((s) => s.section === "security.screening" && ((deal && s.data?.deal_ref === deal) || s.id === scr));
  if (!mine.length || mine.some((s) => s.status !== "Cleared")) out.push("screening");
  if (!EUC_OK.includes(b.data?.euc)) out.push("euc");
  return out;
}

export function shipMsg(m: Missing[], lang: string) {
  const l = (["en", "ru", "uk", "ar"].includes(lang) ? lang : "en") as keyof T4;
  const head = { en: "Cannot ship yet — needed first: ", ru: "Отгружать пока нельзя — сначала нужно: ", uk: "Відвантажувати поки не можна — спершу потрібно: ", ar: "لا يمكن الشحن بعد — المطلوب أولاً: " }[l];
  return head + m.map((k) => MISSING_TEXT[k][l]).join("; ") + ".";
}
