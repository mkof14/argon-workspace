"use client";
// VOICE INBOX and VOICE COMMANDS (Phase 5). Speech becomes text on the device (the browser's own speech
// recognition, when it has one; typing always works). The text goes to the server, which parses it, resolves
// people and tasks with the person's own rights, classifies the risk and keeps the proposal and the original words.
// Reading commands open their page at once; writes wait for an explicit yes and then run through the ordinary
// Workspace store (src/lib/safeAction.ts). Ambiguous words are never carried out — the server asks instead.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { cancelAction, convertInbox, runAction, undoAction, voiceApi } from "@/lib/safeAction";
import { say, type T4 } from "@/lib/mgmt";

const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const SR_LANG: Record<string, string> = { en: "en-US", ru: "ru-RU", uk: "uk-UA", ar: "ar-AE" };
const ST: Record<string, [string, T4]> = {
  New: ["c-info", L("New", "Новое", "Нове", "جديد")], Parsed: ["c-info", L("Parsed", "Разобрано", "Розібрано", "تم التحليل")], "Needs Confirmation": ["c-warn", L("Needs confirmation", "Нужно подтверждение", "Потрібне підтвердження", "يحتاج تأكيدًا")],
  Converted: ["c-ok", L("Converted", "Выполнено", "Виконано", "تم التحويل")], Dismissed: ["", L("Dismissed", "Отклонено", "Відхилено", "مرفوض")], Failed: ["c-bad", L("Failed", "Не удалось", "Не вдалося", "فشل")],
};
const RISK: Record<string, [string, T4]> = { read: ["c-info", L("Read only", "Только чтение", "Лише читання", "قراءة فقط")], low: ["c-ok", L("Low-risk change", "Небольшое изменение", "Невелика зміна", "تغيير منخفض الخطورة")],
  material: ["c-warn", L("Material change — needs your yes", "Существенное изменение — нужно ваше «да»", "Суттєва зміна — потрібне ваше «так»", "تغيير جوهري — يحتاج موافقتك")], controlled: ["c-bad", L("Controlled — not done here", "Контролируемое — здесь не выполняется", "Контрольоване — тут не виконується", "مضبوط — لا يُنفذ هنا")] };

export function useSpeech(lang: string, onText: (t: string) => void) {
  const [on, setOn] = useState(false); const rec = useRef<any>(null);
  const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const start = () => {
    if (!SR) return; try { const r = new SR(); r.lang = SR_LANG[lang] || "en-US"; r.interimResults = false; r.maxAlternatives = 1;
      r.onresult = (e: any) => { const t = Array.from(e.results).map((x: any) => x[0]?.transcript || "").join(" ").trim(); if (t) onText(t); };
      r.onend = () => setOn(false); r.onerror = () => setOn(false); rec.current = r; r.start(); setOn(true); } catch { setOn(false); }
  };
  const stop = () => { try { rec.current?.stop(); } catch {} setOn(false); };
  useEffect(() => () => { try { rec.current?.abort(); } catch {} }, []);
  return { supported: !!SR, on, start, stop };
}

