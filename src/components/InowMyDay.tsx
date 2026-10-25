"use client";
// 1inow · MY DAY (P10). The personal working layer over Workspace: it shows what needs the person now, explains why
// (deterministic reasons — never an opaque score), answers questions from the records the person may open, and turns
// "do this" into a proposal that runs only after an explicit yes, through the same safe-action layer as Voice.
// Nothing here owns a business object: every line links to the Workspace record it came from.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { Proposal, useSpeech } from "./VoiceInbox";
import { voiceApi } from "@/lib/safeAction";
import { explain, type Ranked, type Suggest } from "@/lib/inow";
import { NEXT_ACTION, changeText, loopText, say, type T4 } from "@/lib/mgmt";

const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Lg = "en" | "ru" | "uk" | "ar";
const lg = (l: string): Lg => (["en", "ru", "uk", "ar"].includes(l) ? (l as Lg) : "en");

const SECTIONS: { key: "now" | "decisions" | "today" | "attention" | "waiting" | "loops"; icon: string; label: T4; empty: T4 }[] = [
  { key: "now", icon: "target", label: L("Now", "Сейчас", "Зараз", "الآن"), empty: L("Nothing urgent right now.", "Сейчас ничего срочного.", "Зараз нічого термінового.", "لا شيء عاجل الآن.") },
  { key: "decisions", icon: "stamp", label: L("Decisions", "Решения", "Рішення", "القرارات"), empty: L("No decisions are waiting for you.", "Решений от вас не ждут.", "Рішень від вас не чекають.", "لا قرارات بانتظارك.") },
  { key: "today", icon: "sun", label: L("Today", "Сегодня", "Сьогодні", "اليوم"), empty: L("Nothing else is scheduled for today.", "На сегодня больше ничего не запланировано.", "На сьогодні більше нічого не заплановано.", "لا شيء آخر مجدول لليوم.") },
  { key: "attention", icon: "alert", label: L("Attention", "Внимание", "Увага", "يحتاج انتباهًا"), empty: L("Nothing needs extra attention.", "Ничего не требует особого внимания.", "Ніщо не потребує особливої уваги.", "لا شيء يحتاج انتباهًا إضافيًا.") },
  { key: "waiting", icon: "clock", label: L("Waiting for", "Ожидаю", "Очікую", "بانتظار"), empty: L("You are not waiting on anyone.", "Вы ни от кого не ждёте ответа.", "Ви ні від кого не чекаєте відповіді.", "لست بانتظار أحد.") },
  { key: "loops", icon: "refresh", label: L("Open loops", "Незакрытые вопросы", "Незакриті питання", "حلقات مفتوحة"), empty: L("No open loops.", "Незакрытых вопросов нет.", "Незакритих питань немає.", "لا حلقات مفتوحة.") },
];
const ACT: Record<string, T4> = {
  open: L("Open", "Открыть", "Відкрити", "فتح"), decide: L("Review & decide", "Рассмотреть и решить", "Розглянути й вирішити", "مراجعة وقرار"), complete: L("Mark done", "Отметить выполненной", "Позначити виконаною", "تمّ"),
  move_tomorrow: L("Move to tomorrow", "Перенести на завтра", "Перенести на завтра", "نقل إلى الغد"), follow_up: L("Follow up", "Напомнить", "Нагадати", "متابعة"), remind_me: L("Remind me tomorrow", "Напомнить мне завтра", "Нагадати мені завтра", "ذكّرني غدًا"),
  resolved: L("Resolved", "Решено", "Вирішено", "تم الحل"), schedule_follow_up: L("Schedule follow-up", "Запланировать follow-up", "Запланувати follow-up", "جدولة متابعة"), meeting_brief: L("Meeting brief", "Бриф встречи", "Бриф зустрічі", "ملخص الاجتماع"),
  show_blockers: L("Show blockers", "Показать блокеры", "Показати блокери", "عرض العوائق"), make_task: L("Make it a task", "Сделать задачей", "Зробити задачею", "تحويل إلى مهمة"), create_follow_up: L("Create follow-up", "Создать follow-up", "Створити follow-up", "إنشاء متابعة"),
  snooze: L("Snooze till tomorrow", "Отложить до завтра", "Відкласти до завтра", "تأجيل إلى الغد"), not_relevant: L("Not relevant", "Не актуально", "Не актуально", "غير مهم"), pin: L("Pin", "Закрепить", "Закріпити", "تثبيت"), unpin: L("Unpin", "Открепить", "Відкріпити", "إلغاء التثبيت"),
  dismiss_commitment: L("Not a commitment", "Это не обещание", "Це не обіцянка", "ليس التزامًا"),
};
const PRI: Record<string, string> = { HIGH: "c-bad", MEDIUM: "c-warn", LOW: "" };
const PRI_T: Record<string, T4> = { HIGH: L("High", "Высокий", "Високий", "عالٍ"), MEDIUM: L("Medium", "Средний", "Середній", "متوسط"), LOW: L("Low", "Низкий", "Низький", "منخفض") };
const SRC_T: Record<string, T4> = {
  tasks: L("my tasks", "мои задачи", "мої задачі", "مهامي"), dependencies: L("dependencies", "зависимости", "залежності", "التبعيات"), meetings: L("meetings", "встречи", "зустрічі", "الاجتماعات"), processes: L("approvals & processes", "согласования и процессы", "погодження та процеси", "الموافقات والعمليات"),
  attention: L("attention", "внимание", "увага", "الانتباه"), waiting: L("waiting for", "ожидание", "очікування", "الانتظار"), waiting_kinds: L("waiting for", "ожидание", "очікування", "الانتظار"), open_loops: L("open loops", "незакрытые вопросы", "незакриті питання", "الحلقات المفتوحة"), commercial: L("commercial", "коммерция", "комерція", "التجاري"),
  manufacturing: L("manufacturing", "производство", "виробництво", "التصنيع"), commitments: L("commitments", "обещания", "обіцянки", "الالتزامات"), state: L("personal state", "личные настройки", "особисті налаштування", "الحالة الشخصية"),
  exec: L("company overview", "обзор компании", "огляд компанії", "نظرة الشركة"), operations: L("operations", "операции", "операції", "العمليات"), changes: L("changes", "изменения", "зміни", "التغييرات"), mine: L("my items", "мои записи", "мої записи", "عناصري"),
};

