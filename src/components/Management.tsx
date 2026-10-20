"use client";
// MANAGEMENT DASHBOARD: the operational condition of the company on one screen, for owners, administrators and
// management. Counts and lists only — no scoring of people. Every number opens the records behind it.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { saveBlob, tone } from "@/lib/format";
import { DEMO, store, type Activity, type Rec } from "@/lib/store";
import { ORG_DEPTS } from "@/config/workspace.config.mjs";
import { useWork } from "./useWork";
import { csv, daysTo, isOpenTask, MS_CLOSED, projectStats, todayIso, workload } from "@/lib/work";
import { deptLabel, personName } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Appr = { id: string; record_id: string; section: string; requested_by: string; approver_id: string; status: string; created_at: string; title: string; age_days: number };
const CAT: Record<string, T4> = { "finance.expenses": L("Financial", "Финансы", "Фінанси", "مالية"), "finance.budget": L("Financial", "Финансы", "Фінанси", "مالية"), "finance.costing": L("Financial", "Финансы", "Фінанси", "مالية"), "hr.compensation": L("Financial", "Финансы", "Фінанси", "مالية"),
  "operations.procurement": L("Procurement", "Закупки", "Закупівлі", "المشتريات"), "legal.contracts": L("Contracts", "Договоры", "Договори", "العقود"), "company.documents": L("Documents", "Документы", "Документи", "المستندات") };
const OTHER = L("Other", "Другое", "Інше", "أخرى");

