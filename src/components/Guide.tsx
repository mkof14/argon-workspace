"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO } from "@/lib/store";
import { svgIcon } from "@/lib/icons";
import { DEPARTMENTS, ROLES, allSections, PRODUCT_CONFIGS, DEPT_COLORS } from "@/config/workspace.config.mjs";
import { APPROVALS } from "@/config/approvals";
import { guideBlocks, type Block, type GuideSources } from "@/lib/guidemodel";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const NAMES: Record<string, string> = { en: "English", ru: "Русский", uk: "Українська", ar: "العربية" };
const LANGS = ["en", "ru", "uk", "ar"];
type Manifest = { version?: string; built?: string; langs?: Record<string, { pages: number; size: number; version: string }> };

/** PDF versions of the guide in one dropdown: the interface language first. */
function PdfMenu({ lang, man, T }: { lang: string; man: Manifest | null; T: (x: T4) => string }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  const order = [lang, ...LANGS.filter((l) => l !== lang)];
  const meta = (l: string) => { const m = man?.langs?.[l]; return m ? `${m.pages} ${T(L("pages", "стр.", "стор.", "صفحة"))} · ${mb(m.size)} · v${m.version}` : DEMO ? T(L("available on the live site", "доступно на рабочем сайте", "доступно на робочому сайті", "متاح على الموقع الفعلي")) : "PDF"; };
  return <div className="gd-pdfm" ref={ref}>
    <span className="gd-pdfm-btns">
      <a className="btn" href={`/api/guide?lang=${lang}`} target="_blank" rel="noopener"><Icon n="pdf" />{T(L("Open PDF", "Открыть PDF", "Відкрити PDF", "فتح PDF"))}</a>
      <button className="btn gd-pdfm-t" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} title={T(L("All languages", "Все языки", "Усі мови", "كل اللغات"))}><Icon n="globe" /><span>{lang.toUpperCase()}</span><Icon n="down" /></button>
    </span>
    {open && <div className="gd-pdfm-menu" role="menu">
      <div className="gd-pdfm-h">{T(L("User guide in PDF", "Руководство в PDF", "Посібник у PDF", "الدليل بصيغة PDF"))}</div>
      {order.map((l) => <div key={l} className={`gd-pdfm-row ${l === lang ? "cur" : ""}`} role="menuitem">
        <span className="gd-pdfm-l">{l.toUpperCase()}</span>
        <span className="gd-pdfm-n"><b>{NAMES[l]}</b><small>{meta(l)}</small></span>
        <a className="iconbtn" href={`/api/guide?lang=${l}`} target="_blank" rel="noopener" title={T(L("Open", "Открыть", "Відкрити", "فتح"))} onClick={() => setOpen(false)}><Icon n="eye" /></a>
        <a className="iconbtn" href={`/api/guide?lang=${l}&dl=1`} title={T(L("Download", "Скачать", "Завантажити", "تنزيل"))} onClick={() => setOpen(false)}><Icon n="download" /></a>
      </div>)}
    </div>}
  </div>;
}

