"use client";
// EXECUTIVE CONTROL (Phase 5): the first screen answers what needs action now; the second level says why; the
// third opens the records. Every number and line comes from a v22 database function computed for the signed-in
// person only (a record they cannot open never changes anything here). Nothing is scored in the browser.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { saveBlob } from "@/lib/format";
import { mgmt } from "@/lib/mgmtApi";
import { ATTENTION_PART, DEADLINE_KIND, ESCALATION, LEVELS, LOOP_CATS, NEXT_ACTION, SEVERITY, WAIT_BUCKET, WAIT_KIND, actionHref, attentionLabel, attentionWhy, changeText, decisionsCsv, deadlinesCsv,
  healthReason, loopText, portfolioCsv, reviewText, say, weeklyReview, workloadCsv, type Level, type T4 } from "@/lib/mgmt";

const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
export const lvlChip = (l: string) => (l === "healthy" ? "c-ok" : l === "attention" ? "c-warn" : l === "risk" ? "c-bad" : l === "critical" ? "c-bad lvl-critical" : "");
type View = null | { kind: "loops"; filter?: (l: any) => boolean; title: T4 } | { kind: "deadlines"; days: number; title: T4 };
type Tab = "loops" | "waiting" | "changes" | "reports" | "alerts" | "settings";

export function LevelChip({ level, score }: { level: string; score?: number | null }) {
  const { lang } = useApp();
  return <span className={`chip ${lvlChip(level)}`} title={score != null ? `${score}/100` : undefined}>{say(LEVELS[level as Level], lang)}{score != null && level !== "closed" ? <b className="mono">{score}</b> : null}</span>;
}
export function Reasons({ reasons, max = 6 }: { reasons: any[]; max?: number }) {
  const { lang } = useApp();
  if (!reasons?.length) return <small className="faint">{tx(L("No issues found in the records you can open.", "В доступных вам записях проблем нет.", "У доступних вам записах проблем немає.", "لا مشكلات في السجلات المتاحة لك."), lang as Lang)}</small>;
  return <ul className="why">{reasons.slice(0, max).map((r: any) => <li key={r.code}><span>{healthReason(r, lang)}</span><small className="mono faint">−{r.penalty}</small></li>)}</ul>;
}

