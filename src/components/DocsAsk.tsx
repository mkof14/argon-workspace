"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { t, tx } from "@/lib/i18n";
import { DEMO } from "@/lib/sb";
import { store } from "@/lib/store";

type Src = { n: number; record_id: string; section: string; title: string; file: string; page: number; path: string; snippet: string; cited?: boolean };
type Ans = { q: string; answer: string; sources: Src[]; none?: boolean; error?: string };
const api = (body: any) => fetch("/api/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const EXAMPLES: Record<string, string[]> = {
  ru: ["Какие радары мы рассматриваем и почему?", "Что проверяется на заводских испытаниях FAT?", "Чем отличаются C20 Enhanced и C40 Advanced?", "Каких поставщиков запрашивать в первом RFQ?"],
  en: ["Which radars are we considering and why?", "What is checked in factory acceptance (FAT)?", "How do C20 Enhanced and C40 Advanced differ?", "Which suppliers go into the first RFQ?"],
  uk: ["Які радари ми розглядаємо і чому?", "Що перевіряється на заводських випробуваннях FAT?", "Чим відрізняються C20 Enhanced і C40 Advanced?", "Яких постачальників запитувати в першому RFQ?"],
  ar: ["ما الرادارات التي ندرسها ولماذا؟", "ما الذي يُفحص في اختبار القبول في المصنع (FAT)؟", "ما الفرق بين C20 Enhanced وC40 Advanced؟", "أي الموردين ندرجهم في أول طلب عروض أسعار؟"],
};

/** Ask your documents: plain-language questions answered from attached files, with page references. */
export default function DocsAsk() {
  const { lang, toast, openIntake } = useApp();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<Ans[]>([]);
  const [st, setSt] = useState<{ files: number; pages: number; pending: number } | null>(null);
  const [prep, setPrep] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const status = () => api({ action: "status" }).then((r) => r.json()).then(setSt).catch(() => {});
  useEffect(() => { if (!DEMO) status(); box.current?.focus(); }, []);
  // Files added before this feature (or by others) are read automatically the first time someone opens the page
  useEffect(() => {
    if (!st?.pending || prep) return;
    setPrep(true);
    (async () => {
      let left = st.pending;
      for (let i = 0; i < 20 && left > 0; i++) {
        const r = await api({ action: "index" }); if (!r.ok) break;
        const j = await r.json(); left = j.pending; setSt((s) => (s ? { ...s, pending: left } : s));
        if (!j.done) break;
      }
      await status(); setPrep(false);
    })();
  }, [st?.pending]); // eslint-disable-line

  const ask = async (text = q) => {
    const question = text.trim(); if (question.length < 3 || busy) return;
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    setBusy(true); setQ(question);
    try {
      const r = await api({ action: "ask", q: question, lang });
      const j = r.ok ? await r.json() : { error: await r.text() };
      setList((l) => [{ q: question, answer: j.answer || "", sources: j.sources || [], none: j.none, error: j.error }, ...l].slice(0, 8));
      setQ("");
    } catch (e: any) { setList((l) => [{ q: question, answer: "", sources: [], error: e.message }, ...l]); }
    finally { setBusy(false); }
  };
  const openPage = async (s: Src) => { try { const u = await store.fileUrl(s.path, 3600); window.open(`${u}#page=${s.page}`, "_blank", "noopener"); } catch (e: any) { toast(e.message, true); } };

  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#7C5CFF" }}>
      <section className="sec-hero">
        <span className="ic"><Icon n="spark" /></span>
        <div style={{ position: "relative", zIndex: 1, minWidth: 0, flex: 1 }}>
          <h2>{t("ask_docs", lang)}</h2>
          <div className="sec-desc">{t("ask_docs_sub", lang)}</div>
        </div>
        {st && <div className="stats"><span className="stat"><b style={{ color: "var(--dc)" }}>{st.files}</b><small>{t("ask_docs_files", lang)}</small></span><span className="stat"><b style={{ color: "var(--dc)" }}>{st.pages}</b><small>{t("ask_docs_pages", lang)}</small></span></div>}
      </section>

      <form className="card card-b ask-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <textarea ref={box} className="input" rows={2} value={q} placeholder={t("ask_docs_ph", lang)} aria-label={t("ask_docs", lang)}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} />
        <div className="toolbar">
          <button className="btn primary" disabled={busy || q.trim().length < 3}>{busy ? <><span className="spin" />{t("ask_docs_busy", lang)}</> : <><Icon n="search" />{t("ask_docs_go", lang)}</>}</button>
          {!list.length && !busy && <span className="faint" style={{ fontSize: 13.5 }}>{t("ask_docs_tip", lang)}</span>}
        </div>
        {!list.length && <div className="ask-ex">{(EXAMPLES[lang] || EXAMPLES.en).map((x) => <button type="button" key={x} className="chip" onClick={() => ask(x)} disabled={busy}>{x}</button>)}</div>}
        {st && st.pending > 0 && <p className="faint" style={{ margin: 0, fontSize: 13.5 }}><span className="spin" /> {t("ask_docs_prep", lang).replace("{n}", String(st.pending))}</p>}
        {st && st.files === 0 && !st.pending && <p style={{ margin: 0 }}>{t("ask_docs_empty", lang)} <button type="button" className="linkbtn" onClick={() => openIntake()}>{t("intake_t", lang)}</button></p>}
      </form>

      {list.map((a, i) => <Answer key={i + a.q} a={a} openPage={openPage} lang={lang} />)}

      <details className="card card-b ask-help">
        <summary><b>{t("ask_docs_how", lang)}</b></summary>
        <ol>{t("ask_docs_how_p", lang).split("\n").map((x) => <li key={x}>{x}</li>)}</ol>
      </details>
    </div>
  );
}