async function inow(body?: any, view?: string) {
  const r = await fetch(view ? `/api/inow?view=${view}` : "/api/inow", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({ error: r.statusText }));
  return r.ok ? j : { ...j, error: j.error || r.statusText, status: r.status };
}

type Tab = "day" | "exec" | "changes" | "eod" | "settings";

/** 1inow · My Day page (route /inow; also the home page when the person or the organisation chose it). */
export default function InowMyDay() {
  const { lang, me, toast } = useApp(); const l = lg(lang); const T = (x: T4, v?: any) => say(x, lang, v);
  const [tab, setTab] = useState<Tab>("day");
  const [day, setDay] = useState<any>(null); const [err, setErr] = useState(""); const [undo, setUndo] = useState<any>(null);
  const [brief, setBrief] = useState<string | null>(null); const [proposal, setProposal] = useState<any>(null);
  const load = useCallback(async () => {
    const d = await inow(undefined, "day");
    if (d.error) { setErr(d.status === 500 ? T(L("1inow is temporarily unavailable — your Workspace pages work as usual.", "1inow временно недоступен — страницы Workspace работают как обычно.", "1inow тимчасово недоступний — сторінки Workspace працюють як зазвичай.", "1inow غير متاح مؤقتًا — صفحات Workspace تعمل كالمعتاد.")) : d.error); return; }
    setErr(""); setDay(d);
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 120000); const f = () => document.visibilityState === "visible" && load(); document.addEventListener("visibilitychange", f); return () => { clearInterval(t); document.removeEventListener("visibilitychange", f); }; }, [load]);

  const setState = async (key: string, patch: any) => {
    const r = await inow({ op: "state", key, ...patch });
    if (r.error) { toast(r.error, true); return; }
    setUndo(r.undo); load();
  };
  const restore = async () => { if (!undo) return; await inow(undo); setUndo(null); load(); toast(T(L("Undone", "Отменено", "Скасовано", "تم التراجع"))); };
  /** A change to a business record is never made here: it becomes a proposal the person confirms (preview first). */
  const propose = async (text: string) => {
    const r = await inow({ op: "ask", q: text, lang });
    if (r.kind === "proposal") { setProposal(r.proposal); window.scrollTo({ top: 0, behavior: "smooth" }); } else toast(r.text || r.error || "Error", true);
  };
  const act = async (r: Ranked, s: Suggest) => {
    switch (s.kind) {
      case "complete": return propose(`complete task ${r.title}`);
      case "reschedule": return propose(`move the deadline of ${r.title} to tomorrow`);
      case "followup_task": return propose(`create task Follow up: ${r.title}`);
      case "reminder": return setState(r.key, { remind: "tomorrow", snooze: "tomorrow" });
      case "resolve": return setState(r.key, { dismiss: true });
      case "snooze": return setState(r.key, { snooze: "tomorrow" });
      case "dismiss": return setState(r.key, { not_relevant: true });
      case "pin": return setState(r.key, { pin: !r.pinned });
      case "brief": return setBrief(r.record_id || null);
      case "confirm_commitment": {
        const c = await inow({ op: "commitment", id: r.key.replace(/^commitment:/, ""), decision: "confirm", lang });
        if (c.error) toast(c.error, true); else { setProposal(c.proposal); window.scrollTo({ top: 0, behavior: "smooth" }); load(); } return;
      }
      default: return;
    }
  };
  const dismissCommitment = async (r: Ranked) => { const c = await inow({ op: "commitment", id: r.key.replace(/^commitment:/, ""), decision: "dismiss" }); if (c.error) toast(c.error, true); load(); };
  const execOk = !!day?.executive_available;
  const unavailable = useMemo(() => Object.entries(day?.sources || {}).filter(([, v]: any) => !v.ok).map(([k]) => SRC_T[k] ? T(SRC_T[k]) : k), [day, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="inow" data-inow>
    <section className="card inow-head">
      <div className="card-h" style={{ flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}><Icon n="spark" />1inow · {T(L("My Day", "Мой день", "Мій день", "يومي"))}</h1>
        <nav className="seg" style={{ marginInlineStart: "auto" }} aria-label="1inow">
          <button className={tab === "day" ? "on" : ""} onClick={() => setTab("day")}><Icon n="sun" />{T(L("My Day", "Мой день", "Мій день", "يومي"))}</button>
          {execOk && <button className={tab === "exec" ? "on" : ""} onClick={() => setTab("exec")}><Icon n="landmark" />{T(L("Executive", "Руководителю", "Керівнику", "التنفيذي"))}</button>}
          <button className={tab === "changes" ? "on" : ""} onClick={() => setTab("changes")}><Icon n="pulse" />{T(L("What changed", "Что изменилось", "Що змінилося", "ما الذي تغيّر"))}</button>
          <button className={tab === "eod" ? "on" : ""} onClick={() => setTab("eod")}><Icon n="moon" />{T(L("End of day", "Итоги дня", "Підсумки дня", "نهاية اليوم"))}</button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")} aria-label={T(L("Settings", "Настройки", "Налаштування", "الإعدادات"))}><Icon n="gear" /></button>
        </nav>
      </div>
      <AskBar onProposal={setProposal} disabled={day?.flags?.ask === false} />
      {proposal && <div style={{ padding: "0 16px 12px" }}><Proposal key={proposal.id} p={proposal} onDone={() => { setProposal(null); load(); }} /></div>}
      {undo && <div className="toolbar" style={{ padding: "0 16px 12px" }}><span className="faint">{T(L("Saved for you only — nothing in Workspace changed.", "Сохранено только для вас — в Workspace ничего не изменилось.", "Збережено лише для вас — у Workspace нічого не змінилося.", "حُفظ لك فقط — لم يتغير شيء في Workspace."))}</span><button className="btn ghost sm" onClick={restore}><Icon n="back" />{T(L("Undo", "Отменить", "Скасувати", "تراجع"))}</button></div>}
    </section>
    {brief && <MeetingBrief id={brief} onClose={() => setBrief(null)} />}
    {tab === "day" && <>
      {err && <div className="card empty" role="alert">{err}</div>}
      {!day && !err && <div className="card empty">…</div>}
      {day?.disabled && <div className="card empty">{T(L("1inow is switched off for this Workspace.", "1inow выключен для этого Workspace.", "1inow вимкнено для цього Workspace.", "1inow متوقف في مساحة العمل هذه."))}</div>}
      {day && !day.disabled && <>
        {unavailable.length > 0 && <div className="card" role="status" style={{ padding: "10px 16px" }}><Icon n="info" /> {T(L("Temporarily unavailable: {x}. Everything else is current.", "Временно недоступно: {x}. Остальное актуально.", "Тимчасово недоступно: {x}. Решта актуальна.", "غير متاح مؤقتًا: {x}. كل ما عداه محدّث."), { x: unavailable.join(", ") })}</div>}
        <NextCard next={day.next || []} l={l} onAct={act} />
        <div className="inow-grid">
          {SECTIONS.map((s) => <section key={s.key} className={`card inow-sec inow-${s.key}`} data-section={s.key}>
            <div className="card-h"><h2><Icon n={s.icon} />{T(s.label)} <span className="chip">{day.counts?.[s.key] ?? 0}</span></h2></div>
            {(day[s.key] || []).length === 0 ? <div className="faint" style={{ padding: "0 16px 14px" }}>{T(s.empty)}</div>
              : <ul className="inow-list">{(day[s.key] as Ranked[]).map((r) => <ItemRow key={r.key} r={r} l={l} onAct={act} onDismissCommitment={dismissCommitment} />)}</ul>}
          </section>)}
        </div>
        <p className="faint" style={{ fontSize: 12, textAlign: "center" }}>
          {day.hidden > 0 && <>{T(L("{n} snoozed or dismissed by you.", "{n} отложено или скрыто вами.", "{n} відкладено або приховано вами.", "{n} مؤجّلة أو مخفية من قبلك."), { n: day.hidden })} </>}
          {T(L("Ranked by rules, not by AI: every line says why it is here. Approvals and controlled steps cannot be hidden.", "Порядок задают правила, а не ИИ: у каждой строки указана причина. Согласования и контролируемые шаги скрыть нельзя.", "Порядок задають правила, а не ШІ: кожен рядок пояснює причину. Погодження й контрольовані кроки приховати не можна.", "الترتيب بالقواعد لا بالذكاء الاصطناعي: لكل سطر سببه. لا يمكن إخفاء الموافقات والخطوات المضبوطة."))}
        </p>
      </>}
    </>}
    {tab === "exec" && execOk && <Executive l={l} onAct={act} />}
    {tab === "changes" && <Changes />}
    {tab === "eod" && <EndOfDay l={l} />}
    {tab === "settings" && <InowSettings role={me.role} />}
  </div>;
}

function ItemRow({ r, l, onAct, onDismissCommitment }: { r: Ranked; l: Lg; onAct: (r: Ranked, s: Suggest) => void; onDismissCommitment?: (r: Ranked) => void }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [open, setOpen] = useState(false);
  const main = r.suggested.filter((s) => !["open", "pin", "snooze", "dismiss"].includes(s.kind));
  return <li className="inow-item" data-key={r.key} data-priority={r.priority} data-controlled={r.controlled ? "1" : undefined}>
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span className={`chip ${PRI[r.priority]}`} title={T(L("Priority", "Приоритет", "Пріоритет", "الأولوية"))}>{r.pinned && <Icon n="flag" />}{T(PRI_T[r.priority])}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={r.link} className="inow-title">{r.title}</Link>
        <div className="faint inow-why">{r.reasons.map((s) => explain(s, l)).join(" · ")}</div>
        {!r.required_next && r.hint && <div className="inow-why"><span className="chip">{T(L("Suggested", "Предложение", "Пропозиція", "مقترح"))}</span> {say(NEXT_ACTION[r.hint], lang) || r.hint}</div>}
        {r.required_next && <div className="inow-req"><b>{T(L("Required next step", "Обязательный следующий шаг", "Обов'язковий наступний крок", "الخطوة التالية المطلوبة"))}:</b> {r.required_next}</div>}
        {r.evidence && <div className="inow-evd faint">“{r.evidence.excerpt}” · {T(L("confidence", "уверенность", "впевненість", "الثقة"))}: {r.evidence.confidence} · <Link href={r.evidence.source_link}>{T(L("source", "источник", "джерело", "المصدر"))}</Link></div>}
      </div>
      <button className="btn ghost sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={T(L("Actions", "Действия", "Дії", "إجراءات"))}><Icon n="menu" /></button>
    </div>
    <div className="chipbar" style={{ marginTop: 6 }}>
      {r.controlled ? <Link className="btn sm" href={r.link}><Icon n="stamp" />{T(ACT.decide)}</Link> : main.slice(0, 2).map((s) => <button key={s.id} onClick={() => onAct(r, s)}>{T(ACT[s.label] || ACT.open)}</button>)}
      {open && <>
        {!r.controlled && main.slice(2).map((s) => <button key={s.id} onClick={() => onAct(r, s)}>{T(ACT[s.label] || ACT.open)}</button>)}
        <button onClick={() => onAct(r, { id: "pin", kind: "pin", label: "pin" })}><Icon n="flag" />{T(r.pinned ? ACT.unpin : ACT.pin)}</button>
        {!r.controlled && <button onClick={() => onAct(r, { id: "snooze", kind: "snooze", label: "snooze" })}><Icon n="clock" />{T(ACT.snooze)}</button>}
        {!r.controlled && r.src !== "commitment" && <button onClick={() => onAct(r, { id: "dismiss", kind: "dismiss", label: "not_relevant" })}><Icon n="eyeoff" />{T(ACT.not_relevant)}</button>}
        {r.src === "commitment" && onDismissCommitment && <button onClick={() => onDismissCommitment(r)}><Icon n="x" />{T(ACT.dismiss_commitment)}</button>}
      </>}
    </div>
  </li>;
}

/** NEXT — a Required step (defined by the workflow) is never shown as a mere suggestion, and the other way round. */
function NextCard({ next, l, onAct }: { next: any[]; l: Lg; onAct: (r: Ranked, s: Suggest) => void }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  if (!next.length) return null;
  return <section className="card inow-next" data-section="next">
    <div className="card-h"><h2><Icon n="rocket" />{T(L("Next", "Дальше", "Далі", "التالي"))}</h2></div>
    <ul className="inow-list">{next.slice(0, 4).map((n) => <li key={n.item.key} className="inow-item">
      <Link href={n.item.link} className="inow-title">{n.item.title}</Link>
      {n.required ? <div className="inow-req"><span className="chip c-bad">{T(L("Required", "Обязательно", "Обов'язково", "مطلوب"))}</span> {n.required}</div>
        : (n.hint || n.suggested.length > 0) && <div className="chipbar" style={{ marginTop: 4 }}><span className="chip">{T(L("Suggested", "Предложение", "Пропозиція", "مقترح"))}</span>{n.hint && <span className="faint">{say(NEXT_ACTION[n.hint], lang) || n.hint}</span>}{n.suggested.map((s: Suggest) => <button key={s.id} onClick={() => onAct(n.item, s)}>{T(ACT[s.label] || ACT.open)}</button>)}</div>}
      <div className="faint inow-why">{n.item.reasons.slice(0, 2).map((s: any) => explain(s, l)).join(" · ")}</div>
    </li>)}</ul>
  </section>;
}

/** Ask 1inow — questions are answered from records (with sources); "do X" becomes a proposal; a thought goes to the Inbox. */
function AskBar({ onProposal, disabled }: { onProposal: (p: any) => void; disabled?: boolean }) {
  const { lang, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false); const [ans, setAns] = useState<any>(null); const [mode, setMode] = useState<"ask" | "capture">("ask");
  const [ai, setAi] = useState<{ text: string; sources: any[]; failed?: boolean } | null>(null); const ctl = useRef<AbortController | null>(null);
  const askAi = async (text: string) => {
    setAi({ text: "", sources: [] }); ctl.current?.abort(); ctl.current = new AbortController();
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.current.signal, body: JSON.stringify({ tier: "quick", retrieve: true, record_id: null, lang, section: "", messages: [{ role: "user", content: text }] }) });
      if (!res.ok || !res.body) throw new Error("ai");
      let sources: any[] = []; try { const h = res.headers.get("x-ai-sources"); if (h) sources = JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/"))); } catch {}
      const rd = res.body.getReader(); const dec = new TextDecoder(); let acc = "";
      for (;;) { const { done, value } = await rd.read(); if (done) break; acc += dec.decode(value, { stream: true }); setAi({ text: acc, sources }); }
    } catch (e: any) { if (e?.name !== "AbortError") setAi({ text: "", sources: [], failed: true }); }
  };
  const send = async (text: string, src: "text" | "voice", choice?: string) => {
    const t = text.trim(); if (!t || busy) return; setBusy(true); setAns(null); setAi(null);
    try {
      if (mode === "capture") {
        // never lose input: the Voice Inbox keeps the original words even when nothing could be understood
        const r = await voiceApi({ action: "capture", text: t, source: src, lang });
        if (r.ok === false) toast(r.error || "Error", true); else { toast(T(L("Saved to your Inbox", "Сохранено во входящие", "Збережено у вхідні", "حُفظ في صندوقك"))); if (r.plan) onProposal(r.plan); setQ(""); }
        return;
      }
      const r = await inow({ op: "ask", q: t, lang, choice });
      if (r.disabled) { toast(T(L("Ask 1inow is switched off.", "Ask 1inow выключен.", "Ask 1inow вимкнено.", "Ask 1inow متوقف.")), true); return; }
      if (r.kind === "proposal") { onProposal(r.proposal); setQ(""); return; }
      if (r.kind === "assistant") { setAns({ kind: "assistant", q: t }); await askAi(t); return; }
      setAns({ ...r, q: t });
    } finally { setBusy(false); }
  };
  const sp = useSpeech(lang, (t) => { setQ(t); send(t, "voice"); });
  // a question handed over from the command palette (kept in this tab only, never in the address bar)
  useEffect(() => { try { const v = sessionStorage.getItem("inow_ask"); if (v) { sessionStorage.removeItem("inow_ask"); setQ(v); send(v, "text"); } } catch {} }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div style={{ padding: "0 16px 12px", display: "grid", gap: 8 }}>
    <form className="vox" onSubmit={(e) => { e.preventDefault(); send(q, "text"); }}>
      <nav className="seg"><button type="button" className={mode === "ask" ? "on" : ""} onClick={() => setMode("ask")}><Icon n="spark" />{T(L("Ask", "Спросить", "Запитати", "اسأل"))}</button><button type="button" className={mode === "capture" ? "on" : ""} onClick={() => setMode("capture")}><Icon n="inbox" />{T(L("Capture", "Записать", "Записати", "التقاط"))}</button></nav>
      {sp.supported && <button type="button" className={`btn sm ${sp.on ? "rec" : ""}`} onClick={() => (sp.on ? sp.stop() : sp.start())} aria-pressed={sp.on} aria-label={T(L("Speak", "Говорить", "Говорити", "تحدث"))}><Icon n="mic" /></button>}
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} disabled={busy || disabled} aria-label="Ask 1inow"
        placeholder={mode === "ask" ? T(L("“What needs my attention?” · “What is blocking C20?” · “Create task…”", "«Что требует моего внимания?» · «Что блокирует C20?» · «Создай задачу…»", "«Що потребує моєї уваги?» · «Що блокує C20?» · «Створи задачу…»", "«ما الذي يحتاج انتباهي؟» · «ما الذي يعيق C20؟» · «أنشئ مهمة…»"))
          : T(L("“Call Max about the vendor quote”", "«Позвонить Максу по котировке поставщика»", "«Зателефонувати Максу щодо котирування постачальника»", "«اتصل بماكس بشأن عرض المورد»"))} />
      <button className="btn primary sm" type="submit" disabled={busy || !q.trim() || disabled} aria-label={T(L("Send", "Отправить", "Надіслати", "إرسال"))}><Icon n="send" /></button>
    </form>
    {ans && <Answer a={ans} onChoose={(id) => send(ans.q, "text", id)} />}
    {ai && <div className="inow-ai" data-ai={ai.failed ? "failed" : "ok"}>
      {ai.failed ? <div className="faint"><Icon n="info" /> {T(L("AI assistance is temporarily unavailable. My Day and the answers from records keep working.", "Помощь ИИ временно недоступна. «Мой день» и ответы по записям продолжают работать.", "Допомога ШІ тимчасово недоступна. «Мій день» і відповіді за записами працюють далі.", "مساعدة الذكاء الاصطناعي غير متاحة مؤقتًا. يومي والإجابات من السجلات تعمل."))}</div>
        : <><div style={{ whiteSpace: "pre-wrap" }}>{ai.text || "…"}</div>{ai.sources.length > 0 && <div className="chipbar" style={{ marginTop: 6 }}>{ai.sources.slice(0, 8).map((s: any, i: number) => <Link key={i} className="chip" href={s.link || s.href || "#"}><Icon n="file" />{s.title}</Link>)}</div>}
          <div className="faint" style={{ fontSize: 12 }}>{T(L("AI answer from records you may open — check the sources.", "Ответ ИИ по записям, доступным вам, — проверьте источники.", "Відповідь ШІ за записами, доступними вам, — перевірте джерела.", "إجابة ذكاء اصطناعي من سجلات يمكنك فتحها — تحقّق من المصادر."))}</div></>}
    </div>}
  </div>;
}

