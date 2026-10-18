"use client";
import { l2 } from "@/config/l2";
import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { t, tx, LANGS, Lang } from "@/lib/i18n";
import { DEMO, Rec, store } from "@/lib/store";
import { saveBlob } from "@/lib/format";
import { COMPANY, MAIL_CATS, MailTemplate, TEMPLATES, fill, pick, plainText, renderEmail, varsOf } from "@/lib/mail";
/** Interface labels (template names, categories): own translation first, then the Learning Center dictionary. */
const ui = (m: any, l: string) => (m ? m[l] || l2(m, l) : "");

export type MailInit = { template?: string; section?: string; record?: Rec; vars?: Record<string, string>; to?: string };

// Which template fits a section by default
const BY_SECTION: Record<string, string> = {
  "sales.pipeline": "intro", "sales.clients": "intro", "sales.proposals": "proposal", "sales.activities": "after_meeting", "sales.partners": "partner_welcome",
  "finance.invoices": "invoice", "finance.leasing": "leasing", "finance.investors": "investor_update",
  "operations.builds": "progress", "operations.logistics": "shipment", "operations.installation": "handover", "operations.fleet": "maintenance",
  "operations.support": "ticket_open", "operations.procurement": "po", "operations.vendors": "rfq",
  "marketing.media": "materials", "marketing.events": "event_invite", "marketing.campaigns": "newsletter", "marketing.leads": "intro",
  "hr.hiring": "interview", "hr.onboarding": "welcome_employee", "hr.team": "welcome_employee",
  "security.screening": "kyc", "legal.contracts": "nda", "company.meetings": "meeting_request",
};
// Record fields → template variables
const MAP: Record<string, string[]> = {
  client: ["client_name"], contact: ["contact_name"], counterparty: ["client_name", "company"], vendor: ["company"], config: ["config"],
  value: ["amount"], amount: ["amount"], currency: ["currency"], site: ["site_name"], valid_until: ["valid_until"], due: ["due_date", "date"],
  item: ["item"], qty: ["qty"], eta: ["eta"], from: ["from"], to: ["to"], incoterms: ["incoterms"], severity: ["severity"], city: ["city"],
  date: ["date"], person: ["first_name", "candidate"], position: ["position"], sla: ["sla"], next_service: ["date"], warranty_end: ["warranty_end"],
  segment: ["site_type"], structure: ["structure"], financier: ["financier"], term: ["term"], region: ["region"], party: ["client_name"],
  organization: ["company"], model: ["model"], round: ["period"],
};
export function prefill(sectionId?: string, r?: Rec) {
  const v: Record<string, string> = {}; let to = "";
  if (!r) return { v, to };
  for (const [k, val] of Object.entries(r.data || {})) {
    if (val === "" || val == null || typeof val === "object") continue;
    const s = String(val);
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) to = to || s;
    else if (/[^@\s]+@[^@\s]+\.[a-z]{2,}/i.test(s) && (k === "contact" || k === "email")) to = to || (s.match(/[^@\s<>(),;]+@[^@\s<>(),;]+\.[a-z]{2,}/i)?.[0] || "");
    for (const t of MAP[k] || []) if (!v[t]) v[t] = s;
  }
  const title = r.title || "";
  for (const k of ["proposal_no", "order_no", "invoice_no", "ticket_no", "po_no", "rfq_no", "event", "topic", "subject", "material", "headline"]) v[k] = v[k] || title;
  if (sectionId === "sales.pipeline" || sectionId === "sales.clients") v.client_name = v.client_name || title;
  return { v, to };
}

let smtpCache: boolean | null = null;
async function smtpOn() {
  if (DEMO) return false;
  if (smtpCache !== null) return smtpCache;
  try { const r = await fetch("/api/mail/send"); smtpCache = !!(await r.json()).configured; } catch { smtpCache = false; }
  return smtpCache;
}
const custom = (r: Rec): MailTemplate => {
  const l = r.data?.lang || "en"; const m = (x: string) => ({ en: x, ru: x, [l]: x } as any);
  return { id: `custom:${r.id}`, cat: "custom", custom: true, name: m(r.title), subject: m(r.data?.subject || r.title), heading: r.data?.heading ? m(r.data.heading) : undefined, body: m(r.data?.body || ""), cta: r.data?.cta_label ? { label: m(r.data.cta_label), url: r.data?.cta_url || "" } : undefined };
};

