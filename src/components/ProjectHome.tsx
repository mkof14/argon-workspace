"use client";
// One project on one screen: overview, tasks, milestones, team, documents, discussion, timeline and activity.
// Everything is the ordinary records (tasks, milestones, documents) linked to the project, so permissions,
// versions and history work exactly as everywhere else.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { tone, saveBlob } from "@/lib/format";
import { store, type Activity, type Rec } from "@/lib/store";
import { TASK_STATUSES } from "@/config/workspace.config.mjs";
import { useWork } from "./useWork";
import { byUrgency, daysTo, isOpenTask, MS_CLOSED, projectStats, todayIso, workload } from "@/lib/work";
import { deptLabel, isEmployee, mdHtml, personName } from "./PeopleFields";
import Discussion from "./Discussion";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Tab = "overview" | "tasks" | "milestones" | "team" | "documents" | "discussion" | "timeline" | "activity";

export default function ProjectHome({ id }: { id: string }) {
  const { lang, people, me, access, toast, reload, openAi, rules, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const w = useWork(); const today = todayIso();
  const [tab, setTab] = useState<Tab>(() => (typeof window !== "undefined" ? (new URLSearchParams(location.search).get("tab") as Tab) : null) || "overview");
  const p = w.projects.find((x) => x.id === id) || null;
  const tasks = useMemo(() => w.tasks.filter((t) => t.data?.project_ref === id).sort(byUrgency(today)), [w.tasks, id, today]);
  const ms = useMemo(() => w.milestones.filter((m) => m.data?.project_ref === id).sort((a, b) => String(a.data?.due || "9").localeCompare(String(b.data?.due || "9"))), [w.milestones, id]);
  const docs = w.documents.filter((d) => d.data?.project_ref === id);
  const meets = w.meetings.filter((m) => m.data?.project_ref === id);
  const s = p ? projectStats(p, w.all || [], today) : null;
  const [decisions, setDecisions] = useState<Rec[]>([]); const [pendingAppr, setPendingAppr] = useState<{ id: string; record_id: string; status: string; approver_id: string; created_at: string }[]>([]);
  const [nCmt, setNCmt] = useState(0); const [hist, setHist] = useState<Activity[]>([]);
  useEffect(() => { if (access.read.has("company.decisions")) store.list("company.decisions").then((l) => setDecisions(l.filter((d) => d.data?.project_ref === id))).catch(() => {}); }, [id, tick, access]); // eslint-disable-line
  useEffect(() => { store.comments(id).then((cs) => setNCmt(cs.filter((c) => !c.deleted_at && (c.kind || "message") !== "approval").length)).catch(() => {}); }, [id, tick]);
  const ids = useMemo(() => [id, ...tasks.map((t) => t.id), ...ms.map((m) => m.id), ...docs.map((d) => d.id)], [id, tasks, ms, docs]);
  useEffect(() => { store.activityFor(ids, 100).then(setHist).catch(() => {}); }, [ids.join(",")]); // eslint-disable-line
  useEffect(() => { // approvals still waiting on this project's records (the database shows only those I may see)
    (async () => { try { const { sb } = await import("@/lib/sb"); const { data } = await sb().from("approvals").select("id,record_id,status,approver_id,created_at").in("record_id", ids.slice(0, 200)).eq("status", "pending"); setPendingAppr((data || []) as any); } catch {} })();
  }, [ids.join(",")]); // eslint-disable-line
  const go = (k: Tab) => { setTab(k); try { const u = new URL(location.href); u.searchParams.set("tab", k); history.replaceState(history.state, "", u.toString()); } catch {} };
  const who = (pid?: string | null) => personName(people.find((x) => x.id === pid));
  const rec = (r: Rec) => `/${r.section.replace(".", "/")}?r=${r.id}`;
  const pre = p ? `project_ref=${p.id}&project_ref_title=${encodeURIComponent(p.title)}` : "";
  const canTask = access.write.has("company.tasks");
  const setStatus = async (r: Rec, status: string) => { try { await store.save({ ...store.original(r), status }); toast(T(L("Saved", "Сохранено", "Збережено", "حُفظ"))); reload(); } catch (e: any) { toast(e.message || "Error", true); } };
  const canRead = (x: any) => ["owner", "admin"].includes(x.role) || (rules || []).some((r) => r.role === x.role && r.section === "company.projects");
  if (w.loading) return <div className="card" style={{ padding: 24 }}>…</div>;
  if (!p || !s) return <div className="card empty">{T(L("This project does not exist or you cannot open it.", "Этого проекта нет или у вас нет к нему доступа.", "Цього проєкту немає або у вас немає до нього доступу.", "هذا المشروع غير موجود أو لا يمكنك فتحه."))} <Link href="/projects">{T(L("All projects", "Все проекты", "Усі проєкти", "كل المشاريع"))}</Link></div>;
  const team = s.members.map((m) => people.find((x) => x.id === m)).filter(Boolean) as any[];
  const wl = workload(tasks, today);
  const summary = () => [
    `# ${p.title} — ${T(L("project summary", "сводка проекта", "зведення проєкту", "ملخص المشروع"))} (${today})`, "",
    `- ${T(L("Status", "Статус", "Статус", "الحالة"))}: ${p.status}${p.data?.priority ? ` · ${p.data.priority}` : ""}`,
    `- ${T(L("Project manager", "Руководитель", "Керівник", "مدير المشروع"))}: ${who(p.data?.manager_id) || p.data?.manager || "—"}`,
    `- ${T(L("Dates", "Сроки", "Терміни", "التواريخ"))}: ${p.data?.start || "—"} → ${p.data?.target || "—"}${s.late ? ` (${T(L("past target", "срок прошёл", "термін минув", "تجاوز الموعد"))})` : ""}`,
    `- ${T(L("Progress", "Прогресс", "Прогрес", "التقدم"))}: ${s.done}/${s.tasks} (${s.progress}%) · ${T(L("overdue", "просрочено", "прострочено", "متأخرة"))}: ${s.overdue} · ${T(L("in review", "на проверке", "на перевірці", "قيد المراجعة"))}: ${s.review}`,
    "", `## ${T(L("Milestones", "Вехи", "Віхи", "المراحل"))}`, ...ms.map((m) => `- ${m.data?.due || "—"} · ${m.title} · ${m.status}${s.delayed.some((x) => x.id === m.id) ? " ⚠" : ""}`),
    "", `## ${T(L("Open tasks", "Открытые задачи", "Відкриті задачі", "المهام المفتوحة"))}`, ...tasks.filter(isOpenTask).map((t) => `- ${t.title} · ${t.data?.assignee || "—"} · ${t.status}${t.data?.due ? ` · ${t.data.due}` : ""}`),
    "", `## ${T(L("Waiting for decisions", "Ждут решений", "Чекають рішень", "بانتظار القرارات"))}`, ...decisions.filter((d) => d.status === "Proposed").map((d) => `- ${d.title}`), ...pendingAppr.map((a) => `- ${[...tasks, ...ms, ...docs].find((x) => x.id === a.record_id)?.title || "—"} → ${who(a.approver_id)}`),
  ].join("\n");
  const TABS: [Tab, string, T4, number?][] = [["overview", "grid", L("Overview", "Обзор", "Огляд", "نظرة عامة")], ["tasks", "bell", L("Tasks", "Задачи", "Задачі", "المهام"), s.open], ["milestones", "flag", L("Milestones", "Вехи", "Віхи", "المراحل"), ms.length], ["team", "users", L("Team", "Команда", "Команда", "الفريق"), team.length], ["documents", "file", L("Documents", "Документы", "Документи", "المستندات"), docs.length], ["discussion", "send", L("Discussion", "Обсуждение", "Обговорення", "النقاش"), nCmt], ["timeline", "calendar", L("Timeline", "График", "Графік", "الجدول الزمني")], ["activity", "clock", L("Activity", "История", "Історія", "النشاط")]];
  const H = { late: ["c-bad", L("Delayed", "Задержка", "Затримка", "متأخر")], risk: ["c-warn", L("Overdue tasks", "Есть просрочки", "Є прострочення", "مهام متأخرة")], ok: ["c-ok", L("On track", "По плану", "За планом", "وفق الخطة")] } as const;
  const openDecisions = decisions.filter((d) => d.status === "Proposed").length + pendingAppr.length;
  const span = (() => { const dates = [p.data?.start, p.data?.target, ...ms.map((m) => m.data?.due), ...tasks.map((t) => t.data?.due)].filter((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x)).sort() as string[]; return dates.length ? [dates[0], dates[dates.length - 1] > today ? dates[dates.length - 1] : today] : [today, today]; })();
  const pos = (d: string) => { const a = Date.parse(span[0]), b = Date.parse(span[1]); return b > a ? Math.max(0, Math.min(100, ((Date.parse(d) - a) / (b - a)) * 100)) : 50; };

  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#0E9F6E" }}>
    <section className="sec-hero proj-hero"><span className="ic"><Icon n="layers" /></span>
      <div style={{ minWidth: 0, position: "relative", zIndex: 1, flex: 1 }}><div className="eyebrow"><Link href="/projects">{T(L("Projects", "Проекты", "Проєкти", "المشاريع"))}</Link>{p.data?.department ? ` · ${deptLabel(p.data.department, lang as Lang)}` : ""}</div>
        <h2>{p.controlled && <Icon n="lock" className="lockico" />} {p.title}</h2>
        <div className="toolbar" style={{ gap: 6 }}><span className={`chip dot ${tone(p.status)}`}>{p.status}</span><span className={`chip ${H[s.health][0]}`}>{T(H[s.health][1])}</span>{p.data?.priority && <span className="chip">{p.data.priority}</span>}
          <span className="chip"><Icon n="user" className="lockico" /> {who(p.data?.manager_id) || p.data?.manager || "—"}</span><span className="chip mono">{p.data?.start || "—"} → {p.data?.target || "—"}</span></div>
        <div className="pf-bar" style={{ marginTop: 10 }} title={`${s.done}/${s.tasks}`}><i style={{ width: `${s.progress}%` }} /></div></div>
      <div className="stats"><Link className="btn" href={rec(p)}><Icon n="edit" />{T(L("Edit project", "Изменить проект", "Змінити проєкт", "تعديل المشروع"))}</Link></div></section>
    <nav className="tabs card proj-tabs" role="tablist">{TABS.map(([k, ic, l, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => go(k)} data-tab={k}><Icon n={ic} />{T(l)}{n ? <b className="mono"> {n}</b> : null}</button>)}</nav>

    {tab === "overview" && <>
      <div className="kpis">
        <div className="kpi"><small>{T(L("Progress", "Прогресс", "Прогрес", "التقدم"))}</small><b className="mono">{s.progress}%</b><span className="faint">{s.done}/{s.tasks} {T(L("tasks done", "задач выполнено", "задач виконано", "مهام منجزة"))}</span></div>
        <div className="kpi"><small>{T(L("Overdue tasks", "Просроченные задачи", "Прострочені задачі", "مهام متأخرة"))}</small><b className={`mono ${s.overdue ? "neg" : ""}`}>{s.overdue}</b><span className="faint">{s.review} {T(L("waiting for review", "ждут проверки", "чекають перевірки", "بانتظار المراجعة"))}</span></div>
        <div className="kpi"><small>{T(L("Milestones", "Вехи", "Віхи", "المراحل"))}</small><b className={`mono ${s.delayed.length ? "neg" : ""}`}>{s.delayed.length}</b><span className="faint">{T(L("delayed", "с задержкой", "із затримкою", "متأخرة"))} · {s.nextMilestone ? `${T(L("next", "далее", "далі", "التالي"))} ${s.nextMilestone.data?.due || ""}` : "—"}</span></div>
        <div className="kpi"><small>{T(L("Outstanding decisions", "Ждут решения", "Чекають рішення", "قرارات معلقة"))}</small><b className={`mono ${openDecisions ? "warnv" : ""}`}>{openDecisions}</b><span className="faint">{docs.length} {T(L("documents", "документов", "документів", "مستندات"))}</span></div>
      </div>
      <div className="hub-grid">
        <div className="card hub-card"><div className="card-h"><h2><Icon n="book" />{T(L("About the project", "О проекте", "Про проєкт", "عن المشروع"))}</h2></div>
          <div className="md" style={{ padding: "0 16px 16px" }} dangerouslySetInnerHTML={{ __html: mdHtml(p.data?.description || "") || `<p class="faint">${T(L("No description yet.", "Описания пока нет.", "Опису ще немає.", "لا وصف بعد."))}</p>` }} />
          <div className="toolbar" style={{ padding: "0 16px 16px" }}><button className="btn sm" onClick={() => saveBlob(`AGRON_${p.title.replace(/\W+/g, "_")}_summary_${today}.md`, summary(), "text/markdown;charset=utf-8")}><Icon n="download" />{T(L("Download summary", "Скачать сводку", "Завантажити зведення", "تنزيل الملخص"))}</button>
            <button className="btn ghost sm" onClick={() => openAi({ title: p.title, section: "company.projects", record: p, rows: [...tasks, ...ms].slice(0, 60), ask: T(L("Write a short status summary of this project for management: progress, risks, what is late, decisions needed.", "Напиши короткую сводку состояния проекта для руководства: прогресс, риски, что просрочено, какие нужны решения.", "Напиши коротке зведення стану проєкту для керівництва: прогрес, ризики, що прострочено, які потрібні рішення.", "اكتب ملخصاً قصيراً لحالة المشروع للإدارة: التقدم والمخاطر والمتأخر والقرارات المطلوبة.")) })}><Icon n="spark" />{T(L("Summary by Assistant", "Сводка от ассистента", "Зведення від асистента", "ملخص من المساعد"))}</button></div></div>
        <div className="card hub-card"><div className="card-h"><h2><Icon n="alert" />{T(L("Needs attention", "Требует внимания", "Потребує уваги", "يحتاج انتباهاً"))}</h2></div><div className="feed">
          {[...tasks.filter((t) => isOpenTask(t) && (daysTo(t.data?.due, today) ?? 1) < 0).map((t) => <Link key={t.id} href={rec(t)} className="hub-row"><span><b>{t.title}</b><small>{t.data?.assignee || "—"} · {t.data?.due}</small></span><span className="chip c-bad">{T(L("overdue", "просрочено", "прострочено", "متأخرة"))}</span></Link>),
            ...s.delayed.map((m) => <Link key={m.id} href={rec(m)} className="hub-row"><span><b>{m.title}</b><small>{m.data?.due}</small></span><span className="chip c-bad">{T(L("milestone late", "веха просрочена", "віха прострочена", "مرحلة متأخرة"))}</span></Link>),
            ...decisions.filter((d) => d.status === "Proposed").map((d) => <Link key={d.id} href={rec(d)} className="hub-row"><span><b>{d.title}</b><small>{T(L("Decision proposed", "Решение предложено", "Рішення запропоновано", "قرار مقترح"))}</small></span><span className="chip c-warn">{T(L("decide", "решить", "вирішити", "قرّر"))}</span></Link>),
            ...pendingAppr.map((a) => { const r = [...tasks, ...ms, ...docs].find((x) => x.id === a.record_id); return r ? <Link key={a.id} href={rec(r)} className="hub-row"><span><b>{r.title}</b><small>{T(L("Approval with", "Согласование у", "Погодження в", "موافقة لدى"))} {who(a.approver_id)}</small></span><span className="chip c-warn">{T(L("waiting", "ждёт", "чекає", "ينتظر"))}</span></Link> : null; })]}
          {!s.overdue && !s.delayed.length && !openDecisions && <div className="empty" style={{ padding: 16 }}>{T(L("Nothing late, no decisions waiting.", "Ничего не просрочено, решений не ждёт.", "Нічого не прострочено, рішень не чекає.", "لا متأخرات ولا قرارات معلقة."))}</div>}</div></div>
        <div className="card hub-card wide"><div className="card-h"><h2><Icon n="clock" />{T(L("Recent changes", "Последние изменения", "Останні зміни", "آخر التغييرات"))}</h2><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => go("activity")}>{T(L("All", "Все", "Усі", "الكل"))}</button></div>
          <div className="feed">{hist.slice(0, 6).map((h) => <div key={h.id} className="hub-row"><span><b>{h.detail?.title || [...tasks, ...ms, ...docs, p].find((x) => x.id === h.record_id)?.title || "—"}</b><small>{who(h.actor) || "—"} · {h.action}{h.action === "status" ? `: ${h.detail?.from || "—"} → ${h.detail?.to}` : ""}</small></span><small className="faint mono">{h.created_at.slice(0, 16).replace("T", " ")}</small></div>)}
            {!hist.length && <div className="empty" style={{ padding: 16 }}>—</div>}</div></div>
      </div></>}

    {tab === "tasks" && <section className="card"><div className="card-h toolbar"><h2><Icon n="bell" />{T(L("Tasks", "Задачи", "Задачі", "المهام"))}</h2>
      {canTask && <Link className="btn primary sm" style={{ marginInlineStart: "auto" }} href={`/company/tasks?new=1&${pre}`}><Icon n="plus" />{T(L("New task", "Новая задача", "Нова задача", "مهمة جديدة"))}</Link>}
      <Link className="btn ghost sm" style={canTask ? undefined : { marginInlineStart: "auto" }} href={`/company/tasks?project=${id}`}>{T(L("Board view", "Доска", "Дошка", "عرض اللوحة"))}</Link></div>
      <div className="feed" style={{ padding: "0 8px 8px" }}>{tasks.length ? tasks.map((t) => { const dd = daysTo(t.data?.due, today); return <div key={t.id} className="hub-row task-row">
        <Link href={rec(t)} style={{ minWidth: 0, flex: 1, color: "inherit", textDecoration: "none" }}><b>{t.title}</b><small>{[t.data?.assignee || T(L("not assigned", "не назначено", "не призначено", "غير مسند")), t.data?.priority, t.data?.due].filter(Boolean).join(" · ")}</small></Link>
        {dd !== null && isOpenTask(t) && <span className={`chip ${dd < 0 ? "c-bad" : dd <= 1 ? "c-warn" : "c-info"}`}>{dd < 0 ? `${-dd} d` : dd === 0 ? T(L("today", "сегодня", "сьогодні", "اليوم")) : `+${dd} d`}</span>}
        <select className="input status-pick" value={t.status || ""} disabled={!canTask} onChange={(e) => setStatus(t, e.target.value)} aria-label={`${T(L("Status", "Статус", "Статус", "الحالة"))}: ${t.title}`}>{TASK_STATUSES.map((x: string) => <option key={x}>{x}</option>)}</select></div>; })
        : <div className="empty">{T(L("No tasks in this project yet.", "В проекте пока нет задач.", "У проєкті ще немає задач.", "لا مهام في هذا المشروع بعد."))}</div>}</div></section>}

    {tab === "milestones" && <section className="card"><div className="card-h toolbar"><h2><Icon n="flag" />{T(L("Milestones", "Вехи", "Віхи", "المراحل"))}</h2>
      {access.write.has("company.milestones") && <Link className="btn primary sm" style={{ marginInlineStart: "auto" }} href={`/company/milestones?new=1&${pre}`}><Icon n="plus" />{T(L("New milestone", "Новая веха", "Нова віха", "مرحلة جديدة"))}</Link>}</div>
      <div className="feed" style={{ padding: "0 8px 8px" }}>{ms.length ? ms.map((m) => { const late = s.delayed.some((x) => x.id === m.id); return <Link key={m.id} href={rec(m)} className="hub-row"><span><b>{m.title}</b><small>{m.data?.due || "—"} · {m.data?.owner || who(m.data?.owner_id) || "—"}</small></span>{late && <span className="chip c-bad">{T(L("delayed", "задержка", "затримка", "متأخرة"))}</span>}<span className={`chip dot ${tone(m.status)}`}>{m.status}</span></Link>; })
        : <div className="empty">{T(L("No milestones yet.", "Вех пока нет.", "Віх ще немає.", "لا مراحل بعد."))}</div>}</div></section>}

    {tab === "team" && <section className="card"><div className="card-h toolbar"><h2><Icon n="users" />{T(L("Team", "Команда", "Команда", "الفريق"))}</h2><Link className="btn ghost sm" style={{ marginInlineStart: "auto" }} href={rec(p)}><Icon n="edit" />{T(L("Change team", "Изменить команду", "Змінити команду", "تغيير الفريق"))}</Link></div>
      <div className="feed" style={{ padding: "0 8px 8px" }}>{team.length ? team.map((m) => { const x = wl.get(m.id); return <div key={m.id} className="hub-row"><span><b>{personName(m)}{m.id === p.data?.manager_id ? ` · ${T(L("project manager", "руководитель проекта", "керівник проєкту", "مدير المشروع"))}` : ""}</b><small>{[m.title, deptLabel(m.department, lang as Lang)].filter(Boolean).join(" · ")}{!isEmployee(m) ? ` · ${T(L("inactive", "неактивен", "неактивний", "غير نشط"))}` : ""}</small></span>
        <span className={`chip mono ${x?.overdue ? "c-bad" : ""}`}>{x?.open || 0} {T(L("open", "открыто", "відкрито", "مفتوحة"))}{x?.overdue ? ` · ${x.overdue} ${T(L("late", "просроч.", "простроч.", "متأخرة"))}` : ""}</span>
        {canTask && isEmployee(m) && <Link className="btn ghost sm" href={`/company/tasks?new=1&${pre}&assignee_id=${m.id}`}><Icon n="plus" /></Link>}</div>; })
        : <div className="empty">{T(L("No team yet. Edit the project to choose a manager and members.", "Команды пока нет. Измените проект, чтобы выбрать руководителя и участников.", "Команди ще немає. Змініть проєкт, щоб вибрати керівника й учасників.", "لا فريق بعد. عدّل المشروع لاختيار المدير والأعضاء."))}</div>}</div></section>}

    {tab === "documents" && <section className="card"><div className="card-h toolbar"><h2><Icon n="file" />{T(L("Documents", "Документы", "Документи", "المستندات"))}</h2>
      {access.write.has("company.documents") && <Link className="btn primary sm" style={{ marginInlineStart: "auto" }} href={`/company/documents?new=1&${pre}`}><Icon n="upload" />{T(L("Add a document", "Добавить документ", "Додати документ", "إضافة مستند"))}</Link>}</div>
      <div className="feed" style={{ padding: "0 8px 8px" }}>{docs.length ? docs.map((d) => <Link key={d.id} href={rec(d)} className="hub-row"><span><b>{d.controlled && <Icon n="lock" className="lockico" />} {d.title}</b><small>{[d.data?.doc_type, d.data?.version ? `v${String(d.data.version).replace(/^v/i, "")}` : "", d.data?.owner].filter(Boolean).join(" · ")}</small></span><span className={`chip dot ${tone(d.status)}`}>{d.status}</span></Link>)
        : <div className="empty">{T(L("No documents linked to this project.", "К проекту не привязаны документы.", "До проєкту не прив'язано документів.", "لا مستندات مرتبطة بهذا المشروع."))}</div>}
        {meets.length > 0 && <><div className="eyebrow" style={{ padding: "10px 12px 2px" }}>{T(L("Meetings", "Встречи", "Зустрічі", "الاجتماعات"))}</div>{meets.map((m) => <Link key={m.id} href={rec(m)} className="hub-row"><span><b>{m.title}</b><small>{m.data?.date} {m.data?.time || ""}</small></span><span className={`chip dot ${tone(m.status)}`}>{m.status}</span></Link>)}</>}</div></section>}

    {tab === "discussion" && <section className="card" style={{ padding: 16 }}><Discussion rec={p} project={p} linkables={[...tasks, ...docs, ...ms]} title={T(L("Project discussion", "Обсуждение проекта", "Обговорення проєкту", "نقاش المشروع"))} onCount={setNCmt} />
      {decisions.length > 0 && <div className="dec-log"><div className="eyebrow"><Icon n="stamp" /> {T(L("Decision log of this project", "Журнал решений проекта", "Журнал рішень проєкту", "سجل قرارات المشروع"))}</div>
        {decisions.map((d) => <Link key={d.id} href={rec(d)} className="hub-row"><span><b>{d.title}</b><small>{d.data?.date || d.created_at?.slice(0, 10)} · {who(d.created_by)}</small></span><span className={`chip dot ${tone(d.status)}`}>{d.status}</span></Link>)}</div>}</section>}

    {tab === "timeline" && <section className="card" style={{ padding: 16 }}><div className="eyebrow">{span[0]} → {span[1]}</div>
      <div className="timeline" role="list">
        <div className="tl-track"><span className="tl-today" style={{ insetInlineStart: `${pos(today)}%` }} title={today} /></div>
        {ms.map((m) => <div key={m.id} role="listitem" className={`tl-row ${s.delayed.some((x) => x.id === m.id) ? "late" : MS_CLOSED.has(m.status || "") ? "done" : ""}`}><Link href={rec(m)} className="tl-label"><Icon n="flag" /> {m.title}</Link><div className="tl-bar"><span className="tl-pin" style={{ insetInlineStart: `${pos(String(m.data?.due || today))}%` }} title={String(m.data?.due || "")} /></div><small className="mono faint">{m.data?.due || "—"}</small></div>)}
        {tasks.filter((t) => t.data?.due).slice(0, 30).map((t) => <div key={t.id} role="listitem" className={`tl-row task ${!isOpenTask(t) ? "done" : (daysTo(t.data?.due, today) ?? 1) < 0 ? "late" : ""}`}><Link href={rec(t)} className="tl-label"><Icon n="bell" /> {t.title}</Link><div className="tl-bar">{t.data?.start && <span className="tl-span" style={{ insetInlineStart: `${pos(t.data.start)}%`, width: `${Math.max(1, pos(t.data.due) - pos(t.data.start))}%` }} />}<span className="tl-pin" style={{ insetInlineStart: `${pos(t.data.due)}%` }} /></div><small className="mono faint">{t.data.due}</small></div>)}
        {!ms.length && !tasks.some((t) => t.data?.due) && <div className="empty">{T(L("Add milestones and deadlines to see the timeline.", "Добавьте вехи и сроки, чтобы увидеть график.", "Додайте віхи й терміни, щоб побачити графік.", "أضف مراحل ومواعيد لرؤية الجدول الزمني."))}</div>}
      </div></section>}

    {tab === "activity" && <section className="card"><div className="feed" style={{ padding: 8 }}>{hist.map((h) => <div key={h.id} className="hub-row"><span><b>{h.detail?.title || [...tasks, ...ms, ...docs, p].find((x) => x.id === h.record_id)?.title || "—"}</b><small>{who(h.actor) || "—"} · {h.action}{h.action === "status" ? `: ${h.detail?.from || "—"} → ${h.detail?.to}` : ""}</small></span><small className="faint mono">{h.created_at.slice(0, 16).replace("T", " ")}</small></div>)}
      {!hist.length && <div className="empty">—</div>}</div></section>}
    <style>{`.lockico{width:15px;height:15px;color:var(--warn);vertical-align:-2px}`}</style>
  </div>;
}
