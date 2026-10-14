"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, DEMO, sb, type Rec, type Activity } from "@/lib/store";
import { allSections, DEPARTMENTS } from "@/config/workspace.config.mjs";
import { qualityIssues, type Issue } from "@/lib/automation";
import { saveBlob } from "@/lib/format";
import { L, type useAuto } from "./Automation";

type T4 = { en: string; ru: string; uk: string; ar: string };
const SECS: any[] = allSections() as any[];
const KINDS: Record<Issue["kind"], { t: T4; tone: string }> = {
  no_owner: { t: L("Nobody responsible", "Нет ответственного", "Немає відповідального", "بلا مسؤول"), tone: "c-warn" },
  no_date: { t: L("No date", "Нет даты", "Немає дати", "بلا تاريخ"), tone: "c-warn" },
  broken_link: { t: L("Broken link", "Битая связь", "Битий зв'язок", "رابط معطل"), tone: "c-bad" },
  stale_link: { t: L("Old link name", "Устаревшее имя связи", "Застаріла назва зв'язку", "اسم رابط قديم"), tone: "c-info" },
  duplicate: { t: L("Possible duplicate", "Возможный дубль", "Можливий дубль", "تكرار محتمل"), tone: "c-bad" },
  stale: { t: L("Forgotten", "Забыта", "Забута", "منسي"), tone: "" },
  bad_status: { t: L("Unknown status", "Неизвестный статус", "Невідомий статус", "حالة غير معروفة"), tone: "c-bad" },
};

