"use client";
import { useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { t, tx, type Lang } from "@/lib/i18n";
import { DEMO, Rec } from "@/lib/store";
import { markdownToPdf } from "@/lib/pdf";
import { printHtml, saveBlob } from "@/lib/format";
import { delta, prevMonth, thisMonth } from "@/lib/channels";
import { dayDiff } from "@/lib/insights";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const S = {
  btn: L("Report", "Отчёт", "Звіт", "تقرير"), title: L("Department report", "Отчёт департамента", "Звіт департаменту", "تقرير القسم"),
  p0: L("This month", "Этот месяц", "Цей місяць", "هذا الشهر"), p1: L("Last month", "Прошлый месяц", "Минулий місяць", "الشهر الماضي"), p3: L("Last 3 months", "Последние 3 месяца", "Останні 3 місяці", "آخر 3 أشهر"),
  ai: L("AI summary", "Выводы ИИ", "Висновки ШІ", "ملخص الذكاء الاصطناعي"), wait: L("Writing the summary…", "Пишу выводы…", "Пишу висновки…", "جارٍ كتابة الملخص…"),
  hint: L("Built from Workspace records you can see. Numbers come from the statistics sections; AI only summarises them.", "Собран из записей Workspace, доступных вам. Цифры — из разделов статистики; ИИ только делает выводы.", "Зібрано із записів Workspace, доступних вам. Цифри — з розділів статистики; ШІ лише робить висновки.", "مبني من سجلات مساحة العمل المتاحة لك. الأرقام من أقسام الإحصاءات؛ الذكاء الاصطناعي يلخصها فقط."),
};
const n = (v: any) => Number(v) || 0;
const f = (v: number) => v.toLocaleString("en-US");
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const row = (cells: (string | number)[]) => `| ${cells.map((c) => String(c ?? "").replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`;
const table = (head: string[], rows: (string | number)[][]) => (rows.length ? [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n") : "_No data yet._");

/** Months covered by the chosen period, newest last. */
export function monthsOf(kind: "p0" | "p1" | "p3"): string[] {
  const cur = thisMonth();
  if (kind === "p0") return [cur];
  if (kind === "p1") return [prevMonth(cur)];
  const a = prevMonth(cur), b = prevMonth(a); return [b, a, cur];
}
const inMonths = (d: any, ms: string[]) => !!d && ms.includes(String(d).slice(0, 7));

/** Marketing report as markdown, from the records in the hub. */
export function marketingReport(all: Rec[], ms: string[]): string {
  const of = (s: string) => all.filter((r) => r.section === s);
  const before = prevMonth(ms[0]);
  const mets = of("marketing.metrics");
  const acc = (m: Rec) => m.data?.account || m.data?.channel; // one row per account
  const chans = [...new Set([...of("marketing.channels").filter((c) => c.status !== "Planned").map((r) => r.title), ...mets.map(acc)].filter(Boolean))] as string[];
  const sum = (ch: string, k: string, list: string[]) => mets.filter((m) => acc(m) === ch && list.includes(m.data?.period)).reduce((a, m) => a + n(m.data?.[k]), 0);
  const last = (ch: string, list: string[]) => { const m = mets.filter((x) => acc(x) === ch && list.includes(x.data?.period) && n(x.data?.followers)).sort((a, b) => String(b.data.period).localeCompare(a.data.period))[0]; return n(m?.data?.followers) || n(of("marketing.channels").find((c) => c.title === ch)?.data?.followers); };
  const chRows = chans.map((ch) => { const fol = last(ch, ms), folB = n(mets.find((m) => acc(m) === ch && m.data?.period === before)?.data?.followers);
    return [ch, fol ? f(fol) : "—", fol && folB ? delta(fol, folB) : "—", f(sum(ch, "impressions", ms)), f(sum(ch, "engagements", ms)), f(sum(ch, "clicks", ms)), f(sum(ch, "video_views", ms)), f(sum(ch, "leads", ms))]; });
  const PUB: [string, string][] = [["marketing.social", "Social posts"], ["marketing.press", "Press"], ["marketing.interviews", "Interviews & podcasts"], ["marketing.video", "Videos"]];
  const published = PUB.map(([s, l]) => [l, of(s).filter((r) => r.status === "Published" && inMonths(r.data?.publish || r.updated_at, ms))] as const);
  const leads = of("marketing.leads").filter((r) => inMonths(r.created_at, ms));
  const bySrc = Object.entries(leads.reduce((a: any, r) => { const k = r.data?.source || "Other"; a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a: any, b: any) => b[1] - a[1]);
  const camps = of("marketing.campaigns").filter((r) => inMonths(r.data?.start_date, ms) || ["Running"].includes(r.status || ""));
  const lines = of("marketing.plan").filter((r) => r.data?.kind === "Budget line" && r.status !== "Done");
  const waiting = all.filter((r) => r.data && "check" in r.data && !/^(published|declined|archived|done|cancelled|completed|analyzed)$/i.test(r.status || "") && !["Passed (AI check)", "Cleared by legal"].includes(r.data.check) && !["Idea", "Target", "Brief", "Considering"].includes(r.status || ""));
  const next = all.filter((r) => { const d = r.data?.publish || r.data?.session || r.data?.starts; return d && dayDiff(d) >= 0 && dayDiff(d) <= 30 && !/^(published|declined|cancelled)$/i.test(r.status || ""); })
    .sort((a, b) => String(a.data.publish || a.data.session || a.data.starts).localeCompare(String(b.data.publish || b.data.session || b.data.starts)));
  return [
    `# AGRON — Marketing report`, `Period: ${ms[0]}${ms.length > 1 ? ` – ${ms[ms.length - 1]}` : ""} · prepared ${new Date().toISOString().slice(0, 10)}`,
    `## Channels`, table(["Channel", "Followers", `vs ${before}`, "Impressions", "Engagements", "Clicks", "Video views", "Leads"], chRows),
    `## Published`, table(["Type", "Count", "Titles"], published.map(([l, rs]) => [l, rs.length, rs.slice(0, 6).map((r) => r.title).join("; ")])),
    `Total reach of published posts: ${f(published.flatMap(([, rs]) => rs).reduce((a, r) => a + n(r.data?.reach) + n(r.data?.views) + n(r.data?.audience), 0))}`,
    `## Leads`, `New leads: ${leads.length} · passed to sales: ${leads.filter((r) => r.status === "To pipeline").length}`, table(["Source", "Leads"], bySrc.map(([k, v]) => [k, v as number])),
    `## Campaigns`, table(["Campaign", "Channel", "Status", "Spent", "Clicks", "Leads", "Meetings"], camps.map((r) => [r.title, r.data?.channel || "", r.status || "", usd(n(r.data?.spent)), f(n(r.data?.clicks)), n(r.data?.leads), n(r.data?.meetings)])),
    `## Budget`, table(["Area", "Period", "Planned", "Spent", "Used"], lines.map((r) => [r.data?.area || r.title, r.data?.period || "", usd(n(r.data?.planned)), usd(n(r.data?.actual)), n(r.data?.planned) ? `${Math.round((n(r.data?.actual) / n(r.data?.planned)) * 100)}%` : "—"])),
    `## Waiting for compliance check or approval`, waiting.length ? waiting.slice(0, 15).map((r) => `- ${r.title} — ${tx(findSection(r.section)?.label, "en")}, ${r.status}, check: ${r.data?.check || "Not checked"}`).join("\n") : "_Nothing waiting._",
    `## Next 30 days`, next.length ? next.slice(0, 20).map((r) => `- ${String(r.data.publish || r.data.session || r.data.starts).slice(0, 10)} · ${r.title} (${tx(findSection(r.section)?.label, "en")}, ${r.status})`).join("\n") : "_Nothing scheduled._",
  ].join("\n\n");
}

/** Technical report as markdown. */
export function technicalReport(all: Rec[], ms: string[]): string {
  const of = (s: string) => all.filter((r) => r.section === s);
  const sys = of("technical.systems").filter((r) => r.status !== "Retired");
  const em = of("technical.metrics"); const before = prevMonth(ms[0]);
  const emRow = (p: string) => em.find((r) => r.data?.period === p);
  const emRows = [before, ...ms].map((p) => { const r = emRow(p); return r ? [p, n(r.data?.deploys), n(r.data?.incidents), r.data?.uptime ? `${r.data.uptime}%` : "—", n(r.data?.open_bugs), n(r.data?.closed_tasks), `${n(r.data?.tests_passed)} / ${n(r.data?.tests_failed)}`, r.data?.response_ms ? `${r.data.response_ms} ms` : "—"] : null; }).filter(Boolean) as (string | number)[][];
  const tests = of("technical.testing").filter((r) => inMonths(r.data?.date || r.updated_at, ms));
  const ecr = of("technical.changes").filter((r) => ["Requested", "Assessing", "Approved"].includes(r.status || ""));
  const sw = of("technical.software").filter((r) => !/^(done|released)$/i.test(r.status || ""));
  const byComp = Object.entries(sw.reduce((a: any, r) => { const k = r.data?.component || "Other"; a[k] = (a[k] || 0) + 1; return a; }, {}));
  const cert = of("technical.certification").filter((r) => !["Approved", "Rejected"].includes(r.status || ""));
  const it = of("technical.it").filter((r) => r.status !== "Retired");
  return [
    `# AGRON — Technical report`, `Period: ${ms[0]}${ms.length > 1 ? ` – ${ms[ms.length - 1]}` : ""} · prepared ${new Date().toISOString().slice(0, 10)}`,
    `## Systems`, `${sys.filter((r) => r.status === "Operational").length} of ${sys.length} operational.`, table(["System", "Type", "Environment", "Status", "Response", "Last check"], sys.map((r) => [r.title, r.data?.type || "", r.data?.environment || "", r.status || "", r.data?.latency ? `${r.data.latency} ms` : "—", r.data?.last_check || "—"])),
    `## Engineering metrics`, table(["Month", "Deploys", "Incidents", "Uptime", "Open bugs", "Tasks closed", "Tests passed / failed", "Response"], emRows),
    `## Tests and trials`, `${tests.filter((r) => r.status === "Passed").length} passed · ${tests.filter((r) => r.status === "Failed").length} failed · ${tests.filter((r) => ["Planned", "Running"].includes(r.status || "")).length} planned or running`, tests.filter((r) => r.status === "Failed").map((r) => `- Failed: ${r.title} (${r.data?.type || ""})`).join("\n"),
    `## Engineering changes`, table(["Change", "Impact", "Priority", "Status"], ecr.map((r) => [r.title, r.data?.impact || "", r.data?.priority || "", r.status || ""])),
    `## Software backlog`, table(["Component", "Open items"], byComp.map(([k, v]) => [k, v as number])),
    `## Certification`, table(["Item", "Scheme", "Status", "Due"], cert.map((r) => [r.title, r.data?.scheme || "", r.status || "", r.data?.due || ""])),
    `## IT and infrastructure`, `Monthly cost: ${usd(it.reduce((a, r) => a + n(r.data?.monthly_cost), 0))} · renewals in 60 days: ${it.filter((r) => r.data?.renewal && dayDiff(r.data.renewal) <= 60).map((r) => `${r.title} (${r.data.renewal})`).join(", ") || "none"}`,
  ].join("\n\n");
}

/** Report button + panel for a department overview. */
export default function DeptReport({ dept, recs }: { dept: "marketing" | "technical"; recs: Rec[] }) {
  const { lang, toast } = useApp();
  const T = (x: T4) => tx(x, lang as Lang);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"p0" | "p1" | "p3">("p0");
  const [sum, setSum] = useState(""); const [busy, setBusy] = useState(false);
  const md = useMemo(() => { const ms = monthsOf(kind); return (dept === "marketing" ? marketingReport : technicalReport)(recs, ms); }, [recs, kind, dept]);
  const full = sum ? md.replace(/\n\n/, `\n\n${sum}\n\n`) : md;
  const title = dept === "marketing" ? "AGRON Marketing report" : "AGRON Technical report";
  const ai = async () => {
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    setBusy(true);
    try { const r = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dept, report: md, lang }) }); if (!r.ok) throw new Error(await r.text()); setSum((await r.json()).summary); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (<>
    <button className="btn sm" onClick={() => setOpen(true)}><Icon n="pie" />{T(S.btn)}</button>
    {open && <>
      <div className="scrim" style={{ zIndex: 64 }} onClick={() => setOpen(false)} />
      <aside className="ai rep" role="dialog" aria-modal="true" aria-label={T(S.title)}>
        <div className="drawer-h"><div style={{ flex: 1, minWidth: 0 }}><div className="eyebrow">{T(S.title)}</div><h2 style={{ fontSize: 18 }}>{title}</h2>
          <div className="seg" role="group">{(["p0", "p1", "p3"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setSum(""); }}>{T(S[k])}</button>)}</div>
          <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>{T(S.hint)}</div></div>
          <button className="iconbtn" onClick={() => setOpen(false)} aria-label={t("close", lang)}><Icon n="x" /></button></div>
        <div className="toolbar" style={{ padding: "10px 18px", borderBottom: "1px solid var(--line-2)" }}>
          <button className="btn primary sm" disabled={busy} onClick={ai}><Icon n="spark" />{busy ? T(S.wait) : T(S.ai)}</button>
          <button className="btn ghost sm" onClick={() => markdownToPdf(full, { title, filename: `${title.replace(/\s+/g, "_")}_${monthsOf(kind).join("_")}` }).catch((e) => toast(e.message, true))}><Icon n="pdf" />{t("pdf", lang)}</button>
          <button className="btn ghost sm" onClick={() => printHtml(title, DOMPurify.sanitize(marked.parse(full) as string))}><Icon n="print" />{t("print", lang)}</button>
          <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(full).then(() => toast(t("copied", lang)))}><Icon n="copy" />{t("copy", lang)}</button>
          <button className="btn ghost sm" onClick={() => saveBlob(`${title.replace(/\s+/g, "_")}.md`, full, "text/markdown;charset=utf-8")}><Icon n="download" />{t("download", lang)}</button>
        </div>
        <div className="ai-msgs"><div className="md rep-md" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(full) as string) }} /></div>
      </aside></>}
  </>);
}
