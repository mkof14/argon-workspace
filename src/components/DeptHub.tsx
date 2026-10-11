"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection, SECTIONS } from "./App";
import StageBoard from "./StageBoard";
import { DEPARTMENTS, DEPT_COLORS } from "@/config/workspace.config.mjs";
import { TEMPLATES } from "@/config/templates";
import { CHECKLISTS } from "./RecordDrawer";
import { workingDays } from "@/config/hr";
import { l2 } from "@/config/learn";
import { t, tx } from "@/lib/i18n";
import { Rec, store } from "@/lib/store";
import { OPEN, dayDiff } from "@/lib/insights";

type T2 = { en: string; ru: string };
const L = (en: string, ru: string): T2 => ({ en, ru });
type Item = { title: string; sub?: string; right?: string; tone?: "bad" | "warn" | "ok" | "info" | ""; href?: string };
type Kpi = { l: T2; v: string; s?: string; href?: string; tone?: string };
const n = (v: any) => Number(v) || 0;
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const rel = (d: number, lang: string) => (d < 0 ? t("days_late", lang as any).replace("{n}", String(-d)) : d === 0 ? t("today", lang as any) : t("in_days", lang as any).replace("{n}", String(d)));
const href = (r: Rec) => `/${r.section.replace(".", "/")}?r=${r.id}`;
const INTRO: Record<string, T2> = {
  hr: L("People, hiring, time off, onboarding and people compliance for the AGRON team in the US and the UAE.", "Люди, найм, отпуска, онбординг и кадровый комплаенс команды AGRON в США и ОАЭ."),
  technical: L("StarDome equipment, AGRON 1 software, integration, tests, certification and engineering changes.", "Оборудование StarDome, ПО AGRON 1, интеграция, испытания, сертификация и инженерные изменения."),
  operations: L("Container builds, procurement, logistics, installation, service and the installed StarDome base.", "Сборка контейнеров, закупки, логистика, монтаж, сервис и установленные системы StarDome."),
  finance: L("Cash, invoices, budget, costing and margins, leasing, investors, tax and insurance.", "Деньги, счета, бюджет, себестоимость и маржа, лизинг, инвесторы, налоги и страхование."),
  sales: L("StarDome pipeline, clients, proposals, tenders, partners and the weighted forecast.", "Воронка StarDome, клиенты, КП, тендеры, партнёры и взвешенный прогноз."),
  marketing: L("Leads, campaigns, events, content and the AGRON media library.", "Лиды, рассылки, выставки, контент и медиатека AGRON."),
  security: L("Sanctions screening, technology control, cyber risks, access reviews, incidents and audits.", "Санкционные проверки, контроль технологий, киберриски, доступы, инциденты и аудиты."),
  company: L("Tasks and reminders, meetings, decisions, procedures and contacts shared across AGRON.", "Задачи и напоминания, встречи, решения, регламенты и контакты AGRON."),
};
const checklistPct = (r: Rec, key = "steps", list = "onboard") => { const items = CHECKLISTS[list] || []; const v = r.data?.[key] || {}; const done = items.filter((_, i) => v[i]).length; return items.length ? Math.round((done / items.length) * 100) : 0; };

