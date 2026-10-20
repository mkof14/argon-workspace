"use client";
import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { t, tx, type Lang } from "@/lib/i18n";
import { DEMO, Faq, Rec, isExternal, store } from "@/lib/store";
import { recordMarkdown } from "@/lib/format";
import { HELP, l2 } from "@/config/learn";
import { deskById } from "@/config/legal";
import type { Op } from "@/lib/command";

export type AiContext = { title: string; section?: string; record?: Rec; rows?: Rec[]; ask?: string; desk?: string; format?: "item"; onApply?: (text: string) => void };
type Plan = { ops: Op[]; records: Record<string, Rec>; dropped: string[]; state: "ready" | "running" | "done" | "cancelled"; results?: { ok: boolean; text: string; href?: string }[] };
type Msg = { role: "user" | "assistant"; content: string; src?: "faq" | "cache" | "ai"; faqId?: string; saved?: boolean; q?: string; plan?: Plan; sources?: { n: number; kind: string; title: string; link: string; suspicious?: boolean }[] };
type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

export default function AiPanel({ ctx, onClose }: { ctx: AiContext; onClose: () => void }) {
  const { lang, me, toast } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState(ctx.ask || "");
  const desk = deskById(ctx.desk);
  const [tier, setTier] = useState<"quick" | "deep">(ctx.section?.startsWith("legal") || desk ? "deep" : "quick");
  const [applied, setApplied] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"ask" | "do">("ask");
  // Voice: dictate a question or a command (browser speech recognition, in the interface language)
  const [listening, setListening] = useState(false); const rec = useRef<any>(null);
  useEffect(() => () => rec.current?.abort?.(), []);
  const listen = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast(t("voice_unsupported", lang), true); return; }
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); rec.current = r; r.lang = ({ en: "en-US", ru: "ru-RU", uk: "uk-UA", ar: "ar-AE" } as Record<string, string>)[lang] || "en-US"; r.interimResults = true; r.continuous = false;
    const before = q.trim();
    r.onresult = (e: any) => { const txt = Array.from(e.results).map((x: any) => x[0].transcript).join(" "); setQ((before ? before + " " : "") + txt); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    setListening(true); r.start();
  };
  const T = (x: T4) => tx(x, lang as Lang);
  const [usage, setUsage] = useState("");
  const [sugg, setSugg] = useState<Faq[]>([]);
  const ctl = useRef<AbortController | null>(null);
  const sec = ctx.section ? findSection(ctx.section) : null;
  const canSave = !isExternal(me.role);

  // Similar saved questions while typing (free, no AI call)
  useEffect(() => {
    const text = q.trim(); if (text.length < 6 || mode === "do") { setSugg([]); return; }
    const id = setTimeout(() => store.faqSearch(text, lang, 3).then(setSugg).catch(() => {}), 350);
    return () => clearTimeout(id);
  }, [q, lang, mode]);

  const who = () => `User: ${me.full_name} (role: ${me.role}${me.company ? ", company: " + me.company : ""}). Answer language: ${lang}.`;
  const context = () => {
    let c = `Current view: ${ctx.title}${sec ? ` (section ${sec.id})` : ""}.`;
    if (sec && HELP[sec.id]) c += `\nHow this section works:\n${HELP[sec.id].en}`;
    if (ctx.record && sec) c += `\n\nCurrent record:\n${recordMarkdown(sec, ctx.record, "en")}`;
    if (ctx.rows?.length && sec) c += `\n\nRecords in view (${ctx.rows.length}):\n` + ctx.rows.map((r) => `- ${r.title} [${r.status}] ${sec.columns.map((k: string) => r.data?.[k] ? `${k}=${r.data[k]}` : "").filter(Boolean).join("; ")}`).join("\n");
    return c.slice(0, 24000);
  };

  const useFaq = (f: Faq, question?: string) => {
    setMsgs((m) => [...m, { role: "user", content: question || f.question }, { role: "assistant", content: f.answer, src: "faq", faqId: f.id, q: question || f.question }]);
    setQ(""); setSugg([]); store.faqHit(f.id).catch(() => {});
  };

  const ask = async (force = false, override?: string) => {
    const text = (override ?? q).trim(); if (!text || busy) return;
    // A very close saved answer is shown first, without spending tokens
    if (!force && msgs.length === 0 && !ctx.record && !ctx.format) { // record-specific questions always go to AI
      const best = (await store.faqSearch(text, undefined, 1).catch(() => []))[0];
      if (best && (best.sim || 0) >= 0.72) { useFaq(best, text); return; }
    }
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    const history = msgs.filter((m) => m.src !== "faq").map(({ role, content }) => ({ role, content }));
    const next: Msg[] = [...msgs, { role: "user", content: text }, { role: "assistant", content: "", src: "ai", q: text }];
    setMsgs(next); setQ(""); setSugg([]); setBusy(true); ctl.current = new AbortController();
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.current.signal,
        // Workspace questions: the server reads what this person may open and names its sources; legal desks and
        // item reviews keep their own prepared context
        body: JSON.stringify({ tier, ...(desk || ctx.format ? { context: context() } : { retrieve: true, record_id: ctx.record?.id || null }), who: who(), section: ctx.section || "", lang, desk: desk?.id || "", format: ctx.format || "", messages: [...history, { role: "user", content: text }].slice(-10) }) });
      if (res.status === 429) { toast(t("ai_limit", lang), true); setMsgs(next.slice(0, -2)); return; }
      if (!res.ok || !res.body) throw new Error(await res.text());
      setUsage(res.headers.get("x-ai-usage") || "");
      const src = res.headers.get("x-ai-cache") === "hit" ? "cache" : "ai";
      let sources: Msg["sources"] = []; try { const h = res.headers.get("x-ai-sources"); if (h) sources = JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/"))); } catch {}
      const reader = res.body.getReader(); const dec = new TextDecoder(); let acc = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value, { stream: true }); setMsgs([...next.slice(0, -1), { role: "assistant", content: acc, src, q: text, sources }]); }
    } catch (e: any) { if (e.name !== "AbortError") toast(e.message || "Error", true); }
    finally { setBusy(false); }
  };
  const askAnyway = (m: Msg) => ask(true, m.q);
  /* ---- Commands: AI proposes a plan, the person confirms, the browser applies it with the person's own rights ---- */
  const command = async () => {
    const text = q.trim(); if (!text || busy) return;
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    const next: Msg[] = [...msgs, { role: "user", content: text }, { role: "assistant", content: "…", src: "ai" }];
    setMsgs(next); setQ(""); setSugg([]); setBusy(true);
    try {
      const r = await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang, record_id: ctx.record?.id || "", context: `${ctx.title}${ctx.section ? ` (${ctx.section})` : ""}` }) });
      if (r.status === 429) { toast(t("ai_limit", lang), true); setMsgs(next.slice(0, -2)); return; }
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setMsgs([...next.slice(0, -1), { role: "assistant", content: j.reply || "", src: "ai", plan: j.ops?.length ? { ops: j.ops, records: j.records || {}, dropped: j.dropped || [], state: "ready" } : undefined }]);
    } catch (e: any) { toast(e.message || "Error", true); setMsgs(next.slice(0, -1)); } finally { setBusy(false); }
  };
  const setPlan = (i: number, p: Partial<Plan>) => setMsgs((m) => m.map((x, j) => (j === i && x.plan ? { ...x, plan: { ...x.plan, ...p } } : x)));
  const runPlan = async (i: number) => {
    const p = msgs[i].plan; if (!p) return; setPlan(i, { state: "running" }); const results: Plan["results"] = [];
    for (const o of p.ops) {
      try {
        if (o.op === "create") { const r = await store.save({ section: o.section, title: o.title, status: o.status, data: o.data }); results.push({ ok: true, text: opText(o), href: `/${r.section.replace(".", "/")}?r=${r.id}` }); }
        else if (o.op === "update") { const cur = p.records[o.id]; if (!cur) throw new Error("not found"); await store.save({ ...cur, status: o.status ?? cur.status, data: { ...(cur.data || {}), ...o.data } }); results.push({ ok: true, text: opText(o), href: `/${o.section.replace(".", "/")}?r=${o.id}` }); }
        else { await store.addComment(o.id, o.body); results.push({ ok: true, text: opText(o), href: `/${o.section.replace(".", "/")}?r=${o.id}` }); }
      } catch (e: any) { results.push({ ok: false, text: `${opText(o)} — ${e?.message || "error"}` }); }
    }
    setPlan(i, { state: "done", results });
  };
  const secName = (id: string) => tx(findSection(id)?.label, lang as Lang) || id;
  const fields = (d: Record<string, any>) => Object.entries(d).filter(([k]) => !k.endsWith("_title")).map(([k, v]) => `${k}: ${d[`${k}_title`] || v}`).join(" · ");
  const opText = (o: Op) => o.op === "create" ? `${T(L("Create in", "Создать в", "Створити в", "إنشاء في"))} «${secName(o.section)}»: ${o.title} (${o.status})${Object.keys(o.data).length ? " — " + fields(o.data) : ""}`
    : o.op === "update" ? `${T(L("Change", "Изменить", "Змінити", "تغيير"))} «${o.title}»: ${[o.status && `${T(L("status", "статус", "статус", "الحالة"))} → ${o.status}`, fields(o.data)].filter(Boolean).join(" · ")}`
    : `${T(L("Comment on", "Комментарий к", "Коментар до", "تعليق على"))} «${o.title}»: ${o.body}`;
  const send = () => (mode === "do" ? command() : ask(false));
  const saveMemo = async (i: number) => {
    const m = msgs[i]; if (!m.q || !desk) return;
    try { await store.save({ section: "legal.desks", title: m.q.slice(0, 120), status: "Draft", controlled: !!ctx.record?.controlled, data: { desk: desk.name.en, question: m.q, memo: m.content, related: ctx.record ? `${ctx.section}:${ctx.record.id} · ${ctx.record.title}` : "" } }); toast(t("memo_saved", lang)); }
    catch (e: any) { toast(e.message || "Error", true); }
  };
  const saveFaq = async (i: number) => {
    const m = msgs[i]; if (!m.q) return;
    try { await store.faqSave({ question: m.q, answer: m.content, lang: lang === "ru" ? "ru" : lang, section: ctx.section || null, source: "ai" }); setMsgs((x) => x.map((y, j) => (j === i ? { ...y, saved: true } : y))); toast(t("saved_faq", lang)); }
    catch (e: any) { toast(e.message || "Error", true); }
  };

  return (
    <>
      <div className="scrim" style={{ zIndex: 64 }} onClick={onClose} />
      <aside className="ai" role="dialog" aria-modal="true" aria-label={t("ai_title", lang)}>
        <div className="drawer-h"><div style={{ flex: 1, minWidth: 0 }}><div className="eyebrow">{t("ai_title", lang)}</div><h2 style={{ fontSize: 18 }}>{ctx.record ? ctx.record.title : ctx.title}</h2>
          {desk && <div className="chip" style={{ color: desk.color, borderColor: desk.color, marginBottom: 8 }}><Icon n={desk.icon} className="lockico" />{l2(desk.name, lang)}</div>}
          {canSave && <div className="seg" role="group" style={{ marginInlineEnd: 8 }}><button className={mode === "ask" ? "on" : ""} onClick={() => setMode("ask")}><Icon n="book" />{T(L("Ask", "Спросить", "Запитати", "اسأل"))}</button><button className={mode === "do" ? "on" : ""} onClick={() => setMode("do")}><Icon n="spark" />{T(L("Do", "Сделать", "Зробити", "نفّذ"))}</button></div>}
          {mode === "ask" && <div className="seg" role="group"><button className={tier === "quick" ? "on" : ""} onClick={() => setTier("quick")}>{t("ai_quick", lang)}</button><button className={tier === "deep" ? "on" : ""} onClick={() => setTier("deep")}>{t("ai_deep", lang)}</button></div>}
          <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>{mode === "do" ? T(L("Write what to do: “create a task for Ivan for Friday”, “move the Aurora deal to Negotiation”, “add a 120,000 USD invoice to the Marina X deal”. You will see the plan and confirm it.", "Напишите, что сделать: «создай задачу Ивану на пятницу», «переведи сделку Aurora в Negotiation», «добавь счёт на 120 000 USD по сделке Marina X». Вы увидите план и подтвердите его.", "Напишіть, що зробити: «створи задачу Івану на п'ятницю», «переведи угоду Aurora в Negotiation», «додай рахунок на 120 000 USD за угодою Marina X». Ви побачите план і підтвердите його.", "اكتب ما يجب فعله: «أنشئ مهمة لإيفان ليوم الجمعة»، «انقل صفقة Aurora إلى التفاوض»، «أضف فاتورة بقيمة 120,000 دولار لصفقة Marina X». سترى الخطة وتؤكدها.")) : t("ai_quick_hint", lang)}</div></div>
          <button className="iconbtn" onClick={onClose} aria-label={t("close", lang)}><Icon n="x" /></button></div>
        <div className="ai-msgs">
          {DEMO && <div className="banner"><Icon n="info" /><span>{t("ai_demo", lang)}</span></div>}
          {!msgs.length && mode === "ask" && <div className="faint" style={{ fontSize: 14 }}><Icon n="book" className="lockico" /> {t("ai_faq_hint", lang)}</div>}
          {msgs.map((m, i) => m.role === "user" ? <div key={i} className="ai-u">{m.content}</div>
            : <div key={i} className="ai-a"><div className="md" dangerouslySetInnerHTML={{ __html: m.content ? (DOMPurify.sanitize(marked.parse(m.content) as string)) : "…" }} />
              {m.plan && <div className="cmd-plan">
                {(m.plan.results || m.plan.ops.map((o) => ({ ok: true, text: opText(o), href: undefined as string | undefined }))).map((r, k) => <div key={k} className={`cmd-op ${m.plan!.results ? (r.ok ? "ok" : "bad") : ""}`}><Icon n={m.plan!.results ? (r.ok ? "check" : "alert") : "edit"} />{r.href ? <a href={r.href}>{r.text}</a> : <span>{r.text}</span>}</div>)}
                {m.plan.dropped.length > 0 && !m.plan.results && <div className="faint" style={{ fontSize: 12.5 }}>{T(L("Skipped", "Пропущено", "Пропущено", "تم تخطيه"))}: {m.plan.dropped.join("; ")}</div>}
                {m.plan.state === "ready" && <div className="toolbar"><button className="btn primary sm" onClick={() => runPlan(i)}><Icon n="check" />{T(L("Yes, do it", "Да, выполнить", "Так, виконати", "نعم، نفّذ"))}</button><button className="btn ghost sm" onClick={() => setPlan(i, { state: "cancelled" })}><Icon n="x" />{T(L("Cancel", "Отмена", "Скасувати", "إلغاء"))}</button></div>}
                {m.plan.state === "running" && <div className="faint">…</div>}
                {m.plan.state === "cancelled" && <div className="faint" style={{ fontSize: 13 }}>{T(L("Cancelled — nothing was changed.", "Отменено — ничего не изменено.", "Скасовано — нічого не змінено.", "أُلغي — لم يتغير شيء."))}</div>}
              </div>}
              {!!m.sources?.length && <div className="ai-sources" data-sources={m.sources.length}><b>{T(L("Sources", "Источники", "Джерела", "المصادر"))}</b>{m.sources.map((x) => <a key={x.n} href={x.link} className={x.suspicious ? "susp" : ""} title={x.suspicious ? T(L("This source contains instructions; they were not followed", "В источнике есть инструкции; они не выполнялись", "У джерелі є інструкції; їх не виконано", "يحتوي المصدر على تعليمات لم تُتّبع")) : x.kind}>[{x.n}] {x.title}{x.suspicious ? " ⚠" : ""}</a>)}</div>}
              {m.content && !m.plan && mode === "ask" && !(busy && i === msgs.length - 1) && <div className="ai-src">
                {m.src === "faq" && <span className="chip c-ok"><Icon n="book" className="lockico" />{t("from_faq", lang)}</span>}
                {m.src === "cache" && <span className="chip c-ok"><Icon n="clock" className="lockico" />{t("from_cache", lang)}</span>}
                {m.src === "faq" && !DEMO && i === msgs.length - 1 && <button className="btn ghost sm" onClick={() => askAnyway(m)}><Icon n="spark" />{t("ask_ai_anyway", lang)}</button>}
                {ctx.onApply && m.src !== "faq" && <button className="btn sm" onClick={() => { ctx.onApply!(m.content); setApplied(i); toast(t("applied", lang)); }}><Icon n="check" />{applied === i ? t("applied", lang) : t("save_to_record", lang)}</button>}
                {desk && m.src !== "faq" && canSave && <button className="btn ghost sm" onClick={() => saveMemo(i)}><Icon n="file" />{t("save_memo", lang)}</button>}
                {m.src !== "faq" && canSave && (m.saved ? <span className="chip c-info"><Icon n="check" className="lockico" />{t("saved_faq", lang)}</span>
                  : <button className="btn ghost sm" onClick={() => saveFaq(i)}><Icon n="book" />{t("save_faq", lang)}</button>)}
                <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(m.content).then(() => toast(t("copied", lang)))}><Icon n="copy" />{t("copy", lang)}</button>
              </div>}
            </div>)}
        </div>
        <div className="ai-compose">
          {sugg.length > 0 && <div className="faq-sugg"><div className="eyebrow">{t("similar", lang)}</div>
            {sugg.map((f) => <button key={f.id} onClick={() => useFaq(f)}><Icon n="book" /><span>{f.question}</span>{f.verified && <span className="chip c-ok" style={{ marginInlineStart: "auto" }}>{t("verified", lang)}</span>}</button>)}</div>}
          {listening && <div className="search-listen"><span className="pulse" />{t("listening", lang)}</div>}
          <textarea className="input" rows={3} value={q} placeholder={mode === "do" ? T(L("What should be done?", "Что сделать?", "Що зробити?", "ماذا يجب أن يُفعل؟")) : t("ai_ph", lang)} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} aria-label={t("ai_ph", lang)} />
          <div className="toolbar"><span className="faint" style={{ fontSize: 12.5 }}>{usage && `${t("ai_usage", lang)}: ${usage}`}</span><span style={{ flex: 1 }} />
            {busy && <button className="btn" onClick={() => ctl.current?.abort()}>{T(L("Stop", "Стоп", "Стоп", "إيقاف"))}</button>}
            <button className={`iconbtn mic ${listening ? "on" : ""}`} onClick={listen} title={t("voice", lang)} aria-label={t("voice", lang)} aria-pressed={listening}><Icon n="mic" /></button>
            <button id="ai-send" className="btn primary" disabled={busy || !q.trim()} onClick={send}><Icon n="spark" />{t("send", lang)}</button></div>
        </div>
      </aside>
    </>
  );
}
