"use client";
import { NotifyHint } from "./Notify";
import SinceLast, { TeamClock } from "./SinceLast";
import Link from "next/link";
import Announcements from "./Announcements";
import Icon from "./Icon";
import { useTr } from "@/lib/useTr";
import { useApp, findSection } from "./App";
import { useInbox } from "./Inbox";
import { tx, type Lang } from "@/lib/i18n";
import { tone } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { DEMO } from "@/lib/sb";
import { store, type Rec } from "@/lib/store";
import { TASK_STATUSES } from "@/config/workspace.config.mjs";
import { byUrgency, daysTo, isMineTask, isOpenTask, projectStats, taskBucket, topUrgent, todayIso } from "@/lib/work";
import { useWork } from "./useWork";
import { useNotices } from "./NavBits";
import { KINDS, noticeHref } from "./Notices";
import { commentText } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const href = (r: { id?: string; record_id?: string; section?: string }) => `/${String(r.section).replace(".", "/")}?r=${r.record_id || r.id}`;
const APPR_GROUP: Record<string, T4> = {
  "company.documents": L("Documents", "Документы", "Документи", "المستندات"), "legal.contracts": L("Contracts", "Договоры", "Договори", "العقود"),
  "finance.expenses": L("Financial requests", "Финансовые запросы", "Фінансові запити", "طلبات مالية"), "finance.budget": L("Financial requests", "Финансовые запросы", "Фінансові запити", "طلبات مالية"), "finance.costing": L("Financial requests", "Финансовые запросы", "Фінансові запити", "طلبات مالية"),
  "operations.procurement": L("Purchase requests", "Заявки на закупку", "Заявки на закупівлю", "طلبات الشراء"),
};
const OTHER = L("Other approvals", "Другие согласования", "Інші погодження", "موافقات أخرى");

