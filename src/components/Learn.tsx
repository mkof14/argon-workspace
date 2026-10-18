"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp, SECTIONS } from "./App";
import { DEPARTMENTS, DEPT_COLORS } from "@/config/workspace.config.mjs";
import { GLOSSARY, GUIDES, HELP, l2 } from "@/config/learn";
import { t, tx } from "@/lib/i18n";
import { Faq, isExternal, store } from "@/lib/store";

import type { HB } from "@/config/handbook";

const HOW = { en: "How it works", ru: "Как всё устроено", uk: "Як усе влаштовано", ar: "كيف يعمل كل شيء" } as Record<string, string>;
const HOW_SUB = { en: "The full handbook: how Workspace, roles, records, approvals, AI, rules and agents work — with steps and limits.", ru: "Полный справочник: как работают Workspace, роли, записи, согласования, ИИ, правила и агенты — с шагами и ограничениями.", uk: "Повний довідник: як працюють Workspace, ролі, записи, погодження, ШІ, правила й агенти — з кроками та обмеженнями.", ar: "الدليل الكامل: كيف تعمل مساحة العمل والأدوار والسجلات والموافقات والذكاء الاصطناعي والقواعد والوكلاء — بالخطوات والحدود." } as Record<string, string>;
const md = (x: string) => DOMPurify.sanitize(marked.parse(x) as string);
const lines = (s: string) => { const [first, ...rest] = s.split("\n"); return { first, bullets: rest.map((x) => x.replace(/^(-|\d+\.)\s*/, "")).filter(Boolean) }; };

