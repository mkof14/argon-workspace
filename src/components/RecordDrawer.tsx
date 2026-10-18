"use client";
import Approval from "./Approval";
import dynamic from "next/dynamic";
const ProposalBuilder = dynamic(() => import("./ProposalBuilder"), { ssr: false });
const ProjectPlanner = dynamic(() => import("./ProjectPlanner"), { ssr: false });
const PortalLinks = dynamic(() => import("./PortalLinks"), { ssr: false });
import MarketingStudio from "./MarketingStudio";
import { RecordTools } from "./DeptTools";
import { RefField, ChainPanel } from "./Links";
import { APPROVALS } from "@/config/approvals";
import { gateBlocks } from "@/config/workspace.config.mjs";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { t, tx } from "@/lib/i18n";
import { trFields, trPending, trText } from "@/lib/tr";
import { Activity, Comment, DEMO, Rec, isExternal, store, textSim } from "@/lib/store";
import { fmt, printHtml, recordMarkdown, saveBlob, slug, tone } from "@/lib/format";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Attachments from "./Attachments";
import { markdownToPdf } from "@/lib/pdf";
import { US_CHECKLIST, UAE_CHECKLIST, deskById } from "@/config/legal";
import { OFFBOARD_CHECKLIST, ONBOARD_CHECKLIST } from "@/config/hr";

export const GROUPS: Record<string, { en: string; ru: string; uk: string; ar: string }> = {
  A: { en: "A · Product identification", ru: "A · Идентификация продукта", uk: "A · Ідентифікація продукту", ar: "A · تعريف المنتج" },
  B: { en: "B · U.S. export review", ru: "B · Экспорт из США", uk: "B · Експорт зі США", ar: "B · مراجعة التصدير الأمريكي" },
  C: { en: "C · UAE import review", ru: "C · Ввоз в ОАЭ", uk: "C · Ввезення в ОАЕ", ar: "C · مراجعة الاستيراد إلى الإمارات" },
  D: { en: "D · UAE installation & operation", ru: "D · Установка и эксплуатация в ОАЭ", uk: "D · Встановлення та експлуатація в ОАЕ", ar: "D · التركيب والتشغيل في الإمارات" },
  E: { en: "E · Procurement & logistics", ru: "E · Закупка и логистика", uk: "E · Закупівля та логістика", ar: "E · المشتريات والخدمات اللوجستية" },
  F: { en: "F · Risk assessment", ru: "F · Оценка риска", uk: "F · Оцінка ризику", ar: "F · تقييم المخاطر" },
  G: { en: "G · Evidence", ru: "G · Подтверждение", uk: "G · Підтвердження", ar: "G · الأدلة" },
  H: { en: "Checklists", ru: "Чек-листы", uk: "Чек-листи", ar: "قوائم التحقق" },
};
export const CHECKLISTS: Record<string, string[]> = { us: US_CHECKLIST, uae: UAE_CHECKLIST, onboard: ONBOARD_CHECKLIST, offboard: OFFBOARD_CHECKLIST };
// Where an AI answer can be saved in a record, per section
const APPLY: Record<string, string> = { "legal.matrix": "ai_review", "legal.requests": "answer", "legal.desks": "memo", "legal.issues": "action", "legal.programs": "elements" };

const PEOPLE_KEYS = ["owner", "person", "requester", "engineer", "pm_name"];

