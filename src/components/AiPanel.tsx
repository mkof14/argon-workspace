"use client";
import { useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { t, tx } from "@/lib/i18n";
import { DEMO, Rec } from "@/lib/store";
import { recordMarkdown } from "@/lib/format";

export type AiContext = { title: string; section?: string; record?: Rec; rows?: Rec[] };
type Msg = { role: "user" | "assistant"; content: string };

export default function AiPanel({ ctx, onClose }: { ctx: AiContext; onClose: () => void }) {
  const { lang, me, toast } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<"quick" | "deep">(ctx.section?.startsWith("legal") ? "deep" : "quick");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const sec = ctx.section ? findSection(ctx.section) : null;

  const context = () => {
    let c = `User: ${me.full_name} (role: ${me.role}${me.company ? ", company: " + me.company : ""}). Answer language: ${lang}.\nCurrent view: ${ctx.title}${sec ? ` (section ${sec.id})` : ""}.`;
    if (ctx.record && sec) c += `\n\nCurrent record:\n${recordMarkdown(sec, ctx.record, "en")}`;
    if (ctx.rows?.length && sec) c += `\n\nRecords in view (${ctx.rows.length}):\n` + ctx.rows.map((r) => `- ${r.title} [${r.status}] ${sec.columns.map((k: string) => r.data?.[k] ? `${k}=${r.data[k]}` : "").filter(Boolean).join("; ")}`).join("\n");
    return c.slice(0, 24000);
  };

  const ask = async () => {
    const text = q.trim(); if (!text || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMsgs(next); setQ(""); setBusy(true); ctl.current = new AbortController();
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.current.signal,
        body: JSON.stringify({ tier, context: context(), messages: next.slice(0, -1).slice(-10) }) });
      if (res.status === 429) { toast(t("ai_limit", lang), true); setMsgs(next.slice(0, -1)); return; }
      if (!res.ok || !res.body) throw new Error(await res.text());
      setUsage(res.headers.get("x-ai-usage") || "");
      const reader = res.body.getReader(); const dec = new TextDecoder(); let acc = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value, { stream: true }); setMsgs([...next.slice(0, -1), { role: "assistant", content: acc }]); }
    } catch (e: any) { if (e.name !== "AbortError") toast(e.message || "Error", true); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="scrim" style={{ zIndex: 64 }} onClick={onClose} />
      <aside className="ai" role="dialog" aria-modal="true" aria-label={t("ai_title", lang)}>
        <div className="drawer-h"><div style={{ flex: 1, minWidth: 0 }}><div className="eyebrow">{t("ai_title", lang)}</div><h2 style={{ fontSize: 16 }}>{ctx.record ? ctx.record.title : ctx.title}</h2>
          <div className="seg" role="group"><button className={tier === "quick" ? "on" : ""} onClick={() => setTier("quick")}>{t("ai_quick", lang)}</button><button className={tier === "deep" ? "on" : ""} onClick={() => setTier("deep")}>{t("ai_deep", lang)}</button></div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>{t("ai_quick_hint", lang)}</div></div>
          <button className="iconbtn" onClick={onClose} aria-label={t("close", lang)}><Icon n="x" /></button></div>
        <div className="ai-msgs">
          {DEMO && <div className="banner"><Icon n="info" /><span>{t("ai_demo", lang)}</span></div>}
          {msgs.map((m, i) => m.role === "user" ? <div key={i} className="ai-u">{m.content}</div>
            : <div key={i} className="ai-a md" dangerouslySetInnerHTML={{ __html: m.content ? (DOMPurify.sanitize(marked.parse(m.content) as string)) : "…" }} />)}
        </div>
        <div className="ai-compose">
          <textarea className="input" rows={3} value={q} placeholder={t("ai_ph", lang)} disabled={DEMO} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }} aria-label={t("ai_ph", lang)} />
          <div className="toolbar"><span className="faint" style={{ fontSize: 11.5 }}>{usage && `${t("ai_usage", lang)}: ${usage}`}</span><span style={{ flex: 1 }} />
            {busy && <button className="btn" onClick={() => ctl.current?.abort()}>Stop</button>}
            <button className="btn primary" disabled={DEMO || busy || !q.trim()} onClick={ask}><Icon n="spark" />{t("send", lang)}</button></div>
        </div>
      </aside>
    </>
  );
}
