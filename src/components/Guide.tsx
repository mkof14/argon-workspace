"use client";
import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO } from "@/lib/store";
import { DEPARTMENTS, ROLES, allSections, PRODUCT_CONFIGS } from "@/config/workspace.config.mjs";
import { APPROVALS } from "@/config/approvals";
import { guideBlocks, type Block, type GuideSources } from "@/lib/guidemodel";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const NAMES: Record<string, string> = { en: "English", ru: "Русский", uk: "Українська", ar: "العربية" };
type Manifest = { version?: string; built?: string; langs?: Record<string, { pages: number; size: number; version: string }> };

/** User guide: the whole system described in the interface language, built live from the current configuration; PDFs in four languages. */
export default function Guide() {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [blocks, setBlocks] = useState<Block[] | null>(null); const [man, setMan] = useState<Manifest | null>(null); const [toc, setToc] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      const [{ HANDBOOK }, Lr, text] = await Promise.all([import("@/config/handbook"), import("@/config/learn"), import(`@/config/guide/${lang}`)]);
      const dict = lang === "uk" || lang === "ar" ? await import("@/config/learn-i18n").then((m) => ({ uk: m.UK, ar: m.AR })) : {};
      const src: GuideSources = { hb: HANDBOOK as any, help: Lr.HELP as any, glossary: Lr.GLOSSARY as any, faq: Lr.SEED_FAQ as any, dict: dict as any,
        depts: DEPARTMENTS as any, secs: allSections() as any, roles: ROLES as any, approvals: APPROVALS as any, configs: PRODUCT_CONFIGS as any };
      const md = (s: string) => DOMPurify.sanitize(marked.parse(String(s || ""), { gfm: true, async: false }) as string);
      if (live) setBlocks(guideBlocks(lang, src, text.default, md));
    })().catch(() => live && setBlocks([]));
    return () => { live = false; };
  }, [lang]);
  useEffect(() => { if (DEMO) { setMan({}); return; } fetch("/api/guide?manifest=1").then((r) => (r.ok ? r.json() : {})).then(setMan).catch(() => setMan({})); }, []);
  const S = useMemo(() => ({ part: T(L("Part", "Часть", "Частина", "الجزء")), chapter: T(L("Chapter", "Глава", "Розділ", "الفصل")) }), [lang]); // eslint-disable-line
  const go = (id: string) => { document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setToc(false); };
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

  return <div className="gd-wrap" dir={lang === "ar" ? "rtl" : "ltr"}>
    <div className="card gd-head">
      <div><div className="eyebrow-s">{T(L("Workspace", "Workspace", "Workspace", "مساحة العمل"))}</div>
        <h1>{T(L("User guide", "Руководство пользователя", "Посібник користувача", "دليل المستخدم"))}</h1>
        <p className="faint">{T(L("The whole system step by step: structure, sections, processes, roles, approvals, agents and AI. This page is built from the current configuration and changes together with Workspace; the PDF is rebuilt with every release.", "Вся система по шагам: устройство, разделы, процессы, роли, согласования, агенты и ИИ. Эта страница собирается из текущей конфигурации и меняется вместе с Workspace; PDF пересобирается с каждым выпуском.", "Уся система крок за кроком: будова, розділи, процеси, ролі, погодження, агенти та ШІ. Ця сторінка збирається з поточної конфігурації й змінюється разом із Workspace; PDF перезбирається з кожним випуском.", "النظام كله خطوة بخطوة: البنية والأقسام والعمليات والأدوار والموافقات والوكلاء والذكاء الاصطناعي. تُبنى هذه الصفحة من الإعدادات الحالية وتتغير مع مساحة العمل؛ ويُعاد بناء ملف PDF مع كل إصدار."))}</p></div>
      <div className="gd-pdfs">{["en", "ru", "uk", "ar"].map((l) => { const m = man?.langs?.[l]; return <div key={l} className="gd-pdf">
        <b>{NAMES[l]}</b><small className="faint">{m ? `PDF · ${m.pages} ${T(L("pages", "стр.", "стор.", "صفحة"))} · ${mb(m.size)} · v${m.version}` : DEMO ? T(L("available on the live site", "доступно на рабочем сайте", "доступно на робочому сайті", "متاح على الموقع الفعلي")) : "PDF"}</small>
        <span className="toolbar" style={{ gap: 6 }}><a className="btn sm" href={`/api/guide?lang=${l}`} target="_blank" rel="noopener"><Icon n="eye" />{T(L("Open", "Открыть", "Відкрити", "فتح"))}</a><a className="btn ghost sm" href={`/api/guide?lang=${l}&dl=1`}><Icon n="download" />{T(L("Download", "Скачать", "Завантажити", "تنزيل"))}</a></span></div>; })}</div>
    </div>
    {!blocks ? <div className="card" style={{ padding: 24 }}>…</div> : <div className="gd">
      <aside className={`gd-toc card ${toc ? "open" : ""}`}><button className="btn ghost sm gd-toc-btn" onClick={() => setToc(!toc)}><Icon n="menu" />{T(L("Contents", "Содержание", "Зміст", "المحتويات"))}</button>
        <nav>{blocks.map((b) => <button key={b.id} className={`gd-t ${b.kind}`} onClick={() => go(b.id)}>{b.kind === "part" ? `${S.part} ${b.num}. ${b.title}` : b.num ? `${b.num}. ${b.title}` : b.title}</button>)}</nav></aside>
      <div className="gd-body">{blocks.map((b) => b.kind === "part"
        ? <section key={b.id} id={`g-${b.id}`} className="gd-part"><div className="gd-pn">{S.part} {b.num}</div><h2>{b.title}</h2><p>{b.lead}</p></section>
        : <section key={b.id} id={`g-${b.id}`} className="card gd-ch">{b.num ? <div className="gd-cn">{S.chapter} {b.num}</div> : null}<h2>{b.title}</h2><div className="gd-html" dangerouslySetInnerHTML={{ __html: b.html }} /></section>)}</div>
    </div>}
  </div>;
}