export default function RecordDrawer({ section, rec, onClose, onSaved, onReload }: { section: any; rec: Rec | null; onClose: () => void; onSaved: () => void; onReload?: () => void }) {
  const { lang, me, access, toast, openAi, openMail, people } = useApp();
  const canWrite = access.write.has(section.id) && !isExternal(me.role);
  const [title, setTitle] = useState(rec?.title || "");
  const [status, setStatus] = useState(rec?.status || section.statuses[0]);
  const [data, setData] = useState<Record<string, any>>({ ...(rec?.data || {}) });
  const [company, setCompany] = useState(rec?.company || "");
  const [controlled, setControlled] = useState(!!rec?.controlled);
  const [comments, setComments] = useState<Comment[]>([]);
  const [hist, setHist] = useState<Activity[]>([]);
  const [cmt, setCmt] = useState("");
  const [busy, setBusy] = useState(false);
  // Automatic translation: the record is shown in the reader's language; one click shows the original
  const trd: any = (rec as any)?._o ? rec : null;
  const [orig, setOrig] = useState(false);
  const flip = () => { const to = orig ? (rec as any)._l : (rec as any)._o; setTitle(to.title); setData({ ...to.data }); setOrig(!orig); };
  const LN: Record<string, Record<string, string>> = { en: { en: "English", ru: "Russian", uk: "Ukrainian", ar: "Arabic" }, ru: { en: "английского", ru: "русского", uk: "украинского", ar: "арабского" }, uk: { en: "англійської", ru: "російської", uk: "української", ar: "арабської" }, ar: { en: "الإنجليزية", ru: "الروسية", uk: "الأوكرانية", ar: "العربية" } };
  const srcName = (trd?._src && LN[lang]?.[trd._src]) || "";
  const cmtText = (c: Comment) => (orig ? c.body : trText(c.body, (rec as any)?.data?._tr?.c?.[c.id], lang));
  const [confirmDel, setConfirmDel] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const gate = section.gate;
  const gateBlocked = gateBlocks(gate, status, data);

  // Opening an export-controlled record is written to the access log (technology control plan)
  useEffect(() => { if (rec?.controlled && !DEMO) fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ record_id: rec.id }) }).catch(() => {}); }, [rec?.id]); // eslint-disable-line
  useEffect(() => {
    if (!rec) return;
    store.comments(rec.id).then((cs) => {
      setComments(cs);
      // Written by an agent, by e-mail intake or before translation was on: translate it now (in the background)
      if (DEMO) return; const o = store.original(rec);
      const need = Object.keys(trPending(trFields(section.fields, o.title, o.data || {}), o.data?._tr)).length || cs.some((c) => o.data?._tr?.c?.[c.id] === undefined && /\p{L}{2,}/u.test(c.body));
      if (need) fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rec.id }) }).catch(() => {});
    }).catch(() => {});
    store.activity({ recordId: rec.id, limit: 15 }).then(setHist).catch(() => {});
  }, [rec]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  // Before a new record is saved: similar records that already exist (same company, same e-mail, close title)
  const [similar, setSimilar] = useState<Rec[]>([]);
  useEffect(() => {
    if (rec) return; const q = title.trim(); const mail = String(data.email || data.contact_email || "").trim().toLowerCase();
    if (q.length < 3 && !mail) { setSimilar([]); return; }
    const h = setTimeout(async () => {
      try {
        const found = [...(q.length >= 3 ? await store.searchRecords(q.split(/\s+/).slice(0, 3).join(" "), 15) : []), ...(mail ? await store.searchRecords(mail, 5) : [])];
        const norm = (x: string) => x.toLowerCase().replace(/\(sample\)|[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
        const hit = found.filter((r, i, a) => r.section === section.id && a.findIndex((x) => x.id === r.id) === i
          && ((q.length >= 3 && (norm(r.title) === norm(q) || textSim(r.title, q) >= 0.6)) || (mail && JSON.stringify(r.data || {}).toLowerCase().includes(mail))));
        setSimilar(hit.slice(0, 4));
      } catch { setSimilar([]); }
    }, 500);
    return () => clearTimeout(h);
  }, [title, data.email, data.contact_email, rec, section.id]); // eslint-disable-line

  const save = async () => {
    if (!title.trim()) return;
    if (gateBlocked) { toast(tx(gate.msg, lang), true); return; }
    setBusy(true);
    try { await store.save({ id: rec?.id, section: section.id, title: title.trim(), status, data, company: company.trim() || null, controlled }); toast(t("saved", lang)); onSaved(); }
    catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(false); }
  };
  const dup = async () => {
    try { await store.save({ section: section.id, title: `${title} (copy)`, status: section.statuses[0], data: { ...data, sample: undefined }, company: company.trim() || null, controlled }); toast(t("duplicated", lang)); onReload ? onReload() : onSaved(); }
    catch (e: any) { toast(e.message || "Error", true); }
  };
  const del = async () => { if (!rec) return; try { await store.remove(rec.id); toast(t("deleted", lang)); onSaved(); } catch (e: any) { toast(e.message || "Error", true); } };
  const addCmt = async () => { if (!rec || !cmt.trim()) return; try { await store.addComment(rec.id, cmt.trim()); setCmt(""); setComments(await store.comments(rec.id)); } catch (e: any) { toast(e.message || "Error", true); } };

  const current: Rec = { ...(rec as Rec), title, status, data, controlled };
  const md = () => recordMarkdown(section, current, lang);
  const copy = async () => { try { await navigator.clipboard.writeText(md()); toast(t("copied", lang)); } catch { toast("Clipboard blocked", true); } };
  const share = async () => {
    const url = `${location.origin}${location.pathname}?r=${rec?.id}`;
    try { if (navigator.share) { await navigator.share({ title: `AGRON · ${title}`, url }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(url); toast(t("share_text", lang)); } catch {}
  };
  const pdf = async () => { toast(t("pdf_wait", lang)); try { await markdownToPdf(typeof data.document === "string" && data.document ? data.document : md(), { title, filename: `AGRON_${slug(title)}` }); } catch (e: any) { toast(e.message || "PDF error", true); } };

  const field = (f: any) => {
    const v = data[f.key] ?? ""; const set = (x: any) => setData((d) => ({ ...d, [f.key]: x })); const id = `f-${f.key}`;
    const ro = !canWrite;
    let ctl;
    if (f.type === "checklist") {
      const items = CHECKLISTS[f.list] || []; const val = (v && typeof v === "object" ? v : {}) as Record<string, boolean>;
      const done = items.filter((_, i) => val[i]).length;
      return <details key={f.key} className="field wide checklist"><summary><b>{tx(f.label, lang)}</b> <span className="chip mono" style={{ marginInlineStart: 6 }}>{done}/{items.length}</span>
        <span className="bar" style={{ display: "inline-block", width: 120, verticalAlign: "middle", marginInlineStart: 8 }}><span style={{ width: `${(done / items.length) * 100}%` }} /></span></summary>
        <div className="cl-grid">{items.map((it, i) => <label key={i} className="check"><input type="checkbox" disabled={ro} checked={!!val[i]} onChange={(e) => set({ ...val, [i]: e.target.checked })} /><span className="mono faint" style={{ minWidth: 22 }}>{i + 1}.</span>{it}</label>)}</div></details>;
    }
    if (f.type === "ref") return <RefField key={f.key} f={f} data={data} setData={setData} ro={ro} />;
    if (f.type === "html") return v ? <div key={f.key} className="field wide"><label>{tx(f.label, lang)}</label><iframe title={tx(f.label, lang)} className="mailframe" style={{ height: 560 }} srcDoc={String(v)} sandbox="" /></div> : null;
    if (f.type === "select") ctl = <select id={id} className="input" value={v} disabled={ro} onChange={(e) => set(e.target.value)}><option value="" />{f.options.map((o: string) => <option key={o}>{o}</option>)}</select>;
    else if (f.type === "long") ctl = <textarea id={id} className="input" value={v} readOnly={ro} rows={3} onChange={(e) => set(e.target.value)} />;
    else if (f.type === "check") return <label key={f.key} className="check wide"><input id={id} type="checkbox" checked={!!v} disabled={ro} onChange={(e) => set(e.target.checked)} />{tx(f.label, lang)}</label>;
    else ctl = <input id={id} className={`input ${f.type === "money" || f.type === "number" ? "mono" : ""}`} readOnly={ro} list={PEOPLE_KEYS.includes(f.key) ? "people-list" : undefined} type={f.type === "date" ? "date" : f.type === "url" ? "url" : f.type === "money" || f.type === "number" ? "number" : "text"} value={v} onChange={(e) => set(f.type === "money" || f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />;
    return <div key={f.key} className={`field ${f.type === "long" ? "wide" : ""}`}><label htmlFor={id}>{tx(f.label, lang)}</label>{ctl}{f.type === "url" && v ? <a href={v} target="_blank" rel="noopener" className="hint">{v}</a> : null}</div>;
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title || t("new", lang)}>
        <div className="drawer-h">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="eyebrow">{tx(section.label, lang)}</div>
            <h2>{rec ? title : t("new", lang)}</h2>
            <div className="toolbar">{status && <span className={`chip dot ${tone(status)}`}>{status}</span>}{controlled && <span className="chip c-warn"><Icon n="lock" className="lockico" />{t("controlled_short", lang)}</span>}{data.sample && <span className="chip c-vio">{t("sample", lang)}</span>}
              {trd && <button className="chip tr-chip" onClick={flip} title={orig ? t("tr_orig_note", lang) : t("tr_from", lang).replace("{l}", srcName)}><Icon n="globe" className="lockico" />{orig ? t("tr_back", lang) : `${srcName ? t("tr_from", lang).replace("{l}", srcName) : t("tr_auto", lang)} · ${t("tr_orig", lang)}`}</button>}</div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label={t("close", lang)}><Icon n="x" /></button>
        </div>
        <div className="drawer-b">
          {rec && <div className="toolbar">
            <button className="btn ghost sm" onClick={copy}><Icon n="copy" />{t("copy", lang)}</button>
            <button className="btn ghost sm" onClick={() => window.print()}><Icon n="print" />{t("print", lang)}</button>
            <button className="btn ghost sm" onClick={pdf}><Icon n="pdf" />{t("pdf", lang)}</button>
            <button className="btn ghost sm" onClick={share}><Icon n="share" />{t("share", lang)}</button>
            <button className="btn ghost sm" onClick={() => saveBlob(`AGRON_${slug(title)}.md`, md(), "text/markdown;charset=utf-8")}><Icon n="download" />{t("download", lang)}</button>
            <button className="btn sm" onClick={() => openMail({ section: section.id, record: current })}><Icon n="mail" />{t("email_btn", lang)}</button>
            {canWrite && <button className="btn ghost sm" onClick={dup}><Icon n="dup" />{t("duplicate", lang)}</button>}
            {section.id === "legal.matrix" && <button className="btn sm" style={{ borderColor: "var(--dc)", color: "var(--dc)" }} onClick={() => openAi({ title, section: section.id, record: current, desk: "export", format: "item", ask: t("ai_review_ask", lang), onApply: canWrite ? (txt: string) => setData((d) => ({ ...d, ai_review: txt })) : undefined })}><Icon n="spark" />{t("ai_review_btn", lang)}</button>}
            <button className="btn sm" onClick={() => openAi({ title, section: section.id, record: current, desk: deskById(data.desk)?.id || (section.dept === "legal" ? "export" : undefined), onApply: canWrite && APPLY[section.id] ? (txt: string) => setData((d) => ({ ...d, [APPLY[section.id]]: txt })) : undefined })}><Icon n="spark" />{t("ask_ai", lang)}</button>
          </div>}
          <div className="fgrid">
            <div className="field wide"><label htmlFor="f-title">{t("title", lang)}</label><input id="f-title" className="input" value={title} readOnly={!canWrite} onChange={(e) => setTitle(e.target.value)} /></div>
            {!rec && similar.length > 0 && <div className="field wide dup-warn" role="status"><b><Icon n="dup" className="lockico" /> {tx({ en: "Similar records already exist — maybe one of them is what you need:", ru: "Похожие записи уже есть — возможно, нужная среди них:", uk: "Схожі записи вже є — можливо, потрібна серед них:", ar: "توجد سجلات مشابهة — ربما ما تحتاجه بينها:" }, lang)}</b>
              <div className="toolbar" style={{ gap: 6 }}>{similar.map((r) => <a key={r.id} className="chip" href={`/${section.id.replace(".", "/")}?r=${r.id}`}>{r.title}{r.status ? ` · ${r.status}` : ""}</a>)}</div></div>}
            <div className="field"><label htmlFor="f-status">{t("status", lang)}</label><select id="f-status" className="input" value={status} disabled={!canWrite} onChange={(e) => setStatus(e.target.value)}>{section.statuses.map((s: string) => <option key={s}>{s}</option>)}</select></div>
            {section.fields.some((f: any) => f.type === "date") && !section.fields.some((f: any) => f.key === "frequency" && f.type === "select") && <div className="field"><label htmlFor="f-repeat">{tx({ en: "Repeat", ru: "Повторять", uk: "Повторювати", ar: "تكرار" }, lang)}</label>
              <select id="f-repeat" className="input" value={data.repeat || ""} disabled={!canWrite} onChange={(e) => setData((d) => ({ ...d, repeat: e.target.value || undefined }))}>
                {([["", "No", "Нет", "Ні", "لا"], ["weekly", "Every week", "Каждую неделю", "Щотижня", "كل أسبوع"], ["monthly", "Every month", "Каждый месяц", "Щомісяця", "كل شهر"], ["quarterly", "Every quarter", "Каждый квартал", "Щокварталу", "كل ربع سنة"], ["yearly", "Every year", "Каждый год", "Щороку", "كل سنة"]] as string[][]).map(([v, en, ru, uk, ar]) => <option key={v} value={v}>{tx({ en, ru, uk, ar }, lang)}</option>)}
              </select>{data.repeat && <span className="hint">{tx({ en: "When this one is completed, the next one is created with the dates moved forward.", ru: "Когда эта будет завершена, следующая создастся сама с перенесёнными датами.", uk: "Коли цю буде завершено, наступна створиться сама з перенесеними датами.", ar: "عند إكمال هذا يُنشأ التالي تلقائياً بتواريخ مُرحّلة." }, lang)}</span>}</div>}
            {section.fields.map((f: any, i: number) => { const g = f.group && f.group !== section.fields[i - 1]?.group ? <div key={`g-${f.group}`} className="fgroup wide">{(GROUPS[f.group] as any)?.[lang]}</div> : null; return g ? [g, field(f)] : field(f); })}
            {gateBlocked && <div className="gate-msg wide">{tx(gate.msg, lang)}</div>}
            {canWrite && section.controlled && me.us_person && <label className="check wide"><input type="checkbox" checked={controlled} onChange={(e) => setControlled(e.target.checked)} /><Icon n="lock" className="lockico" />{t("controlled", lang)}</label>}
            {canWrite && section.external?.length > 0 && <div className="field wide"><label htmlFor="f-company">{t("visibility", lang)}</label><input id="f-company" className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="" /><span className="hint">{t("vis_hint", lang)}</span></div>}
          </div>
          {typeof data.document === "string" && data.document && <details className="card doc-block" open>
            <summary><Icon n="file" /> <b>{t("document", lang)}</b>
              <span className="toolbar" style={{ marginInlineStart: "auto" }} onClick={(e) => e.preventDefault()}>
                <button className="btn ghost sm" onClick={async () => { await navigator.clipboard.writeText(data.document); toast(t("copied", lang)); }}><Icon n="copy" />{t("copy", lang)}</button>
                <button className="btn ghost sm" onClick={() => printHtml(title, DOMPurify.sanitize(marked.parse(data.document) as string))}><Icon n="print" />{t("print", lang)}</button>
              </span></summary>
            <div className="md tpl-paper" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(data.document) as string) }} />
          </details>}
          {rec && <ChainPanel rec={current} />}
          <RecordTools section={section} data={data} setData={setData} canWrite={canWrite} />
          {rec && section.id === "sales.pipeline" && !isExternal(me.role) && <ProposalBuilder deal={rec} onDone={onReload || onSaved} />}
          {rec && section.id === "sales.clients" && !isExternal(me.role) && <PortalLinks client={rec} />}
          {rec && section.id === "sales.pipeline" && ["Won", "Negotiation"].includes(rec.status || "") && !isExternal(me.role) && <ProjectPlanner deal={rec} onDone={onReload || onSaved} />}
          {section.dept === "marketing" && <MarketingStudio section={section} title={title} data={data} setData={setData} canWrite={canWrite} saved={!!rec} />}
          <datalist id="people-list">{people.map((p) => <option key={p.id} value={p.full_name || p.email} />)}</datalist>
          {rec && APPROVALS[section.id] && <Approval rec={rec} canWrite={canWrite} onChanged={onSaved} />}
          {section.id !== "mail.outbox" && <Attachments section={section} rec={rec} canWrite={canWrite} title={title} />}
          {rec && <div className="thread">
            <div className="eyebrow">{t("comments", lang)}</div>
            {comments.map((c) => <div key={c.id} className="cmt"><small>{(c.created_at || "").slice(0, 16).replace("T", " ")}</small><div style={{ whiteSpace: "pre-wrap" }}>{cmtText(c)}</div>{!orig && cmtText(c) !== c.body && <small className="faint"><Icon n="globe" className="lockico" /> {t("tr_auto", lang)}</small>}</div>)}
            <div className="toolbar" style={{ flexWrap: "nowrap" }}><input className="input" value={cmt} placeholder={t("add_comment_at", lang)} onChange={(e) => setCmt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCmt()} aria-label={t("add_comment", lang)} /><button className="btn" onClick={addCmt}>{t("send", lang)}</button></div>
          </div>}
          {rec && hist.length > 0 && <div className="thread">
            <div className="eyebrow">{t("history", lang)}</div>
            {hist.map((h) => <div key={h.id} className="faint" style={{ fontSize: 12.5 }}><span className="mono">{(h.created_at || "").slice(0, 16).replace("T", " ")}</span> · {h.action}{h.action === "status" && h.detail ? `: ${h.detail.from || "—"} → ${h.detail.to}` : ""}</div>)}
          </div>}
        </div>
        <div className="drawer-f">
          {canWrite && <button className="btn primary" disabled={busy || !title.trim()} onClick={save}>{t("save", lang)}</button>}
          <button className="btn ghost" onClick={onClose}>{canWrite ? t("cancel", lang) : t("close", lang)}</button>
          <span style={{ flex: 1 }} />
          {rec && canWrite && (confirmDel
            ? <><span className="faint" style={{ alignSelf: "center", fontSize: 12.5 }}>{t("confirm_delete", lang)}</span><button className="btn danger" onClick={del}>{t("delete", lang)}</button><button className="btn ghost" onClick={() => setConfirmDel(false)}>{t("cancel", lang)}</button></>
            : <button className="btn ghost danger" onClick={() => setConfirmDel(true)}><Icon n="trash" />{t("delete", lang)}</button>)}
        </div>
      </aside>
      {/* Branded sheet used for PDF export */}
      <div ref={printRef} hidden style={{ position: "fixed", left: -10000, top: 0, width: 794, background: "#fff", color: "#111820", fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, sans-serif", fontSize: 13 }} dir={lang === "ar" ? "rtl" : "ltr"}>
        <div style={{ background: "#141A21", padding: "22px 36px", borderBottom: "3px solid #FF6A2B", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <img src="/logo-mark.webp" alt="AGRON™" style={{ height: 38 }} /><span style={{ color: "#C7D0DA", fontSize: 11 }}>AGRON WORKSPACE · {new Date().toISOString().slice(0, 10)}</span></div>
        <div style={{ padding: "22px 36px" }}>
          <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "#7A8796" }}>{tx(section.label, lang)}</div>
          <h1 style={{ fontFamily: "Unbounded, sans-serif", fontSize: 19, margin: "4px 0 6px" }}>{title}</h1>
          <div style={{ color: "#4B5867", marginBottom: 14 }}>{status}{controlled ? " · CONTROLLED — US persons only" : ""}</div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}><tbody>
            {section.fields.filter((f: any) => f.type !== "html" && data[f.key] !== undefined && data[f.key] !== "").map((f: any) => <tr key={f.key}><td style={{ border: "1px solid #D5DCE4", padding: "6px 8px", background: "#F5F7F9", width: "34%" }}>{tx(f.label, lang)}</td><td style={{ border: "1px solid #D5DCE4", padding: "6px 8px", whiteSpace: "pre-wrap" }}>{fmt(f, data[f.key], lang, data)}</td></tr>)}
          </tbody></table>
        </div>
        <div style={{ margin: "0 36px 24px", paddingTop: 10, borderTop: "1px solid #D5DCE4", color: "#7A8796", fontSize: 10 }}>© 2026 AGRON Inc. All rights reserved. · {t("foot_conf", lang)} · www.agron1.com</div>
      </div>
    </>
  );
}
