"use client";
import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp } from "./App";
import { t, tx } from "@/lib/i18n";
import { DEMO, store } from "@/lib/store";
import { MKT_BUTTONS, MAIN_FIELD, textHash, type MktButton } from "@/config/marketing";

type Check = { verdict: "pass" | "fix"; summary: string; issues: { quote: string; problem: string; fix: string }[]; needs_legal: boolean; revised: string };
type Post = { channel: string; title?: string; text: string; hashtags?: string; on?: boolean };
type Res = { kind: "text"; btn: MktButton; text: string } | { kind: "brief"; brief: string; script: string } | { kind: "check"; c: Check } | { kind: "posts"; posts: Post[] } | null;

export const mktApi = async (body: any) => {
  const r = await fetch("/api/marketing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.text()) || "Error");
  return r.json();
};
const md = (s: string) => ({ __html: DOMPurify.sanitize(marked.parse(s || "") as string) });

/** AI buttons inside a marketing record: write, pitch, prepare, brief, compliance check, make social posts. */
export default function MarketingStudio({ section, title, data, setData, canWrite, saved }: { section: any; title: string; data: Record<string, any>; setData: (fn: (d: Record<string, any>) => Record<string, any>) => void; canWrite: boolean; saved: boolean }) {
  const { lang, toast } = useApp();
  const buttons = MKT_BUTTONS[section.id] || [];
  const [busy, setBusy] = useState<string>("");
  const [res, setRes] = useState<Res>(null);
  const label = (k: string) => tx(section.fields.find((f: any) => f.key === k)?.label, lang) || k;
  const hasCheck = section.fields.some((f: any) => f.key === "check");

  // A passed check belongs to the exact text that was checked: editing the text resets it
  const hash = textHash(section.id, title, data);
  useEffect(() => {
    if (!hasCheck || !data.check_hash || hash === data.check_hash) return;
    if (["Passed (AI check)", "Fix needed", "Legal review needed"].includes(data.check)) setData((d) => ({ ...d, check: "Not checked", check_hash: "" }));
  }, [hash]); // eslint-disable-line

  if (!buttons.length || !canWrite) return null;

  const run = async (b: MktButton) => {
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    if (b.action === "repurpose" && !saved) { toast(t("mk_save_first", lang), true); return; }
    setBusy(b.action); setRes(null);
    try {
      const j = await mktApi({ action: b.action, section: section.id, title, data, lang });
      if (b.action === "check") {
        const c = j as Check;
        const status = c.verdict === "pass" ? (c.needs_legal ? "Legal review needed" : "Passed (AI check)") : "Fix needed";
        const note = [`${new Date().toISOString().slice(0, 10)} · ${c.summary}`, ...c.issues.map((i) => `• «${i.quote}» — ${i.problem}${i.fix ? ` → ${i.fix}` : ""}`)].join("\n");
        setData((d) => ({ ...d, check: status, check_note: note, check_hash: textHash(section.id, title, d) }));
        setRes({ kind: "check", c });
      } else if (b.action === "brief") setRes({ kind: "brief", brief: j.brief, script: j.script });
      else if (b.action === "repurpose") setRes({ kind: "posts", posts: (j.posts || []).map((p: Post) => ({ ...p, on: true })) });
      else setRes({ kind: "text", btn: b, text: j.text });
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(""); }
  };
  const put = (patch: Record<string, any>) => { setData((d) => ({ ...d, ...patch })); toast(t("mk_inserted", lang)); setRes(null); };
  const createPosts = async (posts: Post[]) => {
    let n = 0;
    for (const p of posts.filter((x) => x.on)) {
      try {
        await store.save({ section: "marketing.social", title: (p.title || `${p.channel} · ${title}`).slice(0, 160), status: "Draft",
          data: { channel: p.channel, account: "Company page", text: p.text, hashtags: p.hashtags || "", product: data.product || "", segment: data.segment || "", language: data.language || "EN", source: `${tx(section.label, "en")}: ${title}`, check: "Not checked" } });
        n++;
      } catch (e: any) { toast(e.message, true); }
    }
    if (n) toast(t("mk_created", lang).replace("{n}", String(n)));
    setRes(null);
  };

  return (
    <section className="mkt">
      <div className="mkt-h"><Icon n="spark" /><b>{t("mk_studio", lang)}</b></div>
      <p className="faint mkt-p">{t("mk_studio_p", lang)}</p>
      {hasCheck && data.check_hash === "" && data.check === "Not checked" && data.check_note ? <div className="gate-msg" style={{ margin: 0 }}>{t("mk_recheck", lang)}</div> : null}
      <div className="mkt-btns">{buttons.map((b) => (
        <button key={b.action + (b.field || "")} className={`mkt-btn ${b.action === "check" ? "is-check" : ""}`} disabled={!!busy} onClick={() => run(b)}>
          <span className="mkt-ic"><Icon n={b.icon} /></span><span><b>{tx(b.label, lang)}</b><small>{tx(b.hint, lang)}</small></span>
        </button>))}</div>
      {busy && <div className="mkt-busy"><span className="spin" />{t("mk_working", lang)}</div>}

      {res?.kind === "text" && <div className="mkt-res">
        <div className="md" dangerouslySetInnerHTML={md(res.text)} />
        <div className="toolbar"><button className="btn primary sm" onClick={() => put({ [res.btn.field!]: res.text })}><Icon n="check" />{t("mk_insert", lang).replace("{f}", label(res.btn.field!))}</button>
          <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(res.text).then(() => toast(t("copied", lang)))}><Icon n="copy" />{t("copy", lang)}</button>
          <button className="btn ghost sm" onClick={() => setRes(null)}>{t("close", lang)}</button></div></div>}

      {res?.kind === "brief" && <div className="mkt-res">
        <div className="md" dangerouslySetInnerHTML={md(`${res.brief}\n\n---\n\n${res.script}`)} />
        <div className="toolbar"><button className="btn primary sm" onClick={() => put({ brief: res.brief, script: res.script })}><Icon n="check" />{t("mk_insert", lang).replace("{f}", `${label("brief")} + ${label("script")}`)}</button>
          <button className="btn ghost sm" onClick={() => setRes(null)}>{t("close", lang)}</button></div></div>}

      {res?.kind === "check" && <div className={`mkt-res mkt-check ${res.c.verdict}`}>
        <div className="toolbar"><span className={`chip ${res.c.verdict === "pass" ? "c-ok" : "c-bad"}`}><Icon n={res.c.verdict === "pass" ? "check" : "alert"} className="lockico" />{res.c.verdict === "pass" ? t("mk_pass", lang) : t("mk_fix", lang)}</span>
          <span style={{ fontSize: 14 }}>{res.c.summary}</span></div>
        {res.c.needs_legal && <div className="banner"><Icon n="scale" /><span>{t("mk_legal", lang)}</span></div>}
        {res.c.issues.length > 0 && <ol className="mkt-issues">{res.c.issues.map((i, k) => <li key={k}><q>{i.quote}</q><span>{i.problem}</span>{i.fix && <span className="faint">{t("mk_issue_fix", lang)}: {i.fix}</span>}</li>)}</ol>}
        <div className="toolbar">
          {res.c.revised && MAIN_FIELD[section.id] && <button className="btn primary sm" onClick={() => put({ [MAIN_FIELD[section.id]]: res.c.revised })}><Icon n="edit" />{t("mk_apply_fix", lang)}</button>}
          <button className="btn ghost sm" onClick={() => setRes(null)}>{t("close", lang)}</button></div></div>}

      {res?.kind === "posts" && <div className="mkt-res">
        <div className="eyebrow">{t("mk_posts", lang)}</div>
        {res.posts.map((p, k) => <label key={k} className="mkt-post"><input type="checkbox" checked={!!p.on} onChange={(e) => setRes({ kind: "posts", posts: res.posts.map((x, j) => (j === k ? { ...x, on: e.target.checked } : x)) })} />
          <span><b>{p.channel}</b>{p.title ? ` · ${p.title}` : ""}<small style={{ whiteSpace: "pre-wrap" }}>{p.text}{p.hashtags ? `\n${p.hashtags}` : ""}</small></span></label>)}
        <div className="toolbar"><button className="btn primary sm" disabled={!res.posts.some((p) => p.on)} onClick={() => createPosts(res.posts)}><Icon n="share" />{t("mk_create_posts", lang).replace("{n}", String(res.posts.filter((p) => p.on).length))}</button>
          <button className="btn ghost sm" onClick={() => setRes(null)}>{t("close", lang)}</button></div></div>}
    </section>
  );
}