function Answer({ a, onChoose }: { a: any; onChoose: (id: string) => void }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  if (a.kind === "assistant") return null;
  if (a.kind === "error") return <div className="faint" role="alert">{a.text}</div>;
  if (a.kind === "choose") return <div className="inow-answer" data-answer="choose"><div><Icon n="info" /> {T(L("Which one do you mean?", "Что именно вы имеете в виду?", "Що саме ви маєте на увазі?", "أيّها تقصد؟"))}</div>
    <div className="chipbar" style={{ marginTop: 6 }}>{a.options.map((o: any) => <button key={o.id} onClick={() => onChoose(o.id)}>{o.label}</button>)}</div></div>;
  const items: any[] = a.items || [];
  return <div className="inow-answer" data-answer={a.intent}>
    {a.subject && <div><b><Link href={a.subject.link}>{a.subject.title}</Link></b>{a.health && <span className={`chip ${a.health.level === "red" || a.health.level === "critical" ? "c-bad" : a.health.level === "yellow" || a.health.level === "at_risk" ? "c-warn" : "c-ok"}`} style={{ marginInlineStart: 8 }}>{String(a.health.level)}</span>}</div>}
    {a.health?.reasons?.length > 0 && <div className="faint">{(a.health.reasons as any[]).map((x) => (typeof x === "string" ? x : x.text || x.code)).join(" · ")}</div>}
    {a.facts && <FactList f={a.facts} />}
    {items.length === 0 && !a.facts && !a.health && <div className="faint">{a.note === "nothing_found" ? T(L("Nothing you can open matches that.", "Среди доступных вам записей ничего не найдено.", "Серед доступних вам записів нічого не знайдено.", "لا شيء مما يمكنك فتحه يطابق ذلك.")) : T(L("Nothing here right now.", "Сейчас здесь пусто.", "Зараз тут порожньо.", "لا شيء هنا الآن."))}</div>}
    {items.length > 0 && <ul className="inow-list">{items.map((x, i) => <li key={i} className="inow-item"><Link href={x.link} className="inow-title">{x.title}</Link>{x.why && <div className="faint inow-why">{x.why}</div>}</li>)}</ul>}
    {a.next && a.next.length > 0 && <ul className="inow-list">{a.next.map((n: any, i: number) => <li key={i} className="inow-item"><Link href={n.link}>{n.title}</Link> — {n.required ? <b>{n.required}</b> : <span className="faint">{n.suggested.join(", ")}</span>}</li>)}</ul>}
    <div className="faint" style={{ fontSize: 12 }}><Icon n="check" /> {T(L("Answered from Workspace records you may open ({n} sources).", "Ответ по записям Workspace, доступным вам (источников: {n}).", "Відповідь за записами Workspace, доступними вам (джерел: {n}).", "إجابة من سجلات Workspace التي يمكنك فتحها ({n} مصادر)."), { n: (a.sources || []).length })}</div>
  </div>;
}
function FactList({ f }: { f: any }) {
  const rows = Array.isArray(f) ? f : Array.isArray(f.items) ? f.items : Array.isArray(f.rows) ? f.rows : [];
  if (!rows.length) return <pre className="faint" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{typeof f === "object" ? (f.summary || f.answer || "") : String(f)}</pre>;
  return <ul className="inow-list">{rows.slice(0, 10).map((r: any, i: number) => <li key={i} className="inow-item">{r.link ? <Link href={r.link}>{r.title || r.label || r.name}</Link> : <span>{r.title || r.label || r.name || JSON.stringify(r).slice(0, 120)}</span>}{r.reason && <div className="faint">{r.reason}</div>}</li>)}</ul>;
}

