"use client";
// Fields that point at people and departments, formatted text, and comments with @mentions.
// People are stored by account: <key>_id (one person) or <key>_ids (several); the name is kept next to it so the
// record still reads correctly after someone leaves (historical attribution).
import { useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { ORG_DEPTS } from "@/config/workspace.config.mjs";
import type { Profile } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const EXTERNAL = ["partner", "vendor", "investor", "pending"];
export const isEmployee = (p: Profile) => !EXTERNAL.includes(p.role) && !p.disabled;
export const personName = (p?: Profile | null) => (p ? p.full_name || p.email : "");
export const deptLabel = (k: string | null | undefined, lang: Lang) => { const d = (ORG_DEPTS as any[]).find((x) => x.key === k); return d ? tx(d.label, lang) : k || ""; };

/** One employee. Only active employees can be chosen; a person who has since left stays shown, marked as inactive. */
export function PersonField({ f, data, setData, ro, id }: { f: any; data: Record<string, any>; setData: (fn: (d: Record<string, any>) => Record<string, any>) => void; ro: boolean; id: string }) {
  const { lang, people } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const cur = data[`${f.key}_id`] || ""; const curP = people.find((p) => p.id === cur);
  const active = people.filter(isEmployee).sort((a, b) => personName(a).localeCompare(personName(b)));
  const set = (pid: string) => setData((d) => { const p = people.find((x) => x.id === pid); const n = { ...d }; if (p) { n[`${f.key}_id`] = p.id; n[f.key] = personName(p); } else { delete n[`${f.key}_id`]; n[f.key] = ""; } return n; });
  const legacy = !cur && data[f.key]; // a name typed before accounts were linked
  return <div className="field"><label htmlFor={id}>{tx(f.label, lang as Lang)}</label>
    <select id={id} className="input" value={cur} disabled={ro} onChange={(e) => set(e.target.value)} data-person={f.key}>
      <option value="">{legacy ? `${data[f.key]} (${T(L("not linked", "не привязан", "не прив'язано", "غير مرتبط"))})` : "—"}</option>
      {cur && (!curP || !isEmployee(curP)) && <option value={cur}>{data[f.key] || personName(curP) || "—"} ({T(L("inactive", "неактивен", "неактивний", "غير نشط"))})</option>}
      {active.map((p) => <option key={p.id} value={p.id}>{personName(p)}{p.department ? ` · ${deptLabel(p.department, lang as Lang)}` : ""}</option>)}
    </select></div>;
}

/** Several employees (a project team). */
export function PeopleField({ f, data, setData, ro }: { f: any; data: Record<string, any>; setData: (fn: (d: Record<string, any>) => Record<string, any>) => void; ro: boolean }) {
  const { lang, people } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const ids: string[] = Array.isArray(data[`${f.key}_ids`]) ? data[`${f.key}_ids`] : [];
  const [q, setQ] = useState("");
  const name = (pid: string) => personName(people.find((p) => p.id === pid)) || "—";
  const write = (next: string[]) => setData((d) => ({ ...d, [`${f.key}_ids`]: next, [f.key]: next.map(name).join(", ") }));
  const hits = people.filter((p) => isEmployee(p) && !ids.includes(p.id) && (!q || personName(p).toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  return <div className="field wide"><label>{tx(f.label, lang as Lang)}</label>
    <div className="people-chips">{ids.map((pid) => <span key={pid} className="chip">{name(pid)}{!ro && <button type="button" className="iconbtn" aria-label={T(L("Remove", "Убрать", "Прибрати", "إزالة"))} onClick={() => write(ids.filter((x) => x !== pid))}><Icon n="x" /></button>}</span>)}
      {!ids.length && <span className="faint">{typeof data[f.key] === "string" && data[f.key] ? data[f.key] : "—"}</span>}</div>
    {!ro && <div style={{ position: "relative" }}><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T(L("Add a person…", "Добавить человека…", "Додати людину…", "أضف شخصاً…"))} aria-label={T(L("Add a person", "Добавить человека", "Додати людину", "أضف شخصاً"))} data-people={f.key} />
      {q && <div className="ref-menu">{hits.length ? hits.map((p) => <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { write([...ids, p.id]); setQ(""); }}><b>{personName(p)}</b><span className="faint">{deptLabel(p.department, lang as Lang)}</span></button>)
        : <div className="faint" style={{ padding: 8 }}>{T(L("Nobody found", "Никого не найдено", "Нікого не знайдено", "لا أحد"))}</div>}</div>}</div>}
  </div>;
}

export function DeptField({ f, value, set, ro, id }: { f: any; value: string; set: (v: string) => void; ro: boolean; id: string }) {
  const { lang } = useApp();
  return <div className="field"><label htmlFor={id}>{tx(f.label, lang as Lang)}</label>
    <select id={id} className="input" value={value || ""} disabled={ro} onChange={(e) => set(e.target.value)}><option value="">—</option>
      {(ORG_DEPTS as any[]).map((d) => <option key={d.key} value={d.key}>{tx(d.label, lang as Lang)}</option>)}</select></div>;
}

export const mdHtml = (s: string) => DOMPurify.sanitize(marked.parse(String(s || ""), { gfm: true, breaks: true }) as string);

/** Formatted text: bold, lists, links, headings (Markdown underneath), with a preview. */
export function RichField({ f, value, set, ro, id }: { f: any; value: string; set: (v: string) => void; ro: boolean; id: string }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [prev, setPrev] = useState(ro);
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (a: string, b = a) => { const el = ref.current; if (!el) return; const s0 = el.selectionStart, s1 = el.selectionEnd; const v = value || ""; set(v.slice(0, s0) + a + v.slice(s0, s1) + b + v.slice(s1)); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s0 + a.length, s1 + a.length); }); };
  const line = (p: string) => { const el = ref.current; if (!el) return; const v = value || ""; const s0 = v.lastIndexOf("\n", el.selectionStart - 1) + 1; set(v.slice(0, s0) + p + v.slice(s0)); };
  return <div className="field wide rich"><label htmlFor={id}>{tx(f.label, lang as Lang)}</label>
    {!ro && <div className="rich-bar" role="toolbar" aria-label={T(L("Formatting", "Оформление", "Оформлення", "التنسيق"))}>
      <button type="button" className="btn ghost sm" onClick={() => wrap("**")} aria-label={T(L("Bold", "Жирный", "Жирний", "عريض"))}><b>B</b></button>
      <button type="button" className="btn ghost sm" onClick={() => wrap("_")} aria-label={T(L("Italic", "Курсив", "Курсив", "مائل"))}><i>I</i></button>
      <button type="button" className="btn ghost sm" onClick={() => line("- ")}>• {T(L("List", "Список", "Список", "قائمة"))}</button>
      <button type="button" className="btn ghost sm" onClick={() => line("1. ")}>1. {T(L("Steps", "Шаги", "Кроки", "خطوات"))}</button>
      <button type="button" className="btn ghost sm" onClick={() => line("### ")}>H</button>
      <button type="button" className="btn ghost sm" onClick={() => wrap("[", "](https://)")}><Icon n="link" /></button>
      <span style={{ flex: 1 }} /><button type="button" className={`btn ghost sm ${prev ? "on" : ""}`} onClick={() => setPrev(!prev)}><Icon n="eye" />{T(L("Preview", "Просмотр", "Перегляд", "معاينة"))}</button></div>}
    {prev ? <div className="md rich-view" dangerouslySetInnerHTML={{ __html: mdHtml(value) || "<p>—</p>" }} />
      : <textarea ref={ref} id={id} className="input" rows={5} value={value || ""} onChange={(e) => set(e.target.value)} />}
  </div>;
}

