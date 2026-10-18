// Ukrainian and Arabic texts of the Learning Center and department pages are loaded only for people who use those languages.
// Kept apart from learn.ts so that pages which only translate a label do not load the whole Learning Center.
export const DICT: { uk?: Record<string, string>; ar?: Record<string, string> } = {};
export async function loadLearnLang(lang: string) {
  if ((lang !== "uk" && lang !== "ar") || DICT[lang]) return false;
  const m = await import("./learn-i18n"); DICT.uk = m.UK; DICT.ar = m.AR; return true;
}
export type T2 = { en: string; ru: string };
/** EN/RU are written in place; Ukrainian and Arabic come from learn-i18n.ts (falls back to English). */
export const l2 = (o: T2 | undefined, lang: string) => (o ? (lang === "ru" ? o.ru : lang === "uk" ? DICT.uk?.[o.en] || o.en : lang === "ar" ? DICT.ar?.[o.en] || o.en : o.en) : "");