export default function ExecControl() {
  const { lang, me, people, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v); const lg = lang as Lang;
  const lead = ["owner", "admin", "management"].includes(me.role);
  const [ov, setOv] = useState<any>(null); const [err, setErr] = useState(""); const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string>(""); const [view, setView] = useState<View>(null); const [tab, setTab] = useState<Tab>("loops");
  const [loops, setLoops] = useState<any[] | null>(null); const [dl, setDl] = useState<any[] | null>(null);
  const name = (id?: string | null) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.email : ""; };
  useEffect(() => { let off = false; setErr(""); mgmt.overview().then((o) => !off && setOv(o)).catch((e) => !off && setErr(e.message)); mgmt.scanMine(me.id); return () => { off = true; }; }, [tick, me.id]);
  useEffect(() => { if ((view?.kind === "loops" || tab === "loops") && !loops) mgmt.loops().then(setLoops).catch(() => setLoops([])); }, [view, tab, loops]);
  useEffect(() => { if (view?.kind === "deadlines" && !dl) mgmt.deadlines(30).then(setDl).catch(() => setDl([])); }, [view, dl]);
  // opened from a voice command or a link: /control?view=overdue | blocked | decisions | waiting | attention
  useEffect(() => { const v = typeof window !== "undefined" ? new URLSearchParams(location.search).get("view") : null;
    if (v === "overdue") setView({ kind: "loops", filter: (l) => l.kind === "task_overdue", title: L("Overdue work", "Просроченная работа", "Прострочена робота", "عمل متأخر") });
    else if (v === "blocked") setView({ kind: "loops", filter: (l) => l.kind === "task_blocked" || l.kind === "project_blocked", title: L("Blocked work", "Заблокированная работа", "Заблокована робота", "عمل معطل") });
    else if (v === "decisions") setView({ kind: "loops", filter: (l) => l.category === "decision", title: L("Decisions waiting", "Решения ждут", "Рішення чекають", "قرارات معلقة") });
    else if (v === "waiting") { setTab("waiting"); setTimeout(() => document.getElementById("exec-tabs")?.scrollIntoView({ block: "start" }), 300); }
  }, []);
  const refresh = () => { setLoops(null); setDl(null); setTick((t) => t + 1); };

  if (err) return <div className="card empty">{err}</div>;
  if (!ov) return <div className="card empty">…</div>;
  const ind = ov.indicators || {}; const ph = ov.portfolio_health || {};
  const I = ({ k, l, onClick, href, bad }: { k: string; l: T4; onClick?: () => void; href?: string; bad?: boolean }) => {
    const c = <><b className={`mono ${bad && ind[k] ? "neg" : ""}`} style={{ fontSize: 20 }}>{ind[k] ?? 0}</b><small>{T(l)}</small></>;
    return href ? <Link className="stat" href={href}>{c}</Link> : <button className="stat" onClick={onClick}>{c}</button>;
  };
  const rel = (n: number | null | undefined) => (n == null ? "" : n < 0 ? T(L("{n} d late", "просрочено {n} дн.", "прострочено {n} дн.", "متأخر {n} يوم"), { n: -n }) : n === 0 ? T(L("today", "сегодня", "сьогодні", "اليوم")) : T(L("in {n} d", "через {n} дн.", "через {n} дн.", "بعد {n} يوم"), { n }));
  const Card = ({ icon, title, n, more, children, empty }: { icon: string; title: T4; n?: number; more?: () => void; children: React.ReactNode; empty: T4 }) => (
    <div className="card hub-card"><div className="card-h"><h2><Icon n={icon} />{T(title)}</h2>{n != null && <span className="chip mono" style={{ marginInlineStart: "auto" }}>{n}</span>}{more && <button className="btn ghost sm" onClick={more}>{T(L("All", "Все", "Усі", "الكل"))}</button>}</div>
      <div className="feed">{(Array.isArray(children) ? children.flat().filter(Boolean).length : children) ? children : <div className="empty" style={{ padding: 16 }}>{T(empty)}</div>}</div></div>);

  return (
    <div style={{ display: "grid", gap: 16 }} className="exec">
      <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }} aria-label={T(L("Indicators", "Показатели", "Показники", "المؤشرات"))}>
        <I k="active_projects" l={L("Active projects", "Активные проекты", "Активні проєкти", "مشاريع نشطة")} href="/portfolio?tab=active" />
        <I k="critical_projects" l={L("Critical", "Критичные", "Критичні", "حرجة")} href="/portfolio?tab=critical" bad />
        <I k="risk_projects" l={L("At risk", "Под риском", "Під ризиком", "في خطر")} href="/portfolio?tab=risk" bad />
        <I k="overdue_work" l={L("Overdue work", "Просрочено", "Прострочено", "عمل متأخر")} bad onClick={() => setView({ kind: "loops", filter: (l) => l.kind === "task_overdue", title: L("Overdue work", "Просроченная работа", "Прострочена робота", "عمل متأخر") })} />
        <I k="blocked_work" l={L("Blocked", "Заблокировано", "Заблоковано", "معطل")} bad onClick={() => setView({ kind: "loops", filter: (l) => l.kind === "task_blocked", title: L("Blocked work", "Заблокированная работа", "Заблокована робота", "عمل معطل") })} />
        <I k="pending_decisions" l={L("Decisions waiting", "Решения ждут", "Рішення чекають", "قرارات معلقة")} onClick={() => setView({ kind: "loops", filter: (l) => l.category === "decision", title: L("Decisions waiting", "Решения ждут", "Рішення чекають", "قرارات معلقة") })} />
        <I k="pending_approvals" l={L("My approvals", "Мои согласования", "Мої погодження", "موافقاتي")} href="/decide" />
        <I k="deadlines_7" l={L("Deadlines 7 days", "Сроки 7 дней", "Терміни 7 днів", "مواعيد 7 أيام")} onClick={() => setView({ kind: "deadlines", days: 7, title: L("Deadlines — next 7 days", "Сроки — 7 дней", "Терміни — 7 днів", "المواعيد — 7 أيام") })} />
        <I k="deadlines_30" l={L("Deadlines 30 days", "Сроки 30 дней", "Терміни 30 днів", "مواعيد 30 يومًا")} onClick={() => setView({ kind: "deadlines", days: 30, title: L("Deadlines — next 30 days", "Сроки — 30 дней", "Терміни — 30 днів", "المواعيد — 30 يومًا") })} />
        <I k="open_loops" l={L("Open loops", "Открытые вопросы", "Відкриті питання", "حلقات مفتوحة")} onClick={() => setView({ kind: "loops", title: L("All open loops", "Все открытые вопросы", "Усі відкриті питання", "كل الحلقات المفتوحة") })} />
        <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={refresh} title={T(L("Recalculate now", "Пересчитать", "Перерахувати", "إعادة الحساب"))}><Icon n="refresh" /></button>
      </div>

      {view && <section className="card"><div className="card-h"><h2><Icon n="funnel" />{T(view.title)}</h2><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setView(null)}><Icon n="x" />{T(L("Close", "Закрыть", "Закрити", "إغلاق"))}</button></div>
        <div className="feed" style={{ padding: "0 8px 8px" }}>
          {view.kind === "loops" && (!loops ? <div className="empty">…</div> : <LoopList rows={loops.filter(view.filter || (() => true))} name={name} />)}
          {view.kind === "deadlines" && (!dl ? <div className="empty">…</div> : <DeadlineList rows={dl.filter((d) => d.days >= 0 && d.days <= view.days)} name={name} />)}
        </div></section>}

      <div className="hub-grid">
        <div className="wide"><Card icon="target" title={L("Needs attention", "Требует внимания", "Потребує уваги", "يحتاج انتباهًا")} n={ov.attention_total} empty={L("Nothing needs attention in the records you can open.", "В доступных вам записях ничего не требует внимания.", "У доступних вам записах нічого не потребує уваги.", "لا شيء يحتاج انتباهًا في السجلات المتاحة لك.")}>
          {(ov.attention || []).map((a: any, i: number) => { const why = attentionWhy(a, lang); const on = open === a.item_key; const lab = attentionLabel(a.attention_score); return <div key={a.item_key} className="hub-row attn">
            <span className="mono faint" style={{ width: 18 }}>{i + 1}</span>
            <button className="linkish" style={{ minWidth: 0, flex: 1, textAlign: "start" }} onClick={() => setOpen(on ? "" : a.item_key)} aria-expanded={on}>
              <b>{a.title}{a.project_title && a.project_title !== a.title ? <span className="faint"> · {a.project_title}</span> : null}</b>
              <small>{why.slice(0, on ? 99 : 2).join(" · ")}</small>
              {on && <small className="faint">{T(L("Attention score {s} = ", "Оценка внимания {s} = ", "Оцінка уваги {s} = ", "درجة الانتباه {s} = "), { s: a.attention_score })}{(a.why?.parts || []).map((p: any) => `${p.code === "severity" ? T(SEVERITY[a.severity]) : say(ATTENTION_PART[p.code], lang, { n: Math.abs(p.n ?? 0) })} +${p.points}`).join(", ")}{name(a.owner_id) ? ` · ${T(L("Responsible", "Ответственный", "Відповідальний", "المسؤول"))}: ${name(a.owner_id)}` : ""}</small>}
            </button>
            <span className={`chip ${lab === "high" ? "c-bad" : lab === "medium" ? "c-warn" : "c-info"}`}>{T(lab === "high" ? L("High", "Высокий", "Високий", "مرتفع") : lab === "medium" ? L("Medium", "Средний", "Середній", "متوسط") : L("Low", "Низкий", "Низький", "منخفض"))}</span>
            <Link className="btn sm" href={actionHref(a.next_action, a.link)}>{T(NEXT_ACTION[a.next_action] || L("Open", "Открыть", "Відкрити", "فتح"))}</Link>
          </div>; })}
        </Card></div>

        <Card icon="pie" title={L("Portfolio health", "Состояние портфеля", "Стан портфеля", "صحة المحفظة")} empty={L("No active projects.", "Нет активных проектов.", "Немає активних проєктів.", "لا مشاريع نشطة.")}>
          <div className="lvl-grid">{(["healthy", "attention", "risk", "critical"] as Level[]).map((k) => <Link key={k} href={`/portfolio?tab=${k}`} className={`lvl-tile ${lvlChip(k)}`}><b className="mono">{ph[k] ?? 0}</b><small>{T(LEVELS[k])}</small></Link>)}</div>
          {(ov.projects || []).filter((p: any) => ["critical", "risk"].includes(p.level)).slice(0, 4).map((p: any) => <Link key={p.id} href={`/projects/${p.id}`} className="hub-row"><span style={{ minWidth: 0 }}><b>{p.title}</b><small>{(p.reasons || []).slice(0, 2).map((r: any) => healthReason(r, lang)).join(" · ")}</small></span><LevelChip level={p.level} score={p.score} /></Link>)}
        </Card>

        <Card icon="sun" title={L("Today", "Сегодня", "Сьогодні", "اليوم")} n={(ov.today || []).length} empty={L("Nothing due today.", "На сегодня ничего.", "На сьогодні нічого.", "لا شيء مستحق اليوم.")}>
          {(ov.today || []).map((d: any) => <Link key={d.kind + d.record_id} href={d.link} className="hub-row"><span style={{ minWidth: 0 }}><b>{d.title}</b><small>{T(DEADLINE_KIND[d.kind])}{d.project_title ? ` · ${d.project_title}` : ""}</small></span><span className={`chip ${d.days < 0 ? "c-bad" : "c-warn"}`}>{rel(d.days)}</span></Link>)}
        </Card>

        <Card icon="clock" title={L("Waiting for", "Ждём", "Чекаємо", "بانتظار")} n={(ov.waiting || []).length} more={() => setTab("waiting")} empty={L("You are not waiting for anyone.", "Вы ни от кого не ждёте.", "Ви ні від кого не чекаєте.", "لا تنتظر أحدًا.")}>
          {(ov.waiting || []).slice(0, 6).map((w: any) => <Link key={w.item_key} href={w.link} className="hub-row"><span style={{ minWidth: 0 }}><b>{w.party_name || "—"}</b><small>{w.title}{w.project_title ? ` · ${w.project_title}` : ""} · {T(L("{n} d", "{n} дн.", "{n} дн.", "{n} يوم"), { n: w.age_days })}</small></span><span className={`chip ${w.escalation === "overdue" || w.escalation === "escalated" ? "c-bad" : w.escalation === "none" ? "c-info" : "c-warn"}`}>{T(ESCALATION[w.escalation])}</span></Link>)}
        </Card>

        <Card icon="stamp" title={L("Decisions", "Решения", "Рішення", "القرارات")} n={(ov.decisions || []).length} more={() => setView({ kind: "loops", filter: (l) => l.category === "decision", title: L("Decisions waiting", "Решения ждут", "Рішення чекають", "قرارات معلقة") })} empty={L("No decisions waiting.", "Решений не ждут.", "Рішень не чекають.", "لا قرارات معلقة.")}>
          {(ov.decisions || []).map((l: any) => <Link key={l.loop_key} href={l.link} className="hub-row"><span style={{ minWidth: 0 }}><b>{l.title}</b><small>{loopText(l, lang)}{l.project_title ? ` · ${l.project_title}` : ""}</small></span><span className={`chip ${l.severity === "high" ? "c-bad" : "c-warn"}`}>{T(L("{n} d", "{n} дн.", "{n} дн.", "{n} يوم"), { n: l.age_days })}</span></Link>)}
        </Card>

        <Card icon="calendar" title={L("Deadlines", "Сроки", "Терміни", "المواعيد")} n={(ov.deadlines || []).length} more={() => setView({ kind: "deadlines", days: 30, title: L("Deadlines — next 30 days", "Сроки — 30 дней", "Терміни — 30 днів", "المواعيد — 30 يومًا") })} empty={L("No milestones or deadlines in 30 days.", "Нет вех и сроков на 30 дней.", "Немає віх і термінів на 30 днів.", "لا مراحل ولا مواعيد خلال 30 يومًا.")}>
          {(ov.deadlines || []).map((d: any) => <Link key={d.kind + d.record_id} href={d.link} className="hub-row"><span style={{ minWidth: 0 }}><b>{d.title}</b><small>{T(DEADLINE_KIND[d.kind])}{d.project_title && d.kind !== "project" ? ` · ${d.project_title}` : ""} · {d.due}</small></span><span className={`chip ${d.days <= 3 ? "c-warn" : "c-info"}`}>{rel(d.days)}</span></Link>)}
        </Card>
      </div>

      <section className="card" id="exec-tabs">
        <nav className="seg" style={{ margin: "12px 16px 8px", flexWrap: "wrap" }}>
          {([["loops", L("Open loops", "Открытые вопросы", "Відкриті питання", "الحلقات المفتوحة")], ["waiting", L("Waiting for", "Ждём", "Чекаємо", "بانتظار")], ["changes", L("What changed", "Что изменилось", "Що змінилося", "ما الذي تغير")],
            ["reports", L("Reports & review", "Отчёты и обзор", "Звіти та огляд", "التقارير والمراجعة")], ["alerts", L("Alerts", "Оповещения", "Сповіщення", "التنبيهات")], ...(["owner", "management"].includes(me.role) ? [["settings", L("Settings", "Настройки", "Налаштування", "الإعدادات")]] : [])] as [Tab, T4][])
            .map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{T(l)}</button>)}
        </nav>
        <div style={{ padding: "0 8px 12px" }}>
          {tab === "loops" && (!loops ? <div className="empty">…</div> : <LoopsByCategory rows={loops} name={name} />)}
          {tab === "waiting" && <WaitingFor />}
          {tab === "changes" && <Changes />}
          {tab === "reports" && <Reports overview={ov} name={name} />}
          {tab === "alerts" && <Alerts />}
          {tab === "settings" && ["owner", "management"].includes(me.role) && <Settings onSaved={() => { toast(T(L("Saved — numbers recalculated", "Сохранено — пересчитано", "Збережено — перераховано", "حُفظ — أعيد الحساب"))); refresh(); }} />}
        </div>
      </section>
    </div>
  );
}