/** Executive 1inow — only for owners and management, still computed with the viewer's own reading rights. */
function Executive({ l, onAct }: { l: Lg; onAct: (r: Ranked, s: Suggest) => void }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [d, setD] = useState<any>(null);
  useEffect(() => { inow(undefined, "executive").then(setD); }, []);
  if (!d) return <div className="card empty">…</div>;
  if (d.error) return <div className="card empty">{d.error}</div>;
  const kv = (o: any, labels: Record<string, T4>) => o ? <div className="chipbar">{Object.entries(labels).map(([k, lb]) => o[k] != null && <span key={k} className={`chip ${Number(o[k]) > 0 ? "c-warn" : ""}`}>{T(lb)}: {Number(o[k]) || 0}</span>)}</div> : <div className="faint">—</div>;
  const block = (title: T4, icon: string, body: React.ReactNode) => <section className="card inow-sec"><div className="card-h"><h2><Icon n={icon} />{T(title)}</h2></div><div style={{ padding: "0 16px 14px" }}>{body}</div></section>;
  const list = (rs: Ranked[]) => rs.length ? <ul className="inow-list">{rs.map((r) => <ItemRow key={r.key} r={r} l={l} onAct={onAct} />)}</ul> : <div className="faint">{T(L("Nothing here.", "Пусто.", "Порожньо.", "لا شيء."))}</div>;
  return <div className="inow-grid" data-view="executive">
    {block(L("Needs you now", "Нужно вам сейчас", "Потрібно вам зараз", "يحتاجك الآن"), "target", list(d.now || []))}
    {block(L("Decisions", "Решения", "Рішення", "القرارات"), "stamp", list(d.decisions || []))}
    {block(L("Waiting on customers, vendors, partners", "Ожидание клиентов, поставщиков, партнёров", "Очікування клієнтів, постачальників, партнерів", "بانتظار العملاء والموردين والشركاء"), "clock", list(d.waiting || []))}
    {block(L("Commercial", "Коммерция", "Комерція", "التجاري"), "handshake", kv(d.commercial, { needs_action: L("need action", "нужно действие", "потрібна дія", "تحتاج إجراء"), stalled: L("stalled", "застряли", "застрягли", "متوقفة"), no_next_action: L("no next action", "нет следующего шага", "немає наступного кроку", "بلا خطوة تالية"), proposals_waiting: L("proposals waiting", "КП ждут ответа", "КП чекають відповіді", "عروض بانتظار"), overdue: L("overdue", "просрочено", "прострочено", "متأخرة") }))}
    {block(L("Manufacturing", "Производство", "Виробництво", "التصنيع"), "factory", kv(d.manufacturing, { blocked: L("blocked", "заблокировано", "заблоковано", "معطلة"), late: L("late", "опаздывают", "запізнюються", "متأخرة"), shortages: L("shortages", "дефицит", "дефіцит", "نقص"), failed_tests: L("failed tests", "проваленные испытания", "провалені випробування", "اختبارات فاشلة"), nonconformances: L("nonconformances", "несоответствия", "невідповідності", "عدم مطابقة"), critical_procurement: L("critical procurement", "критичные закупки", "критичні закупівлі", "مشتريات حرجة") }))}
    {block(L("Company attention", "Внимание компании", "Увага компанії", "انتباه الشركة"), "alert", (d.company_attention || []).length ? <ul className="inow-list">{d.company_attention.map((x: any, i: number) => <li key={i} className="inow-item">{x.link ? <Link href={x.link}>{x.title}</Link> : x.title}{x.reason && <div className="faint">{x.reason}</div>}</li>)}</ul> : <div className="faint">—</div>)}
    {block(L("Projects", "Проекты", "Проєкти", "المشاريع"), "layers", (d.projects || []).length ? <ul className="inow-list">{d.projects.map((p: any, i: number) => <li key={i} className="inow-item">{p.link ? <Link href={p.link}>{p.title}</Link> : p.title} {p.level && <span className="chip">{p.level}</span>}</li>)}</ul> : <div className="faint">—</div>)}
    <p className="faint" style={{ fontSize: 12, gridColumn: "1/-1", textAlign: "center" }}>{T(L("Team lines show work status only — no activity tracking, no productivity score, no ranking of people.", "По команде — только статус работы: без отслеживания активности, оценок продуктивности и рейтингов людей.", "По команді — лише статус роботи: без відстеження активності, оцінок продуктивності та рейтингів людей.", "حالة العمل فقط — بلا تتبّع نشاط ولا درجات إنتاجية ولا ترتيب للأشخاص."))}</p>
  </div>;
}