/** One proposal: what was understood, its risk, the question when something is missing, confirm / cancel / undo. */
export function Proposal({ p, onDone }: { p: any; onDone?: (r: any) => void }) {
  const { lang, toast, reload } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v); const router = useRouter();
  const [state, setState] = useState<"ready" | "busy" | "done" | "cancelled" | "undone">(p.status === "rejected" ? "cancelled" : "ready"); const [res, setRes] = useState<any>(null);
  const go = async (o: { personId?: string; taskId?: string } = {}) => {
    setState("busy"); const r = await runAction(p.id, { confirm: true, lang, ...o });
    if (!r.ok) { toast(r.error || "Error", true); setState(o.personId || o.taskId ? "ready" : "ready"); if (r.result) { setRes(r); setState("done"); } return; }
    if (r.route) { router.push(r.route); setState("done"); onDone?.(r); return; }
    setRes(r); setState("done"); reload(); onDone?.(r);
  };
  const undo = async () => { const r = await undoAction(p.id, lang); if (r.ok) { setState("undone"); reload(); toast(T(L("Undone", "Отменено", "Скасовано", "تم التراجع"))); } else toast(r.error || "Error", true); };
  const [rc, rl] = RISK[p.risk] || RISK.read;
  return <div className="proposal" data-proposal={p.status} data-risk={p.risk} data-state={state} style={{ display: "grid", gap: 6, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 10 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><b>{p.summary}</b><span className={`chip ${rc}`}>{T(rl)}</span></div>
    {p.question && state === "ready" && <div className="faint"><Icon n="info" /> {p.question}</div>}
    {p.options?.length > 0 && state === "ready" && <div className="chipbar">{p.options.map((o: any) => <button key={o.id} onClick={() => go(p.intent === "assign_task" && !p.resolved?.task ? { taskId: o.id } : ["change_due_date", "complete_task"].includes(p.intent) ? { taskId: o.id } : { personId: o.id })}>{o.label}</button>)}</div>}
    {state === "ready" && p.status === "proposed" && p.risk !== "read" && <div className="toolbar"><button className="btn primary sm" onClick={() => go()}><Icon n="check" />{T(L("Yes, do it", "Да, выполнить", "Так, виконати", "نعم، نفّذ"))}</button>
      <button className="btn ghost sm" onClick={() => { cancelAction(p.id).catch(() => {}); setState("cancelled"); }}><Icon n="x" />{T(L("Cancel", "Отмена", "Скасувати", "إلغاء"))}</button></div>}
    {state === "ready" && p.status === "proposed" && p.risk === "read" && <div className="toolbar"><button className="btn sm" onClick={() => go()}><Icon n="chev" />{T(L("Open", "Открыть", "Відкрити", "فتح"))}</button></div>}
    {state === "busy" && <div className="faint">…</div>}
    {state === "cancelled" && <div className="faint" style={{ fontSize: 13 }}>{p.status === "rejected" ? p.question : T(L("Cancelled — nothing was changed.", "Отменено — ничего не изменено.", "Скасовано — нічого не змінено.", "أُلغي — لم يتغير شيء."))}</div>}
    {state === "done" && res && <div className="toolbar" style={{ gap: 6 }}>{(res.result?.ops || []).map((x: any, i: number) => x.link ? <Link key={i} className={`chip ${x.ok ? "c-ok" : "c-bad"}`} href={x.link}><Icon n={x.ok ? "check" : "alert"} />{x.title || T(L("Open", "Открыть", "Відкрити", "فتح"))}</Link> : <span key={i} className={`chip ${x.ok ? "c-ok" : "c-bad"}`}>{x.ok ? "✓" : x.error}</span>)}
      {res.note && <span className="chip c-ok"><Icon n="check" />{T(L("Kept as a note", "Сохранено как заметка", "Збережено як нотатку", "حُفظت كملاحظة"))}</span>}
      {res.undoable && <button className="btn ghost sm" onClick={undo}><Icon n="back" />{T(L("Undo", "Отменить действие", "Скасувати дію", "تراجع"))}</button>}</div>}
    {state === "undone" && <div className="faint" style={{ fontSize: 13 }}>{T(L("Undone — the records are back as they were.", "Отменено — записи вернулись в прежнее состояние.", "Скасовано — записи повернулися до попереднього стану.", "تم التراجع — عادت السجلات كما كانت."))}</div>}
  </div>;
}

/** Say or type a command (carried out after confirmation) or capture a thought into the Voice Inbox. */
export default function VoiceInbox({ compact }: { compact?: boolean }) {
  const { lang, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [text, setText] = useState(""); const [mode, setMode] = useState<"command" | "inbox">("inbox"); const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<any>(null); const [items, setItems] = useState<any[] | null>(null); const [show, setShow] = useState<"open" | "all">("open");
  const load = () => voiceApi({ action: "inbox" }).then((r) => setItems(Array.isArray(r) ? r : [])).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const send = async (t: string, src: "voice" | "text") => {
    const words = t.trim(); if (!words) return; setBusy(true); setPlan(null);
    try {
      if (mode === "command") { const r = await voiceApi({ action: "plan", text: words, source: src, lang }); if (r.ok === false) toast(r.error || "Error", true); else setPlan(r); }
      else { const r = await voiceApi({ action: "capture", text: words, source: src, lang }); if (r.ok === false) toast(r.error || "Error", true); else { setPlan(r.plan || null); load(); } }
      setText("");
    } finally { setBusy(false); }
  };
  const sp = useSpeech(lang, (t) => { setText(t); send(t, "voice"); });
  const router = useRouter(); const [pick, setPick] = useState<{ id: string; projects: any[] } | null>(null);
  const convert = async (it: any, as: string, project?: string) => {
    if (as === "project" && !project) { const ps = await import("@/lib/mgmtApi").then((m) => m.mgmt.health()).catch(() => []); setPick({ id: it.id, projects: (ps || []).filter((x: any) => x.level !== "closed") }); return; }
    setPick(null); const r = await convertInbox(it.id, as, { lang, project }); if (!r.ok) toast(r.error || "Error", true); else toast(T(L("Done", "Готово", "Готово", "تم"))); load(); };
  const dismiss = async (it: any) => { await voiceApi({ action: "dismiss", inbox: it.id }); load(); };
  const list = (items || []).filter((x) => show === "all" || !["Converted", "Dismissed"].includes(x.status));
  return <section className="card" id="voice">
    <div className="card-h" style={{ flexWrap: "wrap", gap: 8 }}><h2><Icon n="mic" />{T(L("Voice Inbox", "Голосовые заметки", "Голосові нотатки", "صندوق الصوت"))}</h2>
      <nav className="seg" style={{ marginInlineStart: "auto" }}><button className={mode === "inbox" ? "on" : ""} onClick={() => setMode("inbox")}><Icon n="inbox" />{T(L("Capture", "Записать", "Записати", "التقاط"))}</button><button className={mode === "command" ? "on" : ""} onClick={() => setMode("command")}><Icon n="spark" />{T(L("Command", "Команда", "Команда", "أمر"))}</button></nav></div>
    <div style={{ padding: "0 16px 12px", display: "grid", gap: 10 }}>
      <form className="vox" onSubmit={(e) => { e.preventDefault(); send(text, "text"); }}>
        {sp.supported && <button type="button" className={`btn sm ${sp.on ? "rec" : ""}`} onClick={() => (sp.on ? sp.stop() : sp.start())} aria-pressed={sp.on} title={T(L("Speak", "Говорить", "Говорити", "تحدث"))}><Icon n="mic" />{sp.on ? T(L("Listening…", "Слушаю…", "Слухаю…", "أستمع…")) : T(L("Speak", "Говорить", "Говорити", "تحدث"))}</button>}
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} disabled={busy}
          placeholder={mode === "inbox" ? T(L("“Remind me tomorrow to check the Platinum documents”", "«Напомни мне завтра проверить документы Platinum»", "«Нагадай мені завтра перевірити документи Platinum»", "«ذكرني غدًا بمراجعة مستندات Platinum»")) : T(L("“Show overdue” · “Create task for Anton…” · “Move the deadline of … to Friday”", "«Покажи просроченное» · «Создай задачу Антону…» · «Перенеси срок … на пятницу»", "«Покажи прострочене» · «Створи задачу Антону…» · «Перенеси термін … на пʼятницю»", "«اعرض المتأخر» · «أنشئ مهمة لأنطون…»"))} aria-label={T(L("What to do", "Что сделать", "Що зробити", "ماذا تفعل"))} />
        <button className="btn primary sm" type="submit" disabled={busy || !text.trim()}><Icon n="send" /></button>
      </form>
      {!sp.supported && !compact && <small className="faint">{T(L("This browser has no speech recognition — type instead; everything else works the same.", "В этом браузере нет распознавания речи — введите текст; остальное работает так же.", "У цьому браузері немає розпізнавання мовлення — введіть текст; решта працює так само.", "لا يدعم هذا المتصفح التعرف على الكلام — اكتب بدلًا من ذلك."))}</small>}
      {plan && <Proposal key={plan.id} p={plan} onDone={() => load()} />}
      {items && items.length > 0 && <>
        <div className="toolbar"><span className="eyebrow">{T(L("Captured", "Записано", "Записано", "الملتقط"))}</span><nav className="seg" style={{ marginInlineStart: "auto" }}><button className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>{T(L("Open", "Открытые", "Відкриті", "مفتوحة"))}</button><button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>{T(L("All", "Все", "Усі", "الكل"))}</button></nav></div>
        <div className="feed">{list.slice(0, compact ? 5 : 50).map((it) => { const [c, l] = ST[it.status] || ST.New; const open = !["Converted", "Dismissed"].includes(it.status); return <div key={it.id} className="hub-row" data-vox={it.status} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <span style={{ minWidth: 0, flex: 1 }}><b>“{it.raw_text}”</b><small>{String(it.created_at).slice(0, 16).replace("T", " ")}{it.plan?.summary ? ` · ${it.plan.summary}` : ""}{it.question && open ? ` · ${it.question}` : ""}{it.error ? ` · ${it.error}` : ""}{it.converted_as ? ` · → ${it.converted_as}` : ""}</small></span>
          <span className={`chip ${c}`}>{T(l)}</span>
          {it.result_record_id && <Link className="btn ghost sm" href={`/company/tasks?r=${it.result_record_id}`}><Icon n="chev" /></Link>}
          {open && <span className="toolbar" style={{ gap: 4 }}>
            {it.plan?.status === "proposed" && it.plan?.risk !== "controlled" && <button className="btn sm" onClick={async () => { const r = await runAction(it.action_id, { confirm: true, lang }); if (!r.ok) toast(r.error || "Error", true); else if (r.route) router.push(r.route); load(); }}><Icon n="check" />{T(L("Confirm", "Подтвердить", "Підтвердити", "تأكيد"))}</button>}
            <select className="input" style={{ width: "auto" }} value="" onChange={(e) => e.target.value && convert(it, e.target.value)} aria-label={T(L("Turn into", "Превратить в", "Перетворити на", "حوّل إلى"))}>
              <option value="">{T(L("Turn into…", "Превратить в…", "Перетворити на…", "حوّل إلى…"))}</option>
              <option value="task">{T(L("My task", "Мою задачу", "Мою задачу", "مهمتي"))}</option><option value="reminder">{T(L("Reminder", "Напоминание", "Нагадування", "تذكير"))}</option>
              <option value="project">{T(L("Project item…", "Задачу в проекте…", "Задачу в проєкті…", "بند في مشروع…"))}</option><option value="followup">{T(L("Follow-up", "Контроль (follow-up)", "Контроль (follow-up)", "متابعة"))}</option><option value="note">{T(L("Note", "Заметку", "Нотатку", "ملاحظة"))}</option></select>
            {pick?.id === it.id && <select className="input" style={{ width: "auto" }} value="" onChange={(e) => e.target.value && convert(it, "project", e.target.value)} aria-label={T(L("Project", "Проект", "Проєкт", "المشروع"))}><option value="">{T(L("Which project?", "Какой проект?", "Який проєкт?", "أي مشروع؟"))}</option>{pick.projects.map((x: any) => <option key={x.project_id} value={x.project_id}>{x.title}</option>)}</select>}
            <button className="btn ghost sm" onClick={() => dismiss(it)} title={T(L("Dismiss", "Отклонить", "Відхилити", "رفض"))}><Icon n="x" /></button></span>}
        </div>; })}</div></>}
    </div>
  </section>;
}