export function LoopList({ rows, name }: { rows: any[]; name: (id?: string | null) => string }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  if (!rows.length) return <div className="empty" style={{ padding: 16 }}>{T(L("Nothing here.", "Здесь пусто.", "Тут порожньо.", "لا شيء هنا."))}</div>;
  return <>{rows.slice(0, 200).map((l) => <div key={l.loop_key} className="hub-row">
    <span className={`chip ${l.severity === "critical" || l.severity === "high" ? "c-bad" : l.severity === "medium" ? "c-warn" : "c-info"}`}>{T(SEVERITY[l.severity])}</span>
    <Link href={l.link} style={{ minWidth: 0, flex: 1, color: "inherit", textDecoration: "none" }}><b>{l.title}</b>
      <small>{loopText(l, lang)}{l.project_title && l.project_title !== l.title ? ` · ${l.project_title}` : ""}{name(l.owner_id) ? ` · ${name(l.owner_id)}` : ""} · {T(L("{n} d", "{n} дн.", "{n} дн.", "{n} يوم"), { n: l.age_days })}</small></Link>
    <Link className="btn ghost sm" href={actionHref(l.next_action, l.link)}>{T(NEXT_ACTION[l.next_action] || L("Open", "Открыть", "Відкрити", "فتح"))}</Link></div>)}
    {rows.length > 200 && <div className="faint" style={{ padding: 8 }}>+{rows.length - 200}</div>}</>;
}
function LoopsByCategory({ rows, name }: { rows: any[]; name: (id?: string | null) => string }) {
  const { lang } = useApp(); const [cat, setCat] = useState("");
  const cats = Object.keys(LOOP_CATS).map((k) => [k, rows.filter((r) => r.category === k).length] as const);
  return <><div className="chipbar" style={{ margin: "4px 8px 10px" }}><button className={!cat ? "on" : ""} onClick={() => setCat("")}>{say(L("All", "Все", "Усі", "الكل"), lang)} {rows.length}</button>
    {cats.map(([k, n]) => <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(k)} disabled={!n}>{say(LOOP_CATS[k], lang)} {n}</button>)}</div>
    <LoopList rows={rows.filter((r) => !cat || r.category === cat)} name={name} /></>;
}
export function DeadlineList({ rows, name }: { rows: any[]; name: (id?: string | null) => string }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  if (!rows.length) return <div className="empty" style={{ padding: 16 }}>{T(L("Nothing here.", "Здесь пусто.", "Тут порожньо.", "لا شيء هنا."))}</div>;
  return <>{rows.map((d) => <Link key={d.kind + d.record_id} href={d.link} className="hub-row"><span style={{ minWidth: 0 }}><b>{d.title}</b><small>{T(DEADLINE_KIND[d.kind])}{d.project_title && d.kind !== "project" ? ` · ${d.project_title}` : ""}{name(d.owner_id) ? ` · ${name(d.owner_id)}` : ""}{d.priority ? ` · ${d.priority}` : ""}</small></span><span className={`chip ${d.days < 0 ? "c-bad" : d.days <= 3 ? "c-warn" : "c-info"}`}>{d.due}</span></Link>)}</>;
}

