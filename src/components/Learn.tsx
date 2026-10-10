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

const lines = (s: string) => { const [first, ...rest] = s.split("\n"); return { first, bullets: rest.map((x) => x.replace(/^-\s*/, "")).filter(Boolean) }; };

export default function Learn() {
  const { lang, me, access, toast, openAi, tick } = useApp();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const [tab, setTab] = useState<"guide" | "terms" | "faq">((params?.get("tab") as any) || "guide");
  const [q, setQ] = useState("");
  const [focus] = useState(params?.get("s") || "");
  const [faq, setFaq] = useState<Faq[]>([]);
  const [allLangs, setAllLangs] = useState(false);
  const [edit, setEdit] = useState<Partial<Faq> | null>(null);
  const editor = ["owner", "admin", "management", "legal"].includes(me.role);
  const fl = lang === "ru" ? "ru" : "en";

  const loadFaq = () => store.faqList().then(setFaq).catch(() => {});
  useEffect(() => { loadFaq(); }, [tick]); // eslint-disable-line
  useEffect(() => { if (focus) setTimeout(() => document.getElementById(`h-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300); }, [focus]);

  const ql = q.trim().toLowerCase();
  const hit = (...xs: string[]) => !ql || xs.some((x) => x.toLowerCase().includes(ql));
  const depts = DEPARTMENTS.map((d: any) => ({ ...d, secs: SECTIONS.filter((s) => s.dept === d.key && access.read.has(s.id)) })).filter((d: any) => d.secs.length);

  const shownFaq = useMemo(() => faq.filter((f) => (allLangs || f.lang === fl) && hit(f.question, f.answer))
    .sort((a, b) => Number(b.verified) - Number(a.verified) || b.hits - a.hits), [faq, allLangs, fl, ql]); // eslint-disable-line

  const saveEdit = async () => {
    if (!edit?.question?.trim() || !edit.answer?.trim()) return;
    try { await store.faqSave({ ...(edit as any), question: edit.question.trim(), answer: edit.answer.trim(), lang: edit.lang || fl }); toast(t("saved", lang)); setEdit(null); loadFaq(); }
    catch (e: any) { toast(e.message || "Error", true); }
  };
  const toggleVerified = async (f: Faq) => { try { await store.faqSave({ ...f, verified: !f.verified }); loadFaq(); } catch (e: any) { toast(e.message, true); } };
  const del = async (f: Faq) => { try { await store.faqDelete(f.id); loadFaq(); } catch (e: any) { toast(e.message, true); } };

  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#14B8A6" }}>
      <section className="sec-hero">
        <span className="ic"><Icon n="grad" /></span>
        <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}><div className="eyebrow" style={{ color: "var(--dc)" }}>{t("workspace", lang)}</div><h2>{t("learn", lang)}</h2>
          <div className="sec-desc">{t("learn_sub", lang)}</div></div>
        <div className="stats">
          <button className={`stat ${tab === "guide" ? "on" : ""}`} onClick={() => setTab("guide")}><b style={{ color: "var(--dc)" }}>{depts.reduce((a: number, d: any) => a + d.secs.length, 0)}</b><small>{t("guide", lang)}</small></button>
          <button className={`stat ${tab === "terms" ? "on" : ""}`} onClick={() => setTab("terms")}><b style={{ color: "var(--dc)" }}>{Object.values(GLOSSARY).reduce((a, x) => a + x.length, 0)}</b><small>{t("terms", lang)}</small></button>
          <button className={`stat ${tab === "faq" ? "on" : ""}`} onClick={() => setTab("faq")}><b style={{ color: "var(--dc)" }}>{faq.filter((f) => f.lang === fl).length}</b><small>FAQ</small></button>
        </div>
      </section>

      <div className="card">
        <div className="tabs">
          <button className={tab === "guide" ? "on" : ""} onClick={() => setTab("guide")}><Icon n="book" />{t("guide", lang)}</button>
          <button className={tab === "terms" ? "on" : ""} onClick={() => setTab("terms")}><Icon n="tag" />{t("terms", lang)}</button>
          <button className={tab === "faq" ? "on" : ""} onClick={() => setTab("faq")}><Icon n="info" />FAQ</button>
        </div>
        <div className="filters" style={{ borderBottom: 0 }}><div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("learn_search", lang)} aria-label={t("learn_search", lang)} /></div>
          {tab === "faq" && <label className="check"><input type="checkbox" checked={allLangs} onChange={(e) => setAllLangs(e.target.checked)} />EN + RU</label>}
          {tab === "faq" && !isExternal(me.role) && <button className="btn primary" onClick={() => setEdit({ question: q, answer: "", lang: fl })}><Icon n="plus" />{t("add_question", lang)}</button>}
        </div>
      </div>

      {tab === "guide" && <>
        <div className="learn-grid">{GUIDES.filter((g) => hit(l2(g.title, lang), l2(g.body, lang))).map((g) => (
          <div key={g.id} className="lcard" style={{ ["--dc" as any]: "#14B8A6" }}><h3><Icon n={g.icon} />{l2(g.title, lang)}</h3>
            <ul>{lines("\n" + l2(g.body, lang)).bullets.map((b, i) => <li key={i}>{b}</li>)}</ul></div>))}</div>
        {depts.map((d: any) => {
          const secs = d.secs.filter((s: any) => hit(tx(s.label, lang), l2(HELP[s.id], lang)));
          if (!secs.length) return null;
          return <div key={d.key} style={{ display: "grid", gap: 12, ["--dc" as any]: (DEPT_COLORS as any)[d.key] }}>
            <div className="lhead"><span className="ic"><Icon n={d.icon} /></span><h2>{tx(d.label, lang)}</h2></div>
            <div className="learn-grid">{secs.map((s: any) => { const h = lines(l2(HELP[s.id], lang)); return (
              <div key={s.id} id={`h-${s.id}`} className={`lcard ${focus === s.id ? "hl" : ""}`}>
                <h3><Icon n={s.icon} />{tx(s.label, lang)}</h3><p>{h.first}</p>
                {h.bullets.length > 0 && <ul>{h.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
                <div className="toolbar" style={{ marginTop: 4 }}><Link className="btn ghost sm" href={`/${s.dept}/${s.key}`}><Icon n="ext" />{t("open", lang)}</Link>
                  {s.gate && <span className="chip c-warn"><Icon n="lock" className="lockico" />{s.gate.status}</span>}
                  {s.controlled && <span className="chip c-warn"><Icon n="lock" className="lockico" />{t("controlled_short", lang)}</span>}</div>
              </div>); })}</div>
          </div>;
        })}
      </>}

      {tab === "terms" && Object.entries(GLOSSARY).map(([dk, items]) => {
        const d: any = DEPARTMENTS.find((x: any) => x.key === dk); const list = items.filter(([term, def]) => hit(term, l2(def, lang)));
        if (!list.length) return null;
        return <div key={dk} style={{ display: "grid", gap: 10, ["--dc" as any]: (DEPT_COLORS as any)[dk] }}>
          <div className="lhead"><span className="ic"><Icon n={d?.icon || "book"} /></span><h2>{d ? tx(d.label, lang) : dk}</h2></div>
          <div className="terms">{list.map(([term, def]) => <div key={term} className="term"><b>{term}</b><span>{l2(def, lang)}</span></div>)}</div>
        </div>;
      })}

      {tab === "faq" && <div style={{ display: "grid", gap: 10 }}>
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