function Changes() {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [w, setW] = useState<"day" | "week">("day"); const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); inow(undefined, `changes&window=${w}`).then(setD); }, [w]);
  return <section className="card" data-view="changes">
    <div className="card-h"><h2><Icon n="pulse" />{T(L("What changed", "Что изменилось", "Що змінилося", "ما الذي تغيّر"))}</h2>
      <nav className="seg" style={{ marginInlineStart: "auto" }}><button className={w === "day" ? "on" : ""} onClick={() => setW("day")}>{T(L("24 h", "24 ч", "24 год", "24 ساعة"))}</button><button className={w === "week" ? "on" : ""} onClick={() => setW("week")}>{T(L("7 days", "7 дней", "7 днів", "7 أيام"))}</button></nav></div>
    {!d ? <div className="faint" style={{ padding: 16 }}>…</div> : d.error ? <div className="faint" style={{ padding: 16 }}>{d.error}</div> : (d.items || []).length === 0 ? <div className="faint" style={{ padding: 16 }}>{T(L("Nothing changed that concerns you.", "Ничего важного для вас не изменилось.", "Нічого важливого для вас не змінилося.", "لم يتغير ما يخصّك."))}</div>
      : <ul className="inow-list">{d.items.map((c: any, i: number) => <li key={i} className="inow-item" data-relevance={c.relevance}>
        <Link href={c.link || "#"} className="inow-title">{c.title}</Link>
        <div className="faint inow-why">{c.relevance === 0 ? T(L("yours", "ваше", "ваше", "لك")) : c.relevance === 1 ? T(L("your project", "ваш проект", "ваш проєкт", "مشروعك")) : T(L("company", "компания", "компанія", "الشركة"))} · {changeText(c, lang) || String(c.kind).replace(/_/g, " ")} · {String(c.at || "").slice(0, 16).replace("T", " ")}{c.by ? ` · ${c.by}` : ""}</div>
      </li>)}</ul>}
  </section>;
}

