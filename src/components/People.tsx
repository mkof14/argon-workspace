"use client";
// PEOPLE: who works here, in which department, with which manager, on which projects, and how much is on their plate.
// The same accounts as sign-in (no second user list); people who left stay listed as inactive so history still reads.
import { useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { ORG_DEPTS, ROLES, ROLE_COLORS } from "@/config/workspace.config.mjs";
import { useWork } from "./useWork";
import { workload } from "@/lib/work";
import { deptLabel, personName, deptChoices, deptObjs, useDepartments } from "./PeopleFields";
import { isExternal, type Profile } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

export default function People() {
  const { lang, people, me, access } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const depts = useDepartments();
  const w = useWork(); const load = useMemo(() => workload(w.tasks), [w.tasks]);
  const [q, setQ] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(location.search).get("q") || "" : "")); const [dept, setDept] = useState(""); const [inactive, setInactive] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const isAdmin = ["owner", "admin"].includes(me.role);
  const staff = people.filter((p) => !isExternal(p.role) && p.role !== "pending");
  const shown = staff.filter((p) => (inactive || !p.disabled) && (!dept || (dept === "-" ? !p.department : p.department === dept)) && (!q || `${p.full_name} ${p.email} ${p.title || ""} ${deptLabel(p.department, lang as Lang)}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0) || personName(a).localeCompare(personName(b)));
  const projectsOf = (p: Profile) => w.projects.filter((x) => x.data?.manager_id === p.id || (Array.isArray(x.data?.members_ids) && x.data.members_ids.includes(p.id)));
  const byDept = deptObjs(depts).map((d: any) => ({ d, n: staff.filter((p) => !p.disabled && p.department === d.key).length })).filter((x) => x.n);
  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#0EA5E9" }}>
    <section className="sec-hero"><span className="ic"><Icon n="users" /></span>
      <div style={{ minWidth: 0, position: "relative", zIndex: 1 }}><div className="eyebrow">{T(L("Company", "Компания", "Компанія", "الشركة"))}</div><h2>{T(L("People", "Сотрудники", "Співробітники", "الموظفون"))}</h2>
        <div className="sub"><b className="mono">{staff.filter((p) => !p.disabled).length}</b> {T(L("active", "активных", "активних", "نشط"))} · {byDept.length} {T(L("departments", "отделов", "відділів", "أقسام"))}</div></div>
      {isAdmin && <div className="stats"><Link className="btn" href="/admin/users"><Icon n="userplus" />{T(L("Invite an employee", "Пригласить сотрудника", "Запросити співробітника", "دعوة موظف"))}</Link></div>}</section>
    <section className="card">
      <div className="filters">
        <div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T(L("Name, position, department", "Имя, должность, отдел", "Ім'я, посада, відділ", "الاسم أو المنصب أو القسم"))} aria-label={T(L("Search people", "Поиск сотрудников", "Пошук співробітників", "ابحث عن موظفين"))} /></div>
        <select className="input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label={T(L("Department", "Отдел", "Відділ", "القسم"))}><option value="">{T(L("All departments", "Все отделы", "Усі відділи", "كل الأقسام"))}</option><option value="-">{T(L("No department yet", "Отдел не указан", "Відділ не вказано", "بلا قسم بعد"))}</option>{deptChoices(depts, lang as Lang).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
        <label className="check" style={{ fontSize: 13.5 }}><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />{T(L("Show inactive", "Показать неактивных", "Показати неактивних", "إظهار غير النشطين"))}</label>
      </div>
      <div className="people-grid">{shown.map((p) => { const c = (ROLE_COLORS as any)[p.role]; const wl = load.get(p.id); const pr = projectsOf(p); const mgr = people.find((x) => x.id === p.manager_id); const on = open === p.id;
        return <div key={p.id} className={`person-card ${p.disabled ? "inactive" : ""}`} data-person={p.id}>
          <div className="toolbar" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <span className="avatar" style={{ background: `color-mix(in srgb,${c} 18%,var(--surface))`, color: c, borderColor: "transparent", width: 42, height: 42, fontSize: 16 }}>{(personName(p) || "?").slice(0, 1).toUpperCase()}</span>
            <div style={{ minWidth: 0, flex: 1 }}><b>{personName(p)}</b>{p.disabled && <span className="chip" style={{ marginInlineStart: 6 }}>{T(L("inactive", "неактивен", "неактивний", "غير نشط"))}</span>}
              <div className="faint" style={{ fontSize: 13 }}>{[p.title, deptLabel(p.department, lang as Lang)].filter(Boolean).join(" · ") || tx((ROLES as any)[p.role]?.label, lang as Lang)}</div></div>
            {wl && <span className={`chip mono ${wl.overdue ? "c-bad" : wl.open > 8 ? "c-warn" : ""}`} title={T(L("Open tasks", "Открытые задачи", "Відкриті задачі", "مهام مفتوحة"))}>{wl.open}</span>}
          </div>
          <div className="pc-facts">
            <a href={`mailto:${p.email}`}><Icon n="mail" />{p.email}</a>{p.phone && <a href={`tel:${p.phone}`}><Icon n="contact" />{p.phone}</a>}
            {mgr && <span><Icon n="user" />{T(L("Manager", "Руководитель", "Керівник", "المدير"))}: {personName(mgr)}</span>}
            <span><Icon n="key" />{tx((ROLES as any)[p.role]?.label, lang as Lang)}</span>
          </div>
          {(pr.length > 0 || wl) && <button className="linkbtn" aria-expanded={on} onClick={() => setOpen(on ? null : p.id)}>{on ? T(L("Hide", "Скрыть", "Сховати", "إخفاء")) : `${T(L("Projects", "Проекты", "Проєкти", "المشاريع"))}: ${pr.length} · ${T(L("tasks", "задачи", "задачі", "مهام"))}: ${wl?.open || 0}${wl?.overdue ? ` (${wl.overdue} ${T(L("overdue", "просрочено", "прострочено", "متأخرة"))})` : ""}`}</button>}
          {on && <div className="pc-more">
            {pr.map((x) => <Link key={x.id} href={`/projects/${x.id}`} className="chip">{x.title}{x.data?.manager_id === p.id ? ` · ${T(L("PM", "РП", "КП", "مدير"))}` : ""}</Link>)}
            {(wl?.tasks || []).slice(0, 6).map((t) => <Link key={t.id} href={`/company/tasks?r=${t.id}`} className="hub-row"><span><b>{t.title}</b><small>{t.data?.due || ""} · {t.status}</small></span></Link>)}
          </div>}
          {!p.disabled && access.write.has("company.tasks") && <Link className="btn ghost sm" href={`/company/tasks?new=1&assignee_id=${p.id}`}><Icon n="plus" />{T(L("Assign a task", "Назначить задачу", "Призначити задачу", "إسناد مهمة"))}</Link>}
        </div>; })}
        {!shown.length && <div className="empty">{T(L("Nobody found.", "Никого не найдено.", "Нікого не знайдено.", "لم يُعثر على أحد."))}</div>}</div>
    </section>
    {isAdmin && <p className="faint" style={{ margin: 0, fontSize: 13 }}>{T(L("Departments, positions and managers are set in Administration → Users.", "Отдел, должность и руководитель задаются в «Администрирование» → «Пользователи».", "Відділ, посада й керівник задаються в «Адміністрування» → «Користувачі».", "تُضبط الأقسام والمناصب والمدراء في الإدارة ← المستخدمون."))}</p>}
  </div>;
}
