"use client";
import { useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { useApp, findSection, SECTIONS } from "./App";
import { DEPARTMENTS, DEPT_COLORS } from "@/config/workspace.config.mjs";
import { t, tx } from "@/lib/i18n";
import type { Rec } from "@/lib/store";
import { OPEN, dueItems, dayDiff } from "@/lib/insights";
import { printHtml, saveBlob } from "@/lib/format";
import { markdownToPdf } from "@/lib/pdf";

type Block = { h: string; note?: string; kv?: [string, string][]; head?: string[]; rows?: string[][]; empty?: string };
type Report = { title: string; sub: string; blocks: Block[] };
type Kind = "exec" | "sales" | "ops" | "finance" | "legal" | "deadlines" | "people" | "dept";

const KINDS: { k: Kind; icon: string; c: string; need?: string }[] = [
  { k: "exec", icon: "trend", c: "#FF6A2B" },
  { k: "sales", icon: "funnel", c: DEPT_COLORS.sales, need: "sales.pipeline" },
  { k: "ops", icon: "container", c: DEPT_COLORS.operations, need: "operations.builds" },
  { k: "finance", icon: "coins", c: DEPT_COLORS.finance, need: "finance.invoices" },
  { k: "legal", icon: "scale", c: DEPT_COLORS.legal, need: "legal.requests" },
  { k: "deadlines", icon: "clock", c: "#E5484D" },
  { k: "people", icon: "users", c: "#5B6CF0" },
  { k: "dept", icon: "list", c: "#0FA3A3" },
];
const PERIODS = [7, 30, 90, 365];
const n = (v: any) => Number(v) || 0;
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const lbl = (id: string) => tx(findSection(id)?.label, "en");
const who = (r: Rec) => r.data?.owner || r.data?.assignee || r.data?.holder || r.data?.requester || r.data?.person || "—";
const when = (d: number) => (d < 0 ? `${-d} days overdue` : d === 0 ? "today" : `in ${d} days`);

export default function ReportBuilder({ recs }: { recs: Rec[] }) {
  const { lang, access, openAi, openMail, toast } = useApp();
  const [kind, setKind] = useState<Kind>("exec");
  const [days, setDays] = useState(30);
  const [dept, setDept] = useState("operations");
  const [rep, setRep] = useState<Report | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const kinds = KINDS.filter((k) => !k.need || access.read.has(k.need));
  const depts = DEPARTMENTS.filter((d: any) => SECTIONS.some((s) => s.dept === d.key && access.read.has(s.id) && s.view !== "mail"));

  const build = (): Report => {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const all = recs.filter((r) => r.section !== "legal.matrix");
    const of = (s: string) => all.filter((r) => r.section === s);
    const inPeriod = (r: Rec) => (r.updated_at || r.created_at || "") >= since;
    const period = `last ${days} days (${since.slice(0, 10)} – ${new Date().toISOString().slice(0, 10)})`;
    const due = dueItems(all, 30);
    const overdue = due.filter((x) => x.d < 0);
    const deals = of("sales.pipeline"), openDeals = deals.filter((r) => !["Won", "Lost"].includes(r.status || ""));
    const WIN: Record<string, number> = { Lead: 0.1, Qualified: 0.25, Proposal: 0.5, Negotiation: 0.75 };
    const pipeV = openDeals.reduce((a, r) => a + n(r.data?.value), 0), weighted = openDeals.reduce((a, r) => a + n(r.data?.value) * (WIN[r.status || ""] || 0), 0);
    const won = deals.filter((r) => r.status === "Won" && inPeriod(r)), lost = deals.filter((r) => r.status === "Lost" && inPeriod(r));
    const builds = of("operations.builds");
    const inv = of("finance.invoices").filter((r) => r.status !== "Paid");
    const recv = inv.filter((r) => r.data?.direction === "Receivable"), pay = inv.filter((r) => r.data?.direction === "Payable");
    const matrix = recs.filter((r) => r.section === "legal.matrix");
    const stageRows = (sec: string, list: Rec[], val?: (r: Rec) => number) => (findSection(sec)?.statuses || []).map((st: string) => { const l = list.filter((r) => r.status === st); return [st, String(l.length), val ? usd(l.reduce((a, r) => a + val(r), 0)) : ""]; });
    const dueRows = (list: typeof due) => list.slice(0, 40).map((x) => [x.r.title, lbl(x.r.section), x.r.data?.[x.k] || "", when(x.d), who(x.r)]);

    switch (kind) {
      case "sales": return { title: "Sales pipeline report", sub: period, blocks: [
        { h: "Summary", kv: [["Open deals", String(openDeals.length)], ["Open pipeline", usd(pipeV)], ["Weighted forecast", usd(weighted)], ["Won in period", `${won.length} · ${usd(won.reduce((a, r) => a + n(r.data?.value), 0))}`], ["Lost in period", String(lost.length)], ["Win rate in period", won.length + lost.length ? `${Math.round((won.length / (won.length + lost.length)) * 100)}%` : "—"]] },
        { h: "Pipeline by stage", note: "Weighted forecast uses typical win rates: Lead 10%, Qualified 25%, Proposal 50%, Negotiation 75%.", head: ["Stage", "Deals", "Value"], rows: stageRows("sales.pipeline", deals, (r) => n(r.data?.value)) },
        { h: "Open deals", head: ["Deal", "Client", "Stage", "Configuration", "Value", "Owner", "Screening"], rows: openDeals.sort((a, b) => n(b.data?.value) - n(a.data?.value)).map((r) => [r.title, r.data?.client || "", r.status || "", r.data?.config || "", usd(n(r.data?.value)), r.data?.owner || "", r.data?.screening || "Not started"]), empty: "No open deals." },
        { h: "Proposals", head: ["Proposal", "Client", "Status", "Value", "Valid until"], rows: of("sales.proposals").map((r) => [r.title, r.data?.client || "", r.status || "", usd(n(r.data?.value)), r.data?.valid_until || ""]), empty: "No proposals." },
        { h: "Meetings and calls in period", head: ["Date", "Client", "Type", "Next step"], rows: of("sales.activities").filter(inPeriod).map((r) => [r.data?.date || "", r.data?.client || "", r.data?.type || "", r.data?.next_step || ""]), empty: "No activities recorded in the period." },
      ] };
      case "ops": return { title: "Operations report", sub: period, blocks: [
        { h: "Summary", kv: [["Builds in progress", String(builds.filter((r) => r.status !== "Installed").length)], ["Installed", String(builds.filter((r) => r.status === "Installed").length)], ["Open purchase orders", String(of("operations.procurement").filter((r) => !["Received", "Cancelled"].includes(r.status || "")).length)], ["Open support tickets", String(of("operations.support").filter(OPEN).length)]] },
        { h: "Container builds by stage", head: ["Stage", "Builds", ""], rows: stageRows("operations.builds", builds) },
        { h: "Builds", head: ["Build", "Client", "Configuration", "Stage", "Export check", "Due", "Owner"], rows: builds.map((r) => [r.title, r.data?.client || "", r.data?.config || "", r.status || "", r.data?.export_check || "", r.data?.due || "", r.data?.owner || ""]), empty: "No builds yet." },
        { h: "Open purchase orders", head: ["PO", "Vendor", "Item", "Amount", "ETA", "Status"], rows: of("operations.procurement").filter((r) => !["Received", "Cancelled"].includes(r.status || "")).map((r) => [r.title, r.data?.vendor || "", r.data?.item || "", n(r.data?.amount) ? `${n(r.data?.amount).toLocaleString("en-US")} ${r.data?.currency || ""}` : "", r.data?.eta || "", r.status || ""]), empty: "No open purchase orders." },
        { h: "Support tickets", head: ["Ticket", "Client", "Severity", "Status", "Owner"], rows: of("operations.support").filter(OPEN).map((r) => [r.title, r.data?.client || "", r.data?.severity || "", r.status || "", r.data?.owner || ""]), empty: "No open tickets." },
      ] };
      case "finance": return { title: "Finance report", sub: period, blocks: [
        { h: "Summary", kv: [["Receivable (unpaid)", usd(recv.reduce((a, r) => a + n(r.data?.amount), 0))], ["Payable (unpaid)", usd(pay.reduce((a, r) => a + n(r.data?.amount), 0))], ["Overdue invoices", String(inv.filter((r) => r.status === "Overdue" || (r.data?.due && dayDiff(r.data.due) < 0)).length)], ["Expenses submitted in period", usd(of("finance.expenses").filter(inPeriod).reduce((a, r) => a + n(r.data?.amount), 0))]] },
        { h: "Unpaid invoices", head: ["Invoice", "Direction", "Counterparty", "Amount", "Due", "Status"], rows: inv.map((r) => [r.title, r.data?.direction || "", r.data?.counterparty || "", `${n(r.data?.amount).toLocaleString("en-US")} ${r.data?.currency || ""}`, r.data?.due || "", r.status || ""]), empty: "No unpaid invoices." },
        { h: "Expenses in period", head: ["Expense", "Requester", "Category", "Amount", "Status"], rows: of("finance.expenses").filter(inPeriod).map((r) => [r.title, r.data?.requester || "", r.data?.category || "", `${n(r.data?.amount).toLocaleString("en-US")} ${r.data?.currency || ""}`, r.status || ""]), empty: "No expenses in the period." },
        { h: "Budget versus actual", head: ["Budget", "Department", "Period", "Planned", "Actual", "Variance"], rows: of("finance.budget").map((r) => [r.title, r.data?.department || "", r.data?.period || "", usd(n(r.data?.planned)), usd(n(r.data?.actual)), usd(n(r.data?.planned) - n(r.data?.actual))]), empty: "No budgets entered." },
      ] };
      case "legal": { const lic = [...of("legal.licences"), ...of("legal.hse"), ...of("legal.authority")].filter((r) => r.data?.expires && dayDiff(r.data.expires) <= 90 && OPEN(r));
        const risk = ["Prohibited", "Restricted", "High", "Medium", "Low"];
        return { title: "Legal and compliance report", sub: period, blocks: [
          { h: "Summary", kv: [["Equipment items", String(matrix.length)], ["Counsel approved", String(matrix.filter((r) => r.status === "Counsel approved").length)], ["Restricted / prohibited", String(matrix.filter((r) => ["Restricted", "Prohibited"].includes(r.data?.risk)).length)], ["Open legal requests", String(of("legal.requests").filter(OPEN).length)], ["Open critical issues", String(of("legal.issues").filter(OPEN).length)], ["Permits / powers expiring in 90 days", String(lic.length)]] },
          { h: "Equipment compliance by risk", head: ["Risk", "Items", "Counsel approved"], rows: risk.map((k) => { const l = matrix.filter((r) => r.data?.risk === k); return [k, String(l.length), String(l.filter((r) => r.status === "Counsel approved").length)]; }) },
          { h: "Critical issues", head: ["Issue", "Priority", "Next action", "Owner", "Status"], rows: of("legal.issues").filter(OPEN).map((r) => [r.title, r.data?.priority || "", r.data?.action || "", r.data?.owner || "", r.status || ""]), empty: "No open issues." },
          { h: "Open legal requests", head: ["Request", "Desk", "Priority", "Due", "Status"], rows: of("legal.requests").filter(OPEN).map((r) => [r.title, r.data?.desk || "", r.data?.priority || "", r.data?.due || "", r.status || ""]), empty: "No open requests." },
          { h: "Licences, permits and powers expiring within 90 days", head: ["Item", "Type", "Expires", "Owner"], rows: lic.map((r) => [r.title, r.data?.type || r.data?.permit || r.data?.kind || "", r.data?.expires, who(r)]), empty: "Nothing expires in the next 90 days." },
          { h: "Board and governance", head: ["Item", "Section", "Status", "Date"], rows: [...of("legal.board"), ...of("legal.governance")].filter(OPEN).map((r) => [r.title, lbl(r.section), r.status || "", r.data?.due || r.data?.date || ""]), empty: "Nothing pending." },
        ] }; }
      case "deadlines": return { title: "Deadlines report", sub: "overdue and due within 30 days", blocks: [
        { h: "Summary", kv: [["Overdue", String(overdue.length)], ["Due within 7 days", String(due.filter((x) => x.d >= 0 && x.d <= 7).length)], ["Due within 30 days", String(due.filter((x) => x.d >= 0).length)]] },
        { h: "Overdue", head: ["Item", "Section", "Date", "Status", "Owner"], rows: dueRows(overdue), empty: "Nothing overdue." },
        { h: "Coming up", head: ["Item", "Section", "Date", "When", "Owner"], rows: dueRows(due.filter((x) => x.d >= 0)), empty: "Nothing due in the next 30 days." },
      ] };
      case "people": { const map = new Map<string, { open: number; over: number; soon: number }>();
        for (const r of all.filter(OPEN)) { const w = who(r); if (w === "—") continue; const m = map.get(w) || { open: 0, over: 0, soon: 0 }; m.open++; map.set(w, m); }
        for (const x of due) { const w = who(x.r); const m = map.get(w); if (!m) continue; if (x.d < 0) m.over++; else if (x.d <= 7) m.soon++; }
        return { title: "Workload by person", sub: "open items where the person is named as owner, assignee or holder", blocks: [
          { h: "Workload", head: ["Person", "Open items", "Overdue", "Due within 7 days"], rows: [...map.entries()].sort((a, b) => b[1].over - a[1].over || b[1].open - a[1].open).map(([k, v]) => [k, String(v.open), String(v.over), String(v.soon)]), empty: "No owners recorded on open items yet." },
        ] }; }
      case "dept": { const d = DEPARTMENTS.find((x: any) => x.key === dept)!; const secs = SECTIONS.filter((s) => s.dept === dept && access.read.has(s.id) && s.view !== "mail");
        const rs = recs.filter((r) => secs.some((s) => s.id === r.section));
        return { title: `${tx(d.label, "en")} department report`, sub: period, blocks: [
          { h: "Summary", kv: [["Records", String(rs.length)], ["Open", String(rs.filter(OPEN).length)], ["Created or updated in period", String(rs.filter(inPeriod).length)], ["Overdue", String(overdue.filter((x) => secs.some((s) => s.id === x.r.section)).length)]] },
          ...secs.map((s) => { const l = rs.filter((r) => r.section === s.id); return { h: tx(s.label, "en"), head: ["Status", "Records"], rows: s.statuses.map((st: string) => [st, String(l.filter((r) => r.status === st).length)]).filter((x: string[]) => x[1] !== "0"), empty: "No records." } as Block; }),
          { h: "Overdue in this department", head: ["Item", "Section", "Date", "Status", "Owner"], rows: dueRows(overdue.filter((x) => secs.some((s) => s.id === x.r.section))), empty: "Nothing overdue." },
        ] }; }
      default: return { title: "Executive brief", sub: period, blocks: [
        { h: "Key numbers", kv: [
          ...(access.read.has("sales.pipeline") ? [["Open pipeline", usd(pipeV)], ["Weighted forecast", usd(weighted)], ["Won in period", usd(won.reduce((a, r) => a + n(r.data?.value), 0))]] as [string, string][] : []),
          ...(access.read.has("operations.builds") ? [["Builds in progress", String(builds.filter((r) => r.status !== "Installed").length)]] as [string, string][] : []),
          ...(access.read.has("finance.invoices") ? [["Receivable", usd(recv.reduce((a, r) => a + n(r.data?.amount), 0))], ["Payable", usd(pay.reduce((a, r) => a + n(r.data?.amount), 0))]] as [string, string][] : []),
          ["Overdue items", String(overdue.length)],
          ...(matrix.length ? [["Equipment cleared by counsel", `${matrix.filter((r) => r.status === "Counsel approved").length} of ${matrix.length}`]] as [string, string][] : []),
        ] },
        { h: "Needs attention: overdue", head: ["Item", "Section", "Date", "Status", "Owner"], rows: dueRows(overdue), empty: "Nothing overdue." },
        { h: "Open critical issues", head: ["Issue", "Priority", "Next action", "Owner"], rows: of("legal.issues").filter(OPEN).map((r) => [r.title, r.data?.priority || "", r.data?.action || "", r.data?.owner || ""]), empty: "None." },
        { h: "Largest open deals", head: ["Deal", "Client", "Stage", "Value"], rows: openDeals.sort((a, b) => n(b.data?.value) - n(a.data?.value)).slice(0, 8).map((r) => [r.title, r.data?.client || "", r.status || "", usd(n(r.data?.value))]), empty: "No open deals." },
        { h: "Decisions in period", head: ["Decision", "Status", "Date", "Owner"], rows: of("company.decisions").filter(inPeriod).map((r) => [r.title, r.status || "", r.data?.date || "", r.data?.owner || ""]), empty: "No decisions recorded in the period." },
        { h: "Departments", head: ["Department", "Open", "Overdue", "Updated in period"], rows: DEPARTMENTS.map((d: any) => { const ids = SECTIONS.filter((s) => s.dept === d.key && access.read.has(s.id)).map((s) => s.id); const l = all.filter((r) => ids.includes(r.section)); return ids.length && d.key !== "mail" ? [tx(d.label, "en"), String(l.filter(OPEN).length), String(overdue.filter((x) => ids.includes(x.r.section)).length), String(l.filter(inPeriod).length)] : null; }).filter(Boolean) as string[][] },
      ] };
    }
  };

  const md = useMemo(() => !rep ? "" : [`# AGRON Inc. — ${rep.title}`, `${rep.sub} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "",
    ...rep.blocks.flatMap((b) => [`## ${b.h}`, ...(b.note ? [b.note] : []), ...(b.kv ? b.kv.map(([k, v]) => `- **${k}:** ${v}`) : []), ...(b.head ? (b.rows?.length ? [`| ${b.head.join(" | ")} |`, `|${b.head.map(() => "---").join("|")}|`, ...b.rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "/")).join(" | ")} |`)] : [b.empty || "—"]) : []), ""])].join("\n"), [rep]);
  const csv = () => { if (!rep) return; const lines: string[] = []; for (const b of rep.blocks) { lines.push(`"${b.h}"`); if (b.kv) b.kv.forEach(([k, v]) => lines.push(`"${k}","${v}"`)); if (b.head) { lines.push(b.head.map((h) => `"${h}"`).join(",")); (b.rows || []).forEach((r) => lines.push(r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))); } lines.push(""); }
    saveBlob(`AGRON_${rep.title.replace(/\W+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + lines.join("\r\n"), "text/csv"); };
  const go = () => { setRep(build()); setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };

  return (
    <section className="card" style={{ ["--dc" as any]: "#FF6A2B" }}>
      <div className="card-h"><h2><Icon n="file" />{t("rb_title", lang)}</h2><span className="faint" style={{ fontSize: 14 }}>{t("rb_sub", lang)}</span></div>
      <div className="card-b" style={{ display: "grid", gap: 16 }}>
        <div className="rb-step"><h3><span className="n">1</span>{t("rb_step1", lang)}</h3>
          <div className="rb-types">{kinds.map((k) => (
            <button key={k.k} className={`rb-type ${kind === k.k ? "on" : ""}`} style={{ ["--dc" as any]: k.c }} onClick={() => { setKind(k.k); setRep(null); }}>
              <span className="tpl-ic"><Icon n={k.icon} /></span><b>{t("rk_" + k.k, lang)}</b><small>{t("rk_" + k.k + "_d", lang)}</small></button>))}</div></div>
        <div className="rb-steps">
          <div className="rb-step"><h3><span className="n">2</span>{t("rb_step2", lang)}</h3>
            <div className="toolbar">{PERIODS.map((p) => <button key={p} className={`btn sm ${days === p ? "primary" : "ghost"}`} onClick={() => { setDays(p); setRep(null); }}>{t("rb_days", lang).replace("{n}", String(p))}</button>)}</div>
            {kind === "dept" && <select className="input" value={dept} onChange={(e) => { setDept(e.target.value); setRep(null); }} aria-label={t("department", lang)}>{depts.map((d: any) => <option key={d.key} value={d.key}>{tx(d.label, lang)}</option>)}</select>}</div>
          <div className="rb-step"><h3><span className="n">3</span>{t("rb_step3", lang)}</h3>
            <button className="btn primary" onClick={go}><Icon n="file" />{t("rb_generate", lang)}</button>
            <span className="faint" style={{ fontSize: 13.5 }}>{t("rb_step3_hint", lang)}</span></div>
        </div>
        {rep && <div ref={ref} style={{ display: "grid", gap: 12, scrollMarginTop: 80 }}>
          <div className="toolbar">
            <button className="btn primary sm" onClick={() => markdownToPdf(md, { title: rep.title, filename: `AGRON_${rep.title.replace(/\W+/g, "_")}_${new Date().toISOString().slice(0, 10)}` })}><Icon n="pdf" />{t("rb_pdf", lang)}</button>
            <button className="btn sm" onClick={() => printHtml(rep.title, document.getElementById("rb-doc")?.innerHTML || "")}><Icon n="print" />{t("print", lang)}</button>
            <button className="btn sm" onClick={csv}><Icon n="download" />Excel / CSV</button>
            <button className="btn sm" onClick={async () => { await navigator.clipboard.writeText(md); toast(t("copied", lang)); }}><Icon n="copy" />{t("copy", lang)}</button>
            {access.read.has("mail.templates") && <button className="btn sm" onClick={() => openMail({ template: "blank", vars: { subject: `AGRON — ${rep.title} (${new Date().toISOString().slice(0, 10)})`, name: "", message: md } })}><Icon n="mail" />{t("email_btn", lang)}</button>}
            <button className="btn sm" onClick={() => openAi({ title: rep.title, ask: (lang === "ru" ? "Прочитай отчёт и дай: 3 главных вывода, риски и что сделать на этой неделе.\n\n" : "Read this report and give: 3 key takeaways, risks, and what to do this week.\n\n") + md })}><Icon n="spark" />{t("rb_ai", lang)}</button>
          </div>
          <div id="rb-doc" className="rb-doc">
            <div className="rb-head"><div><h1>{rep.title}</h1><div style={{ color: "#4b5867" }}>AGRON Inc. · {rep.sub}</div></div><img src="/logo-full.webp" alt="AGRON™ — Aerial-Ground Robotics Operations Network" width={1000} height={280} /></div>
            {rep.blocks.map((b) => <div key={b.h}>
              <h2>{b.h}</h2>{b.note && <p style={{ color: "#4b5867", margin: "0 0 6px" }}>{b.note}</p>}
              {b.kv && <div className="kv">{b.kv.map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}</div>}
              {b.head && (b.rows?.length ? <table><thead><tr>{b.head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table> : <p style={{ color: "#7a8796" }}>{b.empty || "—"}</p>)}
            </div>)}
            <p style={{ color: "#7a8796", fontSize: 12, marginTop: 24, borderTop: "1px solid #d5dce4", paddingTop: 10 }}>Generated in AGRON Workspace on {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Confidential — internal use only. Shows only records the author is allowed to see.</p>
          </div>
        </div>}
      </div>
    </section>
  );
}