export default function Learn() {
  const { lang, me, access, toast, openAi, tick } = useApp();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const [tab, setTab] = useState<"how" | "guide" | "terms" | "faq">((params?.get("tab") as any) || (params?.get("s") ? "guide" : "how"));
  const [hb, setHb] = useState<HB[]>([]);
  const [hc, setHc] = useState<string>(params?.get("c") || "");
  useEffect(() => { import("@/config/handbook").then((m) => setHb(m.HANDBOOK)).catch(() => {}); }, []);
  useEffect(() => { if (hc && hb.length) setTimeout(() => document.getElementById(`hb-${hc}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 200); }, [hc, hb.length]);
  const [q, setQ] = useState(params?.get("q") || "");
  const [focus] = useState(params?.get("s") || "");
  const [faq, setFaq] = useState<Faq[]>([]);
  const [gd, setGd] = useState<string>(() => { const f = params?.get("s"); return f ? f.split(".")[0] : "basics"; });
  const [td, setTd] = useState<string>("all");
  const [fd, setFd] = useState<string>("all");
  const [allLangs, setAllLangs] = useState(false);
  const [edit, setEdit] = useState<Partial<Faq> | null>(null);
  const editor = ["owner", "admin", "management", "legal"].includes(me.role);
  const fl: string = lang; // FAQ entries are stored per language: en, ru, uk, ar

  const loadFaq = () => store.faqList().then(setFaq).catch(() => {});
  useEffect(() => { loadFaq(); }, [tick]); // eslint-disable-line
  useEffect(() => { if (focus) setTimeout(() => document.getElementById(`h-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300); }, [focus]);

  const ql = q.trim().toLowerCase();
  const hit = (...xs: string[]) => !ql || xs.some((x) => x.toLowerCase().includes(ql));
  const depts = DEPARTMENTS.map((d: any) => ({ ...d, secs: SECTIONS.filter((s) => s.dept === d.key && access.read.has(s.id)) })).filter((d: any) => d.secs.length);

  const shownFaq = useMemo(() => faq.filter((f) => (allLangs || f.lang === fl) && hit(f.question, f.answer) && (fd === "all" || (fd === "general" ? !f.section : !!f.section?.startsWith(fd + "."))))
    .sort((a, b) => Number(b.verified) - Number(a.verified) || b.hits - a.hits), [faq, allLangs, fl, ql, fd]); // eslint-disable-line

  const saveEdit = async () => {
    if (!edit?.question?.trim() || !edit.answer?.trim()) return;
    try { await store.faqSave({ ...(edit as any), question: edit.question.trim(), answer: edit.answer.trim(), lang: edit.lang || fl }); toast(t("saved", lang)); setEdit(null); loadFaq(); }
    catch (e: any) { toast(e.message || "Error", true); }
  };
  const toggleVerified = async (f: Faq) => { try { await store.faqSave({ ...f, verified: !f.verified }, { translate: false }); loadFaq(); } catch (e: any) { toast(e.message, true); } };
  const del = async (f: Faq) => { try { await store.faqDelete(f.id); loadFaq(); } catch (e: any) { toast(e.message, true); } };

  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#14B8A6" }}>
      <section className="sec-hero">
        <span className="ic"><Icon n="lifebuoy" /></span>
        <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}><div className="eyebrow" style={{ color: "var(--dc)" }}>{t("workspace", lang)}</div><h2>{t("learn", lang)}</h2>
          <div className="sec-desc">{t("learn_sub", lang)}</div></div>
        <div className="stats">
          <button className={`stat ${tab === "how" ? "on" : ""}`} onClick={() => setTab("how")}><b style={{ color: "var(--dc)" }}>{hb.length || 19}</b><small>{HOW[lang] || HOW.en}</small></button>
          <button className={`stat ${tab === "guide" ? "on" : ""}`} onClick={() => setTab("guide")}><b style={{ color: "var(--dc)" }}>{depts.reduce((a: number, d: any) => a + d.secs.length, 0)}</b><small>{t("guide", lang)}</small></button>
          <button className={`stat ${tab === "terms" ? "on" : ""}`} onClick={() => setTab("terms")}><b style={{ color: "var(--dc)" }}>{Object.values(GLOSSARY).reduce((a, x) => a + x.length, 0)}</b><small>{t("terms", lang)}</small></button>
          <button className={`stat ${tab === "faq" ? "on" : ""}`} onClick={() => setTab("faq")}><b style={{ color: "var(--dc)" }}>{faq.filter((f) => f.lang === fl).length}</b><small>FAQ</small></button>
        </div>
      </section>

      <div className="card">
        <div className="tabs">
          <button className={tab === "how" ? "on" : ""} onClick={() => setTab("how")}><Icon n="layers" />{HOW[lang] || HOW.en}</button>
          <button className={tab === "guide" ? "on" : ""} onClick={() => setTab("guide")}><Icon n="book" />{t("guide", lang)}</button>
          <button className={tab === "terms" ? "on" : ""} onClick={() => setTab("terms")}><Icon n="tag" />{t("terms", lang)}</button>
          <button className={tab === "faq" ? "on" : ""} onClick={() => setTab("faq")}><Icon n="info" />FAQ</button>
        </div>
        <div className="filters" style={{ borderBottom: 0 }}><div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("learn_search", lang)} aria-label={t("learn_search", lang)} /></div>
          {tab === "faq" && <label className="check"><input type="checkbox" checked={allLangs} onChange={(e) => setAllLangs(e.target.checked)} />EN · RU · UA · AR</label>}
          {tab === "faq" && !isExternal(me.role) && <button className="btn primary" onClick={() => setEdit({ question: q, answer: "", lang: fl })}><Icon n="plus" />{t("add_question", lang)}</button>}
        </div>
      </div>

      {tab === "how" && (() => {
        const hl = (lang in HOW ? lang : "en") as "en" | "ru" | "uk" | "ar";
        const list = hb.filter((c) => hit(c.title[hl], c.body[hl]));
        return <div style={{ display: "grid", gap: 10, ["--dc" as any]: "#14B8A6" }}>
          <div className="faint" style={{ fontSize: 14 }}>{HOW_SUB[hl]}</div>
          <nav className="chipbar hb-toc" aria-label={HOW[hl]}>{hb.map((c, i) => <button key={c.id} className={hc === c.id ? "on" : ""} onClick={() => { setHc(c.id); const d = document.getElementById(`hb-${c.id}`) as HTMLDetailsElement | null; if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); } }}><span className="mono" style={{ opacity: .6 }}>{i + 1}</span>{c.title[hl]}</button>)}</nav>
          {!hb.length ? <div className="card empty">…</div> : !list.length ? <div className="card empty">{t("no_match", lang)}</div> : <div className="guides hb-list">{list.map((c) => (
            <details key={c.id} id={`hb-${c.id}`} className={`guide-row hb ${hc === c.id ? "hl" : ""}`} open={!!ql || hc === c.id || (!hc && c.id === "overview")}>
              <summary><span className="flag"><Icon n={c.icon} /></span><span className="t"><b>{c.title[hl]}</b></span><Icon n="down" className="lockico" /></summary>
              <div className="body"><div className="md" dangerouslySetInnerHTML={{ __html: md(c.body[hl]) }} />
                <div className="toolbar"><button className="btn ghost sm" onClick={() => { const u = `${location.origin}/learn?tab=how&c=${c.id}`; navigator.clipboard?.writeText(u).then(() => toast(t("copied", lang))).catch(() => {}); }}><Icon n="link" />{({ en: "Copy link", ru: "Ссылка", uk: "Посилання", ar: "نسخ الرابط" } as any)[lang] || "Copy link"}</button>
                  <button className="btn ghost sm" onClick={() => openAi({ title: c.title[hl], ask: "" })}><Icon n="spark" />{t("ask_ai", lang)}</button></div>
              </div>
            </details>))}</div>}
        </div>;
      })()}

      {tab === "guide" && <>
        <div className="chipbar" role="tablist">
          <button className={gd === "basics" ? "on" : ""} style={{ ["--dc" as any]: "#14B8A6" }} onClick={() => setGd("basics")}><Icon n="lifebuoy" />{t("basics", lang)}</button>
          {depts.map((d: any) => <button key={d.key} className={gd === d.key ? "on" : ""} style={{ ["--dc" as any]: (DEPT_COLORS as any)[d.key] }} onClick={() => setGd(d.key)}><Icon n={d.icon} />{tx(d.label, lang)}</button>)}
        </div>
        {(gd === "basics" || ql) && <div className="guides">{GUIDES.filter((g) => hit(l2(g.title, lang), l2(g.body, lang))).map((g) => (
          <details key={g.id} className="guide-row" style={{ ["--dc" as any]: "#14B8A6" }} open={!!ql || g.id === "start" || g.id === "upload"}>
            <summary><span className="flag"><Icon n={g.icon} /></span><span className="t"><b>{l2(g.title, lang)}</b></span><Icon n="down" className="lockico" /></summary>
            <div className="body"><ol>{lines("\n" + l2(g.body, lang)).bullets.map((x, i) => <li key={i}>{x}</li>)}</ol></div>
          </details>))}</div>}
        {depts.filter((d: any) => ql || d.key === gd).map((d: any) => {
          const secs = d.secs.filter((x: any) => hit(tx(x.label, lang), l2(HELP[x.id], lang)));
          if (!secs.length) return null;
          return <div key={d.key} style={{ display: "grid", gap: 10, ["--dc" as any]: (DEPT_COLORS as any)[d.key] }}>
            {ql && <div className="lhead"><span className="ic"><Icon n={d.icon} /></span><h2>{tx(d.label, lang)}</h2></div>}
            <div className="guides">{secs.map((x: any) => { const h = lines(l2(HELP[x.id], lang)); return (
              <details key={x.id} id={`h-${x.id}`} className={`guide-row ${focus === x.id ? "hl" : ""}`} open={focus === x.id || !!ql}>
                <summary><span className="flag"><Icon n={x.icon} /></span><span className="t"><b>{tx(x.label, lang)}</b><span>{h.first}</span></span><Icon n="down" className="lockico" /></summary>
                <div className="body">
                  {h.bullets.length > 0 && <ol>{h.bullets.map((b, i) => <li key={i}>{b}</li>)}</ol>}
                  <div className="toolbar"><Link className="btn sm" href={`/${x.dept}/${x.key}`}><Icon n="ext" />{t("open", lang)}</Link>
                    {x.gate && <span className="chip c-warn"><Icon n="lock" className="lockico" />{x.gate.status}</span>}
                    {x.controlled && <span className="chip c-warn"><Icon n="lock" className="lockico" />{t("controlled_short", lang)}</span>}</div>
                </div>
              </details>); })}</div>
          </div>;
        })}
      </>}

      {tab === "terms" && <>
        <div className="chipbar">
          <button className={td === "all" ? "on" : ""} style={{ ["--dc" as any]: "#14B8A6" }} onClick={() => setTd("all")}>{t("all_depts", lang)}</button>
          {Object.keys(GLOSSARY).map((dk) => { const d: any = DEPARTMENTS.find((x: any) => x.key === dk); return <button key={dk} className={td === dk ? "on" : ""} style={{ ["--dc" as any]: (DEPT_COLORS as any)[dk] }} onClick={() => setTd(dk)}><Icon n={d?.icon || "book"} />{d ? tx(d.label, lang) : dk} <span style={{ fontWeight: 500, opacity: .7 }}>{GLOSSARY[dk].length}</span></button>; })}
        </div>
        {Object.entries(GLOSSARY).filter(([dk]) => td === "all" || td === dk).map(([dk, items]) => {
          const d: any = DEPARTMENTS.find((x: any) => x.key === dk); const list = items.filter(([term, def]) => hit(term, l2(def, lang)));
          if (!list.length) return null;
          return <div key={dk} style={{ display: "grid", gap: 8, ["--dc" as any]: (DEPT_COLORS as any)[dk] }}>
            {td === "all" && <div className="lhead"><span className="ic"><Icon n={d?.icon || "book"} /></span><h2>{d ? tx(d.label, lang) : dk}</h2></div>}
            <dl className="dict">{list.map(([term, def]) => [<dt key={term + "t"}>{term}</dt>, <dd key={term + "d"}>{l2(def, lang)}</dd>])}</dl>
          </div>;
        })}
      </>}

      {tab === "faq" && <div style={{ display: "grid", gap: 10 }}>
        <div className="chipbar">
          <button className={fd === "all" ? "on" : ""} style={{ ["--dc" as any]: "#14B8A6" }} onClick={() => setFd("all")}>{t("all_depts", lang)}</button>
          <button className={fd === "general" ? "on" : ""} style={{ ["--dc" as any]: "#14B8A6" }} onClick={() => setFd("general")}><Icon n="lifebuoy" />{t("basics", lang)}</button>
          {Array.from(new Set(faq.map((f) => f.section?.split(".")[0]).filter(Boolean) as string[])).map((dk) => { const d: any = DEPARTMENTS.find((x: any) => x.key === dk); return d ? <button key={dk} className={fd === dk ? "on" : ""} style={{ ["--dc" as any]: (DEPT_COLORS as any)[dk] }} onClick={() => setFd(dk)}><Icon n={d.icon} />{tx(d.label, lang)}</button> : null; })}
        </div>
        {edit && <div className="card" style={{ ["--dc" as any]: "#14B8A6" }}><div className="card-b" style={{ display: "grid", gap: 10 }}>
          <div className="field"><label htmlFor="fq">{t("question", lang)}</label><input id="fq" className="input" value={edit.question || ""} onChange={(e) => setEdit({ ...edit, question: e.target.value })} /></div>
          <div className="field"><label htmlFor="fa">{t("answer", lang)}</label><textarea id="fa" className="input" rows={5} value={edit.answer || ""} onChange={(e) => setEdit({ ...edit, answer: e.target.value })} /></div>
          <div className="toolbar"><select className="input" style={{ width: "auto" }} value={edit.lang || fl} onChange={(e) => setEdit({ ...edit, lang: e.target.value })} aria-label={t("language", lang)}><option value="en">EN</option><option value="ru">RU</option><option value="uk">UA</option><option value="ar">AR</option></select>
            <button className="btn primary" onClick={saveEdit}>{t("save", lang)}</button>
            <button className="btn" onClick={() => { openAi({ title: t("learn", lang), ask: edit.question || "" }); }}><Icon n="spark" />{t("ask_ai", lang)}</button>
            <button className="btn ghost" onClick={() => setEdit(null)}>{t("cancel", lang)}</button></div>
        </div></div>}
        {!shownFaq.length ? <div className="card empty">{t("no_match", lang)}</div> : shownFaq.map((f) => (
          <details key={f.id} className="faq" style={{ ["--dc" as any]: f.section ? (DEPT_COLORS as any)[f.section.split(".")[0]] : "#14B8A6" }} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) store.faqHit(f.id).catch(() => {}); }}>
            <summary><Icon n="info" /><span style={{ flex: 1 }}>{f.question}</span>{f.verified && <span className="chip c-ok">{t("verified", lang)}</span>}{f.hits > 0 && <span className="chip mono" title={t("popular", lang)}>{f.hits}</span>}</summary>
            <div className="ans"><div className="md" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(f.answer) as string) }} />
              <div className="toolbar">
                {f.section && <Link className="chip" href={`/${f.section.replace(".", "/")}`}>{tx(SECTIONS.find((s) => s.id === f.section)?.label, lang)}</Link>}
                <span className="faint" style={{ fontSize: 12.5 }}>{f.lang.toUpperCase()} · {f.source === "ai" ? "AI" : f.source === "seed" ? "AGRON" : t("manual", lang)}</span>
                <span style={{ flex: 1 }} />
                {(editor || f.created_by === me.id) && <>
                  {editor && <button className="btn ghost sm" onClick={() => toggleVerified(f)}><Icon n="check" />{f.verified ? t("unverify", lang) : t("mark_verified", lang)}</button>}
                  <button className="btn ghost sm" onClick={() => setEdit(f)}><Icon n="edit" />{t("edit", lang)}</button>
                  <button className="btn ghost sm danger" onClick={() => del(f)}><Icon n="trash" /></button></>}
              </div></div>
          </details>))}
      </div>}
    </div>
  );
}
