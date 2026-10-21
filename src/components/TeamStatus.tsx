"use client";
// TEAM STATUS (Phase 5): who is where, their local time, the availability they set themselves, and what they are
// responsible for — among the projects and tasks the VIEWER may open. No map, no presence tracking, no score.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { mgmt } from "@/lib/mgmtApi";
import { AVAILABILITY, localTime, say, type T4 } from "@/lib/mgmt";

const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const AV_TONE: Record<string, string> = { available: "c-ok", busy: "c-warn", away: "c-info", out_of_office: "c-bad", off: "" };

export default function TeamStatus() {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState("");
  const [q, setQ] = useState(""); const [dept, setDept] = useState(""); const [proj, setProj] = useState(""); const [tz, setTz] = useState(""); const [av, setAv] = useState("");
  const [, setNow] = useState(0);
  useEffect(() => { mgmt.team().then(setRows).catch((e) => setErr(e.message)); const t = setInterval(() => setNow((n) => n + 1), 60e3); return () => clearInterval(t); }, []);
  const opts = useMemo(() => {
    const d = new Map<string, string>(), p = new Map<string, string>(), z = new Set<string>();
    for (const r of rows || []) { if (r.department_id) d.set(r.department_id, r.department || "—"); for (const x of r.projects || []) p.set(x.id, x.title); if (r.timezone) z.add(r.timezone); }
    return { d: [...d.entries()].sort((a, b) => a[1].localeCompare(b[1])), p: [...p.entries()].sort((a, b) => a[1].localeCompare(b[1])), z: [...z].sort() };
  }, [rows]);
  const list = useMemo(() => (rows || []).filter((r) => (!q || `${r.name} ${r.title || ""} ${r.department || ""} ${r.location || ""}`.toLowerCase().includes(q.toLowerCase()))
    && (!dept || r.department_id === dept) && (!proj || (r.projects || []).some((x: any) => x.id === proj)) && (!tz || r.timezone === tz) && (!av || (r.availability || "unknown") === av)), [rows, q, dept, proj, tz, av]);
  if (err) return <div className="card empty">{err}</div>;
  if (!rows) return <div className="card empty">…</div>;
  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#0EA5E9" }}>
    <nav className="seg"><Link href="/people" style={{ padding: "6px 12px", fontWeight: 600, textDecoration: "none", color: "var(--ink-2)", display: "inline-flex", gap: 6, alignItems: "center" }}><Icon n="users" />{T(L("Directory", "Справочник", "Довідник", "الدليل"))}</Link><span className="on" style={{ padding: "6px 12px", fontWeight: 600, display: "inline-flex", gap: 6, alignItems: "center" }}><Icon n="clock" />{T(L("Team status", "Статус команды", "Статус команди", "حالة الفريق"))}</span></nav>
    <section className="card"><div className="filters" style={{ flexWrap: "wrap" }}>
      <input className="input" placeholder={T(L("Search people", "Поиск сотрудников", "Пошук співробітників", "البحث عن أشخاص"))} value={q} onChange={(e) => setQ(e.target.value)} aria-label={T(L("Search", "Поиск", "Пошук", "بحث"))} />
      <select className="input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label={T(L("Department", "Отдел", "Відділ", "القسم"))}><option value="">{T(L("All departments", "Все отделы", "Усі відділи", "كل الأقسام"))}</option>{opts.d.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      <select className="input" value={proj} onChange={(e) => setProj(e.target.value)} aria-label={T(L("Project", "Проект", "Проєкт", "المشروع"))}><option value="">{T(L("All projects", "Все проекты", "Усі проєкти", "كل المشاريع"))}</option>{opts.p.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      <select className="input" value={tz} onChange={(e) => setTz(e.target.value)} aria-label={T(L("Time zone", "Часовой пояс", "Часовий пояс", "المنطقة الزمنية"))}><option value="">{T(L("All time zones", "Все часовые пояса", "Усі часові пояси", "كل المناطق الزمنية"))}</option>{opts.z.map((z) => <option key={z}>{z}</option>)}</select>
      <select className="input" value={av} onChange={(e) => setAv(e.target.value)} aria-label={T(L("Availability", "Доступность", "Доступність", "التوفر"))}><option value="">{T(L("Any availability", "Любая доступность", "Будь-яка доступність", "أي توفر"))}</option>{Object.keys(AVAILABILITY).map((k) => <option key={k} value={k}>{T(AVAILABILITY[k])}</option>)}<option value="unknown">{T(L("Not set", "Не указано", "Не вказано", "غير محدد"))}</option></select>
      <Link className="btn ghost sm" href="/me#availability" style={{ marginInlineStart: "auto" }}><Icon n="edit" />{T(L("Set my status", "Мой статус", "Мій статус", "حالتي"))}</Link>
    </div>
    <p className="faint" style={{ margin: "0 16px 12px", fontSize: 13 }}>{T(L("Availability is what each person sets; it is never measured. Responsibilities list only projects and tasks you can open.", "Доступность человек указывает сам — она не измеряется. Обязанности — только из проектов и задач, доступных вам.", "Доступність людина вказує сама — вона не вимірюється. Обов'язки — лише з проєктів і задач, доступних вам.", "التوفر يحدده كل شخص بنفسه ولا يُقاس. المسؤوليات من المشاريع والمهام المتاحة لك فقط."))}</p></section>
    <div className="team-grid">{list.map((r) => { const lt = localTime(r.timezone); return <article key={r.person_id} className="card team-card">
      <div className="who"><span className="avatar">{(r.name || "?").slice(0, 1).toUpperCase()}</span><div style={{ minWidth: 0 }}><b>{r.name}</b><small className="faint" style={{ display: "block" }}>{[r.title, r.department].filter(Boolean).join(" · ")}</small></div>
        {r.availability ? <span className={`chip ${AV_TONE[r.availability] || ""}`} style={{ marginInlineStart: "auto" }} title={r.availability_note || undefined}>{T(AVAILABILITY[r.availability])}</span> : null}</div>
      <small className="faint">{[r.location, r.timezone ? `${r.timezone}${lt ? ` · ${lt}` : ""}` : "", r.availability_until ? `${T(L("until", "до", "до", "حتى"))} ${String(r.availability_until).slice(0, 10)}` : "", r.availability_note].filter(Boolean).join(" · ") || "—"}</small>
      {(r.projects || []).length > 0 && <div className="chipbar">{r.projects.slice(0, 6).map((p: any) => <Link key={p.id + p.as} className={`chip ${p.as === "manager" ? "c-info" : ""}`} href={`/projects/${p.id}`}>{p.title}{p.as === "manager" ? ` · ${T(L("owner", "руководитель", "керівник", "مالك"))}` : ""}</Link>)}</div>}
      {(r.assignments || []).length > 0 && <div className="feed">{r.assignments.map((a: any) => <Link key={a.id} href={`/company/tasks?r=${a.id}`} className="hub-row" style={{ padding: "4px 6px" }}><span style={{ minWidth: 0 }}><b style={{ fontSize: 13.5 }}>{a.title}</b><small>{[a.project, a.status, a.due ? `${T(L("due", "срок", "термін", "الموعد"))} ${a.due}` : ""].filter(Boolean).join(" · ")}</small></span></Link>)}</div>}
      <small className="faint">{T(L("Open tasks {n} · overdue {o} · blocked {b}", "Открытых задач {n} · просрочено {o} · заблокировано {b}", "Відкритих задач {n} · прострочено {o} · заблоковано {b}", "مهام مفتوحة {n} · متأخرة {o} · معطلة {b}"), { n: r.open_tasks, o: r.overdue_tasks, b: r.blocked_tasks })}</small>
    </article>; })}</div>
    {!list.length && <div className="card empty">{T(L("Nobody matches.", "Никого не найдено.", "Нікого не знайдено.", "لا أحد مطابق."))}</div>}
  </div>;
}