/** Waiting For — every item is a real task, approval, review or decision; actions: open, remind, escalate, reassign / resolve (in the record). */
export function WaitingFor({ compact }: { compact?: boolean }) {
  const { lang, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [rows, setRows] = useState<any[] | null>(null); const [busy, setBusy] = useState("");
  const load = () => mgmt.waiting().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const act = async (w: any, kind: "remind" | "escalate") => {
    setBusy(w.item_key + kind);
    try { const r = kind === "remind" ? await mgmt.remind(w.record_id, w.approval_id) : await mgmt.escalate(w.record_id, w.approval_id);
      toast(r?.ok ? T(kind === "remind" ? L("Reminder sent", "Напоминание отправлено", "Нагадування надіслано", "أُرسل التذكير") : L("Escalated", "Эскалировано", "Ескальовано", "تم التصعيد")) : T(L("Already done in the last day", "Уже сделано за последние сутки", "Уже зроблено за останню добу", "تم بالفعل خلال اليوم الأخير")), !r?.ok);
      if (kind === "escalate") load();
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };
  if (!rows) return <div className="empty">…</div>;
  const groups = (["me", "team", "others", "external"] as const).map((b) => [b, rows.filter((r) => r.bucket === b)] as const).filter(([, l]) => l.length || !compact);
  return <div style={{ display: "grid", gap: 12 }}>{groups.map(([b, list]) => <div key={b}>
    <div className="eyebrow" style={{ padding: "6px 8px 2px" }}>{T(WAIT_BUCKET[b])} · {list.length}</div>
    {!list.length ? <div className="faint" style={{ padding: "4px 8px" }}>—</div> : list.slice(0, compact ? 5 : 100).map((w) => <div key={w.item_key} className="hub-row">
      <Link href={w.link} style={{ minWidth: 0, flex: 1, color: "inherit", textDecoration: "none" }}><b>{b === "me" ? w.title : `${w.party_name || "—"} · ${w.title}`}</b>
        <small>{T(WAIT_KIND[w.kind])}{w.project_title ? ` · ${w.project_title}` : ""}{w.due ? ` · ${T(L("due", "срок", "термін", "الموعد"))} ${w.due}` : ""} · {T(L("waiting {n} d", "ждём {n} дн.", "чекаємо {n} дн.", "ننتظر {n} يوم"), { n: w.age_days })} · {w.state}{w.last_activity ? ` · ${T(L("last activity", "последняя активность", "остання активність", "آخر نشاط"))} ${String(w.last_activity).slice(0, 10)}` : ""}</small></Link>
      <span className={`chip ${w.escalation === "overdue" || w.escalation === "escalated" ? "c-bad" : w.escalation === "none" ? "c-info" : "c-warn"}`}>{T(ESCALATION[w.escalation])}</span>
      {b !== "me" && <><button className="btn ghost sm" disabled={!!busy} onClick={() => act(w, "remind")} title={T(L("Remind", "Напомнить", "Нагадати", "تذكير"))}><Icon n="bell" />{compact ? null : T(L("Remind", "Напомнить", "Нагадати", "تذكير"))}</button>
        {!compact && <button className="btn ghost sm" disabled={!!busy} onClick={() => act(w, "escalate")}><Icon n="alert" />{T(L("Escalate", "Эскалировать", "Ескалювати", "تصعيد"))}</button>}
        {!compact && w.kind === "task" && <Link className="btn ghost sm" href={w.link}>{T(L("Reassign / resolve", "Переназначить / закрыть", "Перепризначити / закрити", "إعادة إسناد / إغلاق"))}</Link>}</>}
      {b === "me" && w.kind === "approval" && <Link className="btn sm" href="/decide">{T(L("Decide", "Решить", "Вирішити", "قرّر"))}</Link>}
    </div>)}</div>)}</div>;
}

function Changes() {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [w, setW] = useState<"day" | "week" | "review">("day"); const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { setRows(null); mgmt.changes(w).then(setRows).catch(() => setRows([])); }, [w]);
  const byProject = useMemo(() => { const m = new Map<string, any[]>(); for (const c of rows || []) { const k = c.project_title || c.title; m.set(k, [...(m.get(k) || []), c]); } return [...m.entries()]; }, [rows]);
  return <><nav className="seg" style={{ margin: "4px 8px 10px" }}>{([["day", L("Since yesterday", "Со вчера", "Від учора", "منذ الأمس")], ["week", L("Last 7 days", "За 7 дней", "За 7 днів", "آخر 7 أيام")], ["review", L("Since last review", "С прошлого обзора", "З попереднього огляду", "منذ آخر مراجعة")]] as const).map(([k, l]) => <button key={k} className={w === k ? "on" : ""} onClick={() => setW(k)}>{T(l)}</button>)}</nav>
    {!rows ? <div className="empty">…</div> : !rows.length ? <div className="empty" style={{ padding: 16 }}>{T(L("No meaningful changes.", "Значимых изменений нет.", "Значущих змін немає.", "لا تغييرات مهمة."))}</div>
      : byProject.map(([p, list]) => <div key={p}><div className="eyebrow" style={{ padding: "8px 8px 2px" }}>{p}</div>
        {list.map((c) => <Link key={c.change_key} href={c.link} className="hub-row"><span style={{ minWidth: 0 }}><b>{changeText(c, lang)}</b><small>{c.title !== p ? `${c.title} · ` : ""}{String(c.at).slice(0, 16).replace("T", " ")} · {c.source === "snapshot" ? T(L("compared with the review snapshot", "по сравнению со снимком обзора", "порівняно зі знімком огляду", "مقارنة بلقطة المراجعة")) : c.source === "due_date" ? T(L("from the due date", "по сроку", "за терміном", "من الموعد")) : T(L("history", "история", "історія", "السجل"))}</small></span></Link>)}</div>)}</>;
}

function Reports({ overview, name }: { overview: any; name: (id?: string | null) => string }) {
  const { lang, me, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [busy, setBusy] = useState(""); const [packet, setPacket] = useState<string>(""); const [rev, setRev] = useState<any>(null);
  const today = new Date().toISOString().slice(0, 10);
  const dl = (txt: string, file: string) => saveBlob(file, "\uFEFF" + txt, "text/csv;charset=utf-8");
  const run = async (k: string, f: () => Promise<void>) => { setBusy(k); try { await f(); } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); } };
  const portfolio = () => run("p", async () => { const [h, pf] = await Promise.all([mgmt.health(), mgmt.portfolio()]); const pn = new Map<string, string>(); for (const p of pf) if (p.portfolio_id) pn.set(p.portfolio_id, p.name);
    dl(portfolioCsv(h.filter((x) => x.level !== "closed").map((x) => ({ ...x, portfolio_name: x.portfolio_id ? pn.get(x.portfolio_id) || "" : "" })), name, lang), `portfolio-status-${today}.csv`); });
  const people = () => run("w", async () => dl(workloadCsv(await mgmt.team()), `people-workload-${today}.csv`));
  const deadlines = () => run("d", async () => dl(deadlinesCsv(await mgmt.deadlines(30), lang), `deadlines-${today}.csv`));
  const decisions = () => run("x", async () => dl(decisionsCsv(await mgmt.decisions()), `decisions-${today}.csv`));
  const review = () => run("r", async () => {
    const [health, attention, loops, waiting, deadlines, changes] = await Promise.all([mgmt.health(), mgmt.attention(50), mgmt.loops(), mgmt.waiting(), mgmt.deadlines(30), mgmt.changes("review")]);
    const r = weeklyReview({ overview, health, attention, loops, waiting, deadlines, changes, sinceLabel: "" }, lang); setRev(r);
    setPacket(reviewText(r, `${T(L("Weekly Management Review", "Еженедельный обзор руководства", "Щотижневий огляд керівництва", "المراجعة الإدارية الأسبوعية"))} — ${today} — ${me.full_name || me.email}`));
  });
  const close = () => run("s", async () => { await mgmt.snapshot("review", `Review ${today}`); toast(T(L("Review saved — the next “since last review” starts now", "Обзор сохранён — «с прошлого обзора» начнётся отсюда", "Огляд збережено — «з попереднього огляду» почнеться звідси", "حُفظت المراجعة"))); });
  const B = ({ k, on, icon, l }: { k: string; on: () => void; icon: string; l: T4 }) => <button className="btn sm" disabled={!!busy} onClick={on}><Icon n={icon} />{busy === k ? "…" : T(l)}</button>;
  return <div style={{ display: "grid", gap: 12, padding: "4px 8px" }}>
    <p className="faint" style={{ margin: 0 }}>{T(L("Every report is built from the records you can open. Workload shows counts only — it is not a measure of anyone's performance.", "Каждый отчёт строится из доступных вам записей. Нагрузка — только количества, это не оценка работы человека.", "Кожен звіт будується з доступних вам записів. Навантаження — лише кількості, це не оцінка роботи людини.", "كل تقرير مبني من السجلات المتاحة لك. العبء يظهر أعدادًا فقط وليس تقييمًا لأداء أحد."))}</p>
    <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
      <B k="p" on={portfolio} icon="download" l={L("Portfolio status (CSV)", "Статус портфеля (CSV)", "Статус портфеля (CSV)", "حالة المحفظة (CSV)")} />
      <B k="w" on={people} icon="download" l={L("People / workload (CSV)", "Люди / нагрузка (CSV)", "Люди / навантаження (CSV)", "الأشخاص / العبء (CSV)")} />
      <B k="d" on={deadlines} icon="download" l={L("Deadlines (CSV)", "Сроки (CSV)", "Терміни (CSV)", "المواعيد (CSV)")} />
      <B k="x" on={decisions} icon="download" l={L("Decisions (CSV)", "Решения (CSV)", "Рішення (CSV)", "القرارات (CSV)")} />
      <span className="faint">{T(L("Project status report: open a project → Project Advisor → Print.", "Отчёт по проекту: откройте проект → Советник → Печать.", "Звіт щодо проєкту: відкрийте проєкт → Порадник → Друк.", "تقرير المشروع: افتح المشروع ← المستشار ← طباعة."))}</span>
    </div>
    <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
      <B k="r" on={review} icon="clipboard" l={L("Prepare the Weekly Management Review", "Собрать еженедельный обзор", "Зібрати щотижневий огляд", "إعداد المراجعة الأسبوعية")} />
      {packet && <><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(packet).then(() => toast(T(L("Copied", "Скопировано", "Скопійовано", "نُسخ")))).catch(() => {}); }}><Icon n="copy" />{T(L("Copy", "Копировать", "Копіювати", "نسخ"))}</button>
        <button className="btn ghost sm" onClick={() => saveBlob(`management-review-${today}.txt`, packet, "text/plain;charset=utf-8")}><Icon n="download" />TXT</button>
        <button className="btn ghost sm" onClick={() => window.print()}><Icon n="print" />{T(L("Print", "Печать", "Друк", "طباعة"))}</button>
        <B k="s" on={close} icon="check" l={L("Mark this review as held", "Отметить обзор проведённым", "Позначити огляд проведеним", "تسجيل المراجعة")} /></>}
    </div>
    {rev && <article className="review-packet print-area">{rev.sections.map((s: any) => <section key={s.key}><h3>{s.title}</h3><ul>{s.lines.map((l: any, i: number) => <li key={i}>{l.link ? <Link href={l.link}>{l.text}</Link> : l.text}</li>)}</ul></section>)}</article>}
  </div>;
}

