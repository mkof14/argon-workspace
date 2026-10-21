"use client";
// PORTFOLIO (Phase 5): Company → Portfolio / Program → Project → Milestone → Task. Each portfolio and project shows
// the database's health level with its reasons; progress is completed tasks / tasks (or milestones reached when a
// project has no tasks), never a guess. Only portfolios and projects the viewer may open are counted.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { mgmt } from "@/lib/mgmtApi";
import { LEVELS, healthReason, say, type Level, type T4 } from "@/lib/mgmt";
import { LevelChip, Reasons } from "./ExecControl";

const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Tab = "all" | "active" | "attention" | "risk" | "critical" | "completed" | "healthy";
const TABS: [Tab, T4][] = [["all", L("All", "Все", "Усі", "الكل")], ["active", L("Active", "Активные", "Активні", "نشطة")], ["attention", LEVELS.attention], ["risk", LEVELS.risk], ["critical", LEVELS.critical], ["completed", L("Completed", "Завершённые", "Завершені", "مكتملة")]];
const qs = (k: string) => (typeof window !== "undefined" ? new URLSearchParams(location.search).get(k) || "" : "");
const fits = (tab: Tab, p: any) => tab === "all" ? true : tab === "active" ? p.level !== "closed" : tab === "completed" ? p.level === "closed" : p.level === tab;
const BASIS: Record<string, T4> = { tasks: L("completed tasks / tasks", "выполненные задачи / все задачи", "виконані задачі / усі задачі", "المهام المكتملة / كل المهام"), milestones: L("milestones reached / milestones", "достигнутые вехи / все вехи", "досягнуті віхи / усі віхи", "المراحل المنجزة / كل المراحل"), none: L("no tasks or milestones yet", "задач и вех пока нет", "задач і віх поки немає", "لا مهام ولا مراحل بعد") };

