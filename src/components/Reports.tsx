"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection, SECTIONS } from "./App";
import { DEPARTMENTS, DEPT_COLORS } from "@/config/workspace.config.mjs";
import { t, tx } from "@/lib/i18n";
import { Activity, Rec, store } from "@/lib/store";
import { DONE, OPEN, dueItems, isMine, money } from "@/lib/insights";
import { elementToPdf, saveBlob, tone } from "@/lib/format";

const num = (v: any) => Number(v) || 0;

export default function Reports() {
  const { lang, me, access, tick, openAi, openMail, toast } = useApp();
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [act, setAct] = useState<Activity[]>([]);
  const [dept, setDept] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const secs = SECTIONS.filter((s) => access.read.has(s.id) && s.view !== "mail").map((s) => s.id);
    store.listMany(secs).then(setRecs).catch(() => setRecs([]));
    store.activity({ limit: 300 }).then(setAct).catch(() => {});
  }, [access, tick]);

  const d = useMemo(() => {
    const all = (recs || []).filter((r) => r.section !== "legal.matrix");
    const of = (s: string) => all.filter((r) => r.section === s);
    const due = dueItems(all, 14);
    const overdue = due.filter((x) => x.d < 0);
    const deals = of("sales.pipeline"), open = deals.filter((r) => !["Won", "Lost"].includes(r.status || ""));
    const q0 = new Date(); q0.setMonth(Math.floor(q0.getMonth() / 3) * 3, 1); const qs = q0.toISOString().slice(0, 10);
    const won = deals.filter((r) => r.status === "Won" && (r.updated_at || "") >= qs);
    const inv = of("finance.invoices").filter((r) => r.status !== "Paid");
    const recv = inv.filter((r) => r.data?.direction === "Receivable"), pay = inv.filter((r) => r.data?.direction === "Payable");
    const matrix = (recs || []).filter((r) => r.section === "legal.matrix");
    const week = new Date(Date.now() - 7 * 864e5).toISOString();
    const kpis = [
      access.read.has("sales.pipeline") && { l: t("r_pipeline", lang), v: money(open.reduce((a, r) => a + num(r.data?.value), 0)), s: `${open.length} ${t("r_deals", lang)}`, c: DEPT_COLORS.sales, href: "/sales/pipeline", i: "funnel" },
      access.read.has("sales.pipeline") && { l: t("r_won_q", lang), v: money(won.reduce((a, r) => a + num(r.data?.value), 0)), s: `${won.length} ${t("r_deals", lang)}`, c: DEPT_COLORS.sales, href: "/sales/pipeline", i: "trend" },
      access.read.has("finance.invoices") && { l: t("r_receivable", lang), v: money(recv.reduce((a, r) => a + num(r.data?.amount), 0)), s: `${t("r_payable", lang)} ${money(pay.reduce((a, r) => a + num(r.data?.amount), 0))}`, c: DEPT_COLORS.finance, href: "/finance/invoices", i: "coins" },
      access.read.has("operations.builds") && { l: t("r_builds", lang), v: String(of("operations.builds").filter((r) => r.status !== "Installed").length), s: `${of("operations.builds").filter((r) => r.status === "Installed").length} ${t("r_installed", lang)}`, c: DEPT_COLORS.operations, href: "/operations/builds", i: "container" },
      { l: t("r_overdue", lang), v: String(overdue.length), s: `${due.filter((x) => x.d >= 0).length} ${t("r_next14", lang)}`, c: "#E5484D", href: "#attention", i: "clock" },
      access.read.has("legal.matrix") && { l: t("r_compliance", lang), v: `${matrix.filter((r) => r.status === "Counsel approved").length}/${matrix.length}`, s: `${matrix.filter((r) => ["Restricted", "Prohibited"].includes(r.data?.risk)).length} ${t("r_restricted", lang)}`, c: DEPT_COLORS.legal, href: "/legal/matrix", i: "grid" },
    ].filter(Boolean) as any[];
    const depts = DEPARTMENTS.map((dp: any) => {
      const secs = SECTIONS.filter((s) => s.dept === dp.key && access.read.has(s.id) && s.view !== "mail" && s.id !== "legal.matrix");
      const rs = all.filter((r) => secs.some((s) => s.id === r.section));
      return { key: dp.key, label: tx(dp.label, lang), secs, total: rs.length, open: rs.filter(OPEN).length, overdue: overdue.filter((x) => secs.some((s) => s.id === x.r.section)).length,
        soon: due.filter((x) => x.d >= 0 && secs.some((s) => s.id === x.r.section)).length, week: rs.filter((r) => (r.updated_at || "") >= week).length };
    }).filter((x: any) => x.secs.length);
    return { all, due, overdue, kpis, depts, mine: due.filter((x) => isMine(x.r, me)) };
  }, [recs, access, lang, me]);

  const brief = () => {
    const lines = [`# AGRON — ${t("exec_brief", "en")} · ${new Date().toISOString().slice(0, 10)}`, "", "## Key numbers", ...d.kpis.map((k: any) => `- **${k.l}:** ${k.v} (${k.s})`), "", "## Overdue", ...(d.overdue.length ? d.overdue.slice(0, 15).map((x) => `- ${x.r.title} — ${tx(findSection(x.r.section)?.label, "en")}, ${-x.d} days late${x.r.data?.owner ? `, owner ${x.r.data.owner}` : ""}`) : ["- none"]), "", "## By department", "| Department | Open | Overdue | Due ≤14 days | Updated this week |", "|---|---|---|---|---|", ...d.depts.map((x: any) => `| ${x.label} | ${x.open} | ${x.overdue} | ${x.soon} | ${x.week} |`)];
    return lines.join("\n");
  };
  const csv = () => {
    const rows = [["Title", "Section", "Field", "Date", "Days", "Owner", "Status"], ...d.due.map((x) => [x.r.title, tx(findSection(x.r.section)?.label, "en"), x.k, x.r.data?.[x.k], String(x.d), x.r.data?.owner || x.r.data?.assignee || "", x.r.status || ""])];
    saveBlob(`AGRON_deadlines_${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n"), "text/csv");
  };
  const sel = d.depts.find((x: any) => x.key === dept);

  if (!recs) return <div className="empty">…</div>;
  return (
    <div style={{ display: "grid", gap: 16 }} ref={ref}>
      <div className="toolbar">
        <button className="btn primary sm" onClick={() => openAi({ title: t("exec_brief", lang), section: "", ask: (lang === "ru" ? "Напиши краткую сводку для CEO на одну страницу: 3 главных вывода, риски, что решить на этой неделе. Данные:\n\n" : "Write a one-page CEO brief: 3 key takeaways, risks, and what to decide this week. Data:\n\n") + brief() })}><Icon n="spark" />{t("ai_brief", lang)}</button>
        <button className="btn sm" onClick={() => ref.current && elementToPdf(ref.current, `AGRON_report_${new Date().toISOString().slice(0, 10)}.pdf`)}><Icon n="pdf" />PDF</button>
        <button className="btn sm" onClick={() => window.print()}><Icon n="print" />{t("print", lang)}</button>
        <button className="btn sm" onClick={csv}><Icon n="download" />CSV</button>
        <button className="btn sm" onClick={async () => { await navigator.clipboard.writeText(brief()); }}><Icon n="copy" />{t("copy", lang)}</button>
        {access.read.has("mail.templates") && <button className="btn sm" onClick={() => openMail({ template: "blank", vars: { subject: `AGRON — ${t("exec_brief", "en")} ${new Date().toISOString().slice(0, 10)}`, name: "", message: brief() } })}><Icon n="mail" />{t("email_btn", lang)}</button>}
        <button className="btn ghost sm" onClick={async () => { const r = await fetch("/api/digest", { method: "POST" }); toast(r.ok ? t("digest_sent", lang) : r.status === 501 ? t("digest_off", lang) : await r.text(), !r.ok); }}><Icon n="bell" />{t("digest_now", lang)}</button>
        <Link href="/templates?t=ceo_weekly" className="btn ghost sm"><Icon n="file" />{t("weekly_update", lang)}</Link>
      </div>

      <section className="kpis">{d.kpis.map((k: any) => (
        <Link key={k.l} href={k.href} className="kpi" style={{ textDecoration: "none", color: "inherit", ["--dc" as any]: k.c }}>
          <span className="ic"><Icon n={k.i} /></span><div className="eyebrow">{k.l}</div><div className="v" style={{ fontSize: 26 }}>{k.v}</div><div className="faint" style={{ fontSize: 13.5 }}>{k.s}</div></Link>))}</section>

      {d.mine.length > 0 && <section className="card" style={{ ["--dc" as any]: "#FF6A2B" }}><div className="card-h"><h2><Icon n="user" />{t("for_me", lang)}</h2></div>
        <div className="feed">{d.mine.slice(0, 8).map((x) => <DueRow key={x.r.id + x.k} x={x} />)}</div></section>}

      <section className="card" id="attention" style={{ ["--dc" as any]: "#E5484D" }}><div className="card-h"><h2><Icon n="alert" />{t("attention", lang)}</h2><span className="faint" style={{ fontSize: 13.5 }}>{t("overdue_and_14", lang)}</span></div>
        <div className="feed">{d.due.length ? d.due.slice(0, 25).map((x) => <DueRow key={x.r.id + x.k} x={x} />) : <div className="empty">{t("no_deadlines", lang)}</div>}</div></section>

      <section className="card"><div className="card-h"><h2><Icon n="pie" />{t("by_department", lang)}</h2></div>
        <div className="card-b tablewrap"><table className="tb"><thead><tr><th>{t("department", lang)}</th><th>{t("r_open", lang)}</th><th>{t("r_overdue", lang)}</th><th>{t("r_next14", lang)}</th><th>{t("r_week", lang)}</th><th /></tr></thead>
          <tbody>{d.depts.map((x: any) => <tr key={x.key} className={dept === x.key ? "sel" : ""}>
            <td><b style={{ color: (DEPT_COLORS as any)[x.key] }}>{x.label}</b></td><td className="mono">{x.open}</td>
            <td className="mono">{x.overdue ? <span className="chip c-bad">{x.overdue}</span> : "0"}</td><td className="mono">{x.soon}</td><td className="mono">{x.week}</td>
            <td><button className="btn ghost sm" onClick={() => setDept(dept === x.key ? "" : x.key)}>{dept === x.key ? t("hide", lang) : t("details", lang)}</button></td></tr>)}</tbody></table></div></section>

      {sel && <section className="card" style={{ ["--dc" as any]: (DEPT_COLORS as any)[sel.key] }}><div className="card-h"><h2><Icon n="list" />{sel.label}</h2></div>
        <div className="card-b" style={{ display: "grid", gap: 14 }}>{sel.secs.map((s: any) => { const rs = d.all.filter((r) => r.section === s.id); if (!rs.length) return null; return (
          <div key={s.id} className="rep-sec"><Link href={`/${s.dept}/${s.key}`} style={{ fontWeight: 600, color: "inherit" }}><Icon n={s.icon} /> {tx(s.label, lang)} <span className="faint">· {rs.length}</span></Link>
            <div className="rep-bar">{s.statuses.map((st: string) => { const n = rs.filter((r) => r.status === st).length; return n ? <span key={st} className={`chip ${tone(st)}`} title={st}>{st} <b className="mono">{n}</b></span> : null; })}</div></div>); })}</div></section>}

      <section className="card"><div className="card-h"><h2><Icon n="clock" />{t("activity_7d", lang)}</h2><span className="faint" style={{ fontSize: 13.5 }}>{act.filter((a) => a.created_at >= new Date(Date.now() - 7 * 864e5).toISOString()).length}</span></div>
        <div className="feed">{act.slice(0, 15).map((a) => { const s = findSection(a.section); return <div key={a.id} className="feed-row"><span className="mono faint" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{(a.created_at || "").slice(5, 16).replace("T", " ")}</span><span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{a.detail?.title}</b> <span className="faint">· {s ? tx(s.label, lang) : a.section} · {a.action}{a.action === "status" ? ` → ${a.detail?.to}` : ""}</span></span></div>; })}</div></section>
    </div>
  );
}

function DueRow({ x }: { x: { r: Rec; k: string; d: number } }) {
  const { lang } = useApp(); const s = findSection(x.r.section); const who = x.r.data?.owner || x.r.data?.assignee || x.r.data?.holder || "";
  return <Link href={`/${x.r.section.replace(".", "/")}?r=${x.r.id}`} className="deadline" style={{ ["--dc" as any]: s?.color }}>
    <span className="dic"><Icon n={s?.icon || "clock"} /></span>
    <span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{x.r.title}</b><br /><span className="faint" style={{ fontSize: 13 }}>{s ? tx(s.label, lang) : ""} · {tx(s?.fields.find((f: any) => f.key === x.k)?.label, lang)}{who ? ` · ${who}` : ""}</span></span>
    <span className={`chip ${x.d < 0 ? "c-bad" : x.d <= 7 ? "c-warn" : "c-info"}`}>{x.d < 0 ? t("days_late", lang).replace("{n}", String(-x.d)) : x.d === 0 ? t("today", lang) : t("in_days", lang).replace("{n}", String(x.d))}</span>
  </Link>;
}
