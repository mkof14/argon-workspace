"use client";
// KNOWLEDGE: company procedures, product and engineering know-how, training and FAQ in one place. Articles are records
// of the knowledge base (company.wiki) with an owner, reviewer, category, language, version and review dates; only
// Published articles are shown to everyone, and a newer article replaces (supersedes) the old one. The Learning
// Center (how Workspace works, the handbook and the FAQ in four languages) stays where it is and is linked here.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { tone } from "@/lib/format";
import { KNOWLEDGE_CATEGORIES } from "@/config/workspace.config.mjs";
import { store, type CorpHit, type Rec, type Taxon } from "@/lib/store";
import { mdHtml, personName } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const qs = (k: string) => (typeof window !== "undefined" ? new URLSearchParams(location.search).get(k) || "" : "");

export default function Knowledge() {
  const { lang, people, me, access, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang); const today = new Date().toISOString().slice(0, 10);
  const [all, setAll] = useState<Rec[] | null>(null); const [cats, setCats] = useState<Taxon[]>([]);
  const [cat, setCat] = useState(""); const [q, setQ] = useState(() => qs("q")); const [hits, setHits] = useState<CorpHit[] | null>(null);
  const [open, setOpen] = useState(() => qs("a"));
  useEffect(() => { store.list("company.wiki").then(setAll).catch(() => setAll([])); store.taxonomy("knowledge_category").then(setCats).catch(() => {}); }, [tick]);
  useEffect(() => { const s = q.trim(); if (s.length < 2) { setHits(null); return; } const h = setTimeout(() => store.corpSearch(s, { types: ["knowledge", "document", "document_text"] }, 30).then(setHits).catch(() => setHits([])), 220); return () => clearTimeout(h); }, [q]);
  const catList = cats.length ? cats.filter((c) => c.active).map((c) => ({ code: c.code, label: c.label?.[lang] || c.label?.en || c.code })) : (KNOWLEDGE_CATEGORIES as string[]).map((c) => ({ code: c, label: c }));
  const published = useMemo(() => (all || []).filter((r) => (r.status || "Published") === "Published" && (!cat || r.data?.category === cat)).sort((a, b) => a.title.localeCompare(b.title)), [all, cat]);
  const mine = (all || []).filter((r) => ["Draft", "Review"].includes(r.status || "") && (r.created_by === me.id || r.data?.owner_id === me.id || r.data?.reviewer_id === me.id));
  const due = (all || []).filter((r) => r.status === "Published" && r.data?.next_review && r.data.next_review < today && (r.data?.owner_id === me.id || ["owner", "admin", "management"].includes(me.role)));
  const art = (all || []).find((r) => r.id === open) || null;
  const who = (id?: string) => personName(people.find((p) => p.id === id)) || "—";
  const go = (id: string) => { setOpen(id); try { const u = new URL(location.href); if (id) u.searchParams.set("a", id); else u.searchParams.delete("a"); history.replaceState(history.state, "", u.toString()); } catch {} };
  const card = (r: Rec) => <button key={r.id} type="button" className="kb-item" onClick={() => go(r.id)} data-article={r.id}><b>{r.title}</b><small>{[r.data?.doc_number, r.data?.category, r.data?.language?.toUpperCase(), r.data?.version ? `v${r.data.version}` : ""].filter(Boolean).join(" · ")}</small>{r.data?.summary && <span className="faint">{String(r.data.summary).slice(0, 160)}</span>}</button>;
  return <div className="knowledge" style={{ display: "grid", gap: 16, ["--dc" as any]: "#0E9F6E" }}>
    <section className="sec-hero"><span className="ic"><Icon n="book" /></span>
      <div style={{ minWidth: 0, position: "relative", zIndex: 1 }}><div className="eyebrow">{T(L("Company", "Компания", "Компанія", "الشركة"))}</div><h2>{T(L("Knowledge", "Знания", "Знання", "المعرفة"))}</h2>
        <div className="sec-desc">{T(L("Current procedures, product and engineering know-how, training and answers — only published, reviewed articles appear here. How Workspace itself works is in the Learning Center.", "Действующие процедуры, знания о продукте и инженерии, обучение и ответы — здесь только опубликованные проверенные статьи. Как устроен сам Workspace — в Learning Center.", "Чинні процедури, знання про продукт та інженерію, навчання й відповіді — тут лише опубліковані перевірені статті. Як влаштований сам Workspace — у Learning Center.", "الإجراءات السارية ومعرفة المنتج والهندسة والتدريب والإجابات — هنا المقالات المنشورة والمراجعة فقط. طريقة عمل مساحة العمل نفسها في مركز التعلّم."))}</div></div></section>
    <div className="toolbar">{access.write.has("company.wiki") && <Link className="btn primary" href="/company/wiki?new=1"><Icon n="plus" />{T(L("New article", "Новая статья", "Нова стаття", "مقال جديد"))}</Link>}
      <Link className="btn ghost sm" href="/learn"><Icon n="lifebuoy" />{T(L("Learning Center", "Learning Center", "Learning Center", "مركز التعلّم"))}</Link><Link className="btn ghost sm" href="/company/wiki"><Icon n="list" />{T(L("All articles (table)", "Все статьи (таблица)", "Усі статті (таблиця)", "كل المقالات (جدول)"))}</Link></div>
    <section className="card"><div className="filters"><div className="search" style={{ flex: 2 }}><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T(L("Search procedures, articles and documents", "Поиск процедур, статей и документов", "Пошук процедур, статей і документів", "ابحث في الإجراءات والمقالات والمستندات"))} aria-label={T(L("Search knowledge", "Поиск знаний", "Пошук знань", "ابحث في المعرفة"))} /></div></div>
      {hits && <div className="feed" style={{ padding: "0 8px 8px" }} data-kb-hits={hits.length}>{hits.length ? hits.map((h) => <Link key={h.kind + h.id + h.link} href={h.kind === "knowledge" ? `/knowledge?a=${h.id}` : h.link} className="hub-row" onClick={(e) => { if (h.kind === "knowledge") { e.preventDefault(); go(h.id); } }}>
        <span className="dic"><Icon n={h.kind === "knowledge" ? "book" : "file"} /></span><span style={{ minWidth: 0, flex: 1 }}><b>{h.title}</b><small>{h.kind === "knowledge" ? T(L("Article", "Статья", "Стаття", "مقال")) : h.kind === "document_text" ? T(L("Inside a document", "В тексте документа", "У тексті документа", "داخل مستند")) : T(L("Document", "Документ", "Документ", "مستند"))}{h.version ? ` · v${h.version}` : ""} — {h.excerpt?.replace(/[«»]/g, "")}</small></span></Link>)
        : <div className="empty">{T(L("Nothing found.", "Ничего не найдено.", "Нічого не знайдено.", "لا نتائج."))}</div>}</div>}</section>
    {art && <article className="card kb-article" data-open-article={art.id}><div className="card-h toolbar"><h2>{art.title}</h2><span className={`chip dot ${tone(art.status || "")}`}>{art.status}</span>
        <Link className="btn ghost sm" style={{ marginInlineStart: "auto" }} href={`/company/wiki?r=${art.id}`}><Icon n="edit" />{T(L("Open record", "Открыть запись", "Відкрити запис", "افتح السجل"))}</Link><button className="iconbtn" aria-label={T(L("Close", "Закрыть", "Закрити", "إغلاق"))} onClick={() => go("")}><Icon n="x" /></button></div>
      <div className="card-b" style={{ display: "grid", gap: 10 }}>
        <div className="toolbar kb-meta"><span className="chip mono">{art.data?.doc_number || "—"}</span>{art.data?.category && <span className="chip">{art.data.category}</span>}{art.data?.language && <span className="chip">{art.data.language.toUpperCase()}</span>}{art.data?.version && <span className="chip mono">v{art.data.version}</span>}
          <span className="chip">{T(L("Owner", "Владелец", "Власник", "المالك"))}: {who(art.data?.owner_id)}</span>{art.data?.last_reviewed && <span className="chip">{T(L("Reviewed", "Проверено", "Перевірено", "روجع"))} {art.data.last_reviewed}</span>}{art.data?.next_review && <span className={`chip ${art.data.next_review < today ? "c-warn" : ""}`}>{T(L("Next review", "Следующая проверка", "Наступна перевірка", "المراجعة التالية"))} {art.data.next_review}</span>}
          {art.data?.superseded_by && <button className="chip c-warn" onClick={() => go(art.data.superseded_by)}>{T(L("Replaced by a newer article →", "Заменена более новой статьёй →", "Замінена новішою статтею →", "حل محله مقال أحدث ←"))}</button>}</div>
        {art.data?.summary && <p className="kb-summary">{art.data.summary}</p>}
        <div className="md" dangerouslySetInnerHTML={{ __html: mdHtml(art.data?.body || "") }} />
        {art.data?.documents && <small className="faint">{T(L("Related documents", "Связанные документы", "Пов'язані документи", "مستندات مرتبطة"))}: {art.data.documents}</small>}</div></article>}
    {(mine.length > 0 || due.length > 0) && <div className="hub-grid">
      {mine.length > 0 && <section className="card hub-card"><div className="card-h"><h2><Icon n="edit" />{T(L("My drafts and reviews", "Мои черновики и проверки", "Мої чернетки й перевірки", "مسوداتي ومراجعاتي"))}</h2></div><div className="feed">{mine.map((r) => <Link key={r.id} href={`/company/wiki?r=${r.id}`} className="hub-row"><span><b>{r.title}</b><small>{r.status}{r.data?.reviewer_id === me.id ? ` · ${T(L("you review", "проверяете вы", "перевіряєте ви", "تراجعه أنت"))}` : ""}</small></span></Link>)}</div></section>}
      {due.length > 0 && <section className="card hub-card"><div className="card-h"><h2><Icon n="clock" />{T(L("Review date passed", "Пора пересмотреть", "Час переглянути", "حان موعد المراجعة"))}</h2></div><div className="feed">{due.map((r) => <Link key={r.id} href={`/company/wiki?r=${r.id}`} className="hub-row"><span><b>{r.title}</b><small>{r.data?.next_review}</small></span></Link>)}</div></section>}</div>}
    <section className="card"><div className="card-h"><h2><Icon n="layers" />{T(L("Published articles", "Опубликованные статьи", "Опубліковані статті", "المقالات المنشورة"))}</h2></div>
      <nav className="notice-tabs" role="tablist"><button className={!cat ? "on" : ""} onClick={() => setCat("")}>{T(L("All", "Все", "Усі", "الكل"))}</button>{catList.map((c) => <button key={c.code} className={cat === c.code ? "on" : ""} onClick={() => setCat(c.code)} data-kbcat={c.code}>{c.label}</button>)}</nav>
      <div className="kb-grid">{all === null ? <div className="empty">…</div> : published.length ? published.map(card) : <div className="empty">{T(L("No published articles in this category yet.", "В этой категории пока нет опубликованных статей.", "У цій категорії ще немає опублікованих статей.", "لا مقالات منشورة في هذه الفئة بعد."))}</div>}</div></section>
  </div>;
}