/** TODAY: the three most urgent things, my tasks, my approvals, my calendar, notifications and my projects. */
export default function Today() {
  const { lang, me, toast, reload, access } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const d = useInbox(); const w = useWork(); const nt = useNotices();
  const [auto, setAuto] = useState<{ n: number; items: { id: string; agent: string; title: string; at: string }[] } | null>(null);
  const trA = useTr((auto?.items || []).map((q) => q.title), lang);
  useEffect(() => { if (DEMO || !["owner", "admin"].includes(me.role)) return; fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pending" }) }).then((r) => (r.ok ? r.json() : null)).then(setAuto).catch(() => {}); }, [me.role]);
  const today = todayIso();
  const [tab, setTab] = useState<"now" | "upcoming" | "later" | "done">("now"); const [proj, setProj] = useState("");
  const mine = useMemo(() => w.tasks.filter((t) => isMineTask(t, me.id)), [w.tasks, me.id]);
  const urgent = useMemo(() => topUrgent(w.tasks, d.approvals, me.id, today), [w.tasks, d.approvals, me.id, today]);
  const buckets = useMemo(() => {
    const b = { now: [] as Rec[], upcoming: [] as Rec[], later: [] as Rec[], done: [] as Rec[] };
    for (const t of mine.filter((x) => !proj || x.data?.project_ref === proj)) { const k = taskBucket(t, today); (k === "overdue" || k === "today" ? b.now : k === "upcoming" ? b.upcoming : k === "later" ? b.later : b.done).push(t); }
    b.now.sort(byUrgency(today)); b.upcoming.sort(byUrgency(today)); b.later.sort(byUrgency(today)); b.done.sort((x, y) => String(y.data?.completed_at || y.updated_at).localeCompare(String(x.data?.completed_at || x.updated_at)));
    return b;
  }, [mine, proj, today]);
  const myProjects = w.projects.filter((p) => !["Completed", "Cancelled"].includes(p.status || "") && (p.data?.manager_id === me.id || (Array.isArray(p.data?.members_ids) && p.data.members_ids.includes(me.id)) || mine.some((t) => t.data?.project_ref === p.id)));
  const meetings = w.meetings.filter((m) => m.status !== "Cancelled" && (daysTo(m.data?.date, today) ?? -1) >= 0 && (daysTo(m.data?.date, today) ?? 99) <= 7 && (!Array.isArray(m.data?.participants_ids) || !m.data.participants_ids.length || m.data.participants_ids.includes(me.id) || m.created_by === me.id))
    .sort((a, b) => `${a.data?.date}${a.data?.time || ""}`.localeCompare(`${b.data?.date}${b.data?.time || ""}`));
  const deadlines = d.mine.filter((x) => x.r.section !== "company.tasks" && x.d >= -3 && x.d <= 7).slice(0, 6);
  const apprGroups = useMemo(() => { const m = new Map<string, typeof d.approvals>(); for (const a of d.approvals) { const g = T(APPR_GROUP[a.section] || OTHER); m.set(g, [...(m.get(g) || []), a]); } return [...m.entries()]; }, [d.approvals, lang]); // eslint-disable-line
  const setStatus = async (r: Rec, status: string) => { try { await store.save({ ...store.original(r), status }); toast(T(L("Saved", "Сохранено", "Збережено", "حُفظ"))); reload(); } catch (e: any) { toast(e.message || "Error", true); } };
  const rel = (n: number | null) => (n === null ? "" : n < 0 ? T(L(`${-n} d late`, `просрочено ${-n} дн.`, `прострочено ${-n} дн.`, `متأخر ${-n} يوم`)) : n === 0 ? T(L("today", "сегодня", "сьогодні", "اليوم")) : T(L(`in ${n} d`, `через ${n} дн.`, `через ${n} дн.`, `بعد ${n} يوم`)));
  const why: Record<string, T4> = { overdue: L("Overdue", "Просрочено", "Прострочено", "متأخر"), today: L("Due today", "Срок сегодня", "Термін сьогодні", "يستحق اليوم"), approval: L("Waiting for your decision", "Ждёт вашего решения", "Чекає вашого рішення", "ينتظر قرارك"), critical: L("Critical", "Критично", "Критично", "حرج"), soon: L("Next up", "Следующее", "Наступне", "التالي") };
  const hour = new Date().getHours();
  const hello = hour < 12 ? L("Good morning", "Доброе утро", "Доброго ранку", "صباح الخير") : hour < 18 ? L("Good afternoon", "Добрый день", "Доброго дня", "مساء الخير") : L("Good evening", "Добрый вечер", "Доброго вечора", "مساء الخير");
  const name = (me.full_name || me.email || "").split(/\s+/)[0];
  const Box = ({ icon, title, n, children, empty, more }: { icon: string; title: T4; n: number; children: React.ReactNode; empty: T4; more?: string }) => (
    <div className="card hub-card"><div className="card-h"><h2><Icon n={icon} />{T(title)}</h2><span className="chip mono" style={{ marginInlineStart: "auto" }}>{n}</span>{more && <Link className="btn ghost sm" href={more}>{T(L("All", "Все", "Усі", "الكل"))}</Link>}</div>
      <div className="feed">{n ? children : <div className="empty" style={{ padding: 16 }}>{T(empty)}</div>}</div></div>);
  const taskRow = (r: Rec) => { const dd = daysTo(r.data?.due, today); return <div key={r.id} className="hub-row task-row" data-task={r.id}>
    <Link href={href(r)} style={{ minWidth: 0, flex: 1, color: "inherit", textDecoration: "none" }}><b>{r.title}</b><small>{[r.data?.project_ref_title, r.data?.priority && r.data.priority !== "Normal" ? r.data.priority : "", r.data?.due ? `${T(L("due", "срок", "термін", "الموعد"))} ${r.data.due}` : ""].filter(Boolean).join(" · ")}</small></Link>
    {dd !== null && isOpenTask(r) && <span className={`chip ${dd < 0 ? "c-bad" : dd <= 1 ? "c-warn" : "c-info"}`}>{rel(dd)}</span>}
    <select className="input status-pick" value={r.status || ""} onChange={(e) => setStatus(r, e.target.value)} aria-label={`${T(L("Status", "Статус", "Статус", "الحالة"))}: ${r.title}`} disabled={!access.write.has("company.tasks")}>{TASK_STATUSES.map((s: string) => <option key={s}>{s}</option>)}</select>
  </div>; };
  const tabs: [typeof tab, T4, number][] = [["now", L("Overdue & today", "Просрочено и сегодня", "Прострочено й сьогодні", "متأخر واليوم"), buckets.now.length], ["upcoming", L("This week", "На неделе", "Цього тижня", "هذا الأسبوع"), buckets.upcoming.length], ["later", L("Later", "Позже", "Пізніше", "لاحقاً"), buckets.later.length], ["done", L("Completed", "Выполнено", "Виконано", "مكتملة"), buckets.done.length]];
  const projOpts = [...new Map(mine.filter((t) => t.data?.project_ref).map((t) => [t.data.project_ref, t.data.project_ref_title || "—"])).entries()];

  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#FF6A2B" }}>
      <section className="dhero today-hero"><div className="dhero-top"><span className="dhero-ic"><Icon n="sun" /></span>
        <div style={{ minWidth: 0 }}><div className="dhero-kicker">{new Date().toLocaleDateString(lang === "en" ? "en-US" : lang, { weekday: "long", day: "numeric", month: "long" })}</div>
          <h2>{T(hello)}, {name}</h2>
          <p>{urgent.length ? T(L("Start with these:", "Начните с этого:", "Почніть із цього:", "ابدأ بهذه:")) : T(L("Nothing urgent. A good day to move a project forward.", "Ничего срочного. Хороший день, чтобы продвинуть проект.", "Нічого термінового. Добрий день, щоб просунути проєкт.", "لا شيء عاجل. يوم جيد لدفع مشروع إلى الأمام."))}</p></div></div>
        {urgent.length > 0 && <ol className="top3" aria-label={T(L("Most urgent", "Самое срочное", "Найтерміновіше", "الأكثر إلحاحاً"))}>{urgent.map((u, i) => <li key={u.kind + u.id}><Link href={u.href} className={`top3-item ${u.why}`}><span className="n mono">{i + 1}</span><span style={{ minWidth: 0 }}><small>{T(why[u.why])}{u.days !== null && u.why !== "approval" ? ` · ${rel(u.days)}` : ""}</small><b>{u.title}</b></span><Icon n="chev" /></Link></li>)}</ol>}
      </section>
      {access.read.has("company.announcements") && <Announcements compact />}
      <div className="toolbar quick-actions">
        {access.write.has("company.tasks") && <Link href="/company/tasks?new=1" className="btn primary sm"><Icon n="plus" />{T(L("New task", "Новая задача", "Нова задача", "مهمة جديدة"))}</Link>}
        {access.write.has("company.documents") && <Link href="/company/documents?new=1" className="btn sm"><Icon n="upload" />{T(L("Upload document", "Загрузить документ", "Завантажити документ", "رفع مستند"))}</Link>}
        {access.write.has("company.meetings") && <Link href="/company/meetings?new=1" className="btn sm"><Icon n="calendar" />{T(L("Create meeting", "Создать встречу", "Створити зустріч", "إنشاء اجتماع"))}</Link>}
        <Link href="/decide" className="btn ghost sm"><Icon n="check" />{T(L("Approvals", "Согласования", "Погодження", "الموافقات"))}</Link>
        <Link href="/assistant" className="btn ghost sm"><Icon n="spark" />{T(L("Ask Assistant", "Спросить ассистента", "Запитати асистента", "اسأل المساعد"))}</Link>
      </div>
      <TeamClock />
      <NotifyHint />
      <section className="card" id="tasks">
        <div className="card-h toolbar"><h2><Icon n="bell" />{T(L("My tasks", "Мои задачи", "Мої задачі", "مهامي"))}</h2>
          {projOpts.length > 0 && <select className="input" style={{ width: "auto", marginInlineStart: "auto" }} value={proj} onChange={(e) => setProj(e.target.value)} aria-label={T(L("Project", "Проект", "Проєкт", "المشروع"))}><option value="">{T(L("All projects", "Все проекты", "Усі проєкти", "كل المشاريع"))}</option>{projOpts.map(([id, tt]) => <option key={id} value={id}>{tt}</option>)}</select>}
          <Link className="btn ghost sm" href="/company/tasks?view=mine" style={projOpts.length ? undefined : { marginInlineStart: "auto" }}>{T(L("Open the task list", "Открыть список задач", "Відкрити список задач", "افتح قائمة المهام"))}</Link></div>
        <nav className="seg" style={{ margin: "0 16px 8px" }}>{tabs.map(([k, l, n]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{T(l)} <b className="mono">{n}</b></button>)}</nav>
        <div className="feed" style={{ padding: "0 8px 8px" }}>{w.loading ? <div className="empty">…</div> : buckets[tab].length ? buckets[tab].slice(0, 30).map(taskRow) : <div className="empty" style={{ padding: 16 }}>{tab === "now" ? T(L("Nothing overdue or due today.", "Нет просроченного и на сегодня.", "Немає простроченого й на сьогодні.", "لا متأخر ولا مستحق اليوم.")) : T(L("No tasks here.", "Задач нет.", "Задач немає.", "لا مهام."))}</div>}</div>
      </section>
      <div className="hub-grid">
        <div id="appr"><Box icon="check" title={L("My approvals", "Мои согласования", "Мої погодження", "موافقاتي")} n={d.approvals.length} more="/decide" empty={L("No approvals waiting.", "Согласований нет.", "Погоджень немає.", "لا موافقات.")}>
          {apprGroups.map(([g, list]) => <div key={g}><div className="eyebrow" style={{ padding: "6px 12px 2px" }}>{g}</div>
            {list.map((a) => <Link key={a.id} href={href(a)} className="hub-row"><span><b>{a.title || "—"}</b><small>{tx(findSection(a.section)?.label, lang as Lang)} · {a.created_at.slice(0, 10)}</small></span><span className="chip c-warn">{T(L("Decide", "Решить", "Вирішити", "قرّر"))}</span></Link>)}</div>)}</Box></div>
        <div id="cal"><Box icon="calendar" title={L("My calendar", "Мой календарь", "Мій календар", "تقويمي")} n={meetings.length + deadlines.length} more="/calendar" empty={L("No meetings or deadlines this week.", "На этой неделе встреч и сроков нет.", "Цього тижня зустрічей і термінів немає.", "لا اجتماعات ولا مواعيد هذا الأسبوع.")}>
          {meetings.map((m) => <Link key={m.id} href={href(m)} className="hub-row"><span><b>{m.title}</b><small>{m.data?.place || ""}</small></span><span className={`chip ${m.data?.date === today ? "c-warn" : "c-info"}`}>{m.data?.date === today ? T(L("today", "сегодня", "сьогодні", "اليوم")) : m.data?.date} {m.data?.time || ""}</span></Link>)}
          {deadlines.map((x) => <Link key={x.r.id + x.k} href={href(x.r)} className="hub-row"><span><b>{x.r.title}</b><small>{tx(findSection(x.r.section)?.label, lang as Lang)}</small></span><span className={`chip ${x.d < 0 ? "c-bad" : x.d <= 2 ? "c-warn" : "c-info"}`}>{rel(x.d)}</span></Link>)}</Box></div>
        <div id="notes"><Box icon="bell" title={L("Notifications", "Уведомления", "Сповіщення", "الإشعارات")} n={nt.unread.length} more="/notifications" empty={L("Nothing new.", "Ничего нового.", "Нічого нового.", "لا جديد.")}>
          {nt.unread.slice(0, 6).map((n) => <Link key={n.id} href={noticeHref(n)} className="hub-row" onClick={() => store.markNotices([n.id]).catch(() => {})}><span><small>{tx(KINDS[n.kind]?.label || L(n.kind, n.kind, n.kind, n.kind), lang as Lang)}</small><b>{n.title}</b>{n.body && <small>{commentText(n.body).slice(0, 110)}</small>}</span></Link>)}</Box></div>
        <div id="proj"><Box icon="layers" title={L("My projects", "Мои проекты", "Мої проєкти", "مشاريعي")} n={myProjects.length} more="/projects" empty={L("You are not in a project team yet.", "Вы пока не в команде проекта.", "Ви поки не в команді проєкту.", "لست في فريق مشروع بعد.")}>
          {myProjects.slice(0, 8).map((p) => { const s = projectStats(p, w.all || [], today); return <Link key={p.id} href={`/projects/${p.id}`} className="hub-row"><span style={{ minWidth: 0 }}><b>{p.title}</b><small>{s.nextMilestone ? `${T(L("Next", "Далее", "Далі", "التالي"))}: ${s.nextMilestone.title} · ${s.nextMilestone.data?.due || ""}` : `${s.open} ${T(L("open tasks", "открытых задач", "відкритих задач", "مهام مفتوحة"))}`}</small>
            <span className="bar" style={{ display: "block", marginTop: 4 }}><span style={{ width: `${s.progress}%` }} /></span></span><span className={`chip ${s.health === "late" ? "c-bad" : s.health === "risk" ? "c-warn" : "c-ok"}`}>{s.progress}%</span></Link>; })}</Box></div>
        {auto && auto.n > 0 && <div className="wide"><Box icon="cpu" title={L("Prepared by agents — approve in one click", "Подготовлено агентами — одобрите одним кликом", "Підготовлено агентами — схваліть одним кліком", "أعدّه الوكلاء — وافق بنقرة واحدة")} n={auto.n} empty={L("", "", "", "")}>
          {auto.items.map((q) => <Link key={q.id} href="/admin/system?tab=auto" className="hub-row"><span><b>{trA(q.title)}</b><small>{q.agent} · {q.at.slice(0, 10)}</small></span><span className="chip c-warn">{T(L("Review", "Посмотреть", "Переглянути", "مراجعة"))}</span></Link>)}</Box></div>}
        {d.company.length > 0 && <div className="wide"><Box icon="alert" title={L("Company: overdue items (leaders)", "Компания: просрочено (для руководства)", "Компанія: прострочено (для керівництва)", "الشركة: متأخرات")} n={d.company.length} more="/management" empty={L("", "", "", "")}>
          {d.company.slice(0, 10).map((x) => <Link key={x.r.id + x.k} href={href(x.r)} className="hub-row"><span><b>{x.r.title}</b><small>{tx(findSection(x.r.section)?.label, lang as Lang)}{x.r.data?.owner ? ` · ${x.r.data.owner}` : ""}</small></span><span className={`chip ${tone("Overdue")} c-bad`}>{rel(x.d)}</span></Link>)}</Box></div>}
      </div>
      <SinceLast />
    </div>
  );
}
