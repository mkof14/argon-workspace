// Automatic translation of what people write: shared rules for the browser and the server.
// Translations live inside the record: data._tr = { h: {key: hash}, s: {key: source lang}, t: {lang: {key: text}}, c: {commentId: {h, s, t}} }.
// "title" is the record title; other keys are field keys. Originals are never replaced.

export const TR_LANGS = ["en", "ru", "uk", "ar"] as const;
export type TrLang = (typeof TR_LANGS)[number];
export type TrEntry = { h: string; s?: string; t: Partial<Record<TrLang, string>> };
export type TrData = { h: Record<string, string>; s?: Record<string, string>; t: Partial<Record<TrLang, Record<string, string>>>; c?: Record<string, TrEntry>; at?: string };

/** Short stable fingerprint of a text (FNV-1a, 32 bit). */
export function trHash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0") + s.length.toString(36);
}

// Fields that hold names, codes, numbers or addresses: kept exactly as written
const KEEP = /^(person|client|email|phone|serial|version|model|number|hs|matrix_id|contact|vendor|supplier|manufacturer|counterparty|build|vessel|outlet|requester|reviewer|owner|assignee|to|cc|from|sku|eccn|code|ref|ticker|imo|mmsi|callsign|url|link|domain|ip|iban|swift|po|invoice_no|order_no|proposal_no|tracking)$/;

/** Is this value worth translating? Words, not codes, numbers, e-mails or links. */
export function translatable(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length < 2 || s.length > 12000) return false;
  if (!/\p{L}{2,}/u.test(s)) return false;                              // no words
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(s)) return false;                // e-mail
  if (/^(https?:\/\/|www\.)\S+$/i.test(s)) return false;                 // link
  if (/^[A-Z0-9][A-Z0-9\-_./#:]*$/.test(s) && !/\s/.test(s)) return false; // code like EAR99, SKU-12/4
  return true;
}

type FieldDef = { key: string; type: string };
/** The texts of a record that are translated: the title and the text fields people write in. */
export function trFields(fields: FieldDef[] | undefined, title: string, data: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  if (translatable(title)) out.title = title;
  for (const f of fields || []) {
    if (!["text", "long", "html"].includes(f.type) || KEEP.test(f.key) || f.key.startsWith("_")) continue;
    const v = data?.[f.key];
    if (translatable(v)) out[f.key] = v;
  }
  return out;
}

/** Which texts still need translating (new or changed since the last translation). */
export function trPending(texts: Record<string, string>, tr?: TrData | null) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(texts)) {
    const h = trHash(v);
    if (tr?.h?.[k] !== h || TR_LANGS.some((l) => tr?.t?.[l]?.[k] === undefined)) out[k] = v;
  }
  return out;
}

/** Text in the reader's language, only if the translation matches the current text. */
export function trText(original: string, entry: { h?: string; t?: Partial<Record<string, string>> } | undefined, lang: string) {
  if (!entry?.t || entry.h !== trHash(original)) return original;
  return entry.t[lang] || original;
}

export type Shown = { title: string; data: Record<string, any> };
/** A record as the reader sees it: title and texts in their language. Returns null when nothing changes. */
export function localizeRec<R extends { title: string; data: Record<string, any> }>(r: R, lang: string): (R & { _o: Shown; _l: Shown; _src?: string }) | null {
  const tr: TrData | undefined = r.data?._tr;
  const t = tr?.t?.[lang as TrLang];
  if (!tr || !t) return null;
  let changed = false;
  const pick = (k: string, v: any) => { if (typeof v !== "string" || tr.h?.[k] !== trHash(v) || typeof t[k] !== "string" || t[k] === v) return v; changed = true; return t[k]; };
  const title = pick("title", r.title);
  const data: Record<string, any> = { ...r.data };
  for (const k of Object.keys(tr.h || {})) if (k !== "title" && k in data) data[k] = pick(k, data[k]);
  if (!changed) return null;
  const src = tr.s?.title || Object.values(tr.s || {})[0];
  return { ...r, title, data, _o: { title: r.title, data: r.data }, _l: { title, data }, _src: src };
}

/** Before saving: texts the person did not touch go back to their original wording. */
export function unlocalize(title: string, data: Record<string, any>, o?: Shown, l?: Shown): { title: string; data: Record<string, any> } {
  if (!o || !l) return { title, data };
  const out: Record<string, any> = { ...data };
  for (const k of Object.keys(out)) if (k !== "_tr" && typeof out[k] === "string" && out[k] === l.data?.[k] && k in (o.data || {})) out[k] = o.data[k];
  if (o.data?._tr && !out._tr) out._tr = o.data._tr;
  return { title: title === l.title ? o.title : title, data: out };
}
