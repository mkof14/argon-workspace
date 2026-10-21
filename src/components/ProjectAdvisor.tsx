"use client";
// PROJECT ADVISOR (Phase 5). Layer 1: facts from the database engines for this viewer — health and its reasons,
// open loops with the next action, what the project waits for, deadlines, recent meaningful changes; every line
// opens its record. Layer 2: the Assistant explains these facts, retrieving them again on the server (the browser
// sends only the project id), and cites each claim.
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { mgmt } from "@/lib/mgmtApi";
import { DEADLINE_KIND, ESCALATION, NEXT_ACTION, actionHref, changeText, healthReason, loopText, say, type T4 } from "@/lib/mgmt";
import { LevelChip } from "./ExecControl";

const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const BASIS: Record<string, T4> = { tasks: L("completed tasks / tasks", "выполненные задачи / все задачи", "виконані задачі / усі задачі", "المهام المكتملة / كل المهام"), milestones: L("milestones reached / milestones", "достигнутые вехи / все вехи", "досягнуті віхи / усі віхи", "المراحل المنجزة / كل المراحل"), none: L("no tasks or milestones yet", "задач и вех пока нет", "задач і віх поки немає", "لا مهام ولا مراحل بعد") };

/** The record behind a health reason: one record → open it; several → the project's list. */
const refLink = (projectId: string, r: any) => {
  const refs: string[] = Array.isArray(r.refs) ? r.refs.filter(Boolean) : [];
  if (["no_owner", "deadline_passed", "deadline_soon", "stale", "no_open_tasks", "on_hold"].includes(r.code)) return `/projects/${projectId}?tab=overview`;
  if (r.code.startsWith("milestone")) return refs.length === 1 ? `/company/milestones?r=${refs[0]}` : `/projects/${projectId}?tab=milestones`;
  if (r.code === "approvals_waiting") return "/decide";
  if (r.code === "decisions_waiting") return refs.length === 1 ? `/company/decisions?r=${refs[0]}` : `/decisions`;
  if (r.code === "documents_in_review") return refs.length === 1 ? `/documents?d=${refs[0]}` : `/projects/${projectId}?tab=documents`;
  return refs.length === 1 ? `/company/tasks?r=${refs[0]}` : `/projects/${projectId}?tab=tasks`;
};