/* ---------------- Comments with @mentions ---------------- */
const MENTION = /@\[([^\]]{1,120})\]\(([0-9a-fA-F-]{36})\)/g;
/** Plain text of a comment (mentions as @Name). */
export const commentText = (s: string) => String(s || "").replace(MENTION, "@$1");
/** A comment with mentions shown as names and links kept safe. */
export function CommentBody({ body }: { body: string }) {
  const { me } = useApp();
  const parts: React.ReactNode[] = []; let last = 0; let m: RegExpExecArray | null; const re = new RegExp(MENTION.source, "g");
  while ((m = re.exec(body))) { if (m.index > last) parts.push(body.slice(last, m.index)); parts.push(<span key={m.index} className={`mention ${m[2] === me.id ? "me" : ""}`}>@{m[1]}</span>); last = m.index + m[0].length; }
  if (last < body.length) parts.push(body.slice(last));
  return <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{parts}</div>;
}

/** Comment box: typing @ suggests colleagues who can read this record; the mention is stored by account. */
export function MentionInput({ value, onChange, onSubmit, placeholder, candidates, label, onQuery }: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string; candidates: Profile[]; label: string; onQuery?: (q: string) => void }) {
  const { lang } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState<string | null>(null); const [sel, setSel] = useState(0);
  const hits = useMemo(() => (q === null ? [] : candidates.filter((p) => personName(p).toLowerCase().includes(q.toLowerCase())).slice(0, 6)), [q, candidates]);
  const detect = (v: string, pos: number) => { const m = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(v.slice(0, pos)); setQ(m ? m[2] : null); setSel(0); if (m) onQuery?.(m[2]); };
  const pick = (p: Profile) => {
    const el = ref.current!; const pos = el.selectionStart; const before = value.slice(0, pos).replace(/@([\p{L}\p{N}._-]{0,30})$/u, ""); const tag = `@[${personName(p).replace(/[[\]]/g, "")}](${p.id}) `;
    onChange(before + tag + value.slice(pos)); setQ(null); requestAnimationFrame(() => { el.focus(); const c = (before + tag).length; el.setSelectionRange(c, c); });
  };
  return <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
    <textarea ref={ref} className="input" rows={value.length > 60 ? 3 : 1} value={value} placeholder={placeholder} aria-label={label} style={{ resize: "vertical", minHeight: 40 }}
      onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
      onKeyDown={(e) => {
        if (q !== null && hits.length) { if (e.key === "ArrowDown") { e.preventDefault(); setSel((sel + 1) % hits.length); return; } if (e.key === "ArrowUp") { e.preventDefault(); setSel((sel - 1 + hits.length) % hits.length); return; } if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(hits[sel]); return; } if (e.key === "Escape") { setQ(null); return; } }
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
      }} />
    {q !== null && hits.length > 0 && <div className="ref-menu mention-menu" role="listbox">{hits.map((p, i) => <button key={p.id} type="button" role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}><b>{personName(p)}</b><span className="faint">{deptLabel(p.department, lang as Lang) || p.role}</span></button>)}</div>}
  </div>;
}