function Answer({ a, openPage, lang }: { a: Ans; openPage: (s: Src) => void; lang: any }) {
  const html = useMemo(() => {
    const raw = DOMPurify.sanitize(marked.parse(a.answer || "") as string);
    return raw.replace(/\[(\d+)\]/g, (m, n) => a.sources.some((s) => s.n === +n) ? `<a class="cite" href="#src-${a.q.length}-${n}">${n}</a>` : m);
  }, [a]);
  const shown = a.sources.filter((s) => s.cited || !a.sources.some((x) => x.cited));
  return (
    <section className="card ask-ans">
      <div className="card-h"><h2 style={{ fontSize: 16 }}><Icon n="info" />{a.q}</h2></div>
      <div className="card-b" style={{ display: "grid", gap: 12 }}>
        {a.error ? <p className="intake-err">{a.error}</p>
          : a.none ? <p style={{ margin: 0 }}>{t("ask_docs_none", lang)}</p>
          : <div className="md" dangerouslySetInnerHTML={{ __html: html }} />}
        {shown.length > 0 && <div className="ask-src"><b>{t("ask_docs_sources", lang)}</b>
          {shown.map((s) => { const sec = findSection(s.section); return (
            <div key={s.n} id={`src-${a.q.length}-${s.n}`} className="ask-src-row">
              <span className="ask-n">{s.n}</span>
              <span style={{ minWidth: 0 }}><b>{s.title}</b><br /><span className="faint">{sec ? tx(sec.label, lang) : s.section} · {s.file} · {t("ask_docs_page", lang)} {s.page}</span></span>
              <span className="toolbar" style={{ gap: 6 }}>
                {/\.pdf$/i.test(s.file) && <button className="btn ghost sm" onClick={() => openPage(s)}><Icon n="eye" />{t("ask_docs_open_page", lang)}</button>}
                {sec && <Link className="btn ghost sm" href={`/${sec.dept}/${sec.key}?r=${s.record_id}`}><Icon n="file" />{t("ask_docs_record", lang)}</Link>}
              </span>
            </div>); })}
        </div>}
      </div>
    </section>
  );
}