function Alerts() {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v); const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { mgmt.alerts().then(setRows).catch(() => setRows([])); }, []);
  const K: Record<string, T4> = { project_critical: L("Project became critical", "Проект стал критичным", "Проєкт став критичним", "أصبح المشروع حرجًا"), milestone_overdue: L("Milestone overdue", "Веха просрочена", "Віха прострочена", "مرحلة متأخرة"),
    critical_blocker: L("Critical blocker", "Критичная блокировка", "Критичне блокування", "عائق حرج"), approval_sla: L("Approval over its time limit", "Согласование дольше срока", "Погодження довше терміну", "موافقة تجاوزت مهلتها"),
    decision_sla: L("Decision over its time limit", "Решение дольше срока", "Рішення довше терміну", "قرار تجاوز مهلته"), project_no_owner: L("Project has no owner", "У проекта нет руководителя", "Проєкт без керівника", "مشروع بلا مالك"), critical_task_overdue: L("Critical task overdue", "Критичная задача просрочена", "Критична задача прострочена", "مهمة حرجة متأخرة") };
  if (!rows) return <div className="empty">…</div>;
  return <><p className="faint" style={{ margin: "4px 8px 8px" }}>{T(L("One alert per condition. While it stays true nothing more is sent; when it clears the alert closes by itself.", "Одно оповещение на условие. Пока условие держится, повторов нет; когда оно уходит, оповещение закрывается само.", "Одне сповіщення на умову. Поки умова триває, повторів немає; коли вона зникає, сповіщення закривається само.", "تنبيه واحد لكل حالة؛ لا تكرار أثناء استمرارها، ويُغلق تلقائيًا عند زوالها."))}</p>
    {!rows.length ? <div className="empty" style={{ padding: 16 }}>{T(L("No open alerts.", "Открытых оповещений нет.", "Відкритих сповіщень немає.", "لا تنبيهات مفتوحة."))}</div>
      : rows.map((a) => <Link key={a.id} href={a.record_id ? (a.kind === "project_critical" || a.kind === "project_no_owner" ? `/projects/${a.record_id}` : `/company/${a.kind.includes("milestone") ? "milestones" : a.kind.includes("decision") ? "decisions" : "tasks"}?r=${a.record_id}`) : "#"} className="hub-row">
        <span style={{ minWidth: 0 }}><b>{a.title}</b><small>{T(K[a.kind] || L(a.kind, a.kind, a.kind, a.kind))} · {T(L("since", "с", "з", "منذ"))} {String(a.opened_at).slice(0, 10)}{a.times_opened > 1 ? ` · ×${a.times_opened}` : ""}</small></span><span className={`chip ${a.severity === "critical" ? "c-bad" : "c-warn"}`}>{T(SEVERITY[a.severity] || SEVERITY.high)}</span></Link>)}</>;
}