function EndOfDay({ l }: { l: Lg }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [d, setD] = useState<any>(null);
  useEffect(() => { inow(undefined, "eod").then(setD); }, []);
  if (!d) return <div className="card empty">…</div>;
  if (d.error) return <div className="card empty">{d.error}</div>;
  const part = (title: T4, rows: any[], ranked = true) => <section className="card inow-sec"><div className="card-h"><h2>{T(title)} <span className="chip">{rows.length}</span></h2></div>
    {rows.length === 0 ? <div className="faint" style={{ padding: "0 16px 14px" }}>—</div> : <ul className="inow-list">{rows.map((r: any) => <li key={r.key || r.id} className="inow-item"><Link href={r.link} className="inow-title">{r.title}</Link>{ranked && r.reasons && <div className="faint inow-why">{r.reasons.map((s: any) => explain(s, l)).join(" · ")}</div>}</li>)}</ul>}</section>;
  return <div className="inow-grid" data-view="eod">
    {part(L("Done today", "Сделано сегодня", "Зроблено сьогодні", "أُنجز اليوم"), d.completed || [], false)}
    {part(L("Still open", "Ещё открыто", "Ще відкрито", "ما زال مفتوحًا"), d.still_open || [])}
    {part(L("Newly waiting", "Новое ожидание", "Нове очікування", "انتظار جديد"), d.newly_waiting || [])}
    {part(L("Unresolved attention", "Нерешённое", "Невирішене", "لم يُحل"), d.unresolved_attention || [])}
    {part(L("Likely tomorrow", "Вероятно завтра", "Ймовірно завтра", "على الأرجح غدًا"), d.tomorrow || [])}
  </div>;
}

