"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { DEPARTMENTS, DEPT_COLORS } from "@/config/workspace.config.mjs";
import { TEMPLATES, TPL_DEPTS, Tpl, fillTpl } from "@/config/templates";
import { l2 } from "@/config/learn";
import { t, tx } from "@/lib/i18n";
import { store } from "@/lib/store";
import { printHtml, saveBlob, slug } from "@/lib/format";
import { markdownToPdf } from "@/lib/pdf";

const DKEY = "agronws.tpl.";
export default function Templates() {
  const { lang, access, toast, openAi, openMail } = useApp();
  const [dept, setDept] = useState<string>(() => (typeof window !== "undefined" ? new URLSearchParams(location.search).get("dept") || "" : ""));
  const [cur, setCur] = useState<Tpl | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => { // deep link ?t=<id>
    const id = new URLSearchParams(location.search).get("t"); const tp = TEMPLATES.find((x) => x.id === id); if (tp) pick(tp);
  }, []); // eslint-disable-line
  const pick = (tp: Tpl) => {
    let saved: Record<string, string> = {};
    try { saved = JSON.parse(localStorage.getItem(DKEY + tp.id) || "{}"); } catch {}
    setVals({ ...Object.fromEntries(tp.fields.map((f) => [f.key, f.def || ""])), ...saved }); setCur(tp);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const set = (k: string, v: string) => setVals((o) => { const n = { ...o, [k]: v }; try { if (cur) localStorage.setItem(DKEY + cur.id, JSON.stringify(n)); } catch {} return n; });

  const list = TEMPLATES.filter((x) => (!dept || x.dept === dept));
  // Numbers read better with thousands separators in the document (the form keeps raw digits)
  const shown = useMemo(() => { if (!cur) return vals; const o = { ...vals }; for (const f of cur.fields) if (f.type === "number" && o[f.key] && !isNaN(Number(o[f.key])) && Number(o[f.key]) >= 1000) o[f.key] = Number(o[f.key]).toLocaleString("en-US"); return o; }, [cur, vals]);
  const md = useMemo(() => (cur ? fillTpl(cur.body, shown) : ""), [cur, shown]);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(md) as string), [md]);
  const missing = cur ? cur.fields.filter((f) => f.req && !String(vals[f.key] || "").trim()) : [];
  const deptLabel = (k: string) => tx(DEPARTMENTS.find((d: any) => d.key === k)?.label, lang) || k;
  const canSave = !!cur?.save && access.write.has(cur.save.section);

  const save = async () => {
    if (!cur?.save) return;
    if (missing.length) { toast(t("fill_required", lang), true); return; }
    setBusy(true);
    try {
      const sec = findSection(cur.save.section);
      const data: Record<string, any> = {};
      for (const [k, v] of Object.entries(cur.save.data)) {
        const val = fillTpl(v, vals); const f = sec?.fields.find((x: any) => x.key === k);
        if (!val) continue;
        data[k] = f?.type === "check" ? val === "true" : f?.type === "number" || f?.type === "money" ? Number(String(val).replace(/[^\d.\-]/g, "")) || val : val;
      }
      data.document = md;
      const status = fillTpl(cur.save.status, vals);
      const rec = await store.save({ section: cur.save.section, title: fillTpl(cur.save.title, vals).slice(0, 200), status: sec?.statuses.includes(status) ? status : sec?.statuses[0], data });
      toast(t("saved_to", lang).replace("{s}", tx(sec?.label, lang)));
      location.href = `/${cur.save.section.replace(".", "/")}?r=${rec.id}`;
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(false); }
  };

  if (cur) {
    const c = (DEPT_COLORS as any)[cur.dept] || "#5B6CF0";
    return (
      <div style={{ display: "grid", gap: 16, ["--dc" as any]: c }}>
        <div className="toolbar">
          <button className="btn ghost sm" onClick={() => setCur(null)}><Icon n="back" />{t("all_templates", lang)}</button>
          <h2 style={{ margin: 0, fontSize: 20, display: "flex", gap: 10, alignItems: "center" }}><span className="ic tpl-ic"><Icon n={cur.icon} /></span>{l2(cur.name, lang)}</h2>
          {cur.counsel && <span className="chip c-warn">{t("counsel_review", lang)}</span>}
        </div>
        <div className="tpl-edit">
          <form className="card card-b tpl-form" onSubmit={(e) => e.preventDefault()}>
            {cur.fields.map((f) => (
              <label key={f.key} className="field"><span>{l2(f.label, lang)}{f.req ? " *" : ""}</span>
                {f.type === "long" ? <textarea className="input" rows={f.key.match(/agenda|resolved|resolutions|questions|scope|officers|directors/) ? 5 : 3} value={vals[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />
                  : f.type === "select" ? <select className="input" value={vals[f.key] || ""} onChange={(e) => set(f.key, e.target.value)}><option value="">—</option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                  : <input className="input" type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} value={vals[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />}
              </label>))}
            <button type="button" className="linkbtn" style={{ justifySelf: "start" }} onClick={() => { setVals(Object.fromEntries(cur.fields.map((f) => [f.key, f.def || ""]))); try { localStorage.removeItem(DKEY + cur.id); } catch {} }}>{t("clear_form", lang)}</button>
          </form>
          <div className="card tpl-doc">
            <div className="card-h toolbar" style={{ flexWrap: "wrap" }}>
              <button className="btn sm" onClick={async () => { await navigator.clipboard.writeText(md); toast(t("copied", lang)); }}><Icon n="copy" />{t("copy", lang)}</button>
              <button className="btn sm" onClick={() => printHtml(l2(cur.name, "en"), html)}><Icon n="print" />{t("print", lang)}</button>
              <button className="btn primary sm" onClick={async () => { toast(t("pdf_wait", lang)); try { await markdownToPdf(md, { title: l2(cur.name, "en"), filename: `AGRON_${slug(l2(cur.name, "en"))}_${new Date().toISOString().slice(0, 10)}` }); } catch (e: any) { toast(e.message || "PDF error", true); } }}><Icon n="pdf" />{t("download_pdf", lang)}</button>
              <button className="btn sm" onClick={() => saveBlob(`${slug(l2(cur.name, "en"))}.md`, md, "text/markdown")}><Icon n="download" />.md</button>
              {access.read.has("mail.templates") && <button className="btn sm" onClick={() => openMail({ template: "blank", vars: { subject: l2(cur.name, "en"), name: "", message: md } })}><Icon n="mail" />{t("email_btn", lang)}</button>}
              <button className="btn sm" onClick={() => openAi({ title: l2(cur.name, lang), section: cur.save?.section || (cur.dept === "legal" ? "legal.requests" : ""), desk: cur.dept === "legal" ? "corporate" : undefined, ask: (lang === "ru" ? "Проверь и улучши этот документ. Укажи пропуски и риски, затем дай исправленный текст на английском:\n\n" : "Review and improve this document. List gaps and risks, then give the corrected text:\n\n") + md })}><Icon n="spark" />{t("improve_ai", lang)}</button>
              {canSave && <button className="btn primary sm" disabled={busy} style={{ marginInlineStart: "auto" }} onClick={save}><Icon n="check" />{t("save_to", lang).replace("{s}", tx(findSection(cur.save!.section)?.label, lang))}</button>}
            </div>
            {missing.length > 0 && <div className="faint" style={{ padding: "8px 20px 0", fontSize: 13.5 }}>{t("still_missing", lang)}: {missing.map((f) => l2(f.label, lang)).join(", ")}</div>}
            <div ref={docRef} className="md tpl-paper" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p className="muted" style={{ margin: 0, fontSize: 15.5 }}>{t("tpl_intro", lang)}</p>
      <nav className="chipbar" aria-label={t("departments", lang)}>
        <button className={!dept ? "on" : ""} onClick={() => setDept("")}>{t("all", lang)} <b>{TEMPLATES.length}</b></button>
        {TPL_DEPTS.map((d) => <button key={d} className={dept === d ? "on" : ""} style={{ ["--dc" as any]: (DEPT_COLORS as any)[d] }} onClick={() => setDept(d)}>{deptLabel(d)} <b>{TEMPLATES.filter((x) => x.dept === d).length}</b></button>)}
      </nav>
      <div className="tpl-grid">{list.map((tp) => { const sec = tp.save && findSection(tp.save.section); return (
        <button key={tp.id} className="tpl-card" style={{ ["--dc" as any]: (DEPT_COLORS as any)[tp.dept] }} onClick={() => pick(tp)}>
          <span className="ic tpl-ic"><Icon n={tp.icon} /></span>
          <b>{l2(tp.name, lang)}</b>
          <span className="muted">{l2(tp.desc, lang)}</span>
          <span className="tpl-meta">{deptLabel(tp.dept)}{sec ? ` · ${t("saves_to", lang)} ${tx(sec.label, lang)}` : ""}{tp.counsel ? ` · ${t("counsel_review", lang)}` : ""}</span>
        </button>); })}</div>
    </div>
  );
}

/** Small strip of templates that fit a section, shown on the section page. */
export function SectionTemplates({ sectionId }: { sectionId: string }) {
  const { lang } = useApp();
  const list = TEMPLATES.filter((x) => x.save?.section === sectionId);
  if (!list.length) return null;
  return <div className="toolbar" style={{ gap: 8 }}><span className="faint" style={{ fontSize: 13.5 }}><Icon n="file" /> {t("templates", lang)}:</span>
    {list.map((tp) => <Link key={tp.id} href={`/templates?t=${tp.id}`} className="btn ghost sm"><Icon n={tp.icon} />{l2(tp.name, lang)}</Link>)}</div>;
}