/* ---------------- Composer ---------------- */
function Composer({ tpl, init, onDone, templates, setTpl }: { tpl: MailTemplate; init?: MailInit; onDone?: () => void; templates: MailTemplate[]; setTpl: (id: string) => void }) {
  const { lang: uiLang, me, toast, access, reload } = useApp();
  const pre = useMemo(() => prefill(init?.section, init?.record), [init]);
  const [lang, setLang] = useState<Lang>(uiLang === "uk" || uiLang === "ar" ? uiLang : (uiLang as Lang));
  const [subject, setSubject] = useState(""); const [heading, setHeading] = useState(""); const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState(""); const [ctaUrl, setCtaUrl] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({ ...pre.v, ...(init?.vars || {}) });
  const [to, setTo] = useState(init?.to || pre.to || ""); const [cc, setCc] = useState("");
  const [busy, setBusy] = useState(""); const [smtp, setSmtp] = useState<boolean | null>(null);
  const [edit, setEdit] = useState(false); const [media, setMedia] = useState(false);

  useEffect(() => { smtpOn().then(setSmtp); }, []);
  useEffect(() => { // load template text for language
    setSubject(pick(tpl.subject, lang)); setHeading(pick(tpl.heading, lang)); setBody(pick(tpl.body, lang));
    setCtaLabel(tpl.cta ? pick(tpl.cta.label, lang) : ""); setCtaUrl(tpl.cta?.url || "");
  }, [tpl, lang]);

  const missingLang = !(tpl.body as any)[lang];
  const vlist = varsOf(subject, heading, body, ctaUrl);
  const sender = tpl.system ? null : COMPANY;
  const V = { ...vars, sender_name: "AGRON Inc.", sender_email: "info@agron1.com" };
  const build = (draft: boolean) => renderEmail({ subject: fill(subject, V), heading: fill(heading, V), body: fill(body, V), cta: ctaLabel ? { label: ctaLabel, url: fill(ctaUrl, V) } : null, lang, sender, draft, pre: fill(pick(tpl.pre, lang), V) });
  const html = build(true);
  const finalSubject = fill(subject, V);
  const missing = tpl.system ? [] : vlist.filter((k) => !vars[k]?.trim());
  const text = () => plainText({ body: fill(body, V), cta: ctaLabel ? { label: ctaLabel, url: fill(ctaUrl, V) } : null, sender, lang });
  const related = init?.record ? `${init.section}:${init.record.id} · ${init.record.title}` : "";

  const guard = () => { if (missing.length) { toast(`${t("variables", lang)}: ${missing.join(", ")}`, true); return false; } return true; };
  const log = async (status: string) => { try { await store.save({ section: "mail.outbox", title: finalSubject, status, data: { to, cc, template: tpl.id, sender: me.full_name, related, html: build(false) } }); } catch {} };

  const send = async () => {
    if (!guard()) return;
    if (!to.trim()) { toast(t("recipients_hint", lang), true); return; }
    setBusy("send");
    try {
      const r = await fetch("/api/mail/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, cc, subject: finalSubject, html: build(false), text: text(), template: tpl.id, related }) });
      if (!r.ok) throw new Error(await r.text());
      toast(t("sent_ok", lang)); onDone?.();
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };
  const gmail = async () => {
    if (!guard()) return;
    const u = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&cc=${encodeURIComponent(cc)}&su=${encodeURIComponent(finalSubject)}&body=${encodeURIComponent(text())}`;
    window.open(u, "_blank", "noopener"); await log("Opened in Gmail");
  };
  const copyFormatted = async () => {
    if (!guard()) return;
    const h = build(false);
    try { await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([text()], { type: "text/plain" }) })]); toast(t("copied", lang)); }
    catch { try { await navigator.clipboard.writeText(h); toast(t("copied", lang)); } catch { toast("Clipboard blocked", true); } }
  };
  const copyHtml = async () => { try { await navigator.clipboard.writeText(build(false)); toast(t("copied", lang)); } catch { toast("Clipboard blocked", true); } };
  const eml = () => {
    if (!guard()) return;
    const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
    const h = build(false);
    const m = [`To: ${to}`, cc ? `Cc: ${cc}` : "", `Subject: =?UTF-8?B?${b64(finalSubject)}?=`, "X-Unsent: 1", "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(h).replace(/.{76}/g, "$&\r\n")].filter((x, i) => x !== "" || i > 5).join("\r\n");
    saveBlob(`AGRON_${tpl.id}.eml`, m, "message/rfc822"); log("Opened in Gmail");
  };
  const saveTpl = async () => {
    try { await store.save({ section: "mail.templates", title: `${ui(tpl.name, uiLang)} (${lang.toUpperCase()})`, status: "Draft", data: { category: tpl.cat, lang, subject, heading, body, cta_label: ctaLabel, cta_url: ctaUrl } }); toast(t("saved", lang)); reload(); }
    catch (e: any) { toast(e.message || "Error", true); }
  };
  const translate = async () => {
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    const src = { subject: pick(tpl.subject, "en"), heading: pick(tpl.heading, "en"), body: pick(tpl.body, "en"), cta: tpl.cta ? pick(tpl.cta.label, "en") : "" };
    setBusy("tr");
    try {
      // Same translator as the rest of Workspace; each template is translated once and then comes from the cache
      const parts = [src.subject, src.heading, src.body, src.cta];
      const r = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: parts, lang }) });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()).texts || parts;
      setSubject(j[0] || ""); setHeading(j[1] || ""); setBody(j[2] || ""); if (src.cta) setCtaLabel(j[3] || src.cta);
    } catch (e: any) { toast(e.message || "Translation failed", true); } finally { setBusy(""); }
  };
  // A template without this language is translated automatically when chosen
  useEffect(() => { if (missingLang && !tpl.system && !DEMO) translate(); }, [tpl.id, lang]); // eslint-disable-line

  return (
    <div className="card" style={{ display: "grid", gap: 0, ["--cc" as any]: MAIL_CATS[tpl.cat]?.color }}>
      <div className="card-h">
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="eyebrow" style={{ color: MAIL_CATS[tpl.cat]?.color }}>{ui(MAIL_CATS[tpl.cat]?.label, uiLang)}</div>
          {onDone ? <select className="input" style={{ fontWeight: 600, marginTop: 4 }} value={tpl.id} onChange={(e) => setTpl(e.target.value)} aria-label={t("choose_template", uiLang)}>
            {Object.keys(MAIL_CATS).filter((c) => c !== "system").map((c) => { const list = templates.filter((x) => x.cat === c); return list.length ? <optgroup key={c} label={ui(MAIL_CATS[c].label, uiLang)}>{list.map((x) => <option key={x.id} value={x.id}>{ui(x.name, uiLang)}</option>)}</optgroup> : null; })}
          </select> : <h2 style={{ marginTop: 2 }}>{ui(tpl.name, uiLang)}</h2>}
        </div>
        <div className="seg" role="group" aria-label={t("language", uiLang)}>{LANGS.map((l) => <button key={l.code} className={lang === l.code ? "on" : ""} onClick={() => setLang(l.code)}>{l.short}</button>)}</div>
        {missingLang && !tpl.system && <button className="btn sm" disabled={!!busy} onClick={translate}><Icon n="spark" />{busy === "tr" ? t("translating", uiLang) : t("translate_ai", uiLang)}</button>}
      </div>
      <div className="card-b" style={{ display: "grid", gap: 14 }}>
        {tpl.system ? <div className="banner"><Icon n="info" /><span>{t("sys_note", uiLang)}</span></div> : <>
          <div className="vars">
            <div className="field"><label htmlFor="m-to">{t("to", uiLang)}</label><input id="m-to" className="input" type="email" multiple value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com, …" title={t("recipients_hint", uiLang)} /></div>
            <div className="field"><label htmlFor="m-cc">{t("cc", uiLang)}</label><input id="m-cc" className="input" type="email" multiple value={cc} onChange={(e) => setCc(e.target.value)} /></div>
          </div>
          {vlist.length > 0 && <div style={{ display: "grid", gap: 8 }}>
            <div className="toolbar"><div className="eyebrow" style={{ flex: 1 }}>{t("variables", uiLang)}</div>
              {access.read.has("marketing.media") && <button className="btn ghost sm" onClick={() => setMedia(true)}><Icon n="image" />{t("from_media", uiLang)}</button>}</div>
            <div className="vars">{vlist.map((k) => <div key={k} className="field"><label htmlFor={`v-${k}`}>{k.replace(/_/g, " ")}</label>
              {k === "links" ? <textarea id={`v-${k}`} className="input" rows={3} value={vars[k] || ""} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} />
                : <input id={`v-${k}`} className="input" value={vars[k] || ""} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} style={!vars[k] ? { borderColor: "color-mix(in srgb,var(--warn) 55%,var(--line))" } : undefined} />}</div>)}</div>
          </div>}
        </>}
        <details open={edit} onToggle={(e) => setEdit((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink-2)" }}><Icon n="edit" className="lockico" /> {t("body_text", uiLang)}</summary>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div className="field"><label htmlFor="m-sub">{t("subject", uiLang)}</label><input id="m-sub" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="field"><label htmlFor="m-h">{t("heading", uiLang)}</label><input id="m-h" className="input" value={heading} onChange={(e) => setHeading(e.target.value)} /></div>
            <div className="field"><label htmlFor="m-body">{t("body_text", uiLang)}</label><textarea id="m-body" className="input" rows={10} value={body} onChange={(e) => setBody(e.target.value)} /><span className="hint">{t("body_hint", uiLang)}</span></div>
            <div className="vars"><div className="field"><label htmlFor="m-cl">{t("button_text", uiLang)}</label><input id="m-cl" className="input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} /></div>
              <div className="field"><label htmlFor="m-cu">{t("button_link", uiLang)}</label><input id="m-cu" className="input" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} /></div></div>
          </div>
        </details>
        <div className="field"><label>{t("preview", uiLang)} · <span className="faint" style={{ fontWeight: 400 }}>{finalSubject}</span></label>
          <iframe title={t("preview", uiLang)} className="mailframe" srcDoc={html} sandbox="" /></div>
        {!tpl.system && smtp === false && <div className="banner"><Icon n="info" /><span>{t("smtp_off", uiLang)}</span></div>}
      </div>
      <div className="drawer-f" style={{ borderRadius: "0 0 14px 14px", position: "sticky", bottom: 0 }}>
        {tpl.system ? <button className="btn primary" onClick={copyHtml}><Icon n="copy" />{t("copy_html", uiLang)}</button> : <>
          <button className="btn primary" disabled={!smtp || !!busy} onClick={send}><Icon n="send" />{busy === "send" ? t("sending", uiLang) : t("send_email", uiLang)}</button>
          <button className={`btn ${smtp ? "" : "primary"}`} onClick={gmail}><Icon n="mail" />{t("open_gmail", uiLang)}</button>
          <button className="btn ghost" onClick={copyFormatted}><Icon n="copy" />{t("copy_formatted", uiLang)}</button>
          <button className="btn ghost" onClick={eml}><Icon n="download" />{t("download_eml", uiLang)}</button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={saveTpl}><Icon n="edit" />{t("save_template", uiLang)}</button>
          <button className="btn ghost" onClick={() => saveBlob(`AGRON_${tpl.id}.html`, build(false), "text/html;charset=utf-8")}><Icon n="file" />HTML</button></>}
      </div>
      {media && <MediaPicker onClose={() => setMedia(false)} onPick={(lines) => { setVars((v) => ({ ...v, links: [v.links, ...lines].filter(Boolean).join("\n"), material: v.material || "AGRON materials" })); if (!vlist.includes("links")) setBody((b) => `${b}\n\n${lines.join("\n")}`); toast(t("links_added", uiLang)); setMedia(false); }} />}
    </div>
  );
}

function MediaPicker({ onClose, onPick }: { onClose: () => void; onPick: (lines: string[]) => void }) {
  const { lang, toast } = useApp();
  const [items, setItems] = useState<Rec[] | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { store.list("marketing.media").then((r) => setItems(r.filter((x) => x.status !== "Archived"))).catch(() => setItems([])); }, []);
  const go = async () => {
    setBusy(true);
    try {
      const out: string[] = [];
      for (const r of (items || []).filter((x) => sel[x.id])) {
        if (r.data?.url) out.push(`- ${r.title}: ${r.data.url}`);
        for (const f of await store.files(`marketing.media/${r.id}`)) out.push(`- ${r.title} — ${f.name}: ${await store.fileUrl(f.path, 7 * 86400)}`);
      }
      onPick(out);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="scrim" style={{ zIndex: 72 }} onClick={onClose} />
      <div className="modal" style={{ zIndex: 73, width: "min(560px,calc(100% - 32px))", maxHeight: "80vh", overflow: "auto" }} role="dialog" aria-modal="true">
        <h2 style={{ margin: 0, fontFamily: "var(--f-display)", fontSize: 18 }}>{t("from_media", lang)}</h2>
        {!items ? <div className="faint">…</div> : !items.length ? <div className="empty">{t("empty", lang)}</div> : items.map((r) => (
          <label key={r.id} className="check att-row" style={{ cursor: "pointer" }}><input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel({ ...sel, [r.id]: e.target.checked })} />
            <span className="nm"><b>{r.title}</b> <span className="faint">· {r.data?.kind || ""} {r.data?.languages ? `· ${r.data.languages}` : ""}</span></span></label>))}
        <div className="toolbar"><button className="btn primary" disabled={busy || !Object.values(sel).some(Boolean)} onClick={go}><Icon n="link" />{busy ? "…" : t("apply", lang)}</button><button className="btn ghost" onClick={onClose}>{t("cancel", lang)}</button></div>
      </div>
    </>
  );
}

function useTemplates() {
  const { access, tick } = useApp();
  const [saved, setSaved] = useState<MailTemplate[]>([]);
  useEffect(() => { if (access.read.has("mail.templates")) store.list("mail.templates").then((r) => setSaved(r.map(custom))).catch(() => {}); }, [access, tick]);
  return useMemo(() => [...saved, ...TEMPLATES], [saved]);
}

/* ---------------- Mail center page ---------------- */
export default function MailCenter() {
  const { lang, me } = useApp();
  const all = useTemplates();
  const [id, setId] = useState("intro");
  const [q, setQ] = useState("");
  const isAdmin = me.role === "owner" || me.role === "admin";
  const list = all.filter((x) => (!x.system || isAdmin) && (!q || (ui(x.name, lang) + pick(x.subject, lang) + pick(x.name, "en")).toLowerCase().includes(q.toLowerCase())));
  const tpl = all.find((x) => x.id === id) || all[0];
  return (
    <>
      <section className="sec-hero" style={{ ["--dc" as any]: "#0EA5E9" }}>
        <span className="ic"><Icon n="mail" /></span>
        <div style={{ minWidth: 0, position: "relative", zIndex: 1 }}><div className="eyebrow" style={{ color: "#0EA5E9" }}>{t("mail_center", lang)}</div><h2>{t("templates", lang)}</h2>
          <div className="sub">{t("templates", lang)}: <b className="mono">{all.filter((x) => !x.system).length}</b> · EN · RU · UA · AR</div></div>
        <div className="stats">{Object.entries(MAIL_CATS).filter(([c]) => c !== "system" || isAdmin).map(([c, m]) => { const n = all.filter((x) => x.cat === c).length; return n ? <span key={c} className="stat" style={{ cursor: "default", borderColor: m.color }}><b style={{ color: m.color }}>{n}</b><small>{ui(m.label, lang)}</small></span> : null; })}</div>
      </section>
      <div className="mail-grid">
        <div className="card" style={{ position: "sticky", top: 8 }}>
          <div className="filters"><div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search_templates", lang)} aria-label={t("search_templates", lang)} /></div></div>
          <div className="tpl-list">
            {Object.entries(MAIL_CATS).map(([c, m]) => { const items = list.filter((x) => x.cat === c); return items.length ? (
              <div key={c} style={{ ["--cc" as any]: m.color }}>
                <div className="tpl-cat"><i />{ui(m.label, lang)}</div>
                {items.map((x) => <button key={x.id} className={`tpl ${x.id === tpl.id ? "on" : ""}`} onClick={() => setId(x.id)}><b>{ui(x.name, lang)}</b><small>{pick(x.subject, lang)}</small></button>)}
              </div>) : null; })}
          </div>
        </div>
        <Composer key={tpl.id} tpl={tpl} templates={all} setTpl={setId} />
      </div>
    </>
  );
}

/* ---------------- Composer as a drawer (from any record or section) ---------------- */
export function ComposerModal({ init, onClose }: { init: MailInit; onClose: () => void }) {
  const { lang } = useApp();
  const all = useTemplates();
  const [id, setId] = useState(init.template || BY_SECTION[init.section || ""] || "blank");
  const tpl = all.find((x) => x.id === id) || TEMPLATES[0];
  const sec = init.section ? findSection(init.section) : null;
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <>
      <div className="scrim" style={{ zIndex: 66 }} onClick={onClose} />
      <aside className="drawer" style={{ zIndex: 67, width: "min(900px,100%)", ["--dc" as any]: "#0EA5E9" }} role="dialog" aria-modal="true" aria-label={t("write_email", lang)}>
        <div className="drawer-h"><div style={{ flex: 1, minWidth: 0 }}><div className="eyebrow">{t("write_email", lang)}{sec ? ` · ${tx(sec.label, lang)}` : ""}</div><h2>{init.record?.title || t("mail_center", lang)}</h2></div>
          <button className="iconbtn" onClick={onClose} aria-label={t("close", lang)}><Icon n="x" /></button></div>
        <div className="drawer-b" style={{ padding: 14 }}><Composer key={tpl.id} tpl={tpl} init={init} templates={all} setTpl={setId} onDone={onClose} /></div>
      </aside>
    </>
  );
}