/** Meeting Brief — purpose, people, open actions, waiting, recent changes, documents (only what the viewer may open). */
function MeetingBrief({ id, onClose }: { id: string; onClose: () => void }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [d, setD] = useState<any>(null);
  useEffect(() => { inow(undefined, `meeting&id=${encodeURIComponent(id)}`).then(setD); }, [id]);
  const sec = (title: T4, rows: any[]) => rows?.length ? <div><b>{T(title)}</b><ul className="inow-list">{rows.map((x: any, i: number) => <li key={i} className="inow-item">{x.link ? <Link href={x.link}>{x.title}</Link> : x.title || x.name}{x.loop_key ? <span className="faint"> · {loopText(x, lang)}{x.next_action ? ` → ${say(NEXT_ACTION[x.next_action], lang) || x.next_action}` : ""}</span> : x.kind ? <span className="faint"> · {changeText(x, lang) || String(x.kind).replace(/_/g, " ")}</span> : null}</li>)}</ul></div> : null;
  return <section className="card" data-view="meeting-brief">
    <div className="card-h"><h2><Icon n="calendar" />{T(L("Meeting brief", "Бриф встречи", "Бриф зустрічі", "ملخص الاجتماع"))}</h2><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={onClose} aria-label="close"><Icon n="x" /></button></div>
    <div style={{ padding: "0 16px 14px", display: "grid", gap: 8 }}>
      {!d ? "…" : d.error ? <span className="faint">{d.error}</span> : <>
        <div><b><Link href={`/company/meetings?r=${d.meeting.id}`}>{d.meeting.title}</Link></b> <span className="faint">{d.meeting.date} {d.meeting.time || ""}</span></div>
        {d.meeting.agenda && <div style={{ whiteSpace: "pre-wrap" }}>{d.meeting.agenda}</div>}
        {d.participants?.length > 0 && <div className="chipbar">{d.participants.map((p: any) => <span key={p.id} className="chip"><Icon n="user" />{p.name}</span>)}</div>}
        {sec(L("Decisions needed", "Нужны решения", "Потрібні рішення", "قرارات مطلوبة"), d.decisions_needed)}
        {sec(L("Open actions", "Открытые действия", "Відкриті дії", "إجراءات مفتوحة"), d.open_actions)}
        {sec(L("Waiting", "Ожидание", "Очікування", "بانتظار"), d.waiting)}
        {sec(L("Changed this week", "Изменилось за неделю", "Змінилося за тиждень", "تغيّر هذا الأسبوع"), d.recent_changes)}
        {sec(L("Documents", "Документы", "Документи", "المستندات"), (d.documents || []).map((x: any) => ({ ...x, link: `/company/documents?r=${x.id}` })))}
        <div className="faint" style={{ fontSize: 12 }}>{T(L("After the meeting, actions from the minutes are proposed — nothing is assigned until you confirm.", "После встречи действия из протокола предлагаются — ничего не назначается без вашего подтверждения.", "Після зустрічі дії з протоколу пропонуються — нічого не призначається без вашого підтвердження.", "بعد الاجتماع تُقترح الإجراءات من المحضر — لا يُسند شيء دون تأكيدك."))}</div>
      </>}
    </div>
  </section>;
}

