// Pure helpers for "Ask your documents" (no imports, unit-tested).
/** Word/Excel/text have no pages: split into ~3,000-character parts at paragraph breaks. */
export function chunk(text: string, size = 3000): string[] {
  const out: string[] = []; let cur = "";
  for (const para of text.split(/\n{2,}|\n(?=# )/)) {
    if ((cur + "\n\n" + para).length > size && cur) { out.push(cur.trim()); cur = ""; }
    if (para.length > size) { for (let i = 0; i < para.length; i += size) out.push(para.slice(i, i + size)); continue; }
    cur += (cur ? "\n\n" : "") + para;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [""];
}

/** Search terms → a safe to_tsquery string: prefix match, OR between terms. */
export function tsQuery(terms: string[]): string {
  const words = new Set<string>();
  for (const t of terms) for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u)) if ((w.length >= 3 || /\d/.test(w)) && w.length <= 40 && !STOP.has(w)) words.add(w);
  return [...words].slice(0, 30).map((w) => `${w}:*`).join(" | ");
}
const STOP = new Set(["the", "and", "for", "with", "what", "which", "how", "are", "our", "что", "как", "какие", "какой", "для", "это", "наш", "наши", "или", "при", "все", "where", "when", "who", "есть", "where", "чем", "какая"]);