type Idea = { title: string; channel: string; pillar: string; segment: string; product: string; publish: string; text: string; on?: boolean };
/** Marketing overview: AI proposes four weeks of posts; chosen ones become Ideas in Social media. */
export function MktIdeas({ onDone }: { onDone: () => void }) {
  const { lang, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const go = async () => {
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    setBusy(true);
    try { const j = await mktApi({ action: "ideas", section: "marketing.social", title: "Content plan", data: {}, lang }); setIdeas((j.posts || []).map((p: Idea) => ({ ...p, on: true }))); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const add = async () => {
    let n = 0;
    for (const p of (ideas || []).filter((x) => x.on)) {
      try { await store.save({ section: "marketing.social", title: String(p.title || p.text).slice(0, 160), status: "Idea", data: { channel: p.channel, account: "Company page", pillar: p.pillar, segment: p.segment, product: p.product, publish: /^\d{4}-\d{2}-\d{2}$/.test(p.publish) ? p.publish : "", text: p.text, language: "EN", check: "Not checked" } }); n++; }
      catch (e: any) { toast(e.message, true); }
    }
    if (n) toast(t("mk_created", lang).replace("{n}", String(n)));
    setIdeas(null); onDone();
  };
  return (
    <div className="card hub-card wide">
      <div className="card-h"><h2><Icon n="spark" />{t("mk_ideas", lang)}</h2>
        <button className="btn sm" style={{ marginInlineStart: "auto" }} disabled={busy} onClick={go}><Icon n="spark" />{busy ? "…" : t("mk_ideas_go", lang)}</button></div>
      <div className="card-b" style={{ display: "grid", gap: 10 }}>
        {!ideas && !busy && <p className="faint" style={{ margin: 0, fontSize: 14 }}>{t("mk_ideas_p", lang)}</p>}
        {busy && <div className="mkt-busy"><span className="spin" />{t("mk_working", lang)}</div>}
        {ideas && <>{ideas.map((p, k) => <label key={k} className="mkt-post"><input type="checkbox" checked={!!p.on} onChange={(e) => setIdeas(ideas.map((x, j) => (j === k ? { ...x, on: e.target.checked } : x)))} />
          <span><b>{p.publish} · {p.channel} · {p.title}</b><small>{p.pillar} · {p.segment} · {p.product}</small><small>{p.text}</small></span></label>)}
          <div className="toolbar"><button className="btn primary sm" disabled={!ideas.some((p) => p.on)} onClick={add}><Icon n="check" />{t("mk_add_ideas", lang).replace("{n}", String(ideas.filter((p) => p.on).length))}</button>
            <button className="btn ghost sm" onClick={() => setIdeas(null)}>{t("cancel", lang)}</button></div></>}
      </div>
    </div>
  );
}