export default function Management() {
  const { lang, people, access, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const w = useWork(["company.decisions"]); const today = todayIso();
  const [dept, setDept] = useState(""); const [proj, setProj] = useState(""); const [emp, setEmp] = useState(""); const [days, setDays] = useState(30);
  const [appr, setAppr] = useState<Appr[] | null>(null); const [hist, setHist] = useState<Activity[]>([]);
  useEffect(() => { if (DEMO) { setAppr([]); return; } fetch("/api/management", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approvals" }) }).then((r) => (r.ok ? r.json() : [])).then(setAppr).catch(() => setAppr([])); }, [tick]);
  useEffect(() => { store.activity({ limit: 60, since: new Date(Date.now() - days * 864e5).toISOString() }).then(setHist).catch(() => {}); }, [days, tick]);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const deptOf = (r: Rec) => r.data?.department || (r.data?.project_ref ? w.projects.find((p) => p.id === r.data.project_ref)?.data?.department : "") || people.find((p) => p.id === r.data?.assignee_id)?.department || "";
  const tasks = useMemo(() => w.tasks.filter((t) => (!dept || deptOf(t) === dept) && (!proj || t.data?.project_ref === proj) && (!emp || t.data?.assignee_id === emp)), [w.tasks, dept, proj, emp, w.projects, people]); // eslint-disable-line
  const open = tasks.filter(isOpenTask); const overdue = open.filter((t) => (daysTo(t.data?.due, today) ?? 1) < 0);
  const review = open.filter((t) => t.status === "Review");
  const completed = tasks.filter((t) => t.status === "Completed" && String(t.data?.completed_at || t.updated_at || "") >= since.slice(0, 10));
  const projects = w.projects.filter((p) => (!dept || p.data?.department === dept) && (!proj || p.id === proj) && (!emp || p.data?.manager_id === emp || (p.data?.members_ids || []).includes(emp)));
  const active = projects.filter((p) => !["Completed", "Cancelled"].includes(p.status || ""));
  const pstats = active.map((p) => ({ p, s: projectStats(p, w.all || [], today) })).sort((a, b) => ({ late: 0, risk: 1, ok: 2 }[a.s.health] - { late: 0, risk: 1, ok: 2 }[b.s.health]));
  const msUpcoming = w.milestones.filter((m) => !MS_CLOSED.has(m.status || "") && (!proj || m.data?.project_ref === proj) && (daysTo(m.data?.due, today) ?? -1) >= 0 && (daysTo(m.data?.due, today) ?? 99) <= days).sort((a, b) => String(a.data?.due).localeCompare(String(b.data?.due)));
  const msDelayed = w.milestones.filter((m) => !MS_CLOSED.has(m.status || "") && (!proj || m.data?.project_ref === proj) && (daysTo(m.data?.due, today) ?? 1) < 0);
  const decisions = (w.all || []).filter((r) => r.section === "company.decisions" && r.status === "Proposed" && (!proj || r.data?.project_ref === proj));
  const ap = (appr || []).filter((a) => a.status === "pending" && (!emp || a.approver_id === emp || a.requested_by === emp));
  const apDelayed = ap.filter((a) => a.age_days >= 3);
  const wl = workload(tasks, today);
  const byEmp = [...wl.entries()].map(([id, x]) => ({ id, p: people.find((q) => q.id === id), ...x })).sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  const needHelp = byEmp.filter((x) => x.overdue >= 2 || x.open > 8);
  const byDept = (ORG_DEPTS as any[]).map((d) => { const l = open.filter((t) => deptOf(t) === d.key); return { d, open: l.length, overdue: l.filter((t) => (daysTo(t.data?.due, today) ?? 1) < 0).length, review: l.filter((t) => t.status === "Review").length }; }).filter((x) => x.open);
  const apGroups = useMemo(() => { const m = new Map<string, Appr[]>(); for (const a of ap) { const k = T(CAT[a.section] || OTHER); m.set(k, [...(m.get(k) || []), a]); } return [...m.entries()]; }, [ap, lang]); // eslint-disable-line
  const who = (id?: string | null) => personName(people.find((p) => p.id === id)) || "—";
  const rec = (r: { id: string; section: string }) => `/${r.section.replace(".", "/")}?r=${r.id}`;
  const exportCsv = () => saveBlob(`AGRON_management_${today}.csv`, csv([
    ["AGRON Workspace — management summary", today, `filters: dept=${dept || "all"} project=${proj ? w.projects.find((p) => p.id === proj)?.title : "all"} employee=${emp ? who(emp) : "all"} period=${days}d`],
    [], ["Measure", "Value"], ["Active projects", active.length], ["Open tasks", open.length], ["Overdue tasks", overdue.length], ["Awaiting review", review.length], ["Completed in period", completed.length], ["Pending approvals", ap.length], ["Approvals waiting 3+ days", apDelayed.length], ["Proposed decisions", decisions.length], ["Delayed milestones", msDelayed.length],
    [], ["Project", "Status", "Manager", "Progress %", "Open", "Overdue", "Delayed milestones", "Next milestone", "Target"], ...pstats.map(({ p, s }) => [p.title, p.status, who(p.data?.manager_id), s.progress, s.open, s.overdue, s.delayed.length, s.nextMilestone ? `${s.nextMilestone.data?.due} ${s.nextMilestone.title}` : "", p.data?.target || ""]),
    [], ["Employee", "Department", "Open", "Overdue", "Awaiting review", "Due in 7 days"], ...byEmp.map((x) => [x.p ? personName(x.p) : "Not assigned", deptLabel(x.p?.department, "en"), x.open, x.overdue, x.review, x.week]),
    [], ["Approval", "Section", "Requested by", "Approver", "Waiting days"], ...ap.map((a) => [a.title, a.section, who(a.requested_by), who(a.approver_id), a.age_days]),
  ]), "text/csv;charset=utf-8");
  const K = ({ v, l, bad, href }: { v: number; l: T4; bad?: boolean; href?: string }) => { const c = <><b className={`mono ${bad && v ? "neg" : ""}`}>{v}</b><small>{T(l)}</small></>; return href ? <Link href={href} className="kpi mk">{c}</Link> : <div className="kpi mk">{c}</div>; };
  if (w.loading) return <div className="card" style={{ padding: 24 }}>…</div>;
  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#E5484D" }}>
    <section className="card"><div className="filters">
      <select className="input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label={T(L("Department", "Отдел", "Відділ", "القسم"))}><option value="">{T(L("All departments", "Все отделы", "Усі відділи", "كل الأقسام"))}</option>{(ORG_DEPTS as any[]).map((d) => <option key={d.key} value={d.key}>{tx(d.label, lang as Lang)}</option>)}</select>
      <select className="input" value={proj} onChange={(e) => setProj(e.target.value)} aria-label={T(L("Project", "Проект", "Проєкт", "المشروع"))}><option value="">{T(L("All projects", "Все проекты", "Усі проєкти", "كل المشاريع"))}</option>{w.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
      <select className="input" value={emp} onChange={(e) => setEmp(e.target.value)} aria-label={T(L("Employee", "Сотрудник", "Співробітник", "الموظف"))}><option value="">{T(L("Everyone", "Все сотрудники", "Усі співробітники", "الجميع"))}</option>{people.filter((p) => !["partner", "vendor", "investor", "pending"].includes(p.role)).map((p) => <option key={p.id} value={p.id}>{personName(p)}</option>)}</select>
      <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={T(L("Period", "Период", "Період", "الفترة"))}>{[7, 30, 90].map((d) => <option key={d} value={d}>{T(L(`${d} days`, `${d} дней`, `${d} днів`, `${d} يوماً`))}</option>)}</select>
      <span style={{ flex: 1 }} /><button className="btn sm" onClick={exportCsv}><Icon n="download" />{T(L("Export summary (CSV)", "Экспорт сводки (CSV)", "Експорт зведення (CSV)", "تصدير الملخص (CSV)"))}</button></div></section>
    <div className="kpis mkpis">
      <K v={active.length} l={L("Active projects", "Активные проекты", "Активні проєкти", "مشاريع نشطة")} href="/projects" />
      <K v={open.length} l={L("Open tasks", "Открытые задачи", "Відкриті задачі", "مهام مفتوحة")} href="/company/tasks" />
      <K v={overdue.length} bad l={L("Overdue tasks", "Просроченные задачи", "Прострочені задачі", "مهام متأخرة")} href="/company/tasks?view=overdue" />
      <K v={ap.length} l={L("Pending approvals", "Ждут согласования", "Чекають погодження", "موافقات معلقة")} href="/decide" />
      <K v={decisions.length} l={L("Decisions proposed", "Предложены решения", "Запропоновано рішень", "قرارات مقترحة")} href="/company/decisions?st=Proposed" />
      <K v={msDelayed.length} bad l={L("Delayed milestones", "Просроченные вехи", "Прострочені віхи", "مراحل متأخرة")} />
      <K v={review.length} l={L("Awaiting review", "Ждут проверки", "Чекають перевірки", "بانتظار المراجعة")} />
      <K v={completed.length} l={L("Completed in period", "Выполнено за период", "Виконано за період", "أُنجز في الفترة")} />
    </div>
    <div className="hub-grid">
      <div className="card hub-card wide"><div className="card-h"><h2><Icon n="layers" />{T(L("Projects", "Проекты", "Проєкти", "المشاريع"))}</h2></div>
        <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("Project", "Проект", "Проєкт", "المشروع"))}</th><th>{T(L("Status", "Статус", "Статус", "الحالة"))}</th><th>{T(L("Manager", "Руководитель", "Керівник", "المدير"))}</th><th>{T(L("Progress", "Прогресс", "Прогрес", "التقدم"))}</th><th>{T(L("Overdue", "Просрочено", "Прострочено", "متأخر"))}</th><th>{T(L("Next milestone", "Следующая веха", "Наступна віха", "المرحلة التالية"))}</th><th>{T(L("Target", "Срок", "Термін", "الموعد"))}</th></tr></thead>
          <tbody>{pstats.map(({ p, s }) => <tr key={p.id} className="row" onClick={() => (location.href = `/projects/${p.id}`)}><td style={{ fontWeight: 600 }}><Link href={`/projects/${p.id}`}>{p.title}</Link></td><td><span className={`chip ${s.health === "late" ? "c-bad" : s.health === "risk" ? "c-warn" : "c-ok"}`}>{p.status}</span></td><td>{who(p.data?.manager_id)}</td><td className="mono">{s.progress}% <small className="faint">{s.done}/{s.tasks}</small></td><td className={`mono ${s.overdue ? "neg" : ""}`}>{s.overdue}{s.delayed.length ? ` · ${s.delayed.length} ⚑` : ""}</td><td>{s.nextMilestone ? `${s.nextMilestone.data?.due || ""} · ${s.nextMilestone.title}` : "—"}</td><td className={s.late ? "neg" : ""}>{p.data?.target || "—"}</td></tr>)}
            {!pstats.length && <tr><td colSpan={7} className="empty">{T(L("No active projects for these filters.", "Нет активных проектов под эти фильтры.", "Немає активних проєктів під ці фільтри.", "لا مشاريع نشطة لهذه المرشحات."))}</td></tr>}</tbody></table></div></div>
      <div className="card hub-card"><div className="card-h"><h2><Icon n="users" />{T(L("People who may need help", "Кому может понадобиться помощь", "Кому може знадобитися допомога", "من قد يحتاج إلى مساعدة"))}</h2><span className="chip mono" style={{ marginInlineStart: "auto" }}>{needHelp.length}</span></div>
        <div className="feed">{needHelp.length ? needHelp.map((x) => <Link key={x.id} href={x.id === "—" ? "/company/tasks" : `/company/tasks?view=all&q=`} onClick={(e) => { e.preventDefault(); setEmp(x.id === "—" ? "" : x.id); }} className="hub-row"><span><b>{x.p ? personName(x.p) : T(L("Not assigned", "Не назначено", "Не призначено", "غير مسند"))}</b><small>{deptLabel(x.p?.department, lang as Lang)}</small></span><span className="chip c-bad mono">{x.overdue} {T(L("overdue", "просроч.", "простроч.", "متأخرة"))}</span><span className="chip mono">{x.open}</span></Link>)
          : <div className="empty" style={{ padding: 16 }}>{T(L("Nobody has 2+ overdue tasks or more than 8 open.", "Ни у кого нет 2+ просрочек или больше 8 открытых задач.", "Ні в кого немає 2+ прострочень або понад 8 відкритих задач.", "لا أحد لديه مهمتان متأخرتان أو أكثر من 8 مفتوحة."))}</div>}</div></div>
      <div className="card hub-card"><div className="card-h"><h2><Icon n="check" />{T(L("Approvals waiting", "Ждут согласования", "Чекають погодження", "موافقات معلقة"))}</h2><span className={`chip mono ${apDelayed.length ? "c-bad" : ""}`} style={{ marginInlineStart: "auto" }}>{apDelayed.length} ≥ 3 d</span></div>
        <div className="feed">{appr === null ? <div className="empty">…</div> : apGroups.length ? apGroups.map(([g, l]) => <div key={g}><div className="eyebrow" style={{ padding: "6px 12px 2px" }}>{g}</div>{l.map((a) => <Link key={a.id} href={rec({ id: a.record_id, section: a.section })} className="hub-row"><span><b>{a.title}</b><small>{who(a.requested_by)} → {who(a.approver_id)}</small></span><span className={`chip mono ${a.age_days >= 3 ? "c-bad" : "c-warn"}`}>{a.age_days} d</span></Link>)}</div>)
          : <div className="empty" style={{ padding: 16 }}>{T(L("No approvals waiting.", "Согласований нет.", "Погоджень немає.", "لا موافقات.")) }</div>}</div></div>
      <div className="card hub-card"><div className="card-h"><h2><Icon n="target" />{T(L("Workload by employee", "Загрузка сотрудников", "Завантаження співробітників", "عبء العمل لكل موظف"))}</h2></div>
        <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("Employee", "Сотрудник", "Співробітник", "الموظف"))}</th><th>{T(L("Open", "Открыто", "Відкрито", "مفتوحة"))}</th><th>{T(L("Overdue", "Просрочено", "Прострочено", "متأخرة"))}</th><th>{T(L("Review", "Проверка", "Перевірка", "مراجعة"))}</th><th>{T(L("7 days", "7 дней", "7 днів", "7 أيام"))}</th></tr></thead>
          <tbody>{byEmp.map((x) => <tr key={x.id}><td>{x.p ? personName(x.p) : T(L("Not assigned", "Не назначено", "Не призначено", "غير مسند"))}</td><td className="mono">{x.open}</td><td className={`mono ${x.overdue ? "neg" : ""}`}>{x.overdue}</td><td className="mono">{x.review}</td><td className="mono">{x.week}</td></tr>)}</tbody></table></div></div>
      <div className="card hub-card"><div className="card-h"><h2><Icon n="grid" />{T(L("Department workload", "Загрузка отделов", "Завантаження відділів", "عبء عمل الأقسام"))}</h2></div>
        <div className="feed">{byDept.map((x) => <div key={x.d.key} className="hub-row"><span><b>{tx(x.d.label, lang as Lang)}</b><small>{x.review} {T(L("awaiting review", "ждут проверки", "чекають перевірки", "بانتظار المراجعة"))}</small></span><span className={`chip mono ${x.overdue ? "c-bad" : ""}`}>{x.overdue}</span><span className="chip mono">{x.open}</span></div>)}
          {!byDept.length && <div className="empty" style={{ padding: 16 }}>—</div>}</div></div>
      <div className="card hub-card"><div className="card-h"><h2><Icon n="flag" />{T(L("Milestones", "Вехи", "Віхи", "المراحل"))}</h2></div>
        <div className="feed">{[...msDelayed.map((m) => ({ m, late: true })), ...msUpcoming.map((m) => ({ m, late: false }))].slice(0, 14).map(({ m, late }) => <Link key={m.id} href={m.data?.project_ref ? `/projects/${m.data.project_ref}?tab=milestones` : rec(m)} className="hub-row"><span><b>{m.title}</b><small>{m.data?.project_ref_title || ""}</small></span><span className={`chip ${late ? "c-bad" : "c-info"}`}>{m.data?.due}</span></Link>)}
          {!msDelayed.length && !msUpcoming.length && <div className="empty" style={{ padding: 16 }}>—</div>}</div></div>
      <div className="card hub-card"><div className="card-h"><h2><Icon n="check" />{T(L("Important decisions", "Важные решения", "Важливі рішення", "قرارات مهمة"))}</h2></div>
        <div className="feed">{decisions.map((d) => <Link key={d.id} href={rec(d)} className="hub-row"><span><b>{d.title}</b><small>{d.data?.area || ""}{d.data?.project_ref_title ? ` · ${d.data.project_ref_title}` : ""}</small></span><span className={`chip dot ${tone(d.status)}`}>{d.status}</span></Link>)}
          {!decisions.length && <div className="empty" style={{ padding: 16 }}>{access.read.has("company.decisions") ? "—" : T(L("No access to the decision log.", "Нет доступа к журналу решений.", "Немає доступу до журналу рішень.", "لا وصول إلى سجل القرارات."))}</div>}</div></div>
      <div className="card hub-card wide"><div className="card-h"><h2><Icon n="clock" />{T(L("Recent changes", "Последние изменения", "Останні зміни", "آخر التغييرات"))}</h2></div>
        <div className="feed">{hist.filter((h) => !proj || (w.all || []).find((r) => r.id === h.record_id)?.data?.project_ref === proj || h.record_id === proj).slice(0, 15).map((h) => <Link key={h.id} href={h.record_id ? rec({ id: h.record_id, section: h.section }) : "#"} className="hub-row"><span><b>{h.detail?.title || "—"}</b><small>{tx(findSection(h.section)?.label, lang as Lang)} · {who(h.actor)} · {h.action}{h.action === "status" ? `: ${h.detail?.from || "—"} → ${h.detail?.to}` : ""}</small></span><small className="faint mono">{h.created_at.slice(0, 16).replace("T", " ")}</small></Link>)}</div></div>
    </div>
  </div>;
}