export default function ProjectAdvisor({ project }: { project: { id: string; title: string; section: string } & Record<string, any> }) {
  const { lang, people, openAi } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [h, setH] = useState<any>(undefined); const [loops, setLoops] = useState<any[]>([]); const [waiting, setWaiting] = useState<any[]>([]); const [dl, setDl] = useState<any[]>([]); const [ch, setCh] = useState<any[]>([]);
  useEffect(() => {
    let off = false;
    Promise.all([mgmt.health(project.id), mgmt.loops(project.id), mgmt.waiting(), mgmt.deadlines(30), mgmt.changes("week")]).then(([hh, l, w, d, c]) => {
      if (off) return; setH(hh[0] || null); setLoops(l); setWaiting(w.filter((x: any) => x.project_id === project.id)); setDl(d.filter((x: any) => x.project_id === project.id)); setCh(c.filter((x: any) => x.project_id === project.id));
    }).catch(() => !off && setH(null));
    return () => { off = true; };
  }, [project.id]);
  const name = (id?: string | null) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.email : ""; };
  if (h === undefined) return <section className="card empty">…</section>;
  if (!h) return <section className="card empty">{T(L("No health data for this project.", "Нет данных о состоянии проекта.", "Немає даних про стан проєкту.", "لا بيانات صحة لهذا المشروع."))}</section>;
  const actions = [...new Map(loops.filter((l) => l.severity !== "low").map((l) => [l.next_action, l])).values()].slice(0, 5);
  const ask = T(L("Project Advisor: what is happening with this project and what is blocking it? Use only the facts you are given, cite each one, then list the suggested management actions.", "Советник проекта: что происходит с этим проектом и что его блокирует? Используйте только данные факты, ссылайтесь на каждый, затем перечислите предлагаемые действия руководства.", "Порадник проєкту: що відбувається з цим проєктом і що його блокує? Використовуйте лише надані факти, посилайтеся на кожен, потім перелічіть запропоновані дії керівництва.", "مستشار المشروع: ما الذي يحدث في هذا المشروع وما الذي يعيقه؟ استخدم الحقائق المعطاة فقط واستشهد بكل منها، ثم اذكر الإجراءات الإدارية المقترحة."));
  return <section className="card advisor print-area" data-advisor={h.level}>
    <div className="card-h" style={{ flexWrap: "wrap", gap: 8 }}><h2><Icon n="spark" />{T(L("Project Advisor", "Советник проекта", "Порадник проєкту", "مستشار المشروع"))}</h2><LevelChip level={h.level} score={h.score} />
      <span className="faint" style={{ fontSize: 13 }}>{T(L("Progress {p}% — {b}", "Прогресс {p}% — {b}", "Прогрес {p}% — {b}", "التقدم {p}% — {b}"), { p: h.progress ?? "—", b: T(BASIS[h.progress_basis] || BASIS.none) })}</span>
      <span className="toolbar" style={{ marginInlineStart: "auto", gap: 6 }}>
        <button className="btn sm" onClick={() => openAi({ title: project.title, section: "company.projects", record: project as any, rows: [], ask })}><Icon n="spark" />{T(L("Explain with Assistant", "Объяснить с Ассистентом", "Пояснити з Асистентом", "اشرح مع المساعد"))}</button>
        <button className="btn ghost sm" onClick={() => window.print()}><Icon n="print" />{T(L("Print status report", "Печать отчёта", "Друк звіту", "طباعة التقرير"))}</button></span></div>
    <div className="hub-grid" style={{ padding: "0 8px 8px" }}>
      <div><div className="eyebrow" style={{ padding: "6px 8px" }}>{T(L("Why this level", "Почему такой уровень", "Чому такий рівень", "لماذا هذا المستوى"))}</div>
        {(h.reasons || []).length ? h.reasons.map((r: any) => <Link key={r.code} href={refLink(h.project_id, r)} className="hub-row"><span style={{ minWidth: 0 }}><b>{healthReason(r, lang)}</b></span><small className="mono faint">−{r.penalty}</small></Link>)
          : <div className="faint" style={{ padding: "4px 8px" }}>{T(L("No issues found in the records you can open.", "В доступных вам записях проблем нет.", "У доступних вам записах проблем немає.", "لا مشكلات في السجلات المتاحة لك."))}</div>}
        <div className="faint" style={{ padding: "6px 8px", fontSize: 13 }}>{T(L("Tasks {t} · open {o} · done {d} · overdue {od} · blocked {b} · without owner {u} · approvals {a} · decisions {de} · documents in review {dr}", "Задач {t} · открыто {o} · выполнено {d} · просрочено {od} · заблокировано {b} · без исполнителя {u} · согласований {a} · решений {de} · документов на проверке {dr}", "Задач {t} · відкрито {o} · виконано {d} · прострочено {od} · заблоковано {b} · без виконавця {u} · погоджень {a} · рішень {de} · документів на перевірці {dr}", "مهام {t} · مفتوحة {o} · منجزة {d} · متأخرة {od} · معطلة {b} · بلا مسؤول {u} · موافقات {a} · قرارات {de} · مستندات قيد المراجعة {dr}"),
          { t: h.tasks_total, o: h.tasks_open, d: h.tasks_done, od: h.overdue, b: h.blocked, u: h.unassigned, a: h.pending_approvals, de: h.pending_decisions, dr: h.docs_in_review })}{h.last_activity ? ` · ${T(L("last activity", "последняя активность", "остання активність", "آخر نشاط"))} ${String(h.last_activity).slice(0, 10)}` : ""}</div></div>
      <div><div className="eyebrow" style={{ padding: "6px 8px" }}>{T(L("Needs attention", "Требует внимания", "Потребує уваги", "يحتاج انتباهًا"))} · {loops.length}</div>
        {loops.slice(0, 8).map((l) => <div key={l.loop_key} className="hub-row"><Link href={l.link} style={{ minWidth: 0, flex: 1, color: "inherit", textDecoration: "none" }}><b>{l.title}</b><small>{loopText(l, lang)}{name(l.owner_id) ? ` · ${name(l.owner_id)}` : ""}{l.reason?.blocker ? ` · ${l.reason.blocker}` : ""}</small></Link>
          <Link className="btn ghost sm" href={actionHref(l.next_action, l.link)}>{T(NEXT_ACTION[l.next_action] || L("Open", "Открыть", "Відкрити", "فتح"))}</Link></div>)}
        {!loops.length && <div className="faint" style={{ padding: "4px 8px" }}>—</div>}</div>
      <div><div className="eyebrow" style={{ padding: "6px 8px" }}>{T(L("Suggested management actions", "Предлагаемые действия", "Запропоновані дії", "الإجراءات المقترحة"))}</div>
        {actions.length ? <ol style={{ margin: "0 8px", paddingInlineStart: 18, display: "grid", gap: 4 }}>{actions.map((l) => <li key={l.next_action}><Link href={actionHref(l.next_action, l.link)}>{T(NEXT_ACTION[l.next_action] || L(l.next_action, l.next_action, l.next_action, l.next_action))}</Link> <small className="faint">— {l.title}</small></li>)}</ol>
          : <div className="faint" style={{ padding: "4px 8px" }}>—</div>}</div>
      <div><div className="eyebrow" style={{ padding: "6px 8px" }}>{T(L("Waiting for", "Ждём", "Чекаємо", "بانتظار"))} · {waiting.length}</div>
        {waiting.slice(0, 6).map((w) => <Link key={w.item_key} href={w.link} className="hub-row"><span style={{ minWidth: 0 }}><b>{w.party_name || "—"}</b><small>{w.title} · {w.age_days} d</small></span><span className="chip">{T(ESCALATION[w.escalation])}</span></Link>)}
        {!waiting.length && <div className="faint" style={{ padding: "4px 8px" }}>—</div>}</div>
      <div><div className="eyebrow" style={{ padding: "6px 8px" }}>{T(L("Deadlines (30 days)", "Сроки (30 дней)", "Терміни (30 днів)", "المواعيد (30 يومًا)"))} · {dl.length}</div>
        {dl.slice(0, 8).map((d) => <Link key={d.kind + d.record_id} href={d.link} className="hub-row"><span style={{ minWidth: 0 }}><b>{d.title}</b><small>{T(DEADLINE_KIND[d.kind])} · {d.due}</small></span><span className={`chip ${d.days < 0 ? "c-bad" : d.days <= 5 ? "c-warn" : "c-info"}`}>{d.days}</span></Link>)}
        {!dl.length && <div className="faint" style={{ padding: "4px 8px" }}>—</div>}</div>
      <div><div className="eyebrow" style={{ padding: "6px 8px" }}>{T(L("Changed in 7 days", "Изменилось за 7 дней", "Змінилося за 7 днів", "تغير خلال 7 أيام"))} · {ch.length}</div>
        {ch.slice(0, 8).map((c) => <Link key={c.change_key} href={c.link} className="hub-row"><span style={{ minWidth: 0 }}><b>{changeText(c, lang)}</b><small>{c.title} · {String(c.at).slice(0, 10)}</small></span></Link>)}
        {!ch.length && <div className="faint" style={{ padding: "4px 8px" }}>—</div>}</div>
    </div>
  </section>;
}