/** User guide: the whole system described in the interface language, built live from the current configuration; PDFs in four languages. */
export default function Guide() {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [blocks, setBlocks] = useState<Block[] | null>(null); const [man, setMan] = useState<Manifest | null>(null); const [toc, setToc] = useState(false);
  const [cur, setCur] = useState("");
  useEffect(() => {
    let live = true;
    (async () => {
      const [{ HANDBOOK }, Lr, text] = await Promise.all([import("@/config/handbook"), import("@/config/learn"), import(`@/config/guide/${lang}`)]);
      const dict = lang === "uk" || lang === "ar" ? await import("@/config/learn-i18n").then((m) => ({ uk: m.UK, ar: m.AR })) : {};
      const src: GuideSources = { hb: HANDBOOK as any, help: Lr.HELP as any, glossary: Lr.GLOSSARY as any, faq: Lr.SEED_FAQ as any, dict: dict as any,
        depts: DEPARTMENTS as any, secs: allSections() as any, roles: ROLES as any, approvals: APPROVALS as any, configs: PRODUCT_CONFIGS as any, icon: svgIcon, colors: DEPT_COLORS as any };
      const md = (s: string) => DOMPurify.sanitize(marked.parse(String(s || ""), { gfm: true, async: false }) as string);
      if (live) setBlocks(guideBlocks(lang, src, text.default, md));
    })().catch(() => live && setBlocks([]));
    return () => { live = false; };
  }, [lang]);
  useEffect(() => { if (DEMO) { setMan({}); return; } fetch("/api/guide?manifest=1").then((r) => (r.ok ? r.json() : {})).then(setMan).catch(() => setMan({})); }, []);
  // highlight the chapter being read in the contents
  useEffect(() => {
    if (!blocks?.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setCur(v.target.id.slice(2)); }, { rootMargin: "0px 0px -70% 0px" });
    blocks.forEach((b) => { const el = document.getElementById(`g-${b.id}`); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [blocks]);
  const S = useMemo(() => ({ part: T(L("Part", "Часть", "Частина", "الجزء")), chapter: T(L("Chapter", "Глава", "Розділ", "الفصل")), chapters: T(L("chapters", "глав", "розділів", "فصول")) }), [lang]); // eslint-disable-line
  const go = (id: string) => { document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setToc(false); };
  const parts = useMemo(() => {
    const out: { b: Block; ch: Block[] }[] = [];
    for (const b of blocks || []) if (b.kind === "part") out.push({ b, ch: [] }); else if (out.length && b.id !== "app") out[out.length - 1].ch.push(b);
    return out;
  }, [blocks]);
  const nCh = (blocks || []).filter((b) => b.kind === "chapter").length;
  const tile = (b: Block, cls = "gd-tile") => <span className={cls} style={b.color ? ({ "--c": b.color } as any) : undefined} dangerouslySetInnerHTML={{ __html: svgIcon(b.icon || "book") }} />;

  return <div className="gd-wrap" dir={lang === "ar" ? "rtl" : "ltr"}>
    <div className="gd-hero">
      <div className="gd-hero-t">
        <div className="gd-k"><Icon n="book" />{T(L("Workspace handbook", "Справочник Workspace", "Довідник Workspace", "مرجع مساحة العمل"))}</div>
        <h1>{T(L("User guide", "Руководство пользователя", "Посібник користувача", "دليل المستخدم"))}</h1>
        <p>{T(L("The whole system step by step: structure, sections, processes, roles, approvals, agents and AI. The page is built from the current configuration and changes together with Workspace; the PDF is rebuilt with every release.", "Вся система по шагам: устройство, разделы, процессы, роли, согласования, агенты и ИИ. Страница собирается из текущей конфигурации и меняется вместе с Workspace; PDF пересобирается с каждым выпуском.", "Уся система крок за кроком: будова, розділи, процеси, ролі, погодження, агенти та ШІ. Сторінка збирається з поточної конфігурації й змінюється разом із Workspace; PDF перезбирається з кожним випуском.", "النظام كله خطوة بخطوة: البنية والأقسام والعمليات والأدوار والموافقات والوكلاء والذكاء الاصطناعي. تُبنى الصفحة من الإعدادات الحالية وتتغير مع مساحة العمل؛ ويُعاد بناء ملف PDF مع كل إصدار."))}</p>
        <div className="gd-stats">
          <span><b>{parts.length || 7}</b>{T(L("parts", "частей", "частин", "أجزاء"))}</span>
          <span><b>{nCh || "…"}</b>{S.chapters}</span>
          <span><b>4</b>{T(L("languages", "языка", "мови", "لغات"))}</span>
          {man?.version ? <span><b>v{man.version}</b>{T(L("PDF edition", "издание PDF", "видання PDF", "إصدار PDF"))}</span> : null}
        </div>
      </div>
      <PdfMenu lang={lang} man={man} T={T} />
    </div>

    {!blocks ? <div className="card" style={{ padding: 24 }}>…</div> : <>
      <div className="gd-parts">{parts.map(({ b, ch }) => <button key={b.id} className="gd-pcard" onClick={() => go(b.id)}>
        {tile(b)}<span><small>{S.part} {b.num}</small><b>{b.title}</b><em>{T(L("Chapters", "Глав", "Розділів", "الفصول"))}: {ch.length}</em></span></button>)}</div>
      <div className="gd">
        <aside className={`gd-toc card ${toc ? "open" : ""}`}><button className="btn ghost sm gd-toc-btn" onClick={() => setToc(!toc)}><Icon n="menu" />{T(L("Contents", "Содержание", "Зміст", "المحتويات"))}</button>
          <nav>{blocks.map((b) => <button key={b.id} className={`gd-t ${b.kind} ${cur === b.id ? "on" : ""}`} onClick={() => go(b.id)}>
            {b.kind === "part" ? <><span className="gd-ti" dangerouslySetInnerHTML={{ __html: svgIcon(b.icon || "book") }} />{`${S.part} ${b.num}. ${b.title}`}</> : b.num ? `${b.num}. ${b.title}` : b.title}</button>)}</nav></aside>
        <div className="gd-body">{blocks.map((b) => b.kind === "part"
          ? <section key={b.id} id={`g-${b.id}`} className="gd-part"><span className="gd-part-i" dangerouslySetInnerHTML={{ __html: svgIcon(b.icon || "book") }} /><div className="gd-pn">{S.part} {b.num}</div><h2>{b.title}</h2><p>{b.lead}</p>
            <div className="gd-part-ch">{parts.find((p) => p.b.id === b.id)?.ch.map((c) => <button key={c.id} onClick={() => go(c.id)}><em>{c.num}</em>{c.title}</button>)}</div></section>
          : <section key={b.id} id={`g-${b.id}`} className="card gd-ch"><div className="gd-ch-h">{tile(b)}<div>{b.num ? <div className="gd-cn">{S.chapter} {b.num}</div> : null}<h2>{b.title}</h2></div></div><div className="gd-html" dangerouslySetInnerHTML={{ __html: b.html }} /></section>)}</div>
      </div>
    </>}
  </div>;
}
