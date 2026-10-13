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
import { DEPARTMENTS } from "@/config/workspace.config.mjs";
import { departmentReport, monthsOf } from "@/lib/reports";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const S = {
  btn: L("Report", "Отчёт", "Звіт", "تقرير"), title: L("Department report", "Отчёт департамента", "Звіт департаменту", "تقرير القسم"),
  p0: L("This month", "Этот месяц", "Цей місяць", "هذا الشهر"), p1: L("Last month", "Прошлый месяц", "Минулий місяць", "الشهر الماضي"), p3: L("Last 3 months", "Последние 3 месяца", "Останні 3 місяці", "آخر 3 أشهر"),
  ai: L("AI summary", "Выводы ИИ", "Висновки ШІ", "ملخص الذكاء الاصطناعي"), wait: L("Writing the summary…", "Пишу выводы…", "Пишу висновки…", "جارٍ كتابة الملخص…"),
  hint: L("Built from Workspace records you can see. Numbers come from the statistics sections; AI only summarises them.", "Собран из записей Workspace, доступных вам. Цифры — из разделов статистики; ИИ только делает выводы.", "Зібрано із записів Workspace, доступних вам. Цифри — з розділів статистики; ШІ лише робить висновки.", "مبني من سجلات مساحة العمل المتاحة لك. الأرقام من أقسام الإحصاءات؛ الذكاء الاصطناعي يلخصها فقط."),
};
/** Report button + panel for a department overview. */
export default function DeptReport({ dept, recs }: { dept: string; recs: Rec[] }) {
  const { lang, toast } = useApp();
  const T = (x: T4) => tx(x, lang as Lang);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"p0" | "p1" | "p3">("p0");
  const [sum, setSum] = useState(""); const [busy, setBusy] = useState(false);
  const md = useMemo(() => departmentReport(dept, recs, monthsOf(kind)), [recs, kind, dept]);
  const full = sum ? md.replace(/\n\n/, `\n\n${sum}\n\n`) : md;
  const title = `AGRON ${((DEPARTMENTS as any[]).find((x) => x.key === dept)?.label?.en || dept)} report`;
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