/** Personal home choice for everyone; organisation-wide feature switches for owners/administrators. */
export function InowSettings({ role }: { role: string }) {
  const { lang, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [s, setS] = useState<any>(null);
  const load = () => inow(undefined, "settings").then(setS);
  useEffect(() => { load(); }, []);
  if (!s) return <div className="card empty">…</div>;
  const admin = ["owner", "admin"].includes(role);
  const home = s.prefs?.home || (["owner", "admin", "management"].includes(role) ? s.home?.management : s.home?.employee) || "today";
  const savePref = async (p: any) => { const r = await inow({ op: "prefs", ...p }); if (r.error) toast(r.error, true); else { try { if (p.home) localStorage.setItem("inow_home", p.home); } catch {} toast(T(L("Saved", "Сохранено", "Збережено", "تم الحفظ"))); load(); } };
  const saveFlag = async (k: string, v: boolean) => { const r = await inow({ op: "settings", flags: { ...s.flags, [k]: v } }); if (r.error) toast(r.error, true); else load(); };
  const FL: Record<string, T4> = { my_day: L("My Day", "Мой день", "Мій день", "يومي"), ask: L("Ask 1inow", "Ask 1inow", "Ask 1inow", "Ask 1inow"), voice: L("Voice", "Голос", "Голос", "الصوت"), inbox: L("Inbox capture", "Быстрая запись", "Швидкий запис", "الالتقاط السريع"), suggested: L("Suggested actions", "Предлагаемые действия", "Запропоновані дії", "الإجراءات المقترحة"), executive: L("Executive 1inow", "Executive 1inow", "Executive 1inow", "Executive 1inow"), commitments: L("Detected commitments", "Найденные обещания", "Знайдені обіцянки", "الالتزامات المكتشفة") };
  return <div className="inow-grid" data-view="settings">
    <section className="card inow-sec"><div className="card-h"><h2><Icon n="home" />{T(L("My start page", "Моя стартовая страница", "Моя стартова сторінка", "صفحتي الرئيسية"))}</h2></div>
      <div style={{ padding: "0 16px 14px", display: "grid", gap: 8 }}>
        <nav className="seg"><button className={home === "today" ? "on" : ""} onClick={() => savePref({ home: "today" })}>{T(L("Today (classic)", "Сегодня (классика)", "Сьогодні (класика)", "اليوم (الكلاسيكي)"))}</button><button className={home === "inow" ? "on" : ""} onClick={() => savePref({ home: "inow" })}>1inow · {T(L("My Day", "Мой день", "Мій день", "يومي"))}</button></nav>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={s.prefs?.smart_notifications !== false} onChange={(e) => savePref({ smart_notifications: e.target.checked })} />{T(L("Smart notifications (group low-priority updates; urgent and required items always come through)", "Умные уведомления (группировать второстепенное; срочное и обязательное приходит всегда)", "Розумні сповіщення (групувати другорядне; термінове й обов'язкове приходить завжди)", "إشعارات ذكية (تجميع التحديثات الأقل أهمية؛ العاجل والمطلوب يصل دائمًا)"))}</label>
        <small className="faint">{T(L("Your choice only changes what you see first. Existing dashboards stay where they are.", "Выбор меняет только то, что вы видите первым. Существующие панели остаются на месте.", "Вибір змінює лише те, що ви бачите першим. Наявні панелі лишаються на місці.", "اختيارك يغيّر ما تراه أولًا فقط. اللوحات الحالية تبقى كما هي."))}</small>
      </div></section>
    {admin && <section className="card inow-sec"><div className="card-h"><h2><Icon n="gear" />{T(L("1inow features (whole Workspace)", "Функции 1inow (весь Workspace)", "Функції 1inow (увесь Workspace)", "ميزات 1inow (كل مساحة العمل)"))}</h2></div>
      <div style={{ padding: "0 16px 14px", display: "grid", gap: 6 }}>
        {Object.keys(FL).map((k) => <label key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={s.flags?.[k] !== false} onChange={(e) => saveFlag(k, e.target.checked)} data-flag={k} />{T(FL[k])}</label>)}
        <small className="faint">{T(L("Every change is recorded in the security log. Switching a feature off never hides approvals or controlled steps elsewhere.", "Каждое изменение записывается в журнал безопасности. Выключение функции не скрывает согласования и контролируемые шаги в других разделах.", "Кожна зміна записується до журналу безпеки. Вимкнення функції не приховує погодження й контрольовані кроки в інших розділах.", "يُسجَّل كل تغيير في سجل الأمان. إيقاف ميزة لا يخفي الموافقات أو الخطوات المضبوطة في مكان آخر."))}</small>
      </div></section>}
  </div>;
}