/** Administration → System → Data quality and the audit trail. */
export default function Quality({ a }: { a: ReturnType<typeof useAuto> }) {
  const { lang, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [kind, setKind] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const load = () => store.listMany(SECS.map((s) => s.id).filter((id) => id !== "mail.outbox")).then(setRecs).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const stale = a.s?.settings.thresholds.stale_record || 60;
  const issues = useMemo(() => (recs ? qualityIssues(recs, SECS, { staleDays: stale }) : []), [recs, stale]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const i of issues) c[i.kind] = (c[i.kind] || 0) + 1; return c; }, [issues]);
  const shown = issues.filter((i) => !kind || i.kind === kind);
  const fixable = issues.filter((i) => i.fix);
  const fixAll = async () => {
    setBusy(true); let n = 0;
    for (const i of fixable) { const r = recs!.find((x) => x.id === i.id); if (!r) continue; const data = { ...r.data }; for (const [k, v] of Object.entries(i.fix!)) { if (v === null) delete data[k]; else data[k] = v; } try { await store.save({ ...r, data }); n++; } catch {} }
    setBusy(false); toast(`${n} ✓`); load();
  };
  const sec = (id: string) => tx(SECS.find((s) => s.id === id)?.label, lang as Lang) || id;

  return (<div style={{ display: "grid", gap: 16 }}>
    <section className="card">
      <div className="card-h toolbar"><h2><Icon n="check" />{T(L("Data quality", "Качество данных", "Якість даних", "جودة البيانات"))}</h2>
        <span className={`chip ${issues.length ? "c-warn" : "c-ok"}`}>{recs ? issues.length : "…"}</span>
        {fixable.length > 0 && <button className="btn primary sm" style={{ marginInlineStart: "auto" }} disabled={busy} onClick={fixAll}><Icon n="check" />{busy ? "…" : `${T(L("Fix automatically", "Исправить автоматически", "Виправити автоматично", "إصلاح تلقائي"))} (${fixable.length})`}</button>}</div>
      <p className="faint" style={{ margin: "0 20px 10px", fontSize: 13.5 }}>{T(L("Most mistakes start with a gap: a task nobody owns, a date nobody set, a link to a deleted record, the same client twice. Clear this list weekly; the Data quality agent sends it on Mondays.", "Большинство ошибок начинается с пробела: дело без ответственного, срок без даты, связь с удалённой записью, один клиент дважды. Разбирайте этот список раз в неделю; агент «Качество данных» присылает его по понедельникам.", "Більшість помилок починається з прогалини: справа без відповідального, термін без дати, зв'язок із видаленим записом, один клієнт двічі. Розбирайте цей список щотижня; агент «Якість даних» надсилає його щопонеділка.", "تبدأ معظم الأخطاء بثغرة: مهمة بلا مالك، موعد بلا تاريخ، رابط لسجل محذوف، العميل نفسه مرتين. راجع هذه القائمة أسبوعياً؛ يرسلها الوكيل كل اثنين."))}</p>
      <div className="chipbar" style={{ padding: "0 20px 12px", display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className={`chip ${!kind ? "c-info" : ""}`} onClick={() => setKind("")}>{T(L("All", "Все", "Усі", "الكل"))} {issues.length}</button>
        {(Object.keys(KINDS) as Issue["kind"][]).filter((k) => counts[k]).map((k) => <button key={k} className={`chip ${kind === k ? "c-info" : ""}`} onClick={() => setKind(k)}>{T(KINDS[k].t)} {counts[k]}</button>)}</div>
      {recs && (shown.length ? <div className="feed">{shown.slice(0, 150).map((i, n) => (
        <a key={i.id + i.kind + n} className="hub-row" href={`/${i.section.replace(".", "/")}?r=${i.id}`}>
          <span><b>{i.title}</b><small>{sec(i.section)} · {i.detail}</small></span><span className={`chip ${KINDS[i.kind].tone}`}>{T(KINDS[i.kind].t)}</span></a>))}</div>
        : <div className="empty">{T(L("Clean. No gaps found.", "Чисто. Пробелов нет.", "Чисто. Прогалин немає.", "نظيف. لا ثغرات."))}</div>)}
    </section>
    <Audit />
  </div>);
}

/** Audit trail: who changed what and when, including automation (actor empty = automation or system). */
function Audit() {
  const { lang, people } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [rows, setRows] = useState<Activity[]>([]);
  const [who, setWho] = useState(""); const [dept, setDept] = useState(""); const [act, setAct] = useState("");
  useEffect(() => {
    (async () => {
      if (DEMO) { setRows(await store.activity({ limit: 300 })); return; }
      let q = sb().from("activity").select("*").order("created_at", { ascending: false }).limit(400);
      if (who === "auto") q = q.is("actor", null); else if (who) q = q.eq("actor", who);
      if (dept) q = q.like("section", `${dept}.%`);
      if (act) q = q.eq("action", act);
      const { data } = await q; setRows((data || []) as Activity[]);
    })();
  }, [who, dept, act]);
  const name = (id: string | null) => (id ? people.find((p) => p.id === id)?.full_name || people.find((p) => p.id === id)?.email || id.slice(0, 8) : T(L("Automation", "Автоматизация", "Автоматизація", "الأتمتة")));
  const sec = (id: string) => tx(SECS.find((s) => s.id === id)?.label, lang as Lang) || id;
  const text = (r: Activity) => r.action === "automation" ? `${r.detail?.agent}: ${r.detail?.text}` : r.action === "status" ? `${r.detail?.from || "—"} → ${r.detail?.to || "—"}` : r.detail?.file || "";
  const csv = () => saveBlob(`AGRON_audit_${new Date().toISOString().slice(0, 10)}.csv`, ["time,who,section,action,record,detail", ...rows.map((r) => [r.created_at, name(r.actor), r.section, r.action, r.detail?.title || "", text(r)].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","))].join("\n"), "text/csv;charset=utf-8");
  return (<section className="card">
    <div className="card-h toolbar"><h2><Icon n="eye" />{T(L("Audit trail", "Журнал изменений", "Журнал змін", "سجل التدقيق"))}</h2>
      <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={csv}><Icon n="download" />CSV</button></div>
    <div className="toolbar" style={{ padding: "0 20px 12px", gap: 8 }}>
      <select className="input" style={{ width: "auto" }} value={who} onChange={(e) => setWho(e.target.value)}><option value="">{T(L("Everyone", "Все", "Усі", "الجميع"))}</option><option value="auto">{T(L("Automation only", "Только автоматизация", "Лише автоматизація", "الأتمتة فقط"))}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>
      <select className="input" style={{ width: "auto" }} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">{T(L("All departments", "Все департаменты", "Усі департаменти", "كل الأقسام"))}</option>{(DEPARTMENTS as any[]).map((d) => <option key={d.key} value={d.key}>{tx(d.label, lang as Lang)}</option>)}</select>
      <select className="input" style={{ width: "auto" }} value={act} onChange={(e) => setAct(e.target.value)}><option value="">{T(L("All actions", "Все действия", "Усі дії", "كل الإجراءات"))}</option>{["created", "updated", "status", "deleted", "automation", "viewed", "file opened"].map((x) => <option key={x}>{x}</option>)}</select></div>
    {rows.length ? <div className="feed">{rows.slice(0, 300).map((r) => (
      <div key={r.id} className="feed-row"><small className="faint mono" style={{ minWidth: 112 }}>{r.created_at.slice(0, 16).replace("T", " ")}</small>
        <span className={`chip ${r.actor ? "" : "c-info"}`}>{name(r.actor)}</span>
        <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}><b>{r.action}</b> · {r.record_id ? <a href={`/${r.section.replace(".", "/")}?r=${r.record_id}`}>{r.detail?.title || "—"}</a> : r.detail?.title || ""} <span className="faint">· {sec(r.section)}{text(r) ? ` · ${text(r)}` : ""}</span></span></div>))}</div>
      : <div className="empty">{T(L("No entries.", "Записей нет.", "Записів немає.", "لا إدخالات."))}</div>}
  </section>);
}