export default function DeptHub({ dept }: { dept: string }) {
  const { lang, access, tick } = useApp();
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const secs = SECTIONS.filter((s) => s.dept === dept && access.read.has(s.id));
  useEffect(() => { store.listMany(secs.map((s) => s.id)).then(setRecs).catch(() => setRecs([])); }, [dept, tick, access]); // eslint-disable-line
  const of = (id: string) => (recs || []).filter((r) => r.section === id);
  const has = (id: string) => access.read.has(id);
  const T = (x: T2) => l2(x, lang);
  const c = (DEPT_COLORS as any)[dept];

  const view = useMemo(() => {
    if (!recs) return null;
    const kpis: Kpi[] = []; const cards: React.ReactNode[] = [];
    const List = ({ title, icon, items, empty, more }: { title: T2; icon: string; items: Item[]; empty: T2; more?: string }) => (
      <div className="card hub-card"><div className="card-h"><h2><Icon n={icon} />{T(title)}</h2>{more && <Link href={more} className="btn ghost sm" style={{ marginInlineStart: "auto" }}>{t("open", lang)}</Link>}</div>
        <div className="feed">{items.length ? items.slice(0, 8).map((it, i) => {
          const body = <><span style={{ minWidth: 0 }}><b>{it.title}</b>{it.sub && <small>{it.sub}</small>}</span>{it.right && <span className={`chip ${it.tone ? "c-" + it.tone : ""}`}>{it.right}</span>}</>;
          return it.href ? <Link key={i} href={it.href} className="hub-row">{body}</Link> : <div key={i} className="hub-row">{body}</div>; })
          : <div className="empty" style={{ padding: 18 }}>{T(empty)}</div>}</div></div>);
    const Bars = ({ title, icon, rows, fmt = (v: number) => String(v), more }: { title: T2; icon: string; rows: { l: string; v: number; v2?: number; sub?: string }[]; fmt?: (v: number) => string; more?: string }) => {
      const max = Math.max(1, ...rows.map((r) => Math.max(r.v, r.v2 || 0)));
      return <div className="card hub-card"><div className="card-h"><h2><Icon n={icon} />{T(title)}</h2>{more && <Link href={more} className="btn ghost sm" style={{ marginInlineStart: "auto" }}>{t("open", lang)}</Link>}</div>
        <div className="card-b hub-bars">{rows.length ? rows.map((r) => <div key={r.l} className="hub-bar">
          <span className="hub-bar-l">{r.l}{r.sub && <small>{r.sub}</small>}</span>
          <span className="hub-bar-t"><i style={{ width: `${(r.v / max) * 100}%` }} />{r.v2 !== undefined && <i className="b2" style={{ width: `${(r.v2 / max) * 100}%` }} />}</span>
          <b className="mono">{fmt(r.v)}{r.v2 !== undefined ? ` / ${fmt(r.v2)}` : ""}</b></div>) : <div className="empty" style={{ padding: 10 }}>{t("empty", lang)}</div>}</div></div>;
    };
    const tplStrip = (ids: string[]) => <div className="toolbar" style={{ gap: 8 }}><span className="faint" style={{ fontSize: 13.5 }}><Icon n="file" /> {t("templates", lang)}:</span>
      {ids.map((id) => TEMPLATES.find((x) => x.id === id)).filter(Boolean).map((tp: any) => <Link key={tp.id} href={`/templates?t=${tp.id}`} className="btn ghost sm"><Icon n={tp.icon} />{l2(tp.name, lang)}</Link>)}</div>;
    let strip: React.ReactNode = null;

    /* ------------------------------ HR ------------------------------ */
    if (dept === "hr") {
      const team = of("hr.team"), active = team.filter((r) => r.status !== "Left");
      const leave = of("hr.leave"), cands = of("hr.candidates");
      const yr = String(new Date().getFullYear());
      const outNow = leave.filter((r) => ["Approved", "Taken"].includes(r.status || "") && r.data?.from <= today() && (r.data?.to || r.data?.from) >= today());
      const soon = leave.filter((r) => r.status === "Approved" && r.data?.from > today() && dayDiff(r.data.from) <= 14);
      kpis.push({ l: L("Headcount", "Численность"), v: String(team.filter((r) => r.status === "Active" || r.status === "On leave").length), s: `${team.filter((r) => r.status === "Onboarding").length} ${T(L("joining", "выходят"))}`, href: "/hr/team" });
      if (has("hr.hiring")) kpis.push({ l: L("Open positions", "Открытые вакансии"), v: String(of("hr.hiring").filter((r) => ["Open", "Interviewing", "Offer"].includes(r.status || "")).length), href: "/hr/hiring" });
      if (has("hr.candidates")) kpis.push({ l: L("Candidates in process", "Кандидаты в работе"), v: String(cands.filter((r) => !["Hired", "Rejected"].includes(r.status || "")).length), s: `${cands.filter((r) => r.data?.due && dayDiff(r.data.due) >= 0 && dayDiff(r.data.due) <= 7).length} ${T(L("interviews this week", "интервью на неделе"))}`, href: "/hr/candidates" });
      kpis.push({ l: L("Out today", "Отсутствуют сегодня"), v: String(outNow.length), s: `${soon.length} ${T(L("leaves in 14 days", "отпусков за 14 дней"))}`, href: "/hr/leave" });
      if (has("hr.compensation")) { const pay = of("hr.compensation").filter((r) => r.status === "Active"); kpis.push({ l: L("Annual payroll (base)", "Годовой ФОТ (оклады)"), v: usd(pay.reduce((a, r) => a + n(r.data?.salary), 0)), s: `${pay.length} ${T(L("employees", "сотрудников"))}`, href: "/hr/compensation" }); }

      // Org chart: people grouped under their manager
      const byMgr = new Map<string, Rec[]>(); for (const p of active) { const m = (p.data?.manager || "").trim(); byMgr.set(m, [...(byMgr.get(m) || []), p]); }
      const names = new Set(active.map((p) => p.title));
      const roots = active.filter((p) => !p.data?.manager || !names.has(p.data.manager));
      const node = (p: Rec, depth: number): React.ReactNode => depth > 6 ? null : <li key={p.id}><Link href={href(p)} className="org-node"><b>{p.title}</b><small>{[p.data?.position, p.data?.department].filter(Boolean).join(" · ")}</small>{p.status !== "Active" && <span className="chip c-info">{p.status}</span>}</Link>
        {(byMgr.get(p.title) || []).length > 0 && <ul>{(byMgr.get(p.title) || []).map((x) => node(x, depth + 1))}</ul>}</li>;
      cards.push(<div key="org" className="card hub-card wide"><div className="card-h"><h2><Icon n="users" />{T(L("Org chart", "Оргструктура"))}</h2><span className="faint" style={{ fontSize: 13 }}>{T(L("Built from “Reports to” in the people file", "Строится по полю «Руководитель» в карточке сотрудника"))}</span><Link href="/hr/team" className="btn ghost sm" style={{ marginInlineStart: "auto" }}>{t("open", lang)}</Link></div>
        <div className="card-b">{active.length ? <ul className="org">{roots.map((p) => node(p, 0))}</ul> : <div className="empty">{T(L("Add people in Team & org chart, with “Reports to”.", "Добавьте сотрудников в «Команда и оргструктура» с полем «Руководитель»."))}</div>}</div></div>);

      // Leave balances
      const bal = active.map((p) => {
        const taken = leave.filter((r) => (r.data?.person || "").toLowerCase() === p.title.toLowerCase() && ["Approved", "Taken"].includes(r.status || "") && r.data?.type !== "Sick leave" && r.data?.type !== "Public holiday" && String(r.data?.from || "").startsWith(yr))
          .reduce((a, r) => a + workingDays(r.data.from, r.data.to || r.data.from), 0);
        const allow = n(p.data?.leave_days) || 15; return { l: p.title, v: taken, v2: allow, sub: `${allow - taken} ${T(L("days left", "дн. осталось"))}` };
      });
      cards.push(<Bars key="bal" title={L(`Paid leave used in ${yr} (taken / allowance)`, `Использованный отпуск в ${yr} (взято / положено)`)} icon="sun" rows={bal} more="/hr/leave" />);
      cards.push(<List key="out" title={L("Who is out", "Кто отсутствует")} icon="calendar" more="/hr/leave"
        items={[...outNow.map((r) => ({ title: r.data?.person || r.title, sub: `${r.data?.type || ""} · ${r.data?.from} → ${r.data?.to || r.data?.from}`, right: T(L("out now", "сейчас")), tone: "warn" as const, href: href(r) })),
          ...soon.map((r) => ({ title: r.data?.person || r.title, sub: `${r.data?.type || ""} · ${r.data?.from} → ${r.data?.to || r.data?.from}`, right: rel(dayDiff(r.data.from), lang), tone: "info" as const, href: href(r) }))]}
        empty={L("Nobody is out in the next 14 days.", "В ближайшие 14 дней все на месте.")} />);
      // Compliance & dates
      const items: Item[] = [];
      for (const p of active) {
        if (p.data?.expires && dayDiff(p.data.expires) <= 90) items.push({ title: p.title, sub: T(L("Work authorization expires", "Истекает право на работу")) + ` · ${p.data.expires}`, right: rel(dayDiff(p.data.expires), lang), tone: dayDiff(p.data.expires) < 30 ? "bad" : "warn", href: href(p) });
        if (p.data?.probation && dayDiff(p.data.probation) >= -7 && dayDiff(p.data.probation) <= 30) items.push({ title: p.title, sub: T(L("Probation ends: review needed", "Конец испытательного срока: нужна оценка")), right: rel(dayDiff(p.data.probation), lang), tone: "info", href: href(p) });
        if (!p.data?.i9 && p.data?.location !== "UAE" && p.status !== "Left") items.push({ title: p.title, sub: T(L("Form I-9 not marked as completed", "Форма I-9 не отмечена")), right: "I-9", tone: "warn", href: href(p) });
        if (!p.data?.ciiaa) items.push({ title: p.title, sub: T(L("Confidentiality & IP agreement not signed", "Соглашение о конфиденциальности не подписано")), right: "CIIAA", tone: "warn", href: href(p) });
        if (p.data?.start) { const s = new Date(p.data.start); const nx = new Date(new Date().getFullYear(), s.getMonth(), s.getDate()); const d = dayDiff(nx.toISOString()); const yrs = nx.getFullYear() - s.getFullYear(); if (yrs > 0 && d >= 0 && d <= 30) items.push({ title: p.title, sub: T(L(`${yrs}-year work anniversary`, `${yrs} г. в компании`)), right: rel(d, lang), tone: "ok", href: href(p) }); }
      }
      for (const r of of("hr.training")) if (r.data?.expires && dayDiff(r.data.expires) <= 60 && r.status !== "Expired") items.push({ title: r.data?.person || r.title, sub: `${T(L("Certificate expires", "Истекает сертификат"))}: ${r.data?.course || r.title}`, right: rel(dayDiff(r.data.expires), lang), tone: "warn", href: href(r) });
      cards.push(<List key="cmp" title={L("People compliance and key dates", "Кадровый комплаенс и даты")} icon="clipboard" items={items} empty={L("All files complete; no dates in the next 30–90 days.", "Все карточки в порядке, ближайших дат нет.")} />);
      cards.push(<List key="onb" title={L("Onboarding and offboarding progress", "Прогресс онбординга и увольнений")} icon="rocket"
        items={[...of("hr.onboarding").filter(OPEN).map((r) => ({ title: r.data?.person || r.title, sub: `${T(L("Onboarding", "Онбординг"))} · ${r.data?.due || ""}`, right: `${checklistPct(r, "steps", "onboard")}%`, tone: "info" as const, href: href(r) })),
          ...of("hr.offboarding").filter(OPEN).map((r) => ({ title: r.data?.person || r.title, sub: `${T(L("Offboarding · last day", "Увольнение · последний день"))} ${r.data?.due || ""}`, right: `${checklistPct(r, "steps", "offboard")}%`, tone: "warn" as const, href: href(r) }))]}
        empty={L("No onboarding or offboarding in progress.", "Нет текущих онбордингов и увольнений.")} />);
      if (has("hr.candidates")) cards.push(<div key="cand" className="wide"><StageBoard sec="hr.candidates" rows={cands} sub={(r) => [r.data?.position, r.data?.source, r.data?.rating && `★ ${r.data.rating}`].filter(Boolean).join(" · ")} /></div>);
      strip = tplStrip(["offer_letter", "ciiaa", "onboarding", "job_description", "interview_scorecard", "separation_letter"]);
    }

    /* ------------------------------ Technical ------------------------------ */
    if (dept === "technical") {
      const eq = of("technical.equipment"), tests = of("technical.testing"), ecr = of("technical.changes"), it = of("technical.it"), bom = of("technical.bom");
      const passed = tests.filter((r) => r.status === "Passed").length, failed = tests.filter((r) => r.status === "Failed").length;
      kpis.push({ l: L("Equipment selected", "Оборудование выбрано"), v: `${eq.filter((r) => r.status === "Selected").length}/${eq.length}`, s: `${eq.filter((r) => !r.data?.matrix_id).length} ${T(L("not linked to compliance matrix", "без связи с матрицей"))}`, href: "/technical/equipment" });
      kpis.push({ l: L("Test pass rate", "Доля успешных тестов"), v: passed + failed ? `${Math.round((passed / (passed + failed)) * 100)}%` : "—", s: `${tests.filter((r) => ["Planned", "Running"].includes(r.status || "")).length} ${T(L("planned or running", "запланировано или идёт"))}`, href: "/technical/testing" });
      kpis.push({ l: L("Open engineering changes", "Открытые инженерные изменения"), v: String(ecr.filter((r) => ["Requested", "Assessing", "Approved"].includes(r.status || "")).length), s: `${ecr.filter((r) => r.data?.impact === "Compliance" && OPEN(r)).length} ${T(L("with compliance impact", "влияют на комплаенс"))}`, href: "/technical/changes" });
      if (has("technical.it")) kpis.push({ l: L("IT cost per month", "ИТ в месяц"), v: usd(it.filter((r) => r.status !== "Retired").reduce((a, r) => a + n(r.data?.monthly_cost), 0)), href: "/technical/it" });
      const cfgs = ["C20 Base", "C20 Enhanced", "C40 Base", "C40 Advanced", "C40 HQ"];
      cards.push(<Bars key="bom" title={L("Bill of materials cost per configuration", "Стоимость BOM по конфигурациям")} icon="layers" more="/technical/bom" fmt={usd} rows={cfgs.map((cf) => ({ l: `StarDome ${cf}`, v: bom.filter((r) => r.data?.config === cf && r.status !== "Superseded").reduce((a, r) => a + n(r.data?.qty || 1) * n(r.data?.unit_cost), 0), sub: `${bom.filter((r) => r.data?.config === cf).length} ${T(L("lines", "строк"))}` })).filter((x) => x.v > 0)} />);
      cards.push(<List key="unl" title={L("Equipment without compliance link", "Оборудование без проверки комплаенса")} icon="grid" more="/technical/equipment" items={eq.filter((r) => !r.data?.matrix_id && r.status !== "Rejected").map((r) => ({ title: r.title, sub: [r.data?.manufacturer, r.data?.model].filter(Boolean).join(" "), right: T(L("add matrix ID", "нужен ID матрицы")), tone: "warn" as const, href: href(r) }))} empty={L("Every candidate is linked to the compliance matrix.", "Всё оборудование связано с матрицей комплаенса.")} />);
      cards.push(<List key="cert" title={L("Certifications and failed tests", "Сертификация и проваленные тесты")} icon="badge" items={[...of("technical.certification").filter(OPEN).map((r) => ({ title: r.title, sub: [r.data?.scheme, r.data?.body].filter(Boolean).join(" · "), right: r.data?.due ? rel(dayDiff(r.data.due), lang) : r.status || "", tone: (r.data?.due && dayDiff(r.data.due) < 0 ? "bad" : "info") as any, href: href(r) })), ...tests.filter((r) => r.status === "Failed" || r.status === "Blocked").map((r) => ({ title: r.title, sub: r.data?.equipment, right: r.status || "", tone: "bad" as const, href: href(r) }))]} empty={L("No open certifications or failed tests.", "Нет открытой сертификации и проваленных тестов.")} />);
      if (has("technical.it")) cards.push(<List key="it" title={L("IT renewals in 60 days", "Продления ИТ за 60 дней")} icon="server" more="/technical/it" items={it.filter((r) => r.data?.renewal && dayDiff(r.data.renewal) <= 60 && r.status !== "Retired").map((r) => ({ title: r.title, sub: `${r.data?.vendor || ""} · ${usd(n(r.data?.monthly_cost))}/mo`, right: rel(dayDiff(r.data.renewal), lang), tone: "warn" as const, href: href(r) }))} empty={L("No renewals in the next 60 days.", "Продлений в ближайшие 60 дней нет.")} />);
      cards.push(<Bars key="sw" title={L("Software backlog by component", "Бэклог ПО по компонентам")} icon="code" more="/technical/software" rows={Object.entries(of("technical.software").filter(OPEN).reduce((a: any, r) => { const k = r.data?.component || "Other"; a[k] = (a[k] || 0) + 1; return a; }, {})).map(([l, v]) => ({ l, v: v as number }))} />);
      strip = tplStrip(["test_report", "ecr", "purchase_order"]);
    }

    /* ------------------------------ Operations ------------------------------ */
    if (dept === "operations") {
      const builds = of("operations.builds"), po = of("operations.procurement"), lg = of("operations.logistics"), fleet = of("operations.fleet"), sup = of("operations.support");
      const late = ["Shipping", "Installed"];
      kpis.push({ l: L("Builds in progress", "Сборки в работе"), v: String(builds.filter((r) => r.status !== "Installed").length), s: `${builds.filter((r) => r.data?.due && dayDiff(r.data.due) < 0 && r.status !== "Installed").length} ${T(L("late", "просрочено"))}`, href: "/operations/builds" });
      kpis.push({ l: L("Open purchase orders", "Открытые заказы"), v: String(po.filter((r) => ["Approved", "Ordered"].includes(r.status || "")).length), s: usd(po.filter((r) => ["Approved", "Ordered"].includes(r.status || "") && (r.data?.currency || "USD") === "USD").reduce((a, r) => a + n(r.data?.amount), 0)), href: "/operations/procurement" });
      kpis.push({ l: L("Shipments in transit / customs", "Грузы в пути / на таможне"), v: String(lg.filter((r) => ["In transit", "Customs"].includes(r.status || "")).length), href: "/operations/logistics" });
      kpis.push({ l: L("Open support tickets", "Открытые заявки сервиса"), v: String(sup.filter(OPEN).length), s: `${sup.filter((r) => OPEN(r) && ["High", "Critical"].includes(r.data?.severity)).length} ${T(L("high or critical", "высокий или критический"))}`, href: "/operations/support" });
      cards.push(<div key="sb" className="wide"><StageBoard sec="operations.builds" rows={builds} sub={(r) => [r.data?.client, r.data?.config && `StarDome ${r.data.config}`, r.data?.site, r.data?.owner].filter(Boolean).join(" · ")} /></div>);
      cards.push(<List key="gate" title={L("Export check before shipping", "Экспортная проверка перед отгрузкой")} icon="flag" more="/operations/builds" items={builds.filter((r) => ["Testing", ...late].includes(r.status || "") && r.data?.export_check !== "Cleared").map((r) => ({ title: r.title, sub: `${r.status} · ${r.data?.client || ""}`, right: r.data?.export_check || T(L("not started", "не начата")), tone: "bad" as const, href: href(r) }))} empty={L("All builds near shipping are export-cleared.", "Все сборки перед отгрузкой прошли экспортную проверку.")} />);
      cards.push(<List key="eta" title={L("Deliveries due in 14 days or late", "Поставки за 14 дней и просроченные")} icon="truck" more="/operations/procurement" items={po.filter((r) => r.status === "Ordered" && r.data?.eta && dayDiff(r.data.eta) <= 14).sort((a, b) => a.data.eta.localeCompare(b.data.eta)).map((r) => ({ title: r.title, sub: `${r.data?.vendor || ""} · ${r.data?.item || ""}${r.data?.build ? " · " + r.data.build : ""}`, right: rel(dayDiff(r.data.eta), lang), tone: (dayDiff(r.data.eta) < 0 ? "bad" : "info") as any, href: href(r) }))} empty={L("No deliveries due in the next 14 days.", "Поставок в ближайшие 14 дней нет.")} />);
      cards.push(<List key="fleet" title={L("Installed base: service and warranty", "Установленные системы: сервис и гарантия")} icon="map" more="/operations/fleet" items={[...fleet.filter((r) => r.data?.next_service && dayDiff(r.data.next_service) <= 30).map((r) => ({ title: r.title, sub: `${T(L("Service due", "Обслуживание"))} · ${r.data?.client || ""}`, right: rel(dayDiff(r.data.next_service), lang), tone: "warn" as const, href: href(r) })), ...fleet.filter((r) => r.data?.warranty_end && dayDiff(r.data.warranty_end) <= 90 && dayDiff(r.data.warranty_end) >= 0).map((r) => ({ title: r.title, sub: `${T(L("Warranty ends: offer extended support", "Конец гарантии: предложить продление"))} · ${r.data?.client || ""}`, right: rel(dayDiff(r.data.warranty_end), lang), tone: "info" as const, href: href(r) }))]} empty={L("No service or warranty dates in the next 30–90 days.", "Сервис и гарантия — без ближайших дат.")} />);
      cards.push(<List key="ncr" title={L("Quality: open non-conformances", "Качество: открытые несоответствия")} icon="check" more="/operations/quality" items={of("operations.quality").filter((r) => ["Non-conformance", "Corrective action"].includes(r.status || "")).map((r) => ({ title: r.title, sub: [r.data?.build, r.data?.check_type].filter(Boolean).join(" · "), right: r.status || "", tone: "bad" as const, href: href(r) }))} empty={L("No open non-conformances.", "Открытых несоответствий нет.")} />);
      strip = tplStrip(["purchase_order", "acceptance", "incident_report"]);
    }

    /* ------------------------------ Finance ------------------------------ */
    if (dept === "finance") {
      const inv = of("finance.invoices").filter((r) => r.status !== "Paid" && r.status !== "Draft");
      const bucket = (dir: string) => { const b = [0, 0, 0, 0, 0]; for (const r of inv.filter((x) => x.data?.direction === dir)) { const d = r.data?.due ? -dayDiff(r.data.due) : 0; const i = d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4; b[i] += n(r.data?.amount); } return b; };
      const ar = bucket("Receivable"), ap = bucket("Payable"); const labels = [T(L("Not due", "Не наступил")), "1–30", "31–60", "61–90", "90+"];
      kpis.push({ l: L("Receivable", "Дебиторка"), v: usd(ar.reduce((a, b) => a + b, 0)), s: `${usd(ar.slice(1).reduce((a, b) => a + b, 0))} ${T(L("overdue", "просрочено"))}`, href: "/finance/invoices" });
      kpis.push({ l: L("Payable", "Кредиторка"), v: usd(ap.reduce((a, b) => a + b, 0)), s: `${usd(ap.slice(1).reduce((a, b) => a + b, 0))} ${T(L("overdue", "просрочено"))}`, href: "/finance/invoices" });
      kpis.push({ l: L("Expenses awaiting approval", "Расходы на согласовании"), v: String(of("finance.expenses").filter((r) => r.status === "Submitted").length), s: usd(of("finance.expenses").filter((r) => r.status === "Submitted").reduce((a, r) => a + n(r.data?.amount), 0)), href: "/finance/expenses" });
      const cf = of("finance.cashflow").sort((a, b) => String(a.data?.month || a.title).localeCompare(String(b.data?.month || b.title)));
      let run = 0; const cfRows = cf.map((r) => { const net = n(r.data?.inflow) - n(r.data?.outflow); run += net; return { l: `${r.data?.month || r.title} · ${r.status}`, v: n(r.data?.inflow), v2: n(r.data?.outflow), sub: `${T(L("net", "сальдо"))} ${usd(net)} · ${T(L("cumulative", "нарастающим"))} ${usd(run)}` }; });
      if (cf.length) kpis.push({ l: L("Cumulative cash flow", "Накопленный денежный поток"), v: usd(run), s: `${cf.length} ${T(L("months", "мес."))}`, href: "/finance/cashflow", tone: run < 0 ? "bad" : "" });
      cards.push(<Bars key="ar" title={L("Receivables aging (days overdue)", "Дебиторка по срокам просрочки (дни)")} icon="coins" fmt={usd} more="/finance/invoices" rows={ar.map((v, i) => ({ l: labels[i], v }))} />);
      cards.push(<Bars key="ap" title={L("Payables aging (days overdue)", "Кредиторка по срокам просрочки (дни)")} icon="receipt" fmt={usd} more="/finance/invoices" rows={ap.map((v, i) => ({ l: labels[i], v }))} />);
      cards.push(<Bars key="bud" title={L("Budget: actual / planned", "Бюджет: факт / план")} icon="pie" fmt={usd} more="/finance/budget" rows={of("finance.budget").filter((r) => r.status !== "Closed").map((r) => ({ l: r.data?.department || r.title, v: n(r.data?.actual), v2: n(r.data?.planned), sub: n(r.data?.planned) ? `${Math.round((n(r.data?.actual) / n(r.data?.planned)) * 100)}%` : "" }))} />);
      cards.push(<Bars key="cf" title={L("Cash flow by month: in / out", "Движение денег по месяцам: приход / расход")} icon="trend" fmt={usd} more="/finance/cashflow" rows={cfRows} />);
      cards.push(<List key="mg" title={L("Margin by configuration", "Маржа по конфигурациям")} icon="calc" more="/finance/costing" items={of("finance.costing").map((r) => { const cost = n(r.data?.bom) + n(r.data?.labor) + n(r.data?.logistics_cost), price = n(r.data?.price), m = price ? Math.round(((price - cost) / price) * 100) : 0; return { title: r.title, sub: `${T(L("cost", "себестоимость"))} ${usd(cost)} · ${T(L("price", "цена"))} ${usd(price)}`, right: price ? `${m}%` : "—", tone: (m < 20 ? "bad" : m < 35 ? "warn" : "ok") as any, href: href(r) }; })} empty={L("Add costing for each configuration to see margins.", "Добавьте расчёт себестоимости, чтобы видеть маржу.")} />);
      cards.push(<List key="dates" title={L("Tax filings and insurance renewals", "Налоги и продление страховок")} icon="landmark" items={[...of("finance.tax").filter((r) => r.status !== "Filed" && r.data?.due).map((r) => ({ title: r.title, sub: r.data?.jurisdiction, right: rel(dayDiff(r.data.due), lang), tone: (dayDiff(r.data.due) < 14 ? "bad" : "info") as any, href: href(r) })), ...of("finance.insurance").filter((r) => r.data?.renewal && dayDiff(r.data.renewal) <= 60).map((r) => ({ title: r.title, sub: `${r.data?.type || ""} · ${r.data?.insurer || ""}`, right: rel(dayDiff(r.data.renewal), lang), tone: "warn" as const, href: href(r) }))]} empty={L("No filings or renewals coming up.", "Ближайших налоговых сроков и продлений нет.")} />);
      strip = tplStrip(["payment_request", "investor_update", "purchase_order"]);
    }

    /* ------------------------------ Sales ------------------------------ */
    if (dept === "sales") {
      const deals = of("sales.pipeline"), openD = deals.filter((r) => !["Won", "Lost"].includes(r.status || ""));
      kpis.push({ l: L("Tenders with deadlines in 30 days", "Тендеры со сроком за 30 дней"), v: String(of("sales.tenders").filter((r) => OPEN(r) && r.data?.deadline && dayDiff(r.data.deadline) >= 0 && dayDiff(r.data.deadline) <= 30).length), href: "/sales/tenders" });
      kpis.push({ l: L("Proposals awaiting answer", "КП ждут ответа"), v: String(of("sales.proposals").filter((r) => r.status === "Sent").length), s: `${of("sales.proposals").filter((r) => r.status === "Sent" && r.data?.valid_until && dayDiff(r.data.valid_until) <= 7).length} ${T(L("expire in 7 days", "истекают за 7 дней"))}`, href: "/sales/proposals" });
      kpis.push({ l: L("Meetings this week", "Встречи на неделе"), v: String(of("sales.activities").filter((r) => r.data?.date && Math.abs(dayDiff(r.data.date)) <= 7).length), href: "/sales/activities" });
      cards.push(<div key="sb" className="wide"><StageBoard sec="sales.pipeline" rows={deals} value={(r) => n(r.data?.value)} sub={(r) => [r.data?.client, r.data?.config && `StarDome ${r.data.config}`, r.data?.country, r.data?.owner].filter(Boolean).join(" · ")} /></div>);
      cards.push(<List key="scr" title={L("Deals that need sanctions screening", "Сделки без санкционной проверки")} icon="search" more="/sales/pipeline" items={openD.filter((r) => ["Proposal", "Negotiation"].includes(r.status || "") && r.data?.screening !== "Cleared").map((r) => ({ title: r.title, sub: `${r.status} · ${r.data?.client || ""} · ${r.data?.country || ""}`, right: r.data?.screening || T(L("not started", "не начата")), tone: "bad" as const, href: href(r) }))} empty={L("Every deal at proposal stage or later is screened.", "Все сделки на стадии КП и дальше проверены.")} />);
      cards.push(<Bars key="seg" title={L("Open pipeline by segment", "Воронка по сегментам")} icon="target" fmt={usd} rows={Object.entries(openD.reduce((a: any, r) => { const k = r.data?.segment || "Other"; a[k] = (a[k] || 0) + n(r.data?.value); return a; }, {})).map(([l, v]) => ({ l, v: v as number })).sort((a, b) => b.v - a.v)} />);
      cards.push(<Bars key="cty" title={L("Open pipeline by country", "Воронка по странам")} icon="globe" fmt={usd} rows={Object.entries(openD.reduce((a: any, r) => { const k = r.data?.country || "—"; a[k] = (a[k] || 0) + n(r.data?.value); return a; }, {})).map(([l, v]) => ({ l, v: v as number })).sort((a, b) => b.v - a.v).slice(0, 8)} />);
      cards.push(<List key="next" title={L("Next steps from meetings", "Следующие шаги после встреч")} icon="calendar" more="/sales/activities" items={of("sales.activities").filter((r) => r.data?.next_step).sort((a, b) => String(b.data?.date).localeCompare(String(a.data?.date))).map((r) => ({ title: r.data?.client || r.title, sub: r.data?.next_step, right: r.data?.date || "", href: href(r) }))} empty={L("Record meetings with a next step.", "Записывайте встречи со следующим шагом.")} />);
      strip = tplStrip(["proposal_cover", "call_report", "nda", "end_user"]);
    }

    /* ------------------------------ Marketing ------------------------------ */
    if (dept === "marketing") {
      const leads = of("marketing.leads"), camps = of("marketing.campaigns"), ev = of("marketing.events");
      const sent = camps.reduce((a, r) => a + n(r.data?.sent_count), 0), rep = camps.reduce((a, r) => a + n(r.data?.replies), 0), meet = camps.reduce((a, r) => a + n(r.data?.meetings), 0);
      kpis.push({ l: L("New leads", "Новые лиды"), v: String(leads.filter((r) => r.status === "New").length), s: `${leads.filter((r) => r.status === "To pipeline").length} ${T(L("passed to sales", "передано в продажи"))}`, href: "/marketing/leads" });
      kpis.push({ l: L("Email reply rate", "Доля ответов на рассылки"), v: sent ? `${((rep / sent) * 100).toFixed(1)}%` : "—", s: `${meet} ${T(L("meetings from campaigns", "встреч из рассылок"))}`, href: "/marketing/campaigns" });
      const evDone = ev.filter((r) => r.status === "Done"); const evCost = evDone.reduce((a, r) => a + n(r.data?.budget), 0), evLeads = evDone.reduce((a, r) => a + n(r.data?.leads), 0);
      kpis.push({ l: L("Cost per lead at events", "Цена лида на выставках"), v: evLeads ? usd(evCost / evLeads) : "—", s: `${evLeads} ${T(L("leads", "лидов"))} · ${usd(evCost)}`, href: "/marketing/events" });
      cards.push(<Bars key="src" title={L("Leads by source", "Лиды по источникам")} icon="target" more="/marketing/leads" rows={Object.entries(leads.reduce((a: any, r) => { const k = r.data?.source || "Other"; a[k] = (a[k] || 0) + 1; return a; }, {})).map(([l, v]) => ({ l, v: v as number })).sort((a, b) => b.v - a.v)} />);
      cards.push(<Bars key="funnel" title={L("Lead funnel", "Воронка лидов")} icon="funnel" more="/marketing/leads" rows={(findSection("marketing.leads")?.statuses || []).map((st: string) => ({ l: st, v: leads.filter((r) => r.status === st).length }))} />);
      cards.push(<List key="ev" title={L("Upcoming events", "Ближайшие выставки и события")} icon="calendar" more="/marketing/events" items={ev.filter((r) => r.data?.date && dayDiff(r.data.date) >= 0).sort((a, b) => a.data.date.localeCompare(b.data.date)).map((r) => ({ title: r.title, sub: `${r.data?.city || ""} · ${usd(n(r.data?.budget))}`, right: rel(dayDiff(r.data.date), lang), tone: "info" as const, href: href(r) }))} empty={L("No upcoming events.", "Ближайших событий нет.")} />);
      cards.push(<List key="cal" title={L("Content calendar, next 30 days", "Контент-план на 30 дней")} icon="pen" more="/marketing/content" items={of("marketing.content").filter((r) => r.data?.date && dayDiff(r.data.date) >= -3 && dayDiff(r.data.date) <= 30 && r.status !== "Published").map((r) => ({ title: r.title, sub: `${r.data?.channel || ""} · ${r.status}${r.data?.review ? " · " + T(L("review", "проверка")) + ": " + r.data.review : ""}`, right: rel(dayDiff(r.data.date), lang), tone: "info" as const, href: href(r) }))} empty={L("Nothing scheduled in the next 30 days.", "На 30 дней ничего не запланировано.")} />);
      cards.push(<List key="camp" title={L("Campaign results", "Результаты рассылок")} icon="mail" more="/marketing/campaigns" items={camps.filter((r) => n(r.data?.sent_count)).map((r) => ({ title: r.title, sub: `${n(r.data?.sent_count)} ${T(L("sent", "отправлено"))} · ${n(r.data?.replies)} ${T(L("replies", "ответов"))} · ${n(r.data?.meetings)} ${T(L("meetings", "встреч"))}`, right: `${((n(r.data?.replies) / n(r.data?.sent_count)) * 100).toFixed(1)}%`, href: href(r) }))} empty={L("Enter sent, replies and meetings for each campaign.", "Укажите отправлено, ответы и встречи по каждой рассылке.")} />);
    }

    /* ------------------------------ Security ------------------------------ */
    if (dept === "security") {
      const scr = of("security.screening"), inc = of("security.incidents"), cy = of("security.cyber"), tcp = of("security.tcp");
      kpis.push({ l: L("Screenings flagged or escalated", "Проверки с совпадениями"), v: String(scr.filter((r) => ["Flagged", "Escalated"].includes(r.status || "")).length), s: `${scr.filter((r) => r.status === "Pending").length} ${T(L("pending", "в ожидании"))}`, href: "/security/screening", tone: "bad" });
      kpis.push({ l: L("Incidents in 90 days", "Инциденты за 90 дней"), v: String(inc.filter((r) => r.data?.date && dayDiff(r.data.date) >= -90).length), s: `${inc.filter(OPEN).length} ${T(L("open", "открыто"))}`, href: "/security/incidents" });
      kpis.push({ l: L("Open cyber risks", "Открытые киберриски"), v: String(cy.filter((r) => ["Open", "Mitigating"].includes(r.status || "")).length), s: `${cy.filter((r) => ["Open", "Mitigating"].includes(r.status || "") && ["High", "Critical"].includes(r.data?.risk)).length} ${T(L("high or critical", "высокие"))}`, href: "/security/cyber" });
      kpis.push({ l: L("Technical data not yet classified", "Неклассифицированные техданные"), v: String(tcp.filter((r) => ["Unclassified", "Under review"].includes(r.status || "")).length), href: "/security/tcp" });
      cards.push(<List key="flag" title={L("Screening matches to resolve", "Совпадения в проверках")} icon="search" more="/security/screening" items={scr.filter((r) => ["Flagged", "Escalated", "Pending"].includes(r.status || "")).map((r) => ({ title: r.data?.party || r.title, sub: `${r.data?.party_type || ""} · ${r.data?.country || ""}${r.data?.imo ? " · IMO " + r.data.imo : ""}`, right: r.status || "", tone: (r.status === "Pending" ? "warn" : "bad") as any, href: href(r) }))} empty={L("No open screening issues.", "Открытых вопросов по проверкам нет.")} />);
      cards.push(<Bars key="tcp" title={L("Technology control plan: classification", "Контроль технологий: классификация")} icon="lock" more="/security/tcp" rows={(findSection("security.tcp")?.statuses || []).map((st: string) => ({ l: st, v: tcp.filter((r) => r.status === st).length }))} />);
      cards.push(<List key="acc" title={L("Access reviews due", "Проверки доступов")} icon="key" more="/security/access" items={of("security.access").filter((r) => r.status !== "Done").map((r) => ({ title: r.title, sub: `${r.data?.system || ""} · ${r.data?.owner || ""}`, right: r.data?.due ? rel(dayDiff(r.data.due), lang) : r.status || "", tone: (r.data?.due && dayDiff(r.data.due) < 0 ? "bad" : "info") as any, href: href(r) }))} empty={L("No access reviews pending.", "Ожидающих проверок доступов нет.")} />);
      cards.push(<Bars key="sev" title={L("Incidents by severity (90 days)", "Инциденты по серьёзности (90 дней)")} icon="alert" more="/security/incidents" rows={["Critical", "High", "Medium", "Low"].map((k) => ({ l: k, v: inc.filter((r) => r.data?.severity === k && r.data?.date && dayDiff(r.data.date) >= -90).length }))} />);
      cards.push(<List key="aud" title={L("Audit findings open", "Открытые замечания аудитов")} icon="clipboard" more="/security/audits" items={of("security.audits").filter((r) => r.status === "Findings open" || r.status === "In progress").map((r) => ({ title: r.title, sub: `${r.data?.standard || ""} · ${r.data?.area || ""}`, right: r.status || "", tone: "warn" as const, href: href(r) }))} empty={L("No open audit findings.", "Открытых замечаний нет.")} />);
      strip = tplStrip(["incident_report", "end_user", "ciiaa"]);
    }

    /* ------------------------------ Knowledge base ------------------------------ */
    if (dept === "company") {
      const tasks = of("company.tasks");
      kpis.push({ l: L("Open tasks", "Открытые задачи"), v: String(tasks.filter(OPEN).length), s: `${tasks.filter((r) => OPEN(r) && r.data?.due && dayDiff(r.data.due) < 0).length} ${T(L("overdue", "просрочено"))}`, href: "/company/tasks" });
      kpis.push({ l: L("Decisions proposed", "Решения на рассмотрении"), v: String(of("company.decisions").filter((r) => r.status === "Proposed").length), href: "/company/decisions" });
      cards.push(<Bars key="who" title={L("Open tasks by person", "Открытые задачи по людям")} icon="users" more="/company/tasks" rows={Object.entries(tasks.filter(OPEN).reduce((a: any, r) => { const k = r.data?.assignee || "—"; a[k] = (a[k] || 0) + 1; return a; }, {})).map(([l, v]) => ({ l, v: v as number })).sort((a, b) => b.v - a.v)} />);
      cards.push(<List key="act" title={L("Action items from recent meetings", "Поручения с последних встреч")} icon="calendar" more="/company/meetings" items={of("company.meetings").filter((r) => r.data?.actions).sort((a, b) => String(b.data?.date).localeCompare(String(a.data?.date))).map((r) => ({ title: r.title, sub: String(r.data.actions).split("\n")[0], right: r.data?.date || "", href: href(r) }))} empty={L("No action items recorded.", "Поручений нет.")} />);
      strip = tplStrip(["decision_memo", "meeting_agenda", "ceo_weekly"]);
    }
    return { kpis, cards, strip };
  }, [recs, dept, lang, access]); // eslint-disable-line

  if (!view) return <div className="empty">…</div>;
  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: c }}>
      <section className="dhero">
        <div className="dhero-top">
          <span className="dhero-ic"><Icon n={DEPARTMENTS.find((d: any) => d.key === dept)?.icon || "grid"} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="dhero-kicker">AGRON Inc. · {t("dept_overview", lang)}</div>
            <h2>{tx(DEPARTMENTS.find((d: any) => d.key === dept)?.label, lang)}</h2>
            <p>{T(INTRO[dept] || L("", ""))}</p>
          </div>
        </div>
        {view.kpis.length > 0 && <div className="dhero-stats">{view.kpis.map((k) => (
          <Link key={k.l.en} href={k.href || "#"} className={`dstat ${k.tone === "bad" && k.v !== "0" ? "bad" : ""}`}>
            <b>{k.v}</b><span>{T(k.l)}</span>{k.s && <small>{k.s}</small>}</Link>))}</div>}
      </section>
      {view.strip}
      <div className="hub-grid">{view.cards}</div>
      <div className="toolbar">{secs.map((s) => <Link key={s.id} href={`/${s.dept}/${s.key}`} className="btn ghost sm"><Icon n={s.icon} />{tx(s.label, lang)}</Link>)}</div>
    </div>
  );
}
