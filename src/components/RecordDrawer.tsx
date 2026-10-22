"use client";
import { PEOPLE_KEYS } from "@/lib/insights";
import Approval from "./Approval";
import dynamic from "next/dynamic";
const ProposalBuilder = dynamic(() => import("./ProposalBuilder"), { ssr: false });
const ProjectPlanner = dynamic(() => import("./ProjectPlanner"), { ssr: false });
const ProjectMoney = dynamic(() => import("./ProjectMoney"), { ssr: false });
const PortalLinks = dynamic(() => import("./PortalLinks"), { ssr: false });
const SlaPanel = dynamic(() => import("./SlaPanel"), { ssr: false });
const BuildParts = dynamic(() => import("./BuildParts"), { ssr: false });
const MilestoneNote = dynamic(() => import("./MilestoneNote"), { ssr: false });
const Collection = dynamic(() => import("./Collection"), { ssr: false });
const ServicePanel = dynamic(() => import("./ServicePanel"), { ssr: false });
const VendorScore = dynamic(() => import("./VendorScore"), { ssr: false });
const PreCheck = dynamic(() => import("./PreCheck"), { ssr: false });
import MarketingStudio from "./MarketingStudio";
import { RecordTools } from "./DeptTools";
import { RefField, ChainPanel } from "./Links";
import { APPROVALS } from "@/config/approvals";
import { ROLES, gateBlocks } from "@/config/workspace.config.mjs";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { t, tx } from "@/lib/i18n";
import { trFields, trPending, trText } from "@/lib/tr";
import { Activity, Comment, DEMO, Rec, isConflict, isExternal, store, textSim, type FileItem } from "@/lib/store";
import Discussion from "./Discussion";
import MeetingPanel from "./MeetingPanel";
import DocumentPanel from "./DocumentPanel";
import { AnnouncementPanel, AudienceField } from "./Announcements";
import { merge3, resolve, type Conflict } from "@/lib/merge";
import ConflictDialog from "./ConflictDialog";
import { CommentBody, DeptField, MentionInput, PeopleField, PersonField, RichField, isEmployee, personName } from "./PeopleFields";
import { fmt, printHtml, recordMarkdown, saveBlob, slug, spendMsg, tone } from "@/lib/format";
import { shipMsg } from "@/lib/shipgate";
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

// fields that name a person (shared with "My day" and notifications): a chosen name also links the account