/** Thresholds and weights — company-wide; owners and management only (the database checks it and keeps every change). */
function Settings({ onSaved }: { onSaved: () => void }) {
  const { lang, people, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [cfg, setCfg] = useState<any>(null); const [hist, setHist] = useState<any[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { mgmt.config().then(setCfg).catch(() => {}); mgmt.settingsHistory().then(setHist).catch(() => {}); }, []);
  if (!cfg) return <div className="empty">…</div>;
  const F: [string, T4][] = [["stale_days", L("Project is stale after (days without activity)", "Проект «застоял» после (дней без активности)", "Проєкт «застояний» після (днів без активності)", "المشروع راكد بعد (أيام بلا نشاط)")],
    ["task_stale_days", L("Task unchanged after (days)", "Задача без изменений после (дней)", "Задача без змін після (днів)", "مهمة بلا تغيير بعد (أيام)")],
    ["approval_age_days", L("Approval waits too long after (days)", "Согласование ждёт слишком долго после (дней)", "Погодження чекає задовго після (днів)", "الموافقة متأخرة بعد (أيام)")],
    ["decision_age_days", L("Decision waits too long after (days)", "Решение ждёт слишком долго после (дней)", "Рішення чекає задовго після (днів)", "القرار متأخر بعد (أيام)")],
    ["review_age_days", L("Review waits too long after (days)", "Проверка ждёт слишком долго после (дней)", "Перевірка чекає задовго після (днів)", "المراجعة متأخرة بعد (أيام)")],
    ["deadline_warn_days", L("Warn before a project deadline (days)", "Предупреждать до срока проекта (дней)", "Попереджати до терміну проєкту (днів)", "التحذير قبل موعد المشروع (أيام)")],
    ["milestone_warn_days", L("Warn before a milestone (days)", "Предупреждать до вехи (дней)", "Попереджати до віхи (днів)", "التحذير قبل المرحلة (أيام)")],
    ["insufficient_progress_pct", L("Near the deadline, progress below (%) is a risk", "Близко к сроку прогресс ниже (%) — риск", "Близько до терміну прогрес нижче (%) — ризик", "قرب الموعد، تقدم أقل من (%) خطر")],
    ["overdue_share_pct", L("Overdue share that counts as excessive (%)", "Доля просроченного, считающаяся чрезмерной (%)", "Частка простроченого, що вважається надмірною (%)", "نسبة التأخر المفرطة (%)")],
    ["approval_sla_days", L("Alert: approval older than (days)", "Оповещение: согласование старше (дней)", "Сповіщення: погодження старше (днів)", "تنبيه: موافقة أقدم من (أيام)")],
    ["decision_sla_days", L("Alert: decision older than (days)", "Оповещение: решение старше (дней)", "Сповіщення: рішення старше (днів)", "تنبيه: قرار أقدم من (أيام)")],
    ["alert_cooldown_hours", L("Alert cool-down (hours)", "Пауза между оповещениями (часов)", "Пауза між сповіщеннями (годин)", "فترة تهدئة التنبيه (ساعات)")]];
  const H: [string, T4][] = [["attention", L("Below this score: Attention", "Ниже этой оценки — «Внимание»", "Нижче цієї оцінки — «Увага»", "أقل من هذه الدرجة: انتباه")], ["risk", L("Below this score: Risk", "Ниже — «Риск»", "Нижче — «Ризик»", "أقل: خطر")], ["critical", L("Below this score: Critical", "Ниже — «Критично»", "Нижче — «Критично»", "أقل: حرج")]];
  const num = (v: any) => (v === "" ? "" : Number(v));
  const save = async () => { setBusy(true); try { await mgmt.saveConfig(cfg); onSaved(); mgmt.settingsHistory().then(setHist).catch(() => {}); } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(false); } };
  return <div style={{ display: "grid", gap: 12, padding: "4px 8px" }}>
    <p className="faint" style={{ margin: 0 }}>{T(L("These rules decide health levels, open loops, attention and alerts for the whole company. Every change is kept with who made it.", "Эти правила определяют состояние проектов, открытые вопросы, внимание и оповещения для всей компании. Каждое изменение сохраняется с автором.", "Ці правила визначають стан проєктів, відкриті питання, увагу й сповіщення для всієї компанії. Кожна зміна зберігається з автором.", "هذه القواعد تحدد مستويات الصحة والحلقات المفتوحة والانتباه والتنبيهات للشركة كلها. كل تغيير محفوظ مع صاحبه."))}</p>
    <div className="form-grid">{F.map(([k, l]) => <label key={k} className="field"><span>{T(l)}</span><input className="input" type="number" min={0} value={cfg[k] ?? ""} onChange={(e) => setCfg({ ...cfg, [k]: num(e.target.value) })} /></label>)}
      {H.map(([k, l]) => <label key={k} className="field"><span>{T(l)}</span><input className="input" type="number" min={0} max={100} value={cfg.health?.[k] ?? ""} onChange={(e) => setCfg({ ...cfg, health: { ...cfg.health, [k]: num(e.target.value) } })} /></label>)}
      <label className="field"><span>{T(L("Attention: show items scoring at least", "Внимание: показывать с оценкой от", "Увага: показувати з оцінкою від", "الانتباه: عرض العناصر بدرجة لا تقل عن"))}</span><input className="input" type="number" min={0} value={cfg.attention?.threshold ?? ""} onChange={(e) => setCfg({ ...cfg, attention: { ...cfg.attention, threshold: num(e.target.value) } })} /></label>
      <label className="field"><span>{T(L("Attention: items on the first screen", "Внимание: пунктов на первом экране", "Увага: пунктів на першому екрані", "الانتباه: عناصر الشاشة الأولى"))}</span><input className="input" type="number" min={1} max={20} value={cfg.attention?.max_items ?? ""} onChange={(e) => setCfg({ ...cfg, attention: { ...cfg.attention, max_items: num(e.target.value) } })} /></label></div>
    <details><summary>{T(L("Health penalties (points taken from 100)", "Штрафы здоровья (баллы из 100)", "Штрафи стану (бали зі 100)", "عقوبات الصحة (نقاط من 100)"))}</summary>
      <div className="form-grid">{Object.keys(cfg.weights || {}).map((k) => <label key={k} className="field"><span className="mono">{k}</span><input className="input" type="number" min={0} max={100} value={cfg.weights[k]} onChange={(e) => setCfg({ ...cfg, weights: { ...cfg.weights, [k]: num(e.target.value) } })} /></label>)}</div></details>
    <div className="toolbar"><button className="btn primary sm" disabled={busy} onClick={save}><Icon n="check" />{T(L("Save", "Сохранить", "Зберегти", "حفظ"))}</button></div>
    {hist.length > 0 && <details><summary>{T(L("Change history", "История изменений", "Історія змін", "سجل التغييرات"))} · {hist.length}</summary>
      {hist.map((h) => { const diff = Object.keys(h.after || {}).filter((k) => JSON.stringify(h.after[k]) !== JSON.stringify(h.before?.[k])); return <div key={h.id} className="hub-row"><span><b>{String(h.changed_at).slice(0, 16).replace("T", " ")} · {people.find((p) => p.id === h.changed_by)?.full_name || "—"}</b><small className="mono">{diff.map((k) => `${k}: ${JSON.stringify(h.before?.[k])} → ${JSON.stringify(h.after[k])}`).join("; ") || "—"}</small></span></div>; })}</details>}
  </div>;
}