export default function Portfolio() {
  const { lang, people, access } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>(((qs("tab") as Tab) || "all")); const [sel, setSel] = useState<string>(qs("p")); const [openP, setOpenP] = useState("");
  useEffect(() => { mgmt.portfolio().then(setRows).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { const f = () => { const t = qs("tab") as Tab; if (t) setTab(t); setSel(qs("p")); }; addEventListener("popstate", f); return () => removeEventListener("popstate", f); }, []);
  const name = (id?: string | null) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.email : ""; };
  const groups = useMemo(() => (rows || []).filter((g) => !sel || g.portfolio_id === sel || (sel === "none" && !g.portfolio_id)), [rows, sel]);
  const counts = useMemo(() => { const all = (rows || []).flatMap((g) => g.projects || []); return Object.fromEntries(TABS.map(([k]) => [k, all.filter((p: any) => fits(k, p)).length])); }, [rows]);
  if (err) return <div className="card empty">{err}</div>;
  if (!rows) return <div className="card empty">…</div>;
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#7C5CFF" }}>
    <section className="dhero"><div className="dhero-top"><span className="dhero-ic"><Icon n="grid" /></span><div style={{ minWidth: 0 }}>
      <div className="dhero-kicker">{T(L("Company → Portfolio → Project → Milestone → Task", "Компания → Портфель → Проект → Веха → Задача", "Компанія → Портфель → Проєкт → Віха → Задача", "الشركة ← المحفظة ← المشروع ← المرحلة ← المهمة"))}</div>
      <h2>{T(L("Portfolio", "Портфель", "Портфель", "المحفظة"))}</h2>
      <p>{T(L("Health is calculated from the records you can open; every level shows its reasons.", "Состояние считается по доступным вам записям; у каждого уровня есть причины.", "Стан рахується за доступними вам записами; кожен рівень має причини.", "تُحسب الصحة من السجلات المتاحة لك؛ ولكل مستوى أسبابه."))}</p></div></div></section>
    <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
      <nav className="seg" style={{ flexWrap: "wrap" }}>{TABS.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{T(l)} <b className="mono">{counts[k]}</b></button>)}</nav>
      <select className="input" style={{ width: "auto" }} value={sel} onChange={(e) => setSel(e.target.value)} aria-label={T(L("Portfolio", "Портфель", "Портфель", "المحفظة"))}>
        <option value="">{T(L("All portfolios", "Все портфели", "Усі портфелі", "كل المحافظ"))}</option>
        {rows.filter((g) => g.portfolio_id).map((g) => <option key={g.portfolio_id} value={g.portfolio_id}>{g.name}</option>)}
        {rows.some((g) => !g.portfolio_id) && <option value="none">{T(L("Not in a portfolio", "Вне портфеля", "Поза портфелем", "خارج المحافظ"))}</option>}</select>
      {access.write.has("company.portfolios") && <Link className="btn ghost sm" style={{ marginInlineStart: "auto" }} href="/company/portfolios"><Icon n="edit" />{T(L("Manage portfolios", "Управлять портфелями", "Керувати портфелями", "إدارة المحافظ"))}</Link>}
    </div>
    {groups.map((g) => { const list = (g.projects || []).filter((p: any) => fits(tab, p)); if (!list.length && tab !== "all") return null; const lv = g.levels || {};
      return <section key={g.portfolio_id || "none"} className="card">
        <div className="card-h" style={{ flexWrap: "wrap", gap: 8 }}><h2><Icon n="layers" />{g.portfolio_id ? <Link href={g.link} style={{ color: "inherit" }}>{g.name}</Link> : T(L("Not in a portfolio", "Вне портфеля", "Поза портфелем", "خارج المحافظ"))}</h2>
          {g.portfolio_id && <LevelChip level={g.level} />}
          <span className="faint" style={{ fontSize: 13 }}>{[g.status, g.priority, name(g.owner_id), g.target ? `${T(L("target", "цель", "ціль", "الهدف"))} ${g.target}` : ""].filter(Boolean).join(" · ")}</span>
          <span className="chip mono" style={{ marginInlineStart: "auto" }}>{T(L("progress", "прогресс", "прогрес", "التقدم"))} {pct(g.progress)}</span></div>
        {g.description && <p className="faint" style={{ margin: "0 16px 8px" }}>{g.description}</p>}
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 6, padding: "0 16px 8px" }}>
          {(["healthy", "attention", "risk", "critical"] as Level[]).map((k) => <span key={k} className={`chip ${k === "healthy" ? "c-ok" : k === "attention" ? "c-warn" : "c-bad"}`}>{T(LEVELS[k])} {lv[k] ?? 0}</span>)}
          <span className="chip">{T(L("overdue", "просрочено", "прострочено", "متأخر"))} {g.overdue}</span><span className="chip">{T(L("blocked", "заблокировано", "заблоковано", "معطل"))} {g.blocked}</span>
          <span className="chip">{T(L("decisions waiting", "решений ждут", "рішень чекають", "قرارات معلقة"))} {g.pending_decisions}</span><span className="chip">{T(L("approvals waiting", "согласований ждут", "погоджень чекають", "موافقات معلقة"))} {g.pending_approvals}</span>
          {g.next_milestone && <Link className="chip c-info" href={`/projects/${g.next_milestone.project_id}`}>{T(L("next milestone", "следующая веха", "наступна віха", "المرحلة التالية"))}: {g.next_milestone.title} · {g.next_milestone.due}</Link>}
        </div>
        {(g.risks || []).length > 0 && <div style={{ padding: "0 16px 8px" }} className="faint">{T(L("Risks", "Риски", "Ризики", "المخاطر"))}: {(g.risks || []).slice(0, 4).map((r: any) => `${r.project} — ${r.reason ? healthReason(r.reason, lang) : say(LEVELS[r.level as Level], lang)}`).join("; ")}</div>}
        <div className="feed" style={{ padding: "0 8px 8px" }}>
          {!list.length ? <div className="empty" style={{ padding: 12 }}>{T(L("No projects you can open here.", "Здесь нет доступных вам проектов.", "Тут немає доступних вам проєктів.", "لا مشاريع متاحة لك هنا."))}</div>
            : list.map((p: any) => { const on = openP === p.id; return <div key={p.id} className="hub-row" style={{ alignItems: "flex-start" }}>
              <button className="linkish" style={{ minWidth: 0, flex: 1, display: "grid", gap: 2 }} onClick={() => setOpenP(on ? "" : p.id)} aria-expanded={on}>
                <b>{p.title}</b>
                <small>{[p.status, name(p.manager_id) || T(L("no owner", "нет руководителя", "немає керівника", "بلا مالك")), p.target ? `${T(L("deadline", "срок", "термін", "الموعد"))} ${p.target}` : "", p.next_milestone ? `${T(L("next", "далее", "далі", "التالي"))}: ${p.next_milestone.title} ${p.next_milestone.due}` : ""].filter(Boolean).join(" · ")}</small>
                <span className="bar" style={{ display: "block", marginTop: 4 }} title={T(BASIS[p.progress_basis] || BASIS.none)}><span style={{ width: `${p.progress ?? 0}%` }} /></span>
                {on && <div style={{ marginTop: 6 }}><Reasons reasons={p.reasons} /><small className="faint">{T(L("Progress {p}: {b}", "Прогресс {p}: {b}", "Прогрес {p}: {b}", "التقدم {p}: {b}"), { p: pct(p.progress), b: T(BASIS[p.progress_basis] || BASIS.none) })}</small></div>}
              </button>
              <LevelChip level={p.level} score={p.score} />
              <Link className="btn ghost sm" href={`/projects/${p.id}`}><Icon n="chev" /></Link>
            </div>; })}
        </div>
      </section>; })}
  </div>;
}