export default function RecordDrawer({ section, rec, onClose, onSaved, onReload }: { section: any; rec: Rec | null; onClose: () => void; onSaved: () => void; onReload?: () => void }) {
  const { lang, me, access, toast, openAi, openMail, people, rules } = useApp();
  const canWrite = access.write.has(section.id) && !isExternal(me.role);
  const [title, setTitle] = useState(rec?.title || "");
  const [status, setStatus] = useState(rec?.status || section.statuses[0]);
  // a new record can start with values from the link (e.g. a task created from a project page: ?new=1&project_ref=…)
  const [data, setData] = useState<Record<string, any>>(() => {
    if (rec) return { ...(rec.data || {}) };
    const init: Record<string, any> = {}; if (typeof window === "undefined") return init;
    const q = new URLSearchParams(window.location.search); const keys = new Set(section.fields.flatMap((f: any) => [f.key, `${f.key}_id`, `${f.key}_title`]));
    q.forEach((v, k) => { if (keys.has(k) && v.length < 300) init[k] = v; });
    if (init.assignee_id && !init.assignee) { const p = people.find((x) => x.id === init.assignee_id); if (p) init.assignee = p.full_name || p.email; }
    return init;
  });
  const [company, setCompany] = useState(rec?.company || "");
  const [controlled, setControlled] = useState(!!rec?.controlled);
  const [comments, setComments] = useState<Comment[]>([]);
  const [hist, setHist] = useState<Activity[]>([]);
  const [versions, setVersions] = useState<FileItem[]>([]);
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
      // opened from a notification or Messages: show that comment
      const h = typeof location !== "undefined" ? location.hash : ""; if (h.startsWith("#c-")) setTimeout(() => document.getElementById(h.slice(1))?.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
      // Written by an agent, by e-mail intake or before translation was on: translate it now (in the background)
      if (DEMO) return; const o = store.original(rec);
      const need = Object.keys(trPending(trFields(section.fields, o.title, o.data || {}), o.data?._tr)).length || cs.some((c) => o.data?._tr?.c?.[c.id] === undefined && /\p{L}{2,}/u.test(c.body));
      if (need) fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rec.id }) }).catch(() => {});
    }).catch(() => {});
    store.activity({ recordId: rec.id, limit: 40 }).then(setHist).catch(() => {});
    store.markRead(rec.id).catch(() => {});
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
    const sp = await store.spendCheck(section.id, rec?.id, status, data); if (sp) { toast(spendMsg(sp.roles, lang, (r) => tx((ROLES as any)[r]?.label, lang)), true); return; }
    if (status !== rec?.status) { const sm = await store.shipCheck(section.id, status, data); if (sm.length) { toast(shipMsg(sm, lang), true); return; } }
    setBusy(true);
    // names typed before the people list arrived still get linked to the person's account
    const linked = { ...data }; for (const k of PEOPLE_KEYS) if (linked[k] && !linked[`${k}_id`]) { const p = people.find((q) => (q.full_name || q.email) === linked[k] || q.email === linked[k]); if (p) linked[`${k}_id`] = p.id; }
    const mine = { id: rec?.id, section: section.id, title: title.trim(), status, data: linked, company: company.trim() || null, controlled, version: rec?.version };
    try { await store.save({ ...mine, _base: rec ? store.original(rec) : null } as any); toast(t("saved", lang)); onSaved(); }
    catch (e: any) { if (isConflict(e) && rec) await onConflict(store.toOriginal(mine), e.theirs); else toast(e.message || "Error", true); } finally { setBusy(false); }
  };
  // Saved by someone else in the meantime: combine what does not overlap, ask about the rest (nothing is overwritten silently)
  const [cf, setCf] = useState<null | { conflicts: Conflict[]; merged: any; theirs: any }>(null);
  const onConflict = async (mine: any, theirs: any) => {
    const m = merge3(store.original(rec!), mine, theirs);
    if (!m.conflicts.length) {
      try { await store.save({ ...mine, ...m.merged, id: rec!.id, section: section.id, version: theirs.version } as any); toast(tx({ en: "Saved together with a colleague's changes made meanwhile", ru: "Сохранено вместе с изменениями коллеги, сделанными за это время", uk: "Збережено разом зі змінами колеги, зробленими за цей час", ar: "حُفظ مع تغييرات زميل أُجريت في الأثناء" }, lang)); onSaved(); }
      catch (e: any) { if (isConflict(e)) await onConflict(mine, e.theirs); else toast(e.message || "Error", true); }
      return;
    }
    setCf({ conflicts: m.conflicts, merged: { ...mine, ...m.merged }, theirs });
  };
  const resolveConflict = async (choice: Record<string, "mine" | "theirs">) => {
    if (!cf) return; const out = resolve(cf.merged, cf.conflicts, choice); setCf(null); setBusy(true);
    try { await store.save({ ...out, id: rec!.id, section: section.id, version: cf.theirs.version } as any); toast(t("saved", lang)); onSaved(); }
    catch (e: any) { if (isConflict(e)) await onConflict(out, e.theirs); else toast(e.message || "Error", true); } finally { setBusy(false); }
  };
  const fieldLabel = (k: string) => k === "title" ? t("title", lang) : k === "status" ? t("status", lang) : k === "company" ? t("visibility", lang) : k === "controlled" ? "US persons only" : tx(section.fields.find((f: any) => f.key === k.replace(/^data\./, ""))?.label, lang) || k.replace(/^data\./, "");
  const dup = async () => {
    try { await store.save({ section: section.id, title: `${title} (copy)`, status: section.statuses[0], data: { ...data, sample: undefined }, company: company.trim() || null, controlled }); toast(t("duplicated", lang)); onReload ? onReload() : onSaved(); }
    catch (e: any) { toast(e.message || "Error", true); }
  };
  const del = async () => { if (!rec) return; try { await store.remove(rec.id); toast(t("deleted", lang)); onSaved(); } catch (e: any) { toast(e.message || "Error", true); } };
  const shared = !!section.external?.length && !isExternal(me.role);
  // who can be mentioned: colleagues who may read this record (the database checks it again before telling anyone)
  const canRead = (p: any) => ["owner", "admin"].includes(p.role) || (rules || []).some((x) => x.role === p.role && x.section === section.id);
  const mentionable = people.filter((p) => isEmployee(p) && p.id !== me.id && canRead(p) && (!controlled || p.us_person));
  const who = (id?: string | null) => { const p = people.find((x) => x.id === id); return p ? personName(p) : ""; };

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
    const v = data[f.key] ?? ""; const id = `f-${f.key}`;
    // a name picked from the people list also links the record to that person's account (notifications, "My day")
    const set = (x: any) => setData((d) => { const n: Record<string, any> = { ...d, [f.key]: x }; if (PEOPLE_KEYS.includes(f.key)) { const p = people.find((q) => (q.full_name || q.email) === x); if (p) n[`${f.key}_id`] = p.id; else delete n[`${f.key}_id`]; } return n; });
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
    if (f.type === "person") return <PersonField key={f.key} f={f} data={data} setData={setData} ro={ro} id={id} />;
    if (f.type === "people") return <PeopleField key={f.key} f={f} data={data} setData={setData} ro={ro} />;
    if (f.type === "dept") return <DeptField key={f.key} f={f} value={v} set={set} ro={ro} id={id} />;
    if (f.type === "rich") return <RichField key={f.key} f={f} value={v} set={set} ro={ro} id={id} />;
    if (section.id === "company.announcements" && f.key === "audience") return <AudienceField key={f.key} data={data} setData={setData} ro={ro} />;
    if (f.type === "readonly") return v ? <div key={f.key} className="field"><label>{tx(f.label, lang)}</label><div className="input ro mono" id={id} data-field={f.key}>{String(v)}</div></div> : null;
    if (f.auto) return v ? <div key={f.key} className="field"><label>{tx(f.label, lang)}</label><div className="input ro mono" id={id}>{String(v)}</div></div> : null;
    if (f.type === "html") return v ? <div key={f.key} className="field wide"><label>{tx(f.label, lang)}</label><iframe title={tx(f.label, lang)} className="mailframe" style={{ height: 560 }} srcDoc={String(v)} sandbox="" /></div> : null;
    if (f.type === "catalog" || f.type === "multi") return <CatalogField key={f.key} f={f} value={data[f.key]} set={set} ro={ro} id={id} lang={lang} />;
    if (f.type === "select") ctl = <select id={id} className="input" value={v} disabled={ro} onChange={(e) => set(e.target.value)}><option value="" />{f.options.map((o: string) => <option key={o}>{o}</option>)}</select>;
    else if (f.type === "long") ctl = <textarea id={id} className="input" value={v} readOnly={ro} rows={3} onChange={(e) => set(e.target.value)} />;
    else if (f.type === "check") return <label key={f.key} className="check wide"><input id={id} type="checkbox" checked={!!v} disabled={ro} onChange={(e) => set(e.target.checked)} />{tx(f.label, lang)}</label>;
    else ctl = <input id={id} className={`input ${f.type === "money" || f.type === "number" ? "mono" : ""}`} readOnly={ro} list={PEOPLE_KEYS.includes(f.key) ? "people-list" : undefined} type={f.type === "date" ? "date" : f.type === "time" ? "time" : f.type === "url" ? "url" : f.type === "money" || f.type === "number" ? "number" : "text"} value={v} onChange={(e) => set(f.type === "money" || f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />;
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
          {rec && section.id === "company.projects" && <a className="btn primary sm" href={`/projects/${rec.id}`} style={{ justifySelf: "start" }}><Icon n="layers" />{tx({ en: "Open the project page", ru: "Открыть страницу проекта", uk: "Відкрити сторінку проєкту", ar: "افتح صفحة المشروع" }, lang)}</a>}
          {rec && <ChainPanel rec={current} />}
          <RecordTools section={section} data={data} setData={setData} canWrite={canWrite} />
          {rec && section.id === "sales.pipeline" && !isExternal(me.role) && <ProposalBuilder deal={rec} onDone={onReload || onSaved} />}
          {rec && section.id === "sales.clients" && !isExternal(me.role) && <PortalLinks client={rec} />}
          {rec && section.id === "operations.support" && <SlaPanel rec={rec} />}
          {rec && section.id === "operations.builds" && !isExternal(me.role) && <BuildParts build={rec} />}
          {rec && section.id === "finance.invoices" && <MilestoneNote rec={rec} />}
          {rec && section.id === "finance.invoices" && !isExternal(me.role) && <Collection rec={rec} />}
          {rec && section.id === "operations.fleet" && !isExternal(me.role) && <ServicePanel unit={rec} />}
          {rec && section.id === "operations.vendors" && !isExternal(me.role) && <VendorScore vendor={store.original(rec).title} />}
          {rec && section.id === "operations.procurement" && !isExternal(me.role) && <VendorScore vendor={String(store.original(rec).data?.vendor || "")} />}
          {rec && section.id === "sales.pipeline" && ["Won", "Negotiation"].includes(rec.status || "") && !isExternal(me.role) && <ProjectPlanner deal={rec} onDone={onReload || onSaved} />}
          {rec && section.id === "sales.pipeline" && rec.status === "Won" && !isExternal(me.role) && <ProjectMoney deal={rec} />}
          {section.dept === "marketing" && <MarketingStudio section={section} title={title} data={data} setData={setData} canWrite={canWrite} saved={!!rec} />}
          <datalist id="people-list">{people.map((p) => <option key={p.id} value={p.full_name || p.email} />)}</datalist>
          {rec && rec.data?._email && !isExternal(me.role) && !rec.section.startsWith("sales.pipeline") && <CrmMailLinks rec={rec} lang={lang} />}
          {rec && Array.isArray(rec.data?._suggested_links) && rec.data._suggested_links.length > 0 && !isExternal(me.role) && <div className="thread"><div className="eyebrow">{tx({ en: "From the e-mail: possibly related (suggestion — check before linking)", ru: "Из письма: возможно связано (подсказка — проверьте перед привязкой)", uk: "З листа: можливо пов'язано (підказка — перевірте перед прив'язкою)", ar: "من البريد: قد يكون مرتبطاً (اقتراح — تحقق قبل الربط)" }, lang)}</div>
            <div className="toolbar">{rec.data._suggested_links.map((l: any) => <a key={l.kind + l.id} className="chip" href={l.kind === "thread" ? "/system?tab=ops" : l.kind === "project" ? `/projects/${l.id}` : `/${l.kind === "supplier" ? "operations/vendors" : "operations/procurement"}?r=${l.id}`} title={l.why}>{l.kind}: {l.title} · {l.strength}</a>)}</div></div>}
          {section.id === "company.meetings" && <MeetingPanel rec={rec} data={data} setData={setData} canWrite={canWrite} onDone={onReload || onSaved} />}
          {rec && section.id === "company.announcements" && <AnnouncementPanel rec={rec} />}
          {rec && APPROVALS[section.id]?.wait.includes(rec.status || "") && !isExternal(me.role) && <PreCheck rec={rec} />}
          {rec && APPROVALS[section.id] && <Approval rec={rec} canWrite={canWrite} onChanged={onSaved} />}
          {rec && section.id === "company.documents" ? <DocumentPanel rec={rec} canWrite={canWrite} onChanged={onReload || onSaved} onVersions={(v) => setVersions(v.map((x) => ({ name: x.file_name, path: x.path, size: x.size, type: x.mime || "", created_at: x.created_at, label: x.label } as any)))} />
            : section.id !== "mail.outbox" && <Attachments section={section} rec={rec} canWrite={canWrite} title={title} />}
          {rec && <Discussion rec={{ ...rec, company: rec.company }} versions={section.id === "company.documents" ? versions : undefined} textOf={cmtText}
            title={section.id === "company.documents" ? tx({ en: "Discussion and review notes", ru: "Обсуждение и замечания", uk: "Обговорення і зауваження", ar: "النقاش وملاحظات المراجعة" }, lang) : undefined} />}
          {rec && hist.length > 0 && <div className="thread">
            <div className="eyebrow">{t("history", lang)} · {tx({ en: "automatic", ru: "автоматически", uk: "автоматично", ar: "تلقائي" }, lang)}</div>
            {hist.map((h) => <div key={h.id} className="faint" style={{ fontSize: 12.5 }}><span className="mono">{(h.created_at || "").slice(0, 16).replace("T", " ")}</span>{who(h.actor) ? ` · ${who(h.actor)}` : ""} · {h.action}{h.action === "status" && h.detail ? `: ${h.detail.from || "—"} → ${h.detail.to}` : ""}</div>)}
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
      {cf && <ConflictDialog conflicts={cf.conflicts} at={cf.theirs?.updated_at} labelOf={fieldLabel} onResolve={resolveConflict} onCancel={() => setCf(null)} />}
    </>
  );
}

/* Phase 7: a choice from the commercial catalogs (Commercial → Settings), or several choices. The catalogs are
   configuration, not code: a value no longer in the catalog stays shown as it was saved. */
let CATS: Promise<any> | null = null;
function CatalogField({ f, value, set, ro, id, lang }: { f: any; value: any; set: (v: any) => void; ro: boolean; id: string; lang: any }) {
  const [opts, setOpts] = useState<string[]>(f.options || []);
  useEffect(() => { const key = f.catalog || (f.key === "relationship_types" ? "relationship_types" : null); if (!key) return;
    if (!CATS) CATS = import("@/lib/crmApi").then((m) => m.crm.catalogs()).catch(() => null);
    CATS.then((c) => { const l = c?.[key]; if (Array.isArray(l) && l.length) setOpts(l.map((x: any) => (typeof x === "string" ? x : x.stage || x.name || String(x)))); }); }, [f.catalog, f.key]);
  if (f.type === "multi") {
    const cur: string[] = Array.isArray(value) ? value : value ? [String(value)] : [];
    const all = Array.from(new Set([...opts, ...cur]));
    return <div className="field wide" data-field={f.key}><label>{tx(f.label, lang)}</label><div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{all.map((o) => <label key={o} className="check"><input type="checkbox" disabled={ro} checked={cur.includes(o)} onChange={(e) => set(e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} />{o}</label>)}</div></div>;
  }
  const v = value ?? ""; const all = v && !opts.includes(v) ? [...opts, v] : opts;
  return <div className="field"><label htmlFor={id}>{tx(f.label, lang)}</label><select id={id} className="input" value={v} disabled={ro} onChange={(e) => set(e.target.value)}><option value="" />{all.map((o) => <option key={o}>{o}</option>)}</select></div>;
}

/* Phase 7: a record filed from an e-mail — which organisation, contact, lead or opportunity it may belong to. Suggestions
   only (crm_email_suggest, records the person may open); a link exists only when the person confirms it. */
function CrmMailLinks({ rec, lang }: { rec: any; lang: any }) {
  const [s, setS] = useState<any[] | null>(null); const [done, setDone] = useState<Record<string, string>>({});
  const raw = String(rec.data?._email || ""); const i = raw.indexOf(" — "); const from = i > 0 ? raw.slice(0, i) : raw; const subject = i > 0 ? raw.slice(i + 3) : "";
  useEffect(() => { import("@/lib/crmApi").then((m) => m.crm.emailSuggest(from, subject, "record", rec.id)).then((r: any) => setS(r?.suggestions || [])).catch(() => setS([])); }, [rec.id]); // eslint-disable-line
  if (!s || !s.length) return null;
  const act = (t: any, accept: boolean) => import("@/lib/crmApi").then((m) => m.crm.emailLink("record", rec.id, t.target, accept, subject, from)).then(() => setDone((d) => ({ ...d, [t.target]: accept ? "linked" : "rejected" }))).catch(() => {});
  return <div className="thread" data-crm-mail><div className="eyebrow">{tx({ en: "Commercial: this e-mail may belong to (suggestions — confirm each)", ru: "Коммерция: письмо может относиться к (предложения — подтвердите каждое)", uk: "Комерція: лист може стосуватися (пропозиції — підтвердьте кожну)", ar: "تجاري: قد تخص هذه الرسالة (اقتراحات — أكد كلًا منها)" }, lang)}</div>
    {s.slice(0, 6).map((t: any) => <div key={t.target} className="toolbar" style={{ gap: 6 }}><a className="chip" href={t.section === "sales.pipeline" ? `/crm?opp=${t.target}` : `/${String(t.section).replace(".", "/")}?r=${t.target}`}>{t.title}</a><small className="faint">{Array.isArray(t.why) ? t.why.join(", ") : t.why}</small>
      {done[t.target] ? <small className="chip">{done[t.target]}</small> : <><button className="btn ghost sm" data-mail-link={t.target} onClick={() => act(t, true)}>{tx({ en: "Link", ru: "Связать", uk: "Пов'язати", ar: "ربط" }, lang)}</button><button className="btn ghost sm" onClick={() => act(t, false)}>{tx({ en: "Not related", ru: "Не относится", uk: "Не стосується", ar: "غير مرتبط" }, lang)}</button></>}</div>)}</div>;
}
